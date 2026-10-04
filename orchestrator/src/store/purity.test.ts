import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards that the store has no I/O, env, network, process, or DB surface.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN = [
  /\bfrom\s+["'](?!\.\/|\.\.\/domain\/)[^"']+["']/, // only store/ and domain/ imports
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\./,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\b(setTimeout|setInterval)\s*\(/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\brandomUUID\b/,
  /\bconsole\./,
  /\b(drizzle|mysql|pg|railway|octokit|child_process)\b/i,
];

describe("store purity", () => {
  it("covers the store modules", () => {
    expect(sources.sort()).toEqual(["memory.ts", "repositories.ts", "sanitize.ts", "types.ts"]);
  });

  it.each(sources)("%s has no I/O, env, network, DB, or nondeterminism", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
  });
});
