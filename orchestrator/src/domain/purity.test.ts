import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards that the policy core has no I/O or production side-effect surface.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN = [
  /\bfrom\s+["'](?!\.\/)[^"']+["']/, // only relative imports within domain/
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\./,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\b(setTimeout|setInterval)\s*\(/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b/,
  /\bconsole\./,
];

describe("policy core purity", () => {
  it("covers the four domain modules", () => {
    expect(sources.sort()).toEqual(["risk.ts", "routing.ts", "taskState.ts", "types.ts"]);
  });

  it.each(sources)("%s has no I/O, env, network, or nondeterminism", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
  });
});
