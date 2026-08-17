/**
 * 見對話中「非 OXM 純閒聊收斂機制」二階段設計：checkOutOfDomainResumeRelevance
 * 是 warned／paused 狀態下唯一允許的輕量判斷——只丟最新一句話，不帶歷史／
 * Service Registry／Enterprise Memory。不打真實 OpenAI API：mock provider.ts，
 * 順便驗證呼叫時「只傳了最新一句話」而不是完整逐字稿。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCompleteJson = vi.fn();
const mockGetAiChatProvider = vi.fn(() => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }));
vi.mock("./provider", () => ({
  getAiChatProvider: (...args: unknown[]) => mockGetAiChatProvider(...args),
}));

import { checkOutOfDomainResumeRelevance } from "./casualPauseGate";

beforeEach(() => {
  mockCompleteJson.mockReset();
  mockGetAiChatProvider.mockClear();
});

describe("checkOutOfDomainResumeRelevance", () => {
  it("relevant=true → 回傳 true", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ relevant: true }));
    const result = await checkOutOfDomainResumeRelevance("幫我找台中的金屬加工廠");
    expect(result).toBe(true);
  });

  it("relevant=false → 回傳 false", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ relevant: false }));
    const result = await checkOutOfDomainResumeRelevance("豬排飯呢？");
    expect(result).toBe(false);
  });

  it("用 casualPauseGate layer 取得 provider（獨立於 Layer 1/2 的模型設定）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ relevant: true }));
    await checkOutOfDomainResumeRelevance("測試");
    expect(mockGetAiChatProvider).toHaveBeenCalledWith("casualPauseGate");
  });

  it("只傳最新一句話當 user message，不帶任何歷史／Service Registry／Enterprise Memory", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({ relevant: true }));
    await checkOutOfDomainResumeRelevance("你喜歡什麼咖啡？");
    const messages = mockCompleteJson.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "你喜歡什麼咖啡？" });
  });

  it("JSON parse 失敗 → 保守 fallback 為 true（避免使用者卡在 paused 出不來）", async () => {
    mockCompleteJson.mockResolvedValue("不是合法 JSON");
    const result = await checkOutOfDomainResumeRelevance("測試");
    expect(result).toBe(true);
  });

  it("provider 拋出錯誤 → 保守 fallback 為 true", async () => {
    mockCompleteJson.mockRejectedValue(new Error("API 出錯"));
    const result = await checkOutOfDomainResumeRelevance("測試");
    expect(result).toBe(true);
  });

  it("relevant 欄位不是 boolean（例如缺漏）→ 保守 fallback 為 true", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({}));
    const result = await checkOutOfDomainResumeRelevance("測試");
    expect(result).toBe(true);
  });
});
