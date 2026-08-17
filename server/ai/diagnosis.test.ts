/**
 * Layer 1（企業診斷層）最重要的硬規則驗證：這一層的 prompt 絕對不能出現
 * 任何 OXM 服務名稱或 Service Registry 內容——這是 Phase 1.1 要修的核心問題
 * （模型同一次生成同時看到使用者問題跟完整服務清單，導致提前配對服務）。
 * 這裡直接用 AI_SERVICE_REGISTRY 的真實資料反查，不寫死字串清單，未來新增
 * 服務時這個測試會自動涵蓋到新服務名稱，不需要手動維護。
 */
import { describe, expect, it, vi } from "vitest";
import { AI_SERVICE_REGISTRY } from "../../shared/ai/serviceRegistry";
import { buildDiagnosisPrompt } from "./diagnosis";

describe("buildDiagnosisPrompt — 絕對看不到 Service Registry", () => {
  const prompt = buildDiagnosisPrompt(null);

  it("不包含任何服務的 displayName 或 key", () => {
    for (const service of AI_SERVICE_REGISTRY) {
      expect(prompt).not.toContain(service.displayName);
      expect(prompt).not.toContain(service.key);
    }
  });

  it("不包含任何政府補助六大方向的名稱", () => {
    const govSubsidy = AI_SERVICE_REGISTRY.find(s => s.key === "gov_subsidy");
    expect(govSubsidy?.govSubsidyPrograms?.length).toBeGreaterThan(0);
    for (const program of govSubsidy?.govSubsidyPrograms ?? []) {
      expect(prompt).not.toContain(program.name);
    }
  });

  it("不包含「Service Registry」「服務清單」等會暗示有服務資料庫存在的字樣（不檢查「OXM」三個字本身，因為企業背景區塊在沒有工廠資料時會中性提到「尚未在 OXM 建立工廠資料」，那只是平台名稱，不是服務資訊）", () => {
    expect(prompt).not.toMatch(/service registry/i);
    expect(prompt).not.toContain("服務清單");
  });

  it("有企業背景區塊，且企業背景不會意外帶入服務資訊", () => {
    expect(prompt).toContain("企業背景");
  });
});

describe("buildDiagnosisPrompt — 具備多層追問的診斷原則", () => {
  const prompt = buildDiagnosisPrompt(null);

  it("包含「先問原因不下結論」的多層診斷指示", () => {
    expect(prompt).toContain("bottleneckStatus");
    expect(prompt).toMatch(/unclear/);
    expect(prompt).toMatch(/emerging/);
    expect(prompt).toMatch(/clear/);
  });

  it("要求輸出結構化 JSON 且欄位齊全", () => {
    for (const field of [
      "observedProblem",
      "likelyBottleneck",
      "bottleneckStatus",
      "evidence",
      "alternativeHypotheses",
      "secondaryConcern",
      "recommendedBusinessDirection",
      "nextBestQuestion",
      "shouldStopQuestioning",
      "userWantsAction",
      "confirmedFacts",
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it("confirmedFacts 規則要求極度保守，明確舉例禁止從模糊描述反推數值", () => {
    expect(prompt).toContain("confirmedFacts 極度保守");
    expect(prompt).toContain("annualRevenue");
    expect(prompt).toContain("不確定");
  });

  it("規則 5b：明確要求檢查既有 unresolvedQuestion 是否已被新事實回答，禁止同義重問，並用「0行銷」具體案例校準（見「OXM AI 已完成功能整體驗收修正」十九／二十）", () => {
    expect(prompt).toContain("這一輪的 nextBestQuestion 絕對不能是同一個問題、也不能是換句話說的同義問法");
    expect(prompt).toContain("目前完全沒有行銷");
    expect(prompt).toContain("行銷方式是否需要調整");
  });
});

describe("buildDiagnosisPrompt — Phase 4.1：擴充 confirmedFacts 校準規則", () => {
  const prompt = buildDiagnosisPrompt(null);

  it("涵蓋五個服務目前可 handoff 的保守事實 key（不含服務名稱本身，只是通用企業體質／現況事實）", () => {
    for (const key of [
      "patentCount", "hasGovProject", "govProjectName", "hasAppliedForSubsidy",
      "decisionMakerParticipation", "annualRevenue", "employeeCount", "factoryType",
      "firmIsBusinessAssoc", "exportMode",
      "manualOpsPainPoint", "productionLinePainPoint",
      "certRequestedIso9001", "certRequestedIso14001", "certRequestedIso45001",
      "certRequestedIso50001", "certRequestedIso27001",
      "certRequestedCarbonInventory", "certRequestedProductCarbonFootprint",
      "primaryGoal", "platformInstagram", "platformFacebook", "platformTiktok", "platformYoutube",
      "noPlatformYet", "isUnsure",
    ]) {
      expect(prompt).toContain(key);
    }
  });

  it("不會出現 Layer 1 不該知道的服務代碼子字串（大小寫敏感，比對真正的自動化硬規則：AI_SERVICE_REGISTRY 的 service.key，例如 erp 服務的 key 是小寫 \"erp\"）——decisionMakerParticipation 這類既有欄位剛好包含大寫 \"erP\" 屬於巧合，不算違規", () => {
    // 這裡故意不用 /erp/i（大小寫不敏感）：decisionMakerParticipation 本身就會誤觸發
    // （...Mak-erP-articipation），那不是真正的服務代稱，只是 camelCase 巧合。
    expect(prompt).not.toContain("erp");
  });

  it("公部門補助相關事實描述時避開「政府補助」四字完整相鄰出現（那是服務顯示名稱的一部分）", () => {
    expect(prompt).not.toContain("政府補助");
  });

  it("案例 8：明確規定 confirmedFacts 只能來自這一輪，不能因為跨對話長期記憶提到類似的事就重複記錄", () => {
    expect(prompt).toContain("跨對話的長期企業記憶");
    expect(prompt).toContain("不能因為「跨對話的長期企業記憶」段落提到類似的事，就把它當成這一輪的新 confirmedFacts 重複記一次");
  });

  it("案例 9：矛盾事實要求輸出最新值覆蓋舊值，不留矛盾狀態", () => {
    expect(prompt).toContain("要直接輸出這一輪最新、正確的值覆蓋舊的");
  });

  it("一、不得為了填表把 AI 對話變成表單訪談：明確禁止因為表單需要就在 nextBestQuestion 裡追問這些細節", () => {
    expect(prompt).toContain("不要因為表單可能用得到某個欄位，就刻意在 nextBestQuestion 裡追問");
  });

  it("空泛表達（想增加曝光／公司不大）仍然明確列為不可反推的負面範例", () => {
    expect(prompt).toContain("想增加曝光");
    expect(prompt).toContain("公司不大");
  });
});

describe("buildDiagnosisPrompt — Phase 6A：明確資源搜尋需求本身即可構成 clear（最小 additive calibration）", () => {
  const prompt = buildDiagnosisPrompt(null, null);

  it("CASE A/B：包含「我要找CNC加工廠」「幫我找台中的金屬加工廠」等具體資源搜尋範例", () => {
    expect(prompt).toContain("我要找CNC加工廠");
    expect(prompt).toContain("幫我找台中的金屬加工廠");
    expect(prompt).toContain("明確、可執行的資源搜尋需求，本身即可構成 clear");
  });

  it("CASE C：完全空泛的「我要找供應商」明確保留在 unclear/emerging 分支，只問一個釐清問題", () => {
    expect(prompt).toContain("我要找供應商");
    expect(prompt).toContain("你主要要找哪一類產品或加工能力？");
  });

  it("CASE D：明確限定這條規則不能誤用到一般企業經營現象（沒訂單／想轉型／想導AI／資金緊）", () => {
    expect(prompt).toContain("絕對不能被拿來把其他一般企業經營現象");
    expect(prompt).toContain("最近沒訂單");
    expect(prompt).toContain("跟這條規則完全無關");
  });

  it("CASE E：即使訊息包含企業背景敘述，只要背後的搜尋需求本身清楚，也不需要重新展開一輪企業診斷", () => {
    expect(prompt).toContain("原供應商要收了");
    expect(prompt).toContain("不需要因為背景資訊而重新展開一輪企業診斷才給 clear");
  });

  it("不是 keyword hardcode：規則本身是語意描述，不是「if includes(...)」這種條件判斷式", () => {
    expect(prompt).not.toMatch(/if\s*\(.*includes/i);
  });

  it("recommendedBusinessDirection 範例仍遵守規則 7：純商業語言，不得出現任何服務／廠商／平台名稱", () => {
    expect(prompt).toContain("需要尋找符合條件的CNC加工合作對象");
    expect(prompt).not.toContain("OXM AI");
  });

  it("不得出現任何 AI_SERVICE_REGISTRY 的 displayName（跟既有硬規則測試同一標準，尤其是「找工廠」三字）", () => {
    for (const service of AI_SERVICE_REGISTRY) {
      expect(prompt).not.toContain(service.displayName);
    }
  });
});

describe("buildDiagnosisPrompt — 既有 state 摘要（Phase 2）", () => {
  it("沒有 previousState 時，明確標示這是第一輪分析", () => {
    const prompt = buildDiagnosisPrompt(null, null);
    expect(prompt).toContain("這是這段對話的第一輪分析");
  });

  it("有 previousState 時，序列化既有理解供 Layer 1 延續判斷，而不是重新從頭猜測", () => {
    const prompt = buildDiagnosisPrompt(null, {
      observedProblem: "訂單變少",
      likelyBottleneck: "價格競爭",
      bottleneckStatus: "emerging",
      primaryBusinessDirection: null,
      confirmedFacts: { hasPatent: false },
    });
    expect(prompt).toContain("訂單變少");
    expect(prompt).toContain("價格競爭");
    expect(prompt).toContain("emerging");
    expect(prompt).toContain('"hasPatent":false');
    expect(prompt).not.toContain("這是這段對話的第一輪分析");
  });
});

describe("buildDiagnosisPrompt — 跨對話 Enterprise Memory（案例 6/7/8）", () => {
  it("沒有 memory 時：明確標示完全沒有過往記錄，跟「有摘要但沒有資訊」是不同狀態", () => {
    const prompt = buildDiagnosisPrompt(null, null, null);
    expect(prompt).toContain("沒有任何過往的企業摘要記錄");
    expect(prompt).toContain("這裡是真的完全沒有任何過去互動");
  });

  it("案例 8：memory 存在但從來沒有有效資訊時，要求誠實說明「聊過但沒有取得足夠資訊」，不能說成完全沒聊過", () => {
    const prompt = buildDiagnosisPrompt(null, null, {
      summaryText: "本次未提供可形成企業判斷的關鍵資訊。",
      hasMeaningfulBusinessInfo: false,
      lastInteractionHadMeaningfulInfo: false,
    });
    expect(prompt).toContain("過去有使用過 OXM AI");
    expect(prompt).toContain("從來沒有留下任何具體的企業資訊");
    expect(prompt).toContain("不能編造具體細節，也不能說成完全沒聊過");
  });

  it("案例 6/7：memory 有實質內容、且最近一次互動也有貢獻時，帶入摘要文字，且明確規定只有相關或使用者主動問才使用", () => {
    const prompt = buildDiagnosisPrompt(null, null, {
      summaryText: "ERP 導入評估中。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true,
    });
    expect(prompt).toContain("ERP 導入評估中。");
    expect(prompt).toContain("高度直接關聯");
    expect(prompt).toContain("除了以上三種情況，一律不得主動提起這段記憶");
  });

  it("新案例：memory 有長期實質內容，但「最近一次」互動沒有新資訊 → 必須誠實區分兩層，不能只講其中一半、也不能誤說成完全沒有記錄", () => {
    const prompt = buildDiagnosisPrompt(null, null, {
      summaryText: "銘板製造；品牌內容方向。",
      hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: false,
    });
    expect(prompt).toContain("最近一次");
    expect(prompt).toContain("沒有提供任何新的企業資訊");
    expect(prompt).toContain("銘板製造；品牌內容方向。");
    expect(prompt).toContain("才需要誠實區分兩層");
    // 本輪修正的核心：不符合 relevance gate 時，不能因為知道「最近一次沒新資訊」這個狀態就主動搬出來講。
    expect(prompt).toContain("不是可以主動拿出來講的理由");
  });
});

describe("buildDiagnosisPrompt — 見「非 OXM 純閒聊收斂機制」：casualTurnDomainRelevant 分類規則", () => {
  const prompt = buildDiagnosisPrompt(null);

  it("prompt 明確區分「跟企業相關的閒聊」與「完全無關的閒聊」，並用具體案例校準", () => {
    expect(prompt).toContain("casualTurnDomainRelevant");
    expect(prompt).toContain("今天工廠真的很煩");
    expect(prompt).toContain("員工真的好難找");
    expect(prompt).toContain("今天天氣真好");
    expect(prompt).toContain("有推薦的咖啡廳嗎");
  });

  it("JSON schema 要求輸出 casualTurnDomainRelevant 欄位", () => {
    expect(prompt).toContain('"casualTurnDomainRelevant": true/false');
  });
});

describe("runEnterpriseDiagnosis — casualTurnDomainRelevant 解析防線", () => {
  async function runWithMockedResponse(response: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("./provider", () => ({
      getAiChatProvider: () => ({
        completeJson: vi.fn().mockResolvedValue(JSON.stringify({
          observedProblem: "test",
          likelyBottleneck: null,
          bottleneckStatus: "unclear",
          evidence: [],
          alternativeHypotheses: [],
          secondaryConcern: null,
          recommendedBusinessDirection: null,
          nextBestQuestion: null,
          shouldStopQuestioning: false,
          userWantsAction: false,
          confirmedFacts: {},
          ...response,
        })),
      }),
    }));
    const { runEnterpriseDiagnosis: freshRunEnterpriseDiagnosis } = await import("./diagnosis");
    const result = await freshRunEnterpriseDiagnosis({ history: [], factoryContext: null });
    vi.doUnmock("./provider");
    vi.resetModules();
    return result;
  }

  it("模型正確回傳 conversationIntent=casual_conversation, casualTurnDomainRelevant=false → 正確透傳", async () => {
    const result = await runWithMockedResponse({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: false });
    expect(result.conversationIntent).toBe("casual_conversation");
    expect(result.casualTurnDomainRelevant).toBe(false);
  });

  it("casualTurnDomainRelevant 缺漏或型別不對時安全預設為 true（保守 fallback，不誤觸發收斂計數）", async () => {
    const result = await runWithMockedResponse({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: "not a boolean" });
    expect(result.casualTurnDomainRelevant).toBe(true);
  });
});

describe("runEnterpriseDiagnosis — confirmedFacts 解析防線", () => {
  it("模型回傳非 string/number/boolean 的值時會被過濾掉，不會污染 state", async () => {
    vi.resetModules();
    vi.doMock("./provider", () => ({
      getAiChatProvider: () => ({
        completeJson: vi.fn().mockResolvedValue(JSON.stringify({
          observedProblem: "test",
          likelyBottleneck: null,
          bottleneckStatus: "unclear",
          evidence: [],
          alternativeHypotheses: [],
          secondaryConcern: null,
          recommendedBusinessDirection: null,
          nextBestQuestion: null,
          shouldStopQuestioning: false,
          userWantsAction: false,
          confirmedFacts: {
            hasPatent: false, // 合法：boolean
            mainExportMarket: "日本", // 合法：string
            weirdObject: { nested: true }, // 不合法，應被過濾
            weirdArray: [1, 2, 3], // 不合法，應被過濾
          },
        })),
      }),
    }));
    const { runEnterpriseDiagnosis: freshRunEnterpriseDiagnosis } = await import("./diagnosis");

    const result = await freshRunEnterpriseDiagnosis({
      history: [{ role: "user", content: "我們沒有專利，主要出口日本" }],
      factoryContext: null,
    });

    expect(result.confirmedFacts).toEqual({ hasPatent: false, mainExportMarket: "日本" });
    vi.doUnmock("./provider");
    vi.resetModules();
  });
});
