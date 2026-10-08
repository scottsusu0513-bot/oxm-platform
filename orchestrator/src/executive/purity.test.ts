import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Executive layer is presentation, policy and planning only: no I/O, no
// processes, no network, no Git, no model calls, no clocks or randomness.
const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const code = (f: string) =>
  readFileSync(join(dir, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ALLOWED = new Set(["../domain/types", "../manager/types", "../manager/diagnosis", "../store/sanitize"]);

describe("executive layer boundaries", () => {
  it("covers the executive modules", () => {
    expect(sources.sort()).toEqual(["availability.ts", "communication.ts", "evidencePlan.ts", "guidance.ts", "handoff.ts", "workAssignment.ts"]);
  });

  it("imports only pure policy/type modules", () => {
    for (const f of sources)
      for (const m of code(f).matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        if (m[1].startsWith("./")) continue;
        expect(ALLOWED.has(m[1]), `${f} imports ${m[1]}`).toBe(true);
      }
  });

  it("has no filesystem, process, network, Git-write, model, clock or randomness access", () => {
    for (const f of sources) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']node:[^"']+["']|["'](fs|child_process|os|net|http|https)["']/);
      // RegExp#exec is fine; process-spawning calls are not.
      expect(src, f).not.toMatch(/(?<!\.)\b(spawn|exec|execFile|execSync|fork)\s*\(|\bprocess\.|\bfetch\s*\(/);
      expect(src, f).not.toMatch(/\bDate\.now\s*\(|new Date\(\s*\)|Math\.random|setTimeout|setInterval/);
      expect(src, f).not.toMatch(/\bgit\s+(add|commit|push|merge|reset|checkout)\b/);
      expect(src, f).not.toMatch(/@anthropic-ai|\bopenai\b/i);
    }
  });
});
