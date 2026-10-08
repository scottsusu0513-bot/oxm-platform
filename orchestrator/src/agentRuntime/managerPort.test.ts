import { describe, expect, it } from "vitest";
import { COMBINED_REVIEW_SCHEMA, createStructuredCombinedReviewer, createStructuredGuidanceInterpreter, createStructuredRepairDiagnoser, GUIDANCE_SCHEMA, REPAIR_DIAGNOSIS_SCHEMA, type RepairDiagnosisInput } from "../planning/managerReasoning";
import type { StructuredPlanningRequest } from "../planning/planners";
import { createManagerReasoningPort } from "./managerPort";

const INPUT: RepairDiagnosisInput = {
  taskId: "t1",
  mode: "change",
  intent: "change_code",
  originalRequest: "修正存檔",
  interpretedObjective: "Every save persists.",
  criteria: [{ id: "AC-1", text: "Saves persist", kind: "goal" }],
  allowedScope: ["server/"],
  protectedAreas: ["No git commit."],
  risk: "green",
  requiredValidations: ["tests"],
  validations: [{ name: "tests", status: "failed" }],
  acceptance: [],
  worker: { kind: "claude", status: "success", errorType: null, claim: "fixed" },
  changedPaths: ["server/a.ts"],
  headSha: "a".repeat(40),
  sourceTargets: ["Home.tsx"],
  failure: { failureCode: "validation_failed", failingCheck: "validation:tests", expected: "pass", actual: "fail", fingerprint: "x" },
  round: 1,
  cycle: 1,
  maxCycles: 2,
  previousAttempts: [],
  stagnated: false,
  ownerConstraints: [{ id: "hd-1", summary: "owner guidance: keep the UI" }],
  evidenceRequirements: [],
};

describe("GPT Manager reasoning: prompts, schemas and the runtime adapter", () => {
  it("schemas are strict (every property required, no free-form reasoning field)", () => {
    for (const schema of [REPAIR_DIAGNOSIS_SCHEMA, GUIDANCE_SCHEMA, COMBINED_REVIEW_SCHEMA]) {
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
      expect(Object.keys(schema.properties).join(" ")).not.toMatch(/reason(ing)?\b|thought/i);
    }
  });

  it("the diagnoser prompt carries trusted evidence, stagnation and every owner constraint; the adapter attaches the trusted diff and source", async () => {
    const seen: StructuredPlanningRequest[] = [];
    const backend = { structured: async (r: StructuredPlanningRequest) => (seen.push(r), { ok: true }) };
    const port = createManagerReasoningPort(
      { diagnoser: createStructuredRepairDiagnoser(backend), guidance: createStructuredGuidanceInterpreter(backend), combined: createStructuredCombinedReviewer(backend) },
      {
        timeoutMs: 5_000,
        workingTreeDiff: async (from, paths) => `diff ${from.slice(0, 4)} ${paths.join(",")}\n+fixed`,
        readFile: (p) => (p === "client/src/pages/Home.tsx" ? 'placeholder="搜尋"' : null),
        listFiles: async () => ["client/src/pages/Home.tsx"],
      },
    );
    await port.diagnose!({ ...INPUT, stagnated: true });
    const user = seen[0].user;
    expect(seen[0].schema).toBe(REPAIR_DIAGNOSIS_SCHEMA);
    expect(user).toContain("STAGNATED: true");
    expect(user).toContain("hd-1: owner guidance: keep the UI");
    expect(user).toContain("TRUSTED DIFF:\n<<<\ndiff aaaa server/a.ts\n+fixed");
    expect(user).toContain("--- client/src/pages/Home.tsx");
    expect(user).toContain("WORKER CLAIM (not evidence)");
    expect(seen[0].system).toMatch(/MATERIALLY different repairStrategy/);
  });

  it("every Manager call is bounded by a timeout (fail closed)", async () => {
    const port = createManagerReasoningPort({ guidance: createStructuredGuidanceInterpreter({ structured: () => new Promise(() => {}) }) }, { timeoutMs: 20 });
    await expect(
      port.interpretGuidance!({ taskId: "t", guidance: "x", originalRequest: "x", interpretedObjective: "x", mode: "change", currentBlocker: "", ownerOptions: [], previousConstraints: [], currentWorker: null }),
    ).rejects.toThrow(/timeout/);
  });
});
