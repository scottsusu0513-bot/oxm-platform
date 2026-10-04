import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the GitHub write layer's boundaries: only the narrow allowed writes,
// no forbidden operation by name or argv, processes only via the injected runner.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("github write layer boundaries", () => {
  it("covers the write modules", () => {
    expect(sources.sort()).toEqual(["client.ts", "fake.ts", "flow.ts", "intent.ts", "lease.ts", "policy.ts", "transport.ts", "types.ts", "workspace.ts"]);
  });

  it("has no direct process/network/fs/env/timer access, no shell, no logging", () => {
    for (const f of sources) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']node:[^"']+["']|child_process/);
      expect(src, f).not.toMatch(/\bprocess\.|\bfetch\s*\(|\bconsole\.|\b(setTimeout|setInterval)\s*\(|\bDate\.now\b|\bMath\.random\b/);
      expect(src, f).not.toMatch(/shell\s*:\s*true/);
      expect(src, f).not.toMatch(/\b(drizzle|mysql|railway|octokit|codespaces?|codex)\b/i);
    }
  });

  it("exposes no merge/close/approve/delete/force/protection/admin operation", () => {
    for (const f of sources) {
      const src = code(f);
      // Any function/method named after a forbidden operation (definitions or free calls;
      // member calls on built-ins such as Map#delete are fine).
      expect(src, f).not.toMatch(/(?<![.\w])(merge|close|approve|dismiss|delete|remove|forcePush|force|protect|admin|bypass|rerun|dispatch)\w*\s*\(/i);
      expect(src, f).not.toMatch(/--force|force-with-lease|--mirror|--delete|["']\+/);
      expect(src, f).not.toMatch(/["'](DELETE|PUT)["']|\/merge\b|\/reviews\b|\/protection\b|\/collaborators\b|\/hooks\b/);
      expect(src, f).not.toMatch(/\bmerged:\s*true\b/);
    }
  });

  it("only transport.ts / workspace.ts spawn (via the injected runner), with fixed commands", () => {
    for (const f of sources) {
      if (f !== "transport.ts" && f !== "workspace.ts") expect(code(f), f).not.toMatch(/\.spawn\s*\(/);
    }
    // workspace.ts: git only, and only fetch / rev-parse / switch — never reset/merge/rebase/clean/checkout/push/force.
    const w = code("workspace.ts");
    expect(w.match(/command:\s*"[^"]+"/g)).toEqual(['command: "git"']);
    expect(w).toMatch(/WORKSPACE_GIT_SUBCOMMANDS = \["fetch", "rev-parse", "switch"\] as const/);
    expect(w).not.toMatch(/"(reset|merge|rebase|clean|checkout|push|pull|stash|restore|update-ref|branch)"|--hard|--force|--discard-changes|"-[fCB]"/);
    const t = code("transport.ts");
    expect(t.match(/command:\s*"[^"]+"/g)?.sort()).toEqual(['command: "gh"', 'command: "git"']);
    // Compare the captured HTTP method values only, so whitespace / indentation / LF vs CRLF cannot affect the result.
    const methods = [...t.matchAll(/"--method",\s*"([A-Z]+)"/g)].map((m) => m[1]).sort();
    expect(methods).toEqual(["PATCH", "POST", "POST"]);
  });
});
