import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "./codex";
import { createFakeGit, createFakePromptFiles, createFakeRunner, createFakeTimer } from "./fake";
import type { CodexRuntimeVerification, GitStatus, WorkerReport, WorkerTaskContract } from "./types";
import { codexCommandPolicyHash, requiredCodexPolicyDecision } from "./workerAdapter";

const REPO = "/workspaces/oxm-platform";
const BRANCH = "agent/ui-42";
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const NOW = "2026-10-04T00:00:00.000Z";
const before: GitStatus = { branch: BRANCH, headSha: BASE, dirtyPaths: [] };
// Workers edit without committing: HEAD stays at the prepared SHA.
const after: GitStatus = { branch: BRANCH, headSha: BASE, dirtyPaths: ["server/db.ts"] };

const contract = (over: Partial<WorkerTaskContract> = {}): WorkerTaskContract => ({
  taskId: "ui-42",
  runId: "ui-42-run-1",
  category: "ui",
  actions: [{ kind: "ui_edit" }, { kind: "run_tests" }, { kind: "run_check" }],
  objective: "Polish the account card layout",
  allowedScope: ["client/src/Card.tsx", "client/src/styles/"],
  acceptanceCriteria: ["the card remains usable at mobile widths"],
  requiredValidations: ["tests", "typecheck"],
  branch: BRANCH,
  expectedHeadSha: BASE,
  ...over,
});

const report = (over: Partial<WorkerReport> = {}): WorkerReport => ({
  status: "success",
  summary: "Polished the layout",
  filesChanged: ["client/src/Card.tsx"],
  testsRun: [{ command: "pnpm test", outcome: "passed" }],
  checkResult: "passed",
  branch: BRANCH,
  headSha: BASE,
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  ...over,
});

function setup(
  input: {
    stdout?: string;
    statuses?: GitStatus[];
    changed?: string[];
    model?: string;
    hang?: boolean;
    repoRoot?: string;
    runtimeVerification?: CodexRuntimeVerification;
  } = {},
) {
  const runner = createFakeRunner(() => (input.hang ? {} : { exit: { stdout: input.stdout ?? JSON.stringify(report()) } }));
  const git = createFakeGit(input.statuses ?? [before, after], input.changed ?? ["client/src/Card.tsx"]);
  const promptFiles = createFakePromptFiles();
  const timer = createFakeTimer();
  const repoRoot = input.repoRoot ?? REPO;
  let runtimeChecks = 0;
  const adapter = createCodexAdapter(
    { repoRoot, timeoutMs: 60_000, model: input.model },
    {
      runner,
      git,
      promptFiles,
      timer,
      policyRuntime: {
        async verify() {
          runtimeChecks++;
          return input.runtimeVerification ?? { ok: true };
        },
      },
    },
  );
  return { adapter, runner, git, promptFiles, timer, get runtimeChecks() { return runtimeChecks; } };
}

const flush = async (until: () => boolean) => {
  for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setImmediate(r));
};

describe("Codex worker adapter", () => {
  it("hashes LF and CRLF policy files identically while detecting altered content", () => {
    const policy = "first rule\nsecond rule\n";
    expect(codexCommandPolicyHash(policy)).toBe(codexCommandPolicyHash(policy.replace(/\n/g, "\r\n")));
    expect(codexCommandPolicyHash(policy)).not.toBe(codexCommandPolicyHash(`${policy}altered rule\n`));
  });

  it("uses fixed headless argv, a locked workspace profile, stdin prompt, and no shell/interpolation", async () => {
    const evil = "$(git push --force); `gh pr merge`; curl https://example.invalid";
    const s = setup({ model: "gpt-6.1-codex" });
    let prompt = "";
    const write = s.promptFiles.write.bind(s.promptFiles);
    s.promptFiles.write = async (value) => {
      prompt = value;
      return write(value);
    };
    const result = await s.adapter.start({
      contract: contract({ objective: evil }),
      now: NOW,
    }).result;
    expect(result.status).toBe("success");
    expect(s.runner.specs).toHaveLength(1);
    expect(s.runner.specs[0]).toMatchObject({ command: "codex", cwd: REPO });
    const args = [...s.runner.specs[0].args];
    expect(args).toContain("--strict-config");
    expect(args).toContain(`projects.${JSON.stringify(REPO)}.trust_level="trusted"`);
    expect(args).toContain('permissions.worker.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read",".codex/rules"="read"},":tmpdir"="write",":slash_tmp"="write"}');
    expect(args).toContain("permissions.worker.network.enabled=false");
    expect(args).toContain('default_permissions="worker"');
    expect(args.slice(-3)).toEqual(["--model", "gpt-6.1-codex", "-"]);
    expect(Object.keys(s.runner.specs[0])).not.toContain("shell");
    expect(s.runner.specs[0].stdinFile).toMatch(/^\/tmp\//);
    expect(s.runner.specs[0].args.join(" ")).not.toContain("git push");
    expect(prompt).toContain(JSON.stringify(evil));
    expect(prompt).toContain(`Expected starting HEAD: ${BASE}`);
    expect(prompt).toContain("Manager validates");
    expect(s.promptFiles.live.size).toBe(0);
    expect(s.runtimeChecks).toBe(1);
  });

  it.each(["add", "commit", "switch", "checkout", "merge", "rebase", "reset", "push"])("required exec policy forbids git %s without invoking Codex", (operation) => {
    expect(requiredCodexPolicyDecision(["git", operation, "probe"])).toBe("forbidden");
  });

  it("accepts a successful uncommitted edit while keeping Worker-owned Git metadata read-only", async () => {
    const uncommitted = { branch: BRANCH, headSha: BASE, dirtyPaths: ["client/src/Card.tsx"] };
    const s = setup({
      statuses: [before, uncommitted],
      stdout: JSON.stringify(report({ headSha: BASE })),
    });
    const result = await s.adapter.start({ contract: contract(), now: NOW }).result;
    expect(result).toMatchObject({ status: "success", headSha: BASE, filesChanged: ["client/src/Card.tsx"] });
    expect(s.runner.specs[0].args).toContain('permissions.worker.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read",".codex/rules"="read"},":tmpdir"="write",":slash_tmp"="write"}');
  });

  it.each([
    ["git", "status", "--short"],
    ["git", "diff", "--stat"],
    ["git", "log", "-1"],
    ["git", "rev-parse", "HEAD"],
    ["pnpm", "vitest", "run", "worker.test.ts"],
    ["pnpm", "check"],
  ])("leaves ordinary inspection and validation command available without invoking Codex: %s", (...command) => {
    expect(requiredCodexPolicyDecision(command)).toBe("allowed");
  });

  it("fails closed before spawn when the required Codex policy cannot be established", async () => {
    const s = setup({ runtimeVerification: { ok: false, errorType: "policy_error", reason: "policy integrity check failed" } });
    const result = await s.adapter.start({ contract: contract(), now: NOW }).result;
    expect(result).toMatchObject({ status: "failure", errorType: "policy_error", headSha: BASE });
    expect(s.runner.specs).toHaveLength(0);
  });

  it.each([
    ["runtime_unavailable", "Codex CLI is unavailable"],
    ["runtime_misconfigured", "strict config is unsupported"],
    ["policy_error", "native policy verification failed"],
  ] as const)("fails closed with %s when runtime verification fails", async (errorType, reason) => {
    const s = setup({ runtimeVerification: { ok: false, errorType, reason } });
    const result = await s.adapter.start({ contract: contract(), now: NOW }).result;
    expect(result).toMatchObject({ status: "failure", errorType });
    expect(result.errorType).not.toBe("invalid_contract");
    expect(s.runner.specs).toHaveLength(0);
  });

  it.each(["main", "master", "HEAD"])("rejects protected/detached branch %s before execution", async (branch) => {
    const s = setup();
    const result = await s.adapter.start({
      contract: contract({ branch }),
      now: NOW,
    }).result;
    expect(result.errorType).toBe("protected_branch");
    expect(s.runner.specs).toHaveLength(0);
  });

  it("fails closed on branch or expected HEAD drift before execution", async () => {
    const wrongBranch = setup({
      statuses: [{ ...before, branch: "agent/other" }],
    });
    expect((await wrongBranch.adapter.start({ contract: contract(), now: NOW }).result).errorType).toBe("branch_mismatch");
    expect(wrongBranch.runner.specs).toHaveLength(0);
    const wrongHead = setup({
      statuses: [{ ...before, headSha: "c".repeat(40) }],
    });
    expect((await wrongHead.adapter.start({ contract: contract(), now: NOW }).result).errorType).toBe("branch_mismatch");
  });

  it("enforces exact-file and directory scopes from actual Git paths", async () => {
    const exact = setup({ changed: ["client/src/Card.tsx"] });
    expect((await exact.adapter.start({ contract: contract(), now: NOW }).result).status).toBe("success");
    const directory = setup({
      changed: ["client/src/styles/card.css"],
      stdout: JSON.stringify(report({ filesChanged: ["client/src/styles/card.css"] })),
    });
    expect((await directory.adapter.start({ contract: contract(), now: NOW }).result).status).toBe("success");
    const violation = setup({
      changed: ["server/auth.ts"],
      stdout: JSON.stringify(report({ filesChanged: ["server/auth.ts"] })),
    });
    const failed = await violation.adapter.start({
      contract: contract(),
      now: NOW,
    }).result;
    expect(failed).toMatchObject({
      status: "failure",
      errorType: "scope_violation",
      filesChanged: ["server/auth.ts"],
      prNumber: null,
    });
    expect(violation.runtimeChecks).toBe(1);
  });

  it("rejects malformed, contradictory, fabricated-PR, and oversized output", async () => {
    expect(
      (
        await setup({ stdout: "done" }).adapter.start({
          contract: contract(),
          now: NOW,
        }).result
      ).errorType,
    ).toBe("malformed_output");
    expect(
      (
        await setup({
          stdout: JSON.stringify(report({ headSha: "c".repeat(40) })),
        }).adapter.start({ contract: contract(), now: NOW }).result
      ).errorType,
    ).toBe("result_mismatch");
    expect(
      (
        await setup({
          stdout: JSON.stringify({ ...report(), prNumber: 12 }),
        }).adapter.start({ contract: contract(), now: NOW }).result
      ).errorType,
    ).toBe("malformed_output");
    const truncated = setup();
    truncated.runner.spawn = () => ({
      exit: Promise.resolve({
        exitCode: 0,
        signal: null,
        stdout: "{}",
        stderr: "secret",
        truncated: true,
      }),
      kill() {},
    });
    expect((await truncated.adapter.start({ contract: contract(), now: NOW }).result).errorType).toBe("malformed_output");
  });

  it("cancels and times out through process-group runner abstraction", async () => {
    const cancelled = setup({ hang: true });
    const handle = cancelled.adapter.start({ contract: contract(), now: NOW });
    await flush(() => cancelled.runner.specs.length === 1);
    handle.cancel();
    expect(await handle.result).toMatchObject({
      status: "cancelled",
      errorType: "cancelled",
    });
    expect(cancelled.runner.kills).toBe(1);

    const timed = setup({ hang: true });
    const run = timed.adapter.start({ contract: contract(), now: NOW });
    await flush(() => timed.runner.specs.length === 1);
    timed.timer.fire();
    expect(await run.result).toMatchObject({
      status: "timeout",
      errorType: "timeout",
    });
  });

  it("rejects unsafe scope and model data before spawning", async () => {
    const unsafe = setup();
    expect(
      (
        await unsafe.adapter.start({
          contract: contract({ allowedScope: ["../server/"] }),
          now: NOW,
        }).result
      ).errorType,
    ).toBe("invalid_contract");
    expect(unsafe.runner.specs).toHaveLength(0);
    expect(unsafe.runtimeChecks).toBe(0);
    const model = setup({ model: "x; git push" });
    expect((await model.adapter.start({ contract: contract(), now: NOW }).result).errorType).toBe("runtime_misconfigured");
    expect(model.runner.specs).toHaveLength(0);
  });
});
