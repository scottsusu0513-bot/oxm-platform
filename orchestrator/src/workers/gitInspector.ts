import { createHash } from "node:crypto";
import { gitMetadataComponentDigest, gitMetadataSnapshot, readContentIdentities, type GitMetadataSnapshot } from "./gitIntegrity";
import type { GitInspector, ProcessExit, ProcessRunner } from "./types";

/**
 * Read-only git inspection over the injected ProcessRunner. Every invocation
 * is a fixed argument array of a read-only subcommand (rev-parse, status,
 * diff, ls-files); caller data only ever appears as a validated SHA argument.
 * Content identities and the metadata digest are plain filesystem reads.
 */

const SHA_RE = /^[0-9a-f]{40}$/;

export const READ_ONLY_GIT_SUBCOMMANDS = ["rev-parse", "status", "diff", "ls-files"] as const;

export function createGitInspector(runner: ProcessRunner, repoRoot: string): GitInspector {
  const git = async (args: string[]): Promise<string> => {
    if (!(READ_ONLY_GIT_SUBCOMMANDS as readonly string[]).includes(args[0])) {
      throw new Error(`git ${args[0]} is not a read-only subcommand`);
    }
    const res: ProcessExit = await runner.spawn({ command: "git", args, cwd: repoRoot }).exit;
    if (res.exitCode !== 0 || res.truncated) throw new Error(`git ${args[0]} failed`);
    return res.stdout;
  };

  return {
    async status() {
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const headSha = (await git(["rev-parse", "HEAD"])).trim();
      const porcelain = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      return { branch, headSha, dirtyPaths: parsePorcelainZ(porcelain) };
    },
    async changedPathsSince(fromSha) {
      if (!SHA_RE.test(fromSha)) throw new Error("invalid base SHA");
      const diff = await git(["diff", "--no-renames", "--name-only", "-z", fromSha, "--"]);
      const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      const all = new Set([...diff.split("\0").filter(Boolean), ...parsePorcelainZ(status)]);
      return Array.from(all).sort();
    },
    contentIdentities(paths) {
      return readContentIdentities(repoRoot, paths);
    },
    async metadataDigest() {
      return (await snapshot()).digest;
    },
    metadataSnapshot: snapshot,
  };

  async function snapshot(): Promise<GitMetadataSnapshot> {
    const files = await gitMetadataSnapshot(repoRoot);
    // assume-unchanged (lowercase tag) / skip-worktree ("S") index flags hide edits from status and add.
    const listing = await git(["ls-files", "-v", "-z"]);
    const hidden = listing.split("\0").filter((e) => e.length > 2 && (e[0] === "S" || /[a-z]/.test(e[0]))).sort();
    const flags = Object.fromEntries(hidden.slice(0, 5000).map((e) => [`index:${e.slice(2)}`, e[0]]));
    if (hidden.length > 5000) flags["index:(more)"] = String(hidden.length);
    const indexFlags = { id: "repo.index_flags" as const, digest: gitMetadataComponentDigest(flags), entries: flags, keys: {} };
    return {
      digest: createHash("sha256").update(JSON.stringify([files.digest, hidden])).digest("hex"),
      components: [...files.components, indexFlags],
    };
  }
}

/** Parses `git status --porcelain=v1 -z`: "XY path\0", renames/copies add "orig\0". */
export function parsePorcelainZ(out: string): string[] {
  const parts = out.split("\0");
  const paths = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    paths.add(entry.slice(3));
    if (xy[0] === "R" || xy[0] === "C") {
      const orig = parts[++i];
      if (orig) paths.add(orig);
    }
  }
  return Array.from(paths).sort();
}
