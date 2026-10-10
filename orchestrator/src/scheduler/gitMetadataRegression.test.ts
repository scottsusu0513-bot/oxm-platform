import { describe, expect, it } from "vitest";
import { createManagerApprovalRequirementReader } from "../gateway/integration";
import { gitMetadataFact, stopReasonFact, terminalClass } from "../gateway/retry";
import { terminalFollowUp } from "../humanInteraction/followUp";
import type { GatewayTaskStatus } from "../gateway/types";
import { commitApprovalBinding } from "../workers/prompt";
import { createSimulation, fakeIntake } from "./fake";

/**
 * Regression t261010-a61cac. A green frontend task: Codex finished in ~2.5 min, but a background
 * repack (after the trusted fetch) rewrote .git/info/refs and the Codespaces integrations cached
 * branch keys mid-run. The single opaque metadata digest turned that into
 * `worker failure: git_metadata_changed` (red), the Manager never reviewed the change, the evidence
 * recorder failed with an opaque `secondary:evidence_record_failed(Error)`, and the owner could
 * only be told "Git state changed, unknown where".
 *
 * Now: harmless metadata is classified benign, the result reaches the Manager's semantic review,
 * and publication still needs the owner's explicit approval.
 */

const PUBLISH = (sim: ReturnType<typeof createSimulation>) => sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr"));

describe("Git metadata classification through the Manager Loop", () => {
  it("11. frontend task + harmless integration metadata: Manager review accepts, owner approval still required", async () => {
    const sim = createSimulation({ worker: { t261010: ["benign_git_metadata"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "t261010", category: "frontend_styling", expectedPaths: ["client/"] }));
    await sim.loop.settle();
    const t = sim.loop.task("t261010")!;
    expect(t.workerErrorType).toBeNull();
    expect(t.blockingReason).toBeNull();
    expect(t.escalations.map((e) => e.trigger)).not.toContain("worker_git_metadata_changed");
    expect(t.status).toBe("needs_human_approval");
    expect(t.approvalPhase).toBe("commit_publish");
    expect(t.gitMetadata).toMatchObject({ workerViolation: false, publicationTrust: "trusted" });
    expect(t.gitMetadata?.changes.map((c) => c.classification)).toEqual(["benign_integration_change", "benign_integration_change"]);
    // Manager cannot auto-publish: nothing happens until the owner approves.
    expect(sim.commits).toEqual([]);
    expect(PUBLISH(sim)).toEqual([]);
    sim.approve("t261010", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "t261010", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
  });

  it("Git-inert config change during the run: the owner's approval binds to the classified new state (re-bind)", async () => {
    const sim = createSimulation({ worker: { inert: ["inert_git_metadata"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "inert" }));
    await sim.loop.settle();
    const t = sim.loop.task("inert")!;
    expect(t.status).toBe("needs_human_approval");
    expect(t.gitMetadata).toMatchObject({ publicationTrust: "rebind_allowed", workerViolation: false });
    const presented = (await createManagerApprovalRequirementReader(sim.loop).current("inert"))!;
    expect(presented.commitEvidence?.gitMetadataDigest).toBe("f".repeat(64));
    sim.approve("inert", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "inert", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
  });

  it("re-bound approval still goes stale if Git metadata moves again after approval", async () => {
    const sim = createSimulation({ worker: { inert2: ["inert_git_metadata"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "inert2" }));
    await sim.loop.settle();
    sim.approve("inert2", "commit_publish");
    sim.mutateWorkspace("inert2", { gitMetadataDigest: "9".repeat(64) });
    await sim.send({ type: "approval_granted", taskId: "inert2", phase: "commit_publish" });
    expect(sim.loop.task("inert2")?.status).toBe("blocked");
    expect(sim.commits).toEqual([]);
    expect(PUBLISH(sim)).toEqual([]);
  });
});

describe("Manager follow-up facts name the component and its classification", () => {
  const status = (waitReason: string): GatewayTaskStatus => ({
    taskId: "t1",
    status: "blocked",
    taskState: "failed",
    priority: "normal",
    risk: "green",
    assignedWorker: "codex",
    branch: null,
    headSha: null,
    prNumber: null,
    prState: null,
    qaState: null,
    repairAttempt: 0,
    waitReason,
    mode: "change",
    answer: null,
    approvalRequired: false,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  });

  it("a publication pause is its own non-accusing stop class", () => {
    const reason = "publication paused: Git publication evidence must be re-established";
    expect(terminalClass(reason)).toBe("publication_evidence");
    expect(stopReasonFact("publication_evidence")).toMatch(/accepted and kept in the workspace/);
    expect(terminalFollowUp(status(reason), "zh")).toContain("修改已被接受並保留在工作區");
  });

  it("gitMetadataFact explains where the boundary was (or was not) crossed — ids and key names only", () => {
    const benign = gitMetadataFact({
      publicationTrust: "trusted",
      workerViolation: false,
      changes: [{ component: "repo.info_server", what: ".git/info/refs", classification: "benign_integration_change", keys: [], entries: ["git:info/refs"] }],
    });
    expect(benign).toContain(".git/info/refs");
    expect(benign).toContain("was not found to have crossed any Git safety boundary");
    const violation = gitMetadataFact({
      publicationTrust: "blocked",
      workerViolation: true,
      changes: [{ component: "repo.config", what: "repository Git config", classification: "worker_security_violation", keys: ["remote.origin.url"], entries: ["git:config"] }],
    });
    expect(violation).toContain("config keys: remote.origin.url");
    expect(violation).toContain("crossed a hard Git safety boundary");
    expect(gitMetadataFact(null)).toBeNull();
  });
});

/**
 * Repair preflight: the repair contract used to inherit the digest pinned at first dispatch
 * (t.baseContract), so any metadata delta of the first run made the repair Worker's preflight refuse
 * before it ran. The trusted Git layer now re-binds right before the follow-up run starts.
 */
describe("repair re-binds the Git metadata baseline in the trusted layer", () => {
  const E = "e".repeat(64);
  const isMetadataFailure = (sim: ReturnType<typeof createSimulation>, id: string) =>
    sim.loop.task(id)!.workerErrorType === "git_metadata_changed" ||
    (sim.loop.task(id)!.gitMetadata?.changes ?? []).some((c) => c.classification === "worker_security_violation") ||
    sim.audit.some((e) => e.taskId === id && JSON.stringify(e.metadata).includes("worker_security_violation"));

  it("A/D/E. environment delta during the first run → legitimate repair re-binds and the repair Worker actually starts", async () => {
    const sim = createSimulation({ worker: { ra: ["validation_failed", "success"] }, holdWorkers: true, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "ra", expectedPaths: ["server/ra/"] }));
    const first = sim.workerContracts[0];
    sim.mutateWorkspace("ra", { gitMetadataDigest: E, gitMetadataComponent: "env.global_config", gitMetadataKeys: { "user.name": "h" } });
    sim.releaseWorker("ra");
    await sim.loop.settle();
    // A. the repair Worker started, bound to the re-established digest
    expect(sim.workerContracts).toHaveLength(2);
    const repair = sim.workerContracts[1];
    expect(sim.workerCalls[1].repair).toBe(true);
    expect(repair.gitMetadataDigest).toBe(E);
    // D. only the Git binding moved: lineage, branch, HEAD, scope, criteria, risk, category unchanged
    expect(repair).toMatchObject({
      taskId: first.taskId,
      branch: first.branch,
      expectedHeadSha: first.expectedHeadSha,
      allowedScope: first.allowedScope,
      acceptanceCriteria: first.acceptanceCriteria,
      requiredValidations: first.requiredValidations,
      category: first.category,
      actions: first.actions,
      storedRiskLevel: first.storedRiskLevel,
    });
    expect(repair.objective.startsWith(first.objective)).toBe(true);
    expect(sim.audit.some((e) => e.taskId === "ra" && e.event === "git_metadata_rebound")).toBe(true);
    // E. no false positive
    expect(isMetadataFailure(sim, "ra")).toBe(false);
    sim.releaseWorker("ra");
    await sim.loop.settle();
    const t = sim.loop.task("ra")!;
    expect(t.workerErrorType).toBeNull();
    // The environment change Git acts on still gates publication (re-binding never upgrades trust).
    expect(t.blockingReason).toBe("publication paused: Git publication evidence must be re-established");
    expect(sim.commits).toEqual([]);
    expect(isMetadataFailure(sim, "ra")).toBe(false);
  });

  it("A. Git-inert delta + repair: re-bound, repaired, and the owner approves the re-bound state", async () => {
    const sim = createSimulation({ worker: { rb: ["validation_failed", "success"] }, holdWorkers: true, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "rb" }));
    sim.mutateWorkspace("rb", { gitMetadataDigest: E, gitMetadataComponent: "repo.config", gitMetadataKeys: { "branch.x.github-pr-owner-number": "h" } });
    sim.releaseWorker("rb");
    await sim.loop.settle();
    expect(sim.workerContracts.map((c) => c.gitMetadataDigest)).toEqual(["c".repeat(64), E]);
    sim.releaseWorker("rb");
    await sim.loop.settle();
    const t = sim.loop.task("rb")!;
    expect(t.status).toBe("needs_human_approval");
    const presented = (await createManagerApprovalRequirementReader(sim.loop).current("rb"))!;
    expect(presented.commitEvidence?.gitMetadataDigest).toBe(E);
    expect(sim.commits).toEqual([]);
    sim.approve("rb", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "rb", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    expect(isMetadataFailure(sim, "rb")).toBe(false);
  });

  it("B. a real security mutation found at refresh (HEAD / remote / hooks / replace refs) → the repair never starts", async () => {
    const mutations = [
      { gitMetadataComponent: "repo.head" as const },
      { gitMetadataComponent: "repo.config" as const, gitMetadataKeys: { "remote.origin.url": "h" } },
      { gitMetadataComponent: "repo.config" as const, gitMetadataKeys: { "branch.x.pushremote": "h" } },
      { gitMetadataComponent: "repo.hooks" as const },
      { gitMetadataComponent: "repo.replace_refs" as const },
      {}, // unidentifiable delta: fail closed
    ];
    for (const [i, m] of mutations.entries()) {
      const id = `rs${i}`;
      const sim = createSimulation({ worker: { [id]: ["validation_failed", "success"] }, holdWorkers: true });
      await sim.create(fakeIntake({ taskId: id }));
      sim.mutateWorkspace(id, { gitMetadataDigest: E, ...m });
      sim.releaseWorker(id);
      await sim.loop.settle();
      const t = sim.loop.task(id)!;
      const name = JSON.stringify(m);
      expect(sim.workerContracts, name).toHaveLength(1);
      expect(t.status, name).toBe("blocked");
      expect(t.blockingReason, name).toBe("git metadata refresh refused: security-relevant Git metadata changed before the run");
      expect(t.escalations.at(-1), name).toEqual({ trigger: "git_metadata_refresh_refused", action: "block" });
      expect(sim.audit.some((e) => e.taskId === id && e.event === "git_metadata_rebind_refused"), name).toBe(true);
      // Not attributable to the Worker: never labelled a Worker violation.
      expect(isMetadataFailure(sim, id), name).toBe(false);
      expect(sim.commits, name).toEqual([]);
    }
  });

  it("C. after a re-bind the earlier publish approval is void: the owner must approve again", async () => {
    const sim = createSimulation({ ci: { rc: ["fail", "pass"] }, autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "rc" }));
    const firstEvidence = (await createManagerApprovalRequirementReader(sim.loop).current("rc"))!.commitEvidence!;
    const old = sim.approve("rc", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "rc", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    // Integration cache key appears after the PR is opened; CI then fails and the Manager repairs.
    sim.mutateWorkspace("rc", { gitMetadataDigest: E, gitMetadataComponent: "repo.config", gitMetadataKeys: { "branch.x.github-pr-owner-number": "h" } });
    await sim.send({ type: "qa_updated", taskId: "rc" });
    const t = sim.loop.task("rc")!;
    expect(sim.workerContracts.map((c) => c.gitMetadataDigest)).toEqual(["c".repeat(64), E]);
    expect(t.status).toBe("needs_human_approval");
    expect(t.approvalPhase).toBe("commit_publish");
    const presented = (await createManagerApprovalRequirementReader(sim.loop).current("rc"))!.commitEvidence!;
    expect(presented.gitMetadataDigest).toBe(E);
    expect(firstEvidence.gitMetadataDigest).not.toBe(E);
    // The old approval (bound to the old digest) authorizes nothing, even re-asserted as the newest one.
    expect(commitApprovalBinding(presented)).not.toBe(old.bindingShaOrActionId);
    sim.approve("rc", "commit_publish", { bindingShaOrActionId: old.bindingShaOrActionId });
    await sim.send({ type: "approval_granted", taskId: "rc", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(1);
    expect(sim.loop.task("rc")!.status).toBe("needs_human_approval");
    // A fresh approval of the re-bound state publishes.
    sim.approve("rc", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "rc", phase: "commit_publish" });
    expect(sim.commits).toHaveLength(2);
    expect(isMetadataFailure(sim, "rc")).toBe(false);
  });
});
