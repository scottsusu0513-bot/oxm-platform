/**
 * Phase 6D：OxmPlatformHelpRegistry 結構完整性驗證（見對話中「不要讓 Help
 * Registry 自己保存任意 URL」）。
 */
import { describe, expect, it } from "vitest";
import { OXM_PLATFORM_HELP_REGISTRY, getPlatformHelpTopic } from "../../shared/ai/platformHelpRegistry";
import { getNavigationEntry } from "../../shared/ai/navigationRegistry";

describe("OXM_PLATFORM_HELP_REGISTRY 結構完整性", () => {
  it("key 唯一", () => {
    const keys = OXM_PLATFORM_HELP_REGISTRY.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每個主題都有 title／userIntentExamples／answerSummary／steps，內容不是空的", () => {
    for (const topic of OXM_PLATFORM_HELP_REGISTRY) {
      expect(topic.title.trim().length).toBeGreaterThan(0);
      expect(topic.userIntentExamples.length).toBeGreaterThan(0);
      expect(topic.answerSummary.trim().length).toBeGreaterThan(0);
      expect(topic.steps.length).toBeGreaterThan(0);
    }
  });

  it("steps 控制在 2～5 個，符合「操作說明要短」的規則", () => {
    for (const topic of OXM_PLATFORM_HELP_REGISTRY) {
      expect(topic.steps.length).toBeGreaterThanOrEqual(2);
      expect(topic.steps.length).toBeLessThanOrEqual(5);
    }
  });

  it("relatedRoute 一律是 OXM_NAVIGATION_REGISTRY 裡真實存在的 key，不是原始 URL 或不存在的 key（見「十」）", () => {
    for (const topic of OXM_PLATFORM_HELP_REGISTRY) {
      if (topic.relatedRoute == null) continue;
      expect(topic.relatedRoute).not.toMatch(/^\//); // 不能是原始路徑字串
      expect(topic.relatedRoute).not.toMatch(/^https?:\/\//); // 不能是完整 URL
      const entry = getNavigationEntry(topic.relatedRoute);
      expect(entry, `relatedRoute "${topic.relatedRoute}" 必須對應到真實的 Navigation Registry key`).toBeDefined();
    }
  });

  it("getPlatformHelpTopic 可以正確查到已知 key，查不到的 key 回傳 undefined", () => {
    expect(getPlatformHelpTopic("factory_search_usage")?.title).toBe("找工廠怎麼操作");
    expect(getPlatformHelpTopic("made_up_topic")).toBeUndefined();
  });

  it("V1 涵蓋二十一節列出的主要範圍：註冊登入／找工廠／刊登工廠／修改資料／工廠審核／詢價／找消息／政府補助（專區＋申請）／ERP／ISO／短影音／財務／站內導覽", () => {
    const keys = new Set(OXM_PLATFORM_HELP_REGISTRY.map(t => t.key));
    for (const expected of [
      "registration_login", "factory_search_usage", "factory_listing", "factory_edit",
      "factory_approval", "inquiry_contact", "news_usage",
      "government_subsidy_center", "government_subsidy_application",
      "erp_center", "certification_center", "short_video_center", "finance_center",
      "site_navigation_overview",
    ]) {
      expect(keys.has(expected), `缺少預期的 help topic: ${expected}`).toBe(true);
    }
  });
});
