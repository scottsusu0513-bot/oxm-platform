import { describe, expect, it } from "vitest";
import { handleRequest } from "../../../services/wake-gateway/src/index";
import { projectUpdate } from "../../../services/wake-gateway/src/telegram";
import { AGENT_TOKEN, createGateway, type Gateway } from "../../../services/wake-gateway/test/harness";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import { createAuditHumanInteractionLedger } from "../humanInteraction/ledger";
import { createSimulation, fakeIntake } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createTelegramBotClient, TelegramApiError, type TelegramUpdate } from "./client";
import { readTelegramSourceConfig, type TelegramConfig } from "./config";
import { createTelegramControlPlane, createTelegramTransport, TELEGRAM_CURSOR } from "./controlPlane";
import { callbackUpdate, createFakeBotApi, FAKE_TOKEN, textUpdate } from "./fake";
import { checkGateway, createGatewayUpdatesClient, type GatewayFetch } from "./gatewaySource";
import { parseUpdate } from "./updates";

const OWNER = 777001;
const STRANGER = 999002;
const GATEWAY_URL = "https://gw.example";
const config: TelegramConfig = { botToken: FAKE_TOKEN, ownerChatId: OWNER, expectedBotUsername: "OXM_Agent_bot" };

/** The Agent's HTTP calls served by the real Gateway Worker handler + Durable Object. */
const gatewayFetch = (g: Gateway): GatewayFetch => (url, init) => handleRequest(new Request(url, { method: init.method, headers: init.headers }), g.env, () => {});

async function agent(g: Gateway, input: { commit?: string[]; audit?: AuditRepository } = {}) {
  const api = createFakeBotApi();
  const audit = input.audit ?? createInMemoryAuditRepository(() => "2026-10-08T00:00:00.000Z");
  const sim = createSimulation({ worker: {}, autoApproveCommits: false });
  for (const id of input.commit ?? []) await sim.create(fakeIntake({ taskId: id }));
  const bot = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
  const client = createGatewayUpdatesClient({ telegram: bot, gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN, fetch: gatewayFetch(g), heartbeatMs: 0 });
  const transport = createTelegramTransport(bot, OWNER);
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, transport: Object.assign(transport, { sent: [], failNext: 0 }) });
  const cp = createTelegramControlPlane({ config, client, service: h.service, ledger: h.ledger, log: () => {}, sleep: async () => {}, pollTimeoutSeconds: 0 });
  await cp.start();
  return { api, audit, sim, bot, client, cp, ...h };
}

describe("Telegram source configuration", () => {
  it("21. defaults to direct Telegram polling (rollback mode) and validates gateway mode fail-closed", () => {
    expect(readTelegramSourceConfig({})).toEqual({ ok: true, config: { source: "telegram" } });
    expect(readTelegramSourceConfig({ OXM_AGENT_TELEGRAM_SOURCE: "telegram" })).toEqual({ ok: true, config: { source: "telegram" } });
    expect(readTelegramSourceConfig({ OXM_AGENT_TELEGRAM_SOURCE: "both" }).ok).toBe(false);
    const base = { OXM_AGENT_TELEGRAM_SOURCE: "gateway", OXM_WAKE_GATEWAY_URL: "https://gw.example/", OXM_WAKE_GATEWAY_AGENT_TOKEN: AGENT_TOKEN };
    expect(readTelegramSourceConfig(base)).toEqual({ ok: true, config: { source: "gateway", gatewayUrl: "https://gw.example", agentToken: AGENT_TOKEN } });
    for (const bad of [
      { OXM_WAKE_GATEWAY_URL: "" },
      { OXM_WAKE_GATEWAY_URL: "http://gw.example" },
      { OXM_WAKE_GATEWAY_URL: "https://user:pw@gw.example" },
      { OXM_WAKE_GATEWAY_AGENT_TOKEN: "short-SECRETVALUE" },
      { OXM_WAKE_GATEWAY_AGENT_TOKEN: FAKE_TOKEN.replace(":", "_").padEnd(50, "x"), TELEGRAM_BOT_TOKEN: FAKE_TOKEN.replace(":", "_").padEnd(50, "x") },
      { GITHUB_WAKE_TOKEN: "github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { TELEGRAM_WEBHOOK_SECRET: "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    ]) {
      const r = readTelegramSourceConfig({ ...base, ...bad });
      expect(r.ok, JSON.stringify(Object.keys(bad))).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/SECRETVALUE|github_pat_|whsec_|AAFake/);
    }
  });
});

describe("Agent <- Wake Gateway handoff", () => {
  it("20. an owner /goal sent while the Agent pulls from the Gateway creates one task; Telegram getUpdates is never called", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 修正 OXM 搜尋頁 AI loading 體驗，完成後自行測試", messageId: 82, updateId: 7001 }));
    await g.webhook(textUpdate({ chatId: STRANGER, text: "/goal 惡意任務", messageId: 83, updateId: 7002 }));
    expect(await p.cp.pollOnce()).toBe(1);
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
    expect(p.api.sent.at(-1)!.replyTo).toBe(82);
    expect(p.ledger.cursor(TELEGRAM_CURSOR)).toBe(7002);
    // The next pull carries the ledger cursor, which confirms the update at the Gateway.
    expect(await p.cp.pollOnce()).toBe(0);
    expect(g.store.rows()).toEqual([]);
    expect(p.api.calls.map((c) => c.method)).not.toContain("getUpdates");
  });

  it("10. a crash before the Gateway ACK redelivers the update, and the existing idempotency creates no second task", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    const goal = textUpdate({ chatId: OWNER, text: "/goal 只建一次的任務", messageId: 90, updateId: 7101 });
    await g.webhook(goal);
    await g.webhook(goal); // Telegram webhook retry
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
    expect(g.store.rows()).toHaveLength(1); // delivered, not yet confirmed

    // The Agent restarts having lost its cursor (worst case): the Gateway re-serves the update.
    const freshLedger = createAuditHumanInteractionLedger({ audit: createInMemoryAuditRepository(() => "t"), nextId: (() => { let i = 0; return () => `r-${++i}`; })() });
    const cp2 = createTelegramControlPlane({ config, client: p.client, service: p.service, ledger: freshLedger, log: () => {}, sleep: async () => {}, pollTimeoutSeconds: 0 });
    await cp2.start();
    expect(await cp2.pollOnce()).toBe(1);
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
  });

  it("an Agent restart over the same durable ledger resumes the cursor; nothing is re-served or reprocessed", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 重啟測試", messageId: 95, updateId: 7201 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    const ledger2 = createAuditHumanInteractionLedger({ audit: p.audit, nextId: (() => { let i = 0; return () => `b2-${++i}`; })() });
    expect(ledger2.cursor(TELEGRAM_CURSOR)).toBe(7202);
    const cp2 = createTelegramControlPlane({ config, client: p.client, service: p.service, ledger: ledger2, log: () => {}, sleep: async () => {}, pollTimeoutSeconds: 0 });
    await cp2.start();
    expect(await cp2.pollOnce()).toBe(0);
    expect(g.store.rows()).toEqual([]);
    expect(p.sim.loop.tasks()).toHaveLength(1);
  });

  it("migration: the existing direct-polling cursor stays valid; an old update replayed via webhook is never reprocessed", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    p.ledger.setCursor(TELEGRAM_CURSOR, 7300); // cursor left by direct getUpdates polling
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 早就處理過的舊任務", messageId: 96, updateId: 7250 }));
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 新任務", messageId: 97, updateId: 7301 }));
    expect(await p.cp.pollOnce()).toBe(1);
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
    expect(p.api.sent.at(-1)!.replyTo).toBe(97);
    await p.cp.pollOnce();
    expect(g.store.rows()).toEqual([]);
  });

  it("23. approval buttons through the Gateway reach the Approval Gateway once; retries, repeats and strangers have no effect", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g, { commit: ["gw4"] });
    await p.service.observe();
    const msg = p.api.sent[0];
    const [[approve, reject]] = msg.buttons as { callback_data: string }[][];
    await g.webhook(callbackUpdate({ chatId: OWNER, fromId: STRANGER, data: approve.callback_data, messageId: msg.messageId, updateId: 7401 }));
    const tap = callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-1", updateId: 7402 });
    await g.webhook(tap);
    await g.webhook(tap); // webhook retry
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.approvalEvents).toEqual([{ taskId: "gw4", decision: "approved" }]);
    await g.webhook(callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-2", updateId: 7403 }));
    await g.webhook(callbackUpdate({ chatId: OWNER, data: reject.callback_data, messageId: msg.messageId, id: "cb-3", updateId: 7404 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.approvalEvents).toHaveLength(1);
    expect(p.sim.commits).toHaveLength(1);
    expect(p.sim.approvals.listByTask("gw4").map((a) => a.status)).toEqual(["approved"]);
    expect(p.api.calls.map((c) => c.method)).not.toContain("getUpdates");
  });

  it("a rejected pull token fails closed as unauthorized; Gateway outages are transient; the token never leaks", async () => {
    const g = await createGateway({ ghState: "Available" });
    const bot = createTelegramBotClient({ token: FAKE_TOKEN, fetch: createFakeBotApi().fetch });
    const wrong = `${AGENT_TOKEN}WRONG`;
    const bad = createGatewayUpdatesClient({ telegram: bot, gatewayUrl: GATEWAY_URL, agentToken: wrong, fetch: gatewayFetch(g), heartbeatMs: 0 });
    const e = await bad.getUpdates({ offset: null, timeoutSeconds: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramApiError);
    expect(e.kind).toBe("unauthorized");
    expect(`${e.message} ${e.stack}`).not.toContain(wrong);
    const down = createGatewayUpdatesClient({ telegram: bot, gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN, fetch: async () => Promise.reject(new Error(`ECONNREFUSED ${AGENT_TOKEN}`)) , heartbeatMs: 0 });
    const e2 = await down.getUpdates({ offset: 1, timeoutSeconds: 0 }).catch((x) => x);
    expect(e2.kind).toBe("transient");
    expect(`${e2.message} ${e2.stack}`).not.toContain(AGENT_TOKEN);
    const outage = createGatewayUpdatesClient({ telegram: bot, gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN, fetch: async () => ({ status: 503, text: async () => "" }) , heartbeatMs: 0 });
    expect((await outage.getUpdates({ offset: 1, timeoutSeconds: 0 }).catch((x) => x)).kind).toBe("transient");
    await expect(checkGateway({ gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN, fetch: gatewayFetch(g), heartbeatMs: 0 })).resolves.toBeUndefined();
    await expect(checkGateway({ gatewayUrl: GATEWAY_URL, agentToken: wrong, fetch: gatewayFetch(g) })).rejects.toMatchObject({ kind: "unauthorized" });
  });
});

describe("Gateway handoff edge cases", () => {
  it("Telegram restarting update ids lower (after a week idle) still reaches the Agent instead of being skipped by its cursor", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 第一個", messageId: 300, updateId: 9000 }));
    await p.cp.pollOnce();
    await p.cp.pollOnce();
    expect(p.ledger.cursor(TELEGRAM_CURSOR)).toBe(9001);
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 重置後的新任務", messageId: 301, updateId: 15 }));
    expect(await p.cp.pollOnce()).toBe(1);
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(2);
    expect(p.api.sent.at(-1)!.replyTo).toBe(301);
  });

  it("a callback replayed by Telegram after the ACK is a duplicate at the Gateway and never applies twice", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g, { commit: ["gw9"] });
    await p.service.observe();
    const msg = p.api.sent[0];
    const [[approve]] = msg.buttons as { callback_data: string }[][];
    const tap = callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-9", updateId: 7501 });
    await g.webhook(tap);
    await p.cp.pollOnce();
    await p.cp.pollOnce(); // ACK
    expect(g.store.rows()).toEqual([]);
    await g.webhook(tap); // late Telegram replay
    expect(g.store.rows()).toEqual([]);
    expect(await p.cp.pollOnce()).toBe(0);
    await p.sim.loop.settle();
    expect(p.approvalEvents).toEqual([{ taskId: "gw9", decision: "approved" }]);
  });

  it("the client heartbeats the Gateway once polling has started, so a busy Agent is not taken for an offline one", async () => {
    const calls: string[] = [];
    const fetchSpy: GatewayFetch = async (url) => {
      calls.push(new URL(url).pathname);
      return { status: 200, text: async () => JSON.stringify({ ok: true, result: [] }) };
    };
    const bot = createTelegramBotClient({ token: FAKE_TOKEN, fetch: createFakeBotApi().fetch });
    const client = createGatewayUpdatesClient({ telegram: bot, gatewayUrl: GATEWAY_URL, agentToken: AGENT_TOKEN, fetch: fetchSpy, heartbeatMs: 10 });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([]); // nothing before polling starts
    await client.getUpdates({ offset: null, timeoutSeconds: 0 });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.filter((c) => c === "/agent/ping").length).toBeGreaterThanOrEqual(2);
  });

  it("rollback: the same ledger under direct Telegram polling neither replays processed updates nor touches Gateway leftovers", async () => {
    const g = await createGateway({ ghState: "Available" });
    const p = await agent(g);
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 切換前", messageId: 400, updateId: 7601 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    await g.webhook(textUpdate({ chatId: OWNER, text: "/goal 留在 Gateway 佇列", messageId: 401, updateId: 7602 })); // left behind at rollback
    // deleteWebhook + OXM_AGENT_TELEGRAM_SOURCE=telegram: same durable ledger, direct Bot API polling.
    const cpDirect = createTelegramControlPlane({ config, client: p.bot, service: p.service, ledger: p.ledger, log: () => {}, sleep: async () => {}, pollTimeoutSeconds: 0 });
    await cpDirect.start();
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/goal 切換前", messageId: 400, updateId: 7601 }), textUpdate({ chatId: OWNER, text: "/goal 切換後", messageId: 402, updateId: 7603 }));
    expect(await cpDirect.pollOnce()).toBe(1);
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(2);
    expect(p.api.calls.filter((c) => c.method === "getUpdates").at(-1)!.payload.offset).toBe(7602);
    expect(g.store.rows().map((r) => r.update_id)).toEqual([7601, 7602]); // leftovers never reach the Agent in direct mode
  });
});

describe("22. Gateway projection preserves Telegram parse semantics", () => {
  const BOT_ID = 42;
  const goal = textUpdate({ chatId: OWNER, text: "/goal priority:high 修正", messageId: 1, updateId: 1 }) as TelegramUpdate & { message: Record<string, unknown> };
  const corpus: TelegramUpdate[] = [
    goal,
    { ...goal, message: { ...goal.message, date: 1, entities: [{ type: "bot_command" }], from: { id: OWNER, is_bot: false, first_name: "x", language_code: "zh" } } },
    textUpdate({ chatId: OWNER, text: "/status abcd", messageId: 2 }),
    textUpdate({ chatId: OWNER, text: "/tasks", messageId: 3 }),
    textUpdate({ chatId: OWNER, text: "/cancel", messageId: 4, replyTo: 900 }),
    textUpdate({ chatId: OWNER, text: "/help@OXM_Agent_bot", messageId: 5 }),
    textUpdate({ chatId: OWNER, text: "請改用 UTC 比較", messageId: 6, replyTo: 901 }),
    { update_id: 7, message: { message_id: 7, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text: "/cancel", reply_to_message: { message_id: 902, chat: { id: OWNER, type: "private" }, from: { id: BOT_ID, is_bot: true }, text: "通知\nRef: 0123456789abcdef" } } },
    { update_id: 8, message: { message_id: 8, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text: "x", reply_to_message: { message_id: 903, chat: { id: STRANGER, type: "private" } } } },
    { update_id: 9, message: { message_id: 9, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text: "x", reply_to_message: { message_id: "bad" } } },
    callbackUpdate({ chatId: OWNER, data: "a:0123456789abcdef", messageId: 10 }),
    callbackUpdate({ chatId: OWNER, data: "c:0123456789abcdef", messageId: 11, id: "q-11" }),
    callbackUpdate({ chatId: OWNER, data: "merge:0123456789abcdef", messageId: 12 }),
    callbackUpdate({ chatId: OWNER, fromId: STRANGER, data: "a:0123456789abcdef", messageId: 13 }),
    textUpdate({ chatId: STRANGER, text: "/goal x", messageId: 14 }),
    textUpdate({ chatId: OWNER, fromId: STRANGER, text: "/goal x", messageId: 15 }),
    textUpdate({ chatId: OWNER, text: "/goal x", messageId: 16, chatType: "group" }),
    { update_id: 17, message: { message_id: 17, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: true }, text: "/goal x" } },
    { update_id: 18, message: { message_id: 18, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, photo: [{}] } },
    { update_id: 19, edited_message: { message_id: 19, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text: "/goal x" } },
    { update_id: 20, callback_query: { id: "q", from: { id: OWNER, is_bot: false }, data: "a:0123456789abcdef" } },
  ];

  it("every accepted projection parses exactly like the raw update; everything the Gateway drops, parseUpdate ignores too", () => {
    for (const raw of corpus) {
      const projected = projectUpdate(raw, OWNER);
      const direct = parseUpdate(raw, OWNER, BOT_ID);
      if (projected.kind === "accepted") expect(parseUpdate(projected.update as unknown as TelegramUpdate, OWNER, BOT_ID), JSON.stringify(raw)).toEqual(direct);
      else expect(direct.kind, JSON.stringify(raw)).toBe("ignored");
    }
    expect(corpus.filter((u) => projectUpdate(u, OWNER).kind === "accepted").length).toBeGreaterThanOrEqual(12);
  });

  it("deterministic fuzz: 5000 generated updates over every field parseUpdate reads", () => {
    let seed = 20261008;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const ids = [OWNER, STRANGER, -OWNER, "777001", 0, BOT_ID, undefined];
    const types = ["private", "group", "supergroup", "channel", undefined, 1];
    const bools = [false, true, undefined, "true"];
    const texts = ["/goal 修正", "/goal priority:critical 修正", "/goal", "/goal priority:low", "/status abcd", "/status", "/tasks", "/cancel", "/cancel abc", "/cancel@OXM_Agent_bot", "/start", "/unknown", "繼續", "  /goal x  ", "", undefined, 5];
    const datas = ["a:0123456789abcdef", "r:0123456789abcdef", "c:0123456789abcdef", "k:0123456789abcdef", "n:0123456789abcdef", "merge:0123456789abcdef", "a:xyz", "", undefined, 7];
    // A valid owner update (message or button), then each field parseUpdate reads is mutated independently.
    const m = <T,>(valid: T, invalid: readonly unknown[]) => (rnd() < 0.12 ? pick(invalid) : valid);
    const owner = () => m({ id: m(OWNER, ids), ...(rnd() < 0.85 ? { is_bot: m(false, bools) } : {}), first_name: "n" }, [null, "x", []]);
    const ownerChat = () => m({ id: m(OWNER, ids), type: m("private", types), title: "t" }, [null, 3]);
    const reply = () => ({
      message_id: m(900, ["x", undefined, 1.5]),
      ...(rnd() < 0.7 ? { chat: ownerChat() } : {}),
      ...(rnd() < 0.7 ? { from: m({ id: m(BOT_ID, ids), is_bot: m(true, bools) }, [null, "x"]) } : {}),
      ...(rnd() < 0.6 ? { text: pick(["通知\nRef: 0123456789abcdef", "Ref: zzz", "plain", 3]) } : {}),
    });
    let accepted = 0;
    for (let i = 0; i < 5000; i++) {
      const raw: Record<string, unknown> = { update_id: i };
      if (rnd() < 0.4)
        raw.callback_query = m(
          { id: m(pick(["q1", "q2"]), ["", 9, undefined]), from: m(owner(), [undefined]), data: m(pick(datas), [undefined, 7, ""]), message: m({ message_id: m(10, ["10", undefined]), chat: m(ownerChat(), [undefined]) }, [undefined, "x"]) },
          ["x", null],
        );
      if (rnd() < 0.85)
        raw.message = m(
          { message_id: m(pick([1, 2, 77]), ["3", undefined, 1.5]), chat: m(ownerChat(), [undefined]), from: m(owner(), [undefined]), text: m(pick(texts), [undefined, 5]), ...(rnd() < 0.4 ? { reply_to_message: m(reply(), ["x", null]) } : {}), entities: [] },
          ["x", null],
        );
      if (rnd() < 0.05) raw.edited_message = raw.message;
      const projected = projectUpdate(raw, OWNER);
      const direct = parseUpdate(raw as TelegramUpdate, OWNER, BOT_ID);
      if (projected.kind === "accepted") {
        accepted++;
        expect(parseUpdate(projected.update as unknown as TelegramUpdate, OWNER, BOT_ID), JSON.stringify(raw)).toEqual(direct);
      } else expect(direct.kind, JSON.stringify(raw)).toBe("ignored");
    }
    expect(accepted).toBeGreaterThan(200);
  });
});
