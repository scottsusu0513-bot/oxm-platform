/**
 * 正式站 smoke test 發現的真實 bug（見對話「Search resultCount bug」）：
 * trpc.factory.search.useQuery 用 placeholderData:(prev)=>prev，切換搜尋
 * 條件的當下 isLoading 仍是 false、data 暫時沿用「上一次」查詢的結果——
 * 原本用 isLoading 當守門條件，導致 analytics search event 記到上一筆
 * 搜尋的 resultCount（實測：搜尋「TEST」實際回傳 1 筆，卻記成前一次搜尋
 * 的 44 筆）。這裡直接用 react-query 實際會經過的 render 序列（保留舊
 * data、isFetching 先變 true 再變 false、data 換成新物件）驗證
 * decideSearchTrack 純函式的行為，不需要掛載整個 Search 頁面元件。
 */
import { describe, expect, it } from "vitest";
import { decideSearchTrack, type SearchTrackDecisionState } from "./searchAnalyticsTracker";

function freshState(): SearchTrackDecisionState {
  return { lastTrackedSearchKey: null };
}

describe("decideSearchTrack — Analytics 2.0 搜尋事件去重／resultCount 正確性", () => {
  it("第一次搜尋：resultCount 正確記錄", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: false, data: { total: 44, items: new Array(20) }, searchKey: "kw=" },
      state,
    );
    expect(decision).toEqual({ shouldRecord: true, resultCount: 44 });
  });

  it("切換 keyword：placeholderData 沿用舊結果那一個 render 不得提前記錄", () => {
    const state = freshState();
    // 第一次搜尋（keyword 空白）已經記過一次。
    const first = decideSearchTrack(
      { isFetching: false, data: { total: 44, items: new Array(20) }, searchKey: "kw=" },
      state,
    );
    expect(first.shouldRecord).toBe(true);
    state.lastTrackedSearchKey = "kw=";

    // 使用者輸入新關鍵字「TEST」並觸發搜尋：react-query 立刻把 isFetching
    // 設成 true，但 data 因為 placeholderData 暫時還是「上一次」（44 筆）的
    // 物件——這個 render 絕對不能記錄任何事件（尤其不能用舊的 44）。
    const duringFetch = decideSearchTrack(
      { isFetching: true, data: { total: 44, items: new Array(20) }, searchKey: "kw=TEST" },
      state,
    );
    expect(duringFetch.shouldRecord).toBe(false);
  });

  it("新 query 完成後：只記一次、且是正確的 resultCount（不是上一次的）", () => {
    const state = freshState();
    state.lastTrackedSearchKey = "kw="; // 已經記過上一次搜尋

    // isFetching 期間（data 仍是舊的 44）——不記錄。
    const duringFetch = decideSearchTrack(
      { isFetching: true, data: { total: 44, items: new Array(20) }, searchKey: "kw=TEST" },
      state,
    );
    expect(duringFetch.shouldRecord).toBe(false);

    // 新結果真的回來：isFetching 變 false，data 換成「TEST」搜尋的真實結果
    // （1 筆），searchKey 也已經改變——這個 render 才應該記錄，且必須是 1
    // 筆，不是前一次的 44 筆。
    const afterFetch = decideSearchTrack(
      { isFetching: false, data: { total: 1, items: [{}] }, searchKey: "kw=TEST" },
      state,
    );
    expect(afterFetch).toEqual({ shouldRecord: true, resultCount: 1 });

    // 呼叫端記錄後會更新 lastTrackedSearchKey，之後同一組條件的任何 rerender
    // （例如 refetchOnWindowFocus 造成的背景重新整理）都不應該再記錄第二次。
    state.lastTrackedSearchKey = "kw=TEST";
    const rerenderSameKey = decideSearchTrack(
      { isFetching: false, data: { total: 1, items: [{}] }, searchKey: "kw=TEST" },
      state,
    );
    expect(rerenderSameKey.shouldRecord).toBe(false);
  });

  it("不得因為 rerender／背景 refetch 重複記錄同一個 search event", () => {
    const state = freshState();
    const first = decideSearchTrack(
      { isFetching: false, data: { total: 10, items: new Array(10) }, searchKey: "kw=A" },
      state,
    );
    expect(first.shouldRecord).toBe(true);
    state.lastTrackedSearchKey = "kw=A";

    // 背景 refetch 同一個 searchKey：isFetching 短暫變 true 再變 false，
    // data 內容也可能不變或微調，但 searchKey 沒變——不應該再記錄。
    const backgroundRefetchStart = decideSearchTrack(
      { isFetching: true, data: { total: 10, items: new Array(10) }, searchKey: "kw=A" },
      state,
    );
    expect(backgroundRefetchStart.shouldRecord).toBe(false);
    const backgroundRefetchDone = decideSearchTrack(
      { isFetching: false, data: { total: 10, items: new Array(10) }, searchKey: "kw=A" },
      state,
    );
    expect(backgroundRefetchDone.shouldRecord).toBe(false);
  });

  it("data 還沒回來（第一次載入中）不記錄", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: true, data: undefined, searchKey: "kw=" },
      state,
    );
    expect(decision.shouldRecord).toBe(false);
  });

  it("AI 搜尋（q 或 aiSearchConversationId 造成的 searchKey 差異）走相同的守門邏輯，行為一致", () => {
    const state = freshState();
    // 一般搜尋先記一次。
    decideSearchTrack({ isFetching: false, data: { total: 5, items: new Array(5) }, searchKey: "kw=A|q=|ai=" }, state);
    state.lastTrackedSearchKey = "kw=A|q=|ai=";

    // 切到 AI 搜尋模式（searchKey 內的 q／ai 片段改變）：isFetching 期間沿用
    // 舊 data，不得提前記錄。
    const duringAiFetch = decideSearchTrack(
      { isFetching: true, data: { total: 5, items: new Array(5) }, searchKey: "kw=A|q=CNC 五軸|ai=" },
      state,
    );
    expect(duringAiFetch.shouldRecord).toBe(false);

    // AI 搜尋結果回來後才記錄，且是 AI 搜尋自己的 resultCount。
    const afterAiFetch = decideSearchTrack(
      { isFetching: false, data: { total: 8, items: new Array(8) }, searchKey: "kw=A|q=CNC 五軸|ai=" },
      state,
    );
    expect(afterAiFetch).toEqual({ shouldRecord: true, resultCount: 8 });
  });

  it("resultCount 缺少 total 時 fallback 用 items.length", () => {
    const state = freshState();
    const decision = decideSearchTrack(
      { isFetching: false, data: { items: [{}, {}, {}] }, searchKey: "kw=" },
      state,
    );
    expect(decision).toEqual({ shouldRecord: true, resultCount: 3 });
  });
});
