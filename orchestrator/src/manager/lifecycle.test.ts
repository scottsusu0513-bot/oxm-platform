import { describe, expect, it } from "vitest";
import { fakeEvidence, fakePostCiEvidence, SHA_HEAD, SHA_OTHER, TASK_BRANCH } from "./fake";
import { managerAuditMetadata, MANAGER_AUDIT_EVENTS } from "./intent";
import { managerStep, repairStartIntent } from "./lifecycle";
import { advanceRepairCounters } from "./repair";

const failing = fakeEvidence({
  validations: [
    { name: "tests", requested: true, executed: true, status: "failed", trusted: true },
    { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
  ],
});

const run = { worker: "claude" as const, runId: "run-1", model: "m", promptHash: "f".repeat(64) };

describe("manager lifecycle", () => {
  it("accepted before PR -> open_pr, no transition", () => {
    const s = managerStep({ evidence: fakeEvidence() });
    expect(s.ok && s.next).toBe("open_pr");
    expect(s.ok && s.transition).toBeNull();
    expect(s.ok && s.audit.map((a) => a.event)).toEqual(["manager_validation_started", "manager_accepted"]);
  });

  it("accepted during QA hands off to the QA layer", () => {
    const s = managerStep({ evidence: fakePostCiEvidence() });
    expect(s.ok && s.next).toBe("advance_qa");
  });

  it("accepted at qa_passed: green completes, red goes to approval (never merges)", () => {
    const g = managerStep({ evidence: fakePostCiEvidence({ taskState: "qa_passed" }) });
    expect(g.ok && [g.next, g.transition]).toEqual(["complete_task", "complete"]);
    const r = managerStep({ evidence: fakePostCiEvidence({ taskState: "qa_passed", risk: { stored: "red", observed: "red", approval: "none" } }) });
    expect(r.ok && [r.next, r.transition, r.validation.decision]).toEqual(["await_human_approval", "awaiting_approval", "needs_human_approval"]);
    const a = managerStep({ evidence: fakePostCiEvidence({ taskState: "awaiting_approval", risk: { stored: "red", observed: "red", approval: "approved" } }), approvalPhase: "post_qa" });
    expect(a.ok && [a.next, a.transition]).toEqual(["complete_task", "complete"]);
    expect(managerStep({ evidence: fakePostCiEvidence({ taskState: "awaiting_approval", risk: { stored: "red", observed: "red", approval: "approved" } }) }).ok).toBe(false);
  });

  it("needs_repair -> repair request on the same branch, retries patch, no transition", () => {
    const s = managerStep({ evidence: failing });
    if (!s.ok) throw new Error(s.reason);
    expect(s.next).toBe("dispatch_repair");
    expect(s.transition).toBeNull();
    expect(s.taskPatch).toEqual({ retries: 1 });
    expect(s.repairRequest?.branch).toBe(TASK_BRANCH);
    expect(s.audit.map((a) => a.event)).toEqual(["manager_validation_started", "escalation_triggered", "manager_repair_requested"]);
  });

  it("full loop: fail -> repair -> fail -> repair -> fail -> blocked (budget exhausted)", () => {
    let e = failing;
    const nexts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = managerStep({ evidence: e });
      if (!s.ok) throw new Error(s.reason);
      nexts.push(s.next);
      if (!s.repairRequest) {
        expect(s.audit.map((a) => a.event)).toContain("repair_budget_exhausted");
        break;
      }
      e = { ...e, repair: advanceRepairCounters(e.repair, s.repairRequest) };
    }
    expect(nexts).toEqual(["dispatch_repair", "dispatch_repair", "stop"]);
  });

  it("blocked stale base -> replan_branch", () => {
    const s = managerStep({ evidence: fakeEvidence({ branch: { ...fakeEvidence().branch, baseFreshness: "stale" } }) });
    expect(s.ok && s.next).toBe("replan_branch");
  });

  it("repair start requires the assigned branch at the expected head", () => {
    const s = managerStep({ evidence: failing });
    if (!s.ok || !s.repairRequest) throw new Error("expected repair");
    const ok = repairStartIntent({ ...run, request: s.repairRequest, currentState: "running", workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_HEAD, riskLevel: "green" });
    expect(ok.ok && ok.audit.event).toBe("repair_attempt_started");
    expect(ok.ok && ok.audit.metadata).toMatchObject({ attempt: 1, branch: TASK_BRANCH, headSha: SHA_HEAD });
    expect(ok.ok && [ok.transition, ok.taskRun.worker, ok.taskRun.taskId]).toEqual([null, "claude", "t1"]);
    expect(repairStartIntent({ ...run, worker: "codex", request: s.repairRequest, currentState: "running", workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_HEAD, riskLevel: "green" }).ok).toBe(false);
    expect(repairStartIntent({ ...run, request: s.repairRequest, currentState: "qa_passed", workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_HEAD, riskLevel: "green" }).ok).toBe(false);
    expect(repairStartIntent({ ...run, promptHash: null, request: s.repairRequest, currentState: "running", workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_HEAD, riskLevel: "green" }).ok).toBe(false);
    expect(repairStartIntent({ ...run, request: s.repairRequest, currentState: "running", workspaceBranch: "agent/task-t9-x", workspaceHeadSha: SHA_HEAD, riskLevel: "green" }).ok).toBe(false);
    expect(repairStartIntent({ ...run, request: s.repairRequest, currentState: "running", workspaceBranch: TASK_BRANCH, workspaceHeadSha: SHA_OTHER, riskLevel: "green" }).ok).toBe(false);
  });
});

describe("manager audit", () => {
  it("covers every required event", () => {
    expect([...MANAGER_AUDIT_EVENTS].sort()).toEqual(
      ["escalation_triggered", "manager_accepted", "manager_blocked", "manager_human_approval_required", "manager_repair_requested", "manager_validation_started", "repair_attempt_started", "repair_budget_exhausted"],
    );
  });

  it("metadata is whitelisted and sanitized", () => {
    const m = managerAuditMetadata({
      taskId: "t1",
      branch: TASK_BRANCH,
      headSha: SHA_HEAD,
      decision: "blocked",
      failedEvidenceIds: ["ci:verify"],
      attempt: 1,
      riskLevel: "green",
      reasonCodes: ["Bearer ghp_abcdefghijklmnop1234"],
      ...({ sourceCode: "export const x = 1;", stdout: "FAIL ...", prompt: "secret prompt" } as object),
    });
    expect(Object.keys(m).sort()).toEqual(["attempt", "branch", "decision", "failedEvidenceIds", "headSha", "intents", "reasonCodes", "riskLevel", "taskId", "triggers"]);
    expect(JSON.stringify(m)).not.toMatch(/ghp_|export const|FAIL|secret prompt/);
  });

  it("audit events from a step carry no raw source or log text", () => {
    const e = fakeEvidence({
      validations: [
        { name: "tests", requested: true, executed: true, status: "failed", trusted: true, summary: "line1\nline2 ".repeat(100) },
        { name: "typecheck", requested: true, executed: true, status: "passed", trusted: true },
      ],
    });
    const s = managerStep({ evidence: e });
    if (!s.ok) throw new Error(s.reason);
    const text = JSON.stringify(s.audit);
    expect(text).not.toContain("line1");
    for (const a of s.audit) expect(a.actor).toBe("manager");
  });
});
