import { findInternalJargon } from "../executive/communication";
import { EXECUTION_RESTRICTIONS, GUIDANCE_VALIDATIONS, keepsProgress, type ExecutionRestriction, type GuidanceConstraint, type SemanticGuidance } from "../executive/guidance";
import { isDangerousValue } from "../store/sanitize";

/**
 * Deterministic policy gate for the GPT Manager's structured reasoning.
 * Pure. The model's output is untrusted data: it may PLAN a repair, interpret
 * guidance and judge a combined result, but nothing it says can expand scope,
 * lower risk, change mutability, grant permissions, override protected areas
 * or authorize Git/deploy/DB actions. Any malformed or violating output is
 * refused (fail closed); the caller treats that as a Manager infrastructure
 * failure, never as a repair cycle. Only the validated structured fields are
 * kept — no free-form reasoning is stored.
 */

export type Gate<T> = { ok: true; value: T } | { ok: false; code: "malformed" | "policy_violation" | "scope_violation" | "mutability_violation" | "constraint_violation" | "stagnation_ignored"; reason: string };

export interface ManagerRepairPlan {
  kind: "manager_repair_plan";
  source: "gpt_manager";
  rootCause: string;
  whyPreviousAttemptFailed: string;
  missingEvidence: string[];
  repairStrategy: string;
  strategyChanged: boolean;
  repairObjective: string;
  repairInstructions: string[];
  /** Policy areas ∪ owner-protected areas ∪ the model's additions (never fewer than the policy). */
  protectedAreas: string[];
  requiredEvidence: string[];
  /** Subset of the task's required validations, minus any the owner prohibited. */
  validationPlan: string[];
  touchesPaths: string[];
  restartFromScratch: boolean;
  ownerDecision: { question: string; options: { id: string; summary: string }[]; recommended: string | null } | null;
  constraintCompliance: { constraintId: string; howHonored: string }[];
}

const MAX_TEXT = 600;
const MAX_ITEM = 300;
const MAX_LIST = 12;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clean = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function text(r: Record<string, unknown>, k: string, max = MAX_TEXT): string | null {
  const v = r[k];
  if (typeof v !== "string") return null;
  const t = clean(v, max);
  return isDangerousValue(t) ? null : t;
}
function list(r: Record<string, unknown>, k: string, max = MAX_ITEM): string[] | null {
  const v = r[k];
  if (!Array.isArray(v) || v.length > 40 || v.some((x) => typeof x !== "string")) return null;
  const out = (v as string[]).map((x) => clean(x, max)).filter(Boolean);
  return out.some((x) => isDangerousValue(x)) ? null : out.slice(0, MAX_LIST);
}

/** Actions no Manager plan may ever request (authority stays with Trusted Git, approvals and the operator). */
const FORBIDDEN =
  /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|config|remote|tag|stash)\b|force[- ]?push|--no-verify|\bdeploy(?:ing|ment)?\b|production\s+(?:db|database|data)|\bprod(?:uction)?\s+(?:db|database)\b|run\s+(?:the\s+)?migrations?|db:push|drizzle-kit\s+(?:push|migrate)|(?:lower|downgrade|change)\s+(?:the\s+)?risk|(?:bypass|disable|skip|remove)\s+(?:the\s+)?(?:approval|tests?|validations?|checks?|ci|typecheck|auth(?:entication)?)|\.github\/workflows|(?:add|change|edit|expose|print|log)\s+(?:the\s+)?(?:secrets?|api[ _-]?keys?|tokens?|credentials?)|grant\s+(?:\w+\s+)?permissions?/i;
/** Negated clauses ("do not push", "never disable tests") are prohibitions, not requests. */
const affirmative = (prose: string) => prose.replace(/\b(?:do not|don't|dont|never|must not|should not|without|avoid|no)\b[^.;\n]*/gi, " ").replace(/(?:不要|不得|禁止|避免|勿)[^。；;\n]*/g, " ");

/** Imperative edit steps are a mutation; a read-only task can never get one. */
const EDIT_STEP = /^(?:please\s+)?(?:edit|modify|change|update|write|create|add|delete|remove|refactor|fix|implement|apply|rename|move)\b/i;

const safePath = (p: string) => p.length > 0 && p.length <= 400 && !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === ".") && !/[\0\\]/.test(p);
const inScope = (p: string, scope: readonly string[]) => scope.some((e) => (e.endsWith("/") ? p.startsWith(e) : p === e));
const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?，。；：！？、()（）"'`-]+/g, " ").trim();

export interface RepairPlanContext {
  mode: "change" | "read_only";
  allowedScope: readonly string[];
  requiredValidations: readonly string[];
  policyProtectedAreas: readonly string[];
  constraints: readonly GuidanceConstraint[];
  stagnated: boolean;
  previousStrategy: string | null;
}

export function validateManagerRepairPlan(raw: unknown, ctx: RepairPlanContext): Gate<ManagerRepairPlan> {
  const bad = (code: Exclude<Gate<never>, { ok: true }>["code"], reason: string): Gate<ManagerRepairPlan> => ({ ok: false, code, reason });
  if (!isObj(raw)) return bad("malformed", "diagnosis is not an object");
  const r = raw;
  const t = {
    rootCause: text(r, "rootCause"),
    why: text(r, "whyPreviousAttemptFailed"),
    strategy: text(r, "repairStrategy", MAX_ITEM),
    objective: text(r, "repairObjective"),
    question: text(r, "ownerDecisionQuestion", MAX_ITEM),
    recommended: text(r, "recommendedOption", 8),
  };
  const l = {
    missing: list(r, "missingEvidence"),
    instructions: list(r, "repairInstructions"),
    protected: list(r, "protectedAreas"),
    evidence: list(r, "requiredEvidence"),
    validations: list(r, "validationPlan", 20),
    paths: list(r, "touchesPaths", 400),
  };
  if (Object.values(t).some((v) => v === null) || Object.values(l).some((v) => v === null)) return bad("malformed", "missing, mistyped or credential-like field");
  if (typeof r.strategyChanged !== "boolean" || typeof r.restartFromScratch !== "boolean" || typeof r.ownerDecisionNeeded !== "boolean") return bad("malformed", "boolean field missing");
  if (!t.rootCause || !t.strategy) return bad("malformed", "rootCause and repairStrategy are required");
  if (!r.ownerDecisionNeeded && (!t.objective || l.instructions!.length === 0)) return bad("malformed", "a repair needs an objective and instructions");
  const options = Array.isArray(r.ownerOptions) ? r.ownerOptions : null;
  const compliance = Array.isArray(r.constraintCompliance) ? r.constraintCompliance : null;
  if (!options || !compliance) return bad("malformed", "ownerOptions / constraintCompliance missing");

  // Authority: nothing the Manager writes may request a forbidden action.
  const prose = [t.objective!, t.strategy!, ...l.instructions!, ...l.evidence!].join("\n");
  if (FORBIDDEN.test(affirmative(prose))) return bad("policy_violation", "plan requests an action outside Worker authority (Git/deploy/DB/risk/approval/permission/test weakening)");

  // Scope and mutability come from the trusted contract, never from the plan.
  if (!l.paths!.every(safePath)) return bad("scope_violation", "unsafe path in touchesPaths");
  const outside = l.paths!.filter((p) => !inScope(p, ctx.allowedScope));
  if (outside.length) return bad("scope_violation", `plan touches paths outside the allowed scope (${outside.slice(0, 3).join(", ")})`);
  if (ctx.mode === "read_only") {
    if (l.paths!.length > 0) return bad("mutability_violation", "a read-only task cannot touch files");
    if (l.instructions!.some((i) => EDIT_STEP.test(i))) return bad("mutability_violation", "a read-only task cannot receive edit instructions");
  }

  // Validations: only the task's own, never one the owner prohibited.
  const plan = Array.from(new Set(l.validations!));
  if (plan.some((v) => !(GUIDANCE_VALIDATIONS as readonly string[]).includes(v) || !ctx.requiredValidations.includes(v))) return bad("scope_violation", "validation plan names a validation the task does not require");
  const prohibited = new Set(ctx.constraints.flatMap((c) => c.rejectedValidations));
  const clash = plan.filter((v) => prohibited.has(v));
  if (clash.length) return bad("constraint_violation", `validation plan repeats what the owner rejected (${clash.join(", ")})`);

  // Durable owner constraints: each must be explicitly honoured; some are checked mechanically.
  const ids = new Set<string>();
  const honoured: { constraintId: string; howHonored: string }[] = [];
  for (const c of compliance) {
    if (!isObj(c) || typeof c.constraintId !== "string" || typeof c.howHonored !== "string") return bad("malformed", "constraintCompliance entry malformed");
    ids.add(c.constraintId);
    honoured.push({ constraintId: clean(c.constraintId, 64), howHonored: clean(c.howHonored, MAX_ITEM) });
  }
  const missing = ctx.constraints.filter((c) => !ids.has(c.decisionId));
  if (missing.length) return bad("constraint_violation", `plan does not address owner constraint(s) ${missing.map((c) => c.decisionId).join(", ")}`);
  if (r.restartFromScratch && ctx.constraints.some(keepsProgress)) return bad("constraint_violation", "owner asked to keep the existing progress; restart refused");
  const restrictions = new Set<ExecutionRestriction>(ctx.constraints.flatMap((c) => c.semantic?.executionRestrictions ?? []));
  if (restrictions.has("no_ui_changes") && l.paths!.some((p) => /\.(?:css|scss)$|(?:^|\/)components\/ui\/|(?:^|\/)client\/src\/(?:pages|components)\//.test(p)))
    return bad("constraint_violation", "owner said not to change the UI");
  if (restrictions.has("no_api_changes") && l.paths!.some((p) => p.startsWith("server/"))) return bad("constraint_violation", "owner said not to change the API");
  if (restrictions.has("no_new_dependencies") && l.paths!.some((p) => /(?:^|\/)(?:package\.json|pnpm-lock\.yaml)$/.test(p))) return bad("constraint_violation", "owner said no new dependencies");

  // Stagnation (deterministic) demands a materially different strategy.
  if (ctx.stagnated && (r.strategyChanged !== true || (ctx.previousStrategy !== null && norm(ctx.previousStrategy) === norm(t.strategy!))))
    return bad("stagnation_ignored", "the previous approach stagnated but the plan does not change strategy");

  let ownerDecision: ManagerRepairPlan["ownerDecision"] = null;
  if (r.ownerDecisionNeeded) {
    const opts: { id: string; summary: string }[] = [];
    for (const o of options) {
      if (!isObj(o) || typeof o.id !== "string" || typeof o.summary !== "string") return bad("malformed", "owner option malformed");
      const id = clean(o.id, 8);
      const summary = clean(o.summary, MAX_ITEM);
      if (!/^[A-Za-z0-9]{1,8}$/.test(id) || !summary || opts.some((x) => x.id === id) || isDangerousValue(summary)) return bad("malformed", "owner option invalid");
      opts.push({ id, summary });
    }
    if (!t.question || opts.length < 2 || opts.length > 4) return bad("malformed", "an owner decision needs a question and 2-4 options");
    if (t.recommended && !opts.some((o) => o.id === t.recommended)) return bad("malformed", "recommended option is not offered");
    if (opts.some((o) => FORBIDDEN.test(affirmative(o.summary)))) return bad("policy_violation", "an owner option requests an action outside Worker authority");
    ownerDecision = { question: t.question, options: opts, recommended: t.recommended || null };
  }

  const ownerProtected = ctx.constraints.flatMap((c) => c.semantic?.protectedAreas ?? []);
  return {
    ok: true,
    value: {
      kind: "manager_repair_plan",
      source: "gpt_manager",
      rootCause: t.rootCause!,
      whyPreviousAttemptFailed: t.why!,
      missingEvidence: l.missing!,
      repairStrategy: t.strategy!,
      strategyChanged: r.strategyChanged as boolean,
      repairObjective: t.objective!,
      repairInstructions: l.instructions!,
      protectedAreas: Array.from(new Set([...ctx.policyProtectedAreas, ...ownerProtected.map((p) => `Owner: keep as is — ${p}`), ...l.protected!])).slice(0, 20),
      requiredEvidence: l.evidence!,
      validationPlan: plan.sort(),
      touchesPaths: l.paths!,
      restartFromScratch: r.restartFromScratch as boolean,
      ownerDecision,
      constraintCompliance: honoured,
    },
  };
}

// ---------------------------------------------------------------------------
// Guidance interpretation

export function validateGuidanceInterpretation(raw: unknown, ctx: { optionIds: readonly string[] }): Gate<SemanticGuidance> {
  const bad = (reason: string): Gate<SemanticGuidance> => ({ ok: false, code: "malformed", reason });
  if (!isObj(raw)) return bad("guidance interpretation is not an object");
  const understoodAs = text(raw, "understoodAs", MAX_ITEM);
  const requiredApproach = text(raw, "requiredApproach");
  const selection = text(raw, "ownerDecisionSelection", 8);
  const lists = {
    prohibitedRepairActions: list(raw, "prohibitedRepairActions"),
    prohibitedValidations: list(raw, "prohibitedValidations", 20),
    requiredEvidence: list(raw, "requiredEvidence"),
    preferredFilesOrAreas: list(raw, "preferredFilesOrAreas", 200),
    protectedAreas: list(raw, "protectedAreas"),
    executionRestrictions: list(raw, "executionRestrictions", 40),
  };
  if (understoodAs === null || requiredApproach === null || selection === null || Object.values(lists).some((v) => v === null)) return bad("missing, mistyped or credential-like field");
  if (!lists.prohibitedValidations!.every((v) => (GUIDANCE_VALIDATIONS as readonly string[]).includes(v))) return bad("unknown validation name");
  if (!lists.executionRestrictions!.every((v) => (EXECUTION_RESTRICTIONS as readonly string[]).includes(v))) return bad("unknown execution restriction");
  if (lists.preferredFilesOrAreas!.some((p) => p.startsWith("/") || p.includes(".."))) return bad("unsafe file or area hint");
  if (selection && !ctx.optionIds.includes(selection)) return bad("selected option was not offered");
  // Guidance is planning input, never authority: it cannot smuggle a forbidden action in as an "approach".
  if (FORBIDDEN.test(affirmative([requiredApproach, ...lists.requiredEvidence!].join("\n")))) return { ok: false, code: "policy_violation", reason: "guidance interpretation requests an action outside Worker authority" };
  return {
    ok: true,
    value: {
      understoodAs: understoodAs!,
      prohibitedRepairActions: lists.prohibitedRepairActions!,
      prohibitedValidations: Array.from(new Set(lists.prohibitedValidations!)).sort(),
      requiredEvidence: lists.requiredEvidence!,
      preferredFilesOrAreas: lists.preferredFilesOrAreas!,
      protectedAreas: lists.protectedAreas!,
      requiredApproach: requiredApproach!,
      ownerDecisionSelection: selection || null,
      executionRestrictions: Array.from(new Set(lists.executionRestrictions!)) as ExecutionRestriction[],
    },
  };
}

// ---------------------------------------------------------------------------
// Combined review of a decomposed task

export interface CombinedReviewVerdict {
  verdict: "accepted" | "not_accepted";
  integrates: boolean;
  satisfiesOriginalIntent: boolean;
  conflicts: string[];
  missingPieces: string[];
  /** Plain owner-language summary; null when it was missing or leaked internal jargon. */
  ownerSummary: string | null;
}

export function validateCombinedReview(raw: unknown): Gate<CombinedReviewVerdict> {
  if (!isObj(raw)) return { ok: false, code: "malformed", reason: "combined review is not an object" };
  const conflicts = list(raw, "conflicts");
  const missingPieces = list(raw, "missingPieces");
  const summary = text(raw, "ownerSummary", 400);
  if (!conflicts || !missingPieces || summary === null || typeof raw.integrates !== "boolean" || typeof raw.satisfiesOriginalIntent !== "boolean" || (raw.verdict !== "accepted" && raw.verdict !== "not_accepted"))
    return { ok: false, code: "malformed", reason: "combined review fields missing or mistyped" };
  // The verdict must be consistent with its own findings; any doubt means not accepted.
  const consistent = raw.integrates && raw.satisfiesOriginalIntent && conflicts.length === 0 && missingPieces.length === 0;
  return {
    ok: true,
    value: {
      verdict: raw.verdict === "accepted" && consistent ? "accepted" : "not_accepted",
      integrates: raw.integrates,
      satisfiesOriginalIntent: raw.satisfiesOriginalIntent,
      conflicts,
      missingPieces,
      ownerSummary: summary && findInternalJargon(summary).length === 0 ? summary : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-part repair plan (after a failed combined review)

export interface CombinedRepairTarget {
  area: "programming" | "visual";
  repairObjective: string;
  repairInstructions: string[];
  touchesPaths: string[];
}

export interface CombinedRepairPlan {
  kind: "combined_repair_plan";
  source: "gpt_manager";
  rootCause: string;
  repairStrategy: string;
  strategyChanged: boolean;
  /** Ordered: programming before visual (the UI builds on the logic it consumes). */
  targets: CombinedRepairTarget[];
  ownerDecision: ManagerRepairPlan["ownerDecision"];
  constraintCompliance: { constraintId: string; howHonored: string }[];
}

export function validateCombinedRepairPlan(
  raw: unknown,
  ctx: { parts: readonly { area: "programming" | "visual"; allowedScope: readonly string[] }[]; constraints: readonly GuidanceConstraint[]; stagnated: boolean; previousStrategy: string | null },
): Gate<CombinedRepairPlan> {
  const bad = (code: Exclude<Gate<never>, { ok: true }>["code"], reason: string): Gate<CombinedRepairPlan> => ({ ok: false, code, reason });
  if (!isObj(raw)) return bad("malformed", "combined repair plan is not an object");
  const rootCause = text(raw, "rootCause");
  const strategy = text(raw, "repairStrategy", MAX_ITEM);
  const question = text(raw, "ownerDecisionQuestion", MAX_ITEM);
  const recommended = text(raw, "recommendedOption", 8);
  if (!rootCause || !strategy || question === null || recommended === null) return bad("malformed", "rootCause / repairStrategy missing");
  if (typeof raw.strategyChanged !== "boolean" || typeof raw.ownerDecisionNeeded !== "boolean" || !Array.isArray(raw.targets) || !Array.isArray(raw.ownerOptions) || !Array.isArray(raw.constraintCompliance))
    return bad("malformed", "combined repair plan fields missing or mistyped");
  const targets: CombinedRepairTarget[] = [];
  for (const t of raw.targets) {
    if (!isObj(t) || (t.area !== "programming" && t.area !== "visual")) return bad("malformed", "repair target malformed");
    const part = ctx.parts.find((p) => p.area === t.area);
    if (!part) return bad("scope_violation", `no ${String(t.area)} part exists in this request`);
    if (targets.some((x) => x.area === t.area)) return bad("malformed", "duplicate repair target");
    const objective = text(t, "repairObjective");
    const instructions = list(t, "repairInstructions");
    const paths = list(t, "touchesPaths", 400);
    if (!objective || !instructions || instructions.length === 0 || !paths) return bad("malformed", "repair target needs an objective, instructions and paths");
    if (!paths.every(safePath)) return bad("scope_violation", "unsafe path in a repair target");
    const outside = paths.filter((p) => !inScope(p, part.allowedScope));
    if (outside.length) return bad("scope_violation", `${t.area} repair touches paths outside its part's scope (${outside.slice(0, 3).join(", ")})`);
    if (FORBIDDEN.test(affirmative([objective, ...instructions].join("\n")))) return bad("policy_violation", "repair target requests an action outside Worker authority");
    targets.push({ area: t.area, repairObjective: objective, repairInstructions: instructions, touchesPaths: paths });
  }
  if (FORBIDDEN.test(affirmative(strategy))) return bad("policy_violation", "repair strategy requests an action outside Worker authority");
  const ids = new Set<string>();
  const honoured: { constraintId: string; howHonored: string }[] = [];
  for (const c of raw.constraintCompliance) {
    if (!isObj(c) || typeof c.constraintId !== "string" || typeof c.howHonored !== "string") return bad("malformed", "constraintCompliance entry malformed");
    ids.add(c.constraintId);
    honoured.push({ constraintId: clean(c.constraintId, 64), howHonored: clean(c.howHonored, MAX_ITEM) });
  }
  const missing = ctx.constraints.filter((c) => !ids.has(c.decisionId));
  if (missing.length) return bad("constraint_violation", `plan does not address owner constraint(s) ${missing.map((c) => c.decisionId).join(", ")}`);
  const restrictions = new Set(ctx.constraints.flatMap((c) => c.semantic?.executionRestrictions ?? []));
  if (restrictions.has("no_ui_changes") && targets.some((t) => t.area === "visual")) return bad("constraint_violation", "owner said not to change the UI");
  if (restrictions.has("no_api_changes") && targets.some((t) => t.touchesPaths.some((p) => p.startsWith("server/")))) return bad("constraint_violation", "owner said not to change the API");
  if (ctx.stagnated && (raw.strategyChanged !== true || (ctx.previousStrategy !== null && norm(ctx.previousStrategy) === norm(strategy))))
    return bad("stagnation_ignored", "the previous cross-part repair stagnated but the plan does not change strategy");
  let ownerDecision: CombinedRepairPlan["ownerDecision"] = null;
  if (raw.ownerDecisionNeeded) {
    const opts: { id: string; summary: string }[] = [];
    for (const o of raw.ownerOptions) {
      if (!isObj(o) || typeof o.id !== "string" || typeof o.summary !== "string") return bad("malformed", "owner option malformed");
      const id = clean(o.id, 8);
      const summary = clean(o.summary, MAX_ITEM);
      if (!/^[A-Za-z0-9]{1,8}$/.test(id) || !summary || opts.some((x) => x.id === id) || isDangerousValue(summary) || FORBIDDEN.test(affirmative(summary))) return bad("malformed", "owner option invalid");
      opts.push({ id, summary });
    }
    if (!question || opts.length < 2 || opts.length > 4 || (recommended && !opts.some((o) => o.id === recommended))) return bad("malformed", "an owner decision needs a question and 2-4 options");
    ownerDecision = { question, options: opts, recommended: recommended || null };
  } else if (targets.length === 0) return bad("malformed", "a cross-part repair needs at least one target");
  targets.sort((a, b) => (a.area === b.area ? 0 : a.area === "programming" ? -1 : 1));
  return { ok: true, value: { kind: "combined_repair_plan", source: "gpt_manager", rootCause, repairStrategy: strategy, strategyChanged: raw.strategyChanged, targets, ownerDecision, constraintCompliance: honoured } };
}
