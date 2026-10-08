import { describe, expect, it } from "vitest";
import { deriveGuidanceConstraint } from "../executive/guidance";
import { constraintAcceptance, constraintChecks, verifyConstraints } from "./constraintCheck";

describe("owner guidance evidence verification", () => {
  const constraint = deriveGuidanceConstraint({
    decisionId: "hd-home",
    round: 2,
    guidance: "不要再跑 typecheck，先查 Home.tsx",
  });

  it("marks the constraint violated when typecheck runs and no direct Home.tsx evidence exists", () => {
    const checks = constraintChecks([constraint], "change");
    const verdicts = verifyConstraints({
      checks,
      changedPaths: ["client/src/pages/Search.tsx"],
      previousChangedPaths: [],
      workerCommands: ["pnpm check"],
      citedFiles: [],
      semantic: new Map(),
    });

    expect(verdicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "no_validation_run:typecheck", status: "violated" }),
        expect.objectContaining({ check: "inspected:Home.tsx", status: "violated" }),
      ]),
    );
    expect(constraintAcceptance(verdicts, "run-1").every((a) => a.status !== "satisfied")).toBe(true);
  });

  it("accepts Manager-readable Home.tsx evidence without treating unrelated typecheck as factual proof", () => {
    const checks = constraintChecks([constraint], "change");
    const verdicts = verifyConstraints({
      checks,
      changedPaths: ["client/src/pages/Search.tsx"],
      previousChangedPaths: [],
      workerCommands: ["pnpm vitest run client/src/pages/Home.test.tsx"],
      citedFiles: ["client/src/pages/Home.tsx"],
      semantic: new Map(),
    });
    const acceptance = constraintAcceptance(verdicts, "run-2");

    expect(verdicts).toEqual([
      expect.objectContaining({ check: "no_validation_run:typecheck", status: "satisfied" }),
      expect.objectContaining({ check: "inspected:Home.tsx", status: "satisfied", evidence: expect.stringContaining("client/src/pages/Home.tsx") }),
    ]);
    expect(acceptance.every((a) => a.status === "satisfied")).toBe(true);
    expect(acceptance.every((a) => a.evidenceType === "constraint_check" && a.reference?.startsWith("constraint:"))).toBe(true);
    expect(JSON.stringify(acceptance)).not.toMatch(/typecheck.*(?:reference|evidenceType).*validation/i);
  });

  it("does not accept a Worker's self-report as proof that Home.tsx was read", () => {
    const verdicts = verifyConstraints({
      checks: constraintChecks([constraint], "change"),
      changedPaths: [],
      previousChangedPaths: [],
      workerCommands: ["echo 'I inspected Home.tsx'"],
      citedFiles: [],
      semantic: new Map(),
    });
    expect(verdicts.find((v) => v.check === "inspected:Home.tsx")).toMatchObject({ status: "violated" });
  });
});
