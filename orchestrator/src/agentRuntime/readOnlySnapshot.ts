import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { createGitInspector } from "../workers/gitInspector";
import type { WorkerKind } from "../domain/types";
import type { GitInspector, ProcessRunner, WorkerAdapter, WorkerHandle, WorkerResult, WorkerRunRequest, WorkerTaskContract } from "../workers/types";

/**
 * True read-only isolation for investigate / review tasks.
 *
 * The Worker never runs in the authoritative task workspace. Each read-only
 * run gets a disposable snapshot: a fresh `git clone --shared --no-checkout`
 * of the authoritative repository (outside it, in the OS temp dir) checked
 * out at the exact trusted HEAD on the task branch. Untracked files (.env,
 * credentials, node_modules) are never copied; Git LFS smudging is disabled.
 * Whatever the Worker does in the snapshot cannot propagate back: there is no
 * fetch/push path from the snapshot, and the snapshot is always deleted.
 * Evidence (the answer) is returned; code changes never are.
 *
 * Fail closed: any snapshot preparation error, a snapshot not at the trusted
 * HEAD, an edit attempted in the snapshot, or any change observed in the
 * authoritative workspace turns the run into a failure.
 */
export interface ReadOnlySnapshotOptions {
  kind: WorkerKind;
  /** Authoritative task workspace (never handed to the Worker). */
  repoRoot: string;
  runner: ProcessRunner;
  /** Builds the real adapter bound to a snapshot root. */
  makeAdapter(snapshotRoot: string): WorkerAdapter;
  tmpRoot?: string;
  git?: (root: string) => GitInspector;
}

function failed(c: WorkerTaskContract, errorType: WorkerResult["errorType"], summary: string, headSha: string | null = null): WorkerResult {
  return {
    status: "failure",
    summary,
    filesChanged: [],
    testsRun: [],
    checkResult: "not_run",
    branch: c.branch,
    headSha,
    prNumber: null,
    riskObserved: { level: c.storedRiskLevel ?? "green", notes: [] },
    needsApproval: false,
    fallbackRecommended: false,
    errorType,
    workerErrorCode: null,
  };
}

export function createReadOnlySnapshotAdapter(opts: ReadOnlySnapshotOptions): WorkerAdapter {
  const gitFor = opts.git ?? ((root: string) => createGitInspector(opts.runner, root));
  const authoritative = gitFor(opts.repoRoot);

  async function git(cwd: string, args: string[]): Promise<boolean> {
    const exit = await opts.runner.spawn({ command: "git", args, cwd }).exit;
    return exit.exitCode === 0 && !exit.truncated;
  }

  return {
    kind: opts.kind,
    start(request: WorkerRunRequest): WorkerHandle {
      const c = request.contract;
      let inner: WorkerHandle | null = null;
      let cancelled = false;
      const result = (async (): Promise<WorkerResult> => {
        if (c.mode !== "read_only") return failed(c, "invalid_contract", "snapshot runtime only executes read-only contracts");
        if (!c.expectedHeadSha || !/^[0-9a-f]{40}$/.test(c.expectedHeadSha)) return failed(c, "invalid_contract", "read-only run requires the trusted HEAD");
        let before: { status: Awaited<ReturnType<GitInspector["status"]>>; digest: string };
        try {
          before = { status: await authoritative.status(), digest: await authoritative.metadataDigest() };
        } catch {
          return failed(c, "git_error", "authoritative workspace could not be inspected");
        }
        if (before.status.headSha !== c.expectedHeadSha || before.status.branch !== c.branch)
          return failed(c, "branch_mismatch", "authoritative workspace is not at the trusted HEAD", before.status.headSha);

        let dir: string | null = null;
        try {
          dir = mkdtempSync(join(opts.tmpRoot ?? tmpdir(), "oxm-readonly-"));
          const rel = relative(realpathSync(opts.repoRoot), realpathSync(dir));
          if (!rel.startsWith("..") && !isAbsolute(rel)) return failed(c, "temp_file_error", "snapshot must live outside the repository");
          const snapshot = join(dir, "repo");
          const noLfs = ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false", "-c", "core.hooksPath=/dev/null"];
          if (!(await git(dir, [...noLfs, "clone", "--quiet", "--shared", "--no-checkout", "--no-tags", opts.repoRoot, snapshot])))
            return failed(c, "runtime_unavailable", "read-only snapshot could not be created");
          if (!(await git(snapshot, [...noLfs, "checkout", "--quiet", "-B", c.branch, c.expectedHeadSha])))
            return failed(c, "runtime_unavailable", "read-only snapshot could not be checked out at the trusted HEAD");
          // The snapshot has no way back: drop the remote that points at the authoritative repository.
          if (!(await git(snapshot, ["remote", "remove", "origin"]))) return failed(c, "runtime_unavailable", "read-only snapshot could not be detached");
          const snapGit = gitFor(snapshot);
          const snapStatus = await snapGit.status();
          if (snapStatus.headSha !== c.expectedHeadSha || snapStatus.branch !== c.branch || snapStatus.dirtyPaths.length > 0)
            return failed(c, "runtime_unavailable", "read-only snapshot is not a clean copy of the trusted HEAD");
          const snapshotContract: WorkerTaskContract = {
            ...c,
            // Validations are run by the orchestrator in the authoritative workspace, not by the Worker.
            requiredValidations: [],
            allowedDirtyPaths: [],
            gitMetadataDigest: await snapGit.metadataDigest(),
          };
          if (cancelled) return failed(c, "cancelled", "worker run cancelled");
          inner = opts.makeAdapter(snapshot).start({ ...request, contract: snapshotContract });
          const out = await inner.result;
          const after = await snapGit.status().catch(() => null);
          const attempted = !after || after.headSha !== c.expectedHeadSha || after.dirtyPaths.length > 0 || out.filesChanged.length > 0;
          if (attempted && out.status === "success")
            return failed(c, "scope_violation", "read-only worker attempted to modify files in its disposable snapshot; the changes were discarded", c.expectedHeadSha);
          return { ...out, filesChanged: [], branch: c.branch, headSha: out.headSha === null ? null : c.expectedHeadSha };
        } catch {
          return failed(c, "runtime_unavailable", "read-only snapshot runtime failed");
        } finally {
          if (dir) rmSync(dir, { recursive: true, force: true });
          // Defense in depth: the authoritative workspace must be byte-identical in Git terms.
          const now = await authoritative.status().catch(() => null);
          const digest = await authoritative.metadataDigest().catch(() => null);
          if (!now || now.headSha !== before.status.headSha || now.branch !== before.status.branch || JSON.stringify(now.dirtyPaths) !== JSON.stringify(before.status.dirtyPaths) || digest !== before.digest)
            return failed(c, "git_metadata_changed", "authoritative workspace changed during a read-only run", now?.headSha ?? null);
        }
      })().catch(() => failed(c, "runtime_unavailable", "read-only snapshot runtime failed"));
      return {
        runId: c.runId,
        promptHash: null,
        result,
        cancel(reason) {
          cancelled = true;
          inner?.cancel(reason);
        },
      };
    },
  };
}

/** Routes read-only contracts to the isolated snapshot runtime and everything else to the normal adapter. */
export function routeByMode(change: WorkerAdapter, readOnly: WorkerAdapter): WorkerAdapter {
  if (change.kind !== readOnly.kind) throw new Error("adapter kinds differ");
  return {
    kind: change.kind,
    start: (request) => (request.contract.mode === "read_only" ? readOnly.start(request) : change.start(request)),
  };
}
