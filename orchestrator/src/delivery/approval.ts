import { createHash } from "node:crypto";
import { REDACTED } from "../store/sanitize";
import { DEPLOY_ACTION, DEPLOY_AUTHORIZATION, type DeployApprovalEvidence, type DeliveryRecord } from "./types";

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Canonical, validated deploy evidence (fail closed on anything unexpected). */
export function normalizeDeployEvidence(e: DeployApprovalEvidence): DeployApprovalEvidence {
  if (!e || !ID.test(e.taskId) || !ID.test(e.lineageId)) throw new Error("[deploy] evidence identity is malformed");
  if (!Number.isInteger(e.prNumber) || e.prNumber <= 0) throw new Error("[deploy] PR number is malformed");
  if (!SHA.test(e.headSha)) throw new Error("[deploy] head SHA is malformed");
  if (e.baseBranch !== "main") throw new Error("[deploy] base branch must be main");
  if (e.ci?.status !== "passed" || !Array.isArray(e.ci.checks) || e.ci.checks.length === 0) throw new Error("[deploy] CI must have passed");
  if (e.action !== DEPLOY_ACTION) throw new Error("[deploy] action is not merge + deploy");
  const a = e.authorization;
  if (!(a?.merge === true && a.deploy === true && a.commit === false && a.push === false && a.forcePush === false && a.productionDatabase === false))
    throw new Error("[deploy] authorization differs from the fixed merge + deploy scope");
  if (!["green", "yellow", "red"].includes(e.risk)) throw new Error("[deploy] risk is malformed");
  return {
    taskId: e.taskId,
    lineageId: e.lineageId,
    prNumber: e.prNumber,
    headSha: e.headSha,
    baseBranch: "main",
    ci: { status: "passed", checks: e.ci.checks.map((c) => ({ name: String(c.name).slice(0, 80), outcome: String(c.outcome).slice(0, 40) })).sort((x, y) => x.name.localeCompare(y.name)) },
    risk: e.risk,
    unverified: Array.from(new Set(e.unverified.map((u) => String(u).slice(0, 80)))).sort(),
    action: DEPLOY_ACTION,
    authorization: { ...DEPLOY_AUTHORIZATION },
  };
}

/** Exact binding of an Owner deploy approval: task, lineage, PR, head SHA, CI result, scope. */
export function deployApprovalBinding(e: DeployApprovalEvidence): string {
  const n = normalizeDeployEvidence(e);
  return `deploy:${createHash("sha256").update(JSON.stringify(n)).digest("hex")}`;
}

const EVIDENCE_KEYS = ["action", "authorization", "baseBranch", "ci", "headSha", "lineageId", "prNumber", "risk", "taskId", "unverified"].join(",");

/**
 * Checkpoint compatibility for persisted deploy evidence. The audit sanitizer replaces every
 * "authorization" key with REDACTED, so a persisted DeployApprovalEvidence loses its scope literal
 * (a fixed capability constant, never a credential). Exactly that case is restored, and only when the
 * restored evidence still hashes to the record's own binding — which was computed from the original,
 * un-redacted evidence, so a match proves the original scope was exactly DEPLOY_AUTHORIZATION.
 *
 * Returns the restored evidence, or null (leave the record as persisted: it then fails closed in the
 * normal normalizeDeployEvidence / binding checks). Any other authorization value, an unexpected shape,
 * an identity mismatch with the record or a binding mismatch is never rehydrated.
 */
export function restoreRedactedDeployEvidence(
  record: Pick<DeliveryRecord, "evidence" | "binding" | "prNumber" | "headSha" | "lineageId">,
  taskId: string,
): DeployApprovalEvidence | null {
  const e = record.evidence as unknown;
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const persisted = e as Record<string, unknown>;
  if (persisted.authorization !== REDACTED) return null;
  if (Object.keys(persisted).sort().join(",") !== EVIDENCE_KEYS) return null;
  if (persisted.action !== DEPLOY_ACTION || persisted.baseBranch !== "main") return null;
  if (persisted.taskId !== taskId || persisted.lineageId !== record.lineageId || persisted.prNumber !== record.prNumber || persisted.headSha !== record.headSha) return null;
  if (typeof record.binding !== "string") return null;
  const candidate = { ...structuredClone(persisted), authorization: { ...DEPLOY_AUTHORIZATION } } as unknown as DeployApprovalEvidence;
  try {
    return deployApprovalBinding(candidate) === record.binding ? candidate : null;
  } catch {
    return null;
  }
}
