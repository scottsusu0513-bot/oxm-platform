import { describe, expect, it } from "vitest";
import type { IntentPlanner, IntentPlannerInput, OwnerNoticeComposer, TrustedTaskState } from "../planning/types";
import { createManagerLoop } from "../scheduler/loop";
import { createAuditCheckpointRepository } from "../scheduler/persistence";
import { createSimulation, sha, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice } from "../telegram/format";
import { parseUpdate } from "../telegram/updates";
import { createHumanInteractionHarness, createRecordingTransport } from "./fake";
import { HUMAN_MANAGER_TEXT_EVENT, HUMAN_TRANSPORT_CONTEXT_EVENT } from "./ledger";
import type { CommitApprovalNotice, MilestoneNotice } from "./types";

/**
 * G1 — Single human-facing voice for follow-ups and stopped tasks.
 *
 * The scripted GPT Manager below writes its owner reply ONLY from the TRUSTED TASK STATE it receives in
 * the interpretation turn (as the real prompt requires). Each message is one Manager call: intent and
 * owner reply together. Templates appear only as the declared, audited fallback.
 */

const BASE = { branch: "agent/manager-voice", sha: sha(0x5151) };
const TITLE = "在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數";
const ACK = "我會在流量柱狀圖下方加上每小時瀏覽人數，完成後先確認數字和圖一致。";
const RESULT = "柱狀圖下方現在會顯示每小時的瀏覽人數，數字和圖表一致。";
const empty = { title: "", interpretedObjective: "", criteria: [] as string[], clarificationQuestion: "", followUpTopics: [] as string[], ownerReply: "" };

/** What a grounded Manager says, built only from the trusted state it was shown. */
function grounded(st: TrustedTaskState, topics: string[]): string {
  const out: string[] = [];
  if (st.outcome === "failed") out.push(st.stopReason === "git_safety" ? "這個任務停下來了：執行時偵測到 Git 狀態異常，為了安全系統自動停止，這次的修改沒有被採用。" : "這個任務沒有完成，紀錄沒有顯示確切原因。");
  if (st.outcome === "completed") out.push(`這個任務已經完成。${st.managerResult ?? ""}`);
  if (st.outcome === "active") out.push("這個任務還在進行中。");
  if (topics.includes("remediation")) out.push("最直接的處理方式是依原本的需求重新做一次，會從最新的程式版本開始。");
  if (topics.includes("retry_eligibility")) out.push(st.retry?.kind === "allowed" ? "可以重新執行，我會依原本的需求建立一筆新任務。" : "目前還不能重新執行。");
  return out.join("");
}

type Script = Record<string, (i: IntentPlannerInput) => unknown>;
function manager(script: Script): IntentPlanner & { calls: IntentPlannerInput[] } {
  const calls: IntentPlannerInput[] = [];
  return {
    calls,
    async interpret(input) {
      calls.push(structuredClone(input));
      const f = script[input.message];
      if (!f) throw new Error(`no script for ${input.message}`);
      return f(input);
    },
  };
}
const change = (i: IntentPlannerInput) => ({
  ...empty,
  intent: "change_code",
  taskId: null,
  title: TITLE,
  interpretedObjective: TITLE,
  criteria: ["管理員在柱狀圖下方看到每小時瀏覽人數"],
  // A Manager that knows the owner was already told "queued" goes straight to substance.
  ownerReply: i.transportContext?.length ? ACK : `收到！${ACK}`,
});
const follow = (topics: string[]) => (i: IntentPlannerInput) => {
  const st = i.taskStates?.find((t) => t.taskId === i.contextTaskId);
  return { ...empty, intent: "task_follow_up", taskId: i.contextTaskId, followUpTopics: topics, ownerReply: st ? grounded(st, topics) : "" };
};
const rerun = (i: IntentPlannerInput) => {
  const st = i.taskStates?.find((t) => t.taskId === i.contextTaskId);
  return { ...empty, intent: "retry_task", taskId: i.contextTaskId, ownerReply: st?.retry?.kind === "allowed" ? "好，我依原本的需求重新做一次，這次從最新的程式版本開始。" : "這次先不重新執行，等條件恢復後再說。" };
};

function composer(): OwnerNoticeComposer & { calls: TrustedTaskState[] } {
  const calls: TrustedTaskState[] = [];
  return {
    calls,
    async compose(input) {
      calls.push(structuredClone(input.state));
      return { ownerReply: grounded(input.state, ["retry_eligibility"]) };
    },
  };
}

function setup(script: Script, opts: { worker?: Record<string, readonly WorkerScript[]>; composer?: OwnerNoticeComposer | null; persistence?: boolean; reviewerSummary?: string; hold?: boolean } = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
  let cp = 0;
  const persistence = opts.persistence ? createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` }) : undefined;
  const sim = createSimulation({
    autoApproveCommits: false,
    worker: opts.worker,
    ...(opts.hold ? { holdWorkers: true } : {}),
    runtimeBaseline: BASE,
    persistence,
    ...(opts.reviewerSummary !== undefined
      ? {
          goalReviewer: {
            async review(input: { criteria: readonly { id: string }[] }) {
              return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "visible in the diff", reason: "" })), constraints: [], ownerAnswer: opts.reviewerSummary };
            },
          },
        }
      : {}),
  });
  const planner = manager({ 任務做柱狀圖: change, ...script });
  const notices = opts.composer === undefined ? composer() : opts.composer;
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "p", durableGateway: true, ...(notices ? { noticeComposer: notices } : {}) });
  let n = 0;
  const say = async (text: string, extra: { transportContext?: ("waking" | "queue_full")[] } = {}) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: `tg.msg.${++n}`, replyToDeliveryRef: null, text, ...extra });
    await sim.loop.settle();
    return r;
  };
  return { audit, sim, planner, notices, say, ...h };
}

async function stoppedTask(script: Script = {}, opts: Parameters<typeof setup>[1] = {}) {
  const x = setup(script, { worker: { "p-task-1": ["git_metadata_changed"] }, ...opts });
  const r = await x.say("任務：任務做柱狀圖");
  expect(r).toMatchObject({ outcome: "submitted", voice: "manager" });
  expect(x.sim.loop.task("p-task-1")).toMatchObject({ state: "failed" });
  return x;
}

describe("failed task follow-ups are answered by the Manager in the same interpretation call", () => {
  it("why did it stop -> Manager wording grounded in the trusted stop reason", async () => {
    const x = await stoppedTask({ 為什麼停了: follow(["reason"]) });
    const r = await x.say("為什麼停了");
    expect(r).toMatchObject({ outcome: "info", taskId: "p-task-1", voice: "manager" });
    expect(r.message).toBe("這個任務停下來了：執行時偵測到 Git 狀態異常，為了安全系統自動停止，這次的修改沒有被採用。");
    // One Manager call for the message; it received the trusted facts (never Worker prose).
    const call = x.planner.calls.find((c) => c.message === "為什麼停了")!;
    expect(call.taskStates?.find((t) => t.taskId === "p-task-1")).toMatchObject({ outcome: "failed", stopReason: "git_safety", retry: { kind: "allowed" } });
    expect(x.planner.calls.filter((c) => c.message === "為什麼停了")).toHaveLength(1);
  });

  it("what should I do -> Manager wording", async () => {
    const x = await stoppedTask({ 那怎麼處理: follow(["remediation"]) });
    const r = await x.say("那怎麼處理");
    expect(r.voice).toBe("manager");
    expect(r.message).toContain("最直接的處理方式是依原本的需求重新做一次");
    expect(r.message).not.toMatch(/原本的任務不會直接恢復/); // the template's wording is not used
  });

  it("can it be re-run -> Manager wording + the structured, deterministic re-run verdict", async () => {
    const x = await stoppedTask({ 可以重跑嗎: follow(["retry_eligibility"]) });
    const r = await x.say("可以重跑嗎");
    expect(r.voice).toBe("manager");
    expect(r.retryEligibility).toMatchObject({ kind: "allowed" });
    expect(r.message.split("\n")[0]).toContain("可以重新執行，我會依原本的需求建立一筆新任務。");
    expect(r.message.split("\n")[1]).toBe("（系統判定：可以重新執行。）");
    expect(x.sim.loop.tasks()).toHaveLength(1); // a question never re-runs anything
  });

  it("re-run request -> the gate decides; the Manager's wording is used because the verdict matches what it was shown", async () => {
    const x = await stoppedTask({ 那重跑: rerun });
    const r = await x.say("那重跑");
    expect(r).toMatchObject({ outcome: "submitted", voice: "manager" });
    expect(r.message.split("\n")[0]).toBe("好，我依原本的需求重新做一次，這次從最新的程式版本開始。");
    expect(r.message).toContain(`新任務：「${TITLE}」`);
    expect(x.sim.loop.tasks()).toHaveLength(2);
  });

  it("a Manager reply whose trusted basis no longer holds is not shown (declared fallback)", async () => {
    const x = setup({ 現在怎樣: follow(["status"]) }, { hold: true });
    await x.say("任務：任務做柱狀圖");
    const key = { kind: "reply" as const, idempotencyKey: "tg.msg.drift", replyToDeliveryRef: null, text: "現在怎樣" };
    const first = await x.service.handleReply(key);
    expect(first).toMatchObject({ voice: "manager", message: "這個任務還在進行中。" });
    // The task moves on; the same message is handled again (redelivery): the stored reply's basis is stale.
    x.sim.releaseWorker("p-task-1");
    await x.sim.loop.settle();
    const again = await x.service.handleReply(key);
    expect(again.voice).toBe("fallback");
    expect(again.message).not.toBe("這個任務還在進行中。");
    expect(x.planner.calls.filter((c) => c.message === "現在怎樣")).toHaveLength(1); // the model is never asked twice
  });
});

describe("successful task follow-up and results", () => {
  it("did it finish -> Manager wording that reuses its own earlier result", async () => {
    const x = setup({ 做完了嗎: follow(["result"]) }, { reviewerSummary: RESULT });
    await x.say("任務：任務做柱狀圖");
    for (let i = 0; i < 2; i++) await x.service.observe();
    const approval = x.transport.sent.find((s) => s.notice.kind === "commit_publish_approval")!.notice as CommitApprovalNotice;
    await x.service.handleAction({ kind: "action", idempotencyKey: "ok", ref: approval.ref, action: "approve" });
    await x.sim.loop.settle();
    await x.sim.send({ type: "qa_updated", taskId: "p-task-1" });
    expect(x.sim.loop.task("p-task-1")!.status).toBe("accepted");
    const r = await x.say("做完了嗎");
    expect(r.voice).toBe("manager");
    expect(r.message).toBe(`這個任務已經完成。${RESULT}`);
  });
});

describe("stopped-task proactive notice", () => {
  it("is the Manager's wording plus trusted facts, composed once and never re-asked", async () => {
    const x = await stoppedTask();
    for (let i = 0; i < 3; i++) await x.service.observe();
    const stopped = x.transport.sent.filter((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "blocked").map((s) => s.notice as MilestoneNotice);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].voice).toBe("manager");
    expect(stopped[0].detail).toBe("這個任務停下來了：執行時偵測到 Git 狀態異常，為了安全系統自動停止，這次的修改沒有被採用。可以重新執行，我會依原本的需求建立一筆新任務。\n（沒有再做任何修改或發布。）");
    expect((x.notices as ReturnType<typeof composer>).calls).toHaveLength(1);
    expect(x.audit.list({ taskId: "human-interaction" }).filter((e) => e.event === HUMAN_MANAGER_TEXT_EVENT)).toHaveLength(1);
  });

  it("Manager unavailable -> declared fallback, sent exactly once, no repeated Manager attempts after delivery", async () => {
    let calls = 0;
    const down: OwnerNoticeComposer = {
      async compose() {
        calls++;
        throw new Error("manager timeout");
      },
    };
    const x = await stoppedTask({}, { composer: down });
    for (let i = 0; i < 3; i++) await x.service.observe();
    const stopped = x.transport.sent.filter((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "blocked").map((s) => s.notice as MilestoneNotice);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].voice).toBe("fallback");
    expect(calls).toBe(1);
    const intents = x.audit.list({ taskId: "human-interaction" }).filter((e) => e.event === "human_notice_intent").map((e) => e.metadata as Record<string, string>);
    expect(intents.filter((m) => m.voice === "fallback")).toHaveLength(1);
  });

  it("Manager interpretation unavailable for a follow-up -> one fallback answer, nothing sent twice", async () => {
    const x = await stoppedTask({ 為什麼停了: () => { throw new Error("manager timeout"); } });
    const r = await x.say("為什麼停了");
    expect(r).toMatchObject({ outcome: "info", voice: "fallback" });
    expect(x.transport.sent.filter((s) => s.notice.kind !== "milestone")).toEqual([]);
  });
});

describe("decision request without a Manager question", () => {
  it("is still the Manager's wording (composed once from the open decision), with the fixed how-to-answer binding", async () => {
    const notices = composer();
    const x = setup({}, { worker: { "p-task-1": ["validation_failed"] }, composer: notices });
    await x.say("任務：任務做柱狀圖");
    expect(x.sim.loop.task("p-task-1")!.status).toBe("needs_human_decision");
    for (let i = 0; i < 3; i++) await x.service.observe();
    const decisions = x.transport.sent.filter((s) => s.notice.kind === "human_decision").map((s) => s.notice);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].voice).toBe("manager");
    expect(notices.calls).toHaveLength(1);
    expect(notices.calls[0].openDecision).toMatchObject({ attempts: expect.any(Number) });
    const text = formatNotice(decisions[0]);
    expect(text.split("\n")[0]).toBe("這個任務還在進行中。目前還不能重新執行。");
    expect(text).toContain("不代表批准發布");
  });
});

describe("restart durability", () => {
  it("restart between the Manager review and completion keeps the Manager's wording (approval and final result)", async () => {
    const first = setup({}, { persistence: true, reviewerSummary: RESULT });
    await first.say("任務：任務做柱狀圖");
    expect(first.sim.loop.task("p-task-1")!.status).toBe("needs_human_approval");
    // Restart: a new Manager loop from the durable checkpoint, a new human-interaction service from the same audit.
    first.sim.ports.leases.release(first.sim.ports.leases.current("default"));
    const loop2 = createManagerLoop(first.sim.ports, { managerMode: "deterministic_fixture" });
    await loop2.resume();
    await loop2.settle();
    const t2 = createRecordingTransport(800);
    const second = createHumanInteractionHarness({ loop: loop2, approvals: first.sim.approvals, audit: first.audit, now: first.sim.ports.now, transport: t2, durableGateway: true, idPrefix: "p2", noticeComposer: composer() });
    await second.service.observe();
    const approval = t2.sent.find((s) => s.notice.kind === "commit_publish_approval")!.notice as CommitApprovalNotice;
    expect(approval).toMatchObject({ voice: "manager", managerSummary: RESULT });
    expect((await second.service.handleAction({ kind: "action", idempotencyKey: "ok", ref: approval.ref, action: "approve" })).outcome).toBe("approved");
    await loop2.settle();
    loop2.post({ type: "qa_updated", taskId: "p-task-1" });
    await loop2.settle();
    for (let i = 0; i < 2; i++) await second.service.observe();
    const done = t2.sent.find((s) => s.notice.kind === "milestone" && (s.notice as MilestoneNotice).milestone === "completed")!.notice as MilestoneNotice;
    expect(done.voice).toBe("manager");
    expect(done.detail.split("\n")[0]).toBe(RESULT);
  });

  it("a stopped-task Manager notice composed before a restart is reused, not re-composed", async () => {
    const x = await stoppedTask();
    // Composed and stored, but the send fails (e.g. crash / transport down).
    x.transport.failNext = 1;
    await x.service.observe();
    const before = (x.notices as ReturnType<typeof composer>).calls.length;
    const again = composer();
    const t3 = createRecordingTransport(900);
    const second = createHumanInteractionHarness({ loop: x.sim.loop, approvals: x.sim.approvals, audit: x.audit, now: x.sim.ports.now, transport: t3, durableGateway: true, idPrefix: "p3", noticeComposer: again });
    await second.service.observe();
    expect(before).toBe(1);
    expect(again.calls).toHaveLength(0);
    const resent = t3.sent.map((s) => s.notice as MilestoneNotice).filter((n) => n.milestone === "blocked");
    expect(resent).toHaveLength(1);
    expect(resent[0]).toMatchObject({ voice: "manager", possibleDuplicate: true });
  });
});

describe("transport status is durable Manager context", () => {
  it("a waking status recorded for the message reaches the Manager; the resumed Manager does not acknowledge receipt again", async () => {
    const x = setup({});
    const r = await x.say("任務：任務做柱狀圖", { transportContext: ["waking"] });
    expect(x.planner.calls[0].transportContext).toEqual(["waking"]);
    expect(r).toMatchObject({ outcome: "submitted", voice: "manager" });
    expect(r.message.split("\n")[0]).toBe(ACK);
    expect(x.audit.list({ taskId: "human-interaction" }).filter((e) => e.event === HUMAN_TRANSPORT_CONTEXT_EVENT).map((e) => e.metadata)).toEqual([
      { idempotencyKey: "tg.msg.1", statuses: "waking", voice: "system_status" },
    ]);
  });

  it("fallback acknowledgement after a waking status also skips the receipt (state-based, not wording-based)", async () => {
    const x = setup({ 任務做柱狀圖: (i) => ({ ...(change(i) as object), ownerReply: "" }) });
    const r = await x.say("任務：任務做柱狀圖", { transportContext: ["waking"] });
    expect(r.voice).toBe("fallback");
    expect(r.message).not.toMatch(/^收到/);
    const plain = setup({ 任務做柱狀圖: (i) => ({ ...(change(i) as object), ownerReply: "" }) });
    expect((await plain.say("任務：任務做柱狀圖")).message).toMatch(/^收到/);
  });

  it("the Telegram parser only accepts allowlisted transport context from the Gateway", () => {
    const base = { update_id: 1, message: { message_id: 5, chat: { id: 7, type: "private" }, from: { id: 7, is_bot: false }, text: "任務：x" } };
    const p = parseUpdate({ ...base, oxm_transport_status: ["waking", "approve", { evil: 1 }, "waking"] }, 7);
    expect(p).toMatchObject({ kind: "reply", inbound: { transportContext: ["waking"] } });
    const none = parseUpdate({ ...base, oxm_transport_status: "waking" }, 7);
    expect(none.kind === "reply" && none.inbound.transportContext).toBeFalsy();
  });
});

describe("healthy Manager runtime: no semantic answer comes from a template", () => {
  it("acknowledgement, follow-ups, re-run and stopped-task notice are all Manager-voiced", async () => {
    const x = await stoppedTask({ 為什麼停了: follow(["reason"]), 那怎麼處理: follow(["remediation"]), 可以重跑嗎: follow(["retry_eligibility"]), 現在怎樣: follow(["status"]), 那重跑: rerun });
    await x.service.observe();
    const results = [await x.say("為什麼停了"), await x.say("那怎麼處理"), await x.say("可以重跑嗎"), await x.say("現在怎樣"), await x.say("那重跑")];
    expect(results.map((r) => r.voice)).toEqual(["manager", "manager", "manager", "manager", "manager"]);
    const semantic = x.transport.sent.map((s) => s.notice).filter((n) => n.kind === "milestone" && ["blocked", "completed", "answered"].includes(n.milestone));
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic.every((n) => n.voice === "manager")).toBe(true);
    const intents = x.audit.list({ taskId: "human-interaction" }).filter((e) => e.event === "human_notice_intent").map((e) => e.metadata as Record<string, string>);
    expect(intents.filter((m) => m.voice === "fallback")).toEqual([]);
  });
});
