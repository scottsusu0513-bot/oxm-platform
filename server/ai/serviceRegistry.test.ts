/**
 * Phase 6E：OXM 顧問服務知識中心化——shared/ai/serviceRegistry.ts 的
 * serviceScope／notIncluded 擴充驗證（見對話中「不要編造服務範圍」）。
 */
import { describe, expect, it } from "vitest";
import { AI_SERVICE_REGISTRY, getServiceDefinition } from "../../shared/ai/serviceRegistry";

const CONSULTANT_BACKED_KEYS = ["gov_subsidy", "erp", "certification", "short_video", "finance"];

describe("AI_SERVICE_REGISTRY — key 唯一性與基本結構", () => {
  it("所有 key 唯一", () => {
    const keys = AI_SERVICE_REGISTRY.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("getServiceDefinition 可以查到已知 key，查不到的 key 回傳 undefined", () => {
    expect(getServiceDefinition("erp")?.displayName).toBe("ERP／生產管理");
    expect(getServiceDefinition("made_up_service")).toBeUndefined();
  });
});

describe("Phase 6E：五個顧問型服務都有 serviceScope／notIncluded（見「三：不要為了湊 schema 過度設計」，只在需要的服務上加）", () => {
  for (const key of CONSULTANT_BACKED_KEYS) {
    it(`${key} 有非空的 serviceScope 與 notIncluded`, () => {
      const service = getServiceDefinition(key);
      expect(service).toBeDefined();
      expect(service!.serviceScope && service!.serviceScope.length).toBeGreaterThan(0);
      expect(service!.notIncluded && service!.notIncluded.trim().length).toBeGreaterThan(0);
    });
  }

  it("找工廠／找消息不需要 serviceScope（不是「顧問型服務」，見 VALID_SERVICE_INFO_TARGETS 的排除邏輯）", () => {
    const factorySearch = getServiceDefinition("factory_search");
    const news = getServiceDefinition("news");
    expect(factorySearch?.serviceScope).toBeUndefined();
    expect(news?.serviceScope).toBeUndefined();
  });
});

describe("Phase 6E：真實服務範圍內容準確性（見對話中實際 inspect 各服務頁面/表單的結果）", () => {
  it("ERP：涵蓋 ERP 導入與產線動線優化兩種路徑，不只是「導入 ERP 系統」", () => {
    const erp = getServiceDefinition("erp")!;
    expect(erp.whatItIs).toContain("產線");
    expect(erp.serviceScope!.join(" ")).toContain("動線");
    expect(erp.notIncluded).toContain("不是 ERP 或 MES 產品品牌");
  });

  it("ISO／低碳：serviceScope 涵蓋真實的 9 個項目（5 ISO + 2 碳盤查 + 2 政府碳標籤）", () => {
    const cert = getServiceDefinition("certification")!;
    const scopeText = cert.serviceScope!.join(" ");
    for (const std of ["9001", "14001", "45001", "50001", "27001", "溫室氣體盤查", "產品碳足跡", "碳標籤"]) {
      expect(scopeText).toContain(std);
    }
    expect(cert.notIncluded).toContain("不自行核發");
  });

  it("短影音／品牌：serviceScope 涵蓋真實的 5 項服務（不只短影音拍攝）", () => {
    const shortVideo = getServiceDefinition("short_video")!;
    const scopeText = shortVideo.serviceScope!.join(" ");
    for (const item of ["短影音企劃與拍攝", "KOL", "社群內容代操", "新聞媒體露出", "訪談製作"]) {
      expect(scopeText).toContain(item);
    }
  });

  it("企業財務優化：涵蓋合法節稅（原本 whatItIs 曾經漏掉），不只是融資與現金流", () => {
    const finance = getServiceDefinition("finance")!;
    expect(finance.whatItIs).toContain("節稅");
    expect(finance.serviceScope!.join(" ")).toContain("節稅");
  });

  it("政府補助：serviceScope 描述的是服務本身（陪同盤點、媒合方向），不是條列實際方案名稱", () => {
    const govSubsidy = getServiceDefinition("gov_subsidy")!;
    expect(govSubsidy.serviceScope).toBeDefined();
    // 服務知識不應該是方案清單本身（方案清單另有 upgradePrograms DB 真實來源）。
    expect(govSubsidy.serviceScope!.join(" ")).not.toContain("SBIR");
  });
});

describe("Phase 6G.1：政府補助六大方向都有 fitSignals／cautionSignals／comparisonNotes（Program Decision Layer 的唯一知識來源，見對話中「政府補助 Program Decision Layer」）", () => {
  const programs = getServiceDefinition("gov_subsidy")!.govSubsidyPrograms!;

  it("六大方向 key 齊全且唯一", () => {
    const keys = programs.map(p => p.key);
    expect(new Set(keys)).toEqual(new Set(["sbir", "citd", "siir", "transformation", "overseas_expansion", "manufacturing_19plus1"]));
  });

  for (const key of ["sbir", "citd", "siir", "transformation", "overseas_expansion", "manufacturing_19plus1"]) {
    it(`${key} 有非空的 fitSignals／cautionSignals／comparisonNotes`, () => {
      const p = programs.find(x => x.key === key)!;
      expect(p).toBeDefined();
      expect(p.fitSignals && p.fitSignals.length).toBeGreaterThan(0);
      expect(p.cautionSignals && p.cautionSignals.length).toBeGreaterThan(0);
      expect(p.comparisonNotes && p.comparisonNotes.trim().length).toBeGreaterThan(0);
    });
  }

  it("19+1 的 cautionSignals 明確禁止「付1萬拿19萬現金」的誤描述（見既有 19+1 資料一致性修正）", () => {
    const p = programs.find(x => x.key === "manufacturing_19plus1")!;
    expect(p.cautionSignals!.join(" ")).toContain("不能把經費結構描述成");
  });

  it("SIIR 的 fitSignals 明確允許製造業做服務／商業模式創新（不要看到製造業就自動排除 SIIR）", () => {
    const p = programs.find(x => x.key === "siir")!;
    expect(p.fitSignals!.join(" ")).toContain("即使企業本身是製造業");
  });

  it("CITD 的 cautionSignals 明確要求先確認設備跟研發／製程升級的關係，不是單純買設備就判為 CITD", () => {
    const p = programs.find(x => x.key === "citd")!;
    expect(p.cautionSignals!.join(" ")).toContain("不應該直接判斷為 CITD");
  });
});

describe("Phase 6H.1：19+1 profile 文字精簡後，13 類核心事實逐項保留（見對話中「P0 Token Optimization / 低風險 Context 去重」）", () => {
  const p19 = AI_SERVICE_REGISTRY.find(s => s.key === "gov_subsidy")!.govSubsidyPrograms!.find(p => p.key === "manufacturing_19plus1")!;

  it("1. 正式方案定位（產業競爭力輔導團／19+1／經濟部／工研院／製造業）", () => {
    expect(p19.profile).toContain("產業競爭力輔導團");
    expect(p19.profile).toContain("19+1");
    expect(p19.profile).toContain("經濟部");
    expect(p19.profile).toContain("工業技術研究院");
  });

  it("2. AI 診斷／輔導入口", () => {
    expect(p19.profile).toContain("前段診斷入口");
  });

  it("3. 不是 SBIR／CITD 式直接企業研發補助", () => {
    expect(p19.profile).toContain("不是 SBIR／CITD 那種");
    expect(p19.profile).toContain("直接拿一筆研發補助款");
  });

  it("4/7. 不是企業直接拿 19 萬現金，且明確糾正「付1萬拿19萬」的錯誤理解（R12）", () => {
    expect(p19.profile).toContain("不可說成「企業付 1 萬就拿到 19 萬現金」");
  });

  it("5. 政府支付輔導／行政費用的真實結構（19萬＋3.15萬皆政府負擔）", () => {
    expect(p19.profile).toContain("19 萬元輔導診斷費");
    expect(p19.profile).toContain("3.15 萬元行政作業費");
    expect(p19.profile).toContain("皆政府負擔，非企業支出");
  });

  it("6. 企業自籌 1 萬的正確描述", () => {
    expect(p19.profile).toContain("企業僅自籌 1 萬元");
  });

  it("8. AI 場景模糊時適合先診斷（R10 依據）", () => {
    expect(p19.profile).toContain("企業對 AI 場景仍模糊");
    expect(p19.profile).toContain("19+1 優先度高");
  });

  it("9/10. 已有明確 PoC／產品化方向時應轉向 CITD／SBIR／研發轉型（R11 依據）", () => {
    expect(p19.profile).toContain("完成 PoC");
    expect(p19.profile).toContain("應轉向 CITD／SBIR／研發轉型評估");
  });

  it("11. 後續資源是接續階段，不是同時發一包（不可簡化成一次拿到42萬現金）", () => {
    expect(p19.profile).toContain("後續為接續階段");
    expect(p19.profile).toContain("不可簡化成「企業一次拿到 42 萬現金」");
  });

  it("12. 16+4／適用限制等重要資訊", () => {
    expect(p19.profile).toContain("16+4");
    expect(p19.profile).toContain("不得再申請 115－116 年度 19+1");
  });

  it("13. 年度／資格仍以正式公告與真人顧問為準", () => {
    expect(p19.profile).toContain("逐年變動的政府計畫");
    expect(p19.profile).toContain("真人顧問");
  });
});
