import type { AuditHumanInteractionLedger, ResponseRecord } from "../humanInteraction/ledger";
import type { HumanInteractionService } from "../humanInteraction/service";
import type { HumanInteractionTransport, InboundResult } from "../humanInteraction/types";
import { TelegramApiError, type InlineButton, type TelegramBotClient, type TelegramUpdate } from "./client";
import type { TelegramConfig } from "./config";
import { formatNotice, GOAL_USAGE, HELP_TEXT, noticeButtons } from "./format";
import { parseUpdate, type ParsedUpdate } from "./updates";

export const TELEGRAM_CURSOR = "telegram";

/**
 * The ONE human-facing exit: every Owner-visible Telegram message (Manager replies and Manager
 * notices alike) is sent here, and only to the owner's private chat. Nothing else in the
 * orchestrator calls sendMessage; internal subsystems only produce state for the Manager layer.
 */
export interface OwnerDeliveryChannel {
  send(message: { text: string; replyTo?: number | null; buttons?: InlineButton[][] }, signal?: AbortSignal): Promise<{ messageId: number }>;
}

export function createOwnerDeliveryChannel(client: TelegramBotClient, ownerChatId: number): OwnerDeliveryChannel {
  return {
    send: ({ text, replyTo, buttons }, signal) =>
      client.sendMessage({ chatId: ownerChatId, text, ...(replyTo != null ? { replyToMessageId: replyTo } : {}), ...(buttons ? { buttons } : {}) }, signal),
  };
}

/** Outbound notice transport (Manager notification decisions) over the single Owner channel. */
export function createTelegramTransport(client: TelegramBotClient, ownerChatId: number): HumanInteractionTransport {
  const channel = createOwnerDeliveryChannel(client, ownerChatId);
  return {
    async deliver(notice) {
      const buttons = noticeButtons(notice);
      const sent = await channel.send({ text: formatNotice(notice), ...(buttons ? { buttons } : {}) });
      return { deliveryRef: String(sent.messageId) };
    },
  };
}

export interface TelegramControlPlaneDeps {
  config: TelegramConfig;
  client: TelegramBotClient;
  service: HumanInteractionService;
  ledger: AuditHumanInteractionLedger;
  /** Safe operator status lines only. Never receives tokens, guidance, or raw updates. */
  log: (line: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollTimeoutSeconds?: number;
  observeIntervalMs?: number;
  backoff?: { initialMs: number; maxMs: number };
  now?: () => string;
  /** Send attempts of one unconfirmed response before it is abandoned (default 3). */
  maxResponseAttempts?: number;
}

export class TelegramStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramStartupError";
  }
}

export interface TelegramControlPlane {
  /** Verifies the token with getMe and the bot identity. Fails closed. */
  start(): Promise<{ botUsername: string | null }>;
  /** One bounded getUpdates round; processes updates in order and advances the durable offset. */
  pollOnce(): Promise<number>;
  /** Runs polling + observation until stop() or a fatal error. */
  run(): Promise<void>;
  stop(): Promise<void>;
  /** Next backoff delay for a given consecutive failure count (exposed for tests). */
  backoffMs(failures: number, error?: unknown): number;
  /** One retry round of unconfirmed responses (the observation loop runs it; exposed for tests). */
  retryPendingResponses(): Promise<void>;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export function createTelegramControlPlane(deps: TelegramControlPlaneDeps): TelegramControlPlane {
  const sleep = deps.sleep ?? defaultSleep;
  const pollTimeoutSeconds = deps.pollTimeoutSeconds ?? 25;
  const observeIntervalMs = deps.observeIntervalMs ?? 5_000;
  const backoff = deps.backoff ?? { initialMs: 1_000, maxMs: 60_000 };
  const owner = deps.config.ownerChatId;
  const channel = createOwnerDeliveryChannel(deps.client, owner);
  const controller = new AbortController();
  let started = false;
  let botId: number | null = null;
  let running: Promise<void> | null = null;

  const now = deps.now ?? (() => new Date().toISOString());
  const maxAttempts = deps.maxResponseAttempts ?? 3;
  const quiet = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* best-effort feedback; the decision itself was already handled */
    }
  };

  /**
   * Identity of the ONE logical response to an inbound update: the owner's own Telegram message or
   * button press (stable across redelivery, re-claim and restart) — never the response text.
   */
  function responseIdOf(parsed: Exclude<ParsedUpdate, { kind: "ignored" }>): string | null {
    if (parsed.kind === "action") return `tg.cbq.${parsed.callbackQueryId.slice(0, 64)}`;
    return parsed.messageId === null ? null : `tg.reply.${parsed.messageId}`;
  }

  /** Sends one recorded response whose delivery is not confirmed yet; durable outcome either way. */
  async function sendRecorded(r: ResponseRecord): Promise<void> {
    try {
      const sent = await channel.send({ text: r.text, replyTo: r.replyTo }, controller.signal);
      deps.ledger.recordResponseDelivered(r.responseId, String(sent.messageId));
    } catch {
      deps.ledger.recordResponseFailed(r.responseId);
      const after = deps.ledger.response(r.responseId);
      if (after && after.failures >= maxAttempts) {
        deps.ledger.recordResponseAbandoned(r.responseId);
        deps.log("telegram: a reply could not be delivered after bounded retries; abandoned");
      } else deps.log("telegram: reply delivery failed; it will be retried");
    }
  }

  /** At most one response per inbound update: intent first, then the send, then the confirmed delivery. */
  async function respond(responseId: string | null, chatId: number, replyTo: number | null, result: InboundResult) {
    const text = result.message ?? "";
    if (responseId === null) {
      if (text) await quiet(() => channel.send({ text, replyTo }, controller.signal));
      return;
    }
    deps.ledger.recordResponseIntent({ responseId, text, chatId, replyTo, createdAt: now() });
    // A notice (e.g. a cancel confirmation) already answered: the update is still marked as answered.
    if (!text) return deps.ledger.recordResponseDelivered(responseId, "none");
    await sendRecorded(deps.ledger.response(responseId)!);
  }

  /** Re-sends responses whose delivery was never confirmed (send failure, crash before confirmation). */
  async function retryPendingResponses() {
    for (const r of deps.ledger.pendingResponses()) {
      if (controller.signal.aborted) return;
      await sendRecorded(r);
    }
  }

  async function handle(update: TelegramUpdate) {
    const parsed = parseUpdate(update, owner, botId);
    if (parsed.kind === "ignored") return; // never answer strangers
    const responseId = responseIdOf(parsed);
    const prior = responseId ? deps.ledger.response(responseId) : null;
    if (prior) {
      // The same owner message again (restart before the cursor advanced, gateway re-claim, redelivery):
      // it was already handled and answered once — never handled or answered a second time.
      if (prior.deliveryRef === null && !prior.abandoned) await sendRecorded(prior);
      deps.log("telegram: update already answered; not handled again");
      return;
    }
    const reply = (result: InboundResult) => respond(responseId, parsed.chatId, parsed.messageId, result);
    switch (parsed.kind) {
      case "help":
        return reply({ outcome: "info", message: HELP_TEXT });
      case "usage":
        return reply({ outcome: "info", message: parsed.command === "goal" ? GOAL_USAGE : "用法：/status <任務編號（至少 4 個字元）>" });
      case "goal":
        return reply(await deps.service.submitGoal(parsed.inbound));
      case "tasks":
        return reply(await deps.service.listTasks());
      case "status":
        return reply(await deps.service.taskStatus(parsed.reference));
      case "cancel":
        return reply(await deps.service.requestCancel(parsed.inbound));
      case "reply":
        return reply(await deps.service.handleReply(parsed.inbound));
      case "action": {
        const result = await deps.service.handleAction(parsed.inbound);
        await quiet(() => deps.client.answerCallbackQuery({ callbackQueryId: parsed.callbackQueryId, text: result.message || "Confirmation sent." }, controller.signal));
        const notice = deps.ledger.byRef(parsed.inbound.ref);
        const final = ["approved", "rejected", "cancelled", "kept", "stale", "duplicate"].includes(result.outcome);
        const onApprovalOrConfirm = notice && (notice.kind === "commit_publish_approval" || notice.kind === "start_approval" || notice.kind === "cancel_confirmation");
        if (final && onApprovalOrConfirm && notice.deliveryRef && /^[0-9]+$/.test(notice.deliveryRef)) {
          const messageId = Number(notice.deliveryRef);
          await quiet(() => deps.client.removeButtons({ chatId: parsed.chatId, messageId }, controller.signal));
        }
        return reply(result.outcome === "duplicate" ? { ...result, message: "" } : result);
      }
    }
  }

  async function pollOnce(): Promise<number> {
    if (!started) throw new TelegramStartupError("control plane not started");
    const offset = deps.ledger.cursor(TELEGRAM_CURSOR);
    const updates = await deps.client.getUpdates({ offset, timeoutSeconds: pollTimeoutSeconds }, controller.signal);
    let processed = 0;
    for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
      if (controller.signal.aborted) break;
      const current = deps.ledger.cursor(TELEGRAM_CURSOR);
      if (current !== null && update.update_id < current) continue; // already processed before a restart
      try {
        await handle(update);
      } catch {
        deps.log("telegram: update handling failed; skipped without task effects");
      }
      deps.ledger.setCursor(TELEGRAM_CURSOR, update.update_id + 1);
      processed++;
    }
    return processed;
  }

  function backoffMs(failures: number, error?: unknown): number {
    const retryAfter = error instanceof TelegramApiError ? error.retryAfterMs : undefined;
    const exp = Math.min(backoff.maxMs, backoff.initialMs * 2 ** Math.max(0, Math.min(failures - 1, 16)));
    return Math.min(backoff.maxMs * 5, Math.max(exp, retryAfter ?? 0));
  }

  async function pollLoop() {
    let failures = 0;
    while (!controller.signal.aborted) {
      try {
        await pollOnce();
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error instanceof TelegramApiError && error.kind === "unauthorized") {
          deps.log("telegram: bot token rejected; stopping (fail closed)");
          controller.abort();
          throw new TelegramStartupError("Telegram bot token rejected");
        }
        failures++;
        const delay = backoffMs(failures, error);
        deps.log(`telegram: polling error (${error instanceof TelegramApiError ? error.kind : "internal"}); retry in ${Math.round(delay / 1000)}s`);
        await sleep(delay, controller.signal);
      }
    }
  }

  async function observeLoop() {
    while (!controller.signal.aborted) {
      try {
        await retryPendingResponses();
        await deps.service.observe();
      } catch {
        deps.log("telegram: observation round failed; will retry");
      }
      await sleep(observeIntervalMs, controller.signal);
    }
  }

  return {
    async start() {
      let me;
      try {
        me = await deps.client.getMe(controller.signal);
      } catch (error) {
        if (error instanceof TelegramApiError && error.kind === "unauthorized") throw new TelegramStartupError("Telegram bot token rejected");
        throw new TelegramStartupError(`Telegram getMe failed (${error instanceof TelegramApiError ? error.kind : "internal"})`);
      }
      const expected = deps.config.expectedBotUsername;
      if (expected && me.username?.toLowerCase() !== expected.toLowerCase()) throw new TelegramStartupError("Telegram bot identity does not match TELEGRAM_EXPECTED_BOT_USERNAME");
      started = true;
      botId = me.id;
      return { botUsername: me.username ?? null };
    },
    pollOnce,
    run() {
      if (!started) return Promise.reject(new TelegramStartupError("control plane not started"));
      if (!running) {
        running = Promise.all([pollLoop(), observeLoop()]).then(
          () => undefined,
          (error) => {
            controller.abort();
            throw error;
          },
        );
      }
      return running;
    },
    async stop() {
      controller.abort();
      if (running) await running.catch(() => undefined);
    },
    backoffMs,
    retryPendingResponses,
  };
}
