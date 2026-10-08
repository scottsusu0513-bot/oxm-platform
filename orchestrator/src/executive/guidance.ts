import type { TaskMode } from "../domain/types";

/**
 * Human guidance as a DURABLE planning constraint. Pure and deterministic.
 *
 * A bound human decision is not execution authority (it never approves
 * commit, publish, merge, deploy or red risk), but once the Manager accepts
 * it, it constrains every later repair plan of the SAME task: actions the
 * owner explicitly rejected are not repeated without new evidence and an
 * explicit justification, and evidence the owner pointed at is requested.
 */

export const GUIDANCE_VALIDATIONS = ["tests", "typecheck", "smoke"] as const;
export const EXECUTION_RESTRICTIONS = [
  "no_production",
  "no_ui_changes",
  "no_api_changes",
  "keep_existing_progress",
  "no_restart",
  "no_new_dependencies",
  "investigate_before_changing",
] as const;
export type ExecutionRestriction = (typeof EXECUTION_RESTRICTIONS)[number];

/** The GPT Manager's semantic reading of the guidance, after deterministic validation. */
export interface SemanticGuidance {
  understoodAs: string;
  prohibitedRepairActions: string[];
  prohibitedValidations: string[];
  requiredEvidence: string[];
  preferredFilesOrAreas: string[];
  protectedAreas: string[];
  requiredApproach: string;
  /** Option id the owner chose from the options the Manager offered (null when none). */
  ownerDecisionSelection: string | null;
  executionRestrictions: ExecutionRestriction[];
}

export interface GuidanceConstraint {
  decisionId: string;
  round: number;
  /** Sanitized owner guidance (already normalized/bounded by the Manager). */
  guidance: string;
  /** gpt_manager: semantic interpretation (primary); deterministic: conservative keyword reading only. */
  source?: "gpt_manager" | "deterministic";
  semantic?: SemanticGuidance;
  /** Validations the owner rejected as the main action/evidence (e.g. "typecheck"). */
  rejectedValidations: string[];
  /** Files, components or identifiers the owner wants inspected (bounded hints, never paths to execute). */
  evidenceTargets: string[];
  /** The owner asked for direct repository evidence instead of generic validation. */
  wantsDirectEvidence: boolean;
}

const MAX_TARGETS = 8;

const NEGATION = String.raw`(?:不要再?|別再?|勿|停止|不用再?|不需要再?|不必再?|無需|stop|don'?t|do not|no more|quit|avoid|instead of|rather than)`;
const VALIDATION_WORD: readonly [RegExp, string][] = [
  [/typecheck|type[- ]check|\btsc\b|pnpm check|型別檢查|型別/i, "typecheck"],
  [/\btests?\b|\bvitest\b|pnpm test|單元測試|測試/i, "tests"],
  [/\bsmoke\b|冒煙/i, "smoke"],
];
const DIRECT_EVIDENCE_RE =
  /(?:read|open|inspect|look at|check|grep|search|quote|cite|gather|collect|讀|讀取|查看|打開|閱讀|檢查|搜尋|引用|取得|蒐集|收集|直接看)[^。.;；\n]{0,40}(?:file|source|code|component|evidence|excerpt|\.tsx?|\.jsx?|元件|組件|程式碼|原始碼|檔案|證據|內容)/i;
const FILE_RE = /(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_@-]+(?:\.[A-Za-z0-9_-]+)*\.(?:tsx?|jsx?|mjs|cjs|css|scss|json|md|html|sql)\b/g;
const BACKTICK_RE = /`([A-Za-z_][A-Za-z0-9_.-]{1,60})`/g;
/** Plain-language hints mapped to identifiers a repository search can use. */
const HINTS: readonly [RegExp, string][] = [
  [/首頁|homepage|home page|\bhome\b/i, "Home"],
  [/搜尋框|搜尋欄|search box|search bar|search input/i, "search"],
  [/搜尋元件|search component/i, "Search"],
  [/placeholder|提示文字|預設文字|佔位文字/i, "placeholder"],
];

function negatedValidations(text: string): string[] {
  const out = new Set<string>();
  for (const clause of text.split(/[。.;；\n!！?？]/)) {
    const neg = new RegExp(NEGATION, "i").exec(clause);
    if (!neg) continue;
    const after = clause.slice(neg.index);
    for (const [re, name] of VALIDATION_WORD) if (re.test(after)) out.add(name);
  }
  // "typecheck is not the main acceptance" style phrasing.
  if (/(?:typecheck|type[- ]check|型別檢查)[^。.;；\n]{0,20}(?:不是|不能當|不該當|not)[^。.;；\n]{0,12}(?:主要|main|primary)/i.test(text)) out.add("typecheck");
  return Array.from(out).sort();
}

export function extractEvidenceTargets(text: string): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    const t = v.trim();
    if (t && !out.includes(t) && out.length < MAX_TARGETS && !t.includes("..") && !t.startsWith("/")) out.push(t);
  };
  for (const m of Array.from(text.matchAll(FILE_RE))) add(m[0]);
  for (const m of Array.from(text.matchAll(BACKTICK_RE))) add(m[1]);
  // A plain-language hint adds nothing when the owner already named that exact file ("Home" vs "Home.tsx").
  for (const [re, hint] of HINTS) if (re.test(text) && !out.some((t) => t.split("/").pop()!.toLowerCase().startsWith(`${hint.toLowerCase()}.`))) add(hint);
  return out;
}

export function deriveGuidanceConstraint(input: { decisionId: string; round: number; guidance: string }): GuidanceConstraint {
  const guidance = input.guidance.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
  return {
    decisionId: input.decisionId,
    round: input.round,
    guidance,
    rejectedValidations: negatedValidations(guidance),
    evidenceTargets: extractEvidenceTargets(guidance),
    wantsDirectEvidence: DIRECT_EVIDENCE_RE.test(guidance) || new RegExp(FILE_RE.source).test(guidance),
  };
}

export interface GuidedRepairPlan {
  /** Validations the repair reruns as part of its plan. */
  rerunValidations: string[];
  /** Validations the owner rejected that are NOT part of the plan. */
  deferredValidations: string[];
  /** Explicit justification when a rejected validation is still required (never silent). */
  justification: string | null;
  /** Union of evidence targets from every constraint. */
  evidenceTargets: string[];
  wantsDirectEvidence: boolean;
  /** One-line restatements of the owner's constraints for the repair instruction. */
  constraintLines: string[];
}

/**
 * Applies every accumulated constraint of the task to the next repair plan.
 * read_only: a rejected validation is dropped from the plan entirely (it can
 * never be the evidence for a factual question anyway). change: required
 * validations stay a safety gate before commit — the plan says so explicitly
 * and makes the owner's requested evidence the primary action.
 */
export function applyGuidanceConstraints(input: { mode: TaskMode; rerunValidations: readonly string[]; constraints: readonly GuidanceConstraint[] }): GuidedRepairPlan {
  const rejected = new Set(input.constraints.flatMap((c) => c.rejectedValidations));
  const targets: string[] = [];
  for (const c of input.constraints) for (const t of c.evidenceTargets) if (!targets.includes(t) && targets.length < MAX_TARGETS) targets.push(t);
  const wantsDirectEvidence = input.constraints.some((c) => c.wantsDirectEvidence);
  const requested = Array.from(new Set(input.rerunValidations)).sort();
  const clash = requested.filter((v) => rejected.has(v));
  let rerun = requested;
  let deferred: string[] = [];
  let justification: string | null = null;
  if (clash.length > 0) {
    if (input.mode === "read_only") {
      rerun = requested.filter((v) => !rejected.has(v));
      deferred = clash;
    } else {
      justification = `Owner rejected ${clash.join(", ")} as the main action; it is rerun only as the mandatory pre-commit safety gate AFTER the owner's requested evidence/change is in place, never as evidence for the goal.`;
    }
  }
  return {
    rerunValidations: rerun,
    deferredValidations: deferred,
    justification,
    evidenceTargets: targets,
    wantsDirectEvidence,
    constraintLines: input.constraints.map((c) => `Owner guidance (decision ${c.decisionId}, round ${c.round}, still binding): ${c.semantic ? constraintSummary(c) : c.guidance}`),
  };
}

/**
 * Durable constraint from the GPT Manager's SEMANTIC interpretation (primary),
 * with the deterministic reading merged in only as a conservative ADDITION
 * (it can add a prohibited validation or a target, never remove one).
 */
export function semanticGuidanceConstraint(input: { decisionId: string; round: number; guidance: string; semantic: SemanticGuidance }): GuidanceConstraint {
  const det = deriveGuidanceConstraint(input);
  const sem = input.semantic;
  const union = (a: readonly string[], b: readonly string[], max = 8) => Array.from(new Set([...a, ...b])).slice(0, max);
  return {
    ...det,
    source: "gpt_manager",
    semantic: structuredClone(sem),
    rejectedValidations: union(sem.prohibitedValidations, det.rejectedValidations).sort(),
    evidenceTargets: union(sem.preferredFilesOrAreas, det.evidenceTargets),
    wantsDirectEvidence: sem.requiredEvidence.length > 0 || det.wantsDirectEvidence,
  };
}

/** True when a constraint forbids starting over (owner wants the current progress kept). */
export function keepsProgress(c: GuidanceConstraint): boolean {
  return (c.semantic?.executionRestrictions ?? []).some((r) => r === "keep_existing_progress" || r === "no_restart");
}

/** One-line summary of a constraint for Manager prompts (internal language). */
export function constraintSummary(c: GuidanceConstraint): string {
  const s = c.semantic;
  if (!s) return `owner guidance: ${c.guidance}${c.rejectedValidations.length ? `; do not use ${c.rejectedValidations.join(", ")} as the main action` : ""}`;
  return [
    `owner guidance: ${s.understoodAs || c.guidance}`,
    s.prohibitedRepairActions.length ? `prohibited: ${s.prohibitedRepairActions.join("; ")}` : "",
    c.rejectedValidations.length ? `not as main check: ${c.rejectedValidations.join(", ")}` : "",
    s.requiredEvidence.length ? `required evidence: ${s.requiredEvidence.join("; ")}` : "",
    c.evidenceTargets.length ? `look at: ${c.evidenceTargets.join(", ")}` : "",
    s.protectedAreas.length ? `keep as is: ${s.protectedAreas.join("; ")}` : "",
    s.requiredApproach ? `required approach: ${s.requiredApproach}` : "",
    s.executionRestrictions.length ? `restrictions: ${s.executionRestrictions.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}
