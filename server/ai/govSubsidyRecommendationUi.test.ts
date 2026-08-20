import { describe, expect, it } from "vitest";
import { buildGovSubsidyRecommendationForUi } from "./govSubsidyRecommendationUi";
import type { GovSubsidyRecommendation } from "./routing";

/**
 * Phase 7.1（見對話中「P0-2：Government Subsidy Recommendation 專屬 UI」）：
 * 這裡只驗證 transport / type mapping 本身——primaryProgramKey／
 * secondaryProgramKey 轉成 UI 形狀時有沒有正確用 shared/ai/serviceRegistry.ts
 * 查名稱、null secondary 有沒有正確被省略、資訊不足（primaryProgramKey
 * null）時有沒有正確不產生 attachment。不驗證 routing.ts 本身「該推薦哪個
 * 方向」的判斷邏輯——那不是這一輪的範圍。
 */
describe("buildGovSubsidyRecommendationForUi", () => {
  it("C: 組出 primary/secondary display name + reasoning + missingInformation（最多 3 筆）", () => {
    const rec: GovSubsidyRecommendation = {
      primaryProgramKey: "citd",
      secondaryProgramKey: "sbir",
      reasoning: "使用者提到既有產線轉型，符合 CITD 情境。",
      missingInformation: ["研發成熟度", "設備用途", "海外布局階段", "第四項應被截掉"],
    };
    const ui = buildGovSubsidyRecommendationForUi(rec);
    expect(ui).not.toBeNull();
    expect(ui!.primaryProgramKey).toBe("citd");
    expect(ui!.primaryProgramName).toBeTruthy();
    expect(ui!.secondaryProgramKey).toBe("sbir");
    expect(ui!.secondaryProgramName).toBeTruthy();
    expect(ui!.primaryProgramName).not.toBe(ui!.secondaryProgramName);
    expect(ui!.reasoning).toBe(rec.reasoning);
    expect(ui!.missingInformation).toHaveLength(3);
  });

  it("D: secondaryProgramKey 是 null 時，secondaryProgramKey／secondaryProgramName 都是 null（不是空字串）", () => {
    const rec: GovSubsidyRecommendation = {
      primaryProgramKey: "citd",
      secondaryProgramKey: null,
      reasoning: "只有一個明顯方向。",
      missingInformation: [],
    };
    const ui = buildGovSubsidyRecommendationForUi(rec);
    expect(ui).not.toBeNull();
    expect(ui!.secondaryProgramKey).toBeNull();
    expect(ui!.secondaryProgramName).toBeNull();
  });

  it("primaryProgramKey 是 null（資訊不足）時不產生 attachment", () => {
    const rec: GovSubsidyRecommendation = {
      primaryProgramKey: null,
      secondaryProgramKey: null,
      reasoning: "還需要更多資訊。",
      missingInformation: ["設備用途"],
    };
    expect(buildGovSubsidyRecommendationForUi(rec)).toBeNull();
  });

  it("routing.govSubsidyRecommendation 本身是 null 時（primaryService 不是 gov_subsidy）不產生 attachment", () => {
    expect(buildGovSubsidyRecommendationForUi(null)).toBeNull();
  });

  it("primaryProgramKey 不是既有 Registry key 時（防禦性）不產生 attachment，不會顯示查無名稱的空卡片", () => {
    const rec = {
      primaryProgramKey: "not_a_real_program_key",
      secondaryProgramKey: null,
      reasoning: "x",
      missingInformation: [],
    } as unknown as GovSubsidyRecommendation;
    expect(buildGovSubsidyRecommendationForUi(rec)).toBeNull();
  });

  it("F: 回傳形狀跟 subsidy_programs_results（Lookup）的欄位完全不同，不會被前端誤判成同一種 attachment", () => {
    const rec: GovSubsidyRecommendation = {
      primaryProgramKey: "citd",
      secondaryProgramKey: null,
      reasoning: "x",
      missingInformation: [],
    };
    const ui = buildGovSubsidyRecommendationForUi(rec)!;
    // Lookup（SubsidyProgramCandidateForUi）用的是 slug／title／highlights／url
    // 這些欄位；Recommendation 用的是 primaryProgramKey／reasoning 這組完全
    // 不同的欄位，兩者結構上不可能互相混淆成同一個 discriminated union case。
    expect(ui).not.toHaveProperty("slug");
    expect(ui).not.toHaveProperty("url");
    expect(ui).not.toHaveProperty("highlights");
    expect(ui).toHaveProperty("primaryProgramKey");
    expect(ui).toHaveProperty("reasoning");
  });
});
