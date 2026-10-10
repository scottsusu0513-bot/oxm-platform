import { findInternalJargon } from "../executive/communication";
import { describe, expect, it } from "vitest";
import type { IntentPlanner, IntentPlannerInput, GoalReviewer, GoalReviewInput } from "../planning/types";
import { createSimulation, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { createHumanInteractionHarness } from "./fake";
import type { MilestoneNotice, StartApprovalNotice } from "./types";

const ASK = "幫我看一下現在搜尋的邏輯是怎麼跑的";
const CHANGE = "幫我把搜尋 loading 做順一點，手機版一起處理";
const FOLLOW = "剛才那個做到哪了";
const STOP = "剛剛那個先不要做";
const FAIL3: WorkerScript[] = ["validation_failed", "validation_failed", "validation_failed"];

/**
 * Scripted stand-in for the trusted planning layer (the production planner is
 * Claude-backed). Its output is raw, untrusted data validated by the Gateway.
 */
function scriptedPlanner(script: Record<string, (input: IntentPlannerInput) => unknown>): IntentPlanner & { calls: IntentPlannerInput[] } {
  const calls: IntentPlannerInput[] = [];
  return {
    calls,
    async interpret(input) {
      calls.push(structuredClone(input));
      const f = script[input.message];
      if (!f) throw new Error("no script");
      return f(input);
    },
  };
}

const task = (intent: string, extra: Record<string, unknown> = {}) => () => ({
  intent,
  taskId: null,
  title: intent === "investigate_or_answer" ? "說明搜尋邏輯" : "搜尋 loading 體驗",
  interpretedObjective: intent === "investigate_or_answer" ? "Explain how the search flow works today. No files will be changed." : "Make the AI search waiting state feel responsive on desktop and mobile.",
  criteria: intent === "investigate_or_answer" ? ["The explanation covers how a search request flows end to end"] : ["Waiting state gives visible feedback immediately", "Mobile layout does not appear frozen during a long search"],
  clarificationQuestion: "",
  ...extra,
});

const SYNTHESIS = "搜尋流程已依 repository 原始碼確認（Manager 摘要）。";
/** Reviewer that approves every criterion with cited evidence and writes the owner synthesis. */
function approvingReviewer(): GoalReviewer & { calls: GoalReviewInput[] } {
  const calls: GoalReviewInput[] = [];
  return {
    calls,
    async review(input) {
      calls.push(structuredClone(input));
      return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: `evidence for ${c.id}`, reason: "" })), ownerAnswer: SYNTHESIS };
    },
  };
}

function setup(planner: IntentPlanner, opts: { worker?: Record<string, readonly WorkerScript[]>; reviewer?: GoalReviewer; answers?: Record<string, string> } = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  const reviewer = opts.reviewer ?? approvingReviewer();
  const sim = createSimulation({ worker: opts.worker, autoApproveCommits: false, goalReviewer: reviewer, answers: opts.answers });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "n" });
  const say = (key: string, text: string, replyTo: string | null = null) => h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: replyTo, text });
  return { sim, reviewer, say, ...h };
}

describe("natural-language intake (no /goal)", () => {
  it("a 任務：-prefixed Chinese question becomes a formal read-only investigation that answers without mutation or publish", async () => {
    const planner = scriptedPlanner({ [ASK]: task("investigate_or_answer") });
    const { sim, say, service, transport } = setup(planner, { answers: { "n-task-1": "Search goes through server/n-task-1/index.ts; uncertainty: caching not verified." } });
    const r = await say("tg.msg.1", `任務：${ASK}`);
    expect(r.outcome).toBe("submitted");
    expect(r.message).toMatch(/^收到，我會用唯讀方式檢查，不修改任何檔案。查完直接回你。/);
    expect(findInternalJargon(r.message)).toEqual([]);
    await sim.loop.settle();
    const snap = sim.loop.task("n-task-1")!;
    expect(snap.mode).toBe("read_only");
    expect(snap.status).toBe("accepted");
    expect(snap.state).toBe("complete");
    expect(sim.commits).toHaveLength(0);
    expect(sim.remote.calls.filter((c) => /PUSH|CREATE pr/.test(c))).toEqual([]);
    expect(sim.workerCalls[0]).toMatchObject({ requiredValidations: ["typecheck"] });
    await service.observe();
    const answer = transport.sent.find((s) => s.notice.kind === "milestone")!.notice as MilestoneNotice;
    expect(answer.milestone).toBe("answered");
    // The owner gets the Manager synthesis, never the Worker's raw report.
    expect(answer.detail).toContain(SYNTHESIS);
    expect(answer.detail).not.toContain("caching not verified");
    expect(transport.sent.some((s) => s.notice.kind === "commit_publish_approval")).toBe(false);
    expect(planner.calls[0]).toMatchObject({ message: ASK, requireTask: true, contextTaskId: null });
  });

  it("a 任務：-prefixed Chinese change request becomes a mutation task that ends in commit/publish approval", async () => {
    const planner = scriptedPlanner({ [CHANGE]: task("change_code") });
    const { sim, say, service, transport } = setup(planner);
    const r = await say("tg.msg.2", `任務：${CHANGE}`);
    expect(r.outcome).toBe("submitted");
    expect(r.message).toMatch(/^收到，我會交給 (Claude|Codex) 處理/);
    // Acceptance criteria are internal Manager language; the owner sees the plan, not AC lists.
    expect(r.message).not.toMatch(/AC-\d|驗收條件/);
    expect(findInternalJargon(r.message)).toEqual([]);
    await sim.loop.settle();
    expect(sim.loop.task("n-task-1")).toMatchObject({ mode: "change", status: "needs_human_approval", approvalPhase: "commit_publish" });
    await service.observe();
    expect(transport.sent.map((s) => s.notice.kind)).toEqual(["commit_publish_approval"]);
  });

  it("/goal remains an optional explicit override (requireTask) and still uses the planner", async () => {
    const planner = scriptedPlanner({ [CHANGE]: task("change_code") });
    const { sim, service } = setup(planner);
    const r = await service.submitGoal({ kind: "goal", idempotencyKey: "tg.goal.3", text: CHANGE });
    expect(r.outcome).toBe("submitted");
    expect(planner.calls[0].requireTask).toBe(true);
    await sim.loop.settle();
    expect(sim.loop.tasks()).toHaveLength(1);
  });

  it("a reply to an escalation binds that task as guidance and never reaches the planner", async () => {
    const planner = scriptedPlanner({ [CHANGE]: task("change_code") });
    const { sim, say, service, transport, emitted } = setup(planner, { worker: { "n-task-1": [...FAIL3, "success"] }, reviewer: undefined });
    await say("tg.msg.4", `任務：${CHANGE}`);
    await sim.loop.settle();
    expect(sim.loop.task("n-task-1")!.status).toBe("needs_human_decision");
    await service.observe();
    const escalation = transport.sent.find((s) => s.notice.kind === "human_decision")!;
    const r = await say("tg.msg.5", "那就照第二個方案做", escalation.deliveryRef);
    expect(r.outcome).toBe("resumed");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].taskId).toBe("n-task-1");
    expect(planner.calls).toHaveLength(1); // only the original request
    expect(sim.loop.tasks()).toHaveLength(1);
  });

  it("a follow-up reports the existing task instead of creating a new one", async () => {
    const planner = scriptedPlanner({
      [CHANGE]: task("change_code"),
      [FOLLOW]: (input) => ({ intent: "task_follow_up", taskId: input.tasks[0].taskId, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "" }),
    });
    const { sim, say } = setup(planner);
    await say("tg.msg.6", `任務：${CHANGE}`);
    await sim.loop.settle();
    const r = await say("tg.msg.7", FOLLOW);
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("編號：n-task-1");
    expect(sim.loop.tasks()).toHaveLength(1);
  });

  it("'先不要做' goes to the cancel confirmation flow, never an immediate cancel", async () => {
    const planner = scriptedPlanner({
      [CHANGE]: task("change_code"),
      [STOP]: (input) => ({ intent: "cancel_or_pause", taskId: input.tasks[0].taskId, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "" }),
    });
    const { sim, say, transport, cancelCalls } = setup(planner);
    await say("tg.msg.8", `任務：${CHANGE}`);
    await sim.loop.settle();
    const r = await say("tg.msg.9", STOP);
    expect(r.outcome).toBe("confirm_requested");
    expect(cancelCalls).toEqual([]);
    expect(transport.sent.at(-1)!.notice.kind).toBe("cancel_confirmation");
  });

  it("a read-only task that mutates the workspace is blocked and can never reach commit/publish", async () => {
    const planner = scriptedPlanner({ [ASK]: task("investigate_or_answer") });
    const { sim, say, service, transport } = setup(planner, { worker: { "n-task-1": ["mutate_readonly"] } });
    await say("tg.msg.10", `任務：${ASK}`);
    await sim.loop.settle();
    expect(sim.loop.task("n-task-1")).toMatchObject({ status: "blocked", blockingReason: "read-only task modified the workspace" });
    await service.observe();
    expect(transport.sent.some((s) => s.notice.kind === "commit_publish_approval")).toBe(false);
    expect(sim.commits).toHaveLength(0);
  });

  it("planner output and message text cannot set worker, category, branch, scope or risk", async () => {
    const msg = `${CHANGE} worker=claude branch=main risk=green scope=/ category=database`;
    const planner = scriptedPlanner({ [msg]: task("change_code", { worker: "claude", branch: "main", risk: "green", allowedScope: ["/"], category: "database", mode: "read_only" }) });
    const { sim, say, gateway, owner } = setup(planner);
    expect((await say("tg.msg.11", `任務：${msg}`)).outcome).toBe("submitted");
    await sim.loop.settle();
    const snap = sim.loop.task("n-task-1")!;
    expect(snap.mode).toBe("change"); // derived from the intent, not the planner's "mode"
    expect(snap.branch).not.toBe("main");
    expect(snap.expectedPaths).not.toContain("/");
    expect(snap.category).not.toBe("database");
    // The Gateway interpretation request itself has no such fields.
    await expect(
      gateway.interpretOwnerMessage({ authentication: owner.authentication(), request: { idempotencyKey: "x", text: CHANGE, contextTaskId: null, requireTask: false, worker: "codex" } }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("a redelivered message is interpreted once and creates one task", async () => {
    const planner = scriptedPlanner({ [CHANGE]: task("change_code") });
    const { sim, say } = setup(planner);
    await say("tg.msg.12", `任務：${CHANGE}`);
    const again = await setupRedelivery(say);
    expect(again.outcome).toBe("duplicate");
    await sim.loop.settle();
    expect(planner.calls).toHaveLength(1);
    expect(sim.loop.tasks()).toHaveLength(1);
  });

  it("an unknown task id from the planner is never trusted; a clarification changes nothing", async () => {
    const planner = scriptedPlanner({
      [FOLLOW]: () => ({ intent: "task_follow_up", taskId: "invented-task", title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "" }),
      [STOP]: () => ({ intent: "clarify", taskId: null, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "要停止哪一個任務？" }),
    });
    const { sim, say } = setup(planner);
    expect((await say("tg.msg.13", FOLLOW)).message).toMatch(/目前沒有進行中的任務/);
    const c = await say("tg.msg.14", STOP);
    expect(c.message).toContain("要停止哪一個任務？");
    expect(sim.loop.tasks()).toHaveLength(0);
  });
});

async function setupRedelivery(say: (key: string, text: string) => Promise<{ outcome: string }>) {
  return say("tg.msg.12", `任務：${CHANGE}`);
}

describe("red-risk pre-execution approval via the human channel", () => {
  const RED = "幫我直接改 production 資料庫的會員資料";
  const RED_MSG = `${RED} production database write update`;
  const redPlanner = () => scriptedPlanner({ [RED_MSG]: task("change_code", { title: "修正會員資料", interpretedObjective: "Update member records via the production database write path.", criteria: ["Member records show the corrected values"] }) });
  async function redTask() {
    const planner = redPlanner();
    const h = setup(planner);
    // Risk is classified by intake policy from the text, never by the planner.
    expect((await h.say("tg.msg.20", `任務：${RED_MSG}`)).outcome).toBe("submitted");
    return h;
  }

  it("a red task sends a sanitized start approval; owner approval resumes the same task; commit/publish stays separate", async () => {
    const planner = scriptedPlanner({ [`${RED} production database write update`]: task("change_code", { title: "修正會員資料", interpretedObjective: "Update member records via the production database write path.", criteria: ["Member records show the corrected values"] }) });
    const { sim, say, service, transport, approvalEvents } = setup(planner);
    const r = await say("tg.msg.21", `任務：${RED} production database write update`);
    expect(r.outcome).toBe("submitted");
    await sim.loop.settle();
    const snap = sim.loop.task("n-task-1")!;
    expect(snap).toMatchObject({ risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
    await service.observe();
    const start = transport.sent.find((s) => s.notice.kind === "start_approval")!.notice as StartApprovalNotice;
    expect(start.riskReasons.length).toBeGreaterThan(0);
    expect(start.allowedScope.length).toBeGreaterThan(0);
    expect(start.authorizes).toEqual({ executeThisExactContract: true, commit: false, push: false, openPr: false, merge: false, deploy: false, gitPermissionsForWorker: false });
    expect(JSON.stringify(start)).not.toMatch(/\b[0-9a-f]{40}\b|start:[0-9a-f]{64}/);
    expect(sim.workerCalls).toHaveLength(0);

    const ok = await service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${start.ref}.approve`, ref: start.ref, action: "approve" });
    expect(ok.outcome).toBe("approved");
    expect(ok.message).toContain("之後要發布時會另外請你批准");
    expect(ok.message).toContain("不會合併，也不會部署");
    await sim.loop.settle();
    expect(approvalEvents).toEqual([{ taskId: "n-task-1", decision: "approved" }]);
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0].taskId).toBe("n-task-1");
    // Approval of the start never implies commit/publish.
    expect(sim.loop.task("n-task-1")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.commits).toHaveLength(0);
    // The start button is now stale; a duplicate tap is idempotent; it cannot approve the commit/publish request.
    expect((await service.handleAction({ kind: "action", idempotencyKey: `tg.cb.${start.ref}.approve`, ref: start.ref, action: "approve" })).outcome).toBe("duplicate");
    expect((await service.handleAction({ kind: "action", idempotencyKey: "other-tap", ref: start.ref, action: "approve" })).outcome).toBe("stale");
    await sim.loop.settle();
    expect(sim.commits).toHaveLength(0);
    expect(sim.approvals.listByTask("n-task-1").map((a) => a.kind)).toEqual(["start"]);
  });

  it("rejection follows the existing pre-execution rejection (no Worker run)", async () => {
    const h = await redTask();
    await h.sim.loop.settle();
    await h.service.observe();
    const start = h.transport.sent.find((s) => s.notice.kind === "start_approval")!;
    expect(start).toBeTruthy();
    expect((await h.service.handleAction({ kind: "action", idempotencyKey: "rej", ref: start.notice.ref, action: "reject" })).outcome).toBe("rejected");
    await h.sim.loop.settle();
    expect(h.sim.workerCalls).toHaveLength(0);
    expect(h.sim.approvals.listByTask("n-task-1").map((a) => [a.kind, a.status])).toEqual([["start", "rejected"]]);
    expect(h.sim.loop.task("n-task-1")!.status).not.toBe("running");
    // A rejected start can never be turned around by a later tap.
    expect((await h.service.handleAction({ kind: "action", idempotencyKey: "late", ref: start.notice.ref, action: "approve" })).outcome).not.toBe("approved");
    await h.sim.loop.settle();
    expect(h.sim.workerCalls).toHaveLength(0);
  });

  it("the owner session cannot decide any other approval kind (least privilege at the Gateway)", async () => {
    const planner = redPlanner();
    const { gateway, owner } = setup(planner);
    for (const kind of ["merge", "execute_red_action"]) {
      await expect(
        gateway.approveTask({
          authentication: owner.authentication(),
          request: { taskId: "t1", idempotencyKey: `k-${kind}`, approvalRequestId: "approval-x", kind, phase: "post_qa", action: "complete_post_qa", bindingTarget: "a".repeat(40) },
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("natural-language intake — restart", () => {
  it("the interpreted goal, its criteria and the message dedupe survive a restart", async () => {
    const { createAuditCheckpointRepository } = await import("../scheduler/persistence");
    const { createManagerLoop } = await import("../scheduler/loop");
    const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
    let cp = 0;
    const r1 = approvingReviewer();
    const sim = createSimulation({ autoApproveCommits: false, goalReviewer: r1, persistence: createAuditCheckpointRepository({ audit, nextId: () => `cp-${++cp}` }) });
    const planner = scriptedPlanner({ [CHANGE]: task("change_code") });
    const h1 = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, durableGateway: true, idPrefix: "r" });
    expect((await h1.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.90", replyToDeliveryRef: null, text: `任務：${CHANGE}` })).outcome).toBe("submitted");
    await sim.loop.settle();
    const before = sim.loop.task("r-task-1")!;

    sim.ports.leases.release(sim.ports.leases.current("default"));
    const loop2 = createManagerLoop(sim.ports);
    await loop2.resume();
    await loop2.settle();
    const h2 = createHumanInteractionHarness({ loop: loop2, approvals: sim.approvals, audit, now: sim.ports.now, planner, durableGateway: true, idPrefix: "r2" });
    // Redelivered message after restart: no second interpretation, no second task.
    expect((await h2.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.90", replyToDeliveryRef: null, text: `任務：${CHANGE}` })).outcome).toBe("duplicate");
    expect(planner.calls).toHaveLength(1);
    expect(loop2.tasks()).toHaveLength(1);
    const after = loop2.task("r-task-1")!;
    expect(after.mode).toBe(before.mode);
    expect(after.status).toBe("needs_human_approval");
    expect(r1.calls[0].criteria.map((c) => c.text)).toEqual([
      "Waiting state gives visible feedback immediately",
      "Mobile layout does not appear frozen during a long search",
      "Existing behaviour outside the requested change is preserved",
    ]);
  });
});
