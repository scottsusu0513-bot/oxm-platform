import { findInternalJargon } from "../executive/communication";
import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import { createAuditHumanInteractionLedger } from "../humanInteraction/ledger";
import { createSimulation, fakeIntake, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createTelegramBotClient, TelegramApiError } from "./client";
import { readTelegramConfig, type TelegramConfig } from "./config";
import { createTelegramControlPlane, createTelegramTransport, TELEGRAM_CURSOR, TelegramStartupError } from "./controlPlane";
import { callbackUpdate, createFakeBotApi, FAKE_TOKEN, textUpdate, type FakeBotApi } from "./fake";
import { parseCallbackData } from "./format";
import { parseUpdate } from "./updates";
import type { IntentPlanner } from "../planning/types";

const OWNER = 777001;
const STRANGER = 999002;
const FAIL3: WorkerScript[] = ["validation_failed", "validation_failed", "validation_failed"];
const GUIDANCE = "Normalize timestamps to UTC before comparing in the fixture check.";
const config: TelegramConfig = { botToken: FAKE_TOKEN, ownerChatId: OWNER, expectedBotUsername: "OXM_Agent_bot" };

async function plane(input: { escalate?: string[]; commit?: string[]; api?: FakeBotApi; audit?: AuditRepository; planner?: IntentPlanner } = {}) {
  const api = input.api ?? createFakeBotApi();
  const audit = input.audit ?? createInMemoryAuditRepository(() => "2026-10-05T00:00:00.000Z");
  const worker = Object.fromEntries((input.escalate ?? []).map((id) => [id, [...FAIL3, "success"] as WorkerScript[]]));
  const sim = createSimulation({ worker, autoApproveCommits: false });
  for (const id of [...(input.escalate ?? []), ...(input.commit ?? [])]) await sim.create(fakeIntake({ taskId: id }));
  const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
  const transport = createTelegramTransport(client, OWNER);
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, transport: Object.assign(transport, { sent: [], failNext: 0 }), planner: input.planner });
  const logs: string[] = [];
  const cp = createTelegramControlPlane({ config, client, service: h.service, ledger: h.ledger, log: (l) => logs.push(l), sleep: async () => {} });
  await cp.start();
  return { api, audit, sim, client, cp, logs, ...h };
}

describe("telegram config", () => {
  it("fails closed on missing or malformed variables without echoing values", () => {
    expect(readTelegramConfig({})).toEqual({ ok: false, reason: "TELEGRAM_BOT_TOKEN is not set" });
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: FAKE_TOKEN })).toEqual({ ok: false, reason: "TELEGRAM_OWNER_CHAT_ID is not set" });
    const bad = readTelegramConfig({ TELEGRAM_BOT_TOKEN: "not-a-token-value-SECRET" , TELEGRAM_OWNER_CHAT_ID: "1" });
    expect(bad).toEqual({ ok: false, reason: "TELEGRAM_BOT_TOKEN is malformed" });
    expect(JSON.stringify(bad)).not.toContain("SECRET");
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: FAKE_TOKEN, TELEGRAM_OWNER_CHAT_ID: "-100123" }).ok).toBe(false);
    const ok = readTelegramConfig({ TELEGRAM_BOT_TOKEN: FAKE_TOKEN, TELEGRAM_OWNER_CHAT_ID: String(OWNER) }, { expectedBotUsername: "OXM_Agent_bot" });
    expect(ok).toEqual({ ok: true, config });
  });
});

describe("telegram runtime", () => {
  it("an invalid token fails closed at startup without exposing the token", async () => {
    const api = createFakeBotApi({ token: "999:DifferentTokenDifferentTokenDifferent00" });
    const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
    const ledger = createAuditHumanInteractionLedger({ audit: createInMemoryAuditRepository(() => "t"), nextId: () => "x" });
    const cp = createTelegramControlPlane({ config, client, ledger, service: {} as never, log: () => {} });
    const error = await cp.start().catch((e) => e);
    expect(error).toBeInstanceOf(TelegramStartupError);
    expect(error.message).toBe("Telegram bot token rejected");
    expect(JSON.stringify({ m: error.message, s: error.stack })).not.toContain(FAKE_TOKEN.split(":")[1]);
    await expect(cp.pollOnce()).rejects.toThrow(/not started/);
  });

  it("an unexpected bot identity fails closed", async () => {
    const api = createFakeBotApi({ username: "SomeOtherBot" });
    const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
    const ledger = createAuditHumanInteractionLedger({ audit: createInMemoryAuditRepository(() => "t"), nextId: () => "x" });
    const cp = createTelegramControlPlane({ config, client, ledger, service: {} as never, log: () => {} });
    await expect(cp.start()).rejects.toThrow(/identity does not match/);
  });

  it("network errors and malformed responses never leak the token and fail closed", async () => {
    const api = createFakeBotApi();
    const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
    api.script.getUpdates = ["network", { status: 200, body: "<html>" }, { status: 200, body: JSON.stringify({ ok: true, result: [{ nope: 1 }] }) }, { status: 502, body: "bad gateway" }];
    for (const kind of ["transient", "malformed", "malformed", "transient"]) {
      const e = await client.getUpdates({ offset: null, timeoutSeconds: 0 }).catch((x) => x);
      expect(e).toBeInstanceOf(TelegramApiError);
      expect(e.kind).toBe(kind);
      expect(`${e.message} ${e.stack}`).not.toContain(FAKE_TOKEN);
    }
  });

  it("bounds every request with a timeout", async () => {
    const hang: Parameters<typeof createTelegramBotClient>[0]["fetch"] = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: hang, requestTimeoutMs: 20 });
    const e = await client.getMe().catch((x) => x);
    expect(e).toMatchObject({ kind: "transient" });
  });

  it("advances the durable update offset and never reprocesses updates after a restart", async () => {
    const p = await plane({ escalate: ["tg1"] });
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/help", messageId: 1, updateId: 10 }), textUpdate({ chatId: OWNER, text: "/help", messageId: 2, updateId: 11 }));
    expect(await p.cp.pollOnce()).toBe(2);
    expect(p.ledger.cursor(TELEGRAM_CURSOR)).toBe(12);
    expect(p.api.calls.filter((c) => c.method === "getUpdates").at(-1)!.payload.offset).toBeUndefined();
    expect(await p.cp.pollOnce()).toBe(0);
    expect(p.api.calls.filter((c) => c.method === "getUpdates").at(-1)!.payload.offset).toBe(12);

    // Restart over the same audit: an old update re-served by Telegram is skipped.
    const ledger2 = createAuditHumanInteractionLedger({ audit: p.audit, nextId: (() => { let i = 0; return () => `b2-${++i}`; })() });
    expect(ledger2.cursor(TELEGRAM_CURSOR)).toBe(12);
    const cp2 = createTelegramControlPlane({ config, client: p.client, service: p.service, ledger: ledger2, log: () => {}, sleep: async () => {} });
    await cp2.start();
    p.api.script.getUpdates = [{ status: 200, body: JSON.stringify({ ok: true, result: [textUpdate({ chatId: OWNER, text: GUIDANCE, messageId: 3, updateId: 11 })] }) }];
    expect(await cp2.pollOnce()).toBe(0);
    expect(p.emitted).toHaveLength(0);
  });

  it("retries transient polling failures with bounded exponential backoff and stops cleanly", async () => {
    const api = createFakeBotApi();
    const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: api.fetch });
    api.script.getUpdates = Array.from({ length: 12 }, () => "network" as const);
    const ledger = createAuditHumanInteractionLedger({ audit: createInMemoryAuditRepository(() => "t"), nextId: (() => { let i = 0; return () => `r-${++i}`; })() });
    const delays: number[] = [];
    let cp: ReturnType<typeof createTelegramControlPlane>;
    cp = createTelegramControlPlane({
      config,
      client,
      ledger,
      service: { observe: async () => ({ delivered: 0 }), handleReply: async () => ({ outcome: "failed", message: "" }), handleAction: async () => ({ outcome: "failed", message: "" }) },
      log: () => {},
      backoff: { initialMs: 1000, maxMs: 8000 },
      observeIntervalMs: 1,
      sleep: async (ms) => {
        if (ms !== 1) delays.push(ms);
        if (delays.length >= 6) void cp.stop();
        await new Promise((r) => setImmediate(r));
      },
    });
    await cp.start();
    await cp.run();
    expect(delays.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    expect(cp.backoffMs(1, new TelegramApiError("transient", "getUpdates", "rate limited", 30_000))).toBe(30_000);
  });

  it("stops polling (fail closed) when the token is revoked while running", async () => {
    const p = await plane();
    p.api.script.getUpdates = [{ status: 401, body: JSON.stringify({ ok: false, error_code: 401 }) }];
    await expect(p.cp.run()).rejects.toThrow("Telegram bot token rejected");
  });
});

describe("telegram update parsing (untrusted input)", () => {
  it("accepts only private messages and button presses from the owner", () => {
    expect(parseUpdate(textUpdate({ chatId: STRANGER, text: GUIDANCE, messageId: 1 }), OWNER).kind).toBe("ignored");
    expect(parseUpdate(textUpdate({ chatId: -100555, fromId: OWNER, text: GUIDANCE, messageId: 1, chatType: "group" }), OWNER).kind).toBe("ignored");
    expect(parseUpdate(textUpdate({ chatId: OWNER, fromId: STRANGER, text: GUIDANCE, messageId: 1 }), OWNER).kind).toBe("ignored");
    expect(parseUpdate(callbackUpdate({ chatId: OWNER, fromId: STRANGER, data: "hi:0123456789abcdef:a", messageId: 1 }), OWNER).kind).toBe("ignored");
    expect(parseUpdate({ update_id: 1, edited_message: {} }, OWNER).kind).toBe("ignored");
    expect(parseUpdate({ update_id: 1, message: "garbage" }, OWNER).kind).toBe("ignored");
    const r = parseUpdate(textUpdate({ chatId: OWNER, text: GUIDANCE, messageId: 9, replyTo: 1000 }), OWNER);
    expect(r).toMatchObject({ kind: "reply", inbound: { idempotencyKey: "tg.msg.9", replyToDeliveryRef: "1000", text: GUIDANCE } });
  });

  it("callback data is an opaque notice reference; anything else (e.g. merge/deploy) is rejected", () => {
    expect(parseCallbackData("hi:0123456789abcdef:a")).toEqual({ ref: "0123456789abcdef", action: "approve" });
    for (const forged of ["hi:0123456789abcdef:m", "hi:0123456789abcdef:deploy", "merge", "hi:task-1:a", `hi:${"a".repeat(16)}:a:extra`, 42])
      expect(parseCallbackData(forged)).toBeNull();
  });
});

describe("telegram end to end — needs_human_decision", () => {
  it("one notice to the owner; an owner reply resumes the task once; strangers have no effect", async () => {
    const p = await plane({ escalate: ["tg2"] });
    await p.service.observe();
    await p.service.observe();
    expect(p.api.sent).toHaveLength(1);
    const notice = p.api.sent[0];
    expect(notice.chatId).toBe(OWNER);
    // Executive decision request: conclusion, what was tried, blocker, recommendation, what to do.
    expect(notice.text).toMatch(/^「tg2」改完之後，自動檢查還沒有通過。\n我已經讓工程師處理了 2 次/);
    expect(notice.text).toContain("我建議");
    expect(notice.text).toContain("直接傳訊息告訴我你的想法即可");
    expect(notice.text).toContain("不代表批准發布");
    // Internal ids, refs, fingerprints and enum names stay in audit logs.
    expect(findInternalJargon(notice.text)).toEqual([]);
    expect(notice.text).not.toContain("tg2.hd.1");
    expect(notice.text).not.toMatch(/Ref: /);
    expect(notice.text).not.toContain(p.sim.loop.task("tg2")!.humanDecisionRequest!.expectedHeadSha);
    expect(notice.text).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(notice.buttons)).toContain("取消任務");
    expect(p.api.calls.find((c) => c.method === "sendMessage")!.payload).not.toHaveProperty("parse_mode");

    p.api.updates.push(
      textUpdate({ chatId: STRANGER, text: GUIDANCE, messageId: 50, replyTo: notice.messageId }),
      textUpdate({ chatId: OWNER, fromId: STRANGER, text: GUIDANCE, messageId: 51, replyTo: notice.messageId }),
    );
    await p.cp.pollOnce();
    expect(p.emitted).toHaveLength(0);
    expect(p.api.sent).toHaveLength(1); // strangers get no answer at all

    const workerCalls = p.sim.workerCalls.length;
    const reply = textUpdate({ chatId: OWNER, text: GUIDANCE, messageId: 52, replyTo: notice.messageId });
    p.api.updates.push(reply);
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.emitted).toHaveLength(1);
    expect(p.emitted[0].decision).toMatchObject({ taskId: "tg2", escalationId: "tg2.hd.1", guidance: GUIDANCE });
    expect(p.sim.workerCalls.length).toBe(workerCalls + 1);
    expect(p.api.sent.at(-1)!.text).toContain("does NOT approve");

    // Telegram redelivers the same update (e.g. offset lost): no second resume.
    p.api.script.getUpdates = [{ status: 200, body: JSON.stringify({ ok: true, result: [{ ...reply, update_id: reply.update_id + 100 }] }) }];
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.emitted).toHaveLength(1);
    expect(p.sim.workerCalls.length).toBe(workerCalls + 1);
  });

  it("credential-looking guidance is rejected and /cancel as a reply cancels the bound task", async () => {
    const p = await plane({ escalate: ["tg3"] });
    await p.service.observe();
    const notice = p.api.sent[0];
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "token ghp_abcdefghijklmnopqrstuvwxyz012345", messageId: 60, replyTo: notice.messageId }));
    await p.cp.pollOnce();
    expect(p.emitted).toHaveLength(0);
    // Plain-language reason (never the raw internal "looks like a credential" string).
    expect(p.api.sent.at(-1)!.text).toMatch(/password or secret key|密碼或金鑰/);
    expect(p.api.sent.at(-1)!.text).not.toMatch(/looks like a credential/);
    expect(p.api.sent.at(-1)!.text).not.toContain("ghp_");

    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/cancel", messageId: 61, replyTo: notice.messageId }));
    await p.cp.pollOnce();
    expect(p.cancelCalls).toEqual([]); // confirmation first
    const confirm = p.api.sent.at(-1)!;
    expect(confirm.text).toMatch(/^確定要取消「tg3」嗎？/);
    expect(findInternalJargon(confirm.text)).toEqual([]);
    const [[confirmBtn, keepBtn]] = confirm.buttons as { text: string; callback_data: string }[][];
    expect([confirmBtn.text, keepBtn.text]).toEqual(["確認取消", "繼續執行"]);
    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: confirmBtn.callback_data, messageId: confirm.messageId }));
    await p.cp.pollOnce();
    expect(p.cancelCalls).toEqual(["tg3"]);
    expect(p.sim.loop.task("tg3")!.state).toBe("cancelled");
  });
});

describe("telegram end to end — commit/publish approval", () => {
  it("approval buttons reach the existing Approval Gateway once; strangers and duplicates have no effect", async () => {
    const p = await plane({ commit: ["tg4"] });
    await p.service.observe();
    expect(p.api.sent).toHaveLength(1);
    const msg = p.api.sent[0];
    expect(msg.text).toMatch(/^「tg4」已完成，也通過我的檢查。目前尚未發布，等待你批准。/);
    for (const line of ["這次改了 1 個檔案", "自動檢查：全部通過。", "按「批准發布」後，我會建立一次 commit、推送到這個任務的工作分支並開 PR。這個批准不包含合併或部署；自動檢查通過後，我會另外問你要不要部署正式站。"])
      expect(msg.text).toContain(line);
    expect(findInternalJargon(msg.text)).toEqual([]);
    const [[approve, reject]] = msg.buttons as { text: string; callback_data: string }[][];
    expect(approve.text).toBe("批准發布");
    expect(reject.text).toBe("不要發布");

    p.api.updates.push(callbackUpdate({ chatId: OWNER, fromId: STRANGER, data: approve.callback_data, messageId: msg.messageId }));
    await p.cp.pollOnce();
    expect(p.approvalEvents).toHaveLength(0);
    expect(p.api.answered).toHaveLength(0);

    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-1" }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.approvalEvents).toEqual([{ taskId: "tg4", decision: "approved" }]);
    expect(p.sim.commits).toHaveLength(1);
    // ONE owner-facing reply per tap: the button is acknowledged silently (no toast), the chat reply carries the message.
    expect(p.api.answered[0].text).toBeUndefined();
    expect(p.api.sent.filter((m) => m.text.includes("已批准發布「tg4」"))).toHaveLength(1);
    expect(p.api.sent.at(-1)!.text).toContain("自動檢查通過後，我會再問你要不要部署正式站");
    expect(p.api.calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);

    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-2" }));
    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: reject.callback_data, messageId: msg.messageId, id: "cb-3" }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.approvalEvents).toHaveLength(1);
    expect(p.sim.commits).toHaveLength(1);
    expect(p.sim.approvals.listByTask("tg4").map((a) => a.status)).toEqual(["approved"]);
    expect(p.sim.remote.calls.some((c) => /merge/i.test(c))).toBe(false);
  });

  it("a reject button follows the existing rejection path", async () => {
    const p = await plane({ commit: ["tg5"] });
    await p.service.observe();
    const [[, reject]] = p.api.sent[0].buttons as { callback_data: string }[][];
    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: reject.callback_data, messageId: p.api.sent[0].messageId }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.approvalEvents).toEqual([{ taskId: "tg5", decision: "rejected" }]);
    expect(p.sim.commits).toHaveLength(0);
  });
});

describe("telegram end to end — /goal and status commands", () => {
  it("an owner /goal creates one trusted task and acknowledges it; a stranger's /goal does nothing", async () => {
    const p = await plane();
    p.api.updates.push(textUpdate({ chatId: STRANGER, text: "/goal 修正搜尋頁 loading", messageId: 80 }));
    p.api.updates.push(textUpdate({ chatId: OWNER, fromId: STRANGER, text: "/goal 修正搜尋頁 loading", messageId: 81 }));
    await p.cp.pollOnce();
    expect(p.sim.loop.tasks()).toHaveLength(0);
    expect(p.api.sent).toHaveLength(0);

    const goalUpdate = textUpdate({ chatId: OWNER, text: "/goal 修正 OXM 搜尋頁 AI loading 體驗，完成後自行測試", messageId: 82 });
    p.api.updates.push(goalUpdate);
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks().map((t) => t.taskId)).toEqual(["boot1-task-1"]);
    const ack = p.api.sent.at(-1)!;
    expect(ack.replyTo).toBe(82);
    expect(ack.text).toMatch(/^收到，我會交給 (Claude|Codex) 處理(程式修改|畫面設計)，完成後我先檢查結果。\n任務：/);
    expect(findInternalJargon(ack.text)).toEqual([]);
    expect(ack.buttons).toBeNull();

    // Redelivery of the same update (offset lost) does not create a second task.
    p.api.script.getUpdates = [{ status: 200, body: JSON.stringify({ ok: true, result: [{ ...goalUpdate, update_id: goalUpdate.update_id + 50 }] }) }];
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
  });

  it("/goal without a body shows usage; with exactly one pending decision plain text is guidance for it (no Reply needed)", async () => {
    const p = await plane({ escalate: ["tg6"] });
    await p.service.observe();
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/goal", messageId: 90 }));
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/goal priority:high   ", messageId: 91 }));
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "please make the search page faster", messageId: 92 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    const texts = p.api.sent.slice(1).map((m) => m.text);
    expect(texts[0]).toMatch(/^用法：\/goal/);
    expect(texts[1]).toMatch(/^用法：\/goal/);
    // Planner unavailable + exactly one open decision: the ordinary message is guidance for it.
    expect(texts[2]).toMatch(/Guidance received/);
    expect(p.sim.loop.tasks().map((t) => t.taskId)).toEqual(["tg6"]);
    expect(p.emitted).toHaveLength(1);
    expect(p.emitted[0].decision).toMatchObject({ taskId: "tg6", escalationId: "tg6.hd.1" });
  });

  it("a reply to an escalation that looks like a command-free goal stays guidance for that escalation", async () => {
    const p = await plane({ escalate: ["tg7"] });
    await p.service.observe();
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "Build a new search page from scratch", messageId: 95, replyTo: p.api.sent[0].messageId }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.emitted).toHaveLength(1);
    expect(p.emitted[0].taskId).toBe("tg7");
    expect(p.sim.loop.tasks().map((t) => t.taskId)).toEqual(["tg7"]);
  });

  it("/tasks and /status answer with sanitized summaries", async () => {
    const p = await plane({ commit: ["tg8"] });
    p.api.updates.push(textUpdate({ chatId: OWNER, text: "/tasks", messageId: 100 }), textUpdate({ chatId: OWNER, text: "/status tg8", messageId: 101 }), textUpdate({ chatId: OWNER, text: "/status", messageId: 102 }));
    await p.cp.pollOnce();
    const [tasks, status, usage] = p.api.sent.map((m) => m.text);
    expect(tasks).toMatch(/^目前進行中的任務（1）：/);
    expect(status).toMatch(/任務：tg8\n目前進度：任務暫停，正在等待你的決定（請按批准或拒絕）/);
    expect(usage).toMatch(/^用法：\/status/);
    for (const t of [tasks, status]) expect(findInternalJargon(t)).toEqual([]);
    for (const t of [tasks, status]) expect(t).not.toMatch(/\b[0-9a-f]{40}\b|commit-publish:|prompt/i);
  });
});

describe("telegram end to end — natural language and red-risk approval", () => {
  const ASK = "幫我看一下現在搜尋的邏輯是怎麼跑的";
  const RED = "幫我改 production database write update 會員資料";
  const planner: IntentPlanner = {
    async interpret(input) {
      const red = input.message === RED;
      return {
        intent: input.message === ASK ? "investigate_or_answer" : "change_code",
        taskId: null,
        title: red ? "會員資料" : "搜尋邏輯",
        interpretedObjective: red ? "Update member records through the production database write path." : "Explain the current search flow; no files change.",
        criteria: ["The owner gets the outcome they asked for"],
        clarificationQuestion: "",
      };
    },
  };

  it("「任務：」 owner text becomes a task; a stranger's text does nothing", async () => {
    const p = await plane({ planner });
    p.api.updates.push(textUpdate({ chatId: STRANGER, text: `任務：${ASK}`, messageId: 200 }), textUpdate({ chatId: OWNER, text: `任務：${ASK}`, messageId: 201 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()).toHaveLength(1);
    expect(p.sim.loop.tasks()[0].mode).toBe("read_only");
    expect(p.api.sent).toHaveLength(1);
    expect(p.api.sent[0].text).toMatch(/^收到，我會用唯讀方式檢查，不修改任何檔案。查完直接回你。/);
  });

  it("red-risk start approval buttons: owner approves once; a stranger's tap is ignored", async () => {
    const p = await plane({ planner });
    p.api.updates.push(textUpdate({ chatId: OWNER, text: `任務：${RED}`, messageId: 210 }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.loop.tasks()[0]).toMatchObject({ risk: "red", approvalPhase: "pre_execution" });
    await p.service.observe();
    const msg = p.api.sent.at(-1)!;
    expect(msg.text).toMatch(/風險較高，開始執行前需要你批准。/);
    expect(msg.text).toContain("批准只代表允許執行這一次；之後要發布時還會另外請你批准。不會合併，也不會部署。");
    expect(findInternalJargon(msg.text)).toEqual([]);
    const [[approve, reject]] = msg.buttons as { text: string; callback_data: string }[][];
    expect([approve.text, reject.text]).toEqual(["批准執行", "拒絕"]);
    p.api.updates.push(callbackUpdate({ chatId: OWNER, fromId: STRANGER, data: approve.callback_data, messageId: msg.messageId }));
    await p.cp.pollOnce();
    expect(p.sim.workerCalls).toHaveLength(0);
    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-a" }));
    p.api.updates.push(callbackUpdate({ chatId: OWNER, data: approve.callback_data, messageId: msg.messageId, id: "cb-b" }));
    await p.cp.pollOnce();
    await p.sim.loop.settle();
    expect(p.sim.workerCalls).toHaveLength(1);
    expect(p.approvalEvents).toEqual([{ taskId: p.sim.loop.tasks()[0].taskId, decision: "approved" }]);
    expect(p.sim.commits).toHaveLength(0);
  });
});
