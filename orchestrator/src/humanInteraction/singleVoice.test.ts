import { describe, expect, it } from "vitest";
import { usableManagerText } from "../executive/communication";
import type { ManagerReasoningPort } from "../planning/managerReasoning";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "../planning/types";
import { createSimulation, type SimulationOptions } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice } from "../telegram/format";
import { createHumanInteractionHarness } from "./fake";
import { HUMAN_NOTICE_INTENT_EVENT, HUMAN_NOTICE_SUPPRESSED_EVENT } from "./ledger";
import type { CommitApprovalNotice, HumanDecisionNotice, HumanNotice, MilestoneNotice } from "./types";

/**
 * Single human-facing voice: while the GPT Manager is online, every semantic Owner message
 * (acknowledgement, result, blocker, approval explanation) is the Manager's own text from a turn it
 * already takes (interpretation, goal review, repair diagnosis) — no extra Manager call per event.
 * Templates appear only as the declared fallback when the Manager wrote nothing usable.
 */

const VISUAL = "Make the homepage buttons blue and increase their spacing.";
const CODE = "Fix the bug in the login permission check.";
const ACK = "收到，我會把首頁按鈕改成藍色並加大間距，完成後先檢查畫面再給你看。";
const RESULT = "首頁按鈕現在是藍色，彼此間距也加大了，手機和桌機都一致。";

function planner(objective: string, areas: { programming: boolean; visual: boolean }, title: string, ownerReply: string | null): IntentPlanner {
  return {
    async interpret() {
      return {
        intent: "change_code",
        taskId: null,
        followUpTopics: [],
        title,
        interpretedObjective: objective,
        criteria: ["Works as requested"],
        clarificationQuestion: "",
        riskObservations: [],
        workAreas: areas,
        programmingObjective: "",
        visualObjective: "",
        ...(ownerReply !== null ? { ownerReply } : {}),
      };
    },
  };
}

/** The Manager's goal review: accepts and writes its own result summary in the SAME call. */
function reviewer(summary: string, calls: GoalReviewInput[] = []): GoalReviewer {
  return {
    async review(input) {
      calls.push(input);
      return { criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "visible in the diff", reason: "" })), constraints: [], ownerAnswer: summary };
    },
  };
}

function setup(p: IntentPlanner, opts: SimulationOptions = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, ...opts });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: p, idPrefix: "v" });
  const say = async (key: string, text: string) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text: `任務：${text}` });
    await sim.loop.settle();
    return r;
  };
  const sent = (taskId = "v-task-1") => h.transport.sent.filter((s) => s.notice.taskId === taskId).map((s) => s.notice);
  const intents = () => audit.list({ taskId: "human-interaction" }).filter((e) => e.event === HUMAN_NOTICE_INTENT_EVENT).map((e) => e.metadata as Record<string, string>);
  return { audit, sim, say, sent, intents, ...h };
}

/** Semantic notices must be Manager-voiced online; system status / safety bindings are not semantic. */
const SEMANTIC = (n: HumanNotice) =>
  n.kind === "human_decision" || n.kind === "commit_publish_approval" || (n.kind === "milestone" && ["completed", "answered", "blocked", "combined_accepted", "combined_not_accepted"].includes(n.milestone));

async function approveAndFinish(x: ReturnType<typeof setup>) {
  for (let i = 0; i < 2; i++) await x.service.observe();
  const approval = x.sent().find((n) => n.kind === "commit_publish_approval") as CommitApprovalNotice;
  expect((await x.service.handleAction({ kind: "action", idempotencyKey: "approve-1", ref: approval.ref, action: "approve" })).outcome).toBe("approved");
  await x.sim.loop.settle();
  await x.sim.send({ type: "qa_updated", taskId: "v-task-1" });
  for (let i = 0; i < 3; i++) await x.service.observe();
  return approval;
}

describe("online: semantic content comes from the GPT Manager", () => {
  it("task submit -> one acknowledgement whose wording is the Manager's (source=manager), plus trusted facts only", async () => {
    const x = setup(planner(VISUAL, { programming: false, visual: true }, "首頁按鈕", ACK), { holdWorkers: true });
    const r = await x.say("tg.reply.200", "把首頁按鈕改成藍色");
    expect(r).toMatchObject({ outcome: "submitted", voice: "manager" });
    // The bare receipt is dropped: a transport "queued" status may already have said that.
    expect(r.message.split("\n")[0]).toBe("我會把首頁按鈕改成藍色並加大間距，完成後先檢查畫面再給你看。");
    expect(r.message).toContain("負責：Codex（畫面設計）");
    for (let i = 0; i < 3; i++) await x.service.observe();
    // worker_started stays silent: no second, similar message.
    expect(x.sent()).toEqual([]);
    expect(x.audit.list({ taskId: "human-interaction" }).some((e) => e.event === HUMAN_NOTICE_SUPPRESSED_EVENT)).toBe(true);
    x.sim.releaseWorker("v-task-1");
    await x.sim.loop.settle();
  });

  it("final result and the approval explanation are the Manager reviewer's own summary, from the review call it already makes", async () => {
    const calls: GoalReviewInput[] = [];
    const x = setup(planner(VISUAL, { programming: false, visual: true }, "首頁按鈕", ACK), { goalReviewer: reviewer(RESULT, calls) });
    await x.say("tg.reply.201", "把首頁按鈕改成藍色");
    const approval = await approveAndFinish(x);
    expect(approval).toMatchObject({ voice: "manager", managerSummary: RESULT });
    expect(formatNotice(approval).split("\n")[0]).toBe(RESULT);
    // The authority binding stays deterministic.
    expect(approval.authorizes).toEqual({ commit: true, normalPush: true, openOrReusePr: true, merge: false, deploy: false });
    const done = x.sent().find((n) => n.kind === "milestone" && n.milestone === "completed") as MilestoneNotice;
    expect(done.voice).toBe("manager");
    expect(done.detail.split("\n")[0]).toBe(RESULT);
    expect(done.detail).toContain("要不要合併、部署由你決定。");
    // No extra Manager call per event: exactly one review for the one Worker run.
    expect(calls).toHaveLength(1);
    // Every semantic delivery of this task was Manager-voiced; no template fallback while online.
    expect(x.sent().filter(SEMANTIC).every((n) => n.voice === "manager")).toBe(true);
    expect(x.intents().filter((m) => m.voice === "fallback")).toEqual([]);
  });

  it("blocker -> the Manager's own question, sent once", async () => {
    const manager: ManagerReasoningPort = {
      diagnose: async () => ({
        rootCause: "Two valid behaviours conflict.",
        whyPreviousAttemptFailed: "",
        missingEvidence: [],
        repairStrategy: "Ask the owner",
        strategyChanged: false,
        repairObjective: "",
        repairInstructions: [],
        protectedAreas: [],
        requiredEvidence: [],
        validationPlan: [],
        touchesPaths: [],
        restartFromScratch: false,
        ownerDecisionNeeded: true,
        ownerDecisionQuestion: "登入失敗時，要顯示錯誤訊息，還是直接導回首頁？",
        ownerOptions: [
          { id: "A", summary: "顯示錯誤訊息" },
          { id: "B", summary: "導回首頁" },
        ],
        recommendedOption: "A",
        constraintCompliance: [],
      }),
    };
    const x = setup(planner(CODE, { programming: true, visual: false }, "登入權限", "我會修正登入權限檢查，讓沒有權限的人進不去。"), { manager, worker: { "v-task-1": ["validation_failed"] } });
    await x.say("tg.reply.202", "修正登入權限檢查");
    for (let i = 0; i < 3; i++) await x.service.observe();
    const decisions = x.sent().filter((n) => n.kind === "human_decision") as HumanDecisionNotice[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0].voice).toBe("manager");
    expect(formatNotice(decisions[0])).toContain("登入失敗時，要顯示錯誤訊息，還是直接導回首頁？");
  });
});

describe("fallback: templates only when the Manager produced nothing usable", () => {
  it("no Manager reply / unusable reply -> declared fallback acknowledgement, still exactly one response", async () => {
    for (const reply of [null, "", "I will do it.", "I will update task_state_machine."]) {
      const x = setup(planner(VISUAL, { programming: false, visual: true }, "首頁按鈕", reply), { holdWorkers: true });
      const r = await x.say("tg.reply.300", "把首頁按鈕改成藍色");
      expect(r).toMatchObject({ outcome: "submitted", voice: "fallback" });
      expect(r.message).toMatch(/^收到，我會交給 Codex 處理畫面設計/);
      const again = await x.say("tg.reply.300", "把首頁按鈕改成藍色");
      expect(again.outcome).toBe("duplicate");
      await x.service.observe();
      expect(x.sent()).toEqual([]);
      x.sim.releaseWorker("v-task-1");
      await x.sim.loop.settle();
    }
  });

  it("Manager review without a summary -> fallback result wording, sent once (no double-send)", async () => {
    const x = setup(planner(VISUAL, { programming: false, visual: true }, "首頁按鈕", ACK), { goalReviewer: reviewer("") });
    await x.say("tg.reply.301", "把首頁按鈕改成藍色");
    const approval = await approveAndFinish(x);
    expect(approval.voice).toBe("fallback");
    expect(approval.managerSummary).toBeUndefined();
    const done = x.sent().filter((n) => n.kind === "milestone" && n.milestone === "completed");
    expect(done).toHaveLength(1);
    expect(done[0].voice).toBe("fallback");
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.sent().filter((n) => n.kind === "milestone" && n.milestone === "completed")).toHaveLength(1);
    // The fallback is audited as such.
    expect(x.intents().filter((m) => m.voice === "fallback").map((m) => m.kind).sort()).toEqual(["commit_publish_approval", "milestone"]);
  });

  it("GPT Manager unavailable -> one fallback response; nothing is sent twice", async () => {
    const down: IntentPlanner = { interpret: async () => { throw new Error("manager timeout"); } };
    const x = setup(down, { holdWorkers: true });
    const r = await x.service.submitGoal({ kind: "goal", idempotencyKey: "tg.goal.400", text: "把首頁按鈕改成藍色" });
    expect(r).toMatchObject({ outcome: "submitted", voice: "fallback" });
    expect((await x.service.submitGoal({ kind: "goal", idempotencyKey: "tg.goal.400", text: "把首頁按鈕改成藍色" })).outcome).toBe("duplicate");
    await x.sim.loop.settle();
    for (let i = 0; i < 3; i++) await x.service.observe();
    expect(x.transport.sent).toEqual([]);
    x.sim.releaseWorker(r.taskId!);
    await x.sim.loop.settle();
  });

  it("Manager text that is not in the owner's language or carries internal jargon is never shown", () => {
    expect(usableManagerText("Done.", "zh")).toBeNull();
    expect(usableManagerText("已修好 needs_human_approval 的流程", "zh")).toBeNull();
    expect(usableManagerText("收到。首頁按鈕已改成藍色。", "zh")).toBe("首頁按鈕已改成藍色。");
    expect(usableManagerText("收到", "zh")).toBe("收到");
  });
});

describe("audit stays complete", () => {
  it("every send intent records its voice; silent internal events are recorded as suppressed", async () => {
    const x = setup(planner(VISUAL, { programming: false, visual: true }, "首頁按鈕", ACK), { goalReviewer: reviewer(RESULT), holdWorkers: true });
    await x.say("tg.reply.500", "把首頁按鈕改成藍色");
    await x.service.observe(); // the Worker is running: an internal event, not an owner message
    x.sim.releaseWorker("v-task-1");
    await x.sim.loop.settle();
    await approveAndFinish(x);
    const intents = x.intents();
    expect(intents.length).toBe(x.transport.sent.length);
    expect(intents.every((m) => ["manager", "system_status", "safety_binding", "fallback"].includes(m.voice))).toBe(true);
    const suppressed = x.audit.list({ taskId: "human-interaction" }).filter((e) => e.event === HUMAN_NOTICE_SUPPRESSED_EVENT);
    expect(suppressed.map((e) => (e.metadata as Record<string, string>).event)).toContain("worker_assigned");
    // Internal lifecycle/audit of the run itself is untouched.
    expect(x.sim.audit.length).toBeGreaterThan(0);
  });
});
