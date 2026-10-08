import { describe, expect, it } from "vitest";
import { semanticGuidanceConstraint, type SemanticGuidance } from "../executive/guidance";
import { validateCombinedReview, validateGuidanceInterpretation, validateManagerRepairPlan, type RepairPlanContext } from "./managerPlan";

const CTX: RepairPlanContext = {
  mode: "change",
  allowedScope: ["server/search/", "client/src/pages/Search.tsx"],
  requiredValidations: ["tests", "typecheck"],
  policyProtectedAreas: ["No git add/commit/push: the trusted Git layer owns commits."],
  constraints: [],
  stagnated: false,
  previousStrategy: null,
};

export const goodPlan = (over: Record<string, unknown> = {}) => ({
  rootCause: "The ranking query ignores the verified flag, so verified factories are not first.",
  whyPreviousAttemptFailed: "",
  missingEvidence: [],
  repairStrategy: "Add the verified flag to the ORDER BY of the search query",
  strategyChanged: false,
  repairObjective: "Verified factories rank first in search results.",
  repairInstructions: ["Update server/search/query.ts to order by verified DESC before score.", "Add a test covering verified-first ordering."],
  protectedAreas: ["Do not change the search page layout."],
  requiredEvidence: ["A test showing a verified factory ranked above an unverified one"],
  validationPlan: ["tests", "typecheck"],
  touchesPaths: ["server/search/query.ts"],
  restartFromScratch: false,
  ownerDecisionNeeded: false,
  ownerDecisionQuestion: "",
  ownerOptions: [],
  recommendedOption: "",
  constraintCompliance: [],
  ...over,
});

const semantic = (over: Partial<SemanticGuidance> = {}): SemanticGuidance => ({
  understoodAs: "先查 Home.tsx，不要再用 typecheck 當主要驗收",
  prohibitedRepairActions: ["rerun typecheck as the main check"],
  prohibitedValidations: ["typecheck"],
  requiredEvidence: ["the homepage search input source"],
  preferredFilesOrAreas: ["client/src/pages/Home.tsx"],
  protectedAreas: [],
  requiredApproach: "",
  ownerDecisionSelection: null,
  executionRestrictions: [],
  ...over,
});

describe("GPT repair plan policy gate", () => {
  it("accepts a well-formed plan and keeps only structured fields (no reasoning transcript), policy areas always included", () => {
    const g = validateManagerRepairPlan({ ...goodPlan(), reasoning: "step by step I think…", chainOfThought: "…" }, CTX);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(Object.keys(g.value).sort()).toEqual(
      ["constraintCompliance", "kind", "missingEvidence", "ownerDecision", "protectedAreas", "repairInstructions", "repairObjective", "repairStrategy", "requiredEvidence", "restartFromScratch", "rootCause", "source", "strategyChanged", "touchesPaths", "validationPlan", "whyPreviousAttemptFailed"].sort(),
    );
    expect(JSON.stringify(g.value)).not.toMatch(/step by step|chainOfThought/);
    expect(g.value.protectedAreas[0]).toBe(CTX.policyProtectedAreas[0]);
  });

  it.each([
    ["scope expansion", { touchesPaths: ["server/auth/session.ts"] }, "scope_violation"],
    ["unsafe path", { touchesPaths: ["../etc/passwd"] }, "scope_violation"],
    ["extra validation", { validationPlan: ["smoke"] }, "scope_violation"],
    ["git authority", { repairInstructions: ["Fix it, then git commit and push the branch."] }, "policy_violation"],
    ["deploy", { repairObjective: "Deploy the fix to production." }, "policy_violation"],
    ["lower risk", { repairInstructions: ["Lower the risk level so no approval is needed."] }, "policy_violation"],
    ["weaken tests", { repairInstructions: ["Skip the tests that fail."] }, "policy_violation"],
    ["prod db", { repairInstructions: ["Run the migrations against the production database."] }, "policy_violation"],
    ["malformed", { repairInstructions: "do it" }, "malformed"],
    ["missing root cause", { rootCause: "" }, "malformed"],
  ])("refuses %s", (_label, over, code) => {
    expect(validateManagerRepairPlan(goodPlan(over), CTX)).toMatchObject({ ok: false, code });
  });

  it("negated prohibitions are not requests", () => {
    expect(validateManagerRepairPlan(goodPlan({ repairInstructions: ["Change server/search/query.ts.", "Do not push or deploy; do not skip the tests."] }), CTX).ok).toBe(true);
  });

  it("cannot change mutability: a read-only task gets no file paths and no edit steps", () => {
    const ro = { ...CTX, mode: "read_only" as const, requiredValidations: ["typecheck"] };
    expect(validateManagerRepairPlan(goodPlan({ validationPlan: [] }), ro)).toMatchObject({ ok: false, code: "mutability_violation" });
    expect(validateManagerRepairPlan(goodPlan({ touchesPaths: [], validationPlan: [], repairInstructions: ["Modify Home.tsx to show the value."] }), ro)).toMatchObject({ ok: false, code: "mutability_violation" });
    expect(validateManagerRepairPlan(goodPlan({ touchesPaths: [], validationPlan: [], repairInstructions: ["Read client/src/pages/Home.tsx and quote the placeholder with its line."] }), ro).ok).toBe(true);
  });

  it("stagnation demands a materially different strategy", () => {
    const st = { ...CTX, stagnated: true, previousStrategy: "Add the verified flag to the ORDER BY of the search query" };
    expect(validateManagerRepairPlan(goodPlan(), st)).toMatchObject({ ok: false, code: "stagnation_ignored" });
    expect(validateManagerRepairPlan(goodPlan({ strategyChanged: true }), st)).toMatchObject({ ok: false, code: "stagnation_ignored" });
    expect(validateManagerRepairPlan(goodPlan({ strategyChanged: true, repairStrategy: "Compute ranking in the service layer with an explicit verified-first comparator" }), st).ok).toBe(true);
  });

  it("must honour every durable owner constraint (semantic), including prohibited validations and kept progress", () => {
    const c = semanticGuidanceConstraint({ decisionId: "hd-1", round: 2, guidance: "不要再跑 typecheck，先查 Home.tsx", semantic: semantic({ executionRestrictions: ["keep_existing_progress"] }) });
    const ctx = { ...CTX, constraints: [c] };
    expect(validateManagerRepairPlan(goodPlan({ validationPlan: ["tests"] }), ctx)).toMatchObject({ ok: false, code: "constraint_violation" }); // compliance missing
    const comply = [{ constraintId: "hd-1", howHonored: "Reads Home.tsx first; typecheck is not the main check." }];
    expect(validateManagerRepairPlan(goodPlan({ constraintCompliance: comply }), ctx)).toMatchObject({ ok: false, code: "constraint_violation" }); // typecheck again
    expect(validateManagerRepairPlan(goodPlan({ constraintCompliance: comply, validationPlan: ["tests"], restartFromScratch: true }), ctx)).toMatchObject({ ok: false, code: "constraint_violation" });
    expect(validateManagerRepairPlan(goodPlan({ constraintCompliance: comply, validationPlan: ["tests"] }), ctx).ok).toBe(true);
    const noUi = semanticGuidanceConstraint({ decisionId: "hd-2", round: 2, guidance: "先不要改 UI，只修 API", semantic: semantic({ prohibitedValidations: [], executionRestrictions: ["no_ui_changes"] }) });
    expect(
      validateManagerRepairPlan(goodPlan({ constraintCompliance: [{ constraintId: "hd-2", howHonored: "API only" }], touchesPaths: ["client/src/pages/Search.tsx"] }), { ...CTX, constraints: [noUi] }),
    ).toMatchObject({ ok: false, code: "constraint_violation" });
  });

  it("an owner decision needs a question and 2-4 valid options", () => {
    const ask = { ownerDecisionNeeded: true, ownerDecisionQuestion: "要用哪種排序？", ownerOptions: [{ id: "A", summary: "認證工廠優先" }, { id: "B", summary: "評分優先" }], recommendedOption: "A" };
    const g = validateManagerRepairPlan(goodPlan(ask), CTX);
    expect(g.ok && g.value.ownerDecision).toEqual({ question: "要用哪種排序？", options: ask.ownerOptions, recommended: "A" });
    expect(validateManagerRepairPlan(goodPlan({ ...ask, ownerOptions: [{ id: "A", summary: "x" }] }), CTX)).toMatchObject({ ok: false, code: "malformed" });
    expect(validateManagerRepairPlan(goodPlan({ ...ask, recommendedOption: "C" }), CTX)).toMatchObject({ ok: false, code: "malformed" });
  });
});

describe("guidance interpretation gate", () => {
  const raw = (over: Record<string, unknown> = {}) => ({ ...semantic(), ownerDecisionSelection: "", ...over });
  it("validates enums, option selection and authority", () => {
    expect(validateGuidanceInterpretation(raw(), { optionIds: [] })).toMatchObject({ ok: true, value: { prohibitedValidations: ["typecheck"], ownerDecisionSelection: null } });
    expect(validateGuidanceInterpretation(raw({ ownerDecisionSelection: "B" }), { optionIds: ["A", "B"] })).toMatchObject({ ok: true, value: { ownerDecisionSelection: "B" } });
    expect(validateGuidanceInterpretation(raw({ ownerDecisionSelection: "C" }), { optionIds: ["A", "B"] })).toMatchObject({ ok: false });
    expect(validateGuidanceInterpretation(raw({ prohibitedValidations: ["lint"] }), { optionIds: [] })).toMatchObject({ ok: false });
    expect(validateGuidanceInterpretation(raw({ executionRestrictions: ["approve_merge"] }), { optionIds: [] })).toMatchObject({ ok: false });
    expect(validateGuidanceInterpretation(raw({ requiredApproach: "Deploy to production right after the fix" }), { optionIds: [] })).toMatchObject({ ok: false, code: "policy_violation" });
    expect(validateGuidanceInterpretation("whatever", { optionIds: [] })).toMatchObject({ ok: false, code: "malformed" });
  });

  it("the semantic reading is primary; the keyword reading only adds", () => {
    const c = semanticGuidanceConstraint({ decisionId: "d", round: 2, guidance: "這部分先維持原樣，沿用 Codex 現在的進度", semantic: semantic({ prohibitedValidations: [], preferredFilesOrAreas: [], protectedAreas: ["the search page layout"], executionRestrictions: ["keep_existing_progress", "no_restart"] }) });
    expect(c).toMatchObject({ source: "gpt_manager", rejectedValidations: [], semantic: { protectedAreas: ["the search page layout"], executionRestrictions: ["keep_existing_progress", "no_restart"] } });
  });
});

describe("combined review gate", () => {
  it("an inconsistent 'accepted' verdict is not accepted; jargon never reaches the owner", () => {
    expect(validateCombinedReview({ verdict: "accepted", integrates: false, satisfiesOriginalIntent: true, conflicts: [], missingPieces: [], ownerSummary: "畫面沒有用到新的排序欄位。" })).toMatchObject({ ok: true, value: { verdict: "not_accepted" } });
    expect(validateCombinedReview({ verdict: "accepted", integrates: true, satisfiesOriginalIntent: true, conflicts: [], missingPieces: [], ownerSummary: "AC-1 acceptance_unverified" })).toMatchObject({ ok: true, value: { verdict: "accepted", ownerSummary: null } });
    expect(validateCombinedReview({ verdict: "maybe" })).toMatchObject({ ok: false, code: "malformed" });
  });
});
