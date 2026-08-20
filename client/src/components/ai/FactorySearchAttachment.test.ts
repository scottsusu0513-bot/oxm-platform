import { describe, expect, it } from "vitest";
import {
  factoryTierBadgeClassName,
  factoryMatchReasonClassName,
  factoryAttachmentHasCaution,
  type FactorySearchCandidateForUi,
} from "./FactorySearchAttachment";

function candidate(overrides: Partial<FactorySearchCandidateForUi>): FactorySearchCandidateForUi {
  return {
    factory: {
      id: 1,
      companyName: "測試工廠",
      region: "台中市",
      industry: [],
      subIndustry: [],
      avgRating: 0,
      reviewCount: 0,
      certified: false,
    },
    relevanceTier: "high",
    matchReason: "公開資料明確提到你說的能力關鍵字",
    url: "/factories/1",
    ...overrides,
  };
}

describe("factoryMatchReasonClassName (Phase 7.1 P0-1：SIMILAR_ONLY 誠實呈現)", () => {
  it("A: 三個 tier 都不再用單行 truncate（會把 buildMatchReason 附加的免責句截斷看不到）", () => {
    (["high", "medium", "general"] as const).forEach(tier => {
      const className = factoryMatchReasonClassName(tier);
      expect(className).not.toContain("truncate");
      expect(className).toContain("line-clamp");
      expect(className).toContain("whitespace-pre-wrap");
    });
  });

  it("B: general（SIMILAR_ONLY）用警示色（amber），跟 high／medium 明確不同", () => {
    expect(factoryMatchReasonClassName("general")).toContain("amber");
    expect(factoryMatchReasonClassName("high")).not.toContain("amber");
    expect(factoryMatchReasonClassName("medium")).not.toContain("amber");
  });
});

describe("factoryTierBadgeClassName (Phase 7.1 P0-1：MATCH_FOUND／SIMILAR_ONLY 視覺分流)", () => {
  it("B: general 跟 high 的 badge className 明確不同（不是同一份樣式）", () => {
    expect(factoryTierBadgeClassName("general")).not.toBe(factoryTierBadgeClassName("high"));
    expect(factoryTierBadgeClassName("general")).not.toBe(factoryTierBadgeClassName("medium"));
  });

  it("general 帶警示色（amber），不是品牌橘色——避免暗示已確認具備能力", () => {
    expect(factoryTierBadgeClassName("general")).toContain("amber");
    expect(factoryTierBadgeClassName("general")).not.toContain("orange");
  });
});

describe("factoryAttachmentHasCaution (Phase 7.1 P0-1：attachment header 一次性提醒)", () => {
  it("candidates 裡有 general tier 時回傳 true", () => {
    expect(factoryAttachmentHasCaution([candidate({ relevanceTier: "high" }), candidate({ relevanceTier: "general" })])).toBe(
      true
    );
  });

  it("candidates 全部是 high／medium 時回傳 false（不多顯示一個用不到的警示）", () => {
    expect(factoryAttachmentHasCaution([candidate({ relevanceTier: "high" }), candidate({ relevanceTier: "medium" })])).toBe(
      false
    );
  });

  it("空陣列回傳 false", () => {
    expect(factoryAttachmentHasCaution([])).toBe(false);
  });
});
