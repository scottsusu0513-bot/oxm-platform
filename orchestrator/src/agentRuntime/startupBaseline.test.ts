import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHumanOwnerSession } from "../humanInteraction/auth";
import { createInMemoryAuditRepository } from "../store/memory";
import type { ProcessExit, ProcessRunner } from "../workers/types";
import { createAgentRuntime } from "./compose";
import { AGENT_RUNTIME_CONFIRMATION, readAgentRuntimeConfig } from "./config";
import { loadRecordedBaseline, recordBaseline } from "./runtimeBaseline";

// Cold start / restart of the composed runtime: baseline identity and the startup
// return from a finished task branch (no checkpointed active task).
const RUNTIME_BRANCH = "agent/gpt-manager-live-e2e";
const TASK_BRANCH = "agent/task-t261009-882d30-oxm";
const RUNTIME_SHA = "4".repeat(40);
const TASK_SHA = "e".repeat(40);
const REPO_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "oxm-startup-baseline-")));
afterAll(() => rmSync(REPO_ROOT, { recursive: true, force: true }));

const ok = (stdout = ""): ProcessExit => ({ exitCode: 0, signal: null, stdout, stderr: "", truncated: false });
const missing = (): ProcessExit => ({ exitCode: 1, signal: null, stdout: "", stderr: "", truncated: false });

/** Stateful fake workspace: tracks the checked-out branch and every git switch. */
function workspaceRunner(start: string, localRuntimeSha: string | null) {
  const heads: Record<string, string> = { [RUNTIME_BRANCH]: RUNTIME_SHA, [TASK_BRANCH]: TASK_SHA };
  const state = { branch: start, switches: [] as string[][] };
  const runner: ProcessRunner = {
    spawn(spec) {
      const a = spec.args;
      let result = ok();
      if (spec.command === "git" && a[0] === "rev-parse" && a[1] === "--abbrev-ref") result = ok(`${state.branch}\n`);
      else if (spec.command === "git" && a[0] === "rev-parse" && a[1] === "HEAD") result = ok(`${heads[state.branch]}\n`);
      else if (spec.command === "git" && a[0] === "rev-parse" && a[1] === "--verify") result = a[3] === `refs/heads/${RUNTIME_BRANCH}^{commit}` && localRuntimeSha ? ok(`${localRuntimeSha}\n`) : missing();
      else if (spec.command === "git" && a[0] === "switch") {
        state.switches.push([...a]);
        state.branch = a[a.length - 1];
      } else if (spec.command === "gh" && a[0] === "repo") result = ok(JSON.stringify({ nameWithOwner: "oxm/oxm-platform" }));
      else if (spec.command === "gh" && a[0] === "api") result = ok(JSON.stringify({ name: "oxm-space", state: "Available", repository: { full_name: "oxm/oxm-platform" } }));
      return { exit: Promise.resolve(result), kill() {} };
    },
  };
  return { runner, state };
}

const config = () => {
  const r = readAgentRuntimeConfig(
    { OXM_AGENT_EXPECTED_REPO: "oxm/oxm-platform", CODESPACE_NAME: "oxm-space", OXM_AGENT_CODESPACE_NAME: "oxm-space", OXM_AGENT_CONFIRM: AGENT_RUNTIME_CONFIRMATION },
    REPO_ROOT,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.config;
};
const owner = () => createHumanOwnerSession({ principalId: "telegram-owner", source: "telegram", now: () => new Date().toISOString() });

describe("runtime startup baseline", () => {
  it("first start on the runtime branch records the baseline durably", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const ws = workspaceRunner(RUNTIME_BRANCH, RUNTIME_SHA);
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: ws.runner });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runtime.runtimeBaseline).toEqual({ branch: RUNTIME_BRANCH, sha: RUNTIME_SHA });
    expect(r.runtime.workspaceRestored).toBeNull();
    expect(loadRecordedBaseline(audit)).toEqual({ branch: RUNTIME_BRANCH, sha: RUNTIME_SHA });
    expect(ws.state.switches).toEqual([]);
  });

  it("cold start left on a finished task branch: keeps the recorded identity and returns to the runtime branch", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    recordBaseline(audit, "b1", { branch: RUNTIME_BRANCH, sha: RUNTIME_SHA });
    const ws = workspaceRunner(TASK_BRANCH, RUNTIME_SHA);
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: ws.runner });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runtime.runtimeBaseline).toEqual({ branch: RUNTIME_BRANCH, sha: RUNTIME_SHA }); // not the task branch
    expect(ws.state.switches).toEqual([["switch", "--no-guess", RUNTIME_BRANCH]]);
    expect(ws.state.branch).toBe(RUNTIME_BRANCH);
    expect(r.runtime.workspaceRestored).toContain(RUNTIME_BRANCH);
    expect(audit.list({ taskId: "runtime-baseline" }).map((e) => e.event)).toContain("runtime_workspace_restored");
  });

  it("stays on the task branch when the local runtime branch moved; never switches onto main", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    recordBaseline(audit, "b1", { branch: RUNTIME_BRANCH, sha: RUNTIME_SHA });
    const ws = workspaceRunner(TASK_BRANCH, "5".repeat(40));
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: ws.runner });
    expect(r.ok).toBe(true);
    expect(ws.state.switches).toEqual([]);
    expect(ws.state.branch).toBe(TASK_BRANCH);
  });

  it("restart on a task branch without a recorded baseline fails closed with a clear code", async () => {
    const audit = createInMemoryAuditRepository(() => "t");
    const ws = workspaceRunner(TASK_BRANCH, RUNTIME_SHA);
    const r = await createAgentRuntime(config(), { audit, owner: owner(), runner: ws.runner });
    expect(r).toMatchObject({ ok: false, code: "runtime_baseline_unknown" });
    expect(ws.state.switches).toEqual([]);
  });
});
