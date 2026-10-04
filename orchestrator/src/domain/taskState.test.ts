import { describe, expect, it } from "vitest";
import { TASK_STATES } from "./types";
import { assertTransition, isTerminalState, TASK_TRANSITIONS, validateTransition } from "./taskState";

const green = { riskLevel: "green" } as const;
const red = { riskLevel: "red" } as const;

describe("taskState", () => {
  it("defines transitions for every state", () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATES].sort());
  });

  it("accepts the green happy path", () => {
    const path = ["received", "classified", "routed", "queued", "running", "pr_opened", "qa_running", "qa_passed", "complete"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(validateTransition(path[i], path[i + 1], green)).toEqual({ ok: true });
    }
  });

  it("rejects invalid transitions deterministically", () => {
    const a = validateTransition("received", "running", green);
    const b = validateTransition("received", "running", green);
    expect(a.ok).toBe(false);
    expect(a).toEqual(b);
    expect(validateTransition("queued", "complete", green).ok).toBe(false);
    expect(validateTransition("pr_opened", "qa_passed", green).ok).toBe(false);
    expect(() => assertTransition("received", "running", green)).toThrow(/not allowed/);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["complete", "failed", "cancelled"] as const) {
      expect(isTerminalState(s)).toBe(true);
      for (const to of TASK_STATES) expect(validateTransition(s, to, green).ok).toBe(false);
    }
    expect(isTerminalState("running")).toBe(false);
  });

  it("accepts the canonical red path through both approval gates", () => {
    const pre = { riskLevel: "red", approvalPhase: "pre_execution", approved: true } as const;
    const post = { riskLevel: "red", approvalPhase: "post_qa", approved: true } as const;
    const steps = [
      ["received", "classified", red],
      ["classified", "routed", red],
      ["routed", "awaiting_approval", red],
      ["awaiting_approval", "queued", pre],
      ["queued", "running", red],
      ["running", "pr_opened", red],
      ["pr_opened", "qa_running", red],
      ["qa_running", "qa_passed", red],
      ["qa_passed", "awaiting_approval", red],
      ["awaiting_approval", "complete", post],
    ] as const;
    for (const [from, to, ctx] of steps) {
      expect(validateTransition(from, to, ctx)).toEqual({ ok: true });
    }
  });

  it("pre-execution awaiting_approval is entered only from routed, and only for red", () => {
    expect(validateTransition("routed", "awaiting_approval", red).ok).toBe(true);
    expect(validateTransition("classified", "awaiting_approval", red).ok).toBe(false);
    expect(validateTransition("classified", "awaiting_approval", green).ok).toBe(false);
    expect(validateTransition("routed", "awaiting_approval", green).ok).toBe(false);
    expect(validateTransition("routed", "awaiting_approval", { riskLevel: "yellow" }).ok).toBe(false);
  });

  it("green/yellow tasks never use awaiting_approval", () => {
    for (const riskLevel of ["green", "yellow"] as const) {
      for (const from of ["classified", "routed", "qa_passed"] as const) {
        expect(validateTransition(from, "awaiting_approval", { riskLevel }).ok).toBe(false);
      }
      expect(validateTransition("routed", "queued", { riskLevel }).ok).toBe(true);
      expect(validateTransition("qa_passed", "complete", { riskLevel }).ok).toBe(true);
    }
  });

  it("red-risk tasks cannot skip approval gates", () => {
    expect(validateTransition("routed", "queued", red).ok).toBe(false);
    expect(validateTransition("qa_passed", "complete", red).ok).toBe(false);
    expect(validateTransition("qa_passed", "awaiting_approval", red).ok).toBe(true);
  });

  it("leaving awaiting_approval requires approval and the matching phase", () => {
    const pre = { riskLevel: "red", approvalPhase: "pre_execution", approved: true } as const;
    const post = { riskLevel: "red", approvalPhase: "post_qa", approved: true } as const;
    expect(validateTransition("awaiting_approval", "queued", pre).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "routed", pre).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "routed", post).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "complete", pre).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "complete", post).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "queued", post).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "queued", { ...pre, approved: false }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "queued", red).ok).toBe(false);
    // rejection/abort is always possible
    expect(validateTransition("awaiting_approval", "cancelled", red).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "failed", red).ok).toBe(true);
  });
});
