import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { GoalReviewer, GoalReviewInput, IntentPlanner } from "../planning/types";
import { createInMemoryAuditRepository } from "../store/memory";
import { createSimulation } from "./fake";

/**
 * Replays the live placeholder investigation: a factual READ_ONLY question
 * must be answered from actual repository evidence (file + literal value +
 * variants), never from a typecheck run; and owner guidance must constrain
 * every later repair plan of the same task.
 */

const ASK = "幫我檢查 OXM 首頁目前搜尋框的 placeholder 是什麼，不要修改任何檔案";
const HOME = `export default function Home() {\n  const [q, setQ] = useState("");\n  return (\n    <Input\n      value={q}\n      placeholder="搜尋工廠、產品或製程"\n      onChange={(e) => setQ(e.target.value)}\n    />\n  );\n}\n`;
const REPO = {
  "client/src/pages/Home.tsx": HOME,
  "client/src/pages/Search.tsx": "export function Search() { return <div>results</div>; }\n",
  "server/routers.ts": "export const appRouter = {};\n",
};

const planner: IntentPlanner = {
  async interpret() {
    return {
      intent: "investigate_or_answer",
      taskId: null,
      title: "首頁搜尋框 placeholder",
      interpretedObjective: "Find the homepage search box placeholder text and where it is defined. No files will be changed.",
      criteria: ["The owner learns the exact placeholder text currently shown in the homepage search box"],
      clarificationQuestion: "",
      riskObservations: [],
      workAreas: { programming: true, visual: false },
      programmingObjective: "",
      visualObjective: "",
    };
  },
};

/** Satisfied only when trusted source evidence actually shows the literal (like a careful reviewer). */
function evidenceReviewer(mode: "evidence" | "never"): GoalReviewer & { calls: GoalReviewInput[] } {
  const calls: GoalReviewInput[] = [];
  return {
    calls,
    async review(input) {
      calls.push(input);
      const sources = [...input.citedFiles, ...(input.sourceEvidence ?? [])];
      const shown = mode === "evidence" && sources.some((f) => f.excerpt.includes('placeholder="搜尋工廠、產品或製程"'));
      return {
        criteria: input.criteria.map((c) => ({
          id: c.id,
          status: shown ? "satisfied" : "unsupported",
          evidence: shown ? "client/src/pages/Home.tsx:6 placeholder" : "",
          reason: shown ? "" : "the homepage source was not provided",
        })),
        ownerAnswer: shown ? "首頁搜尋框目前顯示「搜尋工廠、產品或製程」，來源 client/src/pages/Home.tsx:6。" : "",
      };
    },
  };
}

async function start(reviewer: GoalReviewer, repo: Record<string, string> | undefined, answer: string) {
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, goalReviewer: reviewer, ...(repo ? { repoFiles: repo } : {}), answers: { "e-task-1": answer } });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "e" });
  const r = await h.service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${ASK}` });
  await sim.loop.settle();
  return { sim, r, ...h };
}

describe("factual read-only investigation: evidence, not typecheck", () => {
  it("the Manager gathers the actual source file for the reviewer even when the Worker cites nothing", async () => {
    const reviewer = evidenceReviewer("evidence");
    const { sim, service, transport } = await start(reviewer, REPO, "首頁搜尋框目前顯示「搜尋工廠、產品或製程」。");
    // The Worker was told which evidence the Manager requires (from the GOAL, not a generic validation).
    expect(sim.workerCalls[0].objective).toContain("EVIDENCE THE MANAGER REQUIRES (factual_lookup)");
    expect(sim.workerCalls[0].objective).toContain("Quote the exact literal value");
    expect(sim.workerCalls[0].objective).toContain("Start from: Home, search, placeholder");
    const input = reviewer.calls[0];
    expect(input.citedFiles).toEqual([]);
    expect(input.sourceEvidence?.map((f) => f.path)).toContain("client/src/pages/Home.tsx");
    expect(input.sourceEvidence?.find((f) => f.path === "client/src/pages/Home.tsx")!.excerpt).toContain('6:       placeholder="搜尋工廠、產品或製程"');
    expect(input.evidenceRequirements).toEqual(expect.arrayContaining([expect.stringContaining("conditional variants")]));
    // Accepted on evidence; the authoritative workspace stayed unchanged (no commit, push or PR).
    const t = sim.loop.task("e-task-1")!;
    expect(t).toMatchObject({ mode: "read_only", status: "accepted", state: "complete" });
    expect(t.repair.attempt).toBe(0);
    expect(sim.commits).toHaveLength(0);
    expect(sim.remote.calls.filter((c) => /PUSH|CREATE pr/.test(c))).toEqual([]);
    await service.observe();
    const answered = transport.sent.find((s) => s.notice.kind === "milestone")!;
    expect((answered.notice as { detail: string }).detail).toMatch(/^查到了。[\s\S]*這次沒有修改任何檔案/);
  });

  it("a passing typecheck alone can never satisfy a factual criterion; the repair requests evidence instead of typecheck", async () => {
    const reviewer = evidenceReviewer("never");
    // No repository content reachable and an answer that cites no file: only the typecheck passed.
    const { sim } = await start(reviewer, {}, "應該是「搜尋」吧。");
    const t = sim.loop.task("e-task-1")!;
    expect(reviewer.calls).toHaveLength(0); // nothing to review: the Manager does not ask the model to guess
    const first = sim.trustedRecords[0];
    expect(first.validations.every((v) => v.status === "passed")).toBe(true);
    const goal = first.acceptance.find((a) => a.evidenceType === "manager_review")!;
    expect(goal.status).toBe("unknown");
    expect(goal.summary).toMatch(/no repository source evidence/);
    // Manager-guided repair: gather direct evidence; typecheck is explicitly secondary.
    expect(t.repairCycles[0].diagnosis.requiredFix).toMatch(/^Gather the direct repository evidence/);
    expect(t.repairCycles[0].diagnosis.requiredFix).toContain("Validation (typecheck) is secondary and never the evidence for the goal.");
    expect(t.repairCycles[0].diagnosis.evidenceRequests).toEqual(expect.arrayContaining([expect.stringContaining("exact literal value")]));
    expect(sim.workerCalls[1].objective).toContain("evidenceRequired:");
  });
});

describe("owner guidance is a durable constraint on later repair planning", () => {
  it("after the owner rejects typecheck and points at Home.tsx, NO later cycle reruns typecheck as the plan", async () => {
    const reviewer = evidenceReviewer("never");
    const { sim } = await start(reviewer, {}, "應該是「搜尋」吧。");
    let t = sim.loop.task("e-task-1")!;
    expect(t.status).toBe("needs_human_decision");
    expect(t.repairCycles).toHaveLength(2);
    // Before guidance the plan still reruns typecheck (it is a required read-only validation).
    expect(sim.workerCalls[2].objective).toContain("Rerun: typecheck.");
    const req = t.humanDecisionRequest!;
    const guidance = "不要再把 typecheck 當主要驗收，直接讀 Home.tsx 和搜尋元件取得 evidence";
    await sim.send({
      type: "human_decision_submitted",
      taskId: "e-task-1",
      decision: { decisionId: "hd-guide-1", escalationId: req.escalationId, taskId: req.taskId, branch: req.branch, expectedHeadSha: req.expectedHeadSha, kind: "continue_with_guidance", guidance, decidedBy: "owner-1" },
    });
    t = sim.loop.task("e-task-1")!;
    expect(t.guidanceConstraints).toHaveLength(1);
    expect(t.guidanceConstraints[0]).toMatchObject({ decisionId: "hd-guide-1", rejectedValidations: ["typecheck"], wantsDirectEvidence: true });
    expect(t.guidanceConstraints[0].evidenceTargets).toEqual(expect.arrayContaining(["Home.tsx", "Search"]));
    // Round 2 used both of its cycles; EVERY repair objective after the guidance honours it.
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ decisionId: "hd-guide-1", outcome: "accepted" });
    // Round 2 ran both cycles and escalated again (the reviewer never sees the source here).
    expect(t.status).toBe("needs_human_decision");
    const afterGuidance = sim.workerCalls.slice(3);
    expect(afterGuidance.length).toBe(2);
    for (const call of afterGuidance) {
      expect(call.taskId).toBe("e-task-1");
      expect(call.branch).toBe(sim.workerCalls[0].branch);
      expect(call.objective).toContain(`ownerConstraint: Owner guidance (decision hd-guide-1, round 2, still binding): ${guidance}`);
      expect(call.objective).toContain("notRerun (owner rejected; not evidence): typecheck");
      expect(call.objective).toContain("Rerun: none (gather the required evidence instead).");
      expect(call.objective).not.toContain("Rerun: typecheck.");
      expect(call.objective).toContain("Start from: Home.tsx, Search");
    }
    const cycle2 = t.repairCycles.find((c) => c.round === 2 && c.cycle === 2)!;
    expect(cycle2.diagnosis.humanDecision).toBeNull(); // the decision itself is consumed on cycle 1 ...
    expect(cycle2.diagnosis.ownerConstraints?.[0]).toContain("hd-guide-1"); // ... but its constraint persists
    expect(cycle2.diagnosis.deferredValidations).toEqual(["typecheck"]);
    // Guidance is planning input only: still read-only, no commit/publish path, no approval granted.
    expect(t.mode).toBe("read_only");
    expect(sim.commits).toHaveLength(0);
    expect(sim.approvals.listByTask("e-task-1")).toHaveLength(0);
    expect(sim.audit.some((e) => e.event === "human_guidance_constraint_recorded" && e.taskId === "e-task-1")).toBe(true);
  });
});
