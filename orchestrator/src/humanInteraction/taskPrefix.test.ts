import { describe, expect, it } from "vitest";
import type { GatewayTaskStatus } from "../gateway/types";
import type { OwnerQuestionInput, ReadOnlyInspector } from "../planning/ownerQuestion";
import { createReadOnlyInspector } from "../planning/ownerQuestion";
import type { IntentPlanner, IntentPlannerInput } from "../planning/types";
import { createSimulation, driveQa, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { parseUpdate } from "../telegram/updates";
import { progressMessage } from "../executive/communication";
import { createHumanInteractionHarness } from "./fake";
import { plainPhase, terminalFollowUp, terminalReason } from "./service";
import { parseTaskCommand } from "./taskPrefix";
import type { StartApprovalNotice } from "./types";

/**
 * Formal-task gate: only 「任務：」/「任務:」 creates a task. Everything else is
 * Manager conversation — status answers, read-only lookups without a task, and
 * a polite refusal (never execution) for change requests without the prefix.
 */

function scriptedPlanner(script: Record<string, (input: IntentPlannerInput) => unknown>): IntentPlanner & { calls: IntentPlannerInput[] } {
  const calls: IntentPlannerInput[] = [];
  return {
    calls,
    async interpret(input) {
      calls.push(structuredClone(input));
      const f = script[input.message];
      if (!f) throw new Error(`no script for ${input.message}`);
      return f(input);
    },
  };
}

const change = (title: string, extra: Record<string, unknown> = {}) => () => ({
  intent: "change_code",
  taskId: null,
  title,
  interpretedObjective: `Change: ${title}`,
  criteria: ["The owner sees the requested change on the page"],
  clarificationQuestion: "",
  ...extra,
});
const ask = (title: string) => () => ({
  intent: "investigate_or_answer",
  taskId: null,
  title,
  interpretedObjective: `Answer: ${title}. No files will be changed.`,
  criteria: ["The owner's question is answered from the source"],
  clarificationQuestion: "",
});
const other = (intent: string, taskId: string | null = null) => () => ({ intent, taskId, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "" });

function recordingInspector(answer: string): ReadOnlyInspector & { calls: Omit<OwnerQuestionInput, "sourceEvidence">[] } {
  const calls: Omit<OwnerQuestionInput, "sourceEvidence">[] = [];
  return {
    calls,
    async inspect(input) {
      calls.push(structuredClone(input));
      return { ownerAnswer: answer };
    },
  };
}

function setup(planner: IntentPlanner, opts: { inspector?: ReadOnlyInspector; worker?: Record<string, readonly WorkerScript[]> } = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, worker: opts.worker });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "p", ...(opts.inspector ? { inspector: opts.inspector } : {}) });
  const say = async (key: string, text: string, replyTo: string | null = null) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: replyTo, text });
    await sim.loop.settle();
    return r;
  };
  /** No task, no Worker run, no branch, no push, no commit. */
  const untouched = () => {
    expect(sim.loop.tasks()).toHaveLength(0);
    expect(sim.workerCalls).toHaveLength(0);
    expect(Array.from(sim.remote.refs.keys())).toEqual(["main"]);
    expect(sim.remote.calls.filter((c) => /PUSH|CREATE/i.test(c))).toEqual([]);
    expect(sim.commits).toHaveLength(0);
  };
  return { sim, say, untouched, ...h };
}

describe("parseTaskCommand", () => {
  it("accepts 任務: and 任務： with surrounding whitespace and strips the prefix", () => {
    expect(parseTaskCommand("任務：修改首頁")).toEqual({ kind: "task", body: "修改首頁" });
    expect(parseTaskCommand("任務: 修改首頁")).toEqual({ kind: "task", body: "修改首頁" });
    expect(parseTaskCommand("  任務 ：  幫我修改首頁 CTA  ")).toEqual({ kind: "task", body: "幫我修改首頁 CTA" });
    expect(parseTaskCommand("任務：\n第一行\n第二行")).toEqual({ kind: "task", body: "第一行\n第二行" });
  });
  it("anything else is conversation; an empty prefix is not a task", () => {
    for (const t of ["你覺得這樣合理嗎？", "那就改吧", "這個任務：做完了嗎", "我的任務：", "任務 做完了嗎", "/goal x"]) expect(parseTaskCommand(t)).toEqual({ kind: "conversation" });
    expect(parseTaskCommand("任務：   ")).toEqual({ kind: "empty" });
  });
});

describe("formal task intake requires 「任務：」", () => {
  it("A. 「任務：修改首頁」 creates a task (planner sees requireTask)", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁") });
    const h = setup(planner);
    const r = await h.say("tg.msg.1", "任務：修改首頁");
    expect(r.outcome).toBe("submitted");
    expect(h.sim.loop.tasks()).toHaveLength(1);
    expect(planner.calls[0]).toMatchObject({ message: "修改首頁", requireTask: true });
  });

  it("B. 「任務: 修改首頁」 (half-width colon) creates a task", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁") });
    const h = setup(planner);
    expect((await h.say("tg.msg.1", "任務: 修改首頁")).outcome).toBe("submitted");
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("H. the prefix is removed before the planner, intake and Worker see the text", async () => {
    const planner = scriptedPlanner({ "幫我修改首頁 CTA": change("修改首頁 CTA") });
    const h = setup(planner);
    expect((await h.say("tg.msg.1", "  任務 ：  幫我修改首頁 CTA")).outcome).toBe("submitted");
    expect(planner.calls.map((c) => c.message)).toEqual(["幫我修改首頁 CTA"]);
    expect(h.sim.workerCalls).toHaveLength(1);
    const contract = JSON.stringify(h.sim.workerCalls[0]);
    expect(contract).toContain("幫我修改首頁 CTA");
    expect(contract).not.toMatch(/任務\s*[:：]/);
  });

  it("an empty 「任務：」 creates nothing and never calls the planner", async () => {
    const planner = scriptedPlanner({});
    const h = setup(planner);
    const r = await h.say("tg.msg.1", "任務：");
    expect(r.outcome).toBe("invalid");
    expect(r.message).toContain("任務：");
    expect(planner.calls).toHaveLength(0);
    h.untouched();
  });
});

describe("Manager conversation without the prefix", () => {
  it("C/L. 「你覺得這樣合理嗎？」 is answered by the Manager: no task, no branch, no Worker", async () => {
    const planner = scriptedPlanner({ "你覺得這樣合理嗎？": ask("評估目前做法") });
    const inspector = recordingInspector("我覺得合理，理由是 client/src/pages/Home.tsx 已經集中處理搜尋。");
    const h = setup(planner, { inspector });
    const r = await h.say("tg.msg.1", "你覺得這樣合理嗎？");
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("我覺得合理");
    expect(r.message).toContain("沒有建立任務，也沒有修改任何檔案");
    expect(planner.calls[0]).toMatchObject({ requireTask: false });
    expect(inspector.calls).toHaveLength(1);
    h.untouched();
  });

  it("D. 「現在進度如何？」 reports task state and creates nothing new", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), "現在進度如何？": other("status_query") });
    const h = setup(planner);
    await h.say("tg.msg.1", "任務：修改首頁");
    const before = h.sim.loop.tasks().length;
    const r = await h.say("tg.msg.2", "現在進度如何？");
    expect(r.outcome).toBe("info");
    expect(r.message).toMatch(/目前進行中的任務（1）/);
    expect(r.message).toContain("任務暫停，正在等待你的決定（請按批准或拒絕）");
    expect(h.sim.loop.tasks()).toHaveLength(before);
    expect(h.sim.workerCalls).toHaveLength(1);
  });

  it("6/7. 「所以剛剛為什麼停止？」 about the latest task answers its state (cancelled), never a new task", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), "所以剛剛為什麼停止？": other("task_follow_up", "p-task-1") });
    const h = setup(planner);
    await h.say("tg.msg.1", "任務：修改首頁");
    h.sim.loop.cancel("p-task-1");
    await h.sim.loop.settle();
    const r = await h.say("tg.msg.2", "所以剛剛為什麼停止？");
    expect(r).toMatchObject({ outcome: "info", taskId: "p-task-1" });
    expect(r.message).toContain("目前進度：任務已取消");
    expect(r.message).not.toContain("已停止");
    expect(h.sim.loop.tasks()).toHaveLength(1);
    expect(planner.calls[1].tasks.map((t) => t.taskId)).toEqual(["p-task-1"]);
  });

  it("E. 「幫我查首頁搜尋框文字」 runs a read-only lookup with no engineering task", async () => {
    const planner = scriptedPlanner({ 幫我查首頁搜尋框文字: ask("首頁搜尋框文字") });
    const inspector = recordingInspector("首頁搜尋框的提示文字是「搜尋工廠」（client/src/pages/Home.tsx）。");
    const h = setup(planner, { inspector });
    const r = await h.say("tg.msg.1", "幫我查首頁搜尋框文字");
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("搜尋工廠");
    expect(inspector.calls[0]).toMatchObject({ question: "幫我查首頁搜尋框文字", intent: "investigate_or_answer" });
    h.untouched();
  });

  it("E. read-only lookup evidence comes only from read ports (no write capability)", async () => {
    const reads: string[] = [];
    let seen: OwnerQuestionInput | null = null;
    const inspector = createReadOnlyInspector(
      {
        async answer(input) {
          seen = input;
          return { ownerAnswer: "ok" };
        },
      },
      {
        read: (p) => (reads.push(p), p === "client/src/pages/Home.tsx" ? 'placeholder="搜尋工廠"' : null),
        listFiles: async () => ["client/src/pages/Home.tsx", "server/db.ts"],
        searchContent: async () => ["client/src/pages/Home.tsx"],
      },
    );
    await inspector.inspect({ question: "首頁 Home.tsx 搜尋框 placeholder 文字是什麼", intent: "investigate_or_answer", interpretedObjective: "Find the Home.tsx placeholder", tasks: [] });
    expect(reads).toContain("client/src/pages/Home.tsx");
    expect(seen!.sourceEvidence.map((e) => e.path)).toContain("client/src/pages/Home.tsx");
  });

  it("F. a read-only lookup that finds a bug only reports it; nothing is fixed", async () => {
    const planner = scriptedPlanner({ 幫我看看搜尋邏輯有沒有問題: ask("檢查搜尋邏輯") });
    const inspector = recordingInspector("server/db.ts 的 searchFactories 沒有過濾 rejected 工廠，這是 bug。建議修正，但我沒有修改任何檔案；要修正請用「任務：」下達。");
    const h = setup(planner, { inspector });
    const r = await h.say("tg.msg.1", "幫我看看搜尋邏輯有沒有問題");
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("這是 bug");
    h.untouched();
  });

  it("G. 「那就改吧」 without the prefix is never executed; the owner is told to use 「任務：」", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), "那就改吧": change("修改首頁搜尋框") });
    const inspector = recordingInspector("unused");
    const h = setup(planner, { inspector });
    const r = await h.say("tg.msg.1", "那就改吧");
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("如果要正式執行，請用「任務：…」下達");
    expect(r.message).toContain("沒有建立任務，也沒有修改任何檔案");
    expect(inspector.calls).toHaveLength(0);
    h.untouched();
  });

  it("G/7. after a formal task, 「那就照你剛剛說的做」 still creates no second task", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), 那就照你剛剛說的做: change("照 Manager 建議修改") });
    const h = setup(planner);
    await h.say("tg.msg.1", "任務：修改首頁");
    const workerRuns = h.sim.workerCalls.length;
    const r = await h.say("tg.msg.2", "那就照你剛剛說的做");
    expect(r.message).toContain("「任務：…」");
    expect(h.sim.loop.tasks()).toHaveLength(1);
    expect(h.sim.workerCalls).toHaveLength(workerRuns);
  });

  it("read-only inspection unavailable: fails closed with no task and no change", async () => {
    const planner = scriptedPlanner({ 幫我查首頁搜尋框文字: ask("首頁搜尋框文字") });
    const h = setup(planner); // no inspector configured
    const r = await h.say("tg.msg.1", "幫我查首頁搜尋框文字");
    expect(r.outcome).toBe("info");
    expect(r.message).toContain("沒有建立任務，也沒有修改任何檔案");
    h.untouched();
  });

  it("the Gateway refuses to answer a change interpretation without a task (defence in depth)", async () => {
    const planner = scriptedPlanner({ 那就改吧: change("修改首頁") });
    const inspector = recordingInspector("unused");
    const h = setup(planner, { inspector });
    const call = <T>(request: T) => ({ authentication: h.owner.authentication(), request });
    const view = await h.gateway.interpretOwnerMessage(call({ idempotencyKey: "direct.1", text: "那就改吧", contextTaskId: null, requireTask: false }));
    await expect(h.gateway.answerOwnerQuestion(call({ interpretationId: view.interpretationId }))).rejects.toMatchObject({ code: "conflict" });
    expect(inspector.calls).toHaveLength(0);
    h.untouched();
  });
});

describe("existing flows are unchanged", () => {
  it("I. a formal task still goes through Manager repair (first round failed -> repair -> approval)", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁") });
    const h = setup(planner, { worker: { "p-task-1": ["validation_failed", "success"] } });
    await h.say("tg.msg.1", "任務：修改首頁");
    expect(h.sim.workerCalls).toHaveLength(2);
    expect(h.sim.loop.task("p-task-1")).toMatchObject({ status: "needs_human_approval", approvalPhase: "commit_publish" });
    expect(h.sim.commits).toHaveLength(0);
  });

  it("J. a red formal task still needs the pre-execution approval; without the prefix nothing runs at all", async () => {
    const RED = "幫我直接改 production 資料庫的會員資料 production database write update";
    const planner = scriptedPlanner({ [RED]: change("修正會員資料", { interpretedObjective: "Update member records via the production database write path." }) });
    const h = setup(planner);
    expect((await h.say("tg.msg.1", RED)).outcome).toBe("info");
    h.untouched();
    expect((await h.say("tg.msg.2", `任務：${RED}`)).outcome).toBe("submitted");
    expect(h.sim.loop.tasks()[0]).toMatchObject({ risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
    await h.service.observe();
    const start = h.transport.sent.find((s) => s.notice.kind === "start_approval")!.notice as StartApprovalNotice;
    expect(start.authorizes).toMatchObject({ merge: false, deploy: false, commit: false, push: false });
    expect(h.sim.workerCalls).toHaveLength(0);
  });

  it("a reply to a pending decision is still guidance on that task (not a new task)", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁") });
    const h = setup(planner, { worker: { "p-task-1": ["validation_failed", "validation_failed", "validation_failed", "success"] } });
    await h.say("tg.msg.1", "任務：修改首頁");
    expect(h.sim.loop.task("p-task-1")!.status).toBe("needs_human_decision");
    await h.service.observe();
    const decision = h.transport.sent.find((s) => s.notice.kind === "human_decision")!;
    const r = await h.say("tg.msg.2", "先只改手機版", decision.deliveryRef);
    expect(r.outcome).toBe("resumed");
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("K. Telegram / Wake Gateway parsing is unchanged: the prefix is passed through verbatim", () => {
    const OWNER = 42;
    const update = (text: string) => ({ update_id: 1, message: { message_id: 7, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, text } });
    for (const text of ["任務：修改首頁", "你覺得這樣合理嗎？"]) {
      const parsed = parseUpdate(update(text) as never, OWNER);
      expect(parsed).toMatchObject({ kind: "reply", inbound: { text } });
    }
  });
});

describe("human-facing task state wording", () => {
  const s = (status: GatewayTaskStatus["status"], extra: Partial<GatewayTaskStatus> = {}) => ({ status, taskState: "running", assignedWorker: "claude", prNumber: null, repairAttempt: 0, ...extra }) as GatewayTaskStatus;
  it("distinguishes completed, cancelled, failed, paused, repair, queued and validating", () => {
    expect(plainPhase(s("accepted", { taskState: "complete" }), "zh")).toBe("任務已完成");
    expect(plainPhase(s("blocked", { taskState: "cancelled" }), "zh")).toBe("任務已取消");
    expect(plainPhase(s("blocked", { taskState: "failed" }), "zh")).toBe("任務執行失敗");
    expect(plainPhase(s("blocked", { taskState: "running" }), "zh")).toBe("任務暫停，正在等待你的決定");
    expect(plainPhase(s("needs_human_approval"), "zh")).toMatch(/^任務暫停，正在等待你的決定/);
    expect(plainPhase(s("needs_human_decision"), "zh")).toMatch(/^任務暫停，正在等待你的決定/);
    expect(plainPhase(s("repair_requested", { repairAttempt: 1 }), "zh")).toBe("第一輪結果尚未通過，Claude 正在修正");
    expect(plainPhase(s("waiting_workspace"), "zh")).toBe("任務已排隊，前一個任務完成後會開始處理");
    // Worker finished, Manager still validating: the task is still "running", never "stopped".
    expect(plainPhase(s("running"), "zh")).not.toMatch(/停止/);
    for (const st of ["accepted", "blocked", "running", "repair_requested", "waiting_workspace", "needs_human_decision"] as const) expect(plainPhase(s(st), "zh")).not.toContain("已停止");
  });
  it("terminal milestones say failed or paused, never a bare 'stopped'", () => {
    expect(progressMessage("blocked", { lang: "zh" })).toMatch(/^任務執行失敗/);
    expect(progressMessage("blocked", { lang: "zh", paused: true })).toMatch(/^任務暫停，正在等待你的決定/);
    expect(progressMessage("cancelled", { lang: "zh" })).toMatch(/^任務已取消/);
  });
});

describe("follow-up about a finished task answers why it stopped (trusted reason only)", () => {
  const RAW = /git_metadata_changed|worker failure|blockingReason|errorType|[a-z]+_[a-z]+_[a-z]+/;
  const failedTask = async (questions: string[]) => {
    const script: Record<string, (input: IntentPlannerInput) => unknown> = { 修改柱狀圖人數: change("修改柱狀圖人數") };
    for (const q of questions) script[q] = other("task_follow_up", "p-task-1");
    const planner = scriptedPlanner(script);
    const h = setup(planner, { worker: { "p-task-1": ["git_metadata_changed"] } });
    await h.say("tg.msg.1", "任務：修改柱狀圖人數");
    expect(h.sim.loop.task("p-task-1")).toMatchObject({ state: "failed", blockingReason: "worker failure: git_metadata_changed" });
    return { h, planner };
  };

  it("1/5/6. failed task + 「為何已停止」 explains the Git-safety stop in plain words; no new task, no raw code", async () => {
    const { h, planner } = await failedTask(["為何已停止", "為什麼已停止"]);
    const tasks = h.sim.loop.tasks().length;
    const runs = h.sim.workerCalls.length;
    for (const [i, q] of ["為何已停止", "為什麼已停止"].entries()) {
      const r = await h.say(`tg.msg.${i + 2}`, q);
      expect(r).toMatchObject({ outcome: "info", taskId: "p-task-1" });
      const [lead] = r.message.split("\n\n");
      expect(lead).toBe("這筆任務沒有完成。原因：系統偵測到 Git 狀態在 Claude 執行期間發生異常變更，為安全起見自動停止，沒有接受 Claude 的修改結果。");
      expect(lead).not.toMatch(RAW);
      expect(r.message).not.toMatch(/git_metadata_changed|worker failure/);
      expect(r.message).toContain("目前進度：任務執行失敗"); // the status card still follows
    }
    expect(h.sim.loop.tasks()).toHaveLength(tasks);
    expect(h.sim.workerCalls).toHaveLength(runs);
    expect(planner.calls.slice(1).every((c) => c.requireTask === false)).toBe(true);
  });

  it("2. failed task + 「請問有修改完成嗎」 says clearly it was not completed, with the reason", async () => {
    const { h } = await failedTask(["請問有修改完成嗎"]);
    const r = await h.say("tg.msg.2", "請問有修改完成嗎");
    expect(r.message).toMatch(/^這筆任務沒有完成。原因：系統偵測到 Git 狀態/);
    expect(r.message).not.toMatch(/已完成/);
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("3. successful task + 「有完成嗎」 answers completed", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), 有完成嗎: other("task_follow_up", "p-task-1") });
    const h = setup(planner);
    await h.say("tg.msg.1", "任務：修改首頁");
    await driveQa(h.sim, "p-task-1");
    await h.sim.loop.settle();
    expect(h.sim.loop.task("p-task-1")?.state).toBe("complete");
    const r = await h.say("tg.msg.2", "有完成嗎");
    expect(r.message).toMatch(/^這筆任務已完成。\n\n/);
    expect(r.message).not.toMatch(/沒有完成|原因/);
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("a task still in progress keeps the plain status card (no invented outcome)", async () => {
    const planner = scriptedPlanner({ 修改首頁: change("修改首頁"), 做完了嗎: other("task_follow_up", "p-task-1") });
    const h = setup(planner);
    await h.say("tg.msg.1", "任務：修改首頁");
    const r = await h.say("tg.msg.2", "做完了嗎");
    expect(r.message).toMatch(/^任務：修改首頁\n目前進度：任務暫停，正在等待你的決定/);
    expect(r.message).not.toMatch(/已完成|沒有完成/);
  });

  it("4. no trusted terminal reason: says the record is insufficient and never guesses", () => {
    const base = { status: "blocked", taskState: "failed", assignedWorker: "codex" } as unknown as GatewayTaskStatus;
    for (const waitReason of [null, "", "[REDACTED]", "something entirely new happened", "worker failure: git_metadata_changed; extra", "manager: unclear"]) {
      const s = { ...base, waitReason };
      expect(terminalReason(s, "zh")).toBeNull();
      const text = terminalFollowUp(s, "zh")!;
      expect(text).toBe("這筆任務沒有完成，已停止執行。目前的紀錄不足以說明確切的停止原因，我不會用猜測回答。");
      expect(text).not.toMatch(/Git|額度|登入|環境/);
    }
  });

  it("infrastructure / quota / auth reasons are translated, never shown raw", () => {
    const s = (waitReason: string) => ({ status: "blocked", taskState: "failed", assignedWorker: "codex", waitReason }) as unknown as GatewayTaskStatus;
    expect(terminalReason(s("worker failure: quota_exhausted"), "zh")).toBe("Codex 的使用額度用完，無法繼續執行");
    expect(terminalReason(s("worker failure: authentication_unavailable"), "zh")).toBe("Codex 的登入授權失效，無法繼續執行");
    expect(terminalReason(s("worker failure: service_unavailable"), "zh")).toBe("Codex 的執行環境無法使用，任務無法繼續");
    expect(terminalReason(s("codespace stopped unexpectedly while worker was running"), "zh")).toBe("Codex 的執行環境無法使用，任務無法繼續");
    expect(terminalReason(s("worker failure: git_metadata_changed"), "en")).toMatch(/^the system detected an unexpected Git state change while Codex/);
    for (const r of ["worker failure: quota_exhausted", "worker failure: authentication_unavailable", "worker failure: git_metadata_changed", "push failed: x", "orchestration persistence failed"])
      expect(terminalFollowUp(s(r), "zh")).not.toMatch(RAW);
    // not terminal: no follow-up lead
    expect(terminalFollowUp({ ...s("x"), status: "running", taskState: "running" } as GatewayTaskStatus, "zh")).toBeNull();
    expect(terminalFollowUp({ ...s("needs_human_decision: x"), taskState: "awaiting_approval" } as GatewayTaskStatus, "zh")).toBeNull();
  });
});
