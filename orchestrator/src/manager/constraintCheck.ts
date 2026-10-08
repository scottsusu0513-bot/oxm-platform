import { constraintSummary, type GuidanceConstraint } from "../executive/guidance";
import type { AcceptanceEvidence } from "./types";

/**
 * Verification of durable owner constraints against TRUSTED evidence. Pure.
 *
 * Every constraint is split into checks:
 *  - mechanically_verifiable: decided here from trusted runtime evidence
 *    (Git-observed changed paths, the trusted run record, files the Worker's
 *    answer actually cites and the Manager could read);
 *  - semantically_verifiable: decided by the GPT Manager's semantic review of
 *    the actual Worker evidence (diff / answer / cited source).
 * A Worker saying it followed the guidance is never evidence. Any violated or
 * unsupported check blocks acceptance (it becomes a failed / unverified
 * acceptance item and goes through the normal Manager repair accounting).
 */

export type ConstraintCheckKind = "mechanically_verifiable" | "semantically_verifiable";
export type ConstraintCheckStatus = "satisfied" | "violated" | "unsupported";

export interface ConstraintCheck {
  /** Stable acceptance id, e.g. "OC-1". */
  checkId: string;
  constraintId: string;
  kind: ConstraintCheckKind;
  /** Internal description of what is checked. */
  check: string;
}

export interface ConstraintVerdict extends ConstraintCheck {
  status: ConstraintCheckStatus;
  evidence: string;
}

const VALIDATION_COMMAND: Record<string, RegExp> = {
  typecheck: /\btsc\b|typecheck|type-check|pnpm\s+(?:run\s+)?check\b|npm\s+run\s+check\b/i,
  tests: /\bvitest\b|\bjest\b|pnpm\s+(?:run\s+)?test\b|npm\s+(?:run\s+)?test\b/i,
  smoke: /\bsmoke\b/i,
};
const UI_PATH = /\.(?:css|scss|tsx|jsx)$|(?:^|\/)components\/ui\/|^client\//;
const API_PATH = /^server\//;
const DEP_PATH = /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;
const PROD_PATH = /(?:^|\/)drizzle\/|(?:^|\/)migrations?\/|(?:^|\/)\.env|(?:^|\/)ecosystem\.config|(?:^|\/)\.github\/workflows\//;
const FILE_TARGET = /\.[A-Za-z0-9]{1,6}$/;

/** The checks a set of constraints implies, numbered OC-1.. in a stable order. */
export function constraintChecks(constraints: readonly GuidanceConstraint[], mode: "change" | "read_only"): ConstraintCheck[] {
  const out: Omit<ConstraintCheck, "checkId">[] = [];
  for (const c of constraints) {
    for (const v of c.rejectedValidations) out.push({ constraintId: c.decisionId, kind: "mechanically_verifiable", check: `no_validation_run:${v}` });
    for (const r of c.semantic?.executionRestrictions ?? []) {
      if (r === "no_ui_changes" || r === "no_api_changes" || r === "no_new_dependencies" || r === "no_production") out.push({ constraintId: c.decisionId, kind: "mechanically_verifiable", check: `restriction:${r}` });
      if (r === "keep_existing_progress" || r === "no_restart") out.push({ constraintId: c.decisionId, kind: "mechanically_verifiable", check: "restriction:keep_existing_progress" });
    }
    // When the owner explicitly asks for direct evidence from a file, every mode must
    // actually cite a Manager-readable copy of that file.  A change Worker merely
    // saying it looked at the file is no more proof than the same claim in read-only
    // work.  Plain file preferences that are not evidence requests remain hints.
    if (c.wantsDirectEvidence || mode === "read_only")
      for (const t of c.evidenceTargets) if (FILE_TARGET.test(t)) out.push({ constraintId: c.decisionId, kind: "mechanically_verifiable", check: `inspected:${t}` });
    const s = c.semantic;
    if (s && (s.requiredApproach || s.protectedAreas.length || s.prohibitedRepairActions.length || s.requiredEvidence.length))
      out.push({ constraintId: c.decisionId, kind: "semantically_verifiable", check: `semantic:${constraintSummary(c)}`.slice(0, 600) });
  }
  const seen = new Set<string>();
  return out
    .filter((x) => {
      const k = `${x.constraintId}|${x.check}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x, i) => ({ ...x, checkId: `OC-${i + 1}` }));
}

/** Semantic checks handed to the GPT reviewer (id + plain statement of the owner constraint). */
export function semanticConstraintPrompts(checks: readonly ConstraintCheck[]): { id: string; text: string }[] {
  return checks.filter((c) => c.kind === "semantically_verifiable").map((c) => ({ id: c.checkId, text: c.check.replace(/^semantic:/, "") }));
}

export function verifyConstraints(input: {
  checks: readonly ConstraintCheck[];
  changedPaths: readonly string[];
  /** Git-observed changed paths of the previous run (progress that must be kept). */
  previousChangedPaths: readonly string[];
  /** Commands the Worker's own run record lists (an admission of running them; never proof of compliance). */
  workerCommands: readonly string[];
  /** Repository files the Worker's answer cites that the Manager could actually read. */
  citedFiles: readonly string[];
  /** The GPT Manager's semantic verdicts by check id (absent = unsupported). */
  semantic: ReadonlyMap<string, { status: ConstraintCheckStatus; evidence: string }>;
}): ConstraintVerdict[] {
  return input.checks.map((c): ConstraintVerdict => {
    const v = (status: ConstraintCheckStatus, evidence: string): ConstraintVerdict => ({ ...c, status, evidence: evidence.slice(0, 300) });
    if (c.kind === "semantically_verifiable") {
      const s = input.semantic.get(c.checkId);
      return s ? v(s.status, s.evidence) : v("unsupported", "no semantic verdict from the GPT Manager review");
    }
    const [what, arg] = [c.check.slice(0, c.check.indexOf(":")), c.check.slice(c.check.indexOf(":") + 1)];
    if (what === "no_validation_run") {
      const re = VALIDATION_COMMAND[arg];
      const ran = input.workerCommands.filter((cmd) => re?.test(cmd));
      return ran.length ? v("violated", `the Worker ran ${ran.slice(0, 2).join(", ")} although the owner said not to`) : v("satisfied", `no ${arg} run in the Worker's run record`);
    }
    if (what === "inspected") {
      const base = arg.split("/").pop()!.toLowerCase();
      const hit = input.citedFiles.find((p) => p.toLowerCase() === arg.toLowerCase() || p.toLowerCase().endsWith(`/${base}`));
      return hit ? v("satisfied", `the answer cites ${hit} (read by the Manager)`) : v("violated", `the answer does not cite ${arg}`);
    }
    if (what === "restriction") {
      const hits = (re: RegExp) => input.changedPaths.filter((p) => re.test(p));
      const verdict = (bad: string[], label: string) => (bad.length ? v("violated", `${label}: ${bad.slice(0, 3).join(", ")}`) : v("satisfied", `no ${label} in the Git-observed changes`));
      if (arg === "no_ui_changes") return verdict(hits(UI_PATH), "UI file changes");
      if (arg === "no_api_changes") return verdict(hits(API_PATH), "API/server changes");
      if (arg === "no_new_dependencies") return verdict(hits(DEP_PATH), "dependency manifest changes");
      if (arg === "no_production") return verdict(hits(PROD_PATH), "production/migration/deploy file changes");
      if (arg === "keep_existing_progress") {
        const lost = input.previousChangedPaths.filter((p) => !input.changedPaths.includes(p));
        return lost.length ? v("violated", `earlier progress was reverted: ${lost.slice(0, 3).join(", ")}`) : v("satisfied", "all earlier changes are still present");
      }
    }
    return v("unsupported", "unknown constraint check");
  });
}

/** Constraint verdicts as acceptance items: any violated/unsupported verdict blocks acceptance. */
export function constraintAcceptance(verdicts: readonly ConstraintVerdict[], reviewId: string): AcceptanceEvidence[] {
  return verdicts.map((x) => ({
    criterionId: x.checkId,
    status: x.status === "satisfied" ? "satisfied" : x.status === "violated" ? "failed" : "unknown",
    evidenceType: x.kind === "mechanically_verifiable" ? "constraint_check" : "manager_review",
    reference: x.status === "satisfied" ? (x.kind === "mechanically_verifiable" ? `constraint:${x.checkId}` : `review:${reviewId}`) : null,
    summary: `${x.checkId} owner constraint (${x.kind === "mechanically_verifiable" ? "trusted check" : "Manager review"}) ${x.status}: ${x.evidence}`.slice(0, 300),
  }));
}
