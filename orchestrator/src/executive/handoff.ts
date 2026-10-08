import type { WorkerKind } from "../domain/types";
import type { AcceptanceEvidence, ManagerDiagnosis, ValidationEvidence } from "../manager/types";
import { PROTECTED_AREAS } from "../manager/diagnosis";
import { isDangerousValue, REDACTED } from "../store/sanitize";

/**
 * Structured Worker handoff (Claude <-> Codex) for the SAME task. Pure.
 *
 * Built by the Manager from trusted state only (Git-observed paths, trusted
 * validations/acceptance, Manager diagnoses, repair lineage); the previous
 * Worker's own summary is carried only as an explicitly labelled claim. The
 * receiving Worker continues from exactly this checkpoint: same task, branch,
 * HEAD, objective, acceptance criteria and repair lineage — it never restarts
 * from scratch unless the Manager explicitly diagnosed the work as unusable.
 */

export const HANDOFF_REASONS = ["claude_quota_exhausted", "claude_available_again"] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export interface HandoffSummary {
  kind: "worker_handoff";
  taskId: string;
  lineageId: string;
  branch: string;
  /** Trusted checkpoint HEAD the receiving run must start from. */
  checkpointHeadSha: string;
  from: WorkerKind;
  to: WorkerKind;
  reason: HandoffReason;
  objective: string;
  acceptanceCriteria: string[];
  completed: string[];
  filesInvolved: string[];
  evidence: string[];
  blockers: string[];
  nextActions: string[];
  protectedAreas: string[];
  validationStatus: string[];
  lineage: { round: number; repairAttempt: number; cyclesRecorded: number; previousHandoffs: number };
  /** Always false: a restart needs an explicit Manager diagnosis, which this summary never carries. */
  restartFromScratch: false;
  createdAt: string;
}

const MAX_LINE = 240;
const MAX_ITEMS = 12;

const line = (v: string, max = MAX_LINE) => {
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (isDangerousValue(s)) return REDACTED;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const list = (items: readonly string[], max = MAX_ITEMS) => items.slice(0, max).map((i) => line(i));

export function buildHandoffSummary(input: {
  taskId: string;
  lineageId: string;
  branch: string;
  checkpointHeadSha: string;
  from: WorkerKind;
  to: WorkerKind;
  reason: HandoffReason;
  objective: string;
  acceptanceCriteria: readonly string[];
  changedPaths: readonly string[];
  validations: readonly ValidationEvidence[];
  acceptance: readonly AcceptanceEvidence[];
  latestDiagnosis: ManagerDiagnosis | null;
  lastRun: { runId: string | null; status: string; errorType: string | null; claim: string | null } | null;
  allowedScope: readonly string[];
  round: number;
  repairAttempt: number;
  cyclesRecorded: number;
  previousHandoffs: number;
  now: string;
}): HandoffSummary {
  const completed: string[] = [];
  if (input.lastRun) {
    completed.push(`Last run ${input.lastRun.runId ?? "(none)"} by ${input.from}: ${input.lastRun.status}${input.lastRun.errorType ? ` (${input.lastRun.errorType})` : ""}.`);
    if (input.lastRun.claim) completed.push(`${input.from}'s own report (UNVERIFIED claim, not evidence): ${input.lastRun.claim}`);
  }
  completed.push(input.changedPaths.length ? `Uncommitted task-owned changes already on the branch: ${input.changedPaths.length} path(s).` : "No file changes on the branch yet.");
  const validationStatus = input.validations.map((v) => `${v.name}: ${v.status}${v.trusted ? " (trusted)" : ""}`);
  const evidence = [
    ...validationStatus.map((v) => `validation ${v}`),
    ...input.acceptance.map((a) => `criterion ${a.criterionId}: ${a.status} via ${a.evidenceType}`),
  ];
  const blockers: string[] = [];
  const nextActions: string[] = [];
  if (input.latestDiagnosis) {
    const d = input.latestDiagnosis;
    blockers.push(`${d.failingCheck}: ${d.actual}`);
    nextActions.push(`Continue the open repair: ${d.requiredFix}`);
  }
  if (input.lastRun?.errorType && input.lastRun.errorType !== "quota_exhausted") blockers.push(`Last run ended with ${input.lastRun.errorType}.`);
  nextActions.push(
    "Inspect the existing uncommitted changes first and build on them; do NOT revert or redo completed work.",
    "Finish the remaining objective within the allowed scope and satisfy every acceptance criterion below.",
  );
  return {
    kind: "worker_handoff",
    taskId: input.taskId,
    lineageId: input.lineageId,
    branch: input.branch,
    checkpointHeadSha: input.checkpointHeadSha,
    from: input.from,
    to: input.to,
    reason: input.reason,
    objective: line(input.objective, 600),
    acceptanceCriteria: list(input.acceptanceCriteria),
    completed: list(completed),
    filesInvolved: list(input.changedPaths, 30),
    evidence: list(evidence),
    blockers: list(blockers),
    nextActions: list(nextActions),
    protectedAreas: [line(`Change only paths within allowedScope: ${input.allowedScope.join(", ")}.`), ...PROTECTED_AREAS],
    validationStatus: list(validationStatus),
    lineage: { round: input.round, repairAttempt: input.repairAttempt, cyclesRecorded: input.cyclesRecorded, previousHandoffs: input.previousHandoffs },
    restartFromScratch: false,
    createdAt: input.now,
  };
}

/** Deterministic, data-only rendering appended to the receiving Worker's objective. */
export function renderHandoffBlock(h: HandoffSummary): string {
  const sec = (title: string, items: readonly string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`)] : []);
  return [
    `WORKER HANDOFF (${h.reason}): ${h.from} -> ${h.to}. Same task ${h.taskId}, same branch, same checkpoint HEAD, same acceptance criteria. Continue from this exact point; do not restart from scratch.`,
    `Lineage: round ${h.lineage.round}, repair attempt ${h.lineage.repairAttempt}, cycles ${h.lineage.cyclesRecorded}, handoff #${h.lineage.previousHandoffs + 1}.`,
    ...sec("Already completed", h.completed),
    ...sec("Files involved", h.filesInvolved),
    ...sec("Current evidence", h.evidence),
    ...sec("Current blockers", h.blockers),
    ...sec("Next required actions", h.nextActions),
    ...sec("Validation status", h.validationStatus),
  ].join("\n");
}
