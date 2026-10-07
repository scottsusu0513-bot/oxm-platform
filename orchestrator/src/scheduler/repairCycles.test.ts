import { describe, expect, it } from "vitest";
import { buildHumanEscalationReport, diagnoseFailure } from "../manager/diagnosis";
import { fakeEvidence, fakePostCiEvidence, SHA_HEAD } from "../manager/fake";
import { managerStep } from "../manager/lifecycle";
import { advanceRepairCounters } from "../manager/repair";
import type { ManagerDiagnosis, ManagerEvidence } from "../manager/types";
import { validateEvidence } from "../manager/validator";
import { createSimulation, driveQa, fakeIntake } from "./fake";
import { createMemoryCheckpointRepository } from "./persistence";

/**
 * Manager-guided root-cause repair flow:
 *   failure -> Manager diagnosis #1 -> Worker repair #1 -> revalidation ->
 *   failure -> Manager diagnosis #2 (fresh evidence, compared with #1) ->
 *   Worker repair #2 -> revalidation -> failure -> needs_human_decision.
 */

const events = (sim: ReturnType<typeof createSimulation>, taskId: string) => sim.audit.filter((e) => e.taskId === taskId).map((e) => e.event);
const pushesAndPrs = (sim: ReturnType<typeof createSimulation>) => sim.remote.calls.filter((c) => c.startsWith("PUSH") || c.startsWith("CREATE pr"));

const DIAGNOSIS_FIELDS = [
  "failureCode",
  "failingCheck",
  "expected",
  "actual",
  "rootCause",
  "requiredFix",
  "protectedAreas",
  "acceptanceCriteria",
  "evidenceUsed",
  "previous",
] as const;

function expectCompleteDiagnosis(d: ManagerDiagnosis, cycle: number) {
  expect(d.kind).toBe("manager_diagnosis");
  expect(d.cycle).toBe(cycle);
  for (const field of DIAGNOSIS_FIELDS) expect(d, field).toHaveProperty(field);
  for (const text of [d.failureCode, d.failingCheck, d.expected, d.actual, d.rootCause, d.requiredFix]) expect(text.length).toBeGreaterThan(0);
  expect(d.protectedAreas.join(" ")).toMatch(/allowedScope/);
  expect(d.protectedAreas.join(" ")).toMatch(/git add\/commit\/push/);
  expect(d.acceptanceCriteria.length).toBeGreaterThan(0);
  expect(d.evidenceUsed.some((x) => x.startsWith("head:"))).toBe(true);
}

const failingTests = (over: Partial<ManagerEvidence> = {}) =>
  fakeEvidence({
    validations: [
      { name: "tests", requested: true, executed: true, status: "failed", trusted: true, summary: "Search.test.ts: 2 failing" },
      { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
    ],
    ...over,
  });

describe("Manager diagnosis (pure)", () => {
  it("first validation failure produces a structured root-cause diagnosis and repair instruction", () => {
    const s = managerStep({ evidence: failingTests() });
    if (!s.ok || !s.repairRequest) throw new Error("expected a repair");
    const d = s.repairRequest.diagnosis;
    expectCompleteDiagnosis(d, 1);
    expect(d).toMatchObject({ failureCode: "validation_failed", failingCheck: "validation:tests", phase: "local_validation", headSha: SHA_HEAD, previous: null });
    expect(d.expected).toContain("'tests'");
    expect(d.actual).toContain("Search.test.ts: 2 failing");
    expect(d.requiredFix).toContain("tests, typecheck");
    expect(d.evidenceUsed).toEqual(expect.arrayContaining(["validation:tests", "acceptance:AC-1"]));
  });

  it("second failure gets a NEW diagnosis compared against the previous diagnosis and repair outcome", () => {
    const first = managerStep({ evidence: failingTests() });
    if (!first.ok || !first.repairRequest) throw new Error("expected a repair");
    const after = { ...failingTests(), repair: advanceRepairCounters({ attempt: 0, prior: [] }, first.repairRequest) };
    // Cycle 2 refuses to run without the previous diagnosis.
    expect(managerStep({ evidence: after }).ok).toBe(false);
    const second = managerStep({ evidence: after, previousDiagnosis: { diagnosis: first.repairRequest.diagnosis, repairOutcome: "repair #1: worker success; revalidation needs_repair" } });
    if (!second.ok || !second.repairRequest) throw new Error("expected a second repair");
    const d = second.repairRequest.diagnosis;
    expectCompleteDiagnosis(d, 2);
    expect(d).not.toBe(first.repairRequest.diagnosis);
    expect(d.previous).toMatchObject({ cycle: 1, previousFailureCode: "validation_failed", fingerprintChanged: false, failureModeChanged: false, trend: "stagnated" });
    expect(d.previous?.previousRepairOutcome).toContain("repair #1");
    expect(d.rootCause).toContain("Repair #1 did not change the failure mode");
    expect(d.requiredFix).toContain("another approach than repair #1");
    expect(d.evidenceUsed).toContain("diagnosis:1.1");
  });

  it("detects a changed failure mode between cycles", () => {
    const v1 = validateEvidence(failingTests());
    const d1 = diagnoseFailure({ evidence: failingTests(), validation: v1, cycle: 1 });
    if (!d1.ok) throw new Error(d1.reason);
    const shiftedEvidence = fakeEvidence({
      validations: [
        { name: "tests", requested: true, executed: true, status: "passed", trusted: true },
        { name: "typecheck", requested: true, executed: true, status: "failed", trusted: true, summary: "TS2322" },
      ],
      acceptance: [
        { criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" },
        { criterionId: "AC-2", status: "satisfied", evidenceType: "scope", reference: "scope" },
      ],
    });
    const d2 = diagnoseFailure({ evidence: shiftedEvidence, validation: validateEvidence(shiftedEvidence), cycle: 2, previous: { diagnosis: d1.diagnosis, repairOutcome: "worker success" } });
    if (!d2.ok) throw new Error(d2.reason);
    expect(d2.diagnosis.failingCheck).toBe("validation:typecheck");
    expect(d2.diagnosis.previous).toMatchObject({ fingerprintChanged: true, failureModeChanged: true, trend: "shifted", resolvedEvidenceIds: expect.arrayContaining(["validation:tests"]), newEvidenceIds: ["validation:typecheck"] });
  });

  it("CI failure diagnosis is post-PR and requires CI success on the repaired head", () => {
    const base = fakePostCiEvidence();
    const e = { ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "success" as const }, { name: "full-test", outcome: "failed" as const }] } };
    const s = managerStep({ evidence: e });
    if (!s.ok || !s.repairRequest) throw new Error("expected a repair");
    expect(s.repairRequest.diagnosis).toMatchObject({ phase: "post_pr_ci", failureCode: "ci_failed", failingCheck: "ci:full-test" });
    expect(s.repairRequest.diagnosis.acceptanceCriteria).toEqual(expect.arrayContaining(["ci:full-test success on the repaired head"]));
  });

  it("the escalation report carries both diagnoses, both outcomes, the blocker and a decision", () => {
    const first = managerStep({ evidence: failingTests() });
    if (!first.ok || !first.repairRequest) throw new Error("expected a repair");
    const c1 = { round: 1, cycle: 1, diagnosis: first.repairRequest.diagnosis, repairRunId: "r-1", workerResult: { status: "success" as const, errorType: null }, revalidation: { decision: "needs_repair" as const, failureCode: "validation_failed", fingerprint: first.repairRequest.diagnosis.fingerprint } };
    const e1 = { ...failingTests(), repair: advanceRepairCounters({ attempt: 0, prior: [] }, first.repairRequest) };
    const second = managerStep({ evidence: e1, previousDiagnosis: { diagnosis: c1.diagnosis, repairOutcome: "r1" } });
    if (!second.ok || !second.repairRequest) throw new Error("expected a second repair");
    const c2 = { ...c1, cycle: 2, diagnosis: second.repairRequest.diagnosis, repairRunId: "r-2" };
    const e2 = { ...e1, repair: advanceRepairCounters(e1.repair, second.repairRequest) };
    const v = validateEvidence(e2);
    expect(v.decision).toBe("needs_human_decision");
    const report = buildHumanEscalationReport({ evidence: e2, validation: v, cycles: [c1, c2], prNumber: null });
    expect(report).toMatchObject({ state: "needs_human_decision", cyclesCompleted: 2, fingerprintTrend: "stagnated" });
    expect(report.diagnoses.map((d) => d.cycle)).toEqual([1, 2]);
    expect(report.repairOutcomes.map((o) => o.repairRunId)).toEqual(["r-1", "r-2"]);
    expect(report.originalFailure?.failingCheck).toBe("validation:tests");
    expect(report.currentBlocker.failingCheck).toBe("validation:tests");
    expect(report.currentComparison?.trend).toBe("stagnated");
    expect(report.managerRecommendation.length).toBeGreaterThan(0);
    expect(report.humanDecisionRequired).toMatch(/Decide one/);
    expect(report.humanDecisionRequired).toContain("No commit, push, or PR has been made");
  });
});

describe("Manager Loop — Manager-guided repair cycles", () => {
  it("validation failure -> diagnosis #1 sent to the Worker -> repaired result revalidated -> success continues normally", async () => {
    const sim = createSimulation({ worker: { mg1: ["validation_failed", "success"] } });
    await sim.create(fakeIntake({ taskId: "mg1" }));
    let t = sim.loop.task("mg1")!;
    expect(t.repairCycles).toHaveLength(1);
    const [cycle] = t.repairCycles;
    expectCompleteDiagnosis(cycle.diagnosis, 1);
    expect(cycle.diagnosis.failingCheck).toBe("validation:tests");
    // The Worker received the diagnosis in its repair contract.
    const repairCall = sim.workerCalls[1];
    expect(repairCall.repair).toBe(true);
    expect(repairCall.runId).toBe(cycle.repairRunId);
    for (const text of ["Manager diagnosis #1", "failureCode: validation_failed", "failingCheck: validation:tests", `rootCause: ${cycle.diagnosis.rootCause}`, `requiredFix: ${cycle.diagnosis.requiredFix}`, "protectedAreas:", "acceptanceCriteria:", "evidenceUsed:"])
      expect(repairCall.objective).toContain(text);
    // Revalidated by the Manager; accepted results then follow the normal approval/commit/PR path.
    expect(cycle.workerResult).toEqual({ status: "success", errorType: null });
    expect(cycle.revalidation?.decision).toBe("accepted");
    expect(events(sim, "mg1")).toEqual(expect.arrayContaining(["manager_diagnosis_issued", "repair_requested", "repair_completed"]));
    await driveQa(sim, "mg1");
    t = sim.loop.task("mg1")!;
    expect(t).toMatchObject({ status: "accepted", state: "complete", humanEscalation: null });
    expect(sim.workerCalls).toHaveLength(2);
  });

  it("second failure produces a NEW diagnosis with the previous diagnosis/outcome; repair #2 runs; success continues", async () => {
    const sim = createSimulation({ worker: { mg2: ["validation_failed", "failure", "success"] } });
    await sim.create(fakeIntake({ taskId: "mg2" }));
    const t = sim.loop.task("mg2")!;
    expect(t.repairCycles.map((c) => c.cycle)).toEqual([1, 2]);
    const [c1, c2] = t.repairCycles;
    expect(c1.revalidation?.decision).toBe("needs_repair");
    expect(c1.workerResult).toEqual({ status: "failure", errorType: "worker_failure" });
    expectCompleteDiagnosis(c2.diagnosis, 2);
    expect(c2.diagnosis.fingerprint).not.toBe(c1.diagnosis.fingerprint);
    expect(c2.diagnosis.previous).toMatchObject({ cycle: 1, previousFailureCode: c1.diagnosis.failureCode, previousFingerprint: c1.diagnosis.fingerprint, fingerprintChanged: true });
    expect(c2.diagnosis.previous?.previousRepairOutcome).toContain("worker failure/worker_failure");
    expect(sim.workerCalls).toHaveLength(3);
    expect(sim.workerCalls[2].objective).toContain("Manager diagnosis #2");
    expect(sim.workerCalls[2].objective).toContain("previousRepair: #1");
    expect(sim.workerCalls.every((c) => c.branch === sim.workerCalls[0].branch && c.kind === sim.workerCalls[0].kind)).toBe(true);
    await driveQa(sim, "mg2");
    expect(sim.loop.task("mg2")!).toMatchObject({ status: "accepted", repair: { attempt: 2 } });
    expect(sim.loop.task("mg2")!.repairCycles[1].revalidation?.decision).toBe("accepted");
  });

  it("failure after two Manager-guided cycles escalates to needs_human_decision with a full report and no Git side effects", async () => {
    const sim = createSimulation({ worker: { mg3: ["validation_failed"] } });
    await sim.create(fakeIntake({ taskId: "mg3" }));
    const t = sim.loop.task("mg3")!;
    expect(t.status).toBe("needs_human_decision");
    expect(t.state).toBe("running");
    expect(sim.workerCalls).toHaveLength(3);
    const report = t.humanEscalation!;
    expect(report).toMatchObject({ kind: "human_escalation_report", state: "needs_human_decision", taskId: "mg3", cyclesCompleted: 2, fingerprintTrend: "stagnated" });
    expect(report.originalFailure?.failingCheck).toBe("validation:tests");
    expect(report.diagnoses.map((d) => d.cycle)).toEqual([1, 2]);
    expect(report.diagnoses[1].previous?.trend).toBe("stagnated");
    expect(report.repairOutcomes).toHaveLength(2);
    for (const o of report.repairOutcomes) expect(o.workerResult).toBe("failure/validation_incomplete");
    expect(report.repairOutcomes[0].revalidation).toContain("needs_repair (validation_failed)");
    expect(report.repairOutcomes[1].revalidation).toContain("needs_human_decision (validation_failed)");
    expect(report.currentBlocker.failingCheck).toBe("validation:tests");
    expect(report.managerRecommendation).toMatch(/same fingerprint/);
    expect(report.humanDecisionRequired).toMatch(/Decide one/);
    expect(t.escalations.at(-1)).toEqual({ trigger: "repeated_repair_failure", action: "request_human_decision" });
    expect(events(sim, "mg3")).toEqual(expect.arrayContaining(["manager_human_decision_required", "human_decision_requested"]));
    expect(events(sim, "mg3")).not.toContain("repair_budget_exhausted");
    expect(sim.commits).toEqual([]);
    expect(pushesAndPrs(sim)).toEqual([]);
    expect(sim.ports.leases.current("ws-mg3")).toMatchObject({ taskId: "mg3" }); // kept for a resume
    // A human may still cancel the escalated task.
    expect(sim.loop.cancel("mg3")).toMatchObject({ ok: true });
  });

  it("revalidation of cycle 1 is recorded before diagnosis #2 compares against it", async () => {
    const sim = createSimulation({ worker: { mg4: ["validation_failed"] } });
    await sim.create(fakeIntake({ taskId: "mg4" }));
    const [c1, c2] = sim.loop.task("mg4")!.repairCycles;
    expect(c1.revalidation).toMatchObject({ decision: "needs_repair", failureCode: "validation_failed" });
    expect(c2.diagnosis.previous?.previousRepairOutcome).toContain("revalidation needs_repair");
  });
});

describe("Manager Loop — transient and non-repairable failures", () => {
  it("a transient Worker/runtime failure is retried without consuming a Manager-guided cycle", async () => {
    const sim = createSimulation({ worker: { tr1: ["timeout", "success"] } });
    await sim.create(fakeIntake({ taskId: "tr1" }));
    await driveQa(sim, "tr1");
    const t = sim.loop.task("tr1")!;
    expect(t.status).toBe("accepted");
    expect(t.repair.attempt).toBe(0);
    expect(t.repairCycles).toEqual([]);
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls[1].repair).toBe(false);
    expect(t.budget.infrastructureRetries).toBe(1);
    expect(t.escalations[0]).toEqual({ trigger: "infrastructure_failure:timeout", action: "retry_infrastructure" });
    expect(events(sim, "tr1")).toContain("infrastructure_retry_requested");
    expect(events(sim, "tr1")).not.toContain("manager_diagnosis_issued");
  });

  it("a transient failure during a repair cycle re-runs that cycle; the cycle count does not advance", async () => {
    const sim = createSimulation({ worker: { tr2: ["validation_failed", "process_error", "success"] } });
    await sim.create(fakeIntake({ taskId: "tr2" }));
    const t = sim.loop.task("tr2")!;
    expect(t.repair.attempt).toBe(1);
    expect(t.repairCycles).toHaveLength(1);
    expect(t.repairCycles[0].workerResult).toEqual({ status: "success", errorType: null });
    expect(sim.workerCalls).toHaveLength(3);
    expect(sim.workerCalls[2].objective).toContain("Manager diagnosis #1"); // same instruction, not a new cycle
    expect(t.status).toBe("qa_pending");
  });

  it("transient failures beyond the retry budget block as unrecoverable infrastructure, never as a repair", async () => {
    const sim = createSimulation({ worker: { tr3: ["timeout"] } });
    await sim.create(fakeIntake({ taskId: "tr3" }));
    const t = sim.loop.task("tr3")!;
    expect(t.status).toBe("blocked");
    expect(t.repairCycles).toEqual([]);
    expect(sim.workerCalls).toHaveLength(3); // 1 + 2 infrastructure retries
    expect(t.blockingReason).toContain("worker_timeout");
    expect(events(sim, "tr3")).not.toContain("manager_diagnosis_issued");
  });

  it.each(["policy_error", "scope_violation", "git_metadata_changed"] as const)("%s never enters the repair loop", async (script) => {
    const sim = createSimulation({ worker: { [`pv-${script.replace(/_/g, "-")}`]: [script] } });
    const taskId = `pv-${script.replace(/_/g, "-")}`;
    await sim.create(fakeIntake({ taskId }));
    const t = sim.loop.task(taskId)!;
    expect(t.status).toBe("blocked");
    expect(t.repairCycles).toEqual([]);
    expect(t.repair.attempt).toBe(0);
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.commits).toEqual([]);
    expect(pushesAndPrs(sim)).toEqual([]);
  });
});

describe("Manager Loop — post-PR CI uses the same two-cycle Manager-guided repair", () => {
  it("CI fail -> diagnosis -> repair -> human commit approval -> CI rerun -> success", async () => {
    const sim = createSimulation({ ci: { ci1: ["fail", "pass"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "ci1" }));
    sim.approve("ci1", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "ci1", phase: "commit_publish" });
    const firstHead = sim.loop.task("ci1")!.headSha;
    await sim.send({ type: "qa_updated", taskId: "ci1" });
    let t = sim.loop.task("ci1")!;
    expect(t.repairCycles).toHaveLength(1);
    expect(t.repairCycles[0].diagnosis).toMatchObject({ phase: "post_pr_ci", failureCode: "ci_failed", failingCheck: "ci:full-test" });
    expect(sim.workerCalls[1].objective).toContain("failureCode: ci_failed");
    // The repaired result is not pushed until a human approves the new commit.
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish", headSha: firstHead });
    expect(sim.commits).toHaveLength(1);
    sim.approve("ci1", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "ci1", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(2);
    await driveQa(sim, "ci1");
    t = sim.loop.task("ci1")!;
    expect(t).toMatchObject({ status: "accepted", prNumber: 100 });
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE pr"))).toHaveLength(1);
  });

  it("CI fails after two Manager-guided cycles -> needs_human_decision with both CI diagnoses; PR stays open, no further push", async () => {
    const sim = createSimulation({ ci: { ci2: ["fail"] } });
    await sim.create(fakeIntake({ taskId: "ci2" }));
    await driveQa(sim, "ci2", 20);
    const t = sim.loop.task("ci2")!;
    expect(t.status).toBe("needs_human_decision");
    expect(sim.workerCalls).toHaveLength(3);
    const report = t.humanEscalation!;
    expect(report.diagnoses.map((d) => [d.cycle, d.phase, d.failingCheck])).toEqual([
      [1, "post_pr_ci", "ci:full-test"],
      [2, "post_pr_ci", "ci:full-test"],
    ]);
    expect(report.diagnoses[1].previous).toMatchObject({ cycle: 1, trend: "stagnated" });
    expect(report.repairOutcomes).toHaveLength(2);
    expect(report.humanDecisionRequired).toContain(`PR #${t.prNumber} stays open`);
    const pushes = sim.remote.calls.filter((c) => c.startsWith("PUSH"));
    expect(pushes).toHaveLength(3); // initial + one per approved repair; none after escalation
    expect(sim.remote.calls.filter((c) => /merge|DELETE|force/i.test(c))).toEqual([]);
  });
});

describe("Manager Loop — no Git side effect before acceptance + human approval", () => {
  it("a repaired result waits for the commit/publish approval; nothing is committed, pushed, or opened before it", async () => {
    const sim = createSimulation({ worker: { gate1: ["validation_failed", "success"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "gate1" }));
    expect(sim.loop.task("gate1")!).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish", repair: { attempt: 1 } });
    expect(sim.commits).toEqual([]);
    expect(pushesAndPrs(sim)).toEqual([]);
    sim.approve("gate1", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "gate1", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    expect(pushesAndPrs(sim)).toHaveLength(2);
  });

  it("no commit, push, or PR occurs at any point of a two-cycle failure", async () => {
    const sim = createSimulation({ worker: { gate2: ["failure"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "gate2" }));
    expect(sim.loop.task("gate2")!.status).toBe("needs_human_decision");
    expect(sim.commits).toEqual([]);
    expect(pushesAndPrs(sim)).toEqual([]);
    expect(sim.approvals.listByTask("gate2")).toEqual([]);
  });
});

describe("Manager Loop — escalation survives restart", () => {
  it("a needs_human_decision checkpoint resumes as-is: report intact, no worker re-run", async () => {
    const persistence = createMemoryCheckpointRepository();
    const first = createSimulation({ worker: { rs1: ["validation_failed"] }, persistence });
    await first.create(fakeIntake({ taskId: "rs1" }));
    const before = first.loop.task("rs1")!;
    expect(before.status).toBe("needs_human_decision");

    const second = createSimulation({ worker: { rs1: ["success"] }, persistence });
    await second.loop.resume();
    await second.loop.settle();
    const after = second.loop.task("rs1")!;
    expect(after.status).toBe("needs_human_decision");
    expect(after.humanEscalation).toEqual(before.humanEscalation);
    expect(after.repairCycles).toEqual(before.repairCycles);
    expect(second.workerCalls).toEqual([]);
    expect(pushesAndPrs(second)).toEqual([]);
  });
});

describe("Manager Loop — unattended Worker execution", () => {
  it("a Manager-guided repair completes with zero human tool confirmations; only the commit/publish gate involves a human", async () => {
    const sim = createSimulation({ worker: { na1: ["validation_failed", "success"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "na1" }));
    const t = sim.loop.task("na1")!;
    expect(t.budget.workerInteractivePromptsAllowed).toBe(false);
    expect(sim.workerCalls).toHaveLength(2); // initial run + repair ran back to back
    expect(t.repairCycles[0].revalidation?.decision).toBe("accepted");
    // The only human interaction is the orchestrator's typed commit/publish gate.
    expect(t).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(sim.audit.filter((e) => e.taskId === "na1" && /human/.test(e.event)).map((e) => e.event)).toEqual(["human_approval_requested"]);
    expect(sim.approvals.listByTask("na1")).toEqual([]);
    expect(sim.commits).toEqual([]);
    expect(pushesAndPrs(sim)).toEqual([]);
  });

  it("orchestrator human gates are typed loop states, separate from Worker tool permissions", async () => {
    const sim = createSimulation({ worker: { na2: ["validation_failed"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "na2" }));
    // Worker contracts carry no permission/approval channel of their own.
    for (const call of sim.workerCalls) expect(Object.keys(call).sort()).not.toContain("approval");
    const t = sim.loop.task("na2")!;
    expect(t.status).toBe("needs_human_decision"); // a typed orchestrator state, never a Worker prompt
    expect(t.humanDecisionRequest?.escalationId).toBe("na2.hd.1");
    expect(sim.approvals.listByTask("na2")).toEqual([]);
  });
});
