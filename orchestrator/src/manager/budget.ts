import type { RiskLevel } from "../domain/types";
import type { ManagerBudget, WorkerEffort } from "./types";

/**
 * Deterministic effort/budget policy: default cheap, escalate on evidence.
 * This is metadata only — it never runs an LLM, a reviewer, or a worker.
 * The budget is derived from the *effective* risk inside the validator, so a
 * caller can never loosen it.
 */

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

const PROFILES: Record<RiskLevel, Omit<ManagerBudget, "riskLevel" | "maxRepairAttempts">> = {
  green: {
    profile: "fast",
    requiresSecondReview: false,
    allowDeepEscalation: false,
    historicalLookup: "none",
    qa: "standard",
    approvalRequired: false,
  },
  yellow: {
    profile: "standard",
    requiresSecondReview: false,
    allowDeepEscalation: true,
    historicalLookup: "none",
    qa: "standard",
    approvalRequired: false,
  },
  red: {
    profile: "controlled",
    requiresSecondReview: false,
    allowDeepEscalation: true,
    historicalLookup: "recent",
    qa: "expanded",
    // Mirrors domain/risk: requiresApproval === (level === "red").
    approvalRequired: true,
  },
};

export function managerBudget(riskLevel: RiskLevel): ManagerBudget {
  return { ...PROFILES[riskLevel], riskLevel, maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS };
}

/** Repair 1 runs at normal effort; the final repair may request increased effort (metadata only). */
export function workerEffortForAttempt(attempt: number, maxRepairAttempts: number): WorkerEffort {
  return attempt >= 2 && attempt === maxRepairAttempts ? "increased" : "normal";
}
