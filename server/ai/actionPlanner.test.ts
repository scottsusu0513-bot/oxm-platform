/**
 * OXM Action Registry + AI Action Planner——prompt 內容與防禦性 parse 驗證。
 * 不打真實 OpenAI API：mock provider.ts 的 getAiChatProvider()，只驗證組出來
 * 的 prompt 是否正確包含 registry 描述與 Current Factory Search State，以及
 * parseDecision 對模型輸出的防禦性處理。真實語意判斷（例如 CASE 4「這些都
 * 沒有五軸加工啊」）用真實 API 另外驗證，見完成後回報。
 *
 * 見「OXM AI 已完成功能整體驗收修正」十：這一層只回傳結構化決定，不再產生
 * assistantReply——使用者看到的文字由 server/ai/responseComposer.ts 負責。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FactorySearchStateForPlanner } from "./actionPlanner";

const mockCompleteJson = vi.fn();
vi.mock("./provider", () => ({
  getAiChatProvider: () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }),
}));

import { planNextOxmAction } from "./actionPlanner";
import { OXM_ACTION_REGISTRY } from "./actionRegistry";

const BASE_STATE: FactorySearchStateForPlanner = {
  hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
  coreCapabilities: ["五軸加工"],
  candidateCount: 20,
  directCapabilityMatchCount: 0,
  missingCoreCapabilities: ["五軸加工"],
  status: "SIMILAR_ONLY",
  requestedMatchCount: null,
  topResults: [{ factoryId: 1, companyName: "測試工廠", region: "台中市", relevanceTier: "general" }],
  searchSummary: "台中市、金屬加工；核心能力：五軸加工",
  lastSearchAt: "2026-08-16T00:00:00.000Z",
  activeFactorySearchRequest: null,
};

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("planNextOxmAction — prompt 內容", () => {
  it("包含 request_factory_sourcing／cancel_factory_sourcing 的 description／whenUseful／whenNotUseful，不外洩底層函式名稱", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({ history: [{ role: "user", content: "找台中五軸加工廠" }], factorySearchState: BASE_STATE });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    // search_factories 刻意不列在這個呼叫的選項清單裡（見 actionPlanner.ts
    // 的說明：它在這一步之前就已經自動執行完成，列出來會誘使模型誤選它當作
    // 「要不要搜尋」的答案，真實 API 測試時觀察到過一次這種誤判）。
    for (const action of OXM_ACTION_REGISTRY.filter(a => a.key !== "search_factories")) {
      expect(prompt).toContain(action.key);
      expect(prompt).toContain(action.description);
    }
    expect(prompt).not.toContain("runFactorySearchAction");
    expect(prompt).not.toContain("db.searchFactories");
    expect(prompt).not.toContain("notifyAdmins(");
  });

  it("search_factories 已自動完成，不是這個呼叫的可選項；JSON schema 只列 3 個選項", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({ history: [{ role: "user", content: "找台中五軸加工廠" }], factorySearchState: BASE_STATE });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("你永遠不需要、也不應該選 search_factories 當作你的決定");
    expect(prompt).toContain('"action": "request_factory_sourcing 或 cancel_factory_sourcing 或 none"');
  });

  it("這一層不生成任何要顯示給使用者的文字（wording 職責已移到 Final Response Composer）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({ history: [{ role: "user", content: "找台中五軸加工廠" }], factorySearchState: BASE_STATE });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).not.toContain("assistantReply");
    expect(prompt).toContain("不需要、也不會被拿去生成任何要顯示給使用者的文字");
  });

  it("包含 Current Factory Search State 的關鍵數字，且明確標示不要用固定數字門檻當唯一依據", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({ history: [{ role: "user", content: "找台中五軸加工廠" }], factorySearchState: BASE_STATE });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("台中市");
    expect(prompt).toContain("金屬加工");
    expect(prompt).toContain("五軸加工");
    expect(prompt).toContain("20 家");
    expect(prompt).toContain("不要用任何固定的數字門檻當作唯一判斷依據");
  });

  it("候選數為 0 時，明確告知這是「已經真的查過、平台沒有符合工廠」而不是「條件不夠具體」（真實 API 曾經在這裡誤判過一次）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({
      history: [{ role: "user", content: "找澎湖金屬加工廠" }],
      factorySearchState: { ...BASE_STATE, candidateCount: 0, status: "NO_HARD_CANDIDATE", hardFilters: { mainIndustries: ["金屬加工"], regions: ["澎湖縣"] } },
    });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("NO_HARD_CANDIDATE");
    expect(prompt).toContain("平台上目前真的沒有任何一家工廠符合");
    expect(prompt).toContain("不是查詢條件有問題");
  });

  it("明確禁止主動幫使用者決定期望家數、禁止把一般知識問題誤判成尋源意圖", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("不要主動幫使用者決定");
    expect(prompt).toContain("即使訊息裡出現了「五軸」這個詞");
  });

  it("有 activeFactorySearchRequest 時會帶入既有 pending 的摘要", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    await planNextOxmAction({
      history: [],
      factorySearchState: { ...BASE_STATE, activeFactorySearchRequest: { status: "pending", requestSummary: "尋找台中五軸加工廠" } },
    });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("尋找台中五軸加工廠");
    expect(prompt).toContain("進行中的人工協尋");
  });
});

describe("planNextOxmAction — parseDecision 防禦性解析", () => {
  it("模型回傳合法值時完整保留", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "request_factory_sourcing", reason: "沒有五軸證據", reasonCategory: "capability_gap",
      actionPayload: { requestedCapabilities: ["五軸加工"], requestedCount: 3 },
    }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.action).toBe("request_factory_sourcing");
    expect(decision.reasonCategory).toBe("capability_gap");
    expect(decision.actionPayload.requestedCount).toBe(3);
    expect(decision.actionPayload.requestedCapabilities).toEqual(["五軸加工"]);
  });

  it("模型回傳未知 action 字串 → 安全降級為 none（不會被拿去執行未知 side effect）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "delete_all_factories", reason: "x", reasonCategory: "other", actionPayload: {} }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.action).toBe("none");
  });

  it("模型仍然誤回傳 search_factories（prompt 已排除但防禦性處理）→ 降級為 none，不會被誤當成一個真正的決定", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "search_factories", reason: "x", reasonCategory: "other", actionPayload: {} }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.action).toBe("none");
  });

  it("模型回傳未知 reasonCategory → 降級為 other", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "made_up_category", actionPayload: {} }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.reasonCategory).toBe("other");
  });

  it("requestedCount 是負數／0／非數字時一律當作 null，不會污染 DB", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: { requestedCount: -1 } }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.actionPayload.requestedCount).toBeNull();
  });

  it("actionPayload 整個缺漏時不拋錯，回傳安全預設值", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other" }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.actionPayload).toEqual({ requestedCapabilities: [], requestedCount: null });
  });

  it("resolvedGoal／unresolvedNeed 正確透傳", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "request_factory_sourcing", reason: "x", reasonCategory: "capability_gap",
      resolvedGoal: false, unresolvedNeed: true, actionPayload: {},
    }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.resolvedGoal).toBe(false);
    expect(decision.unresolvedNeed).toBe(true);
  });

  it("缺漏 resolvedGoal／unresolvedNeed 時安全預設為 false／false（不誤觸發 gate、也不誤放行）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ action: "none", reason: "x", reasonCategory: "other", actionPayload: {} }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: BASE_STATE });
    expect(decision.resolvedGoal).toBe(false);
    expect(decision.unresolvedNeed).toBe(false);
  });
});

describe("planNextOxmAction — enforceResolvedGoalGate 程式碼防線（見「A/B CASE 6」根因修正，不是模型能力問題）", () => {
  it("resolvedGoal=true 且 unresolvedNeed=false，但模型仍選了 request_factory_sourcing → 強制降級為 none（三個模型的 A/B 測試都出現過這種邏輯矛盾）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "request_factory_sourcing", reason: "誤判", reasonCategory: "other",
      resolvedGoal: true, unresolvedNeed: false, actionPayload: {},
    }));
    const decision = await planNextOxmAction({
      history: [{ role: "user", content: "改南投" }],
      factorySearchState: { ...BASE_STATE, status: "MATCH_FOUND", directCapabilityMatchCount: 5 },
    });
    expect(decision.action).toBe("none");
  });

  it("resolvedGoal=true 且 unresolvedNeed=true（模型自相矛盾但不是我們要防的那種）→ 不強制降級，因為 unresolvedNeed 仍然是 true", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "request_factory_sourcing", reason: "x", reasonCategory: "capability_gap",
      resolvedGoal: true, unresolvedNeed: true, actionPayload: {},
    }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: { ...BASE_STATE, status: "MATCH_FOUND" } });
    expect(decision.action).toBe("request_factory_sourcing");
  });

  it("見「二、MATCH_FOUND 不是永遠禁止人工協尋」：toolResultStatus=MATCH_FOUND，但模型判斷 resolvedGoal=false／unresolvedNeed=true（使用者表達不滿）→ request_factory_sourcing 正常放行，不被 gate 擋下", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "request_factory_sourcing", reason: "使用者說這些不是他要的", reasonCategory: "capability_gap",
      resolvedGoal: false, unresolvedNeed: true, actionPayload: {},
    }));
    const decision = await planNextOxmAction({
      history: [{ role: "user", content: "這些不是我要的" }],
      factorySearchState: { ...BASE_STATE, status: "MATCH_FOUND", directCapabilityMatchCount: 5 },
    });
    expect(decision.action).toBe("request_factory_sourcing");
  });

  it("action=none 時 gate 不影響任何東西（gate 只針對 request_factory_sourcing）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "none", reason: "x", reasonCategory: "other",
      resolvedGoal: true, unresolvedNeed: false, actionPayload: {},
    }));
    const decision = await planNextOxmAction({ history: [], factorySearchState: { ...BASE_STATE, status: "MATCH_FOUND" } });
    expect(decision.action).toBe("none");
  });

  it("cancel_factory_sourcing 不受這個 gate 影響（gate 只針對 request_factory_sourcing）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      action: "cancel_factory_sourcing", reason: "使用者不用了", reasonCategory: "other",
      resolvedGoal: true, unresolvedNeed: false, actionPayload: {},
    }));
    const decision = await planNextOxmAction({
      history: [],
      factorySearchState: { ...BASE_STATE, status: "MATCH_FOUND", activeFactorySearchRequest: { status: "pending", requestSummary: "x" } },
    });
    expect(decision.action).toBe("cancel_factory_sourcing");
  });
});
