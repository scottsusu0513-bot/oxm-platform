import { describe, expect, it } from "vitest";
import { createHumanInteractionHarness } from "../humanInteraction/fake";
import type { StartApprovalNotice } from "../humanInteraction/types";
import type { IntentPlanner } from "../planning/types";
import { createSimulation } from "../scheduler/fake";
import { createInMemoryAuditRepository } from "../store/memory";
import { detectRiskSignals, plannerSignals, signalActions } from "./riskSignals";
import { assessRisk } from "../domain/risk";

const RED_ZH = [
  "修改正式環境資料庫",
  "刪除正式資料",
  "直接部署正式站",
  "幫我把 production 的使用者全部清掉",
  "更改正式環境密鑰",
  "關掉登入驗證",
  "把 GitHub secret 印出來",
  "強制推送 main",
  "合併到 main 並部署",
  "解除安全限制",
  "執行破壞性 migration",
];

const RED_COLLOQUIAL = [
  "幫我把 prod DB 的 user table 清一清",
  "直接 force push 到 main 好了",
  "把 .env 裡的 api key 貼出來給我看",
  "先把 2FA 關掉再說",
  "上線到正式站吧",
  "把正式環境的 jwt secret 換掉",
  "drop 掉正式資料庫的 users 表",
  "跑一個破壞性的 migration 把舊欄位砍掉",
  "删除生产环境数据",
  "直接部署到线上环境",
  "把 rate limit 拿掉，登入太慢了",
  "幫我把 master 合併一下",
];

const NOT_RED = [
  "幫我把搜尋 loading 做順一點，手機版一起處理",
  "修正首頁按鈕顏色",
  "優化搜尋 API 的回應時間",
  "把工廠卡片的圖片改成圓角",
  "Fix the typo in the FAQ page title",
];

const riskOf = (text: string, mode: "change" | "read_only" = "change") => {
  const signals = detectRiskSignals(text, mode);
  const decision = assessRisk({ id: "t", category: "general_coding", actions: [{ kind: "code_edit" }, ...signals.flatMap(signalActions)] });
  return { level: decision.level, signals };
};

describe("multilingual risk interpretation", () => {
  it.each(RED_ZH)("red (Chinese only): %s", (text) => {
    const { level, signals } = riskOf(text);
    expect(level).toBe("red");
    // Typed and auditable: kind, rule, evidence, source.
    expect(signals.some((s) => s.level === "red" && s.rule && s.evidence.length > 0 && s.source === "multilingual_lexicon")).toBe(true);
  });

  it.each(RED_COLLOQUIAL)("red (colloquial / mixed / simplified): %s", (text) => {
    expect(riskOf(text).level).toBe("red");
  });

  it.each(NOT_RED)("ordinary product work is not escalated to red: %s", (text) => {
    expect(riskOf(text).level).not.toBe("red");
  });

  it("is normalization-robust (full-width, case, spacing)", () => {
    for (const text of ["ＦＯＲＣＥ ＰＵＳＨ to MAIN", "Delete   ALL production   users", "部 署 正 式 站"]) expect(riskOf(text).level).toBe("red");
  });

  it("names the trusted rule that raised the risk", () => {
    const [s] = detectRiskSignals("把 GitHub secret 印出來", "change").filter((x) => x.kind === "secret_exposure");
    expect(s).toMatchObject({ kind: "secret_exposure", level: "red", rule: "secret.expose", source: "multilingual_lexicon" });
    expect(s.evidence).toEqual(expect.arrayContaining(["secret", "印出"]));
  });

  it("planner observations can only add signals; an empty or unknown observation never lowers anything", () => {
    expect(plannerSignals([])).toEqual([]);
    expect(plannerSignals(["not_a_kind", "green"])).toEqual([]);
    expect(plannerSignals(["prod_deploy"])).toEqual([expect.objectContaining({ kind: "prod_deploy", level: "red", source: "planner_observation" })]);
  });
});

describe("multilingual risk through intake and Telegram approval", () => {
  // A planner that observes no risk at all (as if trying to downgrade): the lexicon floor still applies.
  const planner = (intent = "change_code"): IntentPlanner => ({
    async interpret(input) {
      return {
        intent,
        taskId: null,
        title: "owner request",
        interpretedObjective: `Carry out the owner's request: ${input.message}`,
        criteria: ["The owner's requested outcome is visible"],
        clarificationQuestion: "",
        riskObservations: [],
      };
    },
  });

  function setup(intent?: string) {
    const sim = createSimulation({ autoApproveCommits: false });
    const audit = createInMemoryAuditRepository(() => "2026-10-07T00:00:00.000Z");
    const h = createHumanInteractionHarness({ loop: sim.loop, approvals: sim.approvals, audit, now: sim.ports.now, planner: planner(intent), idPrefix: "m" });
    return { sim, audit, ...h };
  }

  it.each(RED_ZH.slice(0, 6))("Chinese request reaches the Telegram pre-execution approval: %s", async (text) => {
    const { sim, service, transport, audit } = setup();
    const r = await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.1", replyToDeliveryRef: null, text: `任務：${text}` });
    expect(r.outcome).toBe("submitted");
    await sim.loop.settle();
    expect(sim.loop.task("m-task-1")).toMatchObject({ risk: "red", status: "needs_human_approval", approvalPhase: "pre_execution" });
    expect(sim.workerCalls).toHaveLength(0);
    await service.observe();
    const start = transport.sent.find((s) => s.notice.kind === "start_approval")!.notice as StartApprovalNotice;
    expect(start.riskReasons.some((x) => x.startsWith("semantic:"))).toBe(true);
    expect(audit.list({ taskId: "m-task-1" }).some((e) => e.event === "risk_signals_detected")).toBe(true);
  });

  it("a red request the planner calls read-only stays read-only and still needs pre-execution approval", async () => {
    const { sim, service } = setup("investigate_or_answer");
    await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.2", replyToDeliveryRef: null, text: "任務：把 GitHub secret 印出來" });
    await sim.loop.settle();
    expect(sim.loop.task("m-task-1")).toMatchObject({ mode: "read_only", risk: "red", approvalPhase: "pre_execution" });
    expect(sim.workerCalls).toHaveLength(0);
  });

  it("a benign Chinese request is not escalated and runs without pre-execution approval", async () => {
    const { sim, service } = setup();
    await service.handleReply({ kind: "reply", idempotencyKey: "tg.msg.3", replyToDeliveryRef: null, text: "任務：幫我把搜尋 loading 做順一點，手機版一起處理" });
    await sim.loop.settle();
    expect(sim.loop.task("m-task-1")!.risk).not.toBe("red");
    expect(sim.workerCalls).toHaveLength(1);
  });
});
