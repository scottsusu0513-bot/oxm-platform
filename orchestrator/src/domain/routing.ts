import type {
  ClassificationResult,
  RoutingDecision,
  TaskCategory,
  WorkerAvailability,
  WorkerKind,
} from "./types";

/**
 * Deterministic routing from structured classification. No LLM call.
 *
 * - Claude: backend, business logic, DB, auth, security, bugs, architecture, general coding.
 * - Codex: UI, CSS, layout, visual polish, frontend styling.
 * - Codex may act as coding fallback when Claude is unavailable/quota-limited.
 *   The reverse fallback is not part of the policy, so Codex-primary tasks wait.
 */

const CODEX_PRIMARY: ReadonlySet<TaskCategory> = new Set<TaskCategory>([
  "ui",
  "css",
  "layout",
  "visual_polish",
  "frontend_styling",
]);

export function primaryWorkerFor(category: TaskCategory): WorkerKind {
  return CODEX_PRIMARY.has(category) ? "codex" : "claude";
}

export function routeTask(
  classification: ClassificationResult,
  availability: WorkerAvailability,
): RoutingDecision {
  const primary = primaryWorkerFor(classification.category);

  if (availability[primary] === "available") {
    return {
      worker: primary,
      primary,
      isFallback: false,
      reason: `${classification.category} → ${primary} (primary)`,
    };
  }

  if (primary === "claude" && availability.codex === "available") {
    return {
      worker: "codex",
      primary,
      isFallback: true,
      reason: `claude ${availability.claude}; codex used as coding fallback`,
    };
  }

  return {
    worker: null,
    primary,
    isFallback: false,
    reason: `${primary} ${availability[primary]}; no eligible fallback available`,
  };
}
