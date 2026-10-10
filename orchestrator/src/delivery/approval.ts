import { createHash } from "node:crypto";
import { DEPLOY_ACTION, DEPLOY_AUTHORIZATION, type DeployApprovalEvidence } from "./types";

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
