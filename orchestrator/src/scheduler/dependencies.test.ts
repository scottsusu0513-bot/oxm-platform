import { describe, expect, it } from "vitest";
import { dependencyState, findDependencyCycle } from "./dependencies";
import type { OrchestrationStatus } from "./types";

const statuses = (m: Record<string, OrchestrationStatus>) => (id: string) => m[id] ?? null;

describe("dependency state", () => {
  it("no dependencies are satisfied", () => {
    expect(dependencyState([], statuses({}))).toEqual({ state: "satisfied" });
  });

  it("simple dependency waits until the dependency is accepted", () => {
    expect(dependencyState(["b"], statuses({ b: "running" }))).toEqual({ state: "waiting", on: ["b"] });
    expect(dependencyState(["b"], statuses({ b: "qa_pending" }))).toEqual({ state: "waiting", on: ["b"] });
    expect(dependencyState(["b"], statuses({ b: "accepted" }))).toEqual({ state: "satisfied" });
  });

  it("multi-level dependency only waits on direct, unaccepted dependencies", () => {
    expect(dependencyState(["b", "c"], statuses({ b: "accepted", c: "waiting_dependency" }))).toEqual({ state: "waiting", on: ["c"] });
  });

  it("failed/blocked dependency fails the dependent", () => {
    expect(dependencyState(["b", "c"], statuses({ b: "accepted", c: "blocked" }))).toMatchObject({ state: "failed", on: ["c"] });
  });

  it("unknown dependency fails closed", () => {
    expect(dependencyState(["ghost"], statuses({}))).toMatchObject({ state: "failed", reason: "unknown dependency: ghost" });
  });
});

describe("dependency cycles", () => {
  it("detects a direct cycle deterministically", () => {
    expect(findDependencyCycle(new Map([["a", ["b"]], ["b", ["a"]]]))).toEqual(["a", "b", "a"]);
  });

  it("detects a multi-level cycle", () => {
    const g = new Map<string, string[]>([["a", ["b"]], ["b", ["c"]], ["c", ["a"]], ["d", []]]);
    expect(findDependencyCycle(g)).toEqual(["a", "b", "c", "a"]);
  });

  it("detects self-dependency", () => {
    expect(findDependencyCycle(new Map([["a", ["a"]]]))).toEqual(["a", "a"]);
  });

  it("acyclic graphs (including diamonds) pass; independent tasks unaffected", () => {
    const g = new Map<string, string[]>([["a", ["b", "c"]], ["b", ["d"]], ["c", ["d"]], ["d", []], ["x", []]]);
    expect(findDependencyCycle(g)).toBeNull();
  });
});
