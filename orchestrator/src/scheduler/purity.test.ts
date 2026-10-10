import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSimulation, fakeIntake } from "./fake";

// Hard boundary: the scheduler and Manager Loop orchestrate structured
// metadata. They never read source code, run a shell, call an LLM, or reach
// GitHub/git/workers except through injected ports, and they have no merge,
// deploy, approve, close, force-push or production-DB path.
const dir = import.meta.dirname;
const all = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const adapterFiles = new Set(["adapters.ts", "fake.ts", "persistence.ts"]);
const core = all.filter((f) => !adapterFiles.has(f));
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Runtime (value) imports allowed from outside scheduler/. All are pure policy modules. */
const ALLOWED_RUNTIME = new Set([
  "../branches/naming",
  "../branches/overlap",
  "../branches/planner",
  "../branches/taskBase",
  "../branches/types",
  "../domain/taskState",
  "../domain/types",
  "../executive/evidencePlan",
  "../executive/guidance",
  "../executive/handoff",
  "../executive/workAssignment",
  "../github/qa",
  "../githubWrite/flow",
  "../manager/budget",
  "../manager/diagnosis",
  "../manager/humanDecision",
  "../manager/lifecycle",
  "../manager/managerPlan",
  "../manager/constraintCheck",
  "../manager/repair",
  "../manager/sequencing",
  "../manager/validator",
  "../store/sanitize",
  "../workers/permissions",
  "../workers/prompt",
]);
/** Type-only imports allowed (erased at runtime). */
const ALLOWED_TYPE_ONLY = new Set([...ALLOWED_RUNTIME, "../planning/managerReasoning", "../github/types", "../githubWrite/types", "../githubWrite/lease", "../githubWrite/workspace", "../manager/types", "../store/types", "../workers/types", "../workers/gitMetadataPolicy"]);
ALLOWED_TYPE_ONLY.add("../codespace/types");

function imports(f: string): { spec: string; typeOnly: boolean }[] {
  return [...code(f).matchAll(/^import\s+(type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["'];?/gm)].map((m) => ({ spec: m[2], typeOnly: Boolean(m[1]) }));
}

describe("scheduler / manager-loop boundaries", () => {
  it("covers the scheduler modules", () => {
    expect(all.sort()).toEqual(["adapters.ts", "dependencies.ts", "events.ts", "evidence.ts", "fake.ts", "loop.ts", "persistence.ts", "priority.ts", "queue.ts", "scheduler.ts", "types.ts"]);
  });

  it("imports only pure policy modules at runtime; adapters are type-only", () => {
    for (const f of core) {
      for (const { spec, typeOnly } of imports(f)) {
        if (spec.startsWith("./")) continue;
        const allowed = typeOnly ? ALLOWED_TYPE_ONLY : ALLOWED_RUNTIME;
        expect(allowed.has(spec), `${f} imports ${typeOnly ? "type " : ""}${spec}`).toBe(true);
      }
    }
  });

  it("does not read files, glob/grep the repo, run a shell, touch the network, or call an LLM", () => {
    for (const f of all) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']node:[^"']+["']|["'](fs|fs\/promises|path|child_process|os|net|http|https)["']/);
      expect(src, f).not.toMatch(/\b(readFile|readFileSync|readdir|readdirSync|createReadStream|existsSync|statSync|opendir)\b/);
      expect(src, f).not.toMatch(/\b(glob|globSync|ripgrep)\s*\(|\bgrep\b/);
      expect(src, f).not.toMatch(/\bgit\s+(show|cat-file|diff|log|blame|ls-files|grep)\b/);
      expect(src, f).not.toMatch(/\b(spawn|exec|execFile|execSync|fork)\s*\(|\.spawn\s*\(|shell\s*:\s*true/);
      expect(src, f).not.toMatch(/\bprocess\.|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
      expect(src, f).not.toMatch(/\b(anthropic|openai|octokit)\b|@anthropic-ai|\bclaude\s+-p\b|\bcodex\s+exec\b/i);
      expect(src, f).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    }
  });

  it("core has no timers, sleeps, clocks, or randomness (event-driven, deterministic)", () => {
    for (const f of core) {
      const src = code(f);
      expect(src, f).not.toMatch(/\b(setTimeout|setInterval|setImmediate|sleep)\s*\(|\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bconsole\./);
    }
  });

  it("never constructs workers, git, or GitHub clients itself", () => {
    for (const f of core) {
      const src = code(f);
      expect(src, f).not.toMatch(/createClaudeCodeAdapter|createCodexAdapter|createLocalClaudeCodeAdapter|createLocalCodexAdapter|createNodeProcessRunner|createGitInspector|ProcessRunner|GitInspector/);
      expect(src, f).not.toMatch(/createGitHubWriteClient|createGitHubReadClient|GitHubWriteTransport|GitPushTransport|prepareAssignedWorkspace|changedPathsSince/);
    }
  });

  it("has no merge, approve, close, deploy, force-push, main-push, or production-DB path", () => {
    for (const f of all) {
      const src = code(f);
      expect(src, f).not.toMatch(/\bmerge\w*\s*\(|mergePullRequest|approvePullRequest|closePullRequest|\.close\s*\(|\bdeploy\w*\s*\(/i);
      expect(src, f).not.toMatch(/--force|force\s*:\s*true|forcePush|\+refs\//);
      expect(src, f).not.toMatch(/pushBranch\s*\(\s*["'](main|master)["']|refs\/heads\/(main|master)/);
      expect(src, f).not.toMatch(/drizzle|mysql|DATABASE_URL|\.\.\/\.\.\/server\//);
    }
  });

  it("never invents a branch name: branches come only from planBranch", () => {
    const loop = code("loop.ts");
    for (const f of core) expect(code(f), f).not.toMatch(/\btaskBranchName\s*\(|["']agent\/task-/);
    expect(loop).toMatch(/const plan = planBranch\(/);
    expect([...loop.matchAll(/createTaskBranch\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["plan"]);
    expect([...loop.matchAll(/pushTaskBranch\(([^,]*),/g)].map((m) => m[1])).toEqual(["t.plan", "t.plan"]); // normal push + resume verification
  });

  it("orders dispatch as planner → lease → branch → workspace → preconditions → worker", () => {
    const loop = code("loop.ts");
    const body = loop.slice(loop.indexOf("async function dispatch("), loop.indexOf("function baseContract("));
    const order = ["planBranch(", "leases.acquire(", "createTaskBranch(", "workspace.prepare(", "assignWorkerBranch(", "workspace.checkPreconditions(", "startRun("].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every worker start goes through the injected port and the budget cap", () => {
    const loop = code("loop.ts");
    expect(loop.match(/ports\.worker\.start\(/g)).toHaveLength(1);
    const startRun = loop.slice(loop.indexOf("function startRun("), loop.indexOf("async function onRunDone("));
    expect(startRun.indexOf("maxWorkerExecutions(t)")).toBeLessThan(startRun.indexOf("ports.worker.start("));
  });

  it("first push happens only after a Manager validation step (open_pr)", () => {
    const loop = code("loop.ts");
    const pushCalls = [...loop.matchAll(/return push\(t\)/g)].length;
    expect(pushCalls).toBe(1); // commitAndPush, reached only after Manager open_pr validation
    expect(loop).toMatch(/case "open_pr":\s*if \(modeOf\(t\) === "read_only"\) return completeReadOnly\(t\);\s*return requestCommitApproval\(t\);/);
    expect(loop).toMatch(/async function requestCommitApproval[\s\S]*awaitApproval\(t, "commit_publish"/);
    expect(loop).toMatch(/async function commitAndPush[\s\S]*ports\.workspace\.commitValidated[\s\S]*return push\(t\);/);
    expect(loop).toMatch(/const phase = t\.pr \? "pre_push" : "post_qa";[\s\S]*return evaluate\(t, undefined, phase\);/);
    expect(loop).toMatch(/taskState: phase === "pre_push" \? "running" : t\.state/);
  });
});

describe("behavioural boundaries", () => {
  it("a denied workspace lease means no branch, no workspace prep, and no worker", async () => {
    const sim = createSimulation({ holdWorkers: true });
    sim.ports.leases.acquire({
      workspaceId: "taken",
      taskId: "other",
      lineageId: "other",
      branch: "agent/task-other-x",
    });
    await sim.create(fakeIntake({ taskId: "w1", workspaceId: "taken" }));
    expect(sim.loop.task("w1")!.status).toBe("waiting_workspace");
    expect(sim.workerCalls).toEqual([]);
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE"))).toEqual([]);
  });

  it("a branch-planner reject blocks before any write or worker", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "p1" }, { lineage: { rootTaskId: "BAD ID", title: "x" } }));
    expect(sim.loop.task("p1")!).toMatchObject({
      status: "blocked",
      branchPlanState: "rejected",
    });
    expect(sim.workerCalls).toEqual([]);
    expect(sim.remote.calls).toEqual([]);
  });

  it("the worker never receives a protected branch and main never moves", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "m1" }));
    expect(sim.workerCalls.every((c) => c.branch.startsWith("agent/task-"))).toBe(true);
    expect(sim.remote.calls.some((c) => /refs\/heads\/(main|master)\b/.test(c))).toBe(false);
  });
});
