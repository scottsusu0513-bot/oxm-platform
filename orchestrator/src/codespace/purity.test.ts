import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const files = readdirSync(dir).filter(
  f => f.endsWith(".ts") && !f.endsWith(".test.ts")
);
const source = (f: string) =>
  readFileSync(join(dir, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Codespace lifecycle boundaries", () => {
  it("contains only the explicit lifecycle surface", () => {
    expect(files.sort()).toEqual([
      "audit.ts",
      "client.ts",
      "controller.ts",
      "fake.ts",
      "index.ts",
      "lease.ts",
      "policy.ts",
      "state.ts",
      "types.ts",
    ]);
  });

  it("has no source/filesystem inspection, shell, Git, worker, LLM, merge, deploy, or timers", () => {
    for (const f of files) {
      const code = source(f);
      expect(code, f).not.toMatch(
        /node:(fs|path|child_process)|\b(readFile|readdir|spawn|exec|execFile|shell\s*:|setTimeout|setInterval|sleep)\b/
      );
      expect(code, f).not.toMatch(
        /\bgit\s|WorkerAdapter|\.worker\.start|anthropic|openai|octokit|mergePullRequest|deploy\w*\s*\(/i
      );
      expect(code, f).not.toMatch(
        /\b(fetch|XMLHttpRequest|WebSocket)\s*\(|DATABASE_URL|drizzle|mysql/
      );
    }
  });

  it("the client capability cannot create/delete, change machine/repo/secrets, push, or merge", async () => {
    const types = source("types.ts");
    const client = types.slice(
      types.indexOf("export interface CodespaceClient"),
      types.indexOf("export interface LifecycleStateRepository")
    );
    expect(client).toContain("getStatus()");
    expect(client).toContain("start(");
    expect(client).toContain("stop(");
    expect(client).not.toMatch(
      /delete|create|machine|secret|push|merge|repository\s*\(/i
    );
  });

  it("pure policy accepts caller timestamps and owns no clock", () => {
    const policy = source("policy.ts");
    expect(policy).not.toMatch(/Date\.now|new Date|setTimeout|setInterval/);
    expect(policy).toContain("now: string");
  });
});
