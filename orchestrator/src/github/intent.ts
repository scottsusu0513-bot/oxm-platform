import { validateTransition } from "../domain/taskState";
import type { RiskLevel, TaskState } from "../domain/types";
import { nextPollStep, type PollPolicy, type PollStep } from "./qa";
import type { QaDecision } from "./types";

/**
 * Maps a QA poll outcome to a task-state/audit *intent*. Nothing is written:
 * the caller applies it via TaskRepository.transition() (which re-validates
 * through domain/taskState) and AuditRepository.append(). Metadata holds only
 * normalized check results — no tokens, headers, or raw API payloads.
 */

export interface QaAuditMetadata {
  prNumber: number;
  headSha: string;
  qaStatus: string;
  reasons: string[];
  checks: { name: string; outcome: string; observed: number; staleShaIgnored: number }[];
}

export type QaTaskIntent =
  | { ok: true; transition: TaskState | null; auditEvent: string; metadata: QaAuditMetadata }
  | { ok: false; reason: string };

export function qaTaskIntent(
  currentState: TaskState,
  riskLevel: RiskLevel,
  decision: QaDecision,
  step: PollStep,
  polling: { attempt: number; policy?: PollPolicy },
): QaTaskIntent {
  // Fail closed: the step must be exactly what nextPollStep derives from the
  // decision, so a caller cannot turn failed/blocked/unknown/pending into passed.
  const expected = nextPollStep(decision, polling.attempt, polling.policy);
  if (step.action !== expected.action) {
    return { ok: false, reason: `poll step ${step.action} is inconsistent with QA ${decision.status}` };
  }
  if (step.action === "stop" && expected.action === "stop" && step.finalStatus !== expected.finalStatus) {
    return {
      ok: false,
      reason: `poll step finalStatus ${step.finalStatus} is inconsistent with QA ${decision.status} (expected ${expected.finalStatus})`,
    };
  }
  const metadata: QaAuditMetadata = {
    prNumber: decision.prNumber,
    headSha: decision.headSha,
    qaStatus: step.action === "stop" ? step.finalStatus : decision.status,
    reasons: [...decision.reasons],
    checks: decision.checks.map(({ name, outcome, observed, staleShaIgnored }) => ({
      name,
      outcome,
      observed,
      staleShaIgnored,
    })),
  };
  if (step.action === "poll") return { ok: true, transition: null, auditEvent: "qa_polled", metadata };

  if (step.finalStatus === "passed" && decision.status !== "passed") {
    return { ok: false, reason: `QA ${decision.status} cannot produce qa_passed` };
  }
  const to: TaskState = step.finalStatus === "passed" ? "qa_passed" : "failed";
  const check = validateTransition(currentState, to, { riskLevel });
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, transition: to, auditEvent: `qa_${step.finalStatus}`, metadata };
}
