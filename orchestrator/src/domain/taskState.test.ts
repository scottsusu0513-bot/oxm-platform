import { describe, expect, it } from "vitest";
import { TASK_STATES } from "./types";
import { assertTransition, isTerminalState, TASK_TRANSITIONS, validateTransition } from "./taskState";

const green = { riskLevel: "green" } as const;
const red = { riskLevel: "red" } as const;

describe("taskState", () => {
  it("defines transitions for every state", () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_STATES].sort());
  });

  it("accepts the green happy path up to the passing PR", () => {
    const path = ["received", "classified", "routed", "queued", "running", "pr_opened", "qa_running", "qa_passed"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(validateTransition(path[i], path[i + 1], green)).toEqual({ ok: true });
    }
  });

  it("production goal: passing PR → deploy approval → deploying → complete only after production verification", () => {
    const deploy = { riskLevel: "green", approvalPhase: "deploy", approved: true } as const;
    expect(validateTransition("qa_passed", "complete", green).ok).toBe(false);
    expect(validateTransition("qa_passed", "awaiting_approval", { riskLevel: "green", approvalPhase: "deploy" })).toEqual({ ok: true });
    expect(validateTransition("awaiting_approval", "deploying", deploy)).toEqual({ ok: true });
    expect(validateTransition("awaiting_approval", "deploying", { ...deploy, approved: false }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "deploying", { ...deploy, approvalPhase: "commit_publish" }).ok).toBe(false);
    // Merge alone (or anything short of verification) is not completion.
    expect(validateTransition("deploying", "complete", green).ok).toBe(false);
    expect(validateTransition("deploying", "complete", { riskLevel: "green", completion: "pull_request" }).ok).toBe(false);
    expect(validateTransition("deploying", "complete", { riskLevel: "green", completion: "production_verified" })).toEqual({ ok: true });
    expect(validateTransition("deploying", "failed", green).ok).toBe(true);
  });

  it("a PR-only goal may complete at the passing PR; a red PR-only goal still needs the post-QA gate", () => {
    expect(validateTransition("qa_passed", "complete", { riskLevel: "green", completion: "pull_request" })).toEqual({ ok: true });
    expect(validateTransition("qa_passed", "complete", { riskLevel: "red", completion: "pull_request" }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "complete", { riskLevel: "red", approvalPhase: "post_qa", approved: true }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "complete", { riskLevel: "red", approvalPhase: "post_qa", approved: true, completion: "pull_request" }).ok).toBe(true);
  });

  it("an Owner decline closes without deployment; never via any other route", () => {
    expect(validateTransition("awaiting_approval", "closed_without_deploy", { riskLevel: "green", declined: true, approvalPhase: "deploy" }).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "closed_without_deploy", { riskLevel: "green", declined: true, approvalPhase: "commit_publish" }).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "closed_without_deploy", { riskLevel: "green", approvalPhase: "deploy" }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "closed_without_deploy", { riskLevel: "red", declined: true, approvalPhase: "pre_execution" }).ok).toBe(false);
    expect(validateTransition("qa_passed", "closed_without_deploy", { riskLevel: "green", declined: true, approvalPhase: "deploy" }).ok).toBe(false);
    expect(isTerminalState("closed_without_deploy")).toBe(true);
  });

  it("an Owner revision returns only a publish-gate task to its Worker, without any approval", () => {
    expect(validateTransition("awaiting_approval", "running", { riskLevel: "green", revision: true, approvalPhase: "commit_publish" }).ok).toBe(true);
    expect(validateTransition("awaiting_approval", "running", { riskLevel: "green", revision: true, approvalPhase: "deploy" }).ok).toBe(false);
    expect(validateTransition("awaiting_approval", "running", { riskLevel: "green", approvalPhase: "commit_publish" }).ok).toBe(false);
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
    for (const s of ["complete", "failed", "cancelled", "closed_without_deploy"] as const) {
      expect(isTerminalState(s)).toBe(true);
      for (const to of TASK_STATES) expect(validateTransition(s, to, green).ok).toBe(false);
    }
    expect(isTerminalState("running")).toBe(false);
  });

  it("accepts the canonical red path through both approval gates", () => {
    const pre = { riskLevel: "red", approvalPhase: "pre_execution", approved: true } as const;
    const post = { riskLevel: "red", approvalPhase: "post_qa", approved: true, completion: "pull_request" } as const;
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

  it("green/yellow tasks never use the red-risk approval entry points", () => {
    for (const riskLevel of ["green", "yellow"] as const) {
      for (const from of ["classified", "routed", "qa_passed"] as const) {
        expect(validateTransition(from, "awaiting_approval", { riskLevel }).ok).toBe(false);
      }
      expect(validateTransition("routed", "queued", { riskLevel }).ok).toBe(true);
      expect(validateTransition("qa_passed", "complete", { riskLevel, completion: "pull_request" }).ok).toBe(true);
    }
  });

  it("red-risk tasks cannot skip approval gates", () => {
    expect(validateTransition("routed", "queued", red).ok).toBe(false);
    expect(validateTransition("qa_passed", "complete", red).ok).toBe(false);
    expect(validateTransition("qa_passed", "awaiting_approval", red).ok).toBe(true);
  });

  it("leaving awaiting_approval requires approval and the matching phase", () => {
    const pre = { riskLevel: "red", approvalPhase: "pre_execution", approved: true } as const;
    const post = { riskLevel: "red", approvalPhase: "post_qa", approved: true, completion: "pull_request" } as const;
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

  it("requires the additional commit approval gate for every risk without replacing red gates", () => {
    for (const riskLevel of ["green", "yellow", "red"] as const) {
      expect(validateTransition("running", "awaiting_approval", { riskLevel }).ok).toBe(true);
      expect(validateTransition("awaiting_approval", "running", { riskLevel, approvalPhase: "commit_publish", approved: true }).ok).toBe(true);
      expect(validateTransition("qa_running", "awaiting_approval", { riskLevel }).ok).toBe(true);
      expect(validateTransition("awaiting_approval", "qa_running", { riskLevel, approvalPhase: "commit_publish", approved: true }).ok).toBe(true);
      expect(validateTransition("awaiting_approval", "running", { riskLevel, approvalPhase: "commit_publish", approved: false }).ok).toBe(false);
    }
    expect(validateTransition("routed", "awaiting_approval", green).ok).toBe(false);
  });
});
