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
