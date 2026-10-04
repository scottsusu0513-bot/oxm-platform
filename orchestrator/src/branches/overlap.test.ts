import { describe, expect, it } from "vitest";
import { DEFAULT_HIGH_CONFLICT_PATHS, findOverlaps, highConflictHits, normalizePathSet, normalizeRepoPath, pathsOverlap } from "./overlap";

describe("path normalization", () => {
  it("accepts repo-relative files and directories", () => {
    expect(normalizeRepoPath("server/db.ts")).toEqual({ ok: true, value: { path: "server/db.ts", isDir: false } });
    expect(normalizeRepoPath("./client/src/")).toEqual({ ok: true, value: { path: "client/src/", isDir: true } });
  });

  it.each(["/etc/passwd", "C:/x", "a\\b", "../x", "a/../b", "a//b", "./", "/", "", " a", "a/*", "a/./b", "a\0b", "."])(
    "rejects unsafe path %j",
    (p) => expect(normalizeRepoPath(p).ok).toBe(false),
  );

  it("normalizes sets deterministically", () => {
    expect(normalizePathSet(["b.ts", "./a.ts", "b.ts"])).toEqual({ ok: true, paths: ["a.ts", "b.ts"] });
    expect(normalizePathSet(["a.ts", "../b"]).ok).toBe(false);
  });
});

describe("overlap", () => {
  it("exact file overlap (case-insensitive)", () => {
    expect(pathsOverlap("server/db.ts", "server/db.ts")).toBe(true);
    expect(pathsOverlap("server/DB.ts", "server/db.ts")).toBe(true);
    expect(pathsOverlap("server/db.ts", "server/db2.ts")).toBe(false);
  });

  it("directory/prefix overlap in both directions, without false prefix matches", () => {
    expect(pathsOverlap("server/", "server/db.ts")).toBe(true);
    expect(pathsOverlap("client/src/pages/Home.tsx", "client/")).toBe(true);
    expect(pathsOverlap("client/", "client/src/")).toBe(true);
    expect(pathsOverlap("server/", "server-extra/x.ts")).toBe(false);
    expect(pathsOverlap("serverx.ts", "server/")).toBe(false);
    expect(pathsOverlap("server", "server/")).toBe(true);
  });

  it("findOverlaps returns sorted pairs", () => {
    expect(findOverlaps(["b/", "a.ts"], ["b/x.ts", "a.ts", "c.ts"])).toEqual([
      ["a.ts", "a.ts"],
      ["b/", "b/x.ts"],
    ]);
  });

  it("high-conflict hits include files covered by directory entries", () => {
    expect(highConflictHits(["server/"], DEFAULT_HIGH_CONFLICT_PATHS)).toEqual([
      "server/_core/context.ts",
      "server/_core/trpc.ts",
      "server/db.ts",
      "server/routers.ts",
    ]);
    expect(highConflictHits(["package.json", "client/src/x.tsx"], DEFAULT_HIGH_CONFLICT_PATHS)).toEqual(["package.json"]);
    expect(highConflictHits(["client/src/x.tsx"], DEFAULT_HIGH_CONFLICT_PATHS)).toEqual([]);
  });
});
