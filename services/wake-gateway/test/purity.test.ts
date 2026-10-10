import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf8") }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("24. Wake Gateway boundaries", () => {
  it("imports only its own modules: no Node, shell, Git, orchestrator, Manager or Worker code", () => {
    for (const f of files)
      for (const [, spec] of f.text.matchAll(/from\s+"([^"]+)"/g)) expect(spec, f.name).toMatch(/^\.\/[a-zA-Z]+$/);
    for (const f of files) {
      const c = code(f.text);
      expect(c, f.name).not.toMatch(/child_process|node:|\bspawn\(|execSync|\beval\(|new Function|process\.env|require\(/);
      expect(c, f.name).not.toMatch(/openai|anthropic|claude|codex|\bgit\s|commit|merge|deploy/i);
    }
  });

  it("talks only to the Telegram Bot API (sendMessage) and the GitHub Codespaces status/start endpoints", () => {
    const urls = files.flatMap((f) => Array.from(code(f.text).matchAll(/https?:\/\/[^\s"'`$]+/g), (m) => m[0]));
    expect(new Set(urls)).toEqual(new Set(["https://api.telegram.org/bot", "https://api.github.com", "https://owner-queue/enqueue", "https://owner-queue/pull", "https://owner-queue/heartbeat"]));
    const all = files.map((f) => code(f.text)).join("\n");
    expect(all).not.toMatch(/getUpdates|setWebhook|deleteWebhook|answerCallbackQuery|editMessage/);
    const github = code(files.find((f) => f.name === "github.ts")!.text);
    expect(github).not.toMatch(/"(DELETE|PATCH|PUT)"|\/stop|\/exports|\/publish|\/repos\/|\/machines/);
    expect(Array.from(github.matchAll(/call\("(GET|POST)", "([^"]*)"\)/g), (m) => `${m[1]} ${m[2]}`)).toEqual(["GET ", "POST /start"]);
  });

  it("wrangler.toml carries no credential", () => {
    const toml = readFileSync(join(SRC, "../wrangler.toml"), "utf8");
    const assignments = toml.split("\n").filter((l) => /^\s*[A-Z_]+\s*=/.test(l));
    expect(assignments.map((l) => l.split("=")[0].trim()).sort()).toEqual(["CODESPACE_NAME", "EXPECTED_REPO"]);
    expect(toml).not.toMatch(/github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|[0-9]{6,}:[A-Za-z0-9_-]{30,}/);
  });
});
