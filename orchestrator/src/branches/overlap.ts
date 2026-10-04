/**
 * Deterministic path normalization and overlap detection for conflict
 * planning. Paths are repo-relative; a trailing "/" marks a directory prefix.
 * Absolute paths, traversal, backslashes, NUL, glob/meta characters and the
 * repository root are rejected. Overlap comparison is case-insensitive so a
 * case-only difference is still treated as a conflict (fail closed).
 */

export interface NormalizedPath {
  path: string;
  isDir: boolean;
}

export type PathResult = { ok: true; value: NormalizedPath } | { ok: false; reason: string };

const MAX_PATH = 400;

export function normalizeRepoPath(input: unknown): PathResult {
  if (typeof input !== "string") return { ok: false, reason: "path is not a string" };
  let p = input;
  if (p !== p.trim() || p === "") return { ok: false, reason: "empty or padded path" };
  if (p.length > MAX_PATH) return { ok: false, reason: "path too long" };
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\") || p.includes("\0")) {
    return { ok: false, reason: "absolute or unsafe path" };
  }
  if (/[*?[\]{}!\s]/.test(p)) return { ok: false, reason: "glob or whitespace in path" };
  while (p.startsWith("./")) p = p.slice(2);
  const isDir = p.endsWith("/");
  const body = isDir ? p.slice(0, -1) : p;
  if (body === "" || body === ".") return { ok: false, reason: "repository root is not a valid path" };
  if (body.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    return { ok: false, reason: "path traversal or empty segment" };
  }
  return { ok: true, value: { path: isDir ? `${body}/` : body, isDir } };
}

/** Normalizes every path; returns the sorted, deduplicated set or the first error. */
export function normalizePathSet(
  paths: readonly unknown[],
): { ok: true; paths: string[] } | { ok: false; reason: string } {
  const out = new Set<string>();
  for (const p of paths) {
    const r = normalizeRepoPath(p);
    if (!r.ok) return { ok: false, reason: `${r.reason}: ${JSON.stringify(String(p)).slice(0, 80)}` };
    out.add(r.value.path);
  }
  return { ok: true, paths: Array.from(out).sort() };
}

/** True when two normalized entries can touch the same file. */
export function pathsOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const xDir = x.endsWith("/");
  const yDir = y.endsWith("/");
  if (xDir && (y.startsWith(x) || `${y}/` === x)) return true;
  if (yDir && (x.startsWith(y) || `${x}/` === y)) return true;
  return false;
}

/** Sorted overlapping pairs (a from `left`, b from `right`). */
export function findOverlaps(left: readonly string[], right: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const a of left) for (const b of right) if (pathsOverlap(a, b)) pairs.push([a, b]);
  return pairs.sort((p, q) => (p[0] + "\0" + p[1] < q[0] + "\0" + q[1] ? -1 : 1));
}

/**
 * Shared files that frequently conflict. Two concurrent tasks that both touch
 * any of these (directly or via a directory entry covering them) are never
 * dispatched in parallel, even if their exact paths differ.
 */
export const DEFAULT_HIGH_CONFLICT_PATHS: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "patches/",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "drizzle.config.ts",
  "drizzle/schema.ts",
  "drizzle/meta/",
  "server/routers.ts",
  "server/db.ts",
  "server/_core/trpc.ts",
  "server/_core/context.ts",
  "shared/const.ts",
  "shared/constants.ts",
  "shared/types.ts",
  ".github/workflows/",
];

/** High-conflict entries touched by `paths` (sorted). */
export function highConflictHits(paths: readonly string[], highConflict: readonly string[]): string[] {
  return highConflict.filter((h) => paths.some((p) => pathsOverlap(p, h))).sort();
}
