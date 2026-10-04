import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the worker layer's boundaries: process/fs/timer access is confined
// to the infrastructure modules, nothing uses a shell, and there is no push,
// merge, deploy, production DB, GitHub write, Codex, or cloud-workspace path.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(join(dir, f), "utf8");
/** Source without comments and string literals (policy text like the forbidden-ops list is data). */
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

const INFRA = new Set(["processRunner.ts", "promptFile.ts", "gitInspector.ts", "workerAdapter.ts"]);

describe("worker layer boundaries", () => {
  it("covers the worker modules", () => {
    expect(sources.sort()).toEqual([
      "claudeCode.ts",
      "fake.ts",
      "gitInspector.ts",
      "killSwitch.ts",
      "lifecycle.ts",
      "processRunner.ts",
      "prompt.ts",
      "promptFile.ts",
      "resultParser.ts",
      "types.ts",
      "workerAdapter.ts",
    ]);
  });

  it("only processRunner.ts touches child_process, and never with a shell", () => {
    for (const f of sources) {
      const src = read(f);
      if (f !== "processRunner.ts") expect(src, f).not.toMatch(/child_process/);
      expect(src, f).not.toMatch(/shell\s*:\s*true/);
      expect(src, f).not.toMatch(/(?<![.\w])(exec|execSync|execFileSync|spawnSync)\s*\(/); // RegExp#exec is fine
    }
    expect(read("processRunner.ts")).toMatch(/shell:\s*false/);
  });

  it("non-infrastructure modules have no fs/os/process/timer/network/console access", () => {
    for (const f of sources.filter((s) => !INFRA.has(s))) {
      const src = code(f);
      expect(read(f), f).not.toMatch(/["']node:(fs|fs\/promises|os|child_process|net|http|https)["']/);
      expect(src, f).not.toMatch(/\bprocess\.|\bfetch\s*\(|\bconsole\.|\b(setTimeout|setInterval)\s*\(|\bDate\.now\b|\bMath\.random\b/);
    }
  });

  it("no module logs anything (prompts/outputs are never logged)", () => {
    for (const f of sources) expect(code(f), f).not.toMatch(/\bconsole\./);
  });

  it("has no push/merge/deploy/main-write, production DB, GitHub write, Codex, or cloud-workspace path", () => {
    for (const f of sources) {
      const src = code(f);
      // Array#push is fine; any free-standing push/merge/deploy function or a git push/merge argv is not.
      expect(src, f).not.toMatch(/(?<![.\w])(push|merge|deploy|forcePush)[A-Za-z]*\s*\(|\b(merge|deploy)[A-Z]\w*\s*\(/);
      expect(read(f), f).not.toMatch(/["'](push|merge)["']\s*[,\]]/);
      expect(src, f).not.toMatch(/\b(drizzle|mysql|octokit|railway|codespaces?|DATABASE_URL)\b/i);
      expect(src, f).not.toMatch(/\bcodex\b/i);
    }
    // git is only ever invoked with read-only subcommands; the worker command is fixed.
    expect(read("gitInspector.ts")).toMatch(/READ_ONLY_GIT_SUBCOMMANDS = \["rev-parse", "status", "diff"\] as const/);
    expect(read("claudeCode.ts")).toMatch(/DEFAULT_CLAUDE_COMMAND = "claude"/);
    expect(read("claudeCode.ts")).not.toMatch(/--dangerously-skip-permissions/);
  });
});
