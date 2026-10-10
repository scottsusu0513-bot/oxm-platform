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
 * - Metadata snapshot: the same metadata split into named components (see
 *   GIT_METADATA_COMPONENTS), each with its own digest, entry fingerprints and
 *   config key names, so a change can be explained and classified
 *   (workers/gitMetadataPolicy.ts). Only "security" components feed the
 *   integrity digest; editor-integration caches and Git housekeeping output
 *   are recorded and classified explicitly, never silently dropped.
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
// Git metadata snapshot (component level) and integrity digest

/** Stable ids of the components a Git metadata snapshot is split into. */
export const GIT_METADATA_COMPONENT_IDS = [
  "repo.head",
  "repo.commondir",
  "repo.config",
  "repo.config_worktree",
  "repo.config_include",
  "repo.config_paths",
  "repo.config_integration",
  "repo.hooks",
  "repo.info",
  "repo.info_server",
  "repo.replace_refs",
  "repo.shallow",
  "repo.alternates",
  "repo.index_flags",
  "env.global_config",
  "env.global_attributes_ignore",
  "env.system_config",
  "env.config_include",
  "env.config_paths",
  "opaque",
] as const;
export type GitMetadataComponentId = (typeof GIT_METADATA_COMPONENT_IDS)[number];

/** repository: lives in the task's Git dir; environment: global/system Git configuration outside it. */
export type GitMetadataScope = "repository" | "environment";
/**
 * security: can change what trusted staging/commit/push does; hashed into the integrity digest.
 * integration: editor/IDE caches Git never reads; recorded and classified, not hashed.
 * housekeeping: files Git regenerates itself and never reads for add/commit; recorded, not hashed.
 */
export type GitMetadataTrust = "security" | "integration" | "housekeeping";

export const GIT_METADATA_COMPONENTS: Readonly<Record<GitMetadataComponentId, { scope: GitMetadataScope; trust: GitMetadataTrust; what: string }>> = {
  "repo.head": { scope: "repository", trust: "security", what: "HEAD (current branch identity)" },
  "repo.commondir": { scope: "repository", trust: "security", what: "worktree commondir pointer" },
  "repo.config": { scope: "repository", trust: "security", what: "repository Git config" },
  "repo.config_worktree": { scope: "repository", trust: "security", what: "per-worktree Git config" },
  "repo.config_include": { scope: "repository", trust: "security", what: "config files included by the repository config" },
  "repo.config_paths": { scope: "repository", trust: "security", what: "hooksPath/attributesFile/excludesFile/fsmonitor targets named by the repository config" },
  "repo.config_integration": { scope: "repository", trust: "integration", what: "editor integration cache keys in the repository config (vscode-merge-base, github-pr-base-branch)" },
  "repo.hooks": { scope: "repository", trust: "security", what: "Git hooks" },
  "repo.info": { scope: "repository", trust: "security", what: ".git/info (exclude, attributes, sparse-checkout, grafts)" },
  "repo.info_server": { scope: "repository", trust: "housekeeping", what: ".git/info/refs (rewritten by update-server-info during repack/gc; never read by add/commit)" },
  "repo.replace_refs": { scope: "repository", trust: "security", what: "replace refs (loose and packed)" },
  "repo.shallow": { scope: "repository", trust: "security", what: "shallow boundary" },
  "repo.alternates": { scope: "repository", trust: "security", what: "object alternates" },
  "repo.index_flags": { scope: "repository", trust: "security", what: "assume-unchanged/skip-worktree index flags" },
  "env.global_config": { scope: "environment", trust: "security", what: "global Git config" },
  "env.global_attributes_ignore": { scope: "environment", trust: "security", what: "global Git attributes/ignore" },
  "env.system_config": { scope: "environment", trust: "security", what: "system Git config" },
  "env.config_include": { scope: "environment", trust: "security", what: "config files included by the global/system config" },
  "env.config_paths": { scope: "environment", trust: "security", what: "hooksPath/attributesFile/excludesFile/fsmonitor targets named by the global/system config" },
  opaque: { scope: "repository", trust: "security", what: "Git metadata (the inspector exposes only a digest; component unknown)" },
};

export interface GitMetadataComponentSnapshot {
  id: GitMetadataComponentId;
  digest: string;
  /** Entry label -> fingerprint ("file:<x|->:<sha256>", "link:<target>", "dir", "absent", ...). Never file content. */
  entries: Readonly<Record<string, string>>;
  /** Config key name -> short hash of its value(s). Only key names ever leave the process; values never do. */
  keys: Readonly<Record<string, string>>;
}

export interface GitMetadataSnapshot {
  /** Integrity digest over the security components: what workspace preparation and trusted commits bind to. */
  digest: string;
  components: readonly GitMetadataComponentSnapshot[];
}

type Origin = "repo" | "env";
interface Collector {
  entries: Map<string, { component: GitMetadataComponentId; value: string }>;
  keys: Map<GitMetadataComponentId, Map<string, string[]>>;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const byLabel = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

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

function add(c: Collector, component: GitMetadataComponentId, label: string, value: string) {
  if (c.entries.size >= MAX_METADATA_ENTRIES) throw new Error("git metadata is too large to verify");
  c.entries.set(label, { component, value });
}

function addKeys(c: Collector, component: GitMetadataComponentId, keys: Map<string, string[]>) {
  const into = c.keys.get(component) ?? new Map<string, string[]>();
  for (const [k, v] of Array.from(keys)) into.set(k, [...(into.get(k) ?? []), ...v]);
  c.keys.set(component, into);
}

async function addFile(c: Collector, component: GitMetadataComponentId, label: string, path: string): Promise<Buffer | null> {
  const d = await describeFile(path);
  add(c, component, label, d.value);
  return d.bytes;
}

/** `route` lets one child of a tree belong to another component (e.g. info/refs is housekeeping). */
async function addTree(c: Collector, component: GitMetadataComponentId, label: string, path: string, route?: (label: string) => GitMetadataComponentId | null): Promise<void> {
  const own = route?.(label) ?? component;
  const d = await describeFile(path);
  if (d.value !== "dir") {
    add(c, own, label, d.value);
    return;
  }
  add(c, own, label, "dir");
  const names = (await readdir(path)).sort();
  for (const name of names) await addTree(c, own, `${label}/${name}`, join(path, name), route);
}

/**
 * Key names (and value hashes) of a Git config file, for explaining a change. Never used for the
 * integrity digest (that stays byte-exact). Lines it cannot parse are reported as `<section>.(unparsed)`.
 */
export function configKeys(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const put = (key: string, value: string) => out.set(key, [...(out.get(key) ?? []), value]);
  const lines = text.split("\n");
  let section = "(none)";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.endsWith("\\") && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
    let t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(";")) continue;
    const header = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(t);
    if (header) {
      section = header[2] !== undefined ? `${header[1].toLowerCase()}.${header[2]}` : header[1].toLowerCase();
      t = header[3].trim();
      if (!t || t.startsWith("#") || t.startsWith(";")) continue;
    } else if (t.startsWith("[")) {
      section = "(unparsed)";
      put(`${section}.(unparsed)`, t);
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(t);
    if (kv) put(`${section}.${kv[1].toLowerCase()}`, kv[2] ?? "");
    else put(`${section}.(unparsed)`, t);
  }
  return out;
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
  return splitRepoConfig(bytes).normalized;
}

/**
 * normalizeRepoConfig plus the editor-integration cache entries it removed (`branch.<name>.<key>`
 * and the exact line), so the integration component is recorded and classified explicitly.
 */
export function splitRepoConfig(bytes: Buffer): { normalized: Buffer; integration: { key: string; line: string }[] } {
  const lines = bytes.toString("latin1").split("\n");
  const integration: { key: string; line: string }[] = [];
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
      integration.push({ key: `branch.${lines[header].slice(9, -2)}.${line.slice(1, line.indexOf(" "))}`, line });
    } else sectionOnlyBenign = false;
  }
  closeSection();
  if (drop.size === 0) return { normalized: bytes, integration };
  return { normalized: Buffer.from(lines.filter((_, i) => !drop.has(i)).join("\n"), "latin1"), integration };
}

async function addConfig(
  c: Collector,
  component: GitMetadataComponentId,
  origin: Origin,
  label: string,
  path: string,
  ctx: { repoRoot: string; home: string; seen: Set<string> },
  depth = 0,
  splitIntegration = false,
): Promise<void> {
  const abs = resolve(path);
  if (ctx.seen.has(abs)) return;
  ctx.seen.add(abs);
  const d = await describeFile(abs);
  const bytes = d.bytes;
  if (bytes && splitIntegration) {
    // d.value is "file:<x|->:<sha256>"; the repository config swaps in the hash of its normalized bytes.
    const split = splitRepoConfig(bytes);
    add(c, component, label, d.value.slice(0, -64) + sha256(split.normalized));
    addKeys(c, component, configKeys(split.normalized.toString("utf8")));
    const seenKeys = new Map<string, number>();
    for (const e of split.integration) {
      const n = (seenKeys.get(e.key) ?? 0) + 1;
      seenKeys.set(e.key, n);
      add(c, "repo.config_integration", `${label}:${e.key}${n > 1 ? `#${n}` : ""}`, sha256(e.line));
    }
    for (const e of split.integration) addKeys(c, "repo.config_integration", new Map([[e.key, [e.line]]]));
  } else {
    add(c, component, label, d.value);
    if (bytes) addKeys(c, component, configKeys(bytes.toString("utf8")));
  }
  if (!bytes || depth >= MAX_INCLUDE_DEPTH) return;
  for (const ref of referencedPaths(bytes.toString("utf8"))) {
    if (ref.key === "fsmonitor" && !/[\\/]/.test(ref.value)) continue; // boolean value; the config bytes already cover it
    const expanded = expandHome(ref.value, ctx.home);
    const base = ref.key === "hookspath" ? ctx.repoRoot : dirname(abs);
    const target = isAbsolute(expanded) ? expanded : resolve(base, expanded);
    if (ref.key === "path") await addConfig(c, origin === "repo" ? "repo.config_include" : "env.config_include", origin, `include:${target}`, target, ctx, depth + 1);
    else await addTree(c, origin === "repo" ? "repo.config_paths" : "env.config_paths", `${ref.key}:${target}`, target);
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

const FILE_COMPONENTS: Record<string, GitMetadataComponentId> = {
  HEAD: "repo.head",
  commondir: "repo.commondir",
  shallow: "repo.shallow",
  "objects/info/alternates": "repo.alternates",
  "objects/info/http-alternates": "repo.alternates",
};
const TREE_COMPONENTS: Record<string, GitMetadataComponentId> = { info: "repo.info", hooks: "repo.hooks", "refs/replace": "repo.replace_refs" };

/** Digest of one component: its entry fingerprints and config key hashes. */
export function gitMetadataComponentDigest(entries: Readonly<Record<string, string>>, keys: Readonly<Record<string, string>> = {}): string {
  return sha256(JSON.stringify([Object.entries(entries).sort(byLabel), Object.entries(keys).sort(byLabel)]));
}

/** A snapshot from an inspector that only exposes an integrity digest: one unidentifiable component. */
export function opaqueGitMetadataSnapshot(digest: string): GitMetadataSnapshot {
  return { digest, components: [{ id: "opaque", digest, entries: {}, keys: {} }] };
}

/**
 * Component-level snapshot of every piece of Git metadata that could alter the trusted commit, plus
 * the integration/housekeeping components that cannot. Any read error other than "missing" fails
 * closed (throws).
 */
export async function gitMetadataSnapshot(repoRoot: string, env: GitMetadataEnv = process.env): Promise<GitMetadataSnapshot> {
  const c: Collector = { entries: new Map(), keys: new Map() };
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const ctx = { repoRoot: resolve(repoRoot), home, seen: new Set<string>() };
  const { gitDir, commonDir } = await resolveGitDirs(repoRoot);
  const dirs = gitDir === commonDir ? [["git", gitDir]] : [["git", gitDir], ["common", commonDir]];

  for (const [tag, dir] of dirs) {
    await addConfig(c, "repo.config", "repo", `${tag}:config`, join(dir, "config"), ctx, 0, true);
    await addConfig(c, "repo.config_worktree", "repo", `${tag}:config.worktree`, join(dir, "config.worktree"), ctx);
    for (const [name, component] of Object.entries(FILE_COMPONENTS)) await addFile(c, component, `${tag}:${name}`, join(dir, ...name.split("/")));
    // info/refs is update-server-info output (rewritten by every repack/gc, e.g. the background
    // `gc --auto` after a trusted fetch); Git never reads it for add/commit: housekeeping.
    const route = (label: string) => (label === `${tag}:info/refs` ? "repo.info_server" : null);
    for (const [name, component] of Object.entries(TREE_COMPONENTS)) await addTree(c, component, `${tag}:${name}`, join(dir, ...name.split("/")), route);
    // Only replace refs from packed-refs: branch/remote refs legitimately move under trusted Git.
    const packed = await describeFile(join(dir, "packed-refs"));
    const replaceLines = packed.bytes
      ? packed.bytes.toString("utf8").split(/\r?\n/).filter((line) => line.includes(" refs/replace/")).join("\n")
      : packed.value;
    add(c, "repo.replace_refs", `${tag}:packed-refs(replace)`, sha256(replaceLines));
  }

  const xdg = env.XDG_CONFIG_HOME ?? join(home, ".config");
  const globals = env.GIT_CONFIG_GLOBAL ? [env.GIT_CONFIG_GLOBAL] : [join(home, ".gitconfig"), join(xdg, "git", "config")];
  for (const path of globals) await addConfig(c, "env.global_config", "env", `global:${path}`, path, ctx);
  for (const name of ["attributes", "ignore"]) await addFile(c, "env.global_attributes_ignore", `global:${join(xdg, "git", name)}`, join(xdg, "git", name));
  const system = env.GIT_CONFIG_SYSTEM ?? (env.PROGRAMDATA ? join(env.PROGRAMDATA, "Git", "config") : "/etc/gitconfig");
  await addConfig(c, "env.system_config", "env", `system:${system}`, system, ctx);

  // Integrity digest: exactly the security entries, in the same canonical form as always.
  const all = Array.from(c.entries.entries()).sort(byLabel);
  const security = all.filter(([, e]) => GIT_METADATA_COMPONENTS[e.component].trust === "security").map(([label, e]) => [label, e.value]);
  const components: GitMetadataComponentSnapshot[] = [];
  for (const id of GIT_METADATA_COMPONENT_IDS) {
    const entries = Object.fromEntries(all.filter(([, e]) => e.component === id).map(([label, e]) => [label, e.value]));
    const keys = Object.fromEntries(Array.from(c.keys.get(id) ?? []).map(([k, v]) => [k, sha256(v.join("\n")).slice(0, 16)]));
    if (Object.keys(entries).length === 0 && Object.keys(keys).length === 0) continue;
    components.push({ id, digest: gitMetadataComponentDigest(entries, keys), entries, keys });
  }
  return { digest: sha256(JSON.stringify(security)), components };
}

/**
 * Deterministic SHA-256 over every piece of Git metadata that could alter the
 * trusted commit (the security components of gitMetadataSnapshot).
 */
export async function gitMetadataDigest(repoRoot: string, env: GitMetadataEnv = process.env): Promise<string> {
  return (await gitMetadataSnapshot(repoRoot, env)).digest;
}
