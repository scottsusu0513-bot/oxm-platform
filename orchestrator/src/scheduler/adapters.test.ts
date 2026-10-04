import { describe, expect, it, vi } from "vitest";
import type { Approval } from "../store/types";
import type { WorkerAdapter, WorkerResult, WorkerTaskContract } from "../workers/types";
import { createEvidencePort, createQaPort, createRepoStatePort, createWorkerPort } from "./adapters";
import { sha } from "./fake";

const contract: WorkerTaskContract = {
  taskId: "adapter1",
  runId: "adapter1-run-1",
  category: "bug_fix",
  actions: [{ kind: "code_edit" }],
  changedPaths: ["server/adapter1.ts"],
  storedRiskLevel: "green",
  objective: "Fix adapter behavior",
  allowedScope: ["server/adapter1.ts"],
  acceptanceCriteria: ["works"],
  requiredValidations: ["tests"],
  branch: "agent/task-adapter1-fix-adapter-behavior",
  expectedHeadSha: sha(1),
};

const result: WorkerResult = {
  status: "success",
  summary: "done",
  filesChanged: ["server/adapter1.ts"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: contract.branch,
  headSha: sha(2),
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  workerErrorCode: null,
};

describe("scheduler production adapters", () => {
  it("bridges only Claude requests to the existing worker adapter without executing a process", async () => {
    let request: Parameters<WorkerAdapter["start"]>[0] | null = null;
    const adapter: WorkerAdapter = {
      kind: "claude",
      start(value) {
        request = value;
        return { runId: value.contract.runId, promptHash: null, result: Promise.resolve(result), cancel() {} };
      },
    };
    const approval = { id: "a1" } as Approval;
    const port = createWorkerPort({ claude: adapter, now: () => "2026-10-04T12:00:00.000Z" });
    await port.start("claude", contract, approval).result;
    expect(request).toEqual({ contract, redApproval: approval, now: "2026-10-04T12:00:00.000Z" });
    expect(() => port.start("codex", contract)).toThrow(/no executable adapter/);
  });

  it("bridges read-only QA through exact-head inspection", async () => {
    const getPullRequest = vi.fn(async () => ({
      number: 7,
      state: "open" as const,
      draft: false,
      headSha: sha(7),
      headRef: contract.branch,
      baseRef: "main",
    }));
    const port = createQaPort(
      {
        getPullRequest,
        getHeadSha: async () => sha(7),
        listChecksForSha: async () => [
          { source: "check_run", name: "verify", headSha: sha(7), appSlug: "github-actions", status: "completed", conclusion: "success" },
        ],
      },
      { owner: "oxm", repo: "platform" },
      [{ name: "verify", source: "check_run", appSlug: "github-actions" }],
    );
    await expect(port.read(7)).resolves.toMatchObject({ status: "passed", headSha: sha(7) });
    expect(getPullRequest).toHaveBeenCalledTimes(2);
  });

  it("bridges trusted git evidence and main-head reads without adding policy", async () => {
    const evidence = createEvidencePort({
      git: {
        status: async () => ({ branch: contract.branch, headSha: sha(2), dirtyPaths: [] }),
        changedPathsSince: async () => ["server/adapter1.ts"],
      },
      validations: () => [{ name: "tests", requested: true, executed: true, status: "passed", trusted: true }],
      acceptance: () => [{ criterionId: "AC-1", status: "satisfied", evidenceType: "validation", reference: "tests" }],
    });
    await expect(evidence.record({ taskId: "adapter1", runId: contract.runId, contract, result, lease: {} as never })).resolves.toMatchObject({
      verifiedHeadSha: sha(2),
      changedPaths: ["server/adapter1.ts"],
    });

    const repo = createRepoStatePort({ getBranchHead: async (_repo, branch) => (branch === "main" ? sha(9) : null) }, { owner: "oxm", repo: "platform" });
    await expect(repo.mainHeadSha()).resolves.toBe(sha(9));
  });
});
