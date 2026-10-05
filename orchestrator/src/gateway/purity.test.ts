import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("gateway core purity boundaries", () => {
  it("has no direct filesystem, shell, Git, Worker, Codespace, GitHub-write, DB, or LLM capability", () => {
    const root = join(process.cwd(), "orchestrator/src/gateway");
    const core = ["approval.ts", "auth.ts", "errors.ts", "service.ts", "transport.ts", "types.ts"]
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");
    for (const forbidden of [
      /node:fs|readFile|writeFile/,
      /from ["'](?:node:)?child_process["']/,
      /WorkerAdapter|\.worker\.start/,
      /CodespaceClient|\.startCodespace/,
      /GitHubWriteClient|openPullRequest|mergePullRequest/,
      /drizzle|mysql|postgres|DATABASE_URL/,
      /OpenAI|Anthropic|llm\.classify/,
    ]) expect(core).not.toMatch(forbidden);
    expect(readdirSync(root)).not.toContain("server.ts");
  });

  it("never logs authentication material or raw task content", () => {
    const root = join(process.cwd(), "orchestrator/src/gateway");
    const audit = readFileSync(join(root, "audit.ts"), "utf8");
    expect(audit).not.toMatch(/credentials|cookie|authorization|userInstruction|rawText|stdout|stderr/);
  });
});
