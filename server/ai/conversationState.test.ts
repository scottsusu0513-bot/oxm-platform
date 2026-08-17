/**
 * deriveConversationState() 驗證（對話中「二十、本輪測試案例」第 8、9 項）：
 * 1. 每輪用最新的 diagnosis/routing 結果更新大部分欄位。
 * 2. confirmedFacts 是唯一「累加」的欄位——舊的事實保留，新的疊加上去。
 */
import { describe, expect, it } from "vitest";
import { deriveConversationState, createEmptyConversationState, resolveConsecutiveOutOfDomainCasualTurns } from "./conversationState";
import type { EnterpriseDiagnosis } from "./diagnosis";
import type { OxmRouting } from "./routing";

function diagnosis(overrides: Partial<EnterpriseDiagnosis> = {}): EnterpriseDiagnosis {
  return {
    conversationIntent: "business_exploration",
    casualTurnDomainRelevant: true,
    observedProblem: "訂單變少",
    likelyBottleneck: null,
    bottleneckStatus: "unclear",
    evidence: [],
    alternativeHypotheses: [],
    secondaryConcern: null,
    recommendedBusinessDirection: null,
    nextBestQuestion: "詢價變少還是不成交？",
    shouldStopQuestioning: false,
    userWantsAction: false,
    confirmedFacts: {},
    ...overrides,
  };
}

function routing(overrides: Partial<OxmRouting> = {}): OxmRouting {
  return {
    primaryService: null,
    secondaryService: null,
    relationship: null,
    serviceFitReason: "",
    shouldOfferHandoff: false,
    finalReply: "ok",
    ...overrides,
  };
}

describe("deriveConversationState — 案例 8：每輪正確更新", () => {
  it("第一輪：unclear，記錄 observedProblem 與 unresolvedQuestion", () => {
    const state = deriveConversationState({
      diagnosis: diagnosis(),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    expect(state.bottleneckStatus).toBe("unclear");
    expect(state.observedProblem).toBe("訂單變少");
    expect(state.unresolvedQuestion).toBe("詢價變少還是不成交？");
    expect(state.candidateServiceKeys).toEqual([]);
  });

  it("第二輪：emerging，likelyBottleneck 更新", () => {
    const first = deriveConversationState({
      diagnosis: diagnosis(),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    const second = deriveConversationState({
      diagnosis: diagnosis({ likelyBottleneck: "價格競爭／價值差異", bottleneckStatus: "emerging" }),
      routing: routing(),
      previousState: first,
      companyContextKnown: false,
    });
    expect(second.bottleneckStatus).toBe("emerging");
    expect(second.likelyBottleneck).toBe("價格競爭／價值差異");
  });

  it("第三輪：clear，candidateServiceKeys 反映 routing 的 primary/secondary", () => {
    const state = deriveConversationState({
      diagnosis: diagnosis({
        likelyBottleneck: "價值傳達",
        bottleneckStatus: "clear",
        recommendedBusinessDirection: "強化品牌價值傳達",
      }),
      routing: routing({ primaryService: "short_video", relationship: null, shouldOfferHandoff: true }),
      previousState: null,
      companyContextKnown: false,
    });
    expect(state.bottleneckStatus).toBe("clear");
    expect(state.candidateServiceKeys).toEqual(["short_video"]);
    expect(state.handoffReady).toBe(true);
  });
});

describe("deriveConversationState — 案例 9：confirmedFacts 保守累加", () => {
  it("新一輪的 confirmedFacts 疊加在舊的之上，不會清空舊的", () => {
    const first = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { hasPatent: false } }),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    const second = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { mfgMode: "ODM" } }),
      routing: routing(),
      previousState: first,
      companyContextKnown: false,
    });
    expect(second.confirmedFacts).toEqual({ hasPatent: false, mfgMode: "ODM" });
  });

  it("同一個 key 出現新值時會覆蓋舊值（企業狀態可能改變）", () => {
    const first = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { mainExportMarket: "台灣" } }),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    const second = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { mainExportMarket: "日本" } }),
      routing: routing(),
      previousState: first,
      companyContextKnown: false,
    });
    expect(second.confirmedFacts.mainExportMarket).toBe("日本");
  });

  it("Phase 4.1 CASE 9：先說沒有專利，後來更正「講錯了，有一件」→ 最終 hasPatent/patentCount 反映最新更正值，不會新舊矛盾同時留著", () => {
    const first = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { hasPatent: false } }),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    const second = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { hasPatent: true, patentCount: 1 } }),
      routing: routing(),
      previousState: first,
      companyContextKnown: false,
    });
    expect(second.confirmedFacts).toEqual({ hasPatent: true, patentCount: 1 });
  });

  it("這一輪沒有新事實時（空物件），舊的 confirmedFacts 完全不受影響", () => {
    const first = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: { hasPatent: false } }),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
    });
    const second = deriveConversationState({
      diagnosis: diagnosis({ confirmedFacts: {} }),
      routing: routing(),
      previousState: first,
      companyContextKnown: false,
    });
    expect(second.confirmedFacts).toEqual({ hasPatent: false });
  });
});

describe("createEmptyConversationState", () => {
  it("回傳結構化空白 state，confirmedFacts 是空物件", () => {
    const state = createEmptyConversationState(true);
    expect(state.companyContextKnown).toBe(true);
    expect(state.confirmedFacts).toEqual({});
    expect(state.bottleneckStatus).toBe("unclear");
    expect(state.consecutiveOutOfDomainCasualTurns).toBe(0);
    expect(state.outOfDomainCasualMode).toBe("normal");
  });
});

describe("outOfDomainCasualMode — 見「非 OXM 純閒聊收斂機制」二階段設計", () => {
  it("deriveConversationState 沒有 previousState 時，預設為 normal", () => {
    const state = deriveConversationState({
      diagnosis: diagnosis(),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
      factorySearchState: null,
      consecutiveOutOfDomainCasualTurns: 0,
    });
    expect(state.outOfDomainCasualMode).toBe("normal");
  });

  it("deriveConversationState 原樣沿用 previousState 的 outOfDomainCasualMode（實際下一輪要變成什麼由 chatService.ts 的 post-processing 決定，不是這裡）", () => {
    const previousState = { ...createEmptyConversationState(false), outOfDomainCasualMode: "warned" as const };
    const state = deriveConversationState({
      diagnosis: diagnosis(),
      routing: routing(),
      previousState,
      companyContextKnown: false,
      factorySearchState: null,
      consecutiveOutOfDomainCasualTurns: 0,
    });
    expect(state.outOfDomainCasualMode).toBe("warned");
  });
});

describe("resolveConsecutiveOutOfDomainCasualTurns — 見「非 OXM 純閒聊收斂機制」", () => {
  it("casual_conversation + casualTurnDomainRelevant=false（真正跟企業無關的閒聊）→ 從 0 累加為 1", () => {
    const count = resolveConsecutiveOutOfDomainCasualTurns(
      diagnosis({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: false }),
      null
    );
    expect(count).toBe(1);
  });

  it("連續 4 輪都是 out-of-domain casual → 累加到 4", () => {
    let state = createEmptyConversationState(false);
    for (let i = 0; i < 4; i++) {
      const count = resolveConsecutiveOutOfDomainCasualTurns(
        diagnosis({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: false }),
        state
      );
      state = { ...state, consecutiveOutOfDomainCasualTurns: count };
    }
    expect(state.consecutiveOutOfDomainCasualTurns).toBe(4);
  });

  it("casual_conversation 但 casualTurnDomainRelevant=true（跟企業相關的閒聊，例如「今天工廠很煩」）→ 不累加，重置為 0", () => {
    const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
    const count = resolveConsecutiveOutOfDomainCasualTurns(
      diagnosis({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: true }),
      previousState
    );
    expect(count).toBe(0);
  });

  it("conversationIntent 不是 casual_conversation（例如 resource_request）→ 立即重置為 0，即使前面已經累積了 3", () => {
    const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
    const count = resolveConsecutiveOutOfDomainCasualTurns(
      diagnosis({ conversationIntent: "resource_request" }),
      previousState
    );
    expect(count).toBe(0);
  });

  it("informational（例如「OXM有哪些服務」）→ 重置為 0", () => {
    const previousState = { ...createEmptyConversationState(false), consecutiveOutOfDomainCasualTurns: 3 };
    const count = resolveConsecutiveOutOfDomainCasualTurns(
      diagnosis({ conversationIntent: "informational" }),
      previousState
    );
    expect(count).toBe(0);
  });

  it("deriveConversationState 正確寫入呼叫端已經算好的 consecutiveOutOfDomainCasualTurns", () => {
    const state = deriveConversationState({
      diagnosis: diagnosis({ conversationIntent: "casual_conversation", casualTurnDomainRelevant: false }),
      routing: routing(),
      previousState: null,
      companyContextKnown: false,
      factorySearchState: null,
      consecutiveOutOfDomainCasualTurns: 4,
    });
    expect(state.consecutiveOutOfDomainCasualTurns).toBe(4);
  });
});
