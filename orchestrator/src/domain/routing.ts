import type { ClassificationResult, RoutingDecision, TaskCategory, WorkerAvailability, WorkerKind } from "./types";

/**
 * Deterministic routing from structured classification. No LLM call.
 *
 * - Claude: backend, business logic, DB, auth, security, bugs, architecture, general coding.
 * - Codex: UI, CSS, layout, visual polish, frontend styling.
 * - Codex may act as coding fallback when Claude is unavailable/quota-limited.
 *   The reverse fallback is not part of the policy, so Codex-primary tasks wait.
 */

const CODEX_PRIMARY: ReadonlySet<TaskCategory> = new Set<TaskCategory>(["ui", "css", "layout", "visual_polish", "frontend_styling"]);

export function primaryWorkerFor(category: TaskCategory): WorkerKind {
  return CODEX_PRIMARY.has(category) ? "codex" : "claude";
}

export function routeTask(classification: ClassificationResult, availability: WorkerAvailability, options: { allowClaudeToCodexFallback?: boolean } = {}): RoutingDecision {
  const primary = primaryWorkerFor(classification.category);

  if (availability[primary] === "available") {
    return {
      worker: primary,
      primary,
      isFallback: false,
      fallbackFrom: null,
      reasonCode: "primary_available",
      reason: `${classification.category} → ${primary} (primary)`,
    };
  }

  if (primary === "claude" && availability.codex === "available" && options.allowClaudeToCodexFallback !== false) {
    return {
      worker: "codex",
      primary,
      isFallback: true,
      fallbackFrom: "claude",
      reasonCode: "fallback_selected",
      reason: `claude ${availability.claude}; codex used as coding fallback`,
    };
  }

  return {
    worker: null,
    primary,
    isFallback: false,
    fallbackFrom: null,
    reasonCode: primary === "claude" && availability.codex === "available" ? "fallback_forbidden" : "worker_unavailable",
    reason: primary === "claude" && availability.codex === "available" ? `claude ${availability.claude}; codex fallback forbidden by policy` : `${primary} ${availability[primary]}; no eligible fallback available`,
  };
}
