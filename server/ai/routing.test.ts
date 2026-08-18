/**
 * Layer 2（OXM Resource Routing）驗證，重點是程式碼層級的硬性防線
 * enforceDiagnosisGate：即使模型（provider）不遵守 prompt 指示、硬是回傳了
 * 一個服務，只要 diagnosis 還沒達到「可以給資源」的狀態，也要被強制清空。
 * 這是 Phase 1.1 用來降低機率性違反「診斷永遠先於資源」規則的程式碼防線，
 * 不完全依賴模型自己遵守文字指示。
 *
 * provider 用 vi.mock 完全隔離，不打真實 API。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EnterpriseDiagnosis } from "./diagnosis";

const mockCompleteJson = vi.fn();
vi.mock("./provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
}));

import { runOxmRouting } from "./routing";
import { AI_SERVICE_REGISTRY } from "../../shared/ai/serviceRegistry";
import { OXM_NAVIGATION_REGISTRY } from "../../shared/ai/navigationRegistry";
import { OXM_PLATFORM_HELP_REGISTRY } from "../../shared/ai/platformHelpRegistry";

const CLEAR_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "business_exploration",
  observedProblem: "沒有 ISO 9001 進不了供應鏈",
  likelyBottleneck: "缺乏 ISO 9001 認證",
  bottleneckStatus: "clear",
  evidence: ["大公司要求 ISO 9001"],
  alternativeHypotheses: [],
  secondaryConcern: null,
  recommendedBusinessDirection: "先取得 ISO 9001 認證",
  nextBestQuestion: null,
  shouldStopQuestioning: true,
  userWantsAction: false,
};

const UNCLEAR_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "business_exploration",
  observedProblem: "最近訂單變少",
  likelyBottleneck: null,
  bottleneckStatus: "unclear",
  evidence: [],
  alternativeHypotheses: ["曝光不足", "成交率低"],
  secondaryConcern: null,
  recommendedBusinessDirection: null,
  nextBestQuestion: "詢價的人變少，還是有詢價但沒成交？",
  shouldStopQuestioning: false,
  userWantsAction: false,
};

const CLEAR_BUT_STILL_CONFIRMING_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "business_exploration",
  observedProblem: "訂單穩定，客戶帳期 90 天造成週轉壓力",
  likelyBottleneck: "帳期造成的現金流壓力",
  bottleneckStatus: "clear",
  evidence: ["訂單穩定", "客戶帳期 90 天"],
  alternativeHypotheses: [],
  secondaryConcern: null,
  recommendedBusinessDirection: "處理現金流結構，不是訂單不足",
  nextBestQuestion: "目前主要是靠自有資金週轉，還是已經有在跟銀行往來？",
  shouldStopQuestioning: false, // 已經有把握給方向，但還有一個確認題
  userWantsAction: false,
};

const ACTION_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "resource_request",
  observedProblem: "想找 CNC 加工廠",
  likelyBottleneck: null,
  bottleneckStatus: "unclear",
  evidence: [],
  alternativeHypotheses: [],
  secondaryConcern: null,
  recommendedBusinessDirection: "尋找符合條件的 CNC 加工供應商",
  nextBestQuestion: null,
  shouldStopQuestioning: true,
  userWantsAction: true,
};

const validServiceKey = AI_SERVICE_REGISTRY.find(s => s.key === "certification")!.key;

describe("runOxmRouting — enforceDiagnosisGate 程式碼防線", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  it("diagnosis 已經 clear 且 shouldStopQuestioning：允許模型回傳的服務通過", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: validServiceKey,
        secondaryService: null,
        relationship: null,
        serviceFitReason: "缺 ISO 認證",
        shouldOfferHandoff: true,
        finalReply: "現在真正卡你的是供應商資格。OXM 這邊有 ISO 顧問可以協助，需要的話我可以幫你轉交。",
      })
    );

    const result = await runOxmRouting({ diagnosis: CLEAR_DIAGNOSIS, history: [], factoryContext: null });

    expect(result.primaryService).toBe(validServiceKey);
    expect(result.shouldOfferHandoff).toBe(true);
  });

  it("diagnosis 還是 unclear：即使模型硬塞了一個服務，也被強制清空", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: validServiceKey, // 模型沒有遵守規則，硬塞了一個服務
        secondaryService: null,
        relationship: null,
        serviceFitReason: "（模型不應該在這裡給理由）",
        shouldOfferHandoff: true,
        finalReply: "詢價的人變少，還是有詢價但沒成交？",
      })
    );

    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });

    expect(result.primaryService).toBeNull();
    expect(result.secondaryService).toBeNull();
    expect(result.relationship).toBeNull();
    expect(result.shouldOfferHandoff).toBe(false);
    // finalReply 本身不受這道防線處理（那是 prompt 品質的責任），但結構化欄位保證乾淨
    expect(result.finalReply).toBe("詢價的人變少，還是有詢價但沒成交？");
  });

  it("diagnosis 已經 clear，但 shouldStopQuestioning 是 false（還有一個確認題）：允許點名 primaryService，但 shouldOfferHandoff 一律被強制清為 false（即使模型說 true）", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: "finance",
        secondaryService: null,
        relationship: null,
        serviceFitReason: "帳期造成現金流壓力，符合財務優化的定位",
        shouldOfferHandoff: true, // 模型沒有遵守規則，這裡不應該是 true
        finalReply: "這比較像帳期造成的現金流壓力，不是訂單不足。目前主要是靠自有資金週轉，還是已經有在跟銀行往來？",
      })
    );

    const result = await runOxmRouting({
      diagnosis: CLEAR_BUT_STILL_CONFIRMING_DIAGNOSIS,
      history: [],
      factoryContext: null,
    });

    expect(result.primaryService).toBe("finance"); // 方向已經足夠明確，允許點名可能對應的服務
    expect(result.shouldOfferHandoff).toBe(false); // 但還沒到可以正式提出轉交的門檻
  });

  it("diagnosis 是明確行動請求（userWantsAction=true）：即使 bottleneckStatus 還是 unclear，也允許通過", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: "factory_search",
        secondaryService: null,
        relationship: null,
        serviceFitReason: "使用者明確要找工廠",
        shouldOfferHandoff: false,
        finalReply: "了解，我幫你找符合條件的 CNC 加工廠。",
      })
    );

    const result = await runOxmRouting({ diagnosis: ACTION_DIAGNOSIS, history: [], factoryContext: null });

    expect(result.primaryService).toBe("factory_search");
  });

  it("parseRouting：模型回傳不存在的服務 key 時，視為 null（不讓模型編造服務）", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: "made_up_service_that_does_not_exist",
        secondaryService: null,
        relationship: null,
        serviceFitReason: "",
        shouldOfferHandoff: false,
        finalReply: "ok",
      })
    );

    const result = await runOxmRouting({ diagnosis: CLEAR_DIAGNOSIS, history: [], factoryContext: null });

    expect(result.primaryService).toBeNull();
  });

  it("parseRouting：finalReply 空字串時視為錯誤，往上拋錯而不是靜默回傳空白訊息", async () => {
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: null,
        secondaryService: null,
        relationship: null,
        serviceFitReason: "",
        shouldOfferHandoff: false,
        finalReply: "",
      })
    );

    await expect(
      runOxmRouting({ diagnosis: CLEAR_DIAGNOSIS, history: [], factoryContext: null })
    ).rejects.toThrow();
  });
});

describe("runOxmRouting — factorySourcingContextRelevant（Current Factory Search State 架構修正，見對話）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("沒有 currentFactorySearchState 時，prompt 明確要求固定回傳 false，不讓模型自己瞎猜", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok", factorySourcingContextRelevant: false,
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(capturedSystemPrompt()).toContain("沒有任何既有的 Factory Search Context");
    expect(capturedSystemPrompt()).toContain("factorySourcingContextRelevant 固定回傳 false");
  });

  it("有 currentFactorySearchState 時，prompt 帶入搜尋摘要，並要求語意判斷（不是關鍵字），且明確舉出「這些都沒有五軸啊」等例句", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok", factorySourcingContextRelevant: true,
    }));
    await runOxmRouting({
      diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null,
      currentFactorySearchState: {
        hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
        coreCapabilities: ["五軸加工"], candidateCount: 20, directCapabilityMatchCount: 0,
        missingCoreCapabilities: ["五軸加工"], requestedMatchCount: null, topResults: [],
        searchSummary: "台中市、金屬加工；核心能力：五軸加工", lastSearchAt: "2026-08-16T00:00:00.000Z",
      },
    });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("台中市、金屬加工；核心能力：五軸加工");
    expect(prompt).toContain("這些都沒有五軸啊");
    expect(prompt).toContain("不要因為這段對話「曾經」搜過工廠，就把後面每一輪都當成相關");
  });

  it("parseRouting：模型回傳的 factorySourcingContextRelevant 正確透傳（resourceTarget 也要是 factory_search，見 enforceResourceTargetGate）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "factory_search", factorySourcingContextRelevant: true,
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.factorySourcingContextRelevant).toBe(true);
  });

  it("parseRouting：欄位缺漏時安全預設為 false", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.factorySourcingContextRelevant).toBe(false);
  });

  it("有 currentFactorySearchState 時，prompt 明確區分「這輪要不要延續脈絡」跟「這輪要不要重新選 factory_search」是兩個獨立判斷（見「OXM AI 已完成功能整體驗收修正」二／CASE F1 的根因修正）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: "factory_search", secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok", factorySourcingContextRelevant: true,
    }));
    await runOxmRouting({
      diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null,
      currentFactorySearchState: {
        hardFilters: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
        coreCapabilities: ["五軸加工"], candidateCount: 20, directCapabilityMatchCount: 0,
        missingCoreCapabilities: ["五軸加工"], status: "SIMILAR_ONLY", requestedMatchCount: null, topResults: [],
        searchSummary: "台中市、金屬加工；核心能力：五軸加工", lastSearchAt: "2026-08-16T00:00:00.000Z",
      } as any,
    });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("是兩個獨立的判斷");
    expect(prompt).toContain("conversationIntent 本身就會是 resource_request");
    expect(prompt).toContain("既有 Factory Search Context");
  });
});

describe("runOxmRouting — conversationIntent 驅動的岔題處理與資源分流門檻（見「OXM AI Core Conversation Architecture 收斂」）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("prompt 用 conversationIntent 統一分流岔題與服務問題，不再各自條列案例；informational/casual 不進入資源比對", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("conversationIntent 決定這一輪的處理方式");
    expect(prompt).toContain("casual_conversation／informational");
    expect(prompt).toContain("不需要、也不應該進入下面的資源比對邏輯");
  });

  it("serializeDiagnosis 把 conversationIntent 帶進 prompt，讓 Layer 2 看得到 Layer 1 的分類", async () => {
    await runOxmRouting({ diagnosis: { ...UNCLEAR_DIAGNOSIS, conversationIntent: "informational" }, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("conversationIntent");
    expect(prompt).toContain("：informational");
  });

  it("enforceDiagnosisGate 程式碼防線：conversationIntent=informational 時，即使模型硬塞了服務與 shouldOfferHandoff=true，也強制清空（見「詢問服務 ≠ 需要顧問」）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: validServiceKey, secondaryService: null, relationship: null,
      serviceFitReason: "（模型不應該在這裡給理由）", shouldOfferHandoff: true, finalReply: "OXM 主要有找工廠、政府補助、ERP 這些服務。",
    }));
    const result = await runOxmRouting({
      diagnosis: { ...CLEAR_DIAGNOSIS, conversationIntent: "informational" },
      history: [], factoryContext: null,
    });
    expect(result.primaryService).toBeNull();
    expect(result.secondaryService).toBeNull();
    expect(result.shouldOfferHandoff).toBe(false);
  });

  it("enforceDiagnosisGate 程式碼防線：conversationIntent=casual_conversation 時同樣強制清空", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: validServiceKey, secondaryService: null, relationship: null,
      serviceFitReason: "x", shouldOfferHandoff: true, finalReply: "聊聊天。",
    }));
    const result = await runOxmRouting({
      diagnosis: { ...CLEAR_DIAGNOSIS, conversationIntent: "casual_conversation" },
      history: [], factoryContext: null,
    });
    expect(result.primaryService).toBeNull();
    expect(result.shouldOfferHandoff).toBe(false);
  });

  it("conversationIntent=business_exploration（既有行為不受影響）：clear 時仍然可以正常選到服務", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: validServiceKey, secondaryService: null, relationship: null,
      serviceFitReason: "缺 ISO 認證", shouldOfferHandoff: true, finalReply: "ok",
    }));
    const result = await runOxmRouting({
      diagnosis: { ...CLEAR_DIAGNOSIS, conversationIntent: "business_exploration" },
      history: [], factoryContext: null,
    });
    expect(result.primaryService).toBe(validServiceKey);
  });

  it("承接時機規則明確描述 handoffReadiness 概念，且 action_request 通常視為已滿足三條件", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("handoffReadiness");
    expect(prompt).toContain("action_request");
    expect(prompt).toContain("通常直接視為已經滿足這三個條件");
  });
});

describe("runOxmRouting — enterpriseMemory 傳給 Layer 2（finalReply 是唯一真正顯示給使用者的文字，meta 記憶問題必須在這一層被誠實回答）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
    mockCompleteJson.mockResolvedValue(
      JSON.stringify({
        primaryService: null, secondaryService: null, relationship: null,
        serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      })
    );
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("memory 為 null：prompt 明確標示完全沒有過往記錄", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null, enterpriseMemory: null });
    expect(capturedSystemPrompt()).toContain("沒有任何過往的企業摘要記錄");
  });

  it("memory 有長期實質內容，但「最近一次」互動沒有新資訊：prompt 要求誠實區分兩層，不能只講一半", async () => {
    await runOxmRouting({
      diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null,
      enterpriseMemory: {
        summaryText: "銘板製造；品牌內容方向。",
        hasMeaningfulBusinessInfo: true,
        lastInteractionHadMeaningfulInfo: false,
      },
    });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("最近一次");
    expect(prompt).toContain("沒有提供任何新的企業資訊");
    expect(prompt).toContain("銘板製造；品牌內容方向。");
  });
});

describe("runOxmRouting — 非 OXM 純閒聊收斂機制（見對話中「非 OXM 純閒聊收斂機制」）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("prompt 包含收斂規則，且明確禁止用「token不足」等技術語言、禁止生硬拒答", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null, consecutiveOutOfDomainCasualTurns: 4 });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("非 OXM 純閒聊收斂");
    expect(prompt).toContain("consecutiveOutOfDomainCasualTurns");
    expect(prompt).toContain("token不足");
    expect(prompt).toContain("不要變成生硬的客服式拒絕");
  });

  it("實際數字正確帶入 prompt（這裡用 4 驗證達到門檻的情況）", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null, consecutiveOutOfDomainCasualTurns: 4 });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("consecutiveOutOfDomainCasualTurns（已經包含這一輪本身，server-authoritative 算好的）＝4");
  });

  it("未傳 consecutiveOutOfDomainCasualTurns（例如訪客無狀態路徑）時安全預設為 0，不誤觸發收斂", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("＝0");
  });

  it("回到主題的規則明確要求：非 out-of-domain-casual 的這一輪不要再提 scope reminder", async () => {
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null, consecutiveOutOfDomainCasualTurns: 0 });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("使用者從閒聊重新回到 OXM／企業話題");
    expect(prompt).toContain("絕對不要因為「稍早」聊過幾輪無關話題就還提起 scope reminder");
  });
});

describe("runOxmRouting — Phase 6C：govSubsidyLookupRelevant／navigationTarget（見對話中「政府補助資訊查詢 ≠ Handoff」「站內 Navigation Action」）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("govSubsidyLookupRelevant 是從 resourceTarget 衍生，不再由模型直接輸出：resourceTarget=subsidy_programs 時，即使 conversationIntent=informational 讓 primaryService 被清空，govSubsidyLookupRelevant 仍然是 true（見「CITD是什麼？」情境）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: "gov_subsidy", secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: true, finalReply: "ok",
      resourceTarget: "subsidy_programs",
    }));
    const result = await runOxmRouting({
      diagnosis: { ...CLEAR_DIAGNOSIS, conversationIntent: "informational" },
      history: [], factoryContext: null,
    });
    expect(result.primaryService).toBeNull(); // 仍然被硬性防線清空
    expect(result.shouldOfferHandoff).toBe(false); // 仍然被硬性防線清空
    expect(result.resourceTarget).toBe("subsidy_programs");
    expect(result.govSubsidyLookupRelevant).toBe(true); // 不受影響，讀取政府補助方案是唯讀操作
  });

  it("即使模型多此一舉直接輸出 govSubsidyLookupRelevant，也會被忽略——一律以 resourceTarget 衍生值為準", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "news", govSubsidyLookupRelevant: true, // 模型輸出的這個欄位值必須被忽略
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.govSubsidyLookupRelevant).toBe(false);
  });

  it("resourceTarget／govSubsidyLookupRelevant 欄位缺漏時安全預設為 none／false", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.resourceTarget).toBe("none");
    expect(result.govSubsidyLookupRelevant).toBe(false);
  });

  it("resourceTarget：模型回傳不合法的值時安全預設為 none", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "made_up_target",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.resourceTarget).toBe("none");
  });

  it("prompt 明確要求先判斷 resourceTarget，且清楚區分 subsidy_programs 跟 business_exploration 走向 gov_subsidy Handoff 是兩件不同的事", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("resourceTarget");
    expect(prompt).toContain("latest user message 已經明確表達的新 Resource Goal，優先於 previous Resource Context");
    expect(prompt).toContain("這是在問「自己公司適合哪個」，屬於 business_exploration");
  });

  it("prompt 用具體例句區分 news 與 subsidy_programs：主題是補助但要的是「消息」仍然是 news，不是 subsidy_programs", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("最近政府有沒有公布什麼補助消息？");
    expect(prompt).toContain("這些補助有沒有什麼新消息？");
    expect(prompt).toContain("都是 news，不是 subsidy_programs");
  });

  it("navigationTarget：模型回傳 Registry 裡真實存在的 key 時正確透傳", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      navigationTarget: "erp",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.navigationTarget).toBe("erp");
  });

  it("navigationTarget：模型編出 Registry 裡不存在的 key 時視為 null（不讓模型輸出任意 path，見「十三」）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      navigationTarget: "https://evil.example.com",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.navigationTarget).toBeNull();
  });

  it("navigationTarget 欄位缺漏時安全預設為 null", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.navigationTarget).toBeNull();
  });

  it("prompt 把 Navigation Registry 序列化進去，AI 只能從這份清單選 key", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    for (const entry of OXM_NAVIGATION_REGISTRY) {
      expect(prompt).toContain(`key: ${entry.key}`);
    }
    expect(prompt).toContain("navigationTarget");
    expect(prompt).toContain("不算，navigationTarget 維持 null");
  });
});

describe("runOxmRouting — enforceResourceTargetGate 程式碼防線（見對話中「Phase 6B + 6C 人工驗收發現一個跨 Resource Routing bug」的根因修正）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  it("真實 bug 重現與修正：resourceTarget=subsidy_programs 時，即使模型誤判 newsSearchContextRelevant=true（沿用舊的 News Context），也被強制清空為 false，不會讓「有哪些政府補助」被誤送到 news", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "subsidy_programs",
      newsSearchContextRelevant: true, // 模型沒有完全遵守規則，誤判成沿用舊 News Context
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.resourceTarget).toBe("subsidy_programs");
    expect(result.newsSearchContextRelevant).toBe(false); // 硬性防線強制清空
    expect(result.govSubsidyLookupRelevant).toBe(true); // 正確走向補助方案查詢
  });

  it("resourceTarget=news 時，newsSearchContextRelevant=true 正常通過（不影響既有 CASE R1 turn2「食品的呢？」延續行為）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "news", newsSearchContextRelevant: true,
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.newsSearchContextRelevant).toBe(true);
  });

  it("resourceTarget=none（例如 business_exploration 或 action_request／Handoff）時，newsSearchContextRelevant／factorySourcingContextRelevant 都被強制清空，即使模型誤判為 true（CASE R5／R6）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "none", newsSearchContextRelevant: true, factorySourcingContextRelevant: true,
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.newsSearchContextRelevant).toBe(false);
    expect(result.factorySourcingContextRelevant).toBe(false);
    expect(result.govSubsidyLookupRelevant).toBe(false);
  });

  it("resourceTarget=factory_search 時，同樣的鏡射邏輯：factorySourcingContextRelevant 正常通過，newsSearchContextRelevant 被強制清空", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "factory_search", factorySourcingContextRelevant: true, newsSearchContextRelevant: true,
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.factorySourcingContextRelevant).toBe(true);
    expect(result.newsSearchContextRelevant).toBe(false);
  });

  it("反向案例（見「四」）：resourceTarget=news 時，即使對話稍早在聊補助，也不會有殘留的 subsidy 訊號污染（govSubsidyLookupRelevant 一律看這一輪的 resourceTarget）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "news",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.govSubsidyLookupRelevant).toBe(false);
  });
});

describe("runOxmRouting — Phase 6D：platformHelpTarget／resourceTarget=platform_help（見對話中「OXM AI 平台操作 / 使用方式能力」）", () => {
  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  function capturedSystemPrompt(): string {
    const messages = mockCompleteJson.mock.calls[0][0] as { role: string; content: string }[];
    return messages.find(m => m.role === "system")!.content;
  }

  it("resourceTarget=platform_help 且 platformHelpTarget 是 Registry 裡真實存在的 key 時正確透傳，且不受 enforceDiagnosisGate 影響（CASE P1／P3／P5／P7 情境：即使 conversationIntent=informational 讓 primaryService 被清空）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "platform_help", platformHelpTarget: "factory_search_usage",
    }));
    const result = await runOxmRouting({
      diagnosis: { ...CLEAR_DIAGNOSIS, conversationIntent: "informational" },
      history: [], factoryContext: null,
    });
    expect(result.resourceTarget).toBe("platform_help");
    expect(result.platformHelpTarget).toBe("factory_search_usage");
    expect(result.primaryService).toBeNull();
  });

  it("platformHelpTarget：模型編出 Registry 裡不存在的 key 時視為 null（不讓模型輸出任意主題）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "platform_help", platformHelpTarget: "made_up_topic",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.platformHelpTarget).toBeNull();
  });

  it("platformHelpTarget：即使模型輸出了一個合法 key，只要 resourceTarget 不是 platform_help 就必須忽略（跟 govSubsidyLookupRelevant 同一種根因修正，避免兩個判斷來源互相打架）", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "news", platformHelpTarget: "factory_search_usage",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.platformHelpTarget).toBeNull();
  });

  it("resourceTarget／platformHelpTarget 欄位缺漏時安全預設為 none／null", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.resourceTarget).toBe("none");
    expect(result.platformHelpTarget).toBeNull();
  });

  it("真實 bug class 重現與修正（CASE P9）：resourceTarget=platform_help 時，即使模型誤判 factorySourcingContextRelevant=true（沿用舊的 Factory Search Context），也被 enforceResourceTargetGate 強制清空，不會讓「那我自己平常要怎麼搜尋？」又觸發 search_factories", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
      resourceTarget: "platform_help", platformHelpTarget: "factory_search_usage",
      factorySourcingContextRelevant: true, // 模型沒有完全遵守規則，誤判成沿用舊 Factory Context
    }));
    const result = await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    expect(result.factorySourcingContextRelevant).toBe(false); // 硬性防線強制清空
    expect(result.resourceTarget).toBe("platform_help");
  });

  it("prompt 把 Platform Help Registry 序列化進去，包含每個主題的真實 title 與 how_to_use vs do_it_for_me 的校準規則", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    for (const topic of OXM_PLATFORM_HELP_REGISTRY) {
      expect(prompt).toContain(`key: ${topic.key}`);
    }
    expect(prompt).toContain("platform_help");
    expect(prompt).toContain("how_to_use（platform_help）vs do_it_for_me");
    expect(prompt).toContain("platform_help vs navigationTarget");
    expect(prompt).toContain("platform_help vs Handoff");
  });

  it("prompt 明確要求 finalReply 只能依真實 steps 精簡改寫，不能自己發明步驟", async () => {
    mockCompleteJson.mockResolvedValue(JSON.stringify({
      primaryService: null, secondaryService: null, relationship: null,
      serviceFitReason: "", shouldOfferHandoff: false, finalReply: "ok",
    }));
    await runOxmRouting({ diagnosis: UNCLEAR_DIAGNOSIS, history: [], factoryContext: null });
    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("不能自己發明這裡沒有的按鈕、頁面或流程");
  });
});
