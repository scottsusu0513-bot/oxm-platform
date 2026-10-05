import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("intake/runtime purity boundary", () => {
  it("contains no repository, shell, worker, GitHub-write, merge, deploy, or production DB capabilities", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir)
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/from ["']node:(?:fs|child_process)["']/);
    expect(sources).not.toMatch(
      /\b(exec|execFile|spawn|readFile|readdir|glob|git show|cat-file|grep)\s*\(/
    );
    expect(sources).not.toMatch(
      /(?:new\s+|from\s+["'][^"']*)(?:ClaudeCode|CodexWorker|WorkerAdapter)/
    );
    expect(sources).not.toMatch(
      /createPullRequest|mergePullRequest|deployProduction|productionDatabase/
    );
    expect(sources).not.toMatch(/checkout\s+main|push\s+.*main/);
  });
});
