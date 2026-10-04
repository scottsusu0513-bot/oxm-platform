import { describe, expect, it } from "vitest";
import { qaTaskIntent } from "./intent";
import type { PollStep } from "./qa";
import type { QaDecision } from "./types";

const decision: QaDecision = {
  status: "passed",
  prNumber: 3,
  headSha: "a".repeat(40),
  reasons: ["ok"],
  checks: [{ name: "verify", outcome: "success", observed: 1, staleShaIgnored: 0 }],
};
const A1 = { attempt: 1 };
const stop = (finalStatus: QaDecision["status"]): PollStep => ({ action: "stop", finalStatus, reason: "" });

describe("qaTaskIntent", () => {
  it("maps a passed stop to qa_running -> qa_passed with normalized metadata", () => {
    const r = qaTaskIntent("qa_running", "green", decision, stop("passed"), A1);
    expect(r).toEqual({
      ok: true,
      transition: "qa_passed",
      auditEvent: "qa_passed",
      metadata: { prNumber: 3, headSha: "a".repeat(40), qaStatus: "passed", reasons: ["ok"], checks: decision.checks },
    });
  });

  it.each(["failed", "blocked", "unknown"] as const)("maps a %s stop to failed", (s) => {
    expect(qaTaskIntent("qa_running", "green", { ...decision, status: s }, stop(s), A1)).toMatchObject({
      ok: true,
      transition: "failed",
      auditEvent: `qa_${s}`,
    });
  });

  it("does not transition while polling", () => {
    const r = qaTaskIntent("qa_running", "green", { ...decision, status: "pending" }, { action: "poll", delayMs: 1, reason: "" }, A1);
    expect(r).toMatchObject({ ok: true, transition: null, auditEvent: "qa_polled" });
  });

  it("does not bypass taskState transition rules", () => {
    expect(qaTaskIntent("pr_opened", "green", decision, stop("passed"), A1)).toEqual({
      ok: false,
      reason: "transition pr_opened -> qa_passed is not allowed",
    });
    expect(qaTaskIntent("complete", "green", { ...decision, status: "failed" }, stop("failed"), A1).ok).toBe(false);
  });

  it.each(["failed", "blocked", "unknown", "pending"] as const)("rejects a passed step for a %s decision", (s) => {
    const r = qaTaskIntent("qa_running", "green", { ...decision, status: s }, stop("passed"), A1);
    expect(r.ok).toBe(false);
  });

  it.each(["passed", "failed", "blocked", "unknown"] as const)("rejects a poll step for a %s decision", (s) => {
    const r = qaTaskIntent("qa_running", "green", { ...decision, status: s }, { action: "poll", delayMs: 1, reason: "" }, A1);
    expect(r.ok).toBe(false);
  });

  it("rejects a stop whose finalStatus differs from a non-pending decision", () => {
    expect(qaTaskIntent("qa_running", "green", { ...decision, status: "failed" }, stop("blocked"), A1).ok).toBe(false);
    expect(qaTaskIntent("qa_running", "green", decision, stop("failed"), A1).ok).toBe(false);
  });

  it("allows pending to stop as blocked only once polling is exhausted", () => {
    const pending = { ...decision, status: "pending" as const };
    const policy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 };
    expect(qaTaskIntent("qa_running", "green", pending, stop("blocked"), { attempt: 1, policy }).ok).toBe(false);
    expect(qaTaskIntent("qa_running", "green", pending, stop("blocked"), { attempt: 3, policy })).toMatchObject({
      ok: true,
      transition: "failed",
      auditEvent: "qa_blocked",
    });
    expect(qaTaskIntent("qa_running", "green", pending, { action: "poll", delayMs: 1, reason: "" }, { attempt: 3, policy }).ok).toBe(false);
  });
});
