/**
 * server/ai/handoffPrefill.ts 驗證，對應人工驗收發現的核心規則：正式表單
 * 預填唯一資料來源是 ConversationState.confirmedFacts，deterministic 比對，
 * 不重新讀對話逐字稿、不呼叫任何 LLM（見對話中「一、正式表單預填不得重新
 * 從 raw transcript 推論」「五、補強不能猜測測試」CASE A~E）。
 */
import { describe, expect, it } from "vitest";
import { buildFieldSpecs, buildHandoffPrefillFromConfirmedFacts, buildHandoffSummary } from "./handoffPrefill";

describe("buildFieldSpecs", () => {
  it("gov_subsidy：包含 hasPatent/patentCount 依賴關係、decisionMakerParticipation 三個 enum 選項", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const hasPatent = specs.find(s => s.key === "hasPatent");
    const patentCount = specs.find(s => s.key === "patentCount");
    const decisionMaker = specs.find(s => s.key === "decisionMakerParticipation");
    expect(hasPatent?.kind).toBe("boolean");
    expect(patentCount?.dependsOnKey).toBe("hasPatent");
    expect(patentCount?.dependsOnValue).toBe(true);
    expect(decisionMaker?.options?.map(o => o.code).sort()).toEqual(["manager", "owner", "unavailable"]);
  });

  it("erp：只有 needType 一個欄位，選項不包含 unsure（unsure 代表沒有明確方向，不該被當成「確認」）", () => {
    const specs = buildFieldSpecs("erp");
    expect(specs).toHaveLength(1);
    expect(specs[0].key).toBe("needType");
    expect(specs[0].options?.map(o => o.code)).not.toContain("unsure");
  });

  it("certification：目錄為空時回傳空陣列（沒有可預填的服務代碼）", () => {
    expect(buildFieldSpecs("certification", [])).toEqual([]);
  });

  it("certification：目錄有資料時，servicesWanted 選項對應目錄代碼", () => {
    const specs = buildFieldSpecs("certification", [{ code: "iso_9001", name: "ISO 9001" }]);
    const servicesWanted = specs.find(s => s.key === "servicesWanted");
    expect(servicesWanted?.options).toEqual([{ code: "iso_9001", label: "ISO 9001" }]);
  });

  it("short_video：五個欄位齊全（servicesWanted/isUnsure/primaryGoal/platforms/noPlatformYet）", () => {
    const specs = buildFieldSpecs("short_video");
    expect(specs.map(s => s.key).sort()).toEqual(
      ["isUnsure", "noPlatformYet", "platforms", "primaryGoal", "servicesWanted"].sort()
    );
  });

  it("finance：沒有任何業務欄位可預填，回傳空陣列", () => {
    expect(buildFieldSpecs("finance")).toEqual([]);
  });
});

describe("buildHandoffPrefillFromConfirmedFacts — 不能猜測必測案例（CASE A~E）", () => {
  it("CASE A：使用者說「我們公司不大」，沒有 confirmed annualRevenue band → annualRevenue 不得預填", () => {
    // confirmedFacts 裡完全沒有 annualRevenue 這個 key（Layer 1 極度保守規則本來就不會從這句話產生任何級距）。
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: {} });
    expect(result.prefillData.annualRevenue).toBeUndefined();
    expect(result.confirmedFields.annualRevenue).toBeUndefined();
  });

  it("CASE B：confirmedFacts 沒有 decisionMakerParticipation → 不得預填，即使企業背景裡有其他無關事實", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { hasPatent: false } });
    expect(result.prefillData.decisionMakerParticipation).toBeUndefined();
  });

  it("CASE C：confirmedFacts 明確 hasPatent=false → 政府補助表單可填 false，且 provenance 指向 hasPatent", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { hasPatent: false } });
    expect(result.prefillData.hasPatent).toBe(false);
    expect(result.confirmedFields.hasPatent).toEqual({ sourceFact: "hasPatent" });
  });

  it("CASE D：confirmedFacts 沒有 patentCount（即使 raw transcript 曾模糊提過數字）→ 不得填 patentCount", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { hasPatent: true } });
    expect(result.prefillData.patentCount).toBeUndefined();
  });

  it("CASE E：呼叫端如果誤把 Enterprise Memory 當成 confirmedFacts 傳進來也一樣受同一套規則約束（函式本身不知道資料來源，只認得傳進來的 confirmedFacts）——這裡驗證的重點是：呼叫端沒有把它當本輪 confirmedFacts 傳入時，就是不填", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    // 模擬「本輪 confirmedFacts 沒有重新確認」的情況：本輪傳入的 confirmedFacts 是空的。
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: {} });
    expect(result.prefillData.hasPatent).toBeUndefined();
  });

  it("hasPatent=true 且 patentCount=3 都在 confirmedFacts 裡：兩者都正確填入", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { hasPatent: true, patentCount: 3 } });
    expect(result.prefillData).toEqual({ hasPatent: true, patentCount: 3 });
    expect(Object.keys(result.confirmedFields).sort()).toEqual(["hasPatent", "patentCount"]);
  });

  it("decisionMakerParticipation 型別不對（數字而非字串）：不填", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs,
      confirmedFacts: { decisionMakerParticipation: 1 as unknown as string },
    });
    expect(result.prefillData.decisionMakerParticipation).toBeUndefined();
  });

  it("decisionMakerParticipation 值不在白名單裡（不是 owner/manager/unavailable）：不填", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs,
      confirmedFacts: { decisionMakerParticipation: "ceo_will_join" },
    });
    expect(result.prefillData.decisionMakerParticipation).toBeUndefined();
  });

  it("decisionMakerParticipation 值在白名單裡：正確填入", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs,
      confirmedFacts: { decisionMakerParticipation: "owner" },
    });
    expect(result.prefillData.decisionMakerParticipation).toBe("owner");
  });

  it("enumMulti（certification servicesWanted）：confirmedFacts 裡是合法代碼字串時，wrap 成一個元素的陣列", () => {
    const specs = buildFieldSpecs("certification", [{ code: "iso_9001", name: "ISO 9001" }]);
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { servicesWanted: "iso_9001" } });
    expect(result.prefillData.servicesWanted).toEqual(["iso_9001"]);
  });

  it("enumMulti：confirmedFacts 裡的值不在目錄白名單裡：不填", () => {
    const specs = buildFieldSpecs("certification", [{ code: "iso_9001", name: "ISO 9001" }]);
    const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { servicesWanted: "made_up" } });
    expect(result.prefillData.servicesWanted).toBeUndefined();
  });

  it("govProjectName：hasGovProject 沒有同時確認為 true 時，即使 govProjectName 有值也不填", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs,
      confirmedFacts: { govProjectName: "SBIR 小型企業創新研發計畫" },
    });
    expect(result.prefillData.govProjectName).toBeUndefined();
  });

  it("govProjectName：hasGovProject=true 且 govProjectName 有值：兩者都填入", () => {
    const specs = buildFieldSpecs("gov_subsidy");
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs,
      confirmedFacts: { hasGovProject: true, govProjectName: "SBIR 小型企業創新研發計畫" },
    });
    expect(result.prefillData.govProjectName).toBe("SBIR 小型企業創新研發計畫");
  });

  it("finance：specs 為空，任何 confirmedFacts 都不會產生 prefillData", () => {
    const result = buildHandoffPrefillFromConfirmedFacts({
      specs: buildFieldSpecs("finance"),
      confirmedFacts: { hasPatent: false, needType: "erp_adoption" },
    });
    expect(result).toEqual({ prefillData: {}, confirmedFields: {} });
  });
});

describe("Phase 4.1 — derive：從更保守、通用的 confirmedFacts 事實組合出表單欄位值", () => {
  describe("gov_subsidy：isEnterpriseFirm 改由 firmIsBusinessAssoc 這個安全中繼事實推導", () => {
    it("firmIsBusinessAssoc=true → isEnterpriseFirm 填 true，provenance 指向 firmIsBusinessAssoc", () => {
      const specs = buildFieldSpecs("gov_subsidy");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { firmIsBusinessAssoc: true } });
      expect(result.prefillData.isEnterpriseFirm).toBe(true);
      expect(result.confirmedFields.isEnterpriseFirm).toEqual({ sourceFact: "firmIsBusinessAssoc" });
    });

    it("沒有 firmIsBusinessAssoc（即使舊資料剛好有 isEnterpriseFirm 這個 key）：不填，因為欄位已經只認 derive 來源", () => {
      const specs = buildFieldSpecs("gov_subsidy");
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { isEnterpriseFirm: true as unknown as boolean },
      });
      expect(result.prefillData.isEnterpriseFirm).toBeUndefined();
    });
  });

  describe("erp：needType 改由 manualOpsPainPoint／productionLinePainPoint 這兩個通用事實推導", () => {
    it("只有 manualOpsPainPoint=true → needType 填「系統化管理」對應的那個值", () => {
      const specs = buildFieldSpecs("erp");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { manualOpsPainPoint: true } });
      expect(result.prefillData.needType).toBe("erp_adoption");
      expect(result.confirmedFields.needType).toEqual({ sourceFact: "manualOpsPainPoint" });
    });

    it("只有 productionLinePainPoint=true → needType 填「現場動線優化」對應的那個值", () => {
      const specs = buildFieldSpecs("erp");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { productionLinePainPoint: true } });
      expect(result.prefillData.needType).toBe("line_optimization");
    });

    it("manualOpsPainPoint 與 productionLinePainPoint 都成立 → needType 填「整合改善」，provenance 兩個都列", () => {
      const specs = buildFieldSpecs("erp");
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { manualOpsPainPoint: true, productionLinePainPoint: true },
      });
      expect(result.prefillData.needType).toBe("integrated");
      expect(result.confirmedFields.needType).toEqual({ sourceFact: "manualOpsPainPoint+productionLinePainPoint" });
    });

    it("兩者都沒有、也沒有直接 needType：不填", () => {
      const specs = buildFieldSpecs("erp");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: {} });
      expect(result.prefillData.needType).toBeUndefined();
    });

    it("向下相容：confirmedFacts 剛好直接就有合法 needType 時仍然採用（優先於兩個保守事實）", () => {
      const specs = buildFieldSpecs("erp");
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { needType: "erp_adoption", productionLinePainPoint: true },
      });
      expect(result.prefillData.needType).toBe("erp_adoption");
      expect(result.confirmedFields.needType).toEqual({ sourceFact: "needType" });
    });
  });

  describe("certification：servicesWanted 改由每個標準各自獨立的布林事實推導（CASE 3/4）", () => {
    const catalog = [
      { code: "iso-9001", name: "ISO 9001 品質管理系統" },
      { code: "iso-14001", name: "ISO 14001 環境管理系統" },
    ];

    it("CASE 3：certRequestedIso9001=true → servicesWanted 精確填 [\"iso-9001\"]", () => {
      const specs = buildFieldSpecs("certification", catalog);
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { certRequestedIso9001: true } });
      expect(result.prefillData.servicesWanted).toEqual(["iso-9001"]);
      expect(result.confirmedFields.servicesWanted).toEqual({ sourceFact: "certRequestedIso9001" });
    });

    it("CASE 4：沒有任何 certRequestedXxx 事實（模糊的「以後可能要求一些認證」不會產生任何一個）：不填，不會自己猜是哪一張", () => {
      const specs = buildFieldSpecs("certification", catalog);
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: {} });
      expect(result.prefillData.servicesWanted).toBeUndefined();
    });

    it("同時有兩個標準的事實成立：servicesWanted 兩個代碼都填", () => {
      const specs = buildFieldSpecs("certification", catalog);
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { certRequestedIso9001: true, certRequestedIso14001: true },
      });
      expect(result.prefillData.servicesWanted).toEqual(["iso-9001", "iso-14001"]);
    });

    it("certRequestedIso45001=true 但目錄裡沒有這個代碼（admin 已下架／尚未上架）：安全跳過，不塞進目錄不存在的代碼", () => {
      const specs = buildFieldSpecs("certification", catalog);
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { certRequestedIso45001: true } });
      expect(result.prefillData.servicesWanted).toBeUndefined();
    });

    it("向下相容：confirmedFacts.servicesWanted 剛好是目錄合法代碼字串時仍然採用", () => {
      const specs = buildFieldSpecs("certification", catalog);
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { servicesWanted: "iso-9001" } });
      expect(result.prefillData.servicesWanted).toEqual(["iso-9001"]);
    });
  });

  describe("short_video：CASE 5/6/7", () => {
    it("CASE 5：primaryGoal=\"founder_story\" 且 platformInstagram=true → 兩個欄位都精確填入", () => {
      const specs = buildFieldSpecs("short_video");
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { primaryGoal: "founder_story", platformInstagram: true },
      });
      expect(result.prefillData.primaryGoal).toBe("founder_story");
      expect(result.prefillData.platforms).toEqual(["instagram"]);
      expect(result.confirmedFields.platforms).toEqual({ sourceFact: "platformInstagram" });
    });

    it("CASE 6：沒有任何明確事實（「想增加曝光」這種空泛陳述不會產生任何一個）：primaryGoal/servicesWanted/platforms 都不填", () => {
      const specs = buildFieldSpecs("short_video");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: {} });
      expect(result.prefillData.primaryGoal).toBeUndefined();
      expect(result.prefillData.servicesWanted).toBeUndefined();
      expect(result.prefillData.platforms).toBeUndefined();
    });

    it("CASE 7：noPlatformYet=true → 直接填（既有布林欄位，不需要 derive）", () => {
      const specs = buildFieldSpecs("short_video");
      const result = buildHandoffPrefillFromConfirmedFacts({ specs, confirmedFacts: { noPlatformYet: true } });
      expect(result.prefillData.noPlatformYet).toBe(true);
    });

    it("platformInstagram 與 platformFacebook 都成立：platforms 兩個代碼都填", () => {
      const specs = buildFieldSpecs("short_video");
      const result = buildHandoffPrefillFromConfirmedFacts({
        specs,
        confirmedFacts: { platformInstagram: true, platformFacebook: true },
      });
      expect(result.prefillData.platforms).toEqual(["instagram", "facebook"]);
    });
  });
});

describe("buildHandoffSummary", () => {
  it("三個欄位都有值時，用「；」串接", () => {
    const summary = buildHandoffSummary({
      observedProblem: "訂單變少",
      primaryBusinessDirection: "先看曝光",
      secondaryConcern: "現金流略緊",
    });
    expect(summary).toBe("訂單變少；先看曝光；現金流略緊");
  });

  it("全部是 null：回傳固定的保底文字，不是空字串", () => {
    const summary = buildHandoffSummary({ observedProblem: null, primaryBusinessDirection: null, secondaryConcern: null });
    expect(summary).toBe("使用者主動要求轉交顧問，對話中未產生明確摘要文字。");
  });
});
