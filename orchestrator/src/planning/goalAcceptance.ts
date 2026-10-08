import type { AcceptanceEvidence, ValidationEvidence } from "../manager/types";
import type { GoalAcceptanceContext } from "../scheduler/types";
import { excerptLineNumbers, excerptLines, gatherSourceEvidence, type LineRange, type SourceEvidencePorts } from "../executive/evidencePlan";
import { normalizeConstraintVerdicts, normalizeGoalReview } from "./normalize";
import type { CriterionReview, GoalReviewer, TrustedWorkspaceEvidence } from "./types";

export const MAX_REVIEW_DIFF = 150_000;
const MAX_CITED_FILES = 8;
const MAX_CITED_BYTES = 8_000;

const MAX_CITED_RANGES = 4;
const MAX_CITED_SPAN = 60;
const CITED_CONTEXT_LINES = 8;

export interface CitedLocation {
  path: string;
  /** Cited 1-based line ranges (empty when the path was cited without a line). */
  ranges: LineRange[];
}

/**
 * Repository paths an answer cites ("client/src/pages/Search.tsx", optionally
 * with :line or :line-line), keeping the line references. Absolute and
 * traversal paths are dropped; paths and ranges are bounded.
 */
export function citedLocations(answer: string): CitedLocation[] {
  const out: CitedLocation[] = [];
  const re = /(?:^|[\s`'"(\[])((?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,8})(?::(\d{1,7})(?:-(\d{1,7}))?)?/g;
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    const p = m[1];
    if (p.startsWith("/") || p.split("/").some((seg: string) => seg === ".." || seg === ".")) continue;
    let loc = out.find((l) => l.path === p);
    if (!loc) {
      if (out.length >= MAX_CITED_FILES) continue;
      loc = { path: p, ranges: [] };
      out.push(loc);
    }
    if (!m[2] || loc.ranges.length >= MAX_CITED_RANGES) continue;
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    const start = Math.max(1, Math.min(a, b));
    const end = Math.min(Math.max(a, b), start + MAX_CITED_SPAN - 1);
    if (!loc.ranges.some((r) => r.start === start && r.end === end)) loc.ranges.push({ start, end });
  }
  return out;
}

/** Repository paths an answer cites (see citedLocations). */
export function citedPaths(answer: string): string[] {
  return citedLocations(answer).map((l) => l.path);
}

/**
 * Trusted excerpt of a cited file: the cited line ranges with context when
 * they fall inside the file, otherwise the bounded file head.
 */
function citedExcerpt(content: string, ranges: readonly LineRange[]): { excerpt: string; lines: Set<number> } {
  const ranged = ranges.length ? excerptLines(content, ranges, CITED_CONTEXT_LINES, MAX_CITED_BYTES) : null;
  if (ranged) return ranged;
  const head = content.slice(0, MAX_CITED_BYTES);
  const complete = head.length === content.length ? head.split("\n").length : head.split("\n").length - 1;
  return { excerpt: head, lines: new Set(Array.from({ length: complete }, (_, i) => i + 1)) };
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
  /** Trusted repository listing/search used to gather the Manager's own source evidence (read-only work). */
  sourcePorts?: Omit<SourceEvidencePorts, "read">;
  /**
   * The orchestrator's own workspace verdict (read-only work), built only by
   * the trusted evidence layer after its Git re-verification. Absent or
   * internally inconsistent evidence is withheld, so "no change" criteria stay
   * unsupported (fail closed). Never derived from the Worker's report.
   */
  workspace?: TrustedWorkspaceEvidence;
  timeoutMs: number;
}

/** Workspace evidence the reviewer may see: only a self-consistent verdict, otherwise none. */
function consistentWorkspace(ws: TrustedWorkspaceEvidence | undefined): TrustedWorkspaceEvidence | undefined {
  if (!ws || !Array.isArray(ws.changedPaths) || !Number.isInteger(ws.changedPathCount)) return undefined;
  const none = ws.changedPathCount === 0;
  if (ws.changedPathCount < ws.changedPaths.length || none !== (ws.changedPaths.length === 0) || ws.workspaceUnchanged !== none) return undefined;
  return ws;
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
  /** GPT reviewer calls made (accounting). */
  reviewCalls: number;
  /** Repository files the answer cites that the trusted reader could read. */
  citedFiles: string[];
  /** Semantic owner-constraint verdicts (only for constraints that were asked). */
  constraintVerdicts: { id: string; status: "satisfied" | "violated" | "unsupported"; evidence: string }[];
}

export async function semanticAcceptance(input: SemanticAcceptanceInput): Promise<SemanticAcceptanceResult> {
  const allPassed = input.validations.length > 0 && input.validations.every((v) => v.status === "passed");
  const firstValidation = input.validations[0]?.name ?? null;
  const goalCriteria = input.goal.criteria.filter((c) => c.kind === "goal");
  let reviews: CriterionReview[] = [];
  let reviewUnavailable = false;
  let reviewCalls = 0;
  let citedPathList: string[] = [];
  const constraintIds = (input.goal.ownerConstraints ?? []).map((c) => c.id);
  let constraintVerdicts: SemanticAcceptanceResult["constraintVerdicts"] = [];
  if (goalCriteria.length > 0) {
    const unavailable = (reason: string): CriterionReview[] => goalCriteria.map((c) => ({ id: c.id, status: "unsupported", evidence: "", reason }));
    if (!input.reviewer) {
      reviews = unavailable("goal reviewer unavailable");
      reviewUnavailable = true;
    }
    else {
      // Read-only answers and audit_and_fix audit reports are claims verified against the cited files.
      const reportMode = input.goal.mode === "read_only" || input.goal.goal?.intent === "audit_and_fix";
      // Paths and line numbers come from the untrusted answer; the excerpt itself only from the trusted reader.
      const cited =
        reportMode && input.answer
          ? citedLocations(input.answer).flatMap((loc) => {
              const content = input.fileContent(loc.path);
              return content === null ? [] : [{ path: loc.path, ...citedExcerpt(content, loc.ranges) }];
            })
          : [];
      const citedFiles = cited.map((f) => ({ path: f.path, excerpt: f.excerpt }));
      // The Manager gathers source evidence from its own evidence plan, so a Worker that cites
      // nothing cannot leave the reviewer without the repository content the goal needs.
      const plan = input.goal.evidencePlan ?? null;
      const sourceEvidence =
        input.goal.mode === "read_only" && plan && plan.kind !== "change"
          ? (
              await gatherSourceEvidence({ plan, cited: [], ports: { read: input.fileContent, ...(input.sourcePorts ?? {}) } }).catch(() => [])
            ).filter((f) => {
              // Same path as a cited file: keep it only when it shows lines the cited excerpt does not.
              const c = cited.find((x) => x.path === f.path);
              if (!c) return true;
              const shown = excerptLineNumbers(f.excerpt);
              return shown.size ? Array.from(shown).some((n) => !c.lines.has(n)) : !c.excerpt.includes(f.excerpt);
            })
          : [];
      citedPathList = citedFiles.map((f) => f.path);
      const workspace = consistentWorkspace(input.workspace);
      if (plan && !plan.validationIsEvidence && citedFiles.length === 0 && sourceEvidence.length === 0) {
        // No repository source at all: passing validations can never answer the question.
        reviews = goalCriteria.map((c) => ({
          id: c.id,
          status: "unsupported",
          evidence: "",
          reason: "no repository source evidence (file path + excerpt) was produced; validation results cannot answer this goal",
        }));
      } else try {
        reviewCalls++;
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
            ...(sourceEvidence.length ? { sourceEvidence } : {}),
            ...(plan && plan.kind !== "change" ? { evidenceRequirements: plan.requirements } : {}),
            ...(input.goal.ownerConstraints?.length ? { ownerConstraints: input.goal.ownerConstraints } : {}),
            ...(input.goal.mode === "read_only" && workspace ? { workspace } : {}),
          }),
          input.timeoutMs,
        );
        if (!raw || typeof raw !== "object" || !Array.isArray((raw as { criteria?: unknown }).criteria)) throw new Error("unusable review output");
        reviews = normalizeGoalReview(raw, goalCriteria);
        const verdicts = normalizeConstraintVerdicts(raw, constraintIds);
        constraintVerdicts = constraintIds.filter((id) => verdicts.has(id)).map((id) => ({ id, ...verdicts.get(id)! }));
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
  return { acceptance, reviewUnavailable, reviewCalls, citedFiles: citedPathList, constraintVerdicts };
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
