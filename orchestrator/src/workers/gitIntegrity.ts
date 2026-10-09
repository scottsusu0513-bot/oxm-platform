import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isSafeRepoPath } from "./resultParser";

/**
 * Trusted, read-only integrity primitives shared by the worker adapters and
 * the trusted commit layer. Nothing here writes to disk or runs Git.
 *
 * - Content identity: the Git blob id (SHA-1 over "blob <len>\0" + bytes) of
 *   the raw working-tree bytes, plus the file mode. Never mtime or size.
 * - Metadata digest: SHA-256 over the Git metadata that can change what a
 *   trusted `git add` / `git commit` does (config + includes, hooks, info/
 *   attributes/excludes, alternates, replace refs, HEAD, shallow, global and
 *   system config). Refs/logs/index/objects written by trusted Git operations
 *   are deliberately excluded; branch/HEAD SHAs are verified separately.
 */

export type ContentMode = "100644" | "100755" | "120000" | "absent";

export interface PathContentIdentity {
  path: string;
  mode: ContentMode;
  /** Git blob id of the raw working-tree bytes; null when the path is absent. */
  blob: string | null;
}

const MAX_METADATA_ENTRIES = 5000;
const MAX_INCLUDE_DEPTH = 4;

export function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

export function normalizeContentIdentities(ids: readonly PathContentIdentity[]): PathContentIdentity[] {
  return ids.map(({ path, mode, blob }) => ({ path, mode, blob })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function sameContentIdentities(a: readonly PathContentIdentity[], b: readonly PathContentIdentity[]): boolean {
  const x = normalizeContentIdentities(a);
  const y = normalizeContentIdentities(b);
  return x.length === y.length && x.every((v, i) => v.path === y[i].path && v.mode === y[i].mode && v.blob === y[i].blob);
}

const isMissing = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** Reads the identity of each repo-relative path from the working tree; fails closed on anything unusual. */
export async function readContentIdentities(repoRoot: string, paths: readonly string[]): Promise<PathContentIdentity[]> {
  const out: PathContentIdentity[] = [];
  for (const path of Array.from(new Set(paths)).sort()) {
    if (!isSafeRepoPath(path) || path.split("/").some((part) => part.toLowerCase() === ".git")) {
      throw new Error("unsafe content identity path");
    }
    const parts = path.split("/");
    let absent = false;
    // Every parent must be a real directory inside the repository (no symlink escape).
    for (let i = 1; i < parts.length && !absent; i++) {
      try {
        const st = await lstat(join(repoRoot, ...parts.slice(0, i)));
        if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("content path traverses a symlink or non-directory");
      } catch (err) {
        if (!isMissing(err)) throw err;
        absent = true;
      }
    }
    if (absent) {
      out.push({ path, mode: "absent", blob: null });
      continue;
    }
    const full = join(repoRoot, ...parts);
    let st;
    try {
      st = await lstat(full);
    } catch (err) {
      if (!isMissing(err)) throw err;
      out.push({ path, mode: "absent", blob: null });
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push({ path, mode: "120000", blob: gitBlobId(Buffer.from(await readlink(full, { encoding: "buffer" }))) });
    } else if (st.isFile()) {
      out.push({ path, mode: st.mode & 0o111 ? "100755" : "100644", blob: gitBlobId(await readFile(full)) });
    } else {
      throw new Error("content path is not a regular file or symlink");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Git metadata digest

type Entries = Map<string, string>;

async function describeFile(path: string): Promise<{ value: string; bytes: Buffer | null }> {
  try {
    const st = await lstat(path);
    if (st.isSymbolicLink()) return { value: `link:${await readlink(path)}`, bytes: null };
    if (st.isDirectory()) return { value: "dir", bytes: null };
    if (!st.isFile()) return { value: "special", bytes: null };
    const bytes = await readFile(path);
    return { value: `file:${st.mode & 0o111 ? "x" : "-"}:${createHash("sha256").update(bytes).digest("hex")}`, bytes };
  } catch (err) {
    if (isMissing(err)) return { value: "absent", bytes: null };
    // Unreadable (e.g. permissions): record it, so a later change in readability is still drift.
    return { value: `unreadable:${(err as NodeJS.ErrnoException).code ?? "unknown"}`, bytes: null };
  }
}

function add(entries: Entries, label: string, value: string) {
  if (entries.size >= MAX_METADATA_ENTRIES) throw new Error("git metadata is too large to verify");
  entries.set(label, value);
}

async function addFile(entries: Entries, label: string, path: string): Promise<Buffer | null> {
  const d = await describeFile(path);
  add(entries, label, d.value);
  return d.bytes;
}

async function addTree(entries: Entries, label: string, path: string): Promise<void> {
  const d = await describeFile(path);
  if (d.value !== "dir") {
    add(entries, label, d.value);
    return;
  }
  add(entries, label, "dir");
  const names = (await readdir(path)).sort();
  for (const name of names) await addTree(entries, `${label}/${name}`, join(path, name));
}

function expandHome(value: string, home: string): string {
  return value.startsWith("~/") ? join(home, value.slice(2)) : value;
}

/** Config values that point at other files/dirs Git would consult during add/commit. */
function referencedPaths(config: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const re = /^\s*(path|hookspath|attributesfile|excludesfile|fsmonitor)\s*=\s*(.+?)\s*$/gim;
  for (const m of Array.from(config.matchAll(re))) out.push({ key: m[1].toLowerCase(), value: m[2].replace(/^"(.*)"$/, "$1") });
  return out;
}

const BENIGN_BRANCH_HEADER_RE = /^\[branch "[A-Za-z0-9._/-]+"\]$/;
/**
 * Exact `git config`-written lines of editor-integration caches Git never reads:
 * - VS Code's Git extension: `vscode-merge-base = <ref>` (unquoted; the ref charset needs no quoting).
 * - GitHub Pull Requests extension: `github-pr-base-branch = "<owner>#<repo>#<branch>"`. `#` starts a
 *   comment in Git config, so `git config` always quotes this value; the unquoted spelling is not the
 *   integration's shape and stays hashed.
 */
const BENIGN_BRANCH_KEY_RES = [
  /^\tvscode-merge-base = [A-Za-z0-9._/-]+$/,
  /^\tgithub-pr-base-branch = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})#[A-Za-z0-9._-]+#[A-Za-z0-9._/-]+"$/,
];

/**
 * VS Code's Git extension and the GitHub Pull Requests extension (Codespaces) asynchronously cache
 * `branch.<name>.vscode-merge-base` / `branch.<name>.github-pr-base-branch` in the repository config
 * (via `git config --local`) shortly after they see a branch. Git never reads those keys, so exactly
 * the `git config`-written shapes are dropped before hashing: the key line inside a strict
 * `[branch "…"]` section, plus that header when the section holds nothing else. Any other spelling
 * (CRLF, other quoting, comments, line continuation, other sections or keys) is still hashed
 * byte-for-byte and fails closed.
 */
export function normalizeRepoConfig(bytes: Buffer): Buffer {
  const lines = bytes.toString("latin1").split("\n");
  const continued = (i: number) => i > 0 && lines[i - 1].endsWith("\\");
  const drop = new Set<number>();
  let header = -1;
  let branchSection = false;
  let sectionKeys: number[] = [];
  let sectionOnlyBenign = false;
  const closeSection = () => {
    if (branchSection && header >= 0 && sectionOnlyBenign && sectionKeys.length > 0) drop.add(header);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === lines.length - 1 && line === "") break;
    if (!continued(i) && /^\s*\[/.test(line)) {
      closeSection();
      header = i;
      branchSection = BENIGN_BRANCH_HEADER_RE.test(line);
      sectionKeys = [];
      sectionOnlyBenign = true;
      continue;
    }
    if (branchSection && !continued(i) && BENIGN_BRANCH_KEY_RES.some((re) => re.test(line))) {
      drop.add(i);
      sectionKeys.push(i);
    } else sectionOnlyBenign = false;
  }
  closeSection();
  if (drop.size === 0) return bytes;
  return Buffer.from(lines.filter((_, i) => !drop.has(i)).join("\n"), "latin1");
}

async function addConfig(
  entries: Entries,
  label: string,
  path: string,
  ctx: { repoRoot: string; home: string; seen: Set<string> },
  depth = 0,
  normalize?: (bytes: Buffer) => Buffer,
): Promise<void> {
  const abs = resolve(path);
  if (ctx.seen.has(abs)) return;
  ctx.seen.add(abs);
  const d = await describeFile(abs);
  const bytes = d.bytes;
  // d.value is "file:<x|->:<sha256>"; a normalized config swaps in the hash of its normalized bytes.
  add(entries, label, bytes && normalize ? d.value.slice(0, -64) + createHash("sha256").update(normalize(bytes)).digest("hex") : d.value);
  if (!bytes || depth >= MAX_INCLUDE_DEPTH) return;
  for (const ref of referencedPaths(bytes.toString("utf8"))) {
    if (ref.key === "fsmonitor" && !/[\\/]/.test(ref.value)) continue; // boolean value; the config bytes already cover it
    const expanded = expandHome(ref.value, ctx.home);
    const base = ref.key === "hookspath" ? ctx.repoRoot : dirname(abs);
    const target = isAbsolute(expanded) ? expanded : resolve(base, expanded);
    if (ref.key === "path") await addConfig(entries, `include:${target}`, target, ctx, depth + 1);
    else await addTree(entries, `${ref.key}:${target}`, target);
  }
}

/** Environment variables that relocate global/system Git config (HOME, XDG_CONFIG_HOME, GIT_CONFIG_*, ...). */
export type GitMetadataEnv = Readonly<Record<string, string | undefined>>;

async function resolveGitDirs(repoRoot: string): Promise<{ gitDir: string; commonDir: string }> {
  const dotGit = join(repoRoot, ".git");
  const st = await lstat(dotGit);
  let gitDir: string;
  if (st.isDirectory()) gitDir = dotGit;
  else if (st.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, "utf8"));
    if (!m) throw new Error(".git file does not name a gitdir");
    gitDir = resolve(repoRoot, m[1]);
  } else throw new Error(".git is neither a directory nor a gitdir file");
  let commonDir = gitDir;
  try {
    commonDir = resolve(gitDir, (await readFile(join(gitDir, "commondir"), "utf8")).trim());
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  return { gitDir, commonDir };
}

/**
 * Deterministic SHA-256 over every piece of Git metadata that could alter the
 * trusted commit. Any read error other than "missing" fails closed (throws).
 */
export async function gitMetadataDigest(repoRoot: string, env: GitMetadataEnv = process.env): Promise<string> {
  const entries: Entries = new Map();
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const ctx = { repoRoot: resolve(repoRoot), home, seen: new Set<string>() };
  const { gitDir, commonDir } = await resolveGitDirs(repoRoot);
  const dirs = gitDir === commonDir ? [["git", gitDir]] : [["git", gitDir], ["common", commonDir]];

  for (const [tag, dir] of dirs) {
    await addConfig(entries, `${tag}:config`, join(dir, "config"), ctx, 0, normalizeRepoConfig);
    await addConfig(entries, `${tag}:config.worktree`, join(dir, "config.worktree"), ctx);
    for (const name of ["HEAD", "commondir", "shallow", "objects/info/alternates", "objects/info/http-alternates"]) {
      await addFile(entries, `${tag}:${name}`, join(dir, ...name.split("/")));
    }
    for (const name of ["info", "hooks", "refs/replace"]) await addTree(entries, `${tag}:${name}`, join(dir, ...name.split("/")));
    // Only replace refs from packed-refs: branch/remote refs legitimately move under trusted Git.
    const packed = await describeFile(join(dir, "packed-refs"));
    const replaceLines = packed.bytes
      ? packed.bytes.toString("utf8").split(/\r?\n/).filter((line) => line.includes(" refs/replace/")).join("\n")
      : packed.value;
    add(entries, `${tag}:packed-refs(replace)`, createHash("sha256").update(replaceLines).digest("hex"));
  }

  const xdg = env.XDG_CONFIG_HOME ?? join(home, ".config");
  const globals = env.GIT_CONFIG_GLOBAL ? [env.GIT_CONFIG_GLOBAL] : [join(home, ".gitconfig"), join(xdg, "git", "config")];
  for (const path of globals) await addConfig(entries, `global:${path}`, path, ctx);
  for (const name of ["attributes", "ignore"]) await addFile(entries, `global:${join(xdg, "git", name)}`, join(xdg, "git", name));
  const system = env.GIT_CONFIG_SYSTEM ?? (env.PROGRAMDATA ? join(env.PROGRAMDATA, "Git", "config") : "/etc/gitconfig");
  await addConfig(entries, `system:${system}`, system, ctx);

  const canonical = JSON.stringify(Array.from(entries.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHash("sha256").update(canonical).digest("hex");
}
