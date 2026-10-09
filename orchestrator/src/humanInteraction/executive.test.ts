import { describe, expect, it } from "vitest";
import { findInternalJargon } from "../executive/communication";
import type { IntentPlanner } from "../planning/types";
import type { RepairDiagnosisInput } from "../planning/managerReasoning";
import { createSimulation, driveQa, type SimulationOptions } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { formatNotice } from "../telegram/format";
import { createHumanInteractionHarness } from "./fake";
import type { MilestoneNotice } from "./types";

/**
 * GPT Manager -> Worker assignment through the real Gateway/intake path, and
 * the Executive Telegram layer's progress messages. Everything the owner sees
 * is plain language; internal state stays in snapshots and audit.
 */

const MIXED = "Redesign the search page and change how the search API ranks results.";
const VISUAL = "Make the homepage buttons blue and increase their spacing.";
const CODE = "Fix the bug in the login permission check.";

function plannerFor(
  areas: { programming: boolean; visual: boolean },
  parts: { programmingObjective?: string; visualObjective?: string } = {},
  criteria = ["Search results look and behave as requested"],
  objective = MIXED,
  title = "搜尋頁改版",
): IntentPlanner {
  return {
    async interpret() {
      return {
        intent: "change_code",
        taskId: null,
        title,
        interpretedObjective: objective,
        criteria,
        clarificationQuestion: "",
        riskObservations: [],
        workAreas: areas,
        programmingObjective: parts.programmingObjective ?? "",
        visualObjective: parts.visualObjective ?? "",
      };
    },
  };
}

function setup(planner: IntentPlanner, opts: SimulationOptions = {}) {
  const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
  const sim = createSimulation({ autoApproveCommits: false, ...opts });
  const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner, idPrefix: "x" });
  const say = async (key: string, text: string) => {
    const r = await h.service.handleReply({ kind: "reply", idempotencyKey: key, replyToDeliveryRef: null, text: `任務：${text}` });
    await sim.loop.settle();
    return r;
  };
  const milestones = () => h.transport.sent.filter((s) => s.notice.kind === "milestone").map((s) => s.notice as MilestoneNotice);
  return { sim, say, milestones, ...h };
}

describe("GPT Manager worker routing through intake", () => {
  it("a mixed request is decomposed: Claude gets the programming part, Codex the visual part", async () => {
    const x = setup(plannerFor({ programming: true, visual: true }, { programmingObjective: "Change the search API ranking.", visualObjective: "Redesign the search page layout." }, ["The search API ranks verified factories first", "The search page layout shows larger factory cards", "Users can find a factory quickly"]));
    const r = await x.say("tg.msg.1", "重新設計搜尋頁版面，並修改搜尋 API 的排序邏輯");
    expect(r.outcome).toBe("submitted");
    expect(r.message).toMatch(/^收到。這個需求包含程式和畫面兩部分：程式邏輯交給 Claude，畫面設計交給 Codex/);
    expect(findInternalJargon(r.message)).toEqual([]);
    const [p, v] = [x.sim.loop.task("x-task-1")!, x.sim.loop.task("x-task-2")!];
    expect(p).toMatchObject({ worker: "claude", workArea: "programming", primaryWorker: "claude" });
    expect(v).toMatchObject({ worker: "codex", workArea: "visual", primaryWorker: "codex" });
    expect(["ui", "css", "layout", "visual_polish", "frontend_styling"]).toContain(v.category);
    expect(["ui", "css", "layout", "visual_polish", "frontend_styling"]).not.toContain(p.category);
    const byTask = (id: string) => x.sim.workerCalls.find((c) => c.taskId === id)!;
    expect(byTask("x-task-1").kind).toBe("claude");
    expect(byTask("x-task-1").objective).toMatch(/^Change the search API ranking\.[\s\S]*You own ONLY the programming part/);
    // One workspace: the visual part waits until the programming part has passed its publish gate.
    expect(v.status).toBe("waiting_workspace");
    expect(byTask("x-task-2")).toBeUndefined();
    await driveQa(x.sim, "x-task-1");
    await x.sim.loop.settle();
    expect(byTask("x-task-2").kind).toBe("codex");
    expect(byTask("x-task-2").objective).toMatch(/^Redesign the search page layout\.[\s\S]*You own ONLY the site-visual part/);
    expect(x.ledger.tracked().map((t) => t.label)).toEqual(["搜尋頁改版（程式）", "搜尋頁改版（畫面）"]);
  });

  it("pure site-visual work goes to Codex; Claude is never assigned pure visual design", async () => {
    const x = setup(plannerFor({ programming: false, visual: true }, {}, ["Buttons look as requested"], VISUAL, "首頁按鈕"));
    await x.say("tg.msg.2", "把首頁按鈕改成藍色，間距調大一點");
    expect(x.sim.loop.tasks()).toHaveLength(1);
    expect(x.sim.loop.task("x-task-1")).toMatchObject({ worker: "codex", workArea: "visual" });
    expect(x.sim.workerCalls.every((c) => c.kind === "codex")).toBe(true);
  });

  it("the Manager cannot drop a visual part the policy detects (it is added and decomposed)", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }));
    await x.say("tg.msg.3", "重新設計搜尋頁版面，並修改搜尋 API 的排序邏輯");
    expect(x.sim.loop.tasks().map((t) => [t.worker, t.workArea])).toEqual([
      ["claude", "programming"],
      ["codex", "visual"],
    ]);
  });

  it("programming work goes to Claude", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"));
    await x.say("tg.msg.4", "修正登入權限檢查的 bug");
    expect(x.sim.loop.tasks().map((t) => [t.worker, t.workArea])).toEqual([["claude", "programming"]]);
  });
});

describe("Executive Telegram progress and quota messages", () => {
  it("lifecycle milestone: handed to Claude (once, no spam)", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"), { holdWorkers: true });
    await x.say("tg.msg.10", "修正登入權限檢查的 bug");
    await x.service.observe();
    await x.service.observe();
    const assigned = x.milestones().filter((m) => m.milestone === "worker_assigned");
    expect(assigned).toHaveLength(1);
    expect(formatNotice(assigned[0])).toBe("【登入權限】\n已交給 Claude 處理程式部分。");
    x.sim.releaseWorker("x-task-1");
    await x.sim.loop.settle();
  });

  it("Claude quota on a programming task: the owner is told Codex temporarily continues the same task", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"), { worker: { "x-task-1": ["quota_exhausted", "success"] } });
    await x.say("tg.msg.11", "修正登入權限檢查的 bug");
    await x.service.observe();
    const takeover = x.milestones().filter((m) => m.milestone === "quota_takeover");
    expect(takeover).toHaveLength(1);
    expect(takeover[0].detail).toBe("Claude 的本期使用額度已用完。我已保存目前進度，暫時交由 Codex 繼續這個程式任務。Claude 額度恢復後，我會在安全的交接點切回 Claude。");
    // The task still ends at the normal publish gate; approval is still required.
    expect(x.transport.sent.some((s) => s.notice.kind === "commit_publish_approval")).toBe(true);
    expect((await x.service.taskStatus("x-task-1")).message).toContain("負責：Codex（暫代 Claude，額度恢復後交回）");
  });

  it("Codex quota on visual work: paused, not handed to Claude, reset time stated honestly", async () => {
    const x = setup(plannerFor({ programming: false, visual: true }, {}, ["Buttons look as requested"], VISUAL, "首頁按鈕"), { worker: { "x-task-1": ["quota_exhausted"] } });
    await x.say("tg.msg.12", "把首頁按鈕改成藍色");
    await x.service.observe();
    await x.service.observe();
    const paused = x.milestones().filter((m) => m.milestone === "quota_paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].detail).toBe("Codex 的使用額度已用完。這是視覺設計任務，我不會交給 Claude。進度已保存，額度恢復後會由 Codex 繼續。預計恢復時間：目前無法確定確切的恢復時間。");
    expect(x.sim.workerCalls.map((c) => c.kind)).toEqual(["codex"]);
    const status = await x.service.taskStatus("x-task-1");
    expect(status.message).toContain("工程師使用額度用完，進度已保存，等額度恢復");
    for (const m of [...x.transport.sent.map((s) => formatNotice(s.notice)), status.message]) expect(findInternalJargon(m)).toEqual([]);
  });

  it("both Workers out of quota: one plain pause message; nothing is bypassed", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"), { worker: { "x-task-1": ["quota_exhausted"] } });
    await x.say("tg.msg.13", "修正登入權限檢查的 bug");
    await x.service.observe();
    const paused = x.milestones().filter((m) => m.milestone === "quota_paused");
    expect(paused).toHaveLength(1);
    expect(paused[0].detail).toMatch(/^Claude 和 Codex 的使用額度目前都用完了。我已保存進度並暫停這個任務/);
    expect(x.transport.sent.some((s) => s.notice.kind === "commit_publish_approval")).toBe(false);
  });
});

describe("explicit owner technical-details questions", () => {
  it.each(["詳細原因", "給我技術細節", "為什麼會失敗", "把工程細節給我看"])("%s is a question, not guidance or approval", async (question) => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"));
    const key = `q${question.length}`;
    await x.say(`tg.details.create.${key}`, "修正登入權限檢查的 bug");
    x.ledger.recordIntent({ noticeId: `details:${key}`, kind: "milestone", ref: `details-ref-${key}`, taskId: "x-task-1", targetId: "status", createdAt: "2026-10-07T00:00:00.000Z" });
    x.ledger.recordDelivered(`details:${key}`, `details-delivery-${key}`);
    const before = x.sim.loop.tasks().length;
    const r = await x.service.handleReply({ kind: "reply", idempotencyKey: `tg.details.${key}`, replyToDeliveryRef: `details-delivery-${key}`, text: question });

    expect(r).toMatchObject({ outcome: "info", taskId: "x-task-1" });
    expect(r.message).toMatch(/技術細節：登入權限/);
    expect(r.message).toMatch(/任務編號：x-task-1/);
    expect(r.message).toMatch(/負責：Claude（程式）/);
    expect(r.message).toMatch(/自動檢查：tests 通過、typecheck 通過/);
    expect(x.sim.loop.tasks()).toHaveLength(before);
    expect(x.emitted).toHaveLength(0);
    expect(x.approvalEvents).toHaveLength(0);
    expect(r.message).not.toMatch(/fingerprint|reasoning|thought|[0-9a-f]{40}/i);
  });

  it("shows structured Manager failure and repair facts, while an English request stays English", async () => {
    const manager = {
      async diagnose(i: RepairDiagnosisInput) {
        return {
          rootCause: "The permission branch returns before checking the saved role.",
          whyPreviousAttemptFailed: "",
          missingEvidence: [],
          repairStrategy: "Check the persisted role before returning",
          strategyChanged: false,
          repairObjective: "Only permitted users get access.",
          repairInstructions: ["Move the role check before the early return."],
          protectedAreas: ["Do not change the public response shape."],
          requiredEvidence: ["The permission test passes"],
          validationPlan: ["tests", "typecheck"],
          touchesPaths: [i.allowedScope[0]],
          restartFromScratch: false,
          ownerDecisionNeeded: false,
          ownerDecisionQuestion: "",
          ownerOptions: [],
          recommendedOption: "",
          constraintCompliance: [],
        };
      },
    };
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "Login permission"), {
      worker: { "x-task-1": ["validation_failed", "success"] },
      manager,
    });
    await x.say("tg.details.failure.create", "Fix the login permission bug");
    await x.service.observe();
    const notice = x.transport.sent.find((s) => s.notice.taskId === "x-task-1")!;
    const r = await x.service.handleReply({ kind: "reply", idempotencyKey: "tg.details.failure", replyToDeliveryRef: notice.deliveryRef, text: "show technical details" });

    expect(r.outcome).toBe("info");
    expect(r.message).toContain("Technical details: Login permission");
    expect(r.message).toContain("Manager root cause: The permission branch returns before checking the saved role.");
    expect(r.message).toContain("Repair attempts:");
    expect(r.message).toContain("Changed files:");
    expect(r.message).not.toMatch(/fingerprint|reasoning|thought|[0-9a-f]{40}/i);
  });

  it("asks which task when several tasks could be meant", async () => {
    const x = setup(plannerFor({ programming: true, visual: false }, {}, ["Only permitted users get access"], CODE, "登入權限"), { holdWorkers: true });
    await x.say("tg.details.multi.1", "修正登入權限檢查的 bug");
    await x.say("tg.details.multi.2", "修正另一個登入權限檢查的 bug");
    const r = await x.service.handleReply({ kind: "reply", idempotencyKey: "tg.details.multi.ask", replyToDeliveryRef: null, text: "給我技術細節" });

    expect(r.outcome).toBe("needs_selection");
    expect(r.message).toMatch(/你要看哪一個任務的技術細節/);
    expect(r.message).toMatch(/1\.「[\s\S]*2\.「/);
    expect(x.sim.loop.tasks()).toHaveLength(2);
  });
});
