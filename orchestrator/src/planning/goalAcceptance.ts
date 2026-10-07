import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import type { GoalAcceptanceContext } from "../scheduler/types";
import { normalizeGoalReview } from "./normalize";
import type { CriterionReview, GoalReviewer } from "./types";

export const MAX_REVIEW_DIFF = 150_000;
const MAX_CITED_FILES = 8;
const MAX_CITED_BYTES = 8_000;

/** Repository paths an answer cites ("client/src/pages/Search.tsx", optionally with :line). */
export function citedPaths(answer: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s`'"(\[])((?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?/g;
  for (let m = re.exec(answer); m && out.length < MAX_CITED_FILES; m = re.exec(answer)) {
    const p = m[1];
    if (p.startsWith("/") || p.split("/").some((seg: string) => seg === ".." || seg === ".") || out.includes(p)) continue;
    out.push(p);
  }
  return out;
}

export interface SemanticAcceptanceInput {
  goal: GoalAcceptanceContext;
  /** Trusted, orchestrator-executed validations. */
  validations: readonly ValidationEvidence[];
  reviewer: GoalReviewer | null;
  reviewId: string;
  diff: { text: string; truncated: boolean };
  /** Read-only Worker answer (an untrusted claim the reviewer must verify). */
  answer: string | null;
  /** Trusted repository read for cited files (null when absent / unreadable). */
  fileContent: (path: string) => string | null;
  timeoutMs: number;
}

/**
 * Manager-owned acceptance of every criterion:
 *  - technical criteria are backed by the trusted validations;
 *  - goal criteria are judged by the Manager's trusted goal reviewer against
 *    the original goal and trusted evidence. Passing tests alone never
 *    satisfy a goal criterion, and nothing the Worker reports can.
 * Reviewer failure, timeout or an unclear verdict leaves the criterion
 * unverified (needs_repair, then human decision) — never accepted.
 */
export interface SemanticAcceptanceResult {
  acceptance: AcceptanceEvidence[];
  /**
   * Infrastructure outcome, not a verdict: the reviewer was missing, failed,
   * timed out or returned unusable output. The caller must not treat the
   * goal criteria as failed (no Manager repair cycle may be consumed).
   */
  reviewUnavailable: boolean;
}

export async function semanticAcceptance(input: SemanticAcceptanceInput): Promise<SemanticAcceptanceResult> {
  const allPassed = input.validations.length > 0 && input.validations.every((v) => v.status === "passed");
  const firstValidation = input.validations[0]?.name ?? null;
  const goalCriteria = input.goal.criteria.filter((c) => c.kind === "goal");
  let reviews: CriterionReview[] = [];
  let reviewUnavailable = false;
  if (goalCriteria.length > 0) {
    const unavailable = (reason: string): CriterionReview[] => goalCriteria.map((c) => ({ id: c.id, status: "unsupported", evidence: "", reason }));
    if (!input.reviewer) {
      reviews = unavailable("goal reviewer unavailable");
      reviewUnavailable = true;
    }
    else {
      // Read-only answers and audit_and_fix audit reports are claims verified against the cited files.
      const reportMode = input.goal.mode === "read_only" || input.goal.goal?.intent === "audit_and_fix";
      const citedFiles =
        reportMode && input.answer
          ? citedPaths(input.answer)
              .map((path) => ({ path, content: input.fileContent(path) }))
              .filter((f): f is { path: string; content: string } => f.content !== null)
              .map((f) => ({ path: f.path, excerpt: f.content.slice(0, MAX_CITED_BYTES) }))
          : [];
      try {
        const raw = await withTimeout(
          input.reviewer.review({
            mode: input.goal.mode,
            intent: input.goal.goal?.intent ?? null,
            title: input.goal.title,
            originalRequest: input.goal.goal?.originalRequest ?? input.goal.objective,
            interpretedObjective: input.goal.goal?.interpretedObjective ?? input.goal.objective,
            criteria: goalCriteria.map((c) => ({ id: c.id, text: c.text })),
            validations: input.validations.map((v) => ({ name: v.name, status: v.status })),
            diff: input.diff.text,
            diffTruncated: input.diff.truncated,
            answer: reportMode ? input.answer : null,
            citedFiles,
          }),
          input.timeoutMs,
        );
        if (!raw || typeof raw !== "object" || !Array.isArray((raw as { criteria?: unknown }).criteria)) throw new Error("unusable review output");
        reviews = normalizeGoalReview(raw, goalCriteria);
      } catch {
        reviews = unavailable("goal review failed or timed out");
        reviewUnavailable = true;
      }
    }
  }
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const acceptance = input.goal.criteria.map((c): AcceptanceEvidence => {
    if (c.kind !== "goal")
      return { criterionId: c.id, status: allPassed ? "satisfied" : "failed", evidenceType: "validation", reference: firstValidation };
    const r = byId.get(c.id)!;
    if (r.status === "satisfied")
      return { criterionId: c.id, status: "satisfied", evidenceType: "manager_review", reference: `review:${input.reviewId}`, summary: `${c.id} met: ${r.evidence}`.slice(0, 300) };
    return {
      criterionId: c.id,
      status: r.status === "not_satisfied" ? "failed" : "unknown",
      evidenceType: "manager_review",
      reference: null,
      summary: `${c.id} (${c.text.slice(0, 120)}) ${r.status === "not_satisfied" ? "not met" : "not supported by evidence"}: ${r.reason || "no reason given"}`.slice(0, 300),
    };
  });
  return { acceptance, reviewUnavailable };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("review timeout")), ms);
    }),
  ]);
}
