import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards that the GitHub QA layer is read-only and has no I/O, env, process,
// network, timer, DB, or nondeterministic surface. Real transports are out of scope.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const FORBIDDEN = [
  /\bfrom\s+["'](?!\.\/|\.\.\/domain\/)[^"']+["']/, // only github/ and domain/ imports
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\./,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\b(setTimeout|setInterval|setImmediate)\s*\(/,
  /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\brandomUUID\b/,
  /\bconsole\./,
  /\b(drizzle|mysql|railway|octokit|child_process|codespaces?)\b/i,
  /\b(POST|PUT|PATCH|DELETE)\b/, // HTTP write verbs
  /\bmethod\s*:/,
  // GitHub write operations by name (merge, comment, review, rerun, dispatch, ...)
  /\b(merge|update|delete|close|reopen|rerun|dispatch|approve|dismiss|comment|push|write)[A-Z]\w*\s*[(:]/,
  /\b(create)(PullRequest|Review|Comment|Ref|Branch|Commit|CheckRun|Status|Issue)\b/,
];

describe("github QA purity / read-only", () => {
  it("covers the github modules", () => {
    expect(sources.sort()).toEqual(["client.ts", "fake.ts", "intent.ts", "qa.ts", "types.ts"]);
  });

  it.each(sources)("%s has no write API, I/O, env, network, DB, or nondeterminism", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
  });

  it("qa.ts and types.ts import nothing but local types", () => {
    for (const file of ["qa.ts", "types.ts"]) {
      const imports = readFileSync(join(dir, file), "utf8").match(/from\s+["'][^"']+["']/g) ?? [];
      expect(imports.every((i) => i.includes('"./types"')), file).toBe(true);
    }
  });
});
