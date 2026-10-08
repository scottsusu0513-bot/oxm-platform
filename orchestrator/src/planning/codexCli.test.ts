import { describe, expect, it } from "vitest";
import { fixedPlanningWorkspace, type PlanningProcessPort, type PlanningProcessResult, type PlanningProcessSpec } from "./claudeCli";
import {
  buildCodexManagerArgs,
  CodexManagerError,
  codexManagerChildEnv,
  createCodexManagerBackend,
  MANAGER_DISABLED_FEATURES,
  OUTPUT_FILE,
  preflightCodexManager,
  SCHEMA_FILE,
} from "./codexCli";
import { createStructuredGoalReviewer, createStructuredIntentPlanner, INTENT_SCHEMA } from "./planners";
import { buildCodexArgs } from "../workers/prompt";

const WS = fixedPlanningWorkspace("/tmp/oxm-manager-test");
const ENV = { PATH: "/usr/bin", HOME: "/home/owner", OPENAI_API_KEY: "sk-live-not-forwarded", CODEX_API_KEY: "ck-not-forwarded", ANTHROPIC_API_KEY: "sk-ant-x", DATABASE_URL: "mysql://secret" };

function fakePort(results: PlanningProcessResult[]): PlanningProcessPort & { specs: PlanningProcessSpec[] } {
  const specs: PlanningProcessSpec[] = [];
  return {
    specs,
    async run(spec) {
      specs.push(spec);
      return results[Math.min(specs.length - 1, results.length - 1)];
    },
  };
}
const exited = (over: Partial<Extract<PlanningProcessResult, { kind: "exited" }>> = {}): PlanningProcessResult => ({ kind: "exited", exitCode: 0, signal: null, stdout: "", stderr: "", truncated: false, ...over });

describe("GPT Manager profile (Codex CLI) — separate from and narrower than the Codex Worker", () => {
  it("is non-interactive, read-only, tool-less, structured-output, with no persisted session or user config", () => {
    const args = buildCodexManagerArgs({ model: null });
    expect(args[0]).toBe("exec");
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]) expect(args).toContain(flag);
    expect(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2)).toEqual(["--sandbox", "read-only"]);
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('web_search="disabled"');
    for (const f of MANAGER_DISABLED_FEATURES) expect(args.join(" ")).toContain(`--disable ${f}`);
    expect(args.slice(args.indexOf("--output-schema"), args.indexOf("--output-schema") + 2)).toEqual(["--output-schema", SCHEMA_FILE]);
    expect(args.slice(args.indexOf("-o"), args.indexOf("-o") + 2)).toEqual(["-o", OUTPUT_FILE]);
    expect(args.at(-1)).toBe("-");
    expect(args.join(" ")).not.toMatch(/dangerously|workspace-write|danger-full-access|--add-dir|bypass/);
    // The Worker profile is a different (writable) permission profile; the Manager never shares it.
    const worker = buildCodexArgs(undefined, "/repo");
    expect(worker.join(" ")).toContain('default_permissions="worker"');
    expect(args.join(" ")).not.toContain('default_permissions="worker"');
    expect(() => buildCodexManagerArgs({ model: "--dangerously-bypass-approvals-and-sandbox" })).toThrow(CodexManagerError);
  });

  it("never forwards API keys or other secrets: the owner's ChatGPT session is used, no API billing", () => {
    const env = codexManagerChildEnv(ENV);
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/owner" });
    for (const k of ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"]) expect(env).not.toHaveProperty(k);
  });
});

describe("preflight", () => {
  it.each([
    ["Logged in using ChatGPT", 0, null],
    ["Logged in using an API key - sk-***", 0, "non_subscription_auth"],
    ["Not logged in", 1, "not_authenticated"],
  ])("%s -> %s", async (stdout, exitCode, kind) => {
    const port = fakePort([exited({ stdout, exitCode })]);
    const r = await preflightCodexManager({ process: port, workspace: WS, env: ENV, command: "codex" });
    if (kind === null) expect(r).toEqual({ ok: true });
    else expect(r).toMatchObject({ ok: false, error: { kind } });
    expect(port.specs[0].args).toEqual(["login", "status"]);
    expect(port.specs[0].env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("a missing executable is typed", async () => {
    const r = await preflightCodexManager({ process: fakePort([{ kind: "launch_failed", missing: true }]), workspace: WS, env: ENV, command: "codex" });
    expect(r).toMatchObject({ ok: false, error: { kind: "executable_unavailable" } });
  });
});

describe("structured Manager calls", () => {
  const backend = (results: PlanningProcessResult[]) => {
    const port = fakePort(results);
    return { port, b: createCodexManagerBackend({ process: port, workspace: WS, env: ENV, timeoutMs: 60_000, now: () => "2026-10-07T00:00:00.000Z" }) };
  };

  it("writes the schema file, sends the prompt on stdin only, and parses the last-message file", async () => {
    const { port, b } = backend([exited({ fileOutput: JSON.stringify({ intent: "status_query" }) })]);
    const planner = createStructuredIntentPlanner(b);
    const out = await planner.interpret({ message: "做到哪了？", contextTaskId: null, tasks: [], requireTask: false });
    expect(out).toEqual({ intent: "status_query" });
    const spec = port.specs[0];
    expect(JSON.parse(spec.files![SCHEMA_FILE])).toEqual(INTENT_SCHEMA);
    expect(spec.readBack).toBe(OUTPUT_FILE);
    expect(spec.stdin).toContain("strictly read-only, tool-less profile");
    expect(spec.stdin).toContain("OWNER MESSAGE:\n<<<\n做到哪了？\n>>>");
    expect(spec.args.join(" ")).not.toContain("做到哪了");
    expect(spec.timeoutMs).toBe(60_000);
  });

  it("the intent schema is strict (every property required) and carries the work-area fields", () => {
    expect([...INTENT_SCHEMA.required].sort()).toEqual(Object.keys(INTENT_SCHEMA.properties).sort());
    expect(INTENT_SCHEMA.properties.workAreas.required).toEqual(["programming", "visual"]);
  });

  it("the reviewer receives Manager-gathered source evidence and the evidence requirements", async () => {
    const { port, b } = backend([exited({ fileOutput: JSON.stringify({ criteria: [] }) })]);
    await createStructuredGoalReviewer(b).review({
      mode: "read_only",
      intent: "investigate_or_answer",
      title: "placeholder",
      originalRequest: "首頁搜尋框的 placeholder 是什麼",
      interpretedObjective: "find it",
      criteria: [{ id: "AC-1", text: "exact text" }],
      validations: [{ name: "typecheck", status: "passed" }],
      diff: "",
      diffTruncated: false,
      answer: "搜尋工廠",
      citedFiles: [],
      sourceEvidence: [{ path: "client/src/pages/Home.tsx", excerpt: '6: placeholder="搜尋工廠"' }],
      evidenceRequirements: ["Quote the exact literal value"],
    });
    const stdin = port.specs[0].stdin!;
    expect(stdin).toContain("MANAGER-GATHERED SOURCE EVIDENCE (trusted):\n--- client/src/pages/Home.tsx\n6: placeholder=\"搜尋工廠\"");
    expect(stdin).toContain("EVIDENCE THE MANAGER REQUIRES:\n- Quote the exact literal value");
    expect(stdin).toContain("Typecheck/test results are never evidence");
  });

  it.each([
    ["malformed output", exited({ fileOutput: "not json" }), "malformed_output"],
    ["empty output", exited({ fileOutput: "" }), "malformed_output"],
    ["array output", exited({ fileOutput: "[1]" }), "malformed_output"],
    ["oversized output", exited({ truncated: true }), "output_too_large"],
    ["timeout", { kind: "timeout" } as PlanningProcessResult, "timeout"],
    ["quota", exited({ exitCode: 1, stderr: "ERROR: You've hit your usage limit. Try again later." }), "quota_exhausted"],
    ["rate limit", exited({ exitCode: 1, stderr: "429 Too Many Requests" }), "rate_limited"],
    ["auth", exited({ exitCode: 1, stderr: "Not logged in. Please run codex login" }), "not_authenticated"],
    ["crash", exited({ exitCode: 2, stderr: "boom" }), "process_error"],
  ])("fails closed with a typed error: %s", async (_label, result, kind) => {
    const { b } = backend([result]);
    const err = await b.structured({ system: "s", user: "u", schema: {}, maxTokens: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(CodexManagerError);
    expect(err.kind).toBe(kind);
    // Errors never carry process output.
    expect(String(err.message)).not.toMatch(/usage limit|boom|Too Many|not json/);
  });

  it("a quota error keeps a trusted reset time when the CLI exposed one", async () => {
    const { b } = backend([exited({ exitCode: 1, stderr: '{"error":"usage_limit_reached","resets_in_seconds":1800}' })]);
    const err = (await b.structured({ system: "s", user: "u", schema: {}, maxTokens: 10 }).catch((e) => e)) as CodexManagerError;
    expect(err).toMatchObject({ kind: "quota_exhausted", resetAt: "2026-10-07T00:30:00.000Z" });
  });
});
