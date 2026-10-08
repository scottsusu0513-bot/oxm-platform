import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { isSafeRepoPath } from "../workers/resultParser";
import type { ProcessRunner } from "../workers/types";
import { resolveRepoRoot } from "./repoRoot";

const MAX_FILE = 64_000;

/** Trusted repository read for the goal reviewer: inside the repo, regular file, bounded, no secrets paths. */
export function createRepoFileReader(repoRoot: string): (path: string) => string | null {
  const resolved = resolveRepoRoot(repoRoot);
  if (!resolved.ok) throw new Error(`repository file reader: ${resolved.reason}`);
  const root = resolved.root;
  return (path) => {
    if (!isSafeRepoPath(path) || /(^|\/)\.env|(^|\/)\.git\//.test(path)) return null;
    try {
      const abs = realpathSync(join(root, path));
      const rel = relative(root, abs);
      if (rel.startsWith("..") || isAbsolute(rel) || !statSync(abs).isFile()) return null;
      return readFileSync(abs, "utf8").slice(0, MAX_FILE);
    } catch {
      return null;
    }
  };
}

/** Trusted diff of the working tree against the run's start SHA, including new (untracked) files. */
export function createWorkingTreeDiff(runner: ProcessRunner, repoRoot: string): (fromSha: string, paths: readonly string[]) => Promise<string> {
  const read = createRepoFileReader(repoRoot);
  return async (fromSha, paths) => {
    if (!/^[0-9a-f]{40}$/.test(fromSha)) throw new Error("invalid diff base");
    const safe = paths.filter((p) => isSafeRepoPath(p));
    const tracked = await runner.spawn({ command: "git", args: ["diff", "--no-color", "--no-ext-diff", fromSha, "--", ...safe], cwd: repoRoot }).exit;
    if (tracked.exitCode !== 0) throw new Error("git diff failed");
    const untracked = await runner.spawn({ command: "git", args: ["ls-files", "--others", "--exclude-standard", "--", ...safe], cwd: repoRoot }).exit;
    const added = untracked.exitCode === 0 ? untracked.stdout.split("\n").filter(Boolean) : [];
    const newFiles = added.map((p) => `--- /dev/null\n+++ b/${p} (new file)\n${(read(p) ?? "(unreadable)").split("\n").map((l) => `+${l}`).join("\n")}`);
    return [tracked.stdout, ...newFiles].join("\n");
  };
}

const MAX_LISTED = 20_000;

/** Trusted diff between two commits (a part's base and its pushed head), bounded by the caller. */
export function createCommitRangeDiff(runner: ProcessRunner, repoRoot: string): (fromSha: string, toSha: string) => Promise<string> {
  return async (fromSha, toSha) => {
    if (!/^[0-9a-f]{40}$/.test(fromSha) || !/^[0-9a-f]{40}$/.test(toSha)) throw new Error("invalid diff range");
    const out = await runner.spawn({ command: "git", args: ["diff", "--no-color", "--no-ext-diff", fromSha, toSha], cwd: repoRoot }).exit;
    if (out.exitCode !== 0) throw new Error("git diff failed");
    return out.stdout;
  };
}

/**
 * Trusted, read-only repository search for the Manager's own evidence
 * gathering: tracked file listing and fixed-string content search. Never a
 * shell; the keyword is a literal (-F) argument after "--e"; secret-looking
 * paths are dropped like in createRepoFileReader.
 */
export function createRepoSearch(runner: ProcessRunner, repoRoot: string): { listFiles(): Promise<string[]>; searchContent(keyword: string): Promise<string[]> } {
  const safe = (paths: string[]) => paths.filter((p) => isSafeRepoPath(p) && !/(^|\/)\.env|(^|\/)\.git\//.test(p)).slice(0, MAX_LISTED);
  return {
    async listFiles() {
      const out = await runner.spawn({ command: "git", args: ["ls-files", "-z"], cwd: repoRoot }).exit;
      if (out.exitCode !== 0 || out.truncated) return [];
      return safe(out.stdout.split("\0").filter(Boolean));
    },
    async searchContent(keyword) {
      if (!/^[A-Za-z0-9_\u3400-\u9fff -]{3,60}$/.test(keyword)) return [];
      const out = await runner.spawn({ command: "git", args: ["grep", "-l", "-I", "-i", "-F", "-z", "-e", keyword, "--", "client", "server", "shared"], cwd: repoRoot }).exit;
      // git grep exits 1 when nothing matches.
      if ((out.exitCode !== 0 && out.exitCode !== 1) || out.truncated) return [];
      return safe(out.stdout.split("\0").filter(Boolean)).slice(0, 50);
    },
  };
}
