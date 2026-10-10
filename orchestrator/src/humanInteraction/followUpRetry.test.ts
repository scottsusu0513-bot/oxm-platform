import { describe, expect, it } from "vitest";
import { assessRetry } from "../gateway/retry";
import type { GatewayTaskStatus } from "../gateway/types";
import { normalizeIntentDecision } from "../planning/normalize";
import { INTENT_SCHEMA, PLANNER_SYSTEM } from "../planning/planners";
import type { IntentPlanner, IntentPlannerInput } from "../planning/types";
import { createSimulation, driveQa, sha, type WorkerScript } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { createHumanInteractionHarness } from "./fake";
import { composeFollowUp } from "./followUp";

/**
 * Manager follow-up conversation about a known task, and the structured re-run action.
 *
 * Owner wording is interpreted ONLY by the (scripted) GPT Manager: every test maps owner text to the
 * structured interpretation a Manager would return. The service and Gateway never parse the text, so
 * different wordings with the same interpretation must behave identically, and the same wording with a
 * different interpretation must behave differently. Facts come from trusted state only.
 */

const BASE = { branch: "agent/gpt-manager-live-e2e", sha: sha(0x8581569) };
const RAW = /git_metadata_changed|worker failure|blockingReason|errorType|retry_task|task_follow_up/;

type Script = Record<string, (input: IntentPlannerInput) => unknown>;
function scriptedPlanner(script: Script): IntentPlanner & { calls: IntentPlannerInput[] } {
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
const empty = { title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "", followUpTopics: [] as string[] };
const change = (title: string) => () => ({
  ...empty,
  intent: "change_code",
  taskId: null,
  title,
  interpretedObjective: `在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數：${title}`,
  criteria: ["管理員在柱狀圖下方看到每小時瀏覽人數", "數字與柱狀圖的資料一致"],
});
/** The Manager's reading of a follow-up: which task, and every aspect asked about. */
const follow = (topics: string[], taskId: string | ((i: IntentPlannerInput) => string) = "p-task-1") => (i: IntentPlannerInput) => ({
  ...empty,
  intent: "task_follow_up",
  taskId: typeof taskId === "string" ? taskId : taskId(i),
  followUpTopics: topics,
});
/** The Manager's reading of an explicit re-run request. */
const rerun = (taskId: string | ((i: IntentPlannerInput) => string) = "p-task-1") => (i: IntentPlannerInput) => ({ ...empty, intent: "retry_task", taskId: typeof taskId === "string" ? taskId : taskId(i) });
/** Resolve "the task we are talking about" from the conversation context, as the Manager does. */
const fromContext = (i: IntentPlannerInput) => i.contextTaskId ?? "none";

function setup(script: Script, worker: Record<string, readonly WorkerScript[]> = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-09T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, worker, runtimeBaseline: BASE });
  const planner = scriptedPlanner(script);
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "p" });
  let n = 0;
  const say = async (text: string, key = `tg.msg.${++n}`) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text });
    await sim.loop.settle();
    return r;
  };
  return { sim, planner, say, ...h };
}

/** The live case: a change task stopped by the Git metadata safety check. */
async function stoppedBySafetyCheck(script: Script, worker: Record<string, readonly WorkerScript[]> = {}) {
  const h = setup({ 修改柱狀圖人數: change("在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數"), ...script }, { "p-task-1": ["git_metadata_changed"], ...worker });
  await h.say("任務：修改柱狀圖人數");
  expect(h.sim.loop.task("p-task-1")).toMatchObject({ state: "failed", blockingReason: "worker failure: git_metadata_changed" });
  return h;
}

describe("Manager follow-up conversation (semantic topics → one integrated, trusted answer)", () => {
  it("1. failed task + reason question → plain reason, no status card stacked on it", async () => {
    const h = await stoppedBySafetyCheck({ 為什麼停止: follow(["reason"]) });
    const r = await h.say("為什麼停止");
    expect(r).toMatchObject({ outcome: "info", taskId: "p-task-1" });
    expect(r.message).toBe("「在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數」沒有完成。原因：系統偵測到 Git 狀態在 Claude 執行期間發生異常變更，為安全起見自動停止，沒有接受 Claude 的修改結果。");
    expect(r.message).not.toMatch(/目前進度|負責：|編號：/);
    expect(r.message).not.toMatch(RAW);
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("2. failed task + remediation question → what can be done (new task from the original request), nothing created", async () => {
    const h = await stoppedBySafetyCheck({ 那怎麼處理: follow(["remediation"]) });
    const r = await h.say("那怎麼處理");
    expect(r.message).toContain("原因：系統偵測到 Git 狀態");
    expect(r.message).toContain("這是安全檢查造成的停止");
    expect(r.message).toContain("原本的任務不會直接恢復");
    expect(r.message).toContain("建立一筆新任務，從目前最新的程式版本重新執行");
    expect(r.message).not.toMatch(/^可以重新執行/); // a remediation question gets no yes/no verdict it did not ask for
    expect(h.sim.loop.tasks()).toHaveLength(1);
    expect(h.sim.workerCalls).toHaveLength(1);
  });

  it("3. failed task + retry-eligibility question → answers yes (deterministic policy), creates nothing", async () => {
    const h = await stoppedBySafetyCheck({ 可以重新執行嗎: follow(["retry_eligibility"]) });
    const r = await h.say("可以重新執行嗎");
    expect(r.message).toMatch(/^可以重新執行。「在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數」沒有完成。原因：/);
    expect(r.message).toContain("直接跟我說一聲就可以，不用重貼需求或任務編號");
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("5. live combined question → remediation + eligibility in ONE answer; the next 「重跑」 creates the re-run", async () => {
    const h = await stoppedBySafetyCheck({
      "那怎麼處理，可以重新執行嗎": follow(["remediation", "retry_eligibility"], fromContext),
      "好，那重跑": rerun(fromContext),
    });
    // The owner never names the task: the conversation context carries it.
    const r = await h.say("那怎麼處理，可以重新執行嗎");
    expect(h.planner.calls.at(-1)!.contextTaskId).toBe("p-task-1");
    expect(r.taskId).toBe("p-task-1");
    expect(r.message).toMatch(/^可以重新執行。/);
    expect(r.message).toContain("Git 狀態");
    expect(r.message).toContain("原本的任務不會直接恢復");
    expect(r.message).not.toMatch(/目前進度|編號：/);
    expect(r.message).not.toMatch(RAW);
    expect(h.sim.loop.tasks()).toHaveLength(1); // a question never acts

    const go = await h.say("好，那重跑");
    expect(h.planner.calls.at(-1)!.contextTaskId).toBe("p-task-1");
    expect(go).toMatchObject({ outcome: "submitted", taskId: "p-task-2" });
    expect(go.message).toMatch(/^好，已依照原本的需求重新建立一筆新任務：「在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數」。/);
    expect(h.sim.loop.task("p-task-1")!.state).toBe("failed"); // never resurrected
    expect(h.sim.loop.task("p-task-2")!.retryOf).toBe("p-task-1");
  });

  it("4/10/11. explicit re-run → NEW task with the original goal, criteria, scope and lineage, on the latest baseline and a clean branch", async () => {
    const h = await stoppedBySafetyCheck({ 重新執行: rerun() });
    const original = h.sim.loop.intakeOf("p-task-1")!;
    const r = await h.say("重新執行");
    expect(r).toMatchObject({ outcome: "submitted", taskId: "p-task-2" });
    const retry = h.sim.loop.intakeOf("p-task-2")!;
    expect(retry.retryOf).toBe("p-task-1");
    expect(retry.goal).toEqual(original.goal);
    expect(retry.objective).toBe(original.objective);
    expect(retry.title).toBe(original.title);
    expect(retry.acceptanceCriteria).toEqual(original.acceptanceCriteria);
    expect(retry.expectedPaths).toEqual(original.expectedPaths);
    expect(retry.requiredValidations).toEqual(original.requiredValidations);
    expect(retry.category).toBe(original.category);
    // Routing / risk are recomputed by normal intake on the same trusted input: never lower.
    expect(retry.classification.risk.level).toBe(original.classification.risk.level);
    expect(retry.routing.worker).toBe(original.routing.worker);
    // Fresh branch from the CURRENT runtime baseline; nothing of the failed run's workspace is carried over.
    const [first, second] = h.sim.workerCalls;
    expect(second.taskId).toBe("p-task-2");
    expect(second.branch).not.toBe(first.branch);
    expect(second.expectedHeadSha).toBe(BASE.sha);
    expect(second.repair).toBe(false);
    expect(second.allowedDirtyPaths).toEqual([]);
    // The re-run still stops at the trusted commit/publish approval: nothing was committed or pushed.
    expect(h.sim.loop.task("p-task-2")!.status).toBe("needs_human_approval");
    expect(h.sim.commits).toHaveLength(0);
    expect(h.sim.remote.calls.filter((c) => c.startsWith("PUSH"))).toEqual([]);
    // Lineage is visible to the Manager in later turns.
    await h.say("重新執行", "tg.msg.99").catch(() => null);
    expect(h.planner.calls.at(-1)!.tasks.find((t) => t.taskId === "p-task-2")).toMatchObject({ retryOf: "p-task-1" });
  });

  it("6. successful task + 「再跑一次」 → a re-run (new task, same goal), never a repair of the original", async () => {
    const h = setup({ 修改首頁: change("修改首頁"), 再跑一次: rerun() });
    await h.say("任務：修改首頁");
    await driveQa(h.sim, "p-task-1");
    await h.sim.loop.settle();
    expect(h.sim.loop.task("p-task-1")!.status).toBe("accepted");
    const r = await h.say("再跑一次");
    expect(r).toMatchObject({ outcome: "submitted", taskId: "p-task-2" });
    expect(h.sim.loop.task("p-task-1")!.status).toBe("accepted");
    expect(h.sim.loop.task("p-task-1")!.repair.attempt).toBe(0);
    expect(h.sim.workerCalls.filter((c) => c.taskId === "p-task-1")).toHaveLength(1);
    expect(h.sim.workerCalls.find((c) => c.taskId === "p-task-2")).toMatchObject({ repair: false });
  });

  it("7. active task + 「再跑一次」 → refused, no concurrent duplicate; a second re-run while one is active is refused too", async () => {
    const h = setup({ 修改首頁: change("修改首頁"), 再跑一次: rerun(), 再一次: rerun(), 原本那筆再來: rerun("p-task-1") }, { "p-task-1": ["git_metadata_changed"] });
    const active = setup({ 修改首頁: change("修改首頁"), 再跑一次: rerun() });
    await active.say("任務：修改首頁");
    expect(active.sim.loop.task("p-task-1")!.status).toBe("needs_human_approval");
    const busy = await active.say("再跑一次");
    expect(busy.message).toMatch(/還沒結束.*沒有重新建立任務/);
    expect(busy.message).toContain("（這次沒有建立任何新任務。）");
    expect(active.sim.loop.tasks()).toHaveLength(1);

    await h.say("任務：修改首頁");
    expect((await h.say("再跑一次")).taskId).toBe("p-task-2");
    expect(h.sim.loop.task("p-task-2")!.status).not.toBe("accepted");
    // Same original while its re-run is still active: refused, never a second concurrent re-run.
    const again = await h.say("原本那筆再來");
    expect(again.message).toContain("已經有一筆依原需求重新執行的任務在進行中");
    expect(h.sim.loop.tasks()).toHaveLength(2);
    // Redelivery of the SAME message is the same re-run (idempotent), not a refusal and not a new task.
    const dup = await h.say("再跑一次", "tg.msg.2");
    expect(dup).toMatchObject({ outcome: "duplicate" });
    expect(h.sim.loop.tasks()).toHaveLength(2);
  });

  it("9. Worker sign-in unavailable: a re-run is never claimed to work now", async () => {
    const h = setup({ 修改首頁: change("修改首頁"), 可以重跑嗎: follow(["retry_eligibility", "remediation"]), 重跑: rerun() }, { "p-task-1": ["auth_unavailable"] });
    await h.say("任務：修改首頁");
    expect(h.sim.loop.task("p-task-1")!.status).toBe("waiting_worker_availability");
    const r = await h.say("可以重跑嗎");
    expect(r.message).toMatch(/^不需要重新執行。/);
    expect(r.message).toContain("進度已保存");
    expect(r.message).not.toContain("可以重新執行");
    expect((await h.say("重跑")).message).toContain("沒有重新建立任務");
    expect(h.sim.loop.tasks()).toHaveLength(1);
  });

  it("12/13. pure status question keeps the status card; follow-ups never ask for the task id or the request again", async () => {
    const h = await stoppedBySafetyCheck({ 現在做到哪: follow(["status"], fromContext), 為什麼停了: follow(["reason"], fromContext) });
    await h.say("為什麼停了");
    const r = await h.say("現在做到哪");
    expect(h.planner.calls.at(-1)!.contextTaskId).toBe("p-task-1");
    expect(r.message).toMatch(/^任務：在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數\n目前進度：任務執行失敗/);
    for (const m of [r.message]) expect(m).not.toMatch(/請(給我|提供|重貼).*(編號|需求)|\/status/);
  });

  it("H. lineage conversation: why → what now → can it re-run → re-run → where is it now (follows the re-run)", async () => {
    const h = await stoppedBySafetyCheck({
      為什麼停了: follow(["reason"], fromContext),
      那怎麼辦: follow(["remediation"], fromContext),
      可以重跑嗎: follow(["retry_eligibility"], fromContext),
      "好，重跑": rerun(fromContext),
      現在做到哪: follow(["status"], fromContext),
    });
    expect((await h.say("為什麼停了")).taskId).toBe("p-task-1");
    expect((await h.say("那怎麼辦")).taskId).toBe("p-task-1");
    expect((await h.say("可以重跑嗎")).message).toMatch(/^可以重新執行。/);
    expect((await h.say("好，重跑")).taskId).toBe("p-task-2");
    const now = await h.say("現在做到哪");
    expect(h.planner.calls.at(-1)!.contextTaskId).toBe("p-task-2");
    expect(now.taskId).toBe("p-task-2");
    expect(now.message).toMatch(/^任務：在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數\n目前進度：/);
    expect(h.sim.loop.tasks()).toHaveLength(2);
  });

  it("14. reason / remediation / retry follow-ups each produce exactly one owner message (one InboundResult)", async () => {
    const h = await stoppedBySafetyCheck({ a: follow(["reason"]), b: follow(["remediation"]), c: follow(["retry_eligibility"]), d: follow(["remediation", "retry_eligibility", "status"]) });
    for (const q of ["a", "b", "c", "d"]) {
      const r = await h.say(q);
      expect(typeof r.message).toBe("string");
      expect(r.message.match(/「在管理員全站流量柱狀圖下方直接顯示每小時瀏覽人數」/g)).toHaveLength(1); // stated once, not card + answer
      expect(r.message).not.toMatch(/\n目前進度：/);
    }
  });

  it("15/16. different and unseen wordings with the same Manager reading behave identically; the text itself is never parsed", async () => {
    const wordings = ["那怎麼處理，可以重新執行嗎", "這要怎麼辦？還能再跑嗎", "嗯…那這個後續呢，有辦法重來嗎", "後續要怎麼走", "🤔"];
    const h = await stoppedBySafetyCheck(Object.fromEntries([...wordings, "what now — can it be re-run?"].map((w) => [w, follow(["remediation", "retry_eligibility"], fromContext)])));
    const answers = new Set<string>();
    for (const w of wordings) answers.add((await h.say(w)).message);
    expect(answers.size).toBe(1);
    expect([...answers][0]).toMatch(/^可以重新執行。/);
    // The same reading in English: the same answer, in the owner's language.
    expect((await h.say("what now — can it be re-run?")).message).toMatch(/^Yes, it can be re-run\. .*not resumed/);
    expect(h.sim.loop.tasks()).toHaveLength(1);
    // Same words, different Manager reading → different behaviour: the service follows the structured intent only.
    const g = await stoppedBySafetyCheck({ 可以重新執行嗎: follow(["status"]) });
    expect((await g.say("可以重新執行嗎")).message).toMatch(/^任務：.*\n目前進度：/);
    const x = await stoppedBySafetyCheck({ 為什麼停了: rerun() });
    expect((await x.say("為什麼停了")).outcome).toBe("submitted");
    // Unseen wording read as an explicit re-run creates exactly one re-run.
    const y = await stoppedBySafetyCheck({ "麻煩照原本那樣再來一遍": rerun(fromContext) });
    expect((await y.say("麻煩照原本那樣再來一遍")).taskId).toBe("p-task-2");
  });

  it("the Manager prompt and schema carry the semantic contract (topics + retry_task); unknown topics are dropped", () => {
    expect(INTENT_SCHEMA.properties.intent.enum).toContain("retry_task");
    expect(INTENT_SCHEMA.required).toContain("followUpTopics");
    expect(PLANNER_SYSTEM).toMatch(/Judge by meaning, never by particular words/);
    const d = normalizeIntentDecision({ intent: "task_follow_up", taskId: "t1", followUpTopics: ["remediation", "delete_repo", "reason", "reason"] }, { knownTaskIds: ["t1"], requireTask: false });
    expect(d).toEqual({ kind: "task_follow_up", intent: "task_follow_up", taskId: "t1", topics: ["reason", "remediation"] });
    expect(normalizeIntentDecision({ intent: "retry_task", taskId: "ghost" }, { knownTaskIds: ["t1"], requireTask: false })).toEqual({ kind: "retry_task", intent: "retry_task", taskId: null });
    // /goal (「任務：」) can never become a re-run or a follow-up.
    expect(normalizeIntentDecision({ intent: "retry_task", taskId: "t1" }, { knownTaskIds: ["t1"], requireTask: true }).kind).toBe("clarify");
  });
});

describe("deterministic re-run policy by failure class (never 「一律可以重跑」)", () => {
  const st = (waitReason: string | null, extra: Partial<GatewayTaskStatus> = {}) =>
    ({ taskId: "t1", status: "blocked", taskState: "failed", waitReason, assignedWorker: "codex", ...extra }) as GatewayTaskStatus;
  const available = { claude: { status: "available" as const, resetAt: null }, codex: { status: "available" as const, resetAt: null } };
  const say = (s: GatewayTaskStatus, a: ReturnType<typeof assessRetry>) =>
    composeFollowUp({ status: s, topics: ["remediation", "retry_eligibility"], assessment: a, label: "柱狀圖", phase: "", retryPhase: null, lang: "zh" });

  it("git metadata safety stop → allowed as a NEW task", () => {
    const a = assessRetry({ status: st("worker failure: git_metadata_changed"), activeRetryId: null, decomposed: false, availability: available });
    expect(a).toMatchObject({ failureClass: "git_safety", eligibility: { kind: "allowed", rerun: false, caution: "none" } });
    expect(say(st("worker failure: git_metadata_changed"), a)).toMatch(/^可以重新執行。.*安全檢查.*原本的任務不會直接恢復/);
  });

  it("8. quota failure while the quota is still exhausted → not now; never claims a re-run would work", () => {
    const s = st("worker failure: quota_exhausted");
    const a = assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: { ...available, codex: { status: "quota_exhausted", resetAt: "2026-10-09T12:00:00.000Z" } } });
    expect(a.eligibility).toEqual({ kind: "wait_recovery", cause: "quota", resetAt: "2026-10-09T12:00:00.000Z" });
    const text = say(s, a);
    expect(text).toMatch(/^現在還不能重新執行。/);
    expect(text).toContain("額度還沒恢復，現在重新執行也會失敗");
    expect(text).not.toMatch(/可以重新執行|跟我說一聲/);
    // Quota observed back → allowed.
    expect(assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: available }).eligibility.kind).toBe("allowed");
    // Unknown availability → fail closed.
    expect(assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: null }).eligibility.kind).toBe("wait_recovery");
  });

  it("9. auth failure → login first; with availability back it is allowed only with an explicit 'cannot confirm' condition", () => {
    const s = st("worker failure: authentication_unavailable");
    const down = assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: { ...available, codex: { status: "unavailable", resetAt: null } } });
    expect(down.eligibility).toMatchObject({ kind: "wait_recovery", cause: "auth" });
    expect(say(s, down)).toContain("要先恢復登入才能重新執行");
    expect(say(s, down)).not.toMatch(/可以重新執行/);
    const up = assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: available });
    expect(up.eligibility).toMatchObject({ kind: "allowed", caution: "recovery_unverified" });
    expect(say(s, up)).toMatch(/^可以重新執行，但有前提。.*無法確認/);
  });

  it("validation still failing (task waiting for the owner's direction) → continue the repair flow, not a new task", () => {
    const s = st("needs owner decision", { status: "needs_human_decision", taskState: "awaiting_approval" as GatewayTaskStatus["taskState"] });
    const a = assessRetry({ status: s, activeRetryId: null, decomposed: false, availability: available });
    expect(a.eligibility).toEqual({ kind: "in_progress", waiting: "decision" });
    expect(say(s, a)).toMatch(/^不需要重新執行。.*不需要重新建立任務，直接告訴我你希望怎麼修正/);
  });

  it("scope / budget → allowed with a warning; unknown reason → allowed but never a guessed cause; decomposed part → not alone", () => {
    expect(assessRetry({ status: st("worker failure: scope_violation"), activeRetryId: null, decomposed: false, availability: available }).eligibility).toMatchObject({ caution: "may_repeat" });
    expect(assessRetry({ status: st("worker execution budget exhausted"), activeRetryId: null, decomposed: false, availability: available }).eligibility).toMatchObject({ caution: "may_repeat" });
    const unknown = assessRetry({ status: st("something new"), activeRetryId: null, decomposed: false, availability: available });
    expect(unknown).toMatchObject({ failureClass: null, eligibility: { caution: "unknown_cause" } });
    expect(say(st("something new"), unknown)).toContain("紀錄不足以確認停止原因");
    expect(assessRetry({ status: st("worker failure: git_metadata_changed"), activeRetryId: null, decomposed: true, availability: available }).eligibility.kind).toBe("not_supported");
    expect(assessRetry({ status: st("worker failure: git_metadata_changed"), activeRetryId: "t2", decomposed: false, availability: available }).eligibility).toEqual({ kind: "retry_in_progress", retryTaskId: "t2" });
  });
});
