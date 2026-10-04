import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards that the branch planner is pure: deterministic, no I/O, no GitHub/git access.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN = [
  /\bfrom\s+["'](?!\.\/|\.\.\/domain\/|\.\.\/github\/types"|\.\.\/store\/(sanitize|types)")[^"']+["']/,
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\./,
  /\bfetch\s*\(/,
  /\b(setTimeout|setInterval|setImmediate)\s*\(/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\brandomUUID\b/,
  /\bconsole\./,
  // "drizzle/..." appears as data in the high-conflict path list; DB imports are blocked by the import rule above.
  /\b(mysql|railway|octokit|child_process|codespaces?|codex)\b/i,
];

describe("branch planner purity", () => {
  it("covers the branch modules", () => {
    expect(sources.sort()).toEqual(["intent.ts", "naming.ts", "overlap.ts", "planner.ts", "types.ts"]);
  });

  it.each(sources)("%s has no I/O, env, network, DB, or nondeterminism", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
  });
});
