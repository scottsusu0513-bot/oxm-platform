import type { AuditHumanInteractionLedger } from "../humanInteraction/ledger";
import type { HumanInteractionService } from "../humanInteraction/service";
import type { HumanInteractionTransport, InboundResult } from "../humanInteraction/types";
import { TelegramApiError, type TelegramBotClient, type TelegramUpdate } from "./client";
import type { TelegramConfig } from "./config";
import { formatNotice, GOAL_USAGE, HELP_TEXT, noticeButtons } from "./format";
import { parseUpdate } from "./updates";

export const TELEGRAM_CURSOR = "telegram";

/** Outbound Telegram transport: every notice goes to the owner's private chat only. */
export function createTelegramTransport(client: TelegramBotClient, ownerChatId: number): HumanInteractionTransport {
  return {
    async deliver(notice) {
      const buttons = noticeButtons(notice);
      const sent = await client.sendMessage({ chatId: ownerChatId, text: formatNotice(notice), ...(buttons ? { buttons } : {}) });
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
  const controller = new AbortController();
  let started = false;
  let botId: number | null = null;
  let running: Promise<void> | null = null;

  const quiet = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* best-effort feedback; the decision itself was already handled */
    }
  };

  async function feedback(chatId: number, replyTo: number | null, result: InboundResult) {
    if (!result.message) return; // a notice (e.g. a cancel confirmation) already answered
    await quiet(() => deps.client.sendMessage({ chatId, text: result.message, ...(replyTo !== null ? { replyToMessageId: replyTo } : {}) }, controller.signal));
  }

  async function handle(update: TelegramUpdate) {
    const parsed = parseUpdate(update, owner, botId);
    switch (parsed.kind) {
      case "ignored":
        return; // never answer strangers
      case "help":
        return feedback(parsed.chatId, parsed.messageId, { outcome: "info", message: HELP_TEXT });
      case "usage":
        return feedback(parsed.chatId, parsed.messageId, { outcome: "info", message: parsed.command === "goal" ? GOAL_USAGE : "Usage: /status <task id or at least 4 of its characters>" });
      case "goal":
        return feedback(parsed.chatId, parsed.messageId, await deps.service.submitGoal(parsed.inbound));
      case "tasks":
        return feedback(parsed.chatId, parsed.messageId, await deps.service.listTasks());
      case "status":
        return feedback(parsed.chatId, parsed.messageId, await deps.service.taskStatus(parsed.reference));
      case "cancel":
        return feedback(parsed.chatId, parsed.messageId, await deps.service.requestCancel(parsed.inbound));
      case "reply":
        return feedback(parsed.chatId, parsed.messageId, await deps.service.handleReply(parsed.inbound));
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
        if (result.outcome !== "duplicate") await feedback(parsed.chatId, parsed.messageId, result);
        return;
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
  };
}
