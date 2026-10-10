import { describe, expect, it } from "vitest";
import { fakeEvidence, fakePostCiEvidence, SHA_OTHER } from "./fake";
import type { ManagerEvidence } from "./types";
import { validateEvidence } from "./validator";

const withBranch = (b: Partial<ManagerEvidence["branch"]>, base = fakeEvidence()) => ({ ...base, branch: { ...base.branch, ...b } });

describe("evidence validator", () => {
  it("accepts when all evidence is valid (pre-PR and post-CI)", () => {
    for (const e of [fakeEvidence(), fakePostCiEvidence()]) {
      const v = validateEvidence(e);
      expect(v.decision).toBe("accepted");
      expect(v.findings).toEqual([]);
      expect(v.triggers).toEqual([]);
      expect(v.intents).toEqual([]);
    }
  });

  it("is deterministic", () => {
    const e = fakePostCiEvidence({ validations: [{ name: "tests", requested: true, executed: true, status: "failed", trusted: true }] });
    expect(validateEvidence(e)).toEqual(validateEvidence(structuredClone(e)));
  });

  it("blocks on scope violation (contract violation)", () => {
    const v = validateEvidence(fakeEvidence({ scope: { allowedScope: ["client/src/pages/Search.tsx"], changedPaths: ["client/src/pages/Search.tsx", "server/db.ts"] } }));
    expect(v.decision).toBe("blocked");
    expect(v.reasonCodes).toContain("scope_violation");
    expect(v.triggers).toContain("scope_violation");
    expect(v.intents).toContain("stop_task");
    expect(v.findings.find((f) => f.code === "scope_violation")?.summary).toBe("outside scope: server/db.ts");
  });

  it("directory scope entries cover nested paths only", () => {
    expect(validateEvidence(fakeEvidence({ scope: { allowedScope: ["server/search/"], changedPaths: ["server/search/a/b.ts"] }, acceptance: [{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }, { criterionId: "AC-2", status: "satisfied", evidenceType: "scope", reference: "scope" }] })).decision).toBe("accepted");
    expect(validateEvidence(fakeEvidence({ scope: { allowedScope: ["server/search/"], changedPaths: ["server/searchx.ts"] } })).decision).toBe("blocked");
  });

  it("needs repair on a failed validation", () => {
    const v = validateEvidence(fakeEvidence({ validations: [{ name: "tests", requested: true, executed: true, status: "failed", trusted: true, summary: "2 failing" }, { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true }] }));
    expect(v.decision).toBe("needs_repair");
    expect(v.failedEvidenceIds).toEqual(["acceptance:AC-1", "validation:tests"]);
    expect(v.intents).toEqual(["return_to_worker"]);
  });

  it("a validation that could not run or cannot be attributed is an advisory, never a repair (worker-favoring)", () => {
    for (const status of ["missing", "skipped", "unavailable", "unverified"] as const) {
      const v2 = validateEvidence(fakeEvidence({ validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }, { name: "typecheck", requested: true, executed: false, status, trusted: true }] }));
      expect(v2.decision).toBe("accepted");
      expect(v2.findings).toEqual([]);
      expect(v2.advisories).toEqual([{ evidenceId: "validation:typecheck", code: "validation_unverified", summary: `validation typecheck ${status}` }]);
    }
  });

  it("only a validation that ran and failed (failed_due_to_task) needs repair", () => {
    const v = validateEvidence(fakeEvidence({ validations: [{ name: "tests", requested: true, executed: true, status: "failed", trusted: true }] }));
    expect(v.decision).toBe("needs_repair");
    expect(v.reasonCodes).toContain("validation_failed");
  });

  it("an unverified safeguard criterion is an advisory; an unverified owner criterion still needs repair; a confirmed failure always does", () => {
    const base = fakeEvidence();
    const ids = base.acceptanceCriteriaIds;
    const mk = (over: Partial<ManagerEvidence["acceptance"][number]>) =>
      fakeEvidence({ acceptance: base.acceptance.map((a, i) => (i === 0 ? { ...a, status: "unknown", evidenceType: "manager_review", reference: null, ...over } : a)) });
    const safeguard = validateEvidence(mk({ confirmedFailureOnly: true }));
    expect(safeguard.decision).toBe("accepted");
    expect(safeguard.advisories.map((a) => a.code)).toEqual(["acceptance_unverified_advisory"]);
    expect(validateEvidence(mk({})).decision).toBe("needs_repair");
    expect(validateEvidence(mk({ status: "failed", confirmedFailureOnly: true })).decision).toBe("needs_repair");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("blocks on untrusted validation evidence or no requested validations", () => {
    expect(validateEvidence(fakeEvidence({ validations: [{ name: "tests", requested: true, executed: true, status: "passed", trusted: false }] })).reasonCodes).toContain("validation_untrusted");
    expect(validateEvidence(fakeEvidence({ validations: [] })).reasonCodes).toContain("validations_undefined");
  });

  it("needs repair when CI failed on the exact head", () => {
    const base = fakePostCiEvidence();
    const v = validateEvidence({ ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "failed" }, { name: "full-test", outcome: "success" }] } });
    expect(v.decision).toBe("needs_repair");
    expect(v.failedEvidenceIds).toEqual(["ci:verify"]);
    expect(v.triggers).toEqual(["ci_failure"]);
  });

  it("blocks when CI is for a stale SHA", () => {
    const base = fakePostCiEvidence();
    const v = validateEvidence({ ...base, ci: { ...base.ci!, headSha: SHA_OTHER } });
    expect(v.decision).toBe("blocked");
    expect(v.reasonCodes).toEqual(["ci_stale_sha"]);
  });

  it("blocks when CI is missing, untrusted, incomplete, or a required check is absent", () => {
    const base = fakePostCiEvidence();
    expect(validateEvidence({ ...base, ci: null }).reasonCodes).toEqual(["ci_missing"]);
    expect(validateEvidence({ ...base, ci: { ...base.ci!, trusted: false } }).reasonCodes).toEqual(["ci_untrusted"]);
    expect(validateEvidence({ ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "success" }] } }).reasonCodes).toEqual(["ci_check_missing"]);
    expect(validateEvidence({ ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "pending" }, { name: "full-test", outcome: "success" }] } }).reasonCodes).toEqual(["ci_incomplete"]);
  });

  it("duplicate CI observations resolve to the most severe outcome", () => {
    const base = fakePostCiEvidence();
    const v = validateEvidence({ ...base, ci: { ...base.ci!, checks: [...base.ci!.checks, { name: "verify", outcome: "failed" }] } });
    expect(v.decision).toBe("needs_repair");
  });

  it("does not require CI before a PR exists", () => {
    expect(validateEvidence(fakeEvidence({ ci: null })).decision).toBe("accepted");
  });

  it("needs repair on a failed acceptance criterion", () => {
    const v = validateEvidence(fakeEvidence({ acceptance: [{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }, { criterionId: "AC-2", status: "failed", evidenceType: "worker_report", reference: null }] }));
    expect(v.decision).toBe("needs_repair");
    expect(v.reasonCodes).toEqual(["acceptance_failed"]);
    expect(v.failedEvidenceIds).toEqual(["acceptance:AC-2"]);
  });

  it("treats unknown, missing, or prose-only acceptance as unverified", () => {
    const one = (a: ManagerEvidence["acceptance"][number]) => validateEvidence(fakeEvidence({ acceptance: [{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }, a] }));
    expect(one({ criterionId: "AC-2", status: "unknown", evidenceType: "worker_report", reference: null }).reasonCodes).toEqual(["acceptance_unverified"]);
    expect(one({ criterionId: "AC-2", status: "satisfied", evidenceType: "worker_report", reference: null, summary: "I am sure it works" }).reasonCodes).toEqual(["acceptance_unverified"]);
    expect(one({ criterionId: "AC-2", status: "satisfied", evidenceType: "ci_check", reference: "verify" }).reasonCodes).toEqual(["acceptance_unverified"]);
    expect(validateEvidence(fakeEvidence({ acceptance: [{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }] })).reasonCodes).toEqual(["acceptance_unverified"]);
  });

  it("blocks on acceptance evidence for a criterion not in the contract, or no criteria", () => {
    const e = fakeEvidence();
    expect(validateEvidence({ ...e, acceptance: [...e.acceptance, { criterionId: "AC-9", status: "satisfied", evidenceType: "human", reference: "review-1" }] }).reasonCodes).toEqual(["acceptance_unknown_criterion"]);
    expect(validateEvidence({ ...e, acceptanceCriteriaIds: [], acceptance: [] }).reasonCodes).toEqual(["acceptance_criteria_undefined"]);
  });

  it("observed risk escalation to red requires human approval (risk never lowers)", () => {
    const v = validateEvidence(fakeEvidence({ risk: { stored: "green", observed: "red", approval: "none" } }));
    expect(v.decision).toBe("needs_human_approval");
    expect(v.riskLevel).toBe("red");
    expect(v.budget.profile).toBe("controlled");
    expect(v.triggers).toEqual(["approval_required", "observed_risk_escalation"]);
    expect(v.intents).toEqual(["request_human_approval"]);
    expect(validateEvidence(fakeEvidence({ risk: { stored: "red", observed: "green", approval: "none" } })).riskLevel).toBe("red");
  });

  it("green -> yellow escalation is recorded but does not block", () => {
    const v = validateEvidence(fakeEvidence({ risk: { stored: "green", observed: "yellow", approval: "none" } }));
    expect(v.decision).toBe("accepted");
    expect(v.triggers).toEqual(["observed_risk_escalation"]);
  });

  it("unresolved required approval -> needs_human_approval; approved -> accepted; rejected -> blocked", () => {
    const red = (approval: ManagerEvidence["risk"]["approval"]) => validateEvidence(fakeEvidence({ risk: { stored: "red", observed: "red", approval } }));
    expect(red("pending").decision).toBe("needs_human_approval");
    expect(red("expired").reasonCodes).toEqual(["approval_expired"]);
    expect(red("approved").decision).toBe("accepted");
    expect(red("rejected").decision).toBe("blocked");
  });

  it("approval wait outranks repair (no worker execution without approval)", () => {
    const v = validateEvidence(fakeEvidence({ risk: { stored: "green", observed: "red", approval: "none" }, validations: [{ name: "tests", requested: true, executed: true, status: "failed", trusted: true }] }));
    expect(v.decision).toBe("needs_human_approval");
  });

  it("blocks unsafe branch/workspace state", () => {
    const cases: [Partial<ManagerEvidence["branch"]>, string][] = [
      [{ workerBranch: "agent/task-t2-other" }, "branch_mismatch"],
      [{ assignedBranch: "main", workerBranch: "main" }, "assigned_branch_invalid"],
      [{ workspaceProof: "missing" }, "workspace_proof_missing"],
      [{ workspaceProof: "mismatch" }, "workspace_proof_mismatch"],
      [{ branchPlanDecision: "queue" }, "branch_plan_queue"],
      [{ workerHeadSha: SHA_OTHER }, "head_mismatch"],
      [{ verifiedHeadSha: null }, "head_unverified"],
      [{ conflict: true }, "branch_conflict"],
      [{ baseFreshness: "stale" }, "stale_base"],
    ];
    for (const [b, code] of cases) {
      const v = validateEvidence(withBranch(b));
      expect(v.decision, code).toBe("blocked");
      expect(v.reasonCodes, code).toContain(code);
    }
  });

  it("stale base / conflict produce a replan intent, not stop", () => {
    expect(validateEvidence(withBranch({ baseFreshness: "stale" })).intents).toEqual(["replan_branch"]);
    expect(validateEvidence(withBranch({ conflict: true })).intents).toEqual(["replan_branch"]);
  });

  it("maps worker failures: repairable vs blocked vs approval", () => {
    const w = (status: ManagerEvidence["worker"]["status"], errorType: ManagerEvidence["worker"]["errorType"]) => validateEvidence(fakeEvidence({ worker: { kind: "claude", status, errorType } })).decision;
    expect(w("failure", "worker_failure")).toBe("needs_repair");
    // Transient runtime failures never enter the Manager repair loop (the loop retries them first).
    expect(w("timeout", "timeout")).toBe("blocked");
    expect(w("failure", "process_error")).toBe("blocked");
    expect(validateEvidence(fakeEvidence({ worker: { kind: "claude", status: "timeout", errorType: "timeout" } })).triggers).toContain("infrastructure_failure");
    expect(w("failure", "scope_violation")).toBe("blocked");
    expect(w("failure", "dirty_worktree")).toBe("blocked");
    expect(w("failure", "runtime_unavailable")).toBe("blocked");
    expect(w("failure", "runtime_misconfigured")).toBe("blocked");
    expect(w("failure", "policy_error")).toBe("blocked");
    expect(w("failure", null)).toBe("blocked");
    expect(w("cancelled", "cancelled")).toBe("blocked");
    expect(w("success", "worker_failure")).toBe("blocked");
    expect(w("failure", "red_approval_missing")).toBe("needs_human_approval");
  });

  it("blocks when task state prevents further work", () => {
    for (const s of ["complete", "failed", "cancelled", "queued"] as const) {
      expect(validateEvidence(fakeEvidence({ taskState: s })).decision).toBe("blocked");
    }
    expect(validateEvidence(fakePostCiEvidence({ pr: { number: 42, state: "merged" } })).reasonCodes).toEqual(["pr_merged"]);
    expect(validateEvidence(fakePostCiEvidence({ pr: null })).reasonCodes).toEqual(["pr_missing"]);
  });

  it("fails closed on malformed evidence (shape is re-checked at runtime)", () => {
    const v = validateEvidence({ ...fakeEvidence(), taskState: "bogus" } as unknown as ManagerEvidence);
    expect(v.decision).toBe("blocked");
    expect(v.reasonCodes).toEqual(["evidence_rejected"]);
  });
});
