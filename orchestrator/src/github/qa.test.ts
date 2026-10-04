import { describe, expect, it } from "vitest";
import { classifyObservation, evaluateQa, nextPollStep } from "./qa";
import { DEFAULT_REQUIRED_CHECKS, type CheckObservation, type PullRequestInfo, type QaDecision } from "./types";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const pr = (over: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  number: 7,
  state: "open",
  draft: false,
  headSha: HEAD,
  headRef: "agent/x",
  baseRef: "main",
  ...over,
});
const run = (name: string, status: string, conclusion: string | null, sha = HEAD, appSlug = "github-actions"): CheckObservation => ({
  source: "check_run",
  name,
  headSha: sha,
  appSlug,
  status,
  conclusion,
});
const ok = (name: string, sha = HEAD) => run(name, "completed", "success", sha);
const evalChecks = (checks: CheckObservation[], p = pr()) => evaluateQa({ pr: p, required: DEFAULT_REQUIRED_CHECKS, checks });

describe("evaluateQa", () => {
  it("passes only when every required check succeeded on the exact head SHA", () => {
    const d = evalChecks([ok("verify"), ok("full-test")]);
    expect(d.status).toBe("passed");
    expect(d.checks.map((c) => c.outcome)).toEqual(["success", "success"]);
    expect(d.reasons).toEqual([`all 2 required check(s) succeeded on ${HEAD}`]);
  });

  it("never lets checks from an older SHA authorize the current head", () => {
    const d = evalChecks([ok("verify", OLD), ok("full-test", OLD)]);
    expect(d.status).toBe("pending");
    expect(d.checks.map((c) => [c.outcome, c.staleShaIgnored])).toEqual([["missing", 1], ["missing", 1]]);
    expect(d.reasons.join("\n")).toMatch(/ignored 1 result\(s\) from a SHA other than/);
  });

  it("old-SHA success does not mask a current-SHA failure or a missing check", () => {
    expect(evalChecks([ok("verify", OLD), run("verify", "completed", "failure"), ok("full-test")]).status).toBe("failed");
    expect(evalChecks([ok("verify"), ok("full-test", OLD)]).status).toBe("pending");
  });

  it("treats a missing required check as pending (never passed)", () => {
    const d = evalChecks([ok("verify")]);
    expect(d.status).toBe("pending");
    expect(d.checks[1]).toEqual({ name: "full-test", outcome: "missing", observed: 0, staleShaIgnored: 0 });
  });

  it("treats queued / in_progress as pending", () => {
    expect(evalChecks([run("verify", "queued", null), ok("full-test")]).status).toBe("pending");
    expect(evalChecks([run("verify", "in_progress", null), ok("full-test")]).status).toBe("pending");
  });

  it.each(["failure", "cancelled", "timed_out", "startup_failure"])("conclusion %s => failed", (c) => {
    expect(evalChecks([run("verify", "completed", c), ok("full-test")]).status).toBe("failed");
  });

  it.each(["action_required", "stale", "skipped", "neutral"])("conclusion %s => blocked (not a pass)", (c) => {
    expect(evalChecks([run("verify", "completed", c), ok("full-test")]).status).toBe("blocked");
  });

  it("unknown conclusions/statuses fail closed", () => {
    expect(evalChecks([run("verify", "completed", "brand_new_value"), ok("full-test")]).status).toBe("unknown");
    expect(evalChecks([run("verify", "completed", null), ok("full-test")]).status).toBe("unknown");
    expect(evalChecks([run("verify", "weird", null), ok("full-test")]).status).toBe("unknown");
  });

  it("failed outranks blocked, unknown and pending", () => {
    const d = evalChecks([run("verify", "completed", "failure"), run("full-test", "in_progress", null)]);
    expect(d.status).toBe("failed");
    expect(evalChecks([run("verify", "completed", "skipped"), run("full-test", "completed", "???")]).status).toBe("blocked");
  });

  it("resolves duplicate check names to the most severe result, order-independently", () => {
    const a = [ok("verify"), run("verify", "completed", "failure"), ok("full-test")];
    const d1 = evalChecks(a);
    const d2 = evalChecks([...a].reverse());
    expect(d1.status).toBe("failed");
    expect(d1).toEqual(d2);
    expect(d1.checks[0].observed).toBe(2);
    expect(d1.reasons.join("\n")).toMatch(/verify: 2 results on the head SHA; using the most severe \(failed\)/);
    expect(evalChecks([ok("verify"), ok("verify"), ok("full-test")]).status).toBe("passed");
    expect(evalChecks([ok("verify"), run("verify", "queued", null), ok("full-test")]).status).toBe("pending");
  });

  it("ignores same-named checks from another app or source", () => {
    const spoof = run("verify", "completed", "success", HEAD, "some-other-app");
    const status: CheckObservation = { source: "status", name: "verify", headSha: HEAD, appSlug: null, status: "success", conclusion: null };
    expect(evalChecks([spoof, status, ok("full-test")]).status).toBe("pending");
  });

  it("dedupes repeated required entries and refuses an empty requirement list", () => {
    const d = evaluateQa({ pr: pr(), required: [{ name: "verify" }, { name: "verify" }], checks: [ok("verify")] });
    expect(d.status).toBe("passed");
    expect(d.checks).toHaveLength(1);
    expect(evaluateQa({ pr: pr(), required: [], checks: [ok("verify")] }).status).toBe("blocked");
  });

  it("classifies commit statuses", () => {
    const s = (status: string): CheckObservation => ({ source: "status", name: "x", headSha: HEAD, appSlug: null, status, conclusion: null });
    expect(["success", "pending", "failure", "error", "other"].map((v) => classifyObservation(s(v)))).toEqual([
      "success",
      "pending",
      "failed",
      "failed",
      "unknown",
    ]);
  });

  it("blocks merged and closed PRs even with green checks", () => {
    const checks = [ok("verify"), ok("full-test")];
    expect(evalChecks(checks, pr({ state: "merged" }))).toMatchObject({ status: "blocked", reasons: [expect.stringMatching(/merged/)] });
    expect(evalChecks(checks, pr({ state: "closed" }))).toMatchObject({ status: "blocked", reasons: [expect.stringMatching(/closed/)] });
  });

  it("blocks a draft PR even when every required check succeeded", () => {
    const d = evalChecks([ok("verify"), ok("full-test")], pr({ draft: true }));
    expect(d).toMatchObject({ status: "blocked", checks: [], reasons: [expect.stringMatching(/draft/)] });
    expect(nextPollStep(d, 1)).toEqual({ action: "stop", finalStatus: "blocked", reason: "QA blocked" });
  });

  it("rejects a malformed head SHA as unknown", () => {
    expect(evalChecks([ok("verify", "abc"), ok("full-test", "abc")], pr({ headSha: "abc" })).status).toBe("unknown");
  });

  it("is deterministic and does not mutate inputs", () => {
    const checks = [ok("verify"), run("full-test", "queued", null)];
    const frozen = JSON.stringify(checks);
    expect(evalChecks(checks)).toEqual(evalChecks(checks));
    expect(JSON.stringify(checks)).toBe(frozen);
  });
});

describe("nextPollStep", () => {
  const d = (status: QaDecision["status"]): QaDecision => ({ status, prNumber: 7, headSha: HEAD, reasons: [], checks: [] });
  const policy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 3000 };

  it("polls while pending with capped exponential backoff", () => {
    expect([1, 2, 3].map((a) => nextPollStep(d("pending"), a, policy))).toEqual([
      { action: "poll", delayMs: 1000, reason: "QA pending" },
      { action: "poll", delayMs: 2000, reason: "QA pending" },
      { action: "poll", delayMs: 3000, reason: "QA pending" },
    ]);
  });

  it("stops as blocked once the pending budget is exhausted or attempt is invalid", () => {
    expect(nextPollStep(d("pending"), 4, policy)).toMatchObject({ action: "stop", finalStatus: "blocked" });
    expect(nextPollStep(d("pending"), 0, policy)).toMatchObject({ action: "stop", finalStatus: "blocked" });
    expect(nextPollStep(d("pending"), Number.NaN, policy)).toMatchObject({ action: "stop", finalStatus: "blocked" });
  });

  it.each(["passed", "failed", "blocked", "unknown"] as const)("stops on %s", (s) => {
    expect(nextPollStep(d(s), 1, policy)).toEqual({ action: "stop", finalStatus: s, reason: `QA ${s}` });
  });
});
