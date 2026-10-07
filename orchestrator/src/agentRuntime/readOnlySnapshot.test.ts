import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeProcessRunner } from "../workers/processRunner";
import type { WorkerAdapter, WorkerResult, WorkerRunRequest, WorkerTaskContract } from "../workers/types";
import { createReadOnlySnapshotAdapter, routeByMode } from "./readOnlySnapshot";

const BRANCH = "agent/task-t1-search";
const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A real authoritative repository on a task branch, plus an untracked secret file. */
function authoritativeRepo() {
  const root = tmp("oxm-auth-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "search.ts"), "export const search = () => 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  git(root, "checkout", "-q", "-b", BRANCH);
  writeFileSync(join(root, ".env"), "SECRET=do-not-copy\n");
  return { root, head: git(root, "rev-parse", "HEAD") };
}

const contract = (head: string, mode: "read_only" | "change" = "read_only"): WorkerTaskContract => ({
  taskId: "t1",
  runId: "t1-run-1",
  category: "general_coding",
  actions: [{ kind: "repo_read" }, { kind: "run_check" }],
  objective: "Explain how search works",
  allowedScope: ["search.ts"],
  acceptanceCriteria: ["answered"],
  requiredValidations: ["typecheck"],
  branch: BRANCH,
  expectedHeadSha: head,
  gitMetadataDigest: "a".repeat(64),
  mode,
});

const ok = (c: WorkerTaskContract, over: Partial<WorkerResult> = {}): WorkerResult => ({
  status: "success",
  summary: "Search is implemented in search.ts",
  filesChanged: [],
  testsRun: [],
  checkResult: "not_run",
  branch: c.branch,
  headSha: c.expectedHeadSha ?? null,
  prNumber: null,
  riskObserved: { level: "green", notes: [] },
  needsApproval: false,
  fallbackRecommended: false,
  errorType: null,
  workerErrorCode: null,
  ...over,
});

/** Fake Worker that records what it saw and optionally tries to mutate its repository root. */
function fakeWorker(behaviour: "answer" | "mutate") {
  const seen: { root: string; contract: WorkerTaskContract; envCopied: boolean; remotes: string; head: string }[] = [];
  const make = (root: string): WorkerAdapter => ({
    kind: "codex",
    start(req: WorkerRunRequest) {
      seen.push({ root, contract: structuredClone(req.contract), envCopied: existsSync(join(root, ".env")), remotes: git(root, "remote"), head: git(root, "rev-parse", "HEAD") });
      if (behaviour === "mutate") {
        writeFileSync(join(root, "search.ts"), "export const search = () => 'pwned';\n");
        writeFileSync(join(root, "backdoor.ts"), "evil\n");
      }
      return { runId: req.contract.runId, promptHash: null, result: Promise.resolve(ok(req.contract)), cancel() {} };
    },
  });
  return { seen, make };
}

describe("true read-only Worker isolation (real git)", () => {
  it("a read-only Worker runs in a disposable snapshot at the trusted HEAD; attempted edits never reach the authoritative workspace", async () => {
    const { root, head } = authoritativeRepo();
    const tmpRoot = tmp("oxm-snapshots-");
    const w = fakeWorker("mutate");
    const adapter = createReadOnlySnapshotAdapter({ kind: "codex", repoRoot: root, runner: createNodeProcessRunner(), makeAdapter: w.make, tmpRoot });
    const result = await adapter.start({ contract: contract(head), now: new Date().toISOString() }).result;

    expect(result).toMatchObject({ status: "failure", errorType: "scope_violation", filesChanged: [] });
    // Authoritative workspace: byte- and Git-clean, same HEAD and branch, only the pre-existing untracked .env.
    expect(readFileSync(join(root, "search.ts"), "utf8")).toBe("export const search = () => 1;\n");
    expect(existsSync(join(root, "backdoor.ts"))).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("?? .env");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
    // The Worker saw a different root at the exact HEAD, without secrets or a way back.
    expect(w.seen[0].root).not.toBe(root);
    expect(w.seen[0].head).toBe(head);
    expect(w.seen[0].envCopied).toBe(false);
    expect(w.seen[0].remotes).toBe("");
    expect(w.seen[0].contract.requiredValidations).toEqual([]);
    // The snapshot is destroyed.
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("a clean read-only run returns its evidence (answer) and leaves nothing behind", async () => {
    const { root, head } = authoritativeRepo();
    const tmpRoot = tmp("oxm-snapshots-");
    const w = fakeWorker("answer");
    const result = await createReadOnlySnapshotAdapter({ kind: "codex", repoRoot: root, runner: createNodeProcessRunner(), makeAdapter: w.make, tmpRoot }).start({ contract: contract(head), now: new Date().toISOString() }).result;
    expect(result).toMatchObject({ status: "success", summary: "Search is implemented in search.ts", filesChanged: [], headSha: head, branch: BRANCH });
    expect(git(root, "status", "--porcelain")).toBe("?? .env");
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("refuses a non-read-only contract or an authoritative workspace not at the trusted HEAD", async () => {
    const { root, head } = authoritativeRepo();
    const w = fakeWorker("answer");
    const adapter = createReadOnlySnapshotAdapter({ kind: "codex", repoRoot: root, runner: createNodeProcessRunner(), makeAdapter: w.make, tmpRoot: tmp("oxm-snapshots-") });
    expect(await adapter.start({ contract: contract(head, "change"), now: "t" }).result).toMatchObject({ status: "failure", errorType: "invalid_contract" });
    expect(await adapter.start({ contract: contract("b".repeat(40)), now: "t" }).result).toMatchObject({ status: "failure", errorType: "branch_mismatch" });
    expect(w.seen).toHaveLength(0);
  });

  it("routes only read-only contracts to the snapshot runtime", () => {
    const calls: string[] = [];
    const mk = (name: string): WorkerAdapter => ({ kind: "codex", start: (r) => (calls.push(name), { runId: r.contract.runId, promptHash: null, result: Promise.resolve(ok(r.contract)), cancel() {} }) });
    const routed = routeByMode(mk("change"), mk("snapshot"));
    routed.start({ contract: contract("c".repeat(40), "read_only"), now: "t" });
    routed.start({ contract: contract("c".repeat(40), "change"), now: "t" });
    routed.start({ contract: { ...contract("c".repeat(40)), mode: undefined }, now: "t" });
    expect(calls).toEqual(["snapshot", "change", "change"]);
  });
});
