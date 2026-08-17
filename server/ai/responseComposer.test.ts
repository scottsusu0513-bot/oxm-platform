/**
 * Final Response Composer（見對話中「OXM AI 已完成功能整體驗收修正」十一）
 * ——prompt 內容與防禦性 parse 驗證。不打真實 OpenAI API：mock provider.ts。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComposerFactorySearchInput, ComposerActionInput } from "./responseComposer";

const mockCompleteJson = vi.fn();
vi.mock("./provider", () => ({
  getAiChatProvider: () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }),
}));

import { composeFinalResponse } from "./responseComposer";

const MATCH_FOUND_INPUT: ComposerFactorySearchInput = {
  isFreshSearch: true,
  status: "MATCH_FOUND",
  hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
  coreCapabilities: ["五軸加工"],
  candidateCount: 20,
  directCapabilityMatchCount: 3,
  missingCoreCapabilities: [],
  requestedMatchCount: null,
  topResults: [{ factoryId: 1, companyName: "測試五軸廠", region: "台中市", relevanceTier: "high" }],
  searchSummary: "台中市、金屬加工；核心能力：五軸加工",
  lastSearchAt: "2026-08-16T00:00:00.000Z",
};

const SIMILAR_ONLY_INPUT: ComposerFactorySearchInput = {
  ...MATCH_FOUND_INPUT,
  status: "SIMILAR_ONLY",
  directCapabilityMatchCount: 0,
  missingCoreCapabilities: ["五軸加工"],
  topResults: [{ factoryId: 2, companyName: "測試一般廠", region: "台中市", relevanceTier: "general" }],
};

const NO_HARD_CANDIDATE_INPUT: ComposerFactorySearchInput = {
  ...MATCH_FOUND_INPUT,
  status: "NO_HARD_CANDIDATE",
  candidateCount: 0,
  directCapabilityMatchCount: 0,
  topResults: [],
};

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("composeFinalResponse — prompt 內容依結構化狀態分流", () => {
  it("MATCH_FOUND：prompt 明確告知候選數與直接符合數，允許有信心地說明", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("MATCH_FOUND 的意思");
    expect(prompt).toContain("測試五軸廠");
    expect(prompt).toContain("可以自然、有信心地說明找到了符合的工廠");
  });

  it("SIMILAR_ONLY：prompt 明確要求先講「真正需求沒找到」再帶出相似工廠，兩件事分開講", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: SIMILAR_ONLY_INPUT, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("SIMILAR_ONLY 的意思");
    expect(prompt).toContain("先誠實講清楚「真正要的能力目前沒有在平台上明確找到」");
    expect(prompt).toContain("測試一般廠");
  });

  it("NO_HARD_CANDIDATE：prompt 明確禁止提到任何工廠名稱或列出候選", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: NO_HARD_CANDIDATE_INPUT, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("NO_HARD_CANDIDATE 的意思");
    expect(prompt).toContain("絕對不能提到任何工廠名稱或列出候選");
    expect(prompt).toContain("絕對不能拿之前其他輪搜尋過的工廠來充數");
  });

  it("isFreshSearch=false 時，prompt 明確告知這是延續舊 snapshot、這一輪沒有重新查", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: { ...MATCH_FOUND_INPUT, isFreshSearch: false }, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("這一輪沒有重新搜尋");
  });
});

describe("composeFinalResponse — action 執行結果如何影響 prompt（見「九」）", () => {
  it("action=null（沒有觸發任何 action）→ prompt 明確禁止提到「已經交給OXM」", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("絕對不能提到「已經交給OXM」");
  });

  it("request_factory_sourcing + outcome=succeeded → prompt 允許陳述語氣講「已經交給OXM」", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    const action: ComposerActionInput = { action: "request_factory_sourcing", reasonCategory: "capability_gap", outcome: "succeeded" };
    await composeFinalResponse({ history: [], factorySearch: SIMILAR_ONLY_INPUT, action });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("已經真的成功寫入資料庫");
    expect(prompt).toContain("找到後會用站內信通知你");
  });

  it("request_factory_sourcing + outcome=failed → prompt 明確禁止講「已經交給OXM」，要求誠實告知失敗", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    const action: ComposerActionInput = { action: "request_factory_sourcing", reasonCategory: "capability_gap", outcome: "failed" };
    await composeFinalResponse({ history: [], factorySearch: SIMILAR_ONLY_INPUT, action });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("絕對不能說「已經交給OXM」");
    expect(prompt).toContain("寫入資料庫失敗了");
  });

  it("cancel_factory_sourcing + outcome=succeeded → prompt 要求自然回應不需要協尋", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    const action: ComposerActionInput = { action: "cancel_factory_sourcing", reasonCategory: "other", outcome: "succeeded" };
    await composeFinalResponse({ history: [], factorySearch: SIMILAR_ONLY_INPUT, action });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("已經真的取消成功");
  });
});

describe("composeFinalResponse — 語氣與長度規則、防禦性 parse", () => {
  it("prompt 包含手機聊天的語氣長度硬規則與禁止編造工廠名稱", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "x" }));
    await composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null });
    const prompt = mockCompleteJson.mock.calls[0][0][0].content as string;
    expect(prompt).toContain("最多 90 個中文字");
    expect(prompt).toContain("絕對不要自己編造工廠名稱或細節");
  });

  it("模型回傳合法 finalReply 時原樣回傳", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "已經幫你找到符合的工廠。" }));
    const reply = await composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null });
    expect(reply).toBe("已經幫你找到符合的工廠。");
  });

  it("finalReply 空字串時拋錯（不能讓空文字流到使用者畫面）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ finalReply: "" }));
    await expect(composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null })).rejects.toThrow();
  });

  it("finalReply 缺漏時拋錯", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({}));
    await expect(composeFinalResponse({ history: [], factorySearch: MATCH_FOUND_INPUT, action: null })).rejects.toThrow();
  });
});
