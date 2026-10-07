import { createManagerApprovalRequirementReader } from "../gateway/integration";
import { describe, expect, it } from "vitest";
import { OPTIONAL_CAPABILITIES } from "./types";
import { createSimulation, driveQa, fakeIntake, MAIN_SHA, sha } from "./fake";

const events = (sim: ReturnType<typeof createSimulation>, taskId: string) => sim.audit.filter((e) => e.taskId === taskId).map((e) => e.event);

const GREEN_CAPS = ["scheduler", "branch_planner", "workspace_lease", "worker", "validator", "github_write", "github_qa", "human_approval"];

describe("Manager Loop — end-to-end with fakes", () => {
  it("1. happy-path green task: dispatch → branch → worker → evidence → push → PR → QA → accepted", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "t1" }));
    let t = sim.loop.task("t1")!;
    expect(t.status).toBe("qa_pending");
    expect(t.state).toBe("pr_opened");
    expect(t.branch).toBe("agent/task-t1-fix-t1");
    expect(t.prNumber).toBe(100); // from the trusted write client, never the worker
    expect(sim.remote.refs.get(t.branch!)).toBe(t.headSha);
    expect(t.headSha).not.toBe(MAIN_SHA);
    expect(sim.trustedRecords[0].verifiedHeadSha).toBe(MAIN_SHA); // Worker only edited; trusted layer committed next.

    await driveQa(sim, "t1");
    t = sim.loop.task("t1")!;
    expect(t.status).toBe("accepted");
    expect(t.state).toBe("complete");
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0]).toMatchObject({
      kind: "claude",
      branch: "agent/task-t1-fix-t1",
      expectedHeadSha: MAIN_SHA,
      repair: false,
    });
    expect(sim.ports.leases.current("ws-t1")).toBeNull(); // lease released on acceptance
    expect(events(sim, "t1")).toEqual(expect.arrayContaining(["task_queued", "task_dispatched", "worker_started", "worker_completed", "branch_push_requested", "pr_create_requested", "qa_wait", "manager_accepted"]));
    // No merge, no main push: the remote only saw branch creation, one push and one PR.
    expect(sim.remote.refs.get("main")).toBe(MAIN_SHA);
    expect(sim.remote.calls.filter((c) => /merge|DELETE|force/i.test(c))).toEqual([]);
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([`PUSH ${t.headSha}:refs/heads/${t.branch}`]);
  });

  it("waitForWorkers remains pending for an outstanding run and drains successful completion events", async () => {
    const sim = createSimulation({ holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "wait-worker" }));
    expect(sim.loop.task("wait-worker")).toMatchObject({ status: "running", workerRunning: true });

    let settled = false;
    const waiting = sim.loop.settle({ waitForWorkers: true }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    expect(sim.releaseWorker("wait-worker")).toBe(true);
    await waiting;
    expect(sim.loop.task("wait-worker")).toMatchObject({ status: "needs_human_approval", state: "awaiting_approval", approvalPhase: "commit_publish", workerRunning: false });
    expect(sim.loop.task("wait-worker")?.headSha).toBeNull();
    expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr"))).toHaveLength(0);
    sim.approve("wait-worker", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "wait-worker", phase: "commit_publish" });
    expect(sim.loop.task("wait-worker")).toMatchObject({ status: "qa_pending", workerRunning: false });
    expect(sim.remote.calls.filter((call) => call.startsWith("CREATE pr"))).toHaveLength(1);
  });

  it("2. worker failure then successful repair on the same branch and worker", async () => {
    const sim = createSimulation({ worker: { t2: ["failure", "success"] } });
    await sim.create(fakeIntake({ taskId: "t2" }));
    await driveQa(sim, "t2");
    const t = sim.loop.task("t2")!;
    expect(t.status).toBe("accepted");
    expect(sim.workerCalls).toHaveLength(2);
    const [first, repair] = sim.workerCalls;
    expect(repair.repair).toBe(true);
    expect(repair.branch).toBe(first.branch);
    expect(repair.kind).toBe(first.kind);
    expect(repair.runId).not.toBe(first.runId);
    expect(t.repair.attempt).toBe(1);
    expect(t.budget.workerExecutions).toBe(2);
    expect(t.budget.activatedCapabilities).toContain("repair_loop");
    expect(t.escalations.map((e) => e.action)).toEqual(["return_to_worker", "request_human_approval"]);
    expect(events(sim, "t2")).toEqual(expect.arrayContaining(["repair_requested", "repair_completed"]));
    // Only one task branch was ever created.
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE ref"))).toHaveLength(1);
  });

  it("repairs an uncommitted failed attempt using only its trusted task-owned paths", async () => {
    const sim = createSimulation({ worker: { dirtyrepair: ["validation_failed_dirty", "success"] } });
    await sim.create(fakeIntake({ taskId: "dirtyrepair" }));

    const [first, repair] = sim.workerCalls;
    expect(first.allowedDirtyPaths).toEqual([]);
    expect(repair.expectedHeadSha).toBe(first.expectedHeadSha);
    expect(repair.allowedDirtyPaths).toEqual(["server/dirtyrepair/index.ts"]);
    expect(sim.loop.task("dirtyrepair")).toMatchObject({ status: "qa_pending", repair: { attempt: 1 } });
  });

  it("3. CI failure then successful repair: same PR, new head, QA re-polled", async () => {
    const sim = createSimulation({ ci: { t3: ["fail", "pass"] } });
    await sim.create(fakeIntake({ taskId: "t3" }));
    const firstHead = sim.loop.task("t3")!.headSha;
    await sim.send({ type: "qa_updated", taskId: "t3" }); // CI fails → repair → push → qa_pending again
    let t = sim.loop.task("t3")!;
    expect(t.status).toBe("qa_pending");
    expect(t.state).toBe("qa_running");
    expect(t.headSha).not.toBe(firstHead);
    expect(t.prNumber).toBe(100);
    await driveQa(sim, "t3");
    t = sim.loop.task("t3")!;
    expect(t.status).toBe("accepted");
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls[1].expectedHeadSha).toBe(firstHead);
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE pr"))).toHaveLength(1);
  });

  it("3b. old-head CI cannot satisfy a repaired head; a second CI failure uses the final repair budget", async () => {
    const sim = createSimulation({ ci: { t3b: ["fail", "fail", "pass"] } });
    await sim.create(fakeIntake({ taskId: "t3b" }));
    const pr = sim.loop.task("t3b")!.prNumber;
    const branch = sim.loop.task("t3b")!.branch;

    await sim.send({ type: "qa_updated", taskId: "t3b" });
    const secondHead = sim.loop.task("t3b")!.headSha;
    expect(sim.loop.task("t3b")!).toMatchObject({
      status: "qa_pending",
      prNumber: pr,
      branch,
    });

    await sim.send({ type: "qa_updated", taskId: "t3b" });
    const thirdHead = sim.loop.task("t3b")!.headSha;
    expect(thirdHead).not.toBe(secondHead);
    expect(sim.workerCalls).toHaveLength(3);
    expect(sim.workerCalls.every((c) => c.branch === branch)).toBe(true);
    expect(sim.remote.calls.filter((c) => c.startsWith("CREATE pr"))).toHaveLength(1);
    const repairPushes = sim.remote.calls.filter((c) => c.startsWith("PUSH"));
    expect(repairPushes).toHaveLength(3);
    expect(new Set(repairPushes).size).toBe(3); // one trusted commit/push per bounded successful run

    await driveQa(sim, "t3b");
    expect(sim.loop.task("t3b")!).toMatchObject({
      status: "accepted",
      prNumber: pr,
      headSha: thirdHead,
    });
  });

  it("4. repair budget exhausted → blocked; total worker runs capped at 1 + maxRepairAttempts", async () => {
    const sim = createSimulation({ worker: { t4: ["failure"] } });
    await sim.create(fakeIntake({ taskId: "t4" }));
    const t = sim.loop.task("t4")!;
    expect(t.status).toBe("blocked");
    expect(t.state).toBe("failed");
    expect(sim.workerCalls).toHaveLength(3);
    expect(t.budget.workerExecutions).toBe(3);
    expect(t.budget.maxWorkerExecutions).toBe(3);
    expect(t.blockingReason).toContain("repair_budget_exhausted");
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH") || c.startsWith("CREATE pr"))).toEqual([]);
    expect(sim.ports.leases.current("ws-t4")).toBeNull();
  });

  it("5. branch conflict queues the second task until the first finishes", async () => {
    const sim = createSimulation({ holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "a1", expectedPaths: ["server/db.ts"] }));
    await sim.create(
      fakeIntake({
        taskId: "b1",
        expectedPaths: ["server/db.ts", "server/b1.ts"],
      }),
    );
    expect(sim.loop.task("a1")!.status).toBe("running");
    const b = sim.loop.task("b1")!;
    expect(b.status).toBe("waiting_branch_conflict");
    expect(b.escalations).toEqual([{ trigger: "branch_conflict", action: "wait" }]);
    expect(sim.workerCalls.map((c) => c.taskId)).toEqual(["a1"]);
    expect(events(sim, "b1")).toContain("conflict_wait");

    sim.releaseWorker("a1");
    await sim.loop.settle();
    await driveQa(sim, "a1");
    expect(sim.loop.task("a1")!.status).toBe("accepted");
    expect(sim.loop.task("b1")!.status).toBe("running");
    sim.releaseWorker("b1");
    await sim.loop.settle();
    await driveQa(sim, "b1");
    expect(sim.loop.task("b1")!.status).toBe("accepted");
  });

  it("6. dependency prevents dispatch until the dependency is accepted", async () => {
    const sim = createSimulation({ holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "base" }));
    await sim.create(fakeIntake({ taskId: "dep" }, { dependsOn: ["base"] }));
    expect(sim.loop.task("dep")!.status).toBe("waiting_dependency");
    expect(sim.workerCalls.map((c) => c.taskId)).toEqual(["base"]);
    expect(sim.loop.task("dep")!.budget.activatedCapabilities).toContain("dependency_resolver");
    sim.releaseWorker("base");
    await sim.loop.settle();
    await driveQa(sim, "base");
    expect(sim.loop.task("dep")!.status).toBe("running");
  });

  it("6b. a blocked dependency blocks its dependents", async () => {
    const sim = createSimulation({ worker: { base: ["failure"] } });
    await sim.create(fakeIntake({ taskId: "base" }));
    await sim.create(fakeIntake({ taskId: "dep" }, { dependsOn: ["base"] }));
    expect(sim.loop.task("base")!.status).toBe("blocked");
    const dep = sim.loop.task("dep")!;
    expect(dep.status).toBe("blocked");
    expect(dep.blockingReason).toContain("dependency blocked: base");
    expect(sim.workerCalls.filter((c) => c.taskId === "dep")).toEqual([]);
  });

  it("7. high-priority task wins deterministic contention for a shared workspace", async () => {
    const sim = createSimulation({
      holdWorkers: true,
      policy: { maxConcurrentTasks: 1 },
    });
    await sim.create(fakeIntake({ taskId: "blocker", workspaceId: "shared" }));
    await sim.create(fakeIntake({ taskId: "normal1", workspaceId: "shared" }, { prioritySignals: ["feature"] }));
    await sim.create(fakeIntake({ taskId: "urgent1", workspaceId: "shared" }, { prioritySignals: ["production_incident"] }));
    expect(sim.loop.task("normal1")!.status).toBe("waiting_workspace");
    expect(sim.loop.task("urgent1")!.status).toBe("waiting_workspace");
    sim.releaseWorker("blocker");
    await sim.loop.settle();
    await driveQa(sim, "blocker"); // acceptance frees the workspace → workspace_available → tick
    expect(sim.workerCalls.map((c) => c.taskId)).toEqual(["blocker", "urgent1"]);
    expect(sim.loop.task("urgent1")!.priority.priority).toBe("critical");
    expect(sim.loop.task("normal1")!.status).toBe("waiting_workspace");
  });

  it("8. red task pauses for human approval before execution and after QA", async () => {
    const sim = createSimulation();
    const red = fakeIntake({
      taskId: "red1",
      actions: [{ kind: "code_edit" }, { kind: "prod_db_write" }],
    });
    expect(red.classification.risk.level).toBe("red");
    await sim.create(red);
    let t = sim.loop.task("red1")!;
    expect(t.status).toBe("needs_human_approval");
    expect(t.state).toBe("awaiting_approval");
    expect(sim.workerCalls).toEqual([]);
    expect(events(sim, "red1")).toContain("human_approval_requested");

    sim.approve("red1", "pre_execution");
    await sim.send({
      type: "approval_granted",
      taskId: "red1",
      phase: "pre_execution",
    });
    expect(sim.workerCalls).toHaveLength(1);
    await driveQa(sim, "red1");
    t = sim.loop.task("red1")!;
    expect(t.status).toBe("needs_human_approval"); // post-QA gate
    expect(t.state).toBe("awaiting_approval");
    expect(t.budget.managerProfile).toBe("controlled");

    sim.approve("red1", "post_qa");
    await sim.send({
      type: "approval_granted",
      taskId: "red1",
      phase: "post_qa",
    });
    t = sim.loop.task("red1")!;
    expect(t.status).toBe("accepted");
    expect(t.state).toBe("complete");
    expect(sim.remote.refs.get("main")).toBe(MAIN_SHA); // still no merge
  });

  it("8b. rejected approval blocks without running the worker", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "red2", actions: [{ kind: "prod_deploy" }] }));
    sim.rejectApproval("red2", "pre_execution");
    await sim.send({
      type: "approval_rejected",
      taskId: "red2",
      phase: "pre_execution",
    });
    expect(sim.loop.task("red2")!).toMatchObject({
      status: "blocked",
      state: "failed",
    });
    expect(sim.workerCalls).toEqual([]);
  });

  it("9. stale base triggers a bounded replan from the fresh main", async () => {
    const fresh = sha(0xa0001);
    const sim = createSimulation({
      remoteMain: fresh,
      mainHeads: [MAIN_SHA, fresh],
    });
    await sim.create(fakeIntake({ taskId: "s1" }));
    const t = sim.loop.task("s1")!;
    expect(t.replans).toBe(1);
    expect(t.escalations).toEqual([
      { trigger: "stale_base", action: "replan_branch" },
      { trigger: "approval_required", action: "request_human_approval" },
    ]);
    expect(t.budget.activatedCapabilities).toContain("replan");
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0].expectedHeadSha).toBe(fresh);
    await driveQa(sim, "s1");
    expect(sim.loop.task("s1")!.status).toBe("accepted");
  });

  it("9b. a base that keeps moving exhausts the replan budget and blocks", async () => {
    const sim = createSimulation({
      remoteMain: sha(0xa0009),
      mainHeads: [MAIN_SHA],
    });
    await sim.create(fakeIntake({ taskId: "s2" }));
    expect(sim.loop.task("s2")!).toMatchObject({
      status: "blocked",
      replans: 2,
    });
    expect(sim.workerCalls).toEqual([]);
  });

  it("10. simple green happy path activates no optional/deep capability and one worker call", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "cheap" }));
    await driveQa(sim, "cheap");
    const t = sim.loop.task("cheap")!;
    expect(t.status).toBe("accepted");
    expect(t.budget.activatedCapabilities).toEqual(GREEN_CAPS);
    for (const c of OPTIONAL_CAPABILITIES) expect(t.budget.activatedCapabilities).not.toContain(c);
    expect(t.budget).toMatchObject({
      managerProfile: "fast",
      workerExecutions: 1,
      managerLlmCalls: 0,
      escalationCount: 1,
      deepReviewEnabled: false,
      llmCallBudget: null,
    });
    expect(t.escalations).toEqual([{ trigger: "approval_required", action: "request_human_approval" }]);
    expect(t.budget.activatedCapabilities).not.toContain("repair_loop");
    expect(t.budget.activatedCapabilities).toContain("human_approval");
  });
});

describe("Manager Loop — cost guardrails", () => {
  it("one repair means exactly two worker executions", async () => {
    const sim = createSimulation({
      worker: { r1: ["validation_failed", "success"] },
    });
    await sim.create(fakeIntake({ taskId: "r1" }));
    await driveQa(sim, "r1");
    expect(sim.loop.task("r1")!.status).toBe("accepted");
    expect(sim.workerCalls).toHaveLength(2);
  });

  it("policy maxRepairAttempts caps total executions below the manager budget", async () => {
    const sim = createSimulation({
      worker: { r2: ["failure"] },
      policy: { maxRepairAttempts: 1 },
    });
    await sim.create(fakeIntake({ taskId: "r2" }));
    const t = sim.loop.task("r2")!;
    expect(t.status).toBe("blocked");
    expect(sim.workerCalls).toHaveLength(2);
    expect(t.budget.maxWorkerExecutions).toBe(2);
  });

  it("CI that fails forever cannot loop: worker runs stay bounded", async () => {
    const sim = createSimulation({ ci: { r3: ["fail"] } });
    await sim.create(fakeIntake({ taskId: "r3" }));
    await driveQa(sim, "r3", 20);
    const t = sim.loop.task("r3")!;
    expect(t.status).toBe("blocked");
    expect(sim.workerCalls).toHaveLength(3);
  });

  it("pending QA is bounded by the poll policy, and the loop never polls on its own", async () => {
    const sim = createSimulation({
      ci: { q1: ["pending"] },
      policy: { qaPoll: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 40 } },
    });
    await sim.create(fakeIntake({ taskId: "q1" }));
    expect(sim.qaReads).toEqual([]); // nothing reads QA without a qa_updated event
    await sim.send({ type: "qa_updated", taskId: "q1" });
    expect(sim.loop.task("q1")!).toMatchObject({
      status: "qa_pending",
      nextQaPollDelayMs: 10,
    });
    await driveQa(sim, "q1", 10);
    expect(sim.qaReads).toHaveLength(3);
    expect(sim.loop.task("q1")!.status).toBe("blocked");
  });

  it("scope violation blocks without repair", async () => {
    const sim = createSimulation({ worker: { sv: ["scope_violation"] } });
    await sim.create(fakeIntake({ taskId: "sv" }));
    expect(sim.loop.task("sv")!.status).toBe("blocked");
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("observed risk escalation to red pauses for approval instead of pushing", async () => {
    const sim = createSimulation({ worker: { esc: ["risk_red"] } });
    await sim.create(fakeIntake({ taskId: "esc" }));
    const t = sim.loop.task("esc")!;
    expect(t.status).toBe("needs_human_approval");
    expect(t.risk).toBe("red");
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([]);
  });
});

describe("Manager Loop — trusted approval notifications", () => {
  const red = (taskId: string) => fakeIntake({ taskId, actions: [{ kind: "prod_deploy" }] });

  it("does not trust a forged approval_granted notification", async () => {
    const sim = createSimulation();
    await sim.create(red("forged"));
    await sim.send({
      type: "approval_granted",
      taskId: "forged",
      phase: "pre_execution",
    });
    expect(sim.loop.task("forged")!).toMatchObject({
      status: "needs_human_approval",
      state: "awaiting_approval",
    });
    expect(sim.workerCalls).toEqual([]);
  });

  it("rejects another task, stale binding, wrong kind/action, and expired approvals", async () => {
    const scenarios = ["other", "stale", "wrong", "expired"] as const;
    for (const id of scenarios) {
      const sim = createSimulation();
      await sim.create(red(id));
      if (id === "other") {
        await sim.create(red("approved-other"));
        sim.approve("approved-other", "pre_execution");
      } else if (id === "stale") {
        sim.approve(id, "pre_execution", {
          bindingShaOrActionId: "start:stale-action",
        });
      } else if (id === "wrong") {
        sim.approve(id, "pre_execution", {
          kind: "execute_red_action",
          requestedAction: "different-action",
        });
      } else {
        sim.expireApproval(id, "pre_execution");
      }
      await sim.send({
        type: "approval_granted",
        taskId: id,
        phase: "pre_execution",
      });
      expect(sim.loop.task(id)!.status).toBe("needs_human_approval");
      expect(sim.workerCalls.filter((c) => c.taskId === id)).toEqual([]);
    }
  });

  it("allows only a valid stored approval bound to the current task contract", async () => {
    const sim = createSimulation();
    await sim.create(red("bound"));
    sim.approve("bound", "pre_execution");
    await sim.send({
      type: "approval_granted",
      taskId: "bound",
      phase: "pre_execution",
    });
    expect(sim.workerCalls.map((c) => c.taskId)).toEqual(["bound"]);
  });

  it("requires an exact commit/publish approval and consumes it for one commit only", async () => {
    const sim = createSimulation({ autoApproveCommits: false });
    let commits = 0;
    const commit = sim.ports.workspace.commitValidated;
    sim.ports.workspace.commitValidated = async (input) => {
      commits++;
      return commit(input);
    };
    await sim.create(fakeIntake({ taskId: "commit-once" }));
    expect(sim.loop.task("commit-once")).toMatchObject({
      state: "awaiting_approval",
      status: "needs_human_approval",
      approvalPhase: "commit_publish",
    });
    expect(commits).toBe(0);
    expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr"))).toEqual([]);

    sim.approve("commit-once", "commit_publish");
    await sim.send({ type: "approval_granted", taskId: "commit-once", phase: "commit_publish" });
    await sim.send({ type: "approval_granted", taskId: "commit-once", phase: "commit_publish" });
    expect(commits).toBe(1);
    expect(sim.remote.calls.filter((call) => call.startsWith("PUSH"))).toHaveLength(1);
    expect(sim.remote.calls.filter((call) => call.startsWith("CREATE pr"))).toHaveLength(1);
    expect(sim.remote.calls.some((call) => /merge|deploy|force/i.test(call))).toBe(false);
  });

  it("rejects forged, wrong-task, wrong-branch, stale-HEAD, and changed-path commit approvals", async () => {
    for (const scenario of ["forged", "task", "branch", "head", "paths"] as const) {
      const id = `commit-${scenario}`;
      const sim = createSimulation({ autoApproveCommits: false });
      await sim.create(fakeIntake({ taskId: id }));
      if (scenario === "task") sim.approve(id, "commit_publish", { taskId: "another-task" });
      else if (scenario === "branch") sim.approve(id, "commit_publish", { bindingShaOrActionId: "commit-publish:wrong-branch" });
      else if (scenario !== "forged") sim.approve(id, "commit_publish");
      if (scenario === "head" || scenario === "paths") {
        const observe = sim.ports.workspace.observeCommitState;
        sim.ports.workspace.observeCommitState = async (lease) => {
          const state = await observe(lease);
          if (!state.ok) return state;
          return scenario === "head"
            ? { ...state, headSha: sha(0xdecaf) }
            : { ...state, dirtyPaths: [...state.dirtyPaths, "server/foreign.ts"] };
        };
      }
      await sim.send({ type: "approval_granted", taskId: id, phase: "commit_publish" });
      const task = sim.loop.task(id)!;
      if (scenario === "head" || scenario === "paths") expect(task.status).toBe("blocked");
      else expect(task.status).toBe("needs_human_approval");
      expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr"))).toEqual([]);
    }
  });

  it("binds approved file contents and Git metadata: post-approval drift is stale and never committed", async () => {
    const PATH = "server/drift/index.ts";
    const scenarios: Record<string, Parameters<ReturnType<typeof createSimulation>["mutateWorkspace"]>[1]> = {
      "changed contents": { files: { [PATH]: "export const replaced = true;\n" } },
      "one byte": { files: { [PATH]: "content:server/drift/index.ts:drift-run-2" } },
      deletion: { files: { [PATH]: null } },
      rename: { files: { [PATH]: null, "server/drift/renamed.ts": "content:server/drift/index.ts:drift-run-1" } },
      "git metadata": { gitMetadataDigest: "e".repeat(64) },
    };
    for (const [name, change] of Object.entries(scenarios)) {
      const sim = createSimulation({ autoApproveCommits: false });
      await sim.create(fakeIntake({ taskId: "drift", expectedPaths: ["server/drift/"] }));
      const presented = (await createManagerApprovalRequirementReader(sim.loop).current("drift"))!;
      expect(presented.commitEvidence?.contentIdentities).toEqual([{ path: PATH, mode: "100644", blob: expect.stringMatching(/^[0-9a-f]{40}$/) }]);
      expect(JSON.stringify(presented)).not.toContain("content:server/drift");
      // The human approves exactly what was presented; afterwards the workspace drifts.
      sim.approve("drift", "commit_publish");
      sim.mutateWorkspace("drift", change);
      await sim.send({ type: "approval_granted", taskId: "drift", phase: "commit_publish" });
      expect(sim.loop.task("drift")?.status, name).toBe("blocked");
      expect(sim.commits, name).toEqual([]);
      expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr")), name).toEqual([]);
      // A repeated notification cannot revive the stale approval.
      await sim.send({ type: "approval_granted", taskId: "drift", phase: "commit_publish" });
      expect(sim.commits, name).toEqual([]);
    }
  });

  it("unchanged approved bytes commit exactly once, even with duplicate approval notifications", async () => {
    const sim = createSimulation({ autoApproveCommits: false });
    await sim.create(fakeIntake({ taskId: "stable" }));
    sim.approve("stable", "commit_publish");
    for (let i = 0; i < 3; i++) await sim.send({ type: "approval_granted", taskId: "stable", phase: "commit_publish" });
    expect(sim.commits).toEqual([{ taskId: "stable", approvalId: expect.any(String) }]);
    expect(sim.remote.calls.filter((call) => call.startsWith("PUSH"))).toHaveLength(1);
  });

  it("refuses Worker results when Git metadata changed before Manager review", async () => {
    const sim = createSimulation({ autoApproveCommits: false, holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "meta" }));
    sim.mutateWorkspace("meta", { gitMetadataDigest: "e".repeat(64) });
    sim.releaseWorker("meta");
    await sim.loop.settle();
    expect(sim.loop.task("meta")?.status).toBe("blocked");
    expect(sim.loop.task("meta")?.approvalPhase).toBeNull();
    expect(sim.commits).toEqual([]);
    expect(sim.remote.calls.filter((call) => call.startsWith("PUSH") || call.startsWith("CREATE pr"))).toEqual([]);
  });
});

describe("Manager Loop — routing, intake, and events", () => {
  it("UI task routes to Codex and completes the normal push/PR/QA flow once", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "ui1", category: "ui" }));
    await driveQa(sim, "ui1");
    const t = sim.loop.task("ui1")!;
    expect(t.worker).toBe("codex");
    expect(t.status).toBe("accepted");
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0].kind).toBe("codex");
    expect(events(sim, "ui1")).toEqual(expect.arrayContaining(["worker_selected", "codex_worker_started", "codex_worker_completed"]));
  });

  it("both adapters are executable through the same WorkerPort boundary", async () => {
    const sim = createSimulation({
      policy: { executableWorkers: ["claude", "codex"] },
    });
    expect(sim.loop.policy.executableWorkers).toEqual(["claude", "codex"]);
  });

  it("backend remains Claude-primary; allowed fallback selects Codex without duplicate execution", async () => {
    const primary = createSimulation();
    await primary.create(fakeIntake({ taskId: "backend1", category: "backend" }));
    expect(primary.workerCalls).toHaveLength(1);
    expect(primary.workerCalls[0].kind).toBe("claude");

    const fallback = createSimulation();
    await fallback.create(
      fakeIntake({
        taskId: "fallback1",
        category: "backend",
        availability: { claude: "unavailable", codex: "available" },
      }),
    );
    expect(fallback.workerCalls).toHaveLength(1);
    expect(fallback.workerCalls[0].kind).toBe("codex");
    const selected = fallback.audit.find((e) => e.event === "worker_fallback_selected")!;
    expect(selected.metadata).toMatchObject({
      worker: "codex",
      fallbackFrom: "claude",
      reasonCode: "fallback_selected",
      risk: "green",
    });
  });

  it("fallback retains the same validation, QA, and risk requirements", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake({
        taskId: "fallback-yellow",
        category: "backend",
        actions: [{ kind: "dependency_change" }, { kind: "run_tests" }],
        availability: { claude: "quota_exhausted", codex: "available" },
      }),
    );
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0]).toMatchObject({
      kind: "codex",
      requiredValidations: ["tests", "typecheck"],
      storedRiskLevel: "yellow",
    });
    expect(sim.loop.task("fallback-yellow")).toMatchObject({
      risk: "yellow",
      status: "qa_pending",
    });
    await driveQa(sim, "fallback-yellow");
    expect(sim.loop.task("fallback-yellow")).toMatchObject({
      risk: "yellow",
      status: "accepted",
    });
    expect(sim.qaReads).toHaveLength(1);
  });

  it("Codex fallback cannot bypass red pre-execution approval", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake({
        taskId: "fallback-red",
        category: "security",
        actions: [{ kind: "prod_deploy" }],
        availability: { claude: "unavailable", codex: "available" },
      }),
    );
    expect(sim.loop.task("fallback-red")).toMatchObject({
      worker: "codex",
      risk: "red",
      status: "needs_human_approval",
    });
    expect(sim.workerCalls).toEqual([]);
    sim.approve("fallback-red", "pre_execution");
    await sim.send({
      type: "approval_granted",
      taskId: "fallback-red",
      phase: "pre_execution",
    });
    expect(sim.workerCalls).toHaveLength(1);
    expect(sim.workerCalls[0].kind).toBe("codex");
  });

  it("fallback forbidden and both unavailable wait explicitly without a worker call", async () => {
    const forbidden = createSimulation();
    await forbidden.create(
      fakeIntake({
        taskId: "forbid1",
        availability: { claude: "unavailable", codex: "available" },
        allowClaudeToCodexFallback: false,
      }),
    );
    expect(forbidden.loop.task("forbid1")).toMatchObject({
      status: "queued",
      worker: null,
    });
    expect(forbidden.workerCalls).toEqual([]);
    expect(forbidden.audit.find((e) => e.event === "worker_unavailable")?.metadata).toMatchObject({ reasonCode: "fallback_forbidden" });

    const neither = createSimulation();
    await neither.create(
      fakeIntake({
        taskId: "neither1",
        availability: { claude: "misconfigured", codex: "unavailable" },
      }),
    );
    expect(neither.loop.task("neither1")).toMatchObject({
      status: "queued",
      worker: null,
    });
    expect(neither.workerCalls).toEqual([]);
  });

  it("Codex failure repairs on the same branch and assigned worker", async () => {
    const sim = createSimulation({
      worker: { "ui-repair": ["failure", "success"] },
    });
    await sim.create(fakeIntake({ taskId: "ui-repair", category: "layout" }));
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls.every((c) => c.kind === "codex")).toBe(true);
    expect(new Set(sim.workerCalls.map((c) => c.branch)).size).toBe(1);
    expect(sim.workerCalls[1].repair).toBe(true);
  });

  it("malformed Codex results use the bounded repair policy", async () => {
    const sim = createSimulation({
      worker: { "ui-malformed": ["malformed_output", "success"] },
    });
    await sim.create(fakeIntake({ taskId: "ui-malformed", category: "css" }));
    expect(sim.loop.task("ui-malformed")).toMatchObject({
      worker: "codex",
      repair: { attempt: 1 },
    });
    expect(sim.workerCalls).toHaveLength(2);
    expect(sim.workerCalls.every((c) => c.kind === "codex")).toBe(true);
  });

  it("Codex scope violation blocks without repair", async () => {
    const sim = createSimulation({
      worker: { "ui-scope": ["scope_violation"] },
    });
    await sim.create(fakeIntake({ taskId: "ui-scope", category: "ui" }));
    expect(sim.loop.task("ui-scope")).toMatchObject({
      worker: "codex",
      status: "blocked",
    });
    expect(sim.workerCalls).toHaveLength(1);
  });

  it("Codex HEAD mismatch fails closed and is never accepted as evidence", async () => {
    const sim = createSimulation({
      worker: { "ui-head": ["head_mismatch"] },
      policy: { maxRepairAttempts: 0 },
    });
    await sim.create(fakeIntake({ taskId: "ui-head", category: "layout" }));
    expect(sim.loop.task("ui-head")).toMatchObject({
      worker: "codex",
      status: "blocked",
    });
    expect(sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([]);
  });

  it("no eligible worker keeps the task queued", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake({
        taskId: "nw",
        availability: { claude: "quota_exhausted", codex: "unavailable" },
      }),
    );
    expect(sim.loop.task("nw")!).toMatchObject({
      status: "queued",
      queueReason: "no eligible worker routed",
    });
  });

  it("rejects invalid, duplicate, and self-dependent intakes", async () => {
    const sim = createSimulation();
    await sim.create(fakeIntake({ taskId: "ok1" }));
    await sim.create(fakeIntake({ taskId: "ok1" }));
    await sim.create(fakeIntake({ taskId: "self" }, { dependsOn: ["self"] }));
    await sim.create(fakeIntake({ taskId: "Bad_ID" }));
    expect(sim.loop.rejectedIntakes().map((r) => r.reason)).toEqual(["duplicate task id", "task depends on itself", "invalid task id"]);
  });

  it("forged worker notifications are ignored", async () => {
    const sim = createSimulation({ holdWorkers: true });
    await sim.create(fakeIntake({ taskId: "fw" }));
    await sim.send({
      type: "worker_completed",
      taskId: "fw",
      runId: "fw-run-99",
    });
    expect(sim.loop.task("fw")!.status).toBe("running");
    await sim.send({ type: "qa_updated", taskId: "fw" });
    expect(sim.qaReads).toEqual([]);
  });

  it("audit metadata is sanitized and carries no code, prompts or logs", async () => {
    const sim = createSimulation();
    await sim.create(
      fakeIntake(
        { taskId: "au" },
        {
          objective: "SECRET_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 do it",
        },
      ),
    );
    await driveQa(sim, "au");
    const dump = JSON.stringify(sim.audit);
    expect(dump).not.toContain("ghp_");
    expect(dump).not.toContain("do it");
    const orch = sim.audit.filter((e) => (e.metadata as Record<string, unknown>)?.layer === "orchestration");
    for (const e of orch) {
      expect(Object.keys(e.metadata as object).sort()).toEqual(["activatedCapabilities", "attempt", "branch", "dependencyIds", "fallbackFrom", "headSha", "layer", "outcome", "priority", "queueReason", "reasonCode", "risk", "taskId", "worker"].sort());
    }
  });

  it("is deterministic: same inputs give the same audit trail", async () => {
    const run = async () => {
      const sim = createSimulation({
        worker: { d1: ["failure", "success"] },
        ci: { d2: ["fail", "pass"] },
      });
      sim.loop.post({
        type: "task_created",
        task: fakeIntake({ taskId: "d1" }),
      });
      sim.loop.post({
        type: "task_created",
        task: fakeIntake({ taskId: "d2" }),
      });
      await sim.loop.settle();
      await driveQa(sim, "d1");
      await driveQa(sim, "d2");
      await driveQa(sim, "d2");
      return { audit: sim.audit, tasks: sim.loop.tasks() };
    };
    expect(await run()).toEqual(await run());
  });
});
