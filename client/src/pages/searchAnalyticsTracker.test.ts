/**
 * Search Analytics resultCount 方案 A（見對話「Search Analytics resultCount
 * 方案 A」）：改用 server 回應自帶的 searchFingerprint 跟目前搜尋條件的
 * fingerprint 比對，取代先前依賴 isFetching／isLoading 等 react-query 時序
 * 訊號的做法（那個做法在正式站觀察到失敗、且無法在任何本機環境重現確切
 * 機制，代表不是結構性修正）。這裡直接用「react-query 實際會經過的 render
 * 序列」驗證 decideSearchTrack 純函式：即使 isFetching 已經變 false、data
 * 也已經換成新物件，只要 fingerprint 對不上，就必須擋下來——這是本輪要
 * 驗證的核心行為，不是 isFetching 本身。
 */
import { describe, expect, it } from "vitest";
import { decideSearchTrack, type SearchTrackDecisionState } from "./searchAnalyticsTracker";

function freshState(): SearchTrackDecisionState {
  return { lastTrackedFingerprint: null };
}

describe("decideSearchTrack — fingerprint 相等才是最終權威", () => {
  it("第一次搜尋：fingerprint 相符，resultCount 正確記錄", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 44, items: new Array(20) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(decision).toEqual({ shouldRecord: true, resultCount: 44 });
  });

  it("isFetching=false 但 fingerprint 不符（placeholderData 沿用舊 response）：一律擋下，不管 isFetching 說什麼", () => {
    const state = freshState();
    state.lastTrackedFingerprint = "fp-A"; // 上一次（空搜尋）已經記過
    // 這正是原本 bug 的實際情境：isFetching 已經回到 false（react-query
    // 認為「不在抓取中」），但 data 其實還是 placeholderData 沿用的舊
    // response（fingerprint 仍是 fp-A，不是目前的 fp-B「包裝」）。
    const decision = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 44, items: new Array(20) }, currentFingerprint: "fp-B" },
      state,
    );
    expect(decision.shouldRecord).toBe(false);
    expect(decision.skipReason).toBe("fingerprint-mismatch");
  });

  it("isFetching=true 且 fingerprint 也不符：輔助 guard 先擋下（isFetching-or-no-data）", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: true, data: { searchFingerprint: "fp-A", total: 44, items: new Array(20) }, currentFingerprint: "fp-B" },
      state,
    );
    expect(decision.shouldRecord).toBe(false);
    expect(decision.skipReason).toBe("fetching-or-no-data");
  });

  it("新 query 真正完成後（fingerprint 相符）：只記一次、且是正確的 resultCount（不是上一次的 44）", () => {
    const state = freshState();
    state.lastTrackedFingerprint = "fp-A";
    // 真正「包裝」的 response 回來：fingerprint 換成 fp-B，total 是包裝自己
    // 的真實結果（9），不是空搜尋的 44。
    const decision = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-B", total: 9, items: new Array(9) }, currentFingerprint: "fp-B" },
      state,
    );
    expect(decision).toEqual({ shouldRecord: true, resultCount: 9 });
  });

  it("同一個 fingerprint 的 rerender／背景 refetch 不重複記錄", () => {
    const state = freshState();
    const first = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 10, items: new Array(10) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(first.shouldRecord).toBe(true);
    state.lastTrackedFingerprint = "fp-A";

    const rerender = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 10, items: new Array(10) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(rerender.shouldRecord).toBe(false);
    expect(rerender.skipReason).toBe("already-tracked");

    // 背景 refetch 同一個 fingerprint：isFetching 短暫變 true 再變 false，
    // 仍然不應該重複記錄。
    const refetchStart = decideSearchTrack(
      { isFetching: true, data: { searchFingerprint: "fp-A", total: 10, items: new Array(10) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(refetchStart.shouldRecord).toBe(false);
    const refetchDone = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 10, items: new Array(10) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(refetchDone.shouldRecord).toBe(false);
  });

  it("返回先前搜過的 fingerprint（不是全域永久 dedupe）：只要不是「上一次」記錄的 fingerprint，仍然算新事件", () => {
    const state = freshState();
    // 搜 A → 搜 B → 搜回 A
    decideSearchTrack({ isFetching: false, data: { searchFingerprint: "fp-A", total: 5, items: [] }, currentFingerprint: "fp-A" }, state);
    state.lastTrackedFingerprint = "fp-A";
    decideSearchTrack({ isFetching: false, data: { searchFingerprint: "fp-B", total: 7, items: [] }, currentFingerprint: "fp-B" }, state);
    state.lastTrackedFingerprint = "fp-B";

    const backToA = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", total: 5, items: [] }, currentFingerprint: "fp-A" },
      state,
    );
    expect(backToA).toEqual({ shouldRecord: true, resultCount: 5 });
  });

  it("data 還沒回來（第一次載入中）不記錄", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: true, data: undefined, currentFingerprint: "fp-A" },
      state,
    );
    expect(decision.shouldRecord).toBe(false);
    expect(decision.skipReason).toBe("fetching-or-no-data");
  });

  it("AI 搜尋（fingerprint 不同）走相同的 fingerprint 判斷邏輯，行為一致", () => {
    const state = freshState();
    decideSearchTrack({ isFetching: false, data: { searchFingerprint: "fp-normal", total: 5, items: [] }, currentFingerprint: "fp-normal" }, state);
    state.lastTrackedFingerprint = "fp-normal";

    // 切到 AI 搜尋模式：react-query 短暫呈現 isFetching=true + 舊
    // fingerprint（placeholder），不得提前記錄。
    const duringAiFetch = decideSearchTrack(
      { isFetching: true, data: { searchFingerprint: "fp-normal", total: 5, items: [] }, currentFingerprint: "fp-ai" },
      state,
    );
    expect(duringAiFetch.shouldRecord).toBe(false);

    // AI 搜尋結果回來（fingerprint 換成 fp-ai）才記錄，且是 AI 搜尋自己的
    // resultCount。
    const afterAiFetch = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-ai", total: 8, items: new Array(8) }, currentFingerprint: "fp-ai" },
      state,
    );
    expect(afterAiFetch).toEqual({ shouldRecord: true, resultCount: 8 });
  });

  it("resultCount 缺少 total 時 fallback 用 items.length", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: false, data: { searchFingerprint: "fp-A", items: [{}, {}, {}] }, currentFingerprint: "fp-A" },
      state,
    );
    expect(decision).toEqual({ shouldRecord: true, resultCount: 3 });
  });

  it("data.searchFingerprint 缺失（舊版 server 或型別意外缺欄位）：視為不相符，安全地不記錄", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: false, data: { total: 44, items: new Array(20) }, currentFingerprint: "fp-A" },
      state,
    );
    expect(decision.shouldRecord).toBe(false);
    expect(decision.skipReason).toBe("fingerprint-mismatch");
  });
});
