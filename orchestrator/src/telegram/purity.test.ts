import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const files = (dir: string) =>
  readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(SRC, dir, f), "utf8") }));
const importsOf = (text: string) => Array.from(text.matchAll(/from\s+"([^"]+)"/g), (m) => m[1]);

describe("telegram control plane purity / boundaries", () => {
  it("Manager, scheduler, domain, gateway, workers and Git code have no Telegram or human-transport dependency", () => {
    for (const dir of ["manager", "scheduler", "domain", "gateway", "workers", "githubWrite", "github", "branches", "intake", "store", "persistence", "planning"]) {
      for (const f of files(dir)) {
        for (const spec of importsOf(f.text)) expect(spec, f.name).not.toMatch(/telegram|humanInteraction|agentRuntime/);
        expect(f.text, f.name).not.toMatch(/api\.telegram\.org|TELEGRAM_/);
      }
    }
  });

  it("the human-interaction port is transport-agnostic and only depends inward on the Gateway", () => {
    for (const f of files("humanInteraction").filter((f) => !f.name.endsWith("/fake.ts"))) {
      for (const spec of importsOf(f.text)) {
        expect(spec, f.name).not.toMatch(/telegram|agentRuntime|githubWrite|workers\/|scheduler\/|child_process|codespace/);
      }
    }
  });

  it("Telegram code never touches Git, Workers, shells, the Manager loop, or interactive input", () => {
    for (const f of files("telegram").filter((f) => !f.name.endsWith("/fake.ts"))) {
      for (const spec of importsOf(f.text))
        expect(spec, f.name).not.toMatch(/githubWrite|github\/|workers\/|scheduler\/|manager\/|gateway\/|intake\/|agentRuntime|child_process|readline|codespace|store\/memory/);
      expect(f.text, f.name).not.toMatch(/process\.stdin|readline|spawn\(|execSync|(?<!\.)\bexec\(|\bgit\s+(commit|push|merge)|pushTaskBranch|openPullRequest|commitValidated/);
      expect(f.text, f.name).not.toMatch(/console\.(log|error|warn)\([^)]*(botToken|token)/);
    }
  });

  it("no Telegram path can carry merge or deploy authority", () => {
    const format = readFileSync(join(SRC, "telegram/format.ts"), "utf8");
    expect(format).toMatch(/CALLBACK_ACTIONS = \{ a: "approve", r: "reject", c: "cancel_request", k: "cancel_confirm", n: "cancel_keep" \}/);
    const auth = readFileSync(join(SRC, "humanInteraction/auth.ts"), "utf8");
    const caps = /HUMAN_OWNER_CAPABILITIES[^=]*= Object\.freeze\(\[([\s\S]*?)\]\)/.exec(auth)![1];
    expect(caps).not.toMatch(/task:pause|merge|deploy/);
  });

  it("the planning layer cannot reach Git, Workers, shells or the Manager loop", () => {
    for (const f of files("planning")) {
      for (const spec of importsOf(f.text)) expect(spec, f.name).not.toMatch(/githubWrite|workers\/|child_process|codespace|telegram|humanInteraction|scheduler\/loop/);
      expect(f.text, f.name).not.toMatch(/\bspawn\(|execSync|tools:\s*\[/);
    }
  });
});
