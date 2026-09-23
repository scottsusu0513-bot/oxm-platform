import { afterEach, describe, expect, it, vi } from "vitest";
import { detectNaturalLanguageMarker, classifySearchQuery, type SearchRoute } from "./search-query-router";

vi.mock("./factory-name-index", () => ({
  memoryFactoryNameMatch: vi.fn(),
}));
import { memoryFactoryNameMatch } from "./factory-name-index";

const SEMANTIC_CASES: string[] = [
  "我要找可以做少量不鏽鋼零件的工廠",
  "有沒有可以做食品級矽膠的廠商",
  "我需要做100個鋁合金外殼",
  "哪間工廠可以幫我開模又射出",
  "幫我找可以接小量打樣的CNC工廠",
  "我想找能做醫療產品的塑膠射出廠",
];

// Phase 2 設計：產品／製程／taxonomy／複合條件詞一律不再靠文字型態判 DIRECT
// （見 server/search-query-router.ts 檔頭「為什麼不是 Phase 1 設計」），
// detectNaturalLanguageMarker 對這些詞應該都回傳 null（不是自然語言句）。
const NON_SEMANTIC_CASES: string[] = [
  "創普",
  "創普科技股份有限公司",
  "油封",
  "CNC",
  "金屬加工",
  "塑膠",
  "橡膠",
  "矽膠",
  "線材",
  "電纜",
  "線束",
  "線組加工",
  "連接器",
  "端子",
  "雷射切割",
  "沖壓",
  "射出",
  "模具",
  "桃園金屬加工",
  "食品級矽膠密封件",
];

describe("detectNaturalLanguageMarker（純函式、同步、不呼叫 DB）", () => {
  it.each(SEMANTIC_CASES)("「%s」命中自然語言 marker", (q) => {
    expect(detectNaturalLanguageMarker(q)).not.toBeNull();
  });

  it.each(NON_SEMANTIC_CASES)("「%s」不命中自然語言 marker", (q) => {
    expect(detectNaturalLanguageMarker(q)).toBeNull();
  });

  it("空字串／純空白回傳 null", () => {
    expect(detectNaturalLanguageMarker("")).toBeNull();
    expect(detectNaturalLanguageMarker("   ")).toBeNull();
  });

  it("marker 用完整動詞／疑問片語（例如「可以做」），公司名稱裡單獨出現「可以」兩個字不會誤判", () => {
    // 「可以」本身不在 SEMANTIC_MARKERS 清單裡（清單是「可以做」「能不能做」
    // 「能做」這種更長、更明確的片語），所以即使公司名稱剛好包含「可以」也
    // 不會被誤判成自然語言句（見對話中「公司全名不要因為包含『可以』之類
    // 公司名稱中文字而錯判」）。
    expect(detectNaturalLanguageMarker("可以創普科技有限公司")).toBeNull();
  });
});

describe("classifySearchQuery — orchestration（memoryFactoryNameMatch 被 mock，不碰真實 DB／記憶體索引）", () => {
  afterEach(() => {
    vi.mocked(memoryFactoryNameMatch).mockReset();
  });

  it("自然語言句 → SEMANTIC，完全不呼叫 memoryFactoryNameMatch", async () => {
    const result = await classifySearchQuery("我要找可以做少量不鏽鋼零件的工廠");
    expect(result.route).toBe<SearchRoute>("SEMANTIC");
    expect(memoryFactoryNameMatch).not.toHaveBeenCalled();
  });

  it("「我要找創普能不能做這個產品」→ SEMANTIC 優先於工廠名稱命中（即使包含「創普」）", async () => {
    // precedence 驗證：即使關鍵字裡包含一個明確工廠名稱，只要整句是自然語言
    // 需求句，就不應該去查 memoryFactoryNameMatch（見對話中「明顯自然語言需求
    // 優先 SEMANTIC」）。
    const result = await classifySearchQuery("我要找創普能不能做這個產品");
    expect(result.route).toBe<SearchRoute>("SEMANTIC");
    expect(memoryFactoryNameMatch).not.toHaveBeenCalled();
  });

  it("strong name exact match → DIRECT", async () => {
    vi.mocked(memoryFactoryNameMatch).mockResolvedValue({ factoryId: 1, tier: "exact" });
    const result = await classifySearchQuery("創普科技股份有限公司");
    expect(result.route).toBe<SearchRoute>("DIRECT");
    expect(result.reason).toBe("strong_factory_name_match:exact");
  });

  it("strong name unique prefix match → DIRECT", async () => {
    vi.mocked(memoryFactoryNameMatch).mockResolvedValue({ factoryId: 1, tier: "prefix" });
    const result = await classifySearchQuery("創普");
    expect(result.route).toBe<SearchRoute>("DIRECT");
    expect(result.reason).toBe("strong_factory_name_match:prefix");
  });

  it.each(["油封", "CNC", "金屬加工", "線束", "連接器", "雷射切割", "射出", "模具", "食品級矽膠密封件", "桃園金屬加工"])(
    "沒有 strong name match（「%s」）→ HYBRID，不再因為是產品／製程／taxonomy 詞就 DIRECT",
    async (q) => {
      vi.mocked(memoryFactoryNameMatch).mockResolvedValue(null);
      const result = await classifySearchQuery(q);
      expect(result.route).toBe<SearchRoute>("HYBRID");
      expect(result.reason).toBe("no_strong_name_match");
    },
  );

  it("空字串 → HYBRID，不呼叫 memoryFactoryNameMatch", async () => {
    const result = await classifySearchQuery("   ");
    expect(result.route).toBe<SearchRoute>("HYBRID");
    expect(memoryFactoryNameMatch).not.toHaveBeenCalled();
  });
});

describe("classifySearchQuery — performance（排除真實 DB／記憶體索引開銷，只測 orchestration 本身）", () => {
  it("1,000 次呼叫（memoryFactoryNameMatch mock 立即 resolve）應該很快完成", async () => {
    vi.mocked(memoryFactoryNameMatch).mockResolvedValue(null);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      await classifySearchQuery(`測試關鍵字${i}`);
    }
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
