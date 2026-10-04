import { PRIORITY_CLASSES, type PriorityAssessment, type PriorityClass, type PrioritySignal } from "./types";

/**
 * Deterministic priority policy. Priority comes only from structured intake
 * signals and an optional explicit user request — never from code, diffs, or
 * free text. A user request may raise priority but never lowers what policy
 * requires (a critical incident stays critical).
 */

const SIGNAL_PRIORITY: Record<PrioritySignal, PriorityClass> = {
  production_incident: "critical",
  security_incident: "critical",
  main_ci_broken: "critical",
  functional_regression: "high",
  auth_integrity: "high",
  data_integrity: "high",
  release_blocker: "high",
  feature: "normal",
  bug: "normal",
  ux_improvement: "normal",
  polish: "low",
  copy_cleanup: "low",
  refactor: "low",
};

/** Lower rank = scheduled first. */
export function priorityRank(p: PriorityClass): number {
  return PRIORITY_CLASSES.indexOf(p);
}

function higher(a: PriorityClass, b: PriorityClass): PriorityClass {
  return priorityRank(a) <= priorityRank(b) ? a : b;
}

export function assessPriority(input: { signals?: readonly PrioritySignal[]; requested?: PriorityClass | null }): PriorityAssessment {
  const signals = Array.from(new Set(input.signals ?? [])).filter((s) => s in SIGNAL_PRIORITY).sort();
  const reasons: string[] = [];
  let policyPriority: PriorityClass;
  if (signals.length === 0) {
    policyPriority = "normal";
    reasons.push("no priority signal; default normal");
  } else {
    // The most urgent signal wins; a low-priority signal never dilutes an urgent one.
    policyPriority = signals.map((s) => SIGNAL_PRIORITY[s]).reduce(higher);
    reasons.push(`policy ${policyPriority} from signals: ${signals.join(", ")}`);
  }
  const requested = input.requested && PRIORITY_CLASSES.includes(input.requested) ? input.requested : null;
  let priority = policyPriority;
  if (requested !== null) {
    if (priorityRank(requested) < priorityRank(policyPriority)) {
      priority = requested;
      reasons.push(`raised to ${requested} by explicit request`);
    } else if (priorityRank(requested) > priorityRank(policyPriority)) {
      reasons.push(`requested ${requested} ignored; policy priority is never downgraded`);
    }
  }
  return { priority, policyPriority, requestedPriority: requested, reasons };
}
