/**
 * Trusted delivery control plane — types.
 *
 * Merge, production deployment observation and production verification happen ONLY here, ONLY after
 * an Owner deploy approval that is bound to the exact evidence below, and ONLY on behalf of the Manager
 * Loop's deploy gate. Workers never see these ports; the Manager never decides to call them; no
 * credential ever reaches a Worker, a Manager prompt, the repository or a log.
 */
import type { DeploymentObservation, ProductionChecks, PreviewStatus } from "../domain/delivery";
import type { RiskLevel } from "../domain/types";
import type { Approval } from "../store/types";

export const DEPLOY_ACTION = "merge_and_deploy_production" as const;

/** Exactly what an Owner deploy approval authorizes (and nothing else). */
export interface DeployAuthorization {
  merge: true;
  deploy: true;
  commit: false;
  push: false;
  forcePush: false;
  productionDatabase: false;
}

export const DEPLOY_AUTHORIZATION: DeployAuthorization = Object.freeze({ merge: true, deploy: true, commit: false, push: false, forcePush: false, productionDatabase: false });

/** Sanitized deploy evidence the Owner decides on; its canonical hash is the approval binding. */
export interface DeployApprovalEvidence {
  taskId: string;
  lineageId: string;
  prNumber: number;
  /** Exact PR head the Owner reviewed (CI passed on it). Drift invalidates the approval. */
  headSha: string;
  baseBranch: "main";
  ci: { status: "passed"; checks: { name: string; outcome: string }[] };
  risk: RiskLevel;
  /** Items the Manager could not verify before deployment (validation names). */
  unverified: string[];
  action: typeof DEPLOY_ACTION;
  authorization: DeployAuthorization;
}

export type MergeError =
  | "deploy_capability_disabled"
  | "pr_not_open"
  | "pr_head_moved"
  | "pr_base_not_main"
  | "pr_not_mergeable"
  | "merge_rejected"
  | "merge_unverified"
  | "transport_failed";

/** Trusted, read-only state of the approved PR (from GitHub, never from Worker or Owner input). */
export interface TrustedPrState {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  headSha: string;
  baseRef: string;
  /** Merge commit on the base branch when merged (GitHub merge_commit_sha). */
  mergeSha: string | null;
}

export interface DeliveryPort {
  /** Whether this runtime was explicitly enabled to merge + deploy after Owner approval. */
  readonly enabled: boolean;
  /** Re-reads the PR from GitHub (exact head, open, base). */
  prState(prNumber: number): Promise<TrustedPrState | null>;
  /**
   * Merges exactly the approved head (GitHub rejects a moved head). Requires an Owner deploy approval of
   * kind "deploy"; the port re-checks kind and binding before any write.
   */
  mergeApproved(input: { evidence: DeployApprovalEvidence; approval: Approval; binding: string }): Promise<{ ok: true; mergeSha: string } | { ok: false; error: MergeError }>;
  /** Trusted production deployment observation for the merged commit (Render API). */
  observeDeployment(mergeSha: string): Promise<DeploymentObservation>;
  /** Production health check + smoke test (read-only HTTP). */
  verifyProduction(): Promise<ProductionChecks>;
  /** Owner-facing name of the production site (host only; never a credential). */
  readonly productionHost: string | null;
}

/** Persisted delivery record of one task (checkpoint). Structured facts only. */
export interface DeliveryRecord {
  target: "production";
  stage: import("../domain/delivery").DeliveryStage;
  prNumber: number;
  /** Exact head the deploy approval is bound to. */
  headSha: string;
  lineageId: string;
  evidence: DeployApprovalEvidence | null;
  binding: string | null;
  approvalId: string | null;
  approvedAt: string | null;
  mergeSha: string | null;
  mergedAt: string | null;
  deploy: { id: string; status: string; commitSha: string } | null;
  checks: ProductionChecks | null;
  checkFailures: number;
  polls: number;
  verifiedAt: string | null;
  failure: { code: string; reason: string } | null;
  /** The trusted observer is not configured: the deployment cannot be verified (never assumed). */
  observerMissing: boolean;
}

// ---------------------------------------------------------------------------
// Preview (UI tasks)

export interface PreviewResult {
  status: Extract<PreviewStatus, "ready" | "unavailable">;
  /** HTTPS URL read from the Codespaces port-forwarding record (never constructed). */
  url: string | null;
  port: number | null;
  /** Port visibility as reported by Codespaces (private = GitHub sign-in of the owner required). */
  visibility: "private" | "org" | "public" | null;
  /** Owner-facing access notes (sign-in requirements). */
  access: "github_sign_in" | "public" | null;
  /** Unavailable: why (safe code). */
  reason: string | null;
  /** True when this request reused an already running preview server. */
  reused: boolean;
}

export interface PreviewPort {
  /** Starts (or reuses) the repo's own dev server for the workspace and resolves its forwarded URL. */
  ensure(input: { taskId: string; branch: string }): Promise<PreviewResult>;
  /** Stops the preview this task started (no-op when another task owns it or nothing runs). */
  release(taskId: string): Promise<void>;
}

/** Persisted preview record of one task (checkpoint). */
export interface PreviewRecord {
  status: PreviewStatus;
  requestId: number;
  url: string | null;
  port: number | null;
  visibility: PreviewResult["visibility"];
  access: PreviewResult["access"];
  reason: string | null;
  updatedAt: string;
}
