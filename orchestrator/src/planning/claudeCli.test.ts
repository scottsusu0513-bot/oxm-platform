import { describe, expect, it } from "vitest";
import {
  buildPlanningCliArgs,
  ClaudeCliPlanningError,
  createClaudeCliPlanningBackend,
  fixedPlanningWorkspace,
  interpretPlanningRun,
  MAX_CLI_OUTPUT_BYTES,
  planningChildEnv,
  PREFLIGHT_ARGS,
  preflightClaudeCli,
  type PlanningProcessPort,
  type PlanningProcessResult,
  type PlanningProcessSpec,
  type PlanningWorkspace,
} from "./claudeCli";
import { normalizeGoalReview, normalizeIntentDecision } from "./normalize";
import { createStructuredGoalReviewer, createStructuredIntentPlanner, INTENT_SCHEMA } from "./planners";

const SECRET_ENV = {
  PATH: "/usr/bin",
  HOME: "/home/owner",
  ANTHROPIC_API_KEY: "sk-ant-api03-SECRETSECRETSECRET",
  ANTHROPIC_AUTH_TOKEN: "auth-token-secret",
  TELEGRAM_BOT_TOKEN: "123:telegram-secret",
  DATABASE_URL: "mysql://root:pw@db/oxm",
  GITHUB_TOKEN: "ghp_secretsecretsecret",
};

const envelope = (fields: Record<string, unknown>) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", ...fields });
const exited = (stdout: string, extra: Partial<Extract<PlanningProcessResult, { kind: "exited" }>> = {}): PlanningProcessResult => ({ kind: "exited", exitCode: 0, signal: null, stdout, stderr: "", truncated: false, ...extra });

function port(results: PlanningProcessResult[] | ((spec: PlanningProcessSpec) => PlanningProcessResult)): PlanningProcessPort & { specs: PlanningProcessSpec[] } {
  const specs: PlanningProcessSpec[] = [];
  return {
    specs,
    async run(spec) {
      specs.push(spec);
      return typeof results === "function" ? results(spec) : results[Math.min(specs.length - 1, results.length - 1)];
    },
  };
}

const PLAN = { intent: "change_code", taskId: null, title: "Loading", interpretedObjective: "Make the search waiting state responsive.", criteria: ["Visible feedback appears immediately"], clarificationQuestion: "", riskObservations: [] };
const plannerInput = { message: "幫我把搜尋 loading 做順一點", contextTaskId: null, tasks: [], requireTask: false };
const reviewInput = {
  mode: "change" as const,
  intent: "change_code" as const,
  title: "Loading",
  originalRequest: "make loading smoother",
  interpretedObjective: "Make the search waiting state responsive.",
  criteria: [{ id: "goal-1", text: "Visible feedback appears immediately" }],
  validations: [{ name: "tests", status: "passed" }],
  diff: "diff --git a/x b/x",
  diffTruncated: false,
  answer: null,
  citedFiles: [],
};

function backend(p: PlanningProcessPort) {
  return createClaudeCliPlanningBackend({ process: p, workspace: fixedPlanningWorkspace("/tmp/neutral"), env: SECRET_ENV, model: "claude-opus-5-5", timeoutMs: 50_000 });
}

describe("Claude CLI planning transport: structured output", () => {
  it("accepts a valid Planner structured object and it passes the existing intent validator", async () => {
    const p = port([exited(envelope({ structured_output: PLAN }))]);
    const raw = await createStructuredIntentPlanner(backend(p)).interpret(plannerInput);
    expect(raw).toEqual(PLAN);
    expect(normalizeIntentDecision(raw, { knownTaskIds: [], requireTask: false })).toMatchObject({ kind: "task", intent: "change_code", mode: "change" });
    // The owner message travels on stdin only, never in argv.
    expect(p.specs[0].stdin).toContain("幫我把搜尋 loading 做順一點");
    expect(p.specs[0].args.join("\u0000")).not.toContain("幫我把搜尋");
  });

  it("accepts a valid Reviewer structured object and it passes the existing review validator", async () => {
    const review = { criteria: [{ id: "goal-1", status: "satisfied", evidence: "diff hunk in x", reason: "" }] };
    const p = port([exited(envelope({ structured_output: review }))]);
    const raw = await createStructuredGoalReviewer(backend(p)).review(reviewInput);
    expect(normalizeGoalReview(raw, reviewInput.criteria)).toEqual([{ id: "goal-1", status: "satisfied", evidence: "diff hunk in x", reason: "" }]);
    expect(p.specs[0].stdin).toContain("TRUSTED GIT DIFF");
  });

  it("falls back to a result string that is exactly one JSON object", () => {
    expect(interpretPlanningRun(exited(envelope({ result: JSON.stringify(PLAN) })))).toEqual(PLAN);
  });

  it.each([
    ["non-JSON stdout", exited("Sure! Here is the plan: change_code")],
    ["prose result without structured output", exited(envelope({ result: "I think this is change_code" }))],
    ["fenced JSON result", exited(envelope({ result: "```json\n{}\n```" }))],
    ["array structured output", exited(envelope({ structured_output: [PLAN] }))],
    ["string structured output", exited(envelope({ structured_output: "change_code" }))],
    ["non-result envelope", exited(JSON.stringify({ type: "assistant", structured_output: PLAN }))],
  ])("rejects malformed output: %s", (_label, result) => {
    expect(() => interpretPlanningRun(result)).toThrow(expect.objectContaining({ kind: "malformed_output" }));
  });

  it("schema-invalid JSON is rejected by the existing structured validators (fail closed)", async () => {
    const p = port([exited(envelope({ structured_output: { intent: "deploy_everything", taskId: null } }))]);
    const raw = await createStructuredIntentPlanner(backend(p)).interpret(plannerInput);
    expect(normalizeIntentDecision(raw, { knownTaskIds: [], requireTask: false })).toMatchObject({ kind: "clarify" });
    const r = port([exited(envelope({ structured_output: { criteria: [{ id: "goal-1", status: "probably", evidence: "", reason: "" }] } }))]);
    const rawReview = await createStructuredGoalReviewer(backend(r)).review(reviewInput);
    expect(normalizeGoalReview(rawReview, reviewInput.criteria)).toEqual([expect.objectContaining({ id: "goal-1", status: "unsupported" })]);
  });

  it("a refusal stop is a typed failure", () => {
    expect(() => interpretPlanningRun(exited(envelope({ stop_reason: "refusal", structured_output: PLAN })))).toThrow(expect.objectContaining({ kind: "refusal" }));
  });
});

describe("Claude CLI planning transport: typed infrastructure failures", () => {
  it.each<[string, PlanningProcessResult, string, boolean]>([
    ["executable missing", { kind: "launch_failed", missing: true }, "executable_unavailable", false],
    ["launch failure", { kind: "launch_failed", missing: false }, "launch_failed", true],
    ["timeout", { kind: "timeout" }, "timeout", true],
    ["auth/session unavailable (error envelope)", exited(envelope({ is_error: true, subtype: "success", result: "Not logged in · Please run /login" }), { exitCode: 1 }), "not_authenticated", false],
    ["auth via HTTP status", exited(envelope({ is_error: true, api_error_status: 401, result: "" }), { exitCode: 1 }), "not_authenticated", false],
    ["rate limit status", exited(envelope({ is_error: true, api_error_status: 429, result: "" }), { exitCode: 1 }), "rate_limited", true],
    ["usage limit text", exited(envelope({ is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm" }), { exitCode: 1 }), "rate_limited", true],
    ["overloaded", exited(envelope({ is_error: true, api_error_status: 529, result: "" }), { exitCode: 1 }), "service_unavailable", true],
    ["service error in stderr only", exited("", { exitCode: 1, stderr: "API Error: 503 service unavailable" }), "service_unavailable", true],
    ["unknown non-zero exit", exited("", { exitCode: 2, stderr: "something odd" }), "process_error", true],
    ["killed by signal", exited("", { exitCode: null, signal: "SIGKILL" }), "process_error", true],
    ["error subtype with exit 0", exited(envelope({ subtype: "error_during_execution", structured_output: PLAN })), "malformed_output", false],
    ["output over bound", exited(envelope({ structured_output: PLAN }), { truncated: true }), "output_too_large", false],
  ])("%s → %s", async (_label, result, kind, transient) => {
    const error = await backend(port([result]))
      .structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ClaudeCliPlanningError);
    expect(error).toMatchObject({ kind, transient });
  });

  it("a throwing process port is a typed launch failure", async () => {
    const p: PlanningProcessPort = {
      run: async () => {
        throw new Error("EACCES /home/owner/secret");
      },
    };
    await expect(backend(p).structured({ system: "s", user: "u", schema: {}, maxTokens: 1 })).rejects.toMatchObject({ kind: "launch_failed", message: "claude cli launch_failed" });
  });

  it("errors never carry stdout, stderr, prompts or secrets", async () => {
    const leaky = exited(envelope({ is_error: true, result: `Not logged in ${SECRET_ENV.ANTHROPIC_API_KEY}` }), { exitCode: 1, stderr: `token=${SECRET_ENV.GITHUB_TOKEN}` });
    const error = (await backend(port([leaky])).structured({ system: "s", user: "OWNER PROMPT", schema: {}, maxTokens: 1 }).catch((e: unknown) => e)) as Error;
    const text = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
    for (const secret of [SECRET_ENV.ANTHROPIC_API_KEY, SECRET_ENV.GITHUB_TOKEN, "OWNER PROMPT", "Not logged in"]) expect(text).not.toContain(secret);
  });

  it("every invocation is bounded (timeout + output cap)", async () => {
    const p = port([exited(envelope({ structured_output: PLAN }))]);
    await backend(p).structured({ system: "s", user: "u", schema: {}, maxTokens: 1 });
    expect(p.specs[0]).toMatchObject({ timeoutMs: 50_000, maxOutputBytes: MAX_CLI_OUTPUT_BYTES, cwd: "/tmp/neutral" });
  });
});

describe("Claude CLI planning transport: non-interactive, read-only, no billing secrets", () => {
  const args = buildPlanningCliArgs({ model: "claude-opus-5-5", system: "SYSTEM", schema: INTENT_SCHEMA });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("runs headless with no permission prompts and no interactive/session flags", () => {
    expect(args[0]).toBe("-p");
    expect(after("--output-format")).toBe("json");
    expect(after("--permission-mode")).toBe("dontAsk");
    expect(after("--permission-prompts")).toBe("none");
    expect(args).toContain("--no-session-persistence");
    for (const flag of ["--resume", "-r", "--continue", "-c", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--bg", "--remote-control", "--tmux", "--worktree", "--add-dir", "--mcp-config", "--plugin-dir", "--agents"])
      expect(args, flag).not.toContain(flag);
    expect(args.filter((a) => a === "bypassPermissions" || a === "acceptEdits" || a === "auto")).toEqual([]);
  });

  it("grants no tools, loads no settings/hooks/MCP, and denies every mutating tool", () => {
    expect(after("--tools")).toBe("");
    expect(after("--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--allowedTools");
    const settings = JSON.parse(after("--settings")) as { disableAllHooks: boolean; permissions: { allow: string[]; deny: string[]; disableBypassPermissionsMode: string; defaultMode: string } };
    expect(settings).toMatchObject({ disableAllHooks: true, permissions: { allow: [], defaultMode: "dontAsk", disableBypassPermissionsMode: "disable" } });
    for (const tool of ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Read"]) expect(settings.permissions.deny).toContain(tool);
    const disallowed = args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--permission-mode"));
    expect(disallowed).toEqual(expect.arrayContaining(["Bash", "Edit", "Write"]));
  });

  it("does not inherit the Worker's mutation-capable settings", () => {
    const joined = args.join(" ");
    expect(joined).not.toMatch(/Bash\(|Edit\(|Write\(|acceptEdits|bypassPermissions/);
    expect(after("--json-schema")).toBe(JSON.stringify(INTENT_SCHEMA));
    expect(after("--system-prompt")).toBe("SYSTEM");
  });

  it("rejects unsafe model / effort values", () => {
    expect(() => buildPlanningCliArgs({ model: "--dangerously-skip-permissions", system: "s", schema: {} })).toThrow(ClaudeCliPlanningError);
    expect(() => buildPlanningCliArgs({ model: "claude-opus-5-5", system: "s", schema: {}, effort: "ultra; rm -rf" })).toThrow(ClaudeCliPlanningError);
  });

  it("the child environment drops API keys and every other secret", async () => {
    const env = planningChildEnv(SECRET_ENV);
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/owner" });
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "TELEGRAM_BOT_TOKEN", "DATABASE_URL", "GITHUB_TOKEN"]) expect(env, key).not.toHaveProperty(key);
    const p = port([exited(envelope({ structured_output: PLAN }))]);
    await backend(p).structured({ system: "s", user: "u", schema: {}, maxTokens: 1 });
    const serialized = JSON.stringify(p.specs[0]);
    for (const secret of [SECRET_ENV.ANTHROPIC_API_KEY, SECRET_ENV.ANTHROPIC_AUTH_TOKEN, SECRET_ENV.TELEGRAM_BOT_TOKEN, SECRET_ENV.DATABASE_URL, SECRET_ENV.GITHUB_TOKEN]) expect(serialized).not.toContain(secret);
  });
});

describe("Claude CLI auth/session preflight", () => {
  const status = (fields: Record<string, unknown>, exitCode = 0) => exited(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@example.com", orgName: "Org", ...fields }), { exitCode });
  const run = (result: PlanningProcessResult) => {
    const p = port([result]);
    return preflightClaudeCli({ process: p, workspace: fixedPlanningWorkspace("/tmp/neutral"), env: SECRET_ENV }).then((r) => ({ r, p }));
  };

  it("operational: logged in with a Claude subscription; read-only probe with no stdin and no API key", async () => {
    const { r, p } = await run(status({}));
    expect(r).toEqual({ ok: true, authMethod: "claude.ai" });
    expect(p.specs[0].args).toEqual(PREFLIGHT_ARGS);
    expect(p.specs[0].stdin).toBeNull();
    expect(p.specs[0].env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(JSON.stringify(r)).not.toContain("owner@example.com");
  });

  it.each<[string, PlanningProcessResult, string]>([
    ["executable unavailable", { kind: "launch_failed", missing: true }, "executable_unavailable"],
    ["not authenticated (exit 1, loggedIn false)", status({ loggedIn: false, authMethod: "none" }, 1), "not_authenticated"],
    ["not authenticated (stderr only)", exited("", { exitCode: 1, stderr: "Not logged in" }), "not_authenticated"],
    ["API-key login refused (would bill the API)", status({ authMethod: "api_key" }), "non_subscription_auth"],
    ["Bedrock provider refused", status({ apiProvider: "bedrock" }), "non_subscription_auth"],
    ["timeout", { kind: "timeout" }, "timeout"],
    ["garbage output", exited("hello"), "malformed_output"],
  ])("%s", async (_label, result, kind) => {
    const { r } = await run(result);
    expect(r).toMatchObject({ ok: false, error: { kind } });
  });
});

describe("Claude CLI planning workspace lifecycle (one directory per invocation, always released)", () => {
  function tracked(opts: { releaseThrows?: boolean; acquireThrows?: boolean } = {}): PlanningWorkspace & { acquired: string[]; released: string[] } {
    const acquired: string[] = [];
    const released: string[] = [];
    return {
      acquired,
      released,
      acquire() {
        if (opts.acquireThrows) throw new Error("ENOSPC /tmp");
        const cwd = `/tmp/oxm-planner-${acquired.length + 1}`;
        acquired.push(cwd);
        return {
          cwd,
          release() {
            released.push(cwd);
            if (opts.releaseThrows) throw new Error("EACCES rmdir");
          },
        };
      },
    };
  }
  const call = (ws: PlanningWorkspace, p: PlanningProcessPort) =>
    createClaudeCliPlanningBackend({ process: p, workspace: ws, env: SECRET_ENV, model: "claude-opus-5-5" }).structured({ system: "s", user: "u", schema: {}, maxTokens: 1 });

  it.each<[string, PlanningProcessResult, string | null]>([
    ["success", exited(envelope({ structured_output: PLAN })), null],
    ["malformed output", exited("not json"), "malformed_output"],
    ["non-zero exit", exited("", { exitCode: 2 }), "process_error"],
    ["timeout", { kind: "timeout" }, "timeout"],
    ["executable missing", { kind: "launch_failed", missing: true }, "executable_unavailable"],
  ])("%s: runs in a fresh directory that is released exactly once", async (_label, result, kind) => {
    const ws = tracked();
    const p = port([result]);
    const outcome = await call(ws, p).then(
      () => null,
      (e: ClaudeCliPlanningError) => e.kind,
    );
    expect(outcome).toBe(kind);
    expect(p.specs[0].cwd).toBe(ws.acquired[0]);
    expect(ws.released).toEqual(ws.acquired);
    expect(ws.acquired).toHaveLength(1);
  });

  it("a throwing process port still releases the directory", async () => {
    const ws = tracked();
    await expect(call(ws, { run: async () => Promise.reject(new Error("boom")) })).rejects.toMatchObject({ kind: "launch_failed" });
    expect(ws.released).toEqual(ws.acquired);
  });

  it("each invocation gets its own directory", async () => {
    const ws = tracked();
    const p = port([exited(envelope({ structured_output: PLAN }))]);
    await call(ws, p);
    await call(ws, p);
    expect(new Set(p.specs.map((s) => s.cwd)).size).toBe(2);
    expect(ws.released).toEqual(ws.acquired);
  });

  it.each<[string, PlanningProcessResult, string | null]>([
    ["success", exited(envelope({ structured_output: PLAN })), null],
    ["timeout", { kind: "timeout" }, "timeout"],
    ["non-zero exit", exited("", { exitCode: 1, stderr: "Not logged in" }), "not_authenticated"],
  ])("cleanup failure never replaces the outcome (%s)", async (_label, result, kind) => {
    const ws = tracked({ releaseThrows: true });
    const outcome = await call(ws, port([result])).then(
      (v) => (v === PLAN || JSON.stringify(v) === JSON.stringify(PLAN) ? null : "unexpected"),
      (e: ClaudeCliPlanningError) => e.kind,
    );
    expect(outcome).toBe(kind);
    expect(ws.released).toHaveLength(1);
  });

  it("workspace acquisition failure is typed and nothing is spawned", async () => {
    const p = port([exited(envelope({ structured_output: PLAN }))]);
    await expect(call(tracked({ acquireThrows: true }), p)).rejects.toMatchObject({ kind: "workspace_unavailable", message: "claude cli workspace_unavailable" });
    expect(p.specs).toEqual([]);
    const r = await preflightClaudeCli({ process: p, workspace: tracked({ acquireThrows: true }), env: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "workspace_unavailable" } });
  });

  it("preflight releases its directory on success and on failure, even if release throws", async () => {
    for (const result of [exited(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" })), { kind: "timeout" } as const, exited("", { exitCode: 1 })]) {
      const ws = tracked({ releaseThrows: true });
      const r = await preflightClaudeCli({ process: port([result]), workspace: ws, env: {} });
      expect(r.ok).toBe(result.kind === "exited" && result.exitCode === 0);
      expect(ws.released).toEqual(ws.acquired);
    }
  });
});
