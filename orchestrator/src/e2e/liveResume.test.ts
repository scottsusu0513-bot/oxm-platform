import { describe, expect, it } from "vitest";
import type { ProcessExit, ProcessRunner } from "../workers/types";
import { checkLiveSafety } from "./liveAdapters";
import { readLiveSmokeConfig } from "./liveConfig";
import { LIVE_CONFIRMATION, type LiveSmokeConfig } from "./types";

const ok = (stdout = ""): ProcessExit => ({ exitCode: 0, signal: null, stdout, stderr: "", truncated: false });

function runner(branch: string, porcelain: string): ProcessRunner {
  return {
    spawn(spec) {
      let result = ok();
      if (spec.command === "git" && spec.args[0] === "rev-parse") result = ok(`${branch}\n`);
      else if (spec.command === "git" && spec.args[0] === "status") result = ok(porcelain);
      else if (spec.command === "gh" && spec.args[0] === "repo") result = ok(JSON.stringify({ nameWithOwner: "oxm/oxm-platform" }));
      else if (spec.command === "gh" && spec.args[0] === "api")
        result = ok(JSON.stringify({ name: "oxm-space", state: "Available", repository: { full_name: "oxm/oxm-platform" } }));
      return { exit: Promise.resolve(result), kill() {} };
    },
  };
}

const config: LiveSmokeConfig = {
  live: true,
  confirmation: LIVE_CONFIRMATION,
  repoRoot: "/workspaces/oxm-platform",
  expectedRepository: { owner: "oxm", repo: "oxm-platform" },
  codespaceName: "oxm-space",
  expectedCodespaceName: "oxm-space",
  workspacePath: "/workspaces/oxm-platform",
  workerTimeoutMs: 60_000,
  maxQaPolls: 1,
  mergeEnabled: false,
  deployEnabled: false,
  forcePushEnabled: false,
  productionDbEnabled: false,
  ci: false,
};
const DIRTY = " M orchestrator/smoke-fixtures/agent-e2e-smoke.txt\n";

describe("live safety on restart of a checkpointed task", () => {
  it("a fresh start still requires a clean worktree", async () => {
    const r = await checkLiveSafety(config, runner("agent/task-x", DIRTY));
    expect(r).toMatchObject({ ok: false, failureCode: "safety_clean_worktree" });
  });

  it("a resume accepts the kept work only on the exact checkpointed branch", async () => {
    expect((await checkLiveSafety(config, runner("agent/task-x", DIRTY), { dirtyBranches: ["agent/task-x"] })).ok).toBe(true);
    expect(await checkLiveSafety(config, runner("agent/other", DIRTY), { dirtyBranches: ["agent/task-x"] })).toMatchObject({ ok: false, failureCode: "safety_resume_branch_binding" });
    expect(await checkLiveSafety(config, runner("main", DIRTY), { dirtyBranches: ["main"] })).toMatchObject({ ok: false, failureCode: "safety_non_production_branch" });
  });

  it("a clean worktree passes even when resume branches are declared; a custom confirmation is enforced", async () => {
    expect((await checkLiveSafety(config, runner("agent/task-x", ""), { dirtyBranches: ["agent/task-y"] })).ok).toBe(true);
    expect(await checkLiveSafety(config, runner("agent/task-x", ""), { expectedConfirmation: "other" })).toMatchObject({ ok: false, failureCode: "safety_explicit_confirmation" });
  });

  it("live config reading reports missing variables without values", () => {
    expect(readLiveSmokeConfig({}, "/workspaces/oxm-platform")).toMatchObject({ ok: false, code: "configuration_missing" });
  });
});
