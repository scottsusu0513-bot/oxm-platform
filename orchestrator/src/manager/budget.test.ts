import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_REPAIR_ATTEMPTS, managerBudget, workerEffortForAttempt } from "./budget";
import { fakeEvidence, fakePostCiEvidence } from "./fake";
import { validateEvidence } from "./validator";

describe("effort budget", () => {
  it("green simple task -> fast profile, cheap path", () => {
    expect(managerBudget("green")).toEqual({
      profile: "fast",
      riskLevel: "green",
      maxRepairAttempts: 2,
      requiresSecondReview: false,
      allowDeepEscalation: false,
      historicalLookup: "none",
      qa: "standard",
      approvalRequired: false,
    });
  });

  it("yellow -> standard, red -> controlled with approval", () => {
    expect(managerBudget("yellow")).toMatchObject({ profile: "standard", approvalRequired: false, requiresSecondReview: false });
    expect(managerBudget("red")).toMatchObject({ profile: "controlled", approvalRequired: true, qa: "expanded", requiresSecondReview: false });
  });

  it("no deep review or second reviewer by default at any level", () => {
    for (const r of ["green", "yellow", "red"] as const) {
      expect(managerBudget(r).requiresSecondReview).toBe(false);
      expect(managerBudget(r).maxRepairAttempts).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
    }
    expect(validateEvidence(fakeEvidence()).intents).not.toContain("future_deep_review_candidate");
  });

  it("budget follows effective (escalated) risk, not caller input", () => {
    expect(validateEvidence(fakeEvidence({ risk: { stored: "green", observed: "yellow", approval: "none" } })).budget.profile).toBe("standard");
  });

  it("worker effort increases only on the final repair", () => {
    expect([0, 1, 2].map((a) => workerEffortForAttempt(a, 2))).toEqual(["normal", "normal", "increased"]);
  });

  it("escalation triggers are deterministic for each event", () => {
    const base = fakePostCiEvidence();
    const cases: [ReturnType<typeof fakeEvidence>, string][] = [
      [{ ...base, ci: { ...base.ci!, checks: [{ name: "verify", outcome: "failed" }, { name: "full-test", outcome: "success" }] } }, "ci_failure"],
      [fakeEvidence({ scope: { allowedScope: ["a.ts"], changedPaths: ["b.ts"] } }), "scope_violation"],
      [{ ...base, branch: { ...base.branch, conflict: true } }, "branch_conflict"],
      [{ ...base, branch: { ...base.branch, baseFreshness: "stale" } }, "stale_base"],
      [fakeEvidence({ risk: { stored: "green", observed: "yellow", approval: "none" } }), "observed_risk_escalation"],
      [{ ...base, ci: null }, "missing_trusted_evidence"],
      [fakeEvidence({ risk: { stored: "red", observed: "red", approval: "pending" } }), "approval_required"],
    ];
    for (const [e, trigger] of cases) expect(validateEvidence(e).triggers, trigger).toContain(trigger);
  });
});
