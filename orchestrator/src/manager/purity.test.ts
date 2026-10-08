import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Hard boundary: the Manager validates evidence and never reads code. It may
// only import pure domain/policy/type modules; no filesystem, git content,
// worker execution/inspection, GitHub client/write, shell, network, or LLM.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The complete set of modules manager/ may import from outside itself. */
const ALLOWED_EXTERNAL = new Set([
  "../branches/naming",
  "../branches/overlap",
  "../branches/types",
  "../domain/risk",
  "../domain/taskState",
  "../domain/types",
  "../executive/communication",
  "../executive/evidencePlan",
  "../executive/guidance",
  "../github/types",
  "../store/sanitize",
  "../store/types",
  "../workers/types",
]);

describe("manager boundaries", () => {
  it("covers the manager modules", () => {
    expect(sources.sort()).toEqual(["budget.ts", "constraintCheck.ts", "diagnosis.ts", "evidence.ts", "fake.ts", "humanDecision.ts", "intent.ts", "lifecycle.ts", "managerPlan.ts", "repair.ts", "sequencing.ts", "types.ts", "validator.ts"]);
  });

  it("imports only pure policy/type modules (allowlist)", () => {
    for (const f of sources) {
      const specs = [...code(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const s of specs) {
        if (s.startsWith("./")) continue;
        expect(ALLOWED_EXTERNAL.has(s), `${f} imports ${s}`).toBe(true);
      }
      // Worker types are type-only: no runtime coupling to worker modules.
      expect(code(f), f).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']\.\.\/workers\/(?!types)/);
    }
  });

  it("has no fs / git-content / glob / shell / process / network / LLM access", () => {
    for (const f of sources) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']node:[^"']+["']|["'](fs|fs\/promises|path|child_process|os|net|http|https)["']/);
      expect(src, f).not.toMatch(/\b(readFile|readFileSync|readdir|readdirSync|createReadStream|existsSync|statSync|opendir)\b/);
      expect(src, f).not.toMatch(/\b(glob|globSync|ripgrep)\s*\(|\bgrep\b/);
      expect(src, f).not.toMatch(/\bgit\s+(show|cat-file|diff|log|blame|ls-files|grep)\b|["'](show|cat-file|ls-files|blame)["']/);
      expect(src, f).not.toMatch(/\b(spawn|exec|execFile|execSync|fork)\s*\(|\.spawn\s*\(|shell\s*:\s*true/);
      expect(src, f).not.toMatch(/\bprocess\.|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
      expect(src, f).not.toMatch(/\b(anthropic|openai|octokit)\b|@anthropic-ai|\bclaude\s+-p\b|\bcodex\s+exec\b/i);
      expect(src, f).not.toMatch(/\bconsole\.|\b(setTimeout|setInterval)\s*\(|\bDate\.now\b|\bnew Date\b|\bMath\.random\b/);
      expect(src, f).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    }
  });

  it("never starts workers, writes to GitHub, or touches git from the validator path", () => {
    for (const f of sources) {
      const src = code(f);
      expect(src, f).not.toMatch(/\.start\s*\(|WorkerAdapter|ProcessRunner|GitInspector|PromptFileStore/);
      expect(src, f).not.toMatch(/githubWrite|GitHubWriteClient|GitHubReadClient|pushTaskBranch|openPullRequest|createTaskBranch|\bmerge\w*\s*\(/);
      expect(src, f).not.toMatch(/prepareAssignedWorkspace|changedPathsSince|\.status\s*\(\s*\)/);
    }
  });
});
