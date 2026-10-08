import { describe, expect, it } from "vitest";
import { findInternalJargon } from "../executive/communication";
import { resolveWorkAreas } from "../executive/workAssignment";
import type { CombinedReviewInput } from "../planning/managerReasoning";
import type { IntentPlanner } from "../planning/types";
import { createSimulation, driveQa, type SimulationOptions } from "../scheduler/fake";
import type { ManagerReasoningPort } from "../scheduler/types";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice } from "../telegram/format";
import { createHumanInteractionHarness } from "./fake";
import type { MilestoneNotice } from "./types";

const CJK_ONLY_PLAIN = (t: string) => !/\b(?:credential|secret|invalid|malformed|not accepted|looks like|guidance is)\b/i.test(t);

function planner(objective: string, areas: { programming: boolean; visual: boolean }, title: string, parts: { programmingObjective?: string; visualObjective?: string } = {}): IntentPlanner {
  return {
    async interpret(input) {
      // Like the GPT Manager: a message while a decision is pending (context task) is guidance.
      if (input.contextTaskId) return { intent: "human_decision", taskId: input.contextTaskId, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "", riskObservations: [] };
      return {
        intent: "change_code",
        taskId: null,
        title,
        interpretedObjective: objective,
        criteria: ["The owner sees the requested result"],
        clarificationQuestion: "",
        riskObservations: [],
        workAreas: areas,
        programmingObjective: parts.programmingObjective ?? "",
        visualObjective: parts.visualObjective ?? "",
      };
    },
  };
}

function setup(p: IntentPlanner, opts: SimulationOptions = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, ...opts });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: p, idPrefix: "y" });
  const say = async (key: string, text: string) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text });
    await sim.loop.settle();
    return r;
  };
  const milestones = () => h.transport.sent.filter((s) => s.notice.kind === "milestone").map((s) => s.notice as MilestoneNotice);
  return { sim, say, milestones, audit, ...h };
}

const MIXED = planner("Show verified factories first and give them a highlighted card.", { programming: true, visual: true }, "認證工廠優先", {
  programmingObjective: "Rank verified factories first in the search API.",
  visualObjective: "Give verified factories a highlighted card on the search page.",
});

async function runMixed(review: ManagerReasoningPort["reviewCombined"] | null) {
  const calls: CombinedReviewInput[] = [];
  const manager: ManagerReasoningPort = review ? { reviewCombined: async (i) => (calls.push(structuredClone(i)), review(i)) } : {};
  const x = setup(MIXED, { manager });
  await x.say("tg.msg.1", "搜尋結果要讓認證工廠排前面，卡片也要特別標示出來");
  await driveQa(x.sim, "y-task-1");
  await x.sim.loop.settle();
  await driveQa(x.sim, "y-task-2");
  await x.sim.loop.settle();
  await x.service.observe();
  return { ...x, calls };
}

describe("mixed request: final combined GPT review", () => {
  it("both halves pass on their own but the combined intent fails -> NOT accepted; without the GPT cross-part diagnosis it waits (fail closed)", async () => {
    const x = await runMixed(async () => ({
      verdict: "accepted", // inconsistent with its own findings: the gate turns it into not_accepted
      integrates: false,
      satisfiesOriginalIntent: false,
      conflicts: ["The card reads `isVerified` but the API returns `verified`."],
      missingPieces: [],
      ownerSummary: "排序已經改好，但畫面讀不到新的認證欄位，所以卡片沒有被標示出來。",
    }));
    // Parts stay held (not accepted) while the whole is not accepted.
    expect(x.sim.loop.task("y-task-1")!.status).toBe("waiting_group");
    expect(x.sim.loop.task("y-task-2")!.status).toBe("waiting_group");
    expect(x.sim.loop.task("y-task-1")!.combinedReview).toMatchObject({ status: "diagnosis_unavailable", verdict: { verdict: "not_accepted", integrates: false } });
    const input = x.calls[0];
    expect(input.originalRequest).toBe("搜尋結果要讓認證工廠排前面，卡片也要特別標示出來");
    expect(input.parts.map((p) => [p.area, p.worker, p.subGoal.split("\n")[0]])).toEqual([
      ["programming", "claude", "Rank verified factories first in the search API."],
      ["visual", "codex", "Give verified factories a highlighted card on the search page."],
    ]);
    expect(input.parts.every((p) => p.changedPaths.length > 0 && p.validations.length > 0 && p.prNumber !== null)).toBe(true);
    expect(x.milestones().some((m) => m.milestone === "completed" || m.milestone === "combined_accepted")).toBe(false);
    expect(x.milestones().filter((m) => m.milestone === "combined_review_waiting")).toHaveLength(1);
    for (const m of x.milestones()) expect(findInternalJargon(formatNotice(m))).toEqual([]);
  });

  it("both halves integrate and satisfy the original goal -> accepted, once", async () => {
    const x = await runMixed(async () => ({ verdict: "accepted", integrates: true, satisfiesOriginalIntent: true, conflicts: [], missingPieces: [], ownerSummary: "認證工廠現在排在最前面，卡片也有明顯標示。" }));
    expect(x.sim.loop.task("y-task-2")!.combinedReview).toMatchObject({ status: "accepted" });
    const ok = x.milestones().filter((m) => m.milestone === "combined_accepted");
    expect(ok).toHaveLength(1);
    expect(ok[0].detail).toMatch(/^程式和畫面兩部分都完成了，我也把它們合在一起檢查過，整體符合你原本的需求。/);
    expect(x.calls).toHaveLength(1);
  });

  it("without the GPT combined review the whole is never accepted (fail closed)", async () => {
    const x = await runMixed(null);
    expect(x.sim.loop.task("y-task-1")!.combinedReview).toMatchObject({ status: "review_unavailable" });
    expect(x.milestones().some((m) => m.milestone === "combined_review_waiting")).toBe(true);
  });
});

describe("Executive presentation boundary (Traditional Chinese owner)", () => {
  it("a credential-looking message gets a natural Chinese explanation, never the raw internal reason", async () => {
    const x = setup(planner("x", { programming: true, visual: false }, "t"));
    const r = await x.say("tg.msg.2", "幫我設定 api_key=sk-live-abcdefghijklmnop1234567890");
    expect(r.outcome).toBe("invalid");
    expect(r.message).toContain("看起來包含密碼或金鑰之類的機密資料");
    expect(CJK_ONLY_PLAIN(r.message)).toBe(true);
    expect(r.message).not.toMatch(/sk-live/);
  });

  it("an English clarification from the Manager is replaced for a Chinese owner", async () => {
    const p: IntentPlanner = { async interpret() { return { intent: "clarify", taskId: null, title: "", interpretedObjective: "", criteria: [], clarificationQuestion: "Which page do you mean?", riskObservations: [] }; } };
    const x = setup(p);
    const r = await x.say("tg.msg.3", "改一下那個");
    expect(r.message).toMatch(/^我不太確定你的意思/);
    expect(r.message).not.toContain("Which page");
  });

  it("guidance the Manager cannot interpret: typed infrastructure wait, plain Chinese to the owner, raw reason only in the audit", async () => {
    const manager: ManagerReasoningPort = { interpretGuidance: async () => { throw new Error("codex manager timeout (exit 1)"); } };
    const x = setup(planner("Fix the record write.", { programming: true, visual: false }, "存檔問題"), { manager, worker: { "y-task-1": ["validation_failed"] } });
    await x.say("tg.msg.4", "使用者存檔之後資料有時候會不見");
    await x.service.observe();
    expect(x.sim.loop.task("y-task-1")!.status).toBe("needs_human_decision");
    const r = await x.say("tg.msg.5", "先不要改 UI，只修 API");
    expect(r.outcome).toBe("resumed");
    await x.service.observe();
    const rejected = x.milestones().find((m) => m.milestone === "guidance_rejected")!;
    expect(rejected.detail).toBe("我現在暫時無法理解這段指示（理解服務暫時無法使用）。任務會繼續等你決定，請稍後再傳一次。");
    expect(x.sim.audit.some((e) => e.event === "human_decision_rejected" && /manager_unavailable/.test(JSON.stringify(e.metadata)))).toBe(true);
    expect(x.sim.loop.task("y-task-1")!.status).toBe("waiting_infrastructure");
  });

  it("a GPT-requested decision shows the Manager's question and numbered options in plain Chinese", async () => {
    const manager: ManagerReasoningPort = {
      diagnose: async () => ({
        rootCause: "Two valid behaviours conflict.",
        whyPreviousAttemptFailed: "",
        missingEvidence: [],
        repairStrategy: "Ask the owner",
        strategyChanged: false,
        repairObjective: "",
        repairInstructions: [],
        protectedAreas: [],
        requiredEvidence: [],
        validationPlan: [],
        touchesPaths: [],
        restartFromScratch: false,
        ownerDecisionNeeded: true,
        ownerDecisionQuestion: "存檔成功後，要直接顯示新資料，還是跳回列表？",
        ownerOptions: [{ id: "A", summary: "直接顯示新資料" }, { id: "B", summary: "跳回列表" }],
        recommendedOption: "A",
        constraintCompliance: [],
      }),
    };
    const x = setup(planner("Fix the record write.", { programming: true, visual: false }, "存檔問題"), { manager, worker: { "y-task-1": ["validation_failed"] } });
    await x.say("tg.msg.6", "使用者存檔之後資料有時候會不見");
    await x.service.observe();
    const notice = x.transport.sent.find((s) => s.notice.kind === "human_decision")!;
    const text = formatNotice(notice.notice);
    expect(text).toBe(
      "「存檔問題」有一個地方需要你決定。\n存檔成功後，要直接顯示新資料，還是跳回列表？\n1. 直接顯示新資料\n2. 跳回列表\n我建議第 1 個方案。\n\n你要選哪一個？直接傳訊息告訴我即可（例如「照第二個方案」）。這只是方向指示，不代表批准發布；要停止這個任務請按「取消任務」。",
    );
    expect(findInternalJargon(text)).toEqual([]);
  });

  it("non-quota availability pauses are explained plainly", async () => {
    const x = setup(planner("Fix the record write.", { programming: true, visual: false }, "存檔問題"), { worker: { "y-task-1": ["auth_unavailable"] } });
    await x.say("tg.msg.7", "使用者存檔之後資料有時候會不見");
    await x.service.observe();
    const paused = x.milestones().find((m) => m.milestone === "availability_paused")!;
    expect(paused.detail).toBe("Claude 目前需要重新登入，我已保存進度。登入恢復後可以從原位置繼續。");
    expect((await x.service.taskStatus("y-task-1")).message).toContain("工程師的執行環境暫時無法使用，進度已保存，恢復後從原位置繼續");
  });

  it("the red handback approval explains in plain language why another approval is needed", () => {
    const text = formatNotice({
      kind: "start_approval",
      noticeId: "ap:1",
      ref: "0123456789abcdef",
      taskId: "t",
      lang: "zh",
      ownerLabel: "會員資料修正",
      approvalRequestId: "1",
      taskLabel: "t — 會員資料修正",
      objectiveSummary: "修正會員資料寫入",
      actions: ["code_edit"],
      riskReasons: ["prod_db_write action"],
      allowedScope: ["server/"],
      repair: true,
      readOnly: false,
      handback: true,
      risk: "red",
      expiresAt: "2026-10-07T10:00:00.000Z",
      authorizes: { executeThisExactContract: true, commit: false, push: false, openPr: false, merge: false, deploy: false, gitPermissionsForWorker: false },
    });
    expect(text).toMatch(/^Claude 的額度已恢復。「會員資料修正」是高風險任務，要把它從 Codex 交回 Claude、從目前的進度繼續，需要你再批准一次這次執行。/);
    expect(findInternalJargon(text)).toEqual([]);
  });
});

describe("semantic work-area routing (GPT primary, keywords only add)", () => {
  it.each([
    ["首頁看起來太擠了，想要舒服一點", "Give the homepage more breathing room.", { programming: false, visual: true }, [["codex", "visual"]]],
    ["使用者存檔之後資料有時候會不見", "Make sure every save persists.", { programming: true, visual: false }, [["claude", "programming"]]],
    ["報價流程要更順，報價單也要看起來更專業", "Smooth the quote flow and make the quote sheet look professional.", { programming: true, visual: true }, [["claude", "programming"], ["codex", "visual"]]],
  ] as const)("%s", async (text, objective, areas, expected) => {
    const x = setup(planner(objective, areas, "需求"));
    await x.say("tg.msg.10", text);
    expect(x.sim.loop.tasks().map((t) => [t.worker, t.workArea])).toEqual(expected);
  });

  it("the keyword guardrail may add an area but never removes a Manager-declared one", () => {
    expect(resolveWorkAreas({ programming: true, visual: true }, "make it better")).toEqual({ programming: true, visual: true });
    expect(resolveWorkAreas({ programming: false, visual: true }, "報價單更有質感")).toEqual({ programming: false, visual: true });
    expect(resolveWorkAreas({ programming: false, visual: true }, "修正搜尋 API 排序，並美化卡片")).toEqual({ programming: true, visual: true });
  });
});
