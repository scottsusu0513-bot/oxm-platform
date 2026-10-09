import { describe, expect, it } from "vitest";
import { findInternalJargon } from "../executive/communication";
import type { CombinedRepairInput } from "../planning/managerReasoning";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "../planning/types";
import { createSimulation, driveQa } from "../scheduler/fake";
import type { ManagerReasoningPort } from "../scheduler/types";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice } from "../telegram/format";
import { createHumanInteractionHarness } from "./fake";
import type { MilestoneNotice } from "./types";

/**
 * Mixed request: both parts pass on their own, the GPT combined review fails, and the Manager repairs
 * only the necessary part(s) on their own lineage branches, then reviews the whole again — two cycles,
 * then ONE owner decision bound to the same request/group.
 */

const planner: IntentPlanner = {
  async interpret(input) {
    if (input.contextTaskId) return { intent: "human_decision", taskId: input.contextTaskId, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "", riskObservations: [] };
    return {
      intent: "change_code",
      taskId: null,
      title: "認證工廠優先",
      interpretedObjective: "Show verified factories first and give them a highlighted card.",
      criteria: ["Verified factories are clearly shown first"],
      clarificationQuestion: "",
      riskObservations: [],
      workAreas: { programming: true, visual: true },
      programmingObjective: "Rank verified factories first in the search API.",
      visualObjective: "Give verified factories a highlighted card on the search page.",
    };
  },
};

const notAccepted = { verdict: "not_accepted", integrates: false, satisfiesOriginalIntent: false, conflicts: ["UI reads isVerified, API returns verified"], missingPieces: [], ownerSummary: "排序改好了，但畫面讀不到認證欄位。" };
const accepted = { verdict: "accepted", integrates: true, satisfiesOriginalIntent: true, conflicts: [], missingPieces: [], ownerSummary: "認證工廠排在最前面，卡片也標示出來了。" };
const target = (area: "programming" | "visual") => ({
  area,
  repairObjective: area === "visual" ? "The card reads the `verified` field the API returns." : "The API returns the `isVerified` field the card expects.",
  repairInstructions: [area === "visual" ? "Read `verified` instead of `isVerified` in the factory card." : "Expose `isVerified` in the search response."],
  touchesPaths: [],
});
const plan = (areas: ("programming" | "visual")[], over: Record<string, unknown> = {}) => ({
  rootCause: "The two halves disagree on the verified field name.",
  repairStrategy: `align on one field name via ${areas.join("+")}`,
  strategyChanged: false,
  targets: areas.map(target),
  ownerDecisionNeeded: false,
  ownerDecisionQuestion: "",
  ownerOptions: [],
  recommendedOption: "",
  constraintCompliance: [],
  ...over,
});

function setup(reviews: unknown[], diagnoses: (unknown | ((i: CombinedRepairInput) => unknown))[], guidance: unknown[] = []) {
  const reviewCalls: unknown[] = [];
  const diagnoseCalls: CombinedRepairInput[] = [];
  const manager: ManagerReasoningPort = {
    reviewCombined: async (i) => (reviewCalls.push(i), structuredClone(reviews[Math.min(reviewCalls.length - 1, reviews.length - 1)])),
    diagnoseCombined: async (i) => {
      diagnoseCalls.push(structuredClone(i));
      const d = diagnoses[Math.min(diagnoseCalls.length - 1, diagnoses.length - 1)];
      return typeof d === "function" ? (d as (i: CombinedRepairInput) => unknown)(i) : structuredClone(d);
    },
    interpretGuidance: async () => structuredClone(guidance[0]),
  };
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  const constraintReviews: GoalReviewInput[] = [];
  // GPT semantic review: judges goal criteria and verifies every listed owner constraint against the evidence.
  const goalReviewer: GoalReviewer = {
    async review(input) {
      if (input.ownerConstraints?.length) constraintReviews.push(structuredClone(input));
      return {
        criteria: input.criteria.map((c) => ({ id: c.id, status: "satisfied", evidence: "diff shows it", reason: "" })),
        constraints: (input.ownerConstraints ?? []).map((c) => ({ id: c.id, status: "satisfied", evidence: "the diff only changes the card's field name; the API is untouched", reason: "" })),
      };
    },
  };
  const sim = createSimulation({ autoApproveCommits: false, manager, goalReviewer });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "m" });
  // formal=true: a new 「任務：」 request; false: ordinary owner text (e.g. guidance on a pending decision).
  const say = async (key: string, text: string, formal = true) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text: formal ? `任務：${text}` : text });
    await sim.loop.settle();
    return r;
  };
  /** Publishes and QA-passes every task that is waiting for that (as the owner + CI would). */
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const pending = sim.loop.tasks().filter((t) => t.status !== "blocked" && t.status !== "accepted" && (t.approvalPhase === "commit_publish" || t.status === "qa_pending"));
      if (!pending.length) return;
      for (const t of pending) await driveQa(sim, t.taskId);
      await sim.loop.settle();
      await h.service.observe(); // the transport observes state as it changes (as the runtime poller does)
    }
  };
  const milestones = () => h.transport.sent.filter((s) => s.notice.kind === "milestone").map((s) => s.notice as MilestoneNotice);
  return { sim, say, drain, milestones, reviewCalls, diagnoseCalls, constraintReviews, ...h };
}

const ASK = "搜尋結果要讓認證工廠排前面，卡片也要特別標示出來";

describe("combined-review failure enters cross-part repair", () => {
  it("API/UI mismatch -> Codex-only repair on the visual part's own branch/PR, then the whole is accepted", async () => {
    const x = setup([notAccepted, accepted], [plan(["visual"])]);
    await x.say("tg.1", ASK);
    await x.drain();
    const visual = x.sim.loop.task("m-task-2")!;
    const repair = x.sim.loop.task("m-task-2-g1c1")!;
    expect(repair).toBeTruthy();
    expect(x.sim.loop.task("m-task-1-g1c1")).toBeNull();
    expect(repair).toMatchObject({ worker: "codex", workArea: "visual", branch: visual.branch, prNumber: visual.prNumber });
    const call = x.sim.workerCalls.find((c) => c.taskId === "m-task-2-g1c1")!;
    expect(call.kind).toBe("codex");
    expect(call.objective).toContain("CROSS-PART REPAIR (combined review, round 1, cycle 1) of the visual part");
    expect(call.objective).toContain("1) Read `verified` instead of `isVerified` in the factory card.");
    // Only the necessary work reran: no new programming run.
    expect(x.sim.workerCalls.filter((c) => c.kind === "claude").map((c) => c.taskId)).toEqual(["m-task-1"]);
    const lead = x.sim.loop.task("m-task-1")!;
    expect(lead.combinedReview).toMatchObject({ status: "accepted", cycle: 1 });
    expect(x.sim.loop.tasks().every((t) => t.status === "accepted")).toBe(true);
    expect(lead.budget.managerCalls).toMatchObject({ combinedReview: 2, combinedDiagnosis: 1, interpretation: 1 });
    expect(x.diagnoseCalls[0]).toMatchObject({ round: 1, cycle: 1, stagnated: false, conflicts: ["UI reads isVerified, API returns verified"] });
    await x.service.observe();
    const repairing = x.milestones().find((m) => m.milestone === "combined_repairing")!;
    expect(repairing.detail).toContain("我已經安排 Codex 修正畫面部分，修好後會再整體檢查一次。");
    expect(x.milestones().filter((m) => m.milestone === "combined_accepted")).toHaveLength(1);
    for (const m of x.milestones()) expect(findInternalJargon(formatNotice(m))).toEqual([]);
  });

  it("backend contract problem -> Claude-only repair", async () => {
    const x = setup([notAccepted, accepted], [plan(["programming"])]);
    await x.say("tg.1", ASK);
    await x.drain();
    const repair = x.sim.loop.task("m-task-1-g1c1")!;
    expect(repair).toMatchObject({ worker: "claude", workArea: "programming", branch: x.sim.loop.task("m-task-1")!.branch });
    expect(x.sim.loop.task("m-task-2-g1c1")).toBeNull();
    expect(x.sim.loop.task("m-task-1")!.combinedReview?.status).toBe("accepted");
  });

  it("both parts need change -> both repaired, programming first then visual", async () => {
    const x = setup([notAccepted, accepted], [plan(["visual", "programming"])]);
    await x.say("tg.1", ASK);
    await x.drain();
    const order = x.sim.workerCalls.map((c) => c.taskId).filter((id) => id.includes("-g1c1"));
    expect(order).toEqual(["m-task-1-g1c1", "m-task-2-g1c1"]);
    expect(x.sim.loop.task("m-task-2-g1c1")!.dependsOn).toEqual(["m-task-1-g1c1"]);
    expect(x.sim.loop.task("m-task-1")!.combinedReview?.status).toBe("accepted");
  });

  it("two cross-part cycles that do not converge -> ONE owner decision on the same request; guidance resumes the same group", async () => {
    const x = setup(
      [notAccepted, notAccepted, notAccepted, accepted],
      [
        (i: CombinedRepairInput) => plan(["visual"], { repairStrategy: `strategy ${i.round}.${i.cycle}`, strategyChanged: i.stagnated, constraintCompliance: i.ownerConstraints.map((c) => ({ constraintId: c.id, howHonored: "API is the source of truth" })) }),
      ],
      [
        {
          understoodAs: "以 API 為準，畫面配合",
          prohibitedRepairActions: ["change the API response"],
          prohibitedValidations: [],
          requiredEvidence: [],
          preferredFilesOrAreas: [],
          protectedAreas: ["the search API response shape"],
          requiredApproach: "Adapt the card to the API's field names",
          ownerDecisionSelection: "",
          executionRestrictions: [],
        },
      ],
    );
    await x.say("tg.1", ASK);
    await x.drain();
    const lead = x.sim.loop.task("m-task-1")!;
    expect(lead.status).toBe("needs_human_decision");
    expect(lead.combinedReview).toMatchObject({ status: "needs_human_decision", cycle: 2 });
    expect(lead.humanDecisionRequest).toMatchObject({ escalationId: "m-task-1.hd.101", taskId: "m-task-1", branch: lead.branch });
    expect(x.sim.loop.tasks().filter((t) => t.status === "needs_human_decision")).toHaveLength(1);
    await x.service.observe();
    const notices = x.transport.sent.filter((s) => s.notice.kind === "human_decision");
    expect(notices).toHaveLength(1);
    const text = formatNotice(notices[0].notice);
    expect(text).toMatch(/的程式和畫面兩部分合在一起，還沒達到你要的效果。/);
    expect(findInternalJargon(text)).toEqual([]);
    // The owner answers naturally (no Reply needed: exactly one pending decision); it binds to the same group.
    const r = await x.say("tg.2", "以 API 為準，畫面配合調整就好", false);
    expect(r.outcome).toBe("resumed");
    await x.sim.loop.settle();
    const after = x.sim.loop.task("m-task-1")!;
    expect(after.status).not.toBe("needs_human_decision");
    expect(after.combinedReview).toMatchObject({ round: 2 });
    expect(x.sim.loop.task("m-task-2-g2c1")).toBeTruthy();
    const third = x.diagnoseCalls.at(-1)!;
    expect(third).toMatchObject({ round: 2, cycle: 1 });
    expect(third.ownerConstraints[0].summary).toContain("required approach: Adapt the card to the API's field names");
    // No new owner request was created.
    expect(x.sim.loop.tasks().every((t) => t.taskId.startsWith("m-task-1") || t.taskId.startsWith("m-task-2"))).toBe(true);
    await x.drain();
    expect(x.sim.loop.tasks().filter((t) => t.status === "blocked").map((t) => `${t.taskId}: ${t.blockingReason}`)).toEqual([]);
    // The group constraint was verified semantically on the repair run (not taken from the Worker's word).
    expect(x.constraintReviews.some((r) => r.ownerConstraints!.some((c) => c.text.includes("required approach: Adapt the card to the API's field names")))).toBe(true);
    expect(x.sim.loop.task("m-task-2-g2c1")!.guidanceConstraints[0]).toMatchObject({ source: "gpt_manager" });
    expect(x.sim.loop.task("m-task-1")!.combinedReview?.status).toBe("accepted");
    expect(x.sim.loop.tasks().every((t) => t.status === "accepted")).toBe(true);
  });
});
