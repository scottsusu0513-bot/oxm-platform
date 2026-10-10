/**
 * Delivery lifecycle policy — pure.
 *
 * What "done" means for a change task that modifies the OXM product, and how a production deployment
 * is judged from trusted observations. No I/O: callers pass structured, already-trusted observations
 * (Render deployment record, production health/smoke results) and act on the verdict.
 *
 *   Owner request → Worker → Manager acceptance → [UI: preview] → Owner publish approval →
 *   commit/push/PR → CI → Owner deploy approval → merge → production deploy → production
 *   verification → completed
 *
 * PR open, CI passed and implementation accepted are NOT completion. A deployment is completed only
 * when the deployed revision provably is the merged commit, the deployment is live (rollout finished)
 * and the production health check and smoke test passed.
 */
import type { DeliveryTarget, TaskMode, TaskState } from "./types";

export const DELIVERY_STAGES = [
  /** CI passed on the published PR; the Owner decides whether to merge + deploy. */
  "awaiting_deploy_approval",
  /** Owner approved; the trusted Git layer is merging the exact approved head. */
  "merging",
  /** Merged; waiting for the production deployment of the merge commit to roll out. */
  "deploying",
  /** The exact commit is live; production health check + smoke test running. */
  "production_verifying",
  "production_verified",
  /** The deployment itself failed (build/update failed, canceled). */
  "deployment_failed",
  /** Verification could not prove success (SHA mismatch, health/smoke failure, deploy never received). */
  "blocked",
  "closed_without_deploy",
] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

/** Owner-facing lifecycle of a task (one name per meaningful phase; derived, never stored). */
export const LIFECYCLE_PHASES = [
  "working",
  "implementation_accepted",
  "preview_ready",
  "awaiting_publish_approval",
  "publishing",
  "pr_open",
  "ci_pending",
  "awaiting_deploy_approval",
  "deploying",
  "production_verifying",
  "completed",
  "blocked",
  "deployment_failed",
  "cancelled",
  "closed_without_deploy",
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const PREVIEW_STATUSES = ["starting", "ready", "unavailable", "stopped"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export interface LifecycleInput {
  state: TaskState;
  /** Orchestration status (string to keep this module independent of the scheduler). */
  status: string;
  mode: TaskMode;
  approvalPhase: string | null;
  deliveryStage: DeliveryStage | null;
  previewStatus: PreviewStatus | null;
  hasPr: boolean;
  /** A commit / push / PR side effect is in flight after publish approval. */
  publishing: boolean;
}

/** Owner-facing lifecycle phase from trusted task state. "completed" only for a verified terminal success. */
export function deriveLifecyclePhase(i: LifecycleInput): LifecyclePhase {
  if (i.state === "cancelled") return "cancelled";
  if (i.state === "closed_without_deploy") return "closed_without_deploy";
  if (i.state === "complete") return "completed";
  if (i.deliveryStage === "deployment_failed") return "deployment_failed";
  if (i.state === "failed" || i.status === "blocked") return "blocked";
  if (i.state === "deploying") return i.deliveryStage === "production_verifying" ? "production_verifying" : "deploying";
  if (i.state === "awaiting_approval" && i.approvalPhase === "deploy") return "awaiting_deploy_approval";
  if (i.state === "awaiting_approval" && i.approvalPhase === "commit_publish") return i.previewStatus === "ready" ? "preview_ready" : "awaiting_publish_approval";
  if (i.publishing) return "publishing";
  if (i.state === "pr_opened") return "pr_open";
  if (i.state === "qa_running" || i.state === "qa_passed") return "ci_pending";
  if (i.status === "waiting_group") return "implementation_accepted";
  return "working";
}

export function deliveryTargetOf(goal: { deliveryTarget?: DeliveryTarget } | null | undefined): DeliveryTarget {
  return goal?.deliveryTarget === "pull_request" ? "pull_request" : "production";
}

// ---------------------------------------------------------------------------
// Deployment judgment

/** Render deploy statuses (https://api-docs.render.com: deploy.status). Unknown values are never success. */
export const RENDER_DEPLOY_STATUSES = [
  "created",
  "queued",
  "build_in_progress",
  "update_in_progress",
  "pre_deploy_in_progress",
  "live",
  "deactivated",
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
  "canceled",
] as const;
export type RenderDeployStatus = (typeof RENDER_DEPLOY_STATUSES)[number] | "unknown";

const IN_PROGRESS: readonly RenderDeployStatus[] = ["created", "queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"];
const FAILED: readonly RenderDeployStatus[] = ["build_failed", "update_failed", "pre_deploy_failed", "canceled"];

export interface DeploymentObservation {
  /** unconfigured: no trusted deployment observer exists (credentials / service id missing). */
  observer: "configured" | "unconfigured" | "unavailable";
  /** The production deployment whose commit is the merged SHA (null: none received yet). */
  deploy: { id: string; status: RenderDeployStatus; commitSha: string } | null;
  /**
   * When the merged commit's own deployment is no longer live because a later deployment replaced it:
   * the live deployment's commit and whether it provably contains the merged commit.
   */
  live?: { id: string; commitSha: string; containsMerged: boolean } | null;
}

export interface ProductionChecks {
  health: { ok: boolean; detail: string };
  smoke: { ok: boolean; detail: string };
}

export type DeploymentVerdict =
  | { kind: "waiting"; stage: "deploying"; code: string; reason: string }
  | { kind: "verify"; stage: "production_verifying"; code: "deploy_live"; reason: string }
  | { kind: "retry_checks"; stage: "production_verifying"; code: string; reason: string }
  | { kind: "verified"; stage: "production_verified"; code: "production_verified"; reason: string }
  | { kind: "deployment_failed"; stage: "deployment_failed"; code: string; reason: string }
  | { kind: "blocked"; stage: "blocked"; code: string; reason: string }
  | { kind: "unobservable"; stage: "deploying"; code: string; reason: string };

export interface DeploymentJudgeInput {
  mergeSha: string;
  observation: DeploymentObservation;
  /** Present only once the exact deployment is live. */
  checks?: ProductionChecks | null;
  /** Consecutive verification rounds whose checks failed before this one. */
  priorCheckFailures: number;
  maxCheckFailures: number;
  /** Time since the merge (ms) and how long a deployment may take to appear. */
  elapsedMs: number;
  receiveWindowMs: number;
  /** Bound on the whole rollout (build + deploy) after it was received. */
  rolloutWindowMs: number;
}

/**
 * Deterministic deployment verdict. Success requires ALL of: a deployment record for the merged SHA,
 * status live (rollout complete), the deployed commit equal to the merged SHA (or a live successor that
 * provably contains it), and a passing health check AND smoke test.
 */
export function judgeDeployment(i: DeploymentJudgeInput): DeploymentVerdict {
  const o = i.observation;
  if (o.observer === "unconfigured")
    return { kind: "unobservable", stage: "deploying", code: "deploy_observer_unconfigured", reason: "no trusted production deployment observer is configured; the deployment cannot be verified" };
  if (o.observer === "unavailable")
    return { kind: "waiting", stage: "deploying", code: "deploy_observer_unavailable", reason: "the production deployment observer is temporarily unavailable" };
  if (!o.deploy) {
    if (i.elapsedMs > i.receiveWindowMs)
      return { kind: "blocked", stage: "blocked", code: "deploy_not_received", reason: "no production deployment of the merged commit was received" };
    return { kind: "waiting", stage: "deploying", code: "deploy_not_received_yet", reason: "waiting for the production deployment of the merged commit" };
  }
  if (o.deploy.commitSha !== i.mergeSha)
    return { kind: "blocked", stage: "blocked", code: "deployed_sha_mismatch", reason: "the observed deployment is not the merged commit" };
  const s = o.deploy.status;
  if (FAILED.includes(s)) return { kind: "deployment_failed", stage: "deployment_failed", code: `deploy_${s}`, reason: `production deployment ${s.replace(/_/g, " ")}` };
  if (IN_PROGRESS.includes(s)) {
    if (i.elapsedMs > i.receiveWindowMs + i.rolloutWindowMs)
      return { kind: "blocked", stage: "blocked", code: "deploy_rollout_timeout", reason: "the production deployment did not finish rolling out in time" };
    return { kind: "waiting", stage: "deploying", code: `deploy_${s}`, reason: "the production deployment is still rolling out" };
  }
  if (s === "deactivated") {
    // Replaced by a later deployment: verified only if the live one provably contains the merged commit.
    if (!o.live || !o.live.containsMerged)
      return { kind: "blocked", stage: "blocked", code: "deployed_revision_unproven", reason: "the merged commit's deployment was replaced and the live revision cannot be proven to contain it" };
  } else if (s !== "live") {
    return { kind: "blocked", stage: "blocked", code: "deploy_status_unknown", reason: "the production deployment reported an unknown status" };
  }
  if (!i.checks) return { kind: "verify", stage: "production_verifying", code: "deploy_live", reason: "the merged commit is live; verifying production" };
  if (i.checks.health.ok && i.checks.smoke.ok) return { kind: "verified", stage: "production_verified", code: "production_verified", reason: "deployment live on the merged commit; health check and smoke test passed" };
  const failed = !i.checks.health.ok ? "production_health_failed" : "production_smoke_failed";
  if (i.priorCheckFailures + 1 < i.maxCheckFailures)
    return { kind: "retry_checks", stage: "production_verifying", code: failed, reason: "production checks did not pass yet; re-checking" };
  return { kind: "blocked", stage: "blocked", code: failed, reason: !i.checks.health.ok ? `production health check failed: ${i.checks.health.detail}` : `production smoke test failed: ${i.checks.smoke.detail}` };
}
