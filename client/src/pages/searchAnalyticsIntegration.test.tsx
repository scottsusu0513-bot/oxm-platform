// @vitest-environment jsdom
/**
 * Search Analytics resultCount 方案 A — 完整 query lifecycle 整合測試（見
 * 對話「Search Analytics resultCount 方案 A」）。
 *
 * searchAnalyticsTracker.test.ts 已經對 decideSearchTrack 這個純函式做過
 * 完整的單元測試，但單元測試只證明「給定正確的 isFetching/data/fingerprint
 * 參數組合，純函式的判斷邏輯是對的」——不能證明「Search.tsx 真的在正確的
 * React render 時機把正確的參數餵給它」。這支測試改用真正的 React
 * render/rerender（透過 @testing-library/react），模擬 react-query 實際會
 * 經過的完整 render 序列（含 placeholderData 過渡：isFetching 已經變
 * false，但 data 其實還沒對應到新的搜尋條件），驗證的重點是：即使
 * isFetching 說「沒在抓取」，只要 response 自帶的 searchFingerprint 跟目前
 * 搜尋條件的 fingerprint 對不上，就一定會被擋下來——這正是先前
 * isFetching-based 修法在正式站失敗、但本機三種環境都無法重現的那個情境。
 *
 * AnalyticsHarness 刻意只保留 Search.tsx 分析追蹤 effect 的最小骨架，直接
 * 重用生產程式碼的 decideSearchTrack／buildSearchFingerprint（不是重新實作
 * 一份測試專用邏輯），避免這支測試本身跟真正的實作邏輯脫節。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { decideSearchTrack, type SearchTrackDecisionState } from "./searchAnalyticsTracker";
import { buildSearchFingerprint } from "@shared/searchFingerprint";

interface QueryState {
  isFetching: boolean;
  data?: { searchFingerprint?: string; total?: number };
}

function AnalyticsHarness({ keyword, queryState, onRecord }: {
  keyword: string;
  queryState: QueryState;
  onRecord: (resultCount: number, keyword: string) => void;
}) {
  const currentFingerprint = buildSearchFingerprint({ keyword });
  const stateRef = useRef<SearchTrackDecisionState>({ lastTrackedFingerprint: null });
  useEffect(() => {
    const decision = decideSearchTrack(
      { isFetching: queryState.isFetching, data: queryState.data, currentFingerprint },
      stateRef.current,
    );
    if (!decision.shouldRecord) return;
    stateRef.current.lastTrackedFingerprint = currentFingerprint;
    onRecord(decision.resultCount, keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryState.isFetching, queryState.data, currentFingerprint]);
  return null;
}

describe("Search analytics — 完整 query lifecycle 整合測試（真實 React re-render）", () => {
  it("空搜尋 → 包裝（含 placeholderData 過渡）→ 精密（含 placeholderData 過渡）：resultCount 全部正確，不受 stale data 污染", () => {
    const records: { resultCount: number; keyword: string }[] = [];
    const onRecord = (resultCount: number, keyword: string) => records.push({ resultCount, keyword });

    const fpEmpty = buildSearchFingerprint({ keyword: "" });
    const fpPackaging = buildSearchFingerprint({ keyword: "包裝" });
    const fpPrecision = buildSearchFingerprint({ keyword: "精密" });

    const { rerender } = render(
      <AnalyticsHarness keyword="" queryState={{ isFetching: true, data: undefined }} onRecord={onRecord} />
    );
    expect(records).toHaveLength(0);

    // 1. 空搜尋的 response 回來：fingerprint=A, total=44 → 記錄。
    rerender(<AnalyticsHarness keyword="" queryState={{ isFetching: false, data: { searchFingerprint: fpEmpty, total: 44 } }} onRecord={onRecord} />);
    expect(records).toEqual([{ resultCount: 44, keyword: "" }]);

    // 2. 使用者切換到「包裝」：react-query 的 placeholderData 讓這個 render
    // 呈現 isFetching=false（已經不在「official loading」狀態）但 data 其實
    // 還是沿用舊的 response（fingerprint 仍是 fpEmpty, total=44）——這正是
    // 先前 isFetching-based 守門會誤判成「可以記錄」的那個 render。這裡必須
    // 驗證：即使 isFetching=false，只要 fingerprint 對不上，還是不能記錄。
    rerender(<AnalyticsHarness keyword="包裝" queryState={{ isFetching: false, data: { searchFingerprint: fpEmpty, total: 44 } }} onRecord={onRecord} />);
    expect(records).toHaveLength(1); // 不得多一筆、不得用 44 誤記成「包裝」的結果

    // 3. 真正「包裝」的 response 回來：fingerprint=B, total=9。
    rerender(<AnalyticsHarness keyword="包裝" queryState={{ isFetching: false, data: { searchFingerprint: fpPackaging, total: 9 } }} onRecord={onRecord} />);
    expect(records).toEqual([
      { resultCount: 44, keyword: "" },
      { resultCount: 9, keyword: "包裝" },
    ]);

    // 4. 再切「精密」：stale data 的 fingerprint 仍是 fpPackaging，current
    // fingerprint 已經是「精密」的——不得記錄。
    rerender(<AnalyticsHarness keyword="精密" queryState={{ isFetching: false, data: { searchFingerprint: fpPackaging, total: 9 } }} onRecord={onRecord} />);
    expect(records).toHaveLength(2);

    // 5. 真正「精密」的 response 回來：只記一次、且是正確的 resultCount。
    rerender(<AnalyticsHarness keyword="精密" queryState={{ isFetching: false, data: { searchFingerprint: fpPrecision, total: 2 } }} onRecord={onRecord} />);
    expect(records).toEqual([
      { resultCount: 44, keyword: "" },
      { resultCount: 9, keyword: "包裝" },
      { resultCount: 2, keyword: "精密" },
    ]);
  });

  it("同一 fingerprint 的背景 refetch（isFetching 短暫變 true 再變 false，data 內容不變）不得重複記錄", () => {
    const records: { resultCount: number; keyword: string }[] = [];
    const onRecord = (resultCount: number, keyword: string) => records.push({ resultCount, keyword });
    const fp = buildSearchFingerprint({ keyword: "精密" });

    const { rerender } = render(
      <AnalyticsHarness keyword="精密" queryState={{ isFetching: false, data: { searchFingerprint: fp, total: 2 } }} onRecord={onRecord} />
    );
    expect(records).toEqual([{ resultCount: 2, keyword: "精密" }]);

    // 背景 refetch 開始（例如 window refocus 觸發）：isFetching 短暫變 true，
    // fingerprint／data 不變。
    rerender(<AnalyticsHarness keyword="精密" queryState={{ isFetching: true, data: { searchFingerprint: fp, total: 2 } }} onRecord={onRecord} />);
    expect(records).toHaveLength(1);

    // refetch 完成：isFetching 變回 false，fingerprint／total 仍然相同。
    rerender(<AnalyticsHarness keyword="精密" queryState={{ isFetching: false, data: { searchFingerprint: fp, total: 2 } }} onRecord={onRecord} />);
    expect(records).toHaveLength(1); // 不得因為 refetch 又多記一筆
  });

  it("同一 query 因為不相關的 state 變化造成 rerender（fingerprint／data 都沒變）不得重複記錄", () => {
    const records: { resultCount: number; keyword: string }[] = [];
    const onRecord = (resultCount: number, keyword: string) => records.push({ resultCount, keyword });
    const fp = buildSearchFingerprint({ keyword: "包裝" });
    const data = { searchFingerprint: fp, total: 9 };

    const { rerender } = render(
      <AnalyticsHarness keyword="包裝" queryState={{ isFetching: false, data }} onRecord={onRecord} />
    );
    expect(records).toEqual([{ resultCount: 9, keyword: "包裝" }]);

    // 完全相同的 props 再 rerender 幾次（模擬父層其他 state 變化造成的
    // 無關 rerender）。
    rerender(<AnalyticsHarness keyword="包裝" queryState={{ isFetching: false, data }} onRecord={onRecord} />);
    rerender(<AnalyticsHarness keyword="包裝" queryState={{ isFetching: false, data }} onRecord={onRecord} />);
    expect(records).toHaveLength(1);
  });
});
