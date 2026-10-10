import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { IntentPlanner, IntentPlannerInput } from "../planning/types";
import { acquireInstanceLock } from "../runtimeSupervisor/instanceLock";
import { createSimulation, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import { createTelegramBotClient } from "./client";
import type { TelegramConfig } from "./config";
import { createTelegramControlPlane, createTelegramTransport } from "./controlPlane";
import { createFakeBotApi, FAKE_TOKEN, textUpdate, type FakeBotApi } from "./fake";

/**
 * Human-facing delivery idempotency: one logical response per inbound owner message (identity =
 * the owner's Telegram message, never the response text), durable across restart / re-claim /
 * redelivery; notices (acknowledgement, milestones, final answer) at most once each.
 */

const OWNER = 777001;
const config: TelegramConfig = { botToken: FAKE_TOKEN, ownerChatId: OWNER, expectedBotUsername: "OXM_Agent_bot" };
const empty = { title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "", followUpTopics: [] as string[] };

function planner(script: Record<string, () => unknown>): IntentPlanner & { calls: IntentPlannerInput[] } {
  const calls: IntentPlannerInput[] = [];
  return {
    calls,
    async interpret(input) {
      calls.push(structuredClone(input));
      const f = script[input.message];
      if (!f) throw new Error(`no script for ${input.message}`);
      return f();
    },
  };
}
const SCRIPT = {
  請問現在有卡住的任務嗎: () => ({ ...empty, intent: "status_query", taskId: null }),
  任務們呢: () => ({ ...empty, intent: "status_query", taskId: null }),
  修改首頁: () => ({ ...empty, intent: "change_code", taskId: null, title: "修改首頁", interpretedObjective: "Change the home page", criteria: ["The owner sees the change"] }),
  查首頁文字: () => ({ ...empty, intent: "investigate_or_answer", taskId: null, title: "查首頁文字", interpretedObjective: "Answer the home page text. No files will be changed.", criteria: ["The question is answered"] }),
  為什麼停了: () => ({ ...empty, intent: "task_follow_up", taskId: "boot1-task-1", followUpTopics: ["reason"] }),
};

/** One runtime "boot": ledger + service + control plane over a shared durable audit and Manager loop. */
async function boot(input: { audit: AuditRepository; sim: ReturnType<typeof createSimulation>; api: FakeBotApi; prefix: string; planner: IntentPlanner }) {
  const client = createTelegramBotClient({ token: FAKE_TOKEN, fetch: input.api.fetch });
  const transport = Object.assign(createTelegramTransport(client, OWNER), { sent: [], failNext: 0 });
  const h = createHumanInteractionHarness({ loop: input.sim.loop, approvals: input.sim.approvals, audit: input.audit, now: input.sim.ports.now, transport, planner: input.planner, idPrefix: input.prefix, nextTaskId: (() => { let n = 0; return () => `boot1-task-${++n}`; })() });
  const logs: string[] = [];
  const cp = createTelegramControlPlane({ config, client, service: h.service, ledger: h.ledger, log: (l) => logs.push(l), sleep: async () => {}, now: input.sim.ports.now });
  await cp.start();
  return { ...h, cp, logs };
}

async function world(worker: Record<string, readonly WorkerScript[]> = {}) {
  const api = createFakeBotApi();
  const audit = createInMemoryAuditRepository(() => "2026-10-09T08:00:00.000Z");
  const sim = createSimulation({ worker, autoApproveCommits: false });
  const p = planner(SCRIPT);
  const b = await boot({ audit, sim, api, prefix: "boot1", planner: p });
  const sendText = async (text: string, messageId: number, updateId?: number) => {
    api.updates.push(textUpdate({ chatId: OWNER, text, messageId, ...(updateId !== undefined ? { updateId } : {}) }));
    await b.cp.pollOnce();
    await sim.loop.settle();
  };
  const replies = () => api.sent.map((m) => m.text);
  return { api, audit, sim, p, b, sendText, replies };
}

describe("one logical response per owner message", () => {
  it("17/27. a status question is answered exactly once; the same text for two different messages is two responses", async () => {
    const w = await world();
    await w.sendText("請問現在有卡住的任務嗎", 1);
    expect(w.replies()).toEqual(["目前沒有進行中的任務。"]);
    // A different owner message that happens to produce identical words is answered too (no text dedupe).
    await w.sendText("任務們呢", 2);
    expect(w.replies()).toEqual(["目前沒有進行中的任務。", "目前沒有進行中的任務。"]);
    expect(w.api.sent.map((m) => m.replyTo)).toEqual([1, 2]);
  });

  it("23. the same owner message re-claimed under a new update id (gateway re-claim / redelivery) is not handled or answered again", async () => {
    const w = await world();
    await w.sendText("請問現在有卡住的任務嗎", 7, 900);
    const plannerCalls = w.p.calls.length;
    await w.sendText("請問現在有卡住的任務嗎", 7, 901);
    expect(w.replies()).toHaveLength(1);
    expect(w.p.calls).toHaveLength(plannerCalls); // not even re-interpreted
    expect(w.b.logs).toContain("telegram: update already answered; not handled again");
  });

  it("19/20/26. acknowledgement once, each milestone once, final answer once — across repeated observation rounds and scheduler ticks", async () => {
    const w = await world();
    await w.sendText("查首頁文字", 3);
    expect(w.replies()).toHaveLength(1); // acknowledgement / read-only answer for this message
    for (let i = 0; i < 4; i++) {
      w.sim.loop.post({ type: "scheduler_tick" });
      await w.sim.loop.settle();
      await w.b.service.observe();
      await w.b.cp.retryPendingResponses();
    }
    const counts = new Map<string, number>();
    for (const t of w.replies()) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(Array.from(counts.values()).every((n) => n === 1)).toBe(true);
    // The re-claimed message still adds nothing.
    await w.sendText("查首頁文字", 3, 77_777);
    expect(new Set(w.replies()).size).toBe(w.replies().length);
  });

  it("22/24. restart after a confirmed send (checkpoint + ledger restore): nothing is re-sent, the old message is not re-handled", async () => {
    const w = await world();
    await w.sendText("任務：修改首頁", 4);
    await w.b.service.observe();
    const before = w.replies().length;
    expect(before).toBeGreaterThanOrEqual(1);
    // New process: ledger and control plane rebuilt from the same durable audit.
    const b2 = await boot({ audit: w.audit, sim: w.sim, api: w.api, prefix: "boot2", planner: w.p });
    await b2.cp.retryPendingResponses();
    await b2.service.observe();
    expect(w.replies()).toHaveLength(before);
    // The update is redelivered to the new process (cursor not yet confirmed to the gateway).
    w.api.updates.push(textUpdate({ chatId: OWNER, text: "任務：修改首頁", messageId: 4, updateId: 123_456 }));
    await b2.cp.pollOnce();
    expect(w.replies()).toHaveLength(before);
    expect(w.sim.loop.tasks()).toHaveLength(1);
  });

  it("25. a send that failed before confirmation is retried (bounded) — once delivered, never again; restart keeps the pending one", async () => {
    const w = await world();
    w.api.script.sendMessage = ["network"];
    await w.sendText("請問現在有卡住的任務嗎", 5);
    expect(w.replies()).toHaveLength(0);
    expect(w.b.ledger.pendingResponses().map((r) => r.responseId)).toEqual(["tg.reply.5"]);
    // Crash before the retry: the pending response survives the restart and is sent exactly once.
    const b2 = await boot({ audit: w.audit, sim: w.sim, api: w.api, prefix: "boot2", planner: w.p });
    expect(b2.ledger.pendingResponses()).toHaveLength(1);
    await b2.cp.retryPendingResponses();
    await b2.cp.retryPendingResponses();
    expect(w.replies()).toEqual(["目前沒有進行中的任務。"]);
    expect(w.api.sent[0].replyTo).toBe(5);
    expect(b2.ledger.pendingResponses()).toHaveLength(0);
  });

  it("a response that keeps failing is abandoned after the bounded attempts (no infinite resend loop)", async () => {
    const w = await world();
    w.api.script.sendMessage = ["network", "network", "network", "network"];
    await w.sendText("請問現在有卡住的任務嗎", 6);
    await w.b.cp.retryPendingResponses();
    await w.b.cp.retryPendingResponses();
    await w.b.cp.retryPendingResponses();
    expect(w.b.ledger.response("tg.reply.6")).toMatchObject({ deliveryRef: null, abandoned: true, failures: 3 });
    expect(w.b.ledger.pendingResponses()).toHaveLength(0);
    expect(w.api.calls.filter((c) => c.method === "sendMessage")).toHaveLength(3);
  });

  it("18/28. one follow-up → one message; different inputs with identical output text are never merged", async () => {
    const w = await world({ "boot1-task-1": ["git_metadata_changed"] });
    await w.sendText("任務：修改首頁", 10);
    await w.sendText("為什麼停了", 11);
    await w.sendText("為什麼停了", 12);
    const followUps = w.replies().filter((t) => t.includes("沒有完成"));
    expect(followUps).toHaveLength(2);
    expect(w.api.sent.filter((m) => m.text.includes("沒有完成")).map((m) => m.replyTo)).toEqual([11, 12]);
  });
});

const hasFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasFlock)("single runtime per state directory (root cause of every reply arriving twice)", () => {
  it("a second runtime cannot take the instance lock while the first holds it; it is free again once released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oxm-lock-"));
    const path = join(dir, "runtime-instance.lock");
    try {
      const first = await acquireInstanceLock(path, { waitSeconds: 0 });
      expect(first.ok).toBe(true);
      const second = await acquireInstanceLock(path, { waitSeconds: 0 });
      expect(second).toEqual({ ok: false, code: "held" });
      if (first.ok) first.release();
      let third = await acquireInstanceLock(path, { waitSeconds: 2 });
      expect(third.ok).toBe(true);
      if (third.ok) third.release();
      third = await acquireInstanceLock(path, { waitSeconds: 2 });
      if (third.ok) third.release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unavailable flock fails closed (never runs without single-instance protection)", async () => {
    const missing = (() => {
      throw new Error("spawn flock ENOENT");
    }) as unknown as typeof import("node:child_process").spawn;
    expect(await acquireInstanceLock("/nonexistent/x.lock", { spawn: missing })).toEqual({ ok: false, code: "unavailable" });
  });
});
