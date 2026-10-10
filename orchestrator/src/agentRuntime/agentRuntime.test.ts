import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { isValidBranchTaskId } from "../branches/naming";
import { createHumanOwnerSession } from "../humanInteraction/auth";
import { createAuditHumanInteractionLedger } from "../humanInteraction/ledger";
import { createInMemoryIntakeRepository } from "../intake/fake";
import { createAgentRuntimeService } from "../intake/service";
import { compactAuditLog } from "../persistence/compact";
import { createFileAuditRepository } from "../persistence/fileAudit";
import { createRepositoryJournal, REPOSITORY_JOURNAL_EVENT } from "../persistence/journal";
import { createAuditCheckpointRepository } from "../scheduler/persistence";
import { createInMemoryApprovalRepository, createInMemoryAuditRepository, createInMemoryTaskRepository, createInMemoryTaskRunRepository } from "../store/memory";
import type { AuditRepository } from "../store/repositories";
import type { GitInspector, ProcessExit, ProcessRunner, WorkerTaskContract } from "../workers/types";
import type { GoalReviewer, GoalReviewInput } from "../planning/types";
import { createAgentRuntime, defaultTaskIdGenerator, JOURNAL_REPLAY_AUDIT_TASK } from "./compose";
import { AGENT_RUNTIME_CONFIRMATION, readAgentRuntimeConfig, type AgentRuntimeConfig } from "./config";
import { reconcileRuntimeState } from "./reconcile";
import { createTrustedValidationEvidencePort } from "./validation";

const ok = (stdout = ""): ProcessExit => ({ exitCode: 0, signal: null, stdout, stderr: "", truncated: false });

function safetyRunner(): ProcessRunner {
  return {
    spawn(spec) {
      let result = ok();
      if (spec.command === "git" && spec.args[0] === "rev-parse") result = ok(spec.args[1] === "HEAD" ? `${"a".repeat(40)}\n` : "agent/telegram-control-plane\n");
      else if (spec.command === "gh" && spec.args[0] === "repo") result = ok(JSON.stringify({ nameWithOwner: "oxm/oxm-platform" }));
      else if (spec.command === "gh" && spec.args[0] === "api") result = ok(JSON.stringify({ name: "oxm-space", state: "Available", repository: { full_name: "oxm/oxm-platform" } }));
      return { exit: Promise.resolve(result), kill() {} };
    },
  };
}

const ENV = {
  OXM_AGENT_EXPECTED_REPO: "oxm/oxm-platform",
  CODESPACE_NAME: "oxm-space",
  OXM_AGENT_CODESPACE_NAME: "oxm-space",
  OXM_AGENT_CONFIRM: AGENT_RUNTIME_CONFIRMATION,
};
// A real, host-independent repository root (CI runs under /home/runner/work/..., not a Codespace path).
const REPO_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "oxm-agent-runtime-")));
afterAll(() => rmSync(REPO_ROOT, { recursive: true, force: true }));
const config = (): AgentRuntimeConfig => {
  const r = readAgentRuntimeConfig(ENV, REPO_ROOT);
  if (!r.ok) throw new Error(r.reason);
  return r.config;
};
const owner = () => createHumanOwnerSession({ principalId: "telegram-owner", source: "telegram", now: () => new Date().toISOString() });

/** Simulates a crash after intake journaled a task but before the Manager checkpointed it. */
function crashAfterIntake(audit: AuditRepository) {
  let n = 0;
  const now = () => new Date().toISOString();
  const journal = createRepositoryJournal({ audit, nextId: () => `crash-${++n}`, now });
  const runtime = createAgentRuntimeService({
    tasks: journal.wrap("tasks", createInMemoryTaskRepository(journal.clock), ["create", "update", "transition"]),
    runs: journal.wrap("runs", createInMemoryTaskRunRepository(journal.clock), ["create", "update"]),
    approvals: journal.wrap("approvals", createInMemoryApprovalRepository(journal.clock), ["create", "decide", "expire"]),
    audit,
    intakeRecords: journal.wrap("intakeRecords", createInMemoryIntakeRepository(), ["create", "update"]),
    scheduler: { enqueue() {}, snapshot: () => null, pause: () => ({ ok: false }), cancel: () => ({ ok: false, cancellationRequested: false }) },
    workerAvailability: () => ({ claude: "unavailable", codex: "available" }),
    nextTaskId: () => "t261007-abc123",
    nextAuditId: () => `crash-audit-${++n}`,
    now,
  });
  journal.replay();
  return runtime.submitTask({
    idempotencyKey: "tg.goal.1",
    requestId: "tg.goal.1",
    userInstruction: "修正搜尋頁 loading 體驗",
    source: { type: "gateway", requesterId: "telegram-owner", reference: "telegram" },
    submittedAt: now(),
  } as never);
}

describe("agent runtime composition", () => {
  it("starts fresh with no checkpoint and exposes only the owner Gateway session", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runtime.checkpointRestored).toBe(false);
    expect(r.runtime.allTaskIds()).toEqual([]);
    await expect(r.runtime.gateway.getTaskStatus({ authentication: { credentials: { token: "anything" }, requestId: "r1", source: "x" }, request: { taskId: "t1" } })).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("requires the Agent runtime confirmation (not the smoke one)", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const bad = readAgentRuntimeConfig({ ...ENV, OXM_AGENT_CONFIRM: "create-one-smoke-branch-and-pr-without-merge" }, REPO_ROOT);
    const r = await createAgentRuntime((bad as { config: AgentRuntimeConfig }).config, { audit, owner: owner(), runner: safetyRunner() });
    expect(r).toMatchObject({ ok: false, code: "safety_explicit_confirmation" });
  });

  it("fails closed when the journal and the Manager checkpoint disagree, with a clear diagnostic", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const submitted = await crashAfterIntake(audit);
    expect(submitted.outcome).toBe("accepted");
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner() });
    expect(r).toMatchObject({ ok: false, code: "state_disagreement" });
    if (r.ok) return;
    expect(r.diagnostics).toEqual([expect.stringContaining("t261007-abc123: intake accepted the task but the Manager checkpoint never recorded it")]);
  });

  it("--reconcile cancels the never-started runtime record deterministically, then starts", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    await crashAfterIntake(audit);
    const o = owner();
    const r = await createAgentRuntime(config(), { audit, owner: o, runner: safetyRunner(), reconcile: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runtime.reconciled).toEqual(["t261007-abc123: cancelled never-started runtime record"]);
    const status = await r.runtime.gateway.getTaskStatus({ authentication: o.authentication(), request: { taskId: "t261007-abc123" } });
    expect(status.taskState).toBe("cancelled");
    expect(audit.list({ taskId: "t261007-abc123" }).some((e) => e.event === "runtime_reconciled")).toBe(true);
    // A later start is consistent (the reconciliation itself was journaled).
    const again = await createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner() });
    expect(again.ok).toBe(true);
  });

  it("a checkpointed task without its runtime record is never recoverable automatically", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const checkpoint = createAuditCheckpointRepository({ audit, nextId: () => "cp-1" });
    checkpoint.save({ version: 1, sequence: 1, tasks: [{ intake: { taskId: "ghost" }, status: "queued", state: "queued" } as never] });
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner(), reconcile: true });
    expect(r.ok).toBe(false);
  });
});

describe("agent runtime pieces", () => {
  it("config fails closed on missing bindings and names variables only", () => {
    expect(readAgentRuntimeConfig({}, "/w")).toEqual({ ok: false, reason: "OXM_AGENT_EXPECTED_REPO must be an exact owner/repository binding" });
    expect(readAgentRuntimeConfig({ ...ENV, OXM_AGENT_WORKERS: "codex,gpt" }, "/w").ok).toBe(false);
    expect(readAgentRuntimeConfig({ ...ENV, OXM_AGENT_WORKERS: "claude" }, "/w")).toEqual({ ok: false, reason: "OXM_AGENT_CLAUDE_MODEL is required when claude is enabled" });
    const c = config();
    expect(c.base).toMatchObject({ mergeEnabled: false, deployEnabled: false, forcePushEnabled: false, productionDbEnabled: false });
  });

  it("trusted task ids are valid branch task ids and never come from a transport", () => {
    const gen = defaultTaskIdGenerator();
    const ids = new Set(Array.from({ length: 50 }, gen));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isValidBranchTaskId(id)).toBe(true);
  });

  it("reconcile flags every disagreement and only marks the conservative ones recoverable", () => {
    const r = reconcileRuntimeState({
      checkpointTasks: [
        { taskId: "a", status: "running", state: "running" },
        { taskId: "b", status: "needs_human_decision", state: "running" },
        { taskId: "c", status: "accepted", state: "complete" },
      ],
      runtimeTasks: [
        { taskId: "a", state: "queued", hasIntakeRecord: true },
        { taskId: "b", state: "cancelled", hasIntakeRecord: true },
        { taskId: "d", state: "queued", hasIntakeRecord: true },
        { taskId: "e", state: "cancelled", hasIntakeRecord: true },
      ],
    });
    expect(r.issues).toEqual([
      { kind: "runtime_cancelled_but_manager_active", taskId: "b", recoverable: true, action: "cancel_in_manager" },
      { kind: "checkpoint_task_without_runtime_record", taskId: "c", recoverable: false },
      { kind: "runtime_task_not_in_checkpoint", taskId: "d", recoverable: true, action: "cancel_runtime_record" },
    ]);
  });
});

describe("trusted validation evidence", () => {
  const HEAD = "1".repeat(40);
  const contract = { taskId: "t1", runId: "r1", branch: "agent/task-t1-x", expectedHeadSha: HEAD, gitMetadataDigest: "d".repeat(64), requiredValidations: ["tests", "typecheck"], acceptanceCriteria: ["outcome"] } as unknown as WorkerTaskContract;
  function git(mutateAfter = false): GitInspector {
    let calls = 0;
    return {
      status: async () => ({ branch: "agent/task-t1-x", headSha: HEAD, dirtyPaths: ["client/a.ts"] }) as never,
      changedPathsSince: async () => ["client/a.ts"],
      metadataDigest: async () => "d".repeat(64),
      contentIdentities: async (paths) => paths.map((path) => ({ path, mode: "100644", blob: mutateAfter && ++calls > 1 ? "f".repeat(40) : "e".repeat(40) })),
    };
  }
  const runner = (codes: Record<string, number | "hang">): ProcessRunner & { commands: string[] } => {
    const commands: string[] = [];
    return {
      commands,
      spawn(spec) {
        const cmd = [spec.command, ...spec.args].join(" ");
        commands.push(cmd);
        const code = codes[cmd] ?? 0;
        return { exit: code === "hang" ? new Promise(() => {}) : Promise.resolve({ ...ok(), exitCode: code }), kill() {} };
      },
    };
  };
  const req = { taskId: "t1", runId: "r1", contract, result: { headSha: HEAD, riskObserved: { level: "green" } } as never, lease: {} as never };

  it("runs each required validation itself and backs acceptance with the trusted result", async () => {
    const r = runner({});
    const port = createTrustedValidationEvidencePort({ git: git(), runner: r, repoRoot: "/w", timeoutMs: 1_000 });
    const record = await port.record(req);
    expect(r.commands).toEqual(["pnpm test", "pnpm check"]);
    expect(record.validations.map((v) => [v.name, v.status, v.trusted])).toEqual([["tests", "passed", true], ["typecheck", "passed", true]]);
    expect(record.acceptance).toEqual([{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }]);
  });

  it("a failing or timed-out validation fails the evidence (never trusts the Worker report)", async () => {
    const failed = await createTrustedValidationEvidencePort({ git: git(), runner: runner({ "pnpm check": 2 }), repoRoot: "/w", timeoutMs: 1_000 }).record(req);
    expect(failed.validations.find((v) => v.name === "typecheck")!.status).toBe("failed");
    expect(failed.acceptance[0].status).toBe("failed");
    // A timeout cannot be attributed to the task: unverified, never failed_due_to_task.
    const hung = await createTrustedValidationEvidencePort({ git: git(), runner: runner({ "pnpm test": "hang" }), repoRoot: "/w", timeoutMs: 20 }).record(req);
    expect(hung.validations.find((v) => v.name === "tests")).toMatchObject({ status: "unverified", executed: true });
    expect(hung.acceptance[0]).toMatchObject({ status: "unknown", confirmedFailureOnly: true });
  });

  it("infrastructure that cannot run a validation is unavailable, not a task failure", async () => {
    const infra: ProcessRunner = {
      spawn(spec) {
        const cmd = [spec.command, ...spec.args].join(" ");
        if (cmd === "pnpm test") return { exit: Promise.resolve({ ...ok(), exitCode: 1, stderr: "sh: 1: vitest: not found" }), kill() {} };
        if (cmd === "pnpm check") return { exit: Promise.resolve({ ...ok(), exitCode: null, spawnError: "ENOENT" }), kill() {} };
        return { exit: Promise.resolve(ok()), kill() {} };
      },
    };
    const record = await createTrustedValidationEvidencePort({ git: git(), runner: infra, repoRoot: "/w", timeoutMs: 1_000 }).record(req);
    expect(record.validations.map((v) => [v.name, v.status, v.executed])).toEqual([["tests", "unavailable", false], ["typecheck", "unavailable", false]]);
    expect(record.validations[0].summary).toMatch(/could not run/);
    expect(record.acceptance[0]).toMatchObject({ status: "unknown", confirmedFailureOnly: true });
  });

  it("shared workspace: other actors' out-of-scope changes are excluded from the task delta, and a failure with them present is unverified", async () => {
    const shared: GitInspector = {
      status: async () => ({ branch: "agent/task-t1-x", headSha: HEAD, dirtyPaths: ["client/a.ts", "orchestrator/x.ts"] }) as never,
      changedPathsSince: async () => ["client/a.ts", "orchestrator/x.ts"],
      metadataDigest: async () => "d".repeat(64),
      contentIdentities: async (paths) => paths.map((path) => ({ path, mode: "100644", blob: "e".repeat(40) })),
    };
    const scoped = { ...req, contract: { ...contract, allowedScope: ["client/"] } as WorkerTaskContract, result: { headSha: HEAD, filesChanged: ["client/a.ts"], riskObserved: { level: "green" } } as never };
    const record = await createTrustedValidationEvidencePort({ git: shared, runner: runner({ "pnpm check": 2 }), repoRoot: "/w", timeoutMs: 1_000 }).record(scoped);
    expect(record.changedPaths).toEqual(["client/a.ts"]);
    expect(record.foreignPaths).toEqual(["orchestrator/x.ts"]);
    expect(record.validations.find((v) => v.name === "typecheck")).toMatchObject({ status: "unverified", executed: true });
    expect(record.acceptance[0].status).toBe("unknown");
  });

  it("refuses to judge a workspace the validation run modified", async () => {
    await expect(createTrustedValidationEvidencePort({ git: git(true), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000 }).record(req)).rejects.toThrow(/validation changed the workspace/);
  });

  describe("read-only workspace verdict reaches the goal reviewer", () => {
    const roContract = { ...contract, requiredValidations: [], mode: "read_only" } as unknown as WorkerTaskContract;
    const goal = {
      mode: "read_only" as const,
      title: "t",
      objective: "o",
      goal: { intent: "investigate_or_answer" as const, originalRequest: "q；不修改任何檔案", interpretedObjective: "o" },
      criteria: [{ id: "AC-4", text: "不修改任何檔案", kind: "goal" as const }],
    };
    const roReq = (summary: string, headSha = HEAD) => ({ ...req, contract: roContract, goal, result: { headSha, summary, riskObserved: { level: "green" } } as never });
    function roGit(o: { changed?: string[]; after?: Partial<{ branch: string; headSha: string; digest: string; changed: string[]; blob: string }> } = {}): GitInspector {
      let statusCalls = 0;
      let changedCalls = 0;
      let digestCalls = 0;
      let idCalls = 0;
      const base = o.changed ?? [];
      return {
        status: async () => ((statusCalls++ > 0 && o.after) ? { branch: o.after.branch ?? contract.branch, headSha: o.after.headSha ?? HEAD, dirtyPaths: [] } : { branch: contract.branch, headSha: HEAD, dirtyPaths: [] }) as never,
        changedPathsSince: async () => (changedCalls++ > 0 && o.after?.changed ? o.after.changed : base),
        metadataDigest: async () => (digestCalls++ > 0 && o.after?.digest ? o.after.digest : "d".repeat(64)),
        contentIdentities: async (paths) => paths.map((path) => ({ path, mode: "100644", blob: idCalls++ > 0 && o.after?.blob ? o.after.blob : "e".repeat(40) })),
      };
    }
    const capture = () => {
      const calls: GoalReviewInput[] = [];
      const reviewer: GoalReviewer = {
        async review(input) {
          calls.push(structuredClone(input));
          const ws = input.workspace;
          const status = !ws ? "unsupported" : ws.workspaceUnchanged ? "satisfied" : "not_satisfied";
          // Like the real REVIEW_SCHEMA: the Manager's owner answer, "" unless the goal is met.
          return { criteria: [{ id: "AC-4", status, evidence: ws ? "orchestrator workspace verdict" : "", reason: ws ? "" : "no workspace evidence" }], ownerAnswer: status === "satisfied" ? "Answer (repository source; workspace unchanged)." : "" };
        },
      };
      return { calls, reviewer };
    };

    it("verified, unchanged workspace -> trusted verdict in the review request and the no-change criterion is satisfied", async () => {
      const { calls, reviewer } = capture();
      const record = await createTrustedValidationEvidencePort({ git: roGit(), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000, reviewer }).record(roReq("Answer. git status clean."));
      expect(calls[0].workspace).toEqual({ branch: contract.branch, headSha: HEAD, changedPaths: [], changedPathCount: 0, workspaceUnchanged: true });
      expect(record.acceptance).toMatchObject([{ criterionId: "AC-4", status: "satisfied", evidenceType: "manager_review" }]);
      expect(record.managerAnswer).toBe("Answer (repository source; workspace unchanged).");
    });

    it("a workspace with changed paths is reported as changed, never unchanged", async () => {
      const { calls, reviewer } = capture();
      const record = await createTrustedValidationEvidencePort({ git: roGit({ changed: ["client/a.ts"] }), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000, reviewer }).record(roReq("No files changed."));
      expect(calls[0].workspace).toMatchObject({ changedPaths: ["client/a.ts"], changedPathCount: 1, workspaceUnchanged: false });
      expect(record.acceptance[0].status).toBe("failed");
    });

    it("any Git inconsistency (HEAD, branch, metadata, changed paths, identities) fails closed before the reviewer runs", async () => {
      const cases: Parameters<typeof roGit>[0][] = [
        { after: { headSha: "2".repeat(40) } },
        { after: { branch: "main" } },
        { after: { digest: "0".repeat(64) } },
        { after: { changed: ["client/new.ts"] } },
        { changed: ["client/a.ts"], after: { blob: "f".repeat(40) } },
      ];
      for (const c of cases) {
        const { calls, reviewer } = capture();
        await expect(createTrustedValidationEvidencePort({ git: roGit(c), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000, reviewer }).record(roReq("no change"))).rejects.toThrow();
        expect(calls).toHaveLength(0);
      }
      // The Worker reporting a different HEAD is rejected by the base Git check as well.
      const { calls, reviewer } = capture();
      await expect(createTrustedValidationEvidencePort({ git: roGit(), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000, reviewer }).record(roReq("no change", "3".repeat(40)))).rejects.toThrow(/trusted git state/);
      expect(calls).toHaveLength(0);
    });

    it("change tasks keep their diff-based review without a workspace verdict", async () => {
      const { calls, reviewer } = capture();
      const changeGoal = { ...goal, mode: "change" as const, goal: { ...goal.goal, intent: "change_code" as const } };
      await createTrustedValidationEvidencePort({ git: git(), runner: runner({}), repoRoot: "/w", timeoutMs: 1_000, reviewer, diff: async () => "+++ b/client/a.ts\n+x" }).record({ ...req, goal: changeGoal, result: { headSha: HEAD, summary: "done", riskObserved: { level: "green" } } as never });
      expect(calls[0].workspace).toBeUndefined();
      expect(calls[0].diff).toContain("client/a.ts");
    });
  });
});

describe("durable log compaction", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("drops only superseded checkpoints/cursors and keeps journal, ledger and the latest state", () => {
    const dir = mkdtempSync(join(tmpdir(), "oxm-compact-"));
    dirs.push(dir);
    const path = join(dir, "audit.jsonl");
    let n = 0;
    const audit = createFileAuditRepository({ path, now: () => "2026-10-07T00:00:00.000Z" });
    const cps = createAuditCheckpointRepository({ audit, nextId: () => `id-${++n}` });
    for (let i = 0; i < 20; i++) cps.save({ version: 1, sequence: i, tasks: [] });
    const ledger = createAuditHumanInteractionLedger({ audit, nextId: () => `id-${++n}` });
    for (let i = 1; i <= 5; i++) ledger.setCursor("telegram", i);
    ledger.recordIntent({ noticeId: "hd:x.hd.1", kind: "human_decision", ref: "0123456789abcdef", taskId: "x", targetId: "x.hd.1", createdAt: "t" });
    ledger.recordDelivered("hd:x.hd.1", "55");
    audit.append({ id: `id-${++n}`, taskId: "x", actor: "manager", event: "task_queued" });
    audit.close();

    const r = compactAuditLog(path);
    expect(r).toMatchObject({ compacted: true, eventsBefore: 28, eventsAfter: 5 });
    expect(existsSync(`${path}.prev`)).toBe(true);
    const reopened = createFileAuditRepository({ path, now: () => "t" });
    expect(createAuditCheckpointRepository({ audit: reopened, nextId: () => "z" }).load()).toEqual({ version: 1, sequence: 19, tasks: [] });
    const ledger2 = createAuditHumanInteractionLedger({ audit: reopened, nextId: () => "z2" });
    expect(ledger2.cursor("telegram")).toBe(5);
    expect(ledger2.byDeliveryRef("55")).toMatchObject({ noticeId: "hd:x.hd.1" });
    expect(reopened.list({ taskId: "x" })).toHaveLength(1);
    reopened.close();
    expect(compactAuditLog(path).compacted).toBe(false);
  });
});

describe("production composition requires the GPT Manager", () => {
  it("the production loop is gpt_required (no deterministic stand-in) and accounts Manager calls", async () => {
    const audit = createInMemoryAuditRepository(() => new Date().toISOString());
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner() });
    if (!r.ok) throw new Error(r.reason);
    expect(r.runtime.loop.policy.managerMode).toBe("gpt_required");
  });
});

describe("agent runtime startup over a historically duplicated journal", () => {
  const BODY = "老闆私密訊息 PRIVATE-BODY-MARKER";
  const interp = (id: string, createdAt: string, decision: unknown = { kind: "status_query", taskId: null }) => ({
    interpretationId: id,
    fingerprint: `fp-${id}`,
    principalId: "telegram-owner",
    originalRequest: BODY,
    priority: null,
    decision,
    createdAt,
  });
  const put = (audit: AuditRepository, id: string, record: unknown) =>
    audit.append({ id, taskId: "repository-journal", actor: "system", event: REPOSITORY_JOURNAL_EVENT, metadata: { repository: "interpretations", method: "create", at: "2026-10-09T08:00:00.000Z", args: [record] as never } });
  const start = (audit: AuditRepository, supersededJournalEvents?: string[]) => createAgentRuntime(config(), { audit, owner: owner(), runner: safetyRunner(), supersededJournalEvents });
  const replayEvents = (audit: AuditRepository) => audit.list({ taskId: JOURNAL_REPLAY_AUDIT_TASK }).map((e) => [e.event, e.metadata]);

  it("starts over identical historical duplicates and audits each recovery once, outside the journal", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    put(audit, "agent-a-105", interp("tg.msg.79", "2026-10-09T07:58:56.876Z"));
    put(audit, "agent-b-4", interp("tg.msg.79", "2026-10-09T07:58:59.194Z"));
    put(audit, "agent-a-106", interp("tg.msg.82", "2026-10-09T07:59:30.829Z"));
    const journalBefore = audit.list({ taskId: "repository-journal" }).length;
    const r = await start(audit);
    expect(r.ok).toBe(true);
    const expected = [["journal_duplicate_replay_ignored", { journalEventId: "agent-b-4", repository: "interpretations", method: "create", recordId: "tg.msg.79", reason: "identical_historical_duplicate" }]];
    expect(replayEvents(audit)).toEqual(expected);
    expect(audit.list({ taskId: "repository-journal" })).toHaveLength(journalBefore);
    // Restarting again is deterministic and does not re-audit.
    expect((await start(audit)).ok).toBe(true);
    expect(replayEvents(audit)).toEqual(expected);
  });

  it("fails closed on a conflicting duplicate with safe, specific diagnostics", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    put(audit, "agent-b-8", interp("tg.msg.94", "2026-10-09T08:01:48.742Z", { kind: "task", title: "stray" }));
    put(audit, "agent-a-109", interp("tg.msg.94", "2026-10-09T08:01:48.832Z", { kind: "task", title: "real" }));
    const r = await start(audit);
    expect(r).toMatchObject({ ok: false, code: "journal_replay_failed" });
    if (r.ok) return;
    expect(r.diagnostics).toEqual(["category=duplicate_conflict index=1 event=agent-a-109 repository=interpretations method=create key=tg.msg.94"]);
    expect(JSON.stringify(r)).not.toContain("PRIVATE-BODY-MARKER");
    expect(replayEvents(audit)).toEqual([]);
  });

  it("an operator override of the stray record is validated, audited, and honoured on later starts", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    put(audit, "agent-b-9", interp("tg.msg.96", "2026-10-09T08:02:08.604Z", { kind: "cancel_or_pause", taskId: "t-stray" }));
    put(audit, "agent-a-127", interp("tg.msg.96", "2026-10-09T08:02:09.642Z", { kind: "cancel_or_pause", taskId: "t-real" }));
    expect(await start(audit, ["agent-a-1"])).toMatchObject({ ok: false, code: "journal_replay_failed", diagnostics: ["category=invalid_override event=agent-a-1"] });
    expect((await start(audit, ["agent-b-9"])).ok).toBe(true);
    const expected = [["journal_replay_record_superseded", { journalEventId: "agent-b-9", repository: "interpretations", method: "create", recordId: "tg.msg.96", reason: "operator_superseded" }]];
    expect(replayEvents(audit)).toEqual(expected);
    // The accepted override is durable: no need to keep passing it.
    expect((await start(audit)).ok).toBe(true);
    expect(replayEvents(audit)).toEqual(expected);
  });
});
