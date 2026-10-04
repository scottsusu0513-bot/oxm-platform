import type { OrchestrationStatus } from "./types";

/**
 * Explicit task dependencies. The graph is declared at intake; nothing here
 * infers dependencies. A dependency is satisfied only when the dependency
 * task was accepted by the Manager Loop; a blocked dependency (or an
 * unknown one) fails the dependent closed.
 */

export type DependencyState =
  | { state: "satisfied" }
  | { state: "waiting"; on: string[] }
  | { state: "failed"; on: string[]; reason: string };

export function dependencyState(dependsOn: readonly string[], statusOf: (taskId: string) => OrchestrationStatus | null): DependencyState {
  const deps = Array.from(new Set(dependsOn)).sort();
  const missing = deps.filter((d) => statusOf(d) === null);
  if (missing.length > 0) return { state: "failed", on: missing, reason: `unknown dependency: ${missing.join(", ")}` };
  const failed = deps.filter((d) => statusOf(d) === "blocked");
  if (failed.length > 0) return { state: "failed", on: failed, reason: `dependency blocked: ${failed.join(", ")}` };
  const waiting = deps.filter((d) => statusOf(d) !== "accepted");
  if (waiting.length > 0) return { state: "waiting", on: waiting };
  return { state: "satisfied" };
}

/**
 * Returns one dependency cycle (as a closed path, e.g. [a, b, a]) or null.
 * Deterministic: nodes and edges are visited in sorted order.
 */
export function findDependencyCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    color.set(node, 1);
    stack.push(node);
    for (const next of Array.from(new Set(graph.get(node) ?? [])).sort()) {
      const c = color.get(next) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (c === 0 && graph.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  };
  for (const node of Array.from(graph.keys()).sort()) {
    if ((color.get(node) ?? 0) === 0) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}
