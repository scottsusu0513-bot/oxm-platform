import { describe, expect, it } from "vitest";
import type { GuidanceInterpretationInput, RepairDiagnosisInput } from "../planning/managerReasoning";
import { createSimulation, fakeIntake, type SimulationOptions, type WorkerScript } from "./fake";
import type { ManagerReasoningPort } from "./types";
import { createManagerHumanDecisionReader } from "../gateway/integration";

/**
 * GPT Manager owns repair diagnosis and guidance interpretation; deterministic
 * policy gates every output. Plus red-risk handback and non-quota availability.
 */

const plan = (over: Record<string, unknown> = {}) => ({
  rootCause: "The new branch of the handler returns before writing the record, so the test sees no row.",
  whyPreviousAttemptFailed: "",
  missingEvidence: ["The failing test's assertion output"],
  repairStrategy: "Move the early return below the write and cover both branches with a test",
  strategyChanged: false,
  repairObjective: "Every successful request persists exactly one record.",
  repairInstructions: ["Edit server/T/index.ts so the write happens before the early return.", "Add a test for the early-return branch."],
  protectedAreas: ["Keep the public response shape unchanged."],
  requiredEvidence: ["Passing test for the early-return branch"],
  validationPlan: ["tests", "typecheck"],
  touchesPaths: [],
  restartFromScratch: false,
  ownerDecisionNeeded: false,
  ownerDecisionQuestion: "",
  ownerOptions: [],
  recommendedOption: "",
  constraintCompliance: [],
  ...over,
});

function scripted(steps: (unknown | ((i: RepairDiagnosisInput) => unknown))[], guidance: (unknown | ((i: GuidanceInterpretationInput) => unknown))[] = []) {
  const diagnoses: RepairDiagnosisInput[] = [];
  const interpretations: GuidanceInterpretationInput[] = [];
  const port: ManagerReasoningPort = {
    async diagnose(i) {
      diagnoses.push(structuredClone(i));
      const s = steps[Math.min(diagnoses.length - 1, steps.length - 1)];
      if (s instanceof Error) throw s;
      return typeof s === "function" ? (s as (i: RepairDiagnosisInput) => unknown)(i) : structuredClone(s);
    },
    async interpretGuidance(i) {
      interpretations.push(structuredClone(i));
      const s = guidance[Math.min(interpretations.length - 1, guidance.length - 1)];
      if (s instanceof Error) throw s;
      return typeof s === "function" ? (s as (i: GuidanceInterpretationInput) => unknown)(i) : structuredClone(s);
    },
  };
  return { port, diagnoses, interpretations };
}

const sim = (id: string, scripts: WorkerScript[], manager: ManagerReasoningPort, extra: SimulationOptions = {}) => createSimulation({ worker: { [id]: scripts }, manager, autoApproveCommits: false, ...extra });
const withPaths = (id: string, over: Record<string, unknown> = {}) => plan({ touchesPaths: [`server/${id}/index.ts`], repairInstructions: [`Edit server/${id}/index.ts so the write happens before the early return.`, "Add a test for the early-return branch."], ...over });
const decide = (s: ReturnType<typeof createSimulation>, id: string, guidance: string, decisionId = "hd-1") => {
  const req = s.loop.task(id)!.humanDecisionRequest!;
  return s.send({ type: "human_decision_submitted", taskId: id, decision: { decisionId, escalationId: req.escalationId, taskId: id, branch: req.branch, expectedHeadSha: req.expectedHeadSha, kind: "continue_with_guidance", guidance, decidedBy: "owner-1" } });
};

describe("GPT Manager repair diagnosis", () => {
  it("production mode without a GPT Manager fails closed, consumes no repair cycle, and makes no Manager call", async () => {
    const s = createSimulation({
      worker: { prod0: ["validation_failed"] },
      policy: { managerMode: "gpt_required" },
      autoApproveCommits: false,
    });
    await s.create(fakeIntake({ taskId: "prod0" }));
    expect(s.loop.task("prod0")).toMatchObject({
      status: "waiting_infrastructure",
      pendingDiagnosis: true,
      repair: { attempt: 0 },
      repairCycles: [],
      budget: { managerCalls: { repairDiagnosis: 0 }, managerLlmCalls: 0 },
    });
    expect(s.workerCalls).toHaveLength(1);
  });

  it("an explicit deterministic fixture may use the non-GPT repair plan", async () => {
    const s = createSimulation({ worker: { fixture0: ["validation_failed", "success"] }, autoApproveCommits: false });
    await s.create(fakeIntake({ taskId: "fixture0" }));
    expect(s.workerCalls).toHaveLength(2);
    expect(s.loop.task("fixture0")!.repairCycles).toHaveLength(1);
    expect(s.loop.task("fixture0")!.budget.managerCalls.repairDiagnosis).toBe(0);
  });

  it("receives the trusted failure evidence and its validated structured plan drives the repair", async () => {
    const m = scripted([withPaths("g1")]);
    const s = sim("g1", ["validation_failed", "success"], m.port);
    await s.create(fakeIntake({ taskId: "g1" }));
    const input = m.diagnoses[0];
    expect(input).toMatchObject({
      taskId: "g1",
      mode: "change",
      allowedScope: ["server/g1/"],
      requiredValidations: ["tests", "typecheck"],
      worker: { kind: "claude", status: "failure" },
      changedPaths: ["server/g1/index.ts"],
      failure: { failureCode: "validation_failed", failingCheck: "validation:tests" },
      round: 1,
      cycle: 1,
      stagnated: false,
      previousAttempts: [],
    });
    expect(input.validations).toEqual(expect.arrayContaining([{ name: "tests", status: "failed" }]));
    expect(input.protectedAreas.join(" ")).toMatch(/trusted Git layer owns commits/);
    expect(input.headSha).toMatch(/^[0-9a-f]{40}$/);
    const repair = s.workerCalls[1];
    expect(repair.repair).toBe(true);
    expect(repair.objective).toContain("- managerRootCause: The new branch of the handler returns before writing the record");
    expect(repair.objective).toContain("- repairInstructions: 1) Edit server/g1/index.ts so the write happens before the early return.");
    const cycle = s.loop.task("g1")!.repairCycles[0];
    expect(cycle.diagnosis.managerPlan).toMatchObject({ source: "gpt_manager", validationPlan: ["tests", "typecheck"], touchesPaths: ["server/g1/index.ts"] });
    // Only structured fields are stored; no free-form reasoning.
    expect(JSON.stringify(cycle.diagnosis.managerPlan)).not.toMatch(/reasoning|thought/i);
    expect(s.audit.some((e) => e.event === "manager_diagnosis_accepted")).toBe(true);
  });

  it.each([
    ["malformed output", "not a plan"],
    ["model failure", new Error("codex manager timeout")],
    ["scope expansion", withPaths("g2", { touchesPaths: ["server/auth/session.ts"] })],
    ["authority request", withPaths("g2", { repairInstructions: ["Fix it, then git push --force to main."] })],
  ])("fails closed on %s: Manager infrastructure wait, no Worker run, no repair cycle consumed", async (_label, step) => {
    const m = scripted([step, withPaths("g2")]);
    const s = sim("g2", ["validation_failed", "success"], m.port);
    await s.create(fakeIntake({ taskId: "g2" }));
    let t = s.loop.task("g2")!;
    expect(t).toMatchObject({ status: "waiting_infrastructure", pendingDiagnosis: true, repair: { attempt: 0 } });
    expect(t.repairCycles).toHaveLength(0);
    expect(s.workerCalls).toHaveLength(1);
    expect(t.queueReason).toMatch(/GPT Manager diagnosis (unavailable|refused by policy).*No repair cycle consumed/);
    // Retry re-plans the SAME repair; a valid plan now drives it.
    await s.send({ type: "review_retry", taskId: "g2" });
    t = s.loop.task("g2")!;
    expect(t.pendingDiagnosis).toBe(false);
    expect(s.workerCalls).toHaveLength(2);
    expect(t.repairCycles).toHaveLength(1);
  });

  it("deterministic stagnation forces a materially different GPT strategy", async () => {
    const first = withPaths("g3");
    const m = scripted([first, first, withPaths("g3", { strategyChanged: true, repairStrategy: "Rewrite the handler as a single transaction that writes then returns" })]);
    const s = sim("g3", ["validation_failed", "validation_failed", "success"], m.port);
    await s.create(fakeIntake({ taskId: "g3" }));
    expect(m.diagnoses[1]).toMatchObject({ stagnated: true, cycle: 2 });
    expect(m.diagnoses[1].previousAttempts[0]).toMatchObject({ cycle: 1, strategy: first.repairStrategy });
    // The same strategy again is refused (stagnation ignored) -> waits, no second repair yet.
    expect(s.loop.task("g3")).toMatchObject({ status: "waiting_infrastructure", pendingDiagnosis: true, repair: { attempt: 1 } });
    expect(s.audit.find((e) => e.event === "manager_diagnosis_refused")?.metadata).toMatchObject({ queueReason: expect.stringContaining("stagnation_ignored") });
    await s.send({ type: "review_retry", taskId: "g3" });
    expect(s.workerCalls).toHaveLength(3);
    expect(s.workerCalls[2].objective).toContain("Rewrite the handler as a single transaction");
  });

  it("GPT may ask the owner a genuine question early; options travel with the escalation and 'option 2' resolves", async () => {
    const ask = withPaths("g4", { ownerDecisionNeeded: true, ownerDecisionQuestion: "成功時要回傳新紀錄，還是只回傳 OK？", ownerOptions: [{ id: "A", summary: "回傳新紀錄" }, { id: "B", summary: "只回傳 OK，前端再查一次" }], recommendedOption: "A" });
    const m = scripted([ask, (i: RepairDiagnosisInput) => withPaths("g4", { constraintCompliance: i.ownerConstraints.map((c) => ({ constraintId: c.id, howHonored: "follows option B" })) })], [
      (i: GuidanceInterpretationInput) => ({
        understoodAs: "照方案 B：只回傳 OK",
        prohibitedRepairActions: [],
        prohibitedValidations: [],
        requiredEvidence: [],
        preferredFilesOrAreas: [],
        protectedAreas: [],
        requiredApproach: "",
        ownerDecisionSelection: i.ownerOptions[1].id,
        executionRestrictions: [],
      }),
    ]);
    const s = sim("g4", ["validation_failed", "success"], m.port);
    await s.create(fakeIntake({ taskId: "g4" }));
    let t = s.loop.task("g4")!;
    expect(t.status).toBe("needs_human_decision");
    expect(t.repairCycles).toHaveLength(0);
    expect(t.humanEscalation?.ownerDecision).toMatchObject({ options: [{ id: "A" }, { id: "B" }], recommended: "A" });
    await decide(s, "g4", "照你剛才第二個方案");
    expect(m.interpretations[0]).toMatchObject({ guidance: "照你剛才第二個方案", ownerOptions: [{ id: "A", summary: "回傳新紀錄" }, { id: "B", summary: "只回傳 OK，前端再查一次" }] });
    t = s.loop.task("g4")!;
    expect(t.guidanceConstraints[0]).toMatchObject({ source: "gpt_manager", semantic: { ownerDecisionSelection: "B", requiredApproach: "只回傳 OK，前端再查一次" } });
    expect(t.budget.managerCalls).toMatchObject({ repairDiagnosis: m.diagnoses.length, guidanceInterpretation: 1 });
    // The next GPT diagnosis is told the chosen approach as a durable constraint.
    expect(m.diagnoses[1].ownerConstraints[0].summary).toContain("required approach: 只回傳 OK，前端再查一次");
    // The resumed repair carries the owner's choice (later runs also verify it as an owner constraint).
    expect(s.workerCalls.length).toBeGreaterThanOrEqual(2);
    expect(s.workerCalls[1].objective).toContain("ownerConstraint: Owner guidance (decision hd-1, round 2, still binding)");
  });
});

describe("semantic human guidance", () => {
  const sem = {
    understoodAs: "不要再跑 typecheck，先查 Home.tsx",
    prohibitedRepairActions: ["rerun typecheck as the main check"],
    prohibitedValidations: ["typecheck"],
    requiredEvidence: ["Home.tsx source"],
    preferredFilesOrAreas: ["client/src/pages/Home.tsx"],
    protectedAreas: [],
    requiredApproach: "",
    ownerDecisionSelection: "",
    executionRestrictions: [],
  };

  it("「不要再跑 typecheck，先查 Home.tsx」 becomes a durable constraint; a later typecheck-only plan is refused", async () => {
    const typecheckOnly = (i: RepairDiagnosisInput) => withPaths("s1", { strategyChanged: true, repairStrategy: `strategy ${i.round}.${i.cycle}`, validationPlan: ["typecheck"], constraintCompliance: i.ownerConstraints.map((c) => ({ constraintId: c.id, howHonored: "claims to" })) });
    const honest = (i: RepairDiagnosisInput) => withPaths("s1", { strategyChanged: true, repairStrategy: `evidence-first ${i.round}.${i.cycle}`, validationPlan: ["tests"], constraintCompliance: i.ownerConstraints.map((c) => ({ constraintId: c.id, howHonored: "reads Home.tsx first; typecheck is not the main check" })) });
    const pre = (i: RepairDiagnosisInput) => withPaths("s1", { strategyChanged: i.stagnated, repairStrategy: `pre ${i.cycle}` });
    const m = scripted([pre, pre, typecheckOnly, honest], [sem]);
    const s = sim("s1", ["validation_failed", "validation_failed", "validation_failed", "success"], m.port);
    await s.create(fakeIntake({ taskId: "s1" }));
    expect(s.loop.task("s1")!.status).toBe("needs_human_decision");
    await decide(s, "s1", "不要再跑 typecheck，先查 Home.tsx");
    let t = s.loop.task("s1")!;
    expect(t.guidanceConstraints[0]).toMatchObject({ source: "gpt_manager", rejectedValidations: ["typecheck"] });
    expect(t.guidanceConstraints[0].evidenceTargets).toContain("client/src/pages/Home.tsx");
    // The typecheck-only plan breaks the owner's constraint: refused, nothing runs, no cycle consumed.
    expect(t).toMatchObject({ status: "waiting_infrastructure", pendingDiagnosis: true });
    const runs = s.workerCalls.length;
    expect(s.audit.some((e) => e.event === "manager_diagnosis_refused" && /constraint_violation/.test(String((e.metadata as { queueReason?: string }).queueReason)))).toBe(true);
    await s.send({ type: "review_retry", taskId: "s1" });
    t = s.loop.task("s1")!;
    expect(s.workerCalls.length).toBeGreaterThanOrEqual(runs + 1);
    const call = s.workerCalls[runs];
    expect(call.objective).toContain("validationPlan: tests");
    expect(call.objective).not.toContain("Rerun: typecheck");
    expect(call.objective).toContain("not as main check: typecheck");
  });

  it("guidance the Manager cannot interpret is not consumed and enters typed infrastructure waiting", async () => {
    const pre = (i: RepairDiagnosisInput) => withPaths("s2", { strategyChanged: i.stagnated, repairStrategy: `pre ${i.cycle}` });
    const m = scripted([pre], [new Error("timeout")]);
    const s = sim("s2", ["validation_failed"], m.port);
    await s.create(fakeIntake({ taskId: "s2" }));
    await decide(s, "s2", "先不要改 UI，只修 API");
    const t = s.loop.task("s2")!;
    expect(t.status).toBe("waiting_infrastructure");
    expect(t.queueReason).toMatch(/GPT Manager guidance interpretation unavailable/);
    expect(t.guidanceConstraints).toHaveLength(0);
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("manager_unavailable") });
    expect(t.repairCycles).toHaveLength(2);
    expect(t.budget.managerCalls.guidanceInterpretation).toBe(1);
    expect(createManagerHumanDecisionReader(s.loop, () => "owner-1").current("s2")?.request.escalationId).toBe(t.humanDecisionRequest?.escalationId);
  });

  it("production guidance with no interpretation port is not consumed and enters typed infrastructure waiting", async () => {
    const manager: ManagerReasoningPort = {
      diagnose: async (i) => withPaths("prod-guide", {
        repairStrategy: `repair strategy ${i.cycle}`,
        strategyChanged: i.stagnated,
      }),
    };
    const s = createSimulation({
      worker: { "prod-guide": ["validation_failed", "validation_failed", "validation_failed"] },
      manager,
      policy: { managerMode: "gpt_required" },
      autoApproveCommits: false,
    });
    await s.create(fakeIntake({ taskId: "prod-guide" }));
    expect(s.loop.task("prod-guide")!.status).toBe("needs_human_decision");

    await decide(s, "prod-guide", "不要再跑 typecheck，先查 Home.tsx");
    const t = s.loop.task("prod-guide")!;
    expect(t).toMatchObject({
      status: "waiting_infrastructure",
      pendingDiagnosis: false,
      budget: { managerCalls: { repairDiagnosis: 2, guidanceInterpretation: 0 } },
    });
    expect(t.queueReason).toMatch(/GPT Manager guidance interpretation unavailable/);
    expect(t.guidanceConstraints).toEqual([]);
    expect(t.humanDecisionLog.at(-1)).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("guidance was not consumed") });
    expect(t.repairCycles).toHaveLength(2);
    expect(createManagerHumanDecisionReader(s.loop, () => "owner-1").current("prod-guide")?.request.escalationId).toBe(t.humanDecisionRequest?.escalationId);
  });
});

describe("red-risk Claude handback after a Codex quota cover", () => {
  it("red Claude -> quota -> Codex (fresh approval) -> Claude back -> fresh narrowly-scoped approval -> Claude resumes same task/branch/checkpoint", async () => {
    const s = createSimulation({ worker: { r2: ["quota_exhausted", "validation_failed", "success"] }, holdWorkers: true, autoApproveCommits: false });
    await s.create(fakeIntake({ taskId: "r2", category: "backend", actions: [{ kind: "code_edit" }, { kind: "prod_db_write" }] }));
    s.approve("r2", "pre_execution");
    await s.send({ type: "approval_granted", taskId: "r2", phase: "pre_execution" });
    s.releaseWorker("r2");
    await s.loop.settle();
    // Codex takeover of a red task: its own exact approval.
    let t = s.loop.task("r2")!;
    expect(t).toMatchObject({ worker: "codex", approvalPhase: "pre_execution", pendingRetry: { errorType: "worker_continuation" } });
    s.approve("r2", "pre_execution", { bindingShaOrActionId: t.pendingRetry!.approvalBinding });
    await s.send({ type: "approval_granted", taskId: "r2", phase: "pre_execution" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex"]);
    // Claude recovers while Codex is mid-run: nothing switches mid-run.
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    s.releaseWorker("r2");
    await s.loop.settle();
    t = s.loop.task("r2")!;
    // The repair boundary hands back to Claude, which needs a NEW approval of the exact Claude contract.
    expect(t).toMatchObject({ worker: "claude", temporaryCover: false, status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(t.pendingRepair).not.toBeNull();
    const pending = await s.loop.pendingApproval("r2");
    expect(pending?.startEvidence).toMatchObject({ handback: true, repair: true });
    expect(s.workerCalls).toHaveLength(2);
    // The old Codex approval cannot authorize the Claude contract.
    await s.send({ type: "approval_granted", taskId: "r2", phase: "pre_execution" });
    expect(s.workerCalls).toHaveLength(2);
    s.approve("r2", "pre_execution", { bindingShaOrActionId: t.pendingRepair!.approvalBinding });
    await s.send({ type: "approval_granted", taskId: "r2", phase: "pre_execution" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "codex", "claude"]);
    const back = s.workerCalls[2];
    expect(back).toMatchObject({ taskId: "r2", branch: s.workerCalls[0].branch, repair: true });
    expect(back.objective).toContain("WORKER HANDOFF (claude_available_again): codex -> claude");
    s.releaseWorker("r2");
    await s.loop.settle();
  });

  it("a pending Codex approval is re-targeted to Claude when Claude recovers before the owner approves", async () => {
    const s = createSimulation({ worker: { r3: ["quota_exhausted", "success"] }, autoApproveCommits: false });
    await s.create(fakeIntake({ taskId: "r3", category: "backend", actions: [{ kind: "code_edit" }, { kind: "prod_db_write" }] }));
    s.approve("r3", "pre_execution");
    await s.send({ type: "approval_granted", taskId: "r3", phase: "pre_execution" });
    const codexBinding = s.loop.task("r3")!.pendingRetry!.approvalBinding;
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    const t = s.loop.task("r3")!;
    expect(t).toMatchObject({ worker: "claude", status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(t.pendingRetry!.approvalBinding).not.toBe(codexBinding);
    expect((await s.loop.pendingApproval("r3"))?.startEvidence).toMatchObject({ handback: true });
    s.approve("r3", "pre_execution", { bindingShaOrActionId: t.pendingRetry!.approvalBinding });
    await s.send({ type: "approval_granted", taskId: "r3", phase: "pre_execution" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["claude", "claude"]);
  });
});

describe("non-quota Worker availability pauses (never a goal failure)", () => {
  it.each([
    ["authentication", "auth_unavailable", "claude"],
    ["executable", "executable_unavailable", "claude"],
  ] as const)("%s unavailable: paused with progress; resumes the same task on the signal", async (cause, script, worker) => {
    const s = createSimulation({ worker: { a1: [script, "success"] }, autoApproveCommits: false });
    await s.create(fakeIntake({ taskId: "a1" }));
    let t = s.loop.task("a1")!;
    expect(t).toMatchObject({ status: "waiting_worker_availability", repair: { attempt: 0 }, blockingReason: null });
    expect(t.availabilityPause).toMatchObject({ cause, waitingFor: [worker] });
    expect(t.repairCycles).toHaveLength(0);
    await s.send({ type: "worker_availability_changed", worker, status: "available" });
    t = s.loop.task("a1")!;
    expect(s.workerCalls.map((c) => c.kind)).toEqual([worker, worker]);
    expect(s.workerCalls[1]).toMatchObject({ branch: s.workerCalls[0].branch, expectedHeadSha: s.workerCalls[0].expectedHeadSha });
    expect(t.approvalPhase).toBe("commit_publish");
  });

  it("visual executable missing pauses on Codex and never falls back to Claude", async () => {
    const s = createSimulation({ worker: { a2: ["executable_unavailable", "success"] } });
    await s.create(fakeIntake({ taskId: "a2", category: "css", actions: [{ kind: "ui_edit" }] }));
    expect(s.loop.task("a2")!.availabilityPause).toMatchObject({ cause: "executable", waitingFor: ["codex"] });
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    expect(s.workerCalls.map((c) => c.kind)).toEqual(["codex"]);
  });

  it("service unavailable: bounded transient retries, then a pause instead of a block", async () => {
    const s = createSimulation({ worker: { a3: ["service_unavailable", "service_unavailable", "service_unavailable", "success"] }, autoApproveCommits: false });
    await s.create(fakeIntake({ taskId: "a3" }));
    let t = s.loop.task("a3")!;
    expect(s.workerCalls).toHaveLength(3);
    expect(t).toMatchObject({ status: "waiting_worker_availability", blockingReason: null, repair: { attempt: 0 } });
    expect(t.availabilityPause).toMatchObject({ cause: "service" });
    await s.send({ type: "worker_availability_changed", worker: "claude", status: "available" });
    t = s.loop.task("a3")!;
    expect(s.workerCalls).toHaveLength(4);
    expect(t.approvalPhase).toBe("commit_publish");
    expect(t.repairCycles).toHaveLength(0);
  });

  it("only a deliberate cancel terminates a paused task", async () => {
    const s = createSimulation({ worker: { a4: ["auth_unavailable"] } });
    await s.create(fakeIntake({ taskId: "a4" }));
    await s.send({ type: "availability_check", probeAfterMs: 60_000 });
    expect(s.loop.task("a4")!.status).toBe("waiting_worker_availability");
    expect(s.loop.cancel("a4").ok).toBe(true);
    await s.loop.settle();
    expect(s.loop.task("a4")!.state).toBe("cancelled");
  });
});
