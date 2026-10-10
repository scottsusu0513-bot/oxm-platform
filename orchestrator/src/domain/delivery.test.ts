import { describe, expect, it } from "vitest";
import { deliveryTargetOf, deriveLifecyclePhase, judgeDeployment, type DeploymentObservation, type LifecycleInput } from "./delivery";

const M = "b".repeat(40);
const base: LifecycleInput = { state: "running", status: "running", mode: "change", approvalPhase: null, deliveryStage: null, previewStatus: null, hasPr: false, publishing: false };
const judge = (observation: DeploymentObservation, extra: Partial<Parameters<typeof judgeDeployment>[0]> = {}) =>
  judgeDeployment({ mergeSha: M, observation, priorCheckFailures: 0, maxCheckFailures: 3, elapsedMs: 0, receiveWindowMs: 1_000, rolloutWindowMs: 1_000, ...extra });
const ok = { ok: true, detail: "ok" };
const bad = { ok: false, detail: "502" };

describe("lifecycle phase (Owner-facing)", () => {
  it("names every stage and says completed only for a terminal success", () => {
    expect(deriveLifecyclePhase(base)).toBe("working");
    expect(deriveLifecyclePhase({ ...base, state: "awaiting_approval", status: "needs_human_approval", approvalPhase: "commit_publish" })).toBe("awaiting_publish_approval");
    expect(deriveLifecyclePhase({ ...base, state: "awaiting_approval", approvalPhase: "commit_publish", previewStatus: "ready" })).toBe("preview_ready");
    expect(deriveLifecyclePhase({ ...base, publishing: true })).toBe("publishing");
    expect(deriveLifecyclePhase({ ...base, state: "pr_opened", hasPr: true })).toBe("pr_open");
    expect(deriveLifecyclePhase({ ...base, state: "qa_running", status: "qa_pending", hasPr: true })).toBe("ci_pending");
    expect(deriveLifecyclePhase({ ...base, state: "awaiting_approval", approvalPhase: "deploy", deliveryStage: "awaiting_deploy_approval" })).toBe("awaiting_deploy_approval");
    expect(deriveLifecyclePhase({ ...base, state: "deploying", status: "deploying", deliveryStage: "deploying" })).toBe("deploying");
    expect(deriveLifecyclePhase({ ...base, state: "deploying", status: "deploying", deliveryStage: "production_verifying" })).toBe("production_verifying");
    expect(deriveLifecyclePhase({ ...base, state: "complete", status: "accepted", deliveryStage: "production_verified" })).toBe("completed");
    expect(deriveLifecyclePhase({ ...base, state: "failed", status: "blocked", deliveryStage: "deployment_failed" })).toBe("deployment_failed");
    expect(deriveLifecyclePhase({ ...base, state: "failed", status: "blocked", deliveryStage: "blocked" })).toBe("blocked");
    expect(deriveLifecyclePhase({ ...base, state: "closed_without_deploy", status: "blocked" })).toBe("closed_without_deploy");
    expect(deriveLifecyclePhase({ ...base, state: "cancelled", status: "blocked" })).toBe("cancelled");
  });

  it("production is the default target; only an explicit PR-only goal changes it", () => {
    expect(deliveryTargetOf(null)).toBe("production");
    expect(deliveryTargetOf({})).toBe("production");
    expect(deliveryTargetOf({ deliveryTarget: "pull_request" })).toBe("pull_request");
  });
});

describe("deployment verdict (regression table)", () => {
  it("merge success + Render deploying → not completed", () => {
    for (const status of ["created", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"] as const)
      expect(judge({ observer: "configured", deploy: { id: "d", status, commitSha: M } })).toMatchObject({ kind: "waiting", stage: "deploying" });
    expect(judge({ observer: "configured", deploy: null })).toMatchObject({ kind: "waiting" });
  });
  it("Render failed → deployment_failed", () => {
    for (const status of ["build_failed", "update_failed", "pre_deploy_failed", "canceled"] as const)
      expect(judge({ observer: "configured", deploy: { id: "d", status, commitSha: M } })).toMatchObject({ kind: "deployment_failed", stage: "deployment_failed" });
  });
  it("Render success but SHA mismatch → blocked", () => {
    expect(judge({ observer: "configured", deploy: { id: "d", status: "live", commitSha: "c".repeat(40) } })).toMatchObject({ kind: "blocked", code: "deployed_sha_mismatch" });
  });
  it("Render success + SHA match + health fail → blocked (after bounded re-checks)", () => {
    const live = { observer: "configured" as const, deploy: { id: "d", status: "live" as const, commitSha: M } };
    expect(judge(live)).toMatchObject({ kind: "verify" });
    expect(judge(live, { checks: { health: bad, smoke: ok } })).toMatchObject({ kind: "retry_checks" });
    expect(judge(live, { checks: { health: bad, smoke: ok }, priorCheckFailures: 2 })).toMatchObject({ kind: "blocked", code: "production_health_failed" });
    expect(judge(live, { checks: { health: ok, smoke: bad }, priorCheckFailures: 2 })).toMatchObject({ kind: "blocked", code: "production_smoke_failed" });
  });
  it("Render success + SHA match + health + smoke pass → completed", () => {
    expect(judge({ observer: "configured", deploy: { id: "d", status: "live", commitSha: M } }, { checks: { health: ok, smoke: ok } })).toMatchObject({ kind: "verified", stage: "production_verified" });
  });
  it("no observer / unknown status / never received / rollout timeout are never success", () => {
    expect(judge({ observer: "unconfigured", deploy: null })).toMatchObject({ kind: "unobservable" });
    expect(judge({ observer: "unavailable", deploy: null })).toMatchObject({ kind: "waiting" });
    expect(judge({ observer: "configured", deploy: { id: "d", status: "unknown", commitSha: M } })).toMatchObject({ kind: "blocked", code: "deploy_status_unknown" });
    expect(judge({ observer: "configured", deploy: null }, { elapsedMs: 5_000 })).toMatchObject({ kind: "blocked", code: "deploy_not_received" });
    expect(judge({ observer: "configured", deploy: { id: "d", status: "build_in_progress", commitSha: M } }, { elapsedMs: 5_000 })).toMatchObject({ kind: "blocked", code: "deploy_rollout_timeout" });
  });
});
