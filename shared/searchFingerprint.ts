/**
 * factory.search 的 canonical search fingerprint（見對話「Search Analytics
 * resultCount 方案 A」）。
 *
 * 背景：Search.tsx 的搜尋 analytics event 曾經因為
 * trpc.factory.search.useQuery 的 placeholderData:(prev)=>prev，在切換搜尋
 * 條件時把「上一筆」查詢的 resultCount 誤記到「這一筆」的事件上——先前嘗試
 * 用 react-query 的 isFetching／isPlaceholderData／dataUpdatedAt 這些時序
 * 訊號當守門條件，但無法在任何本機環境重現正式站失敗的確切機制，代表光靠
 * 「猜對時序」不是結構性的修法。
 *
 * 這裡改用完全不同的策略：server 端在 factory.search 的回應裡，用「它實際
 * 收到、實際拿去查詢的 input」自己算一份 fingerprint 一起回傳
 * （searchFingerprint）；client 端也用「目前畫面上的搜尋條件」算一份
 * fingerprint，只有兩者完全相等時才允許記錄 analytics search event、且
 * resultCount 只能從那一份 fingerprint 相符的 response 讀。不管 react-query
 * 內部的 isFetching／data 時序在正式站究竟發生什麼事，只要 response 本身
 * 「自己宣稱」不是目前這次查詢的結果，就一定會被擋下來——不依賴猜測任何
 * 中間狀態的正確性。
 *
 * 涵蓋欄位：只涵蓋會影響 factory.search 回傳 `total`（進而影響 resultCount）
 * 的欄位。逐一核對 server/db.ts searchFactories 的實作：
 *   - keyword／industry／subIndustry／region／capitalLevel／mfgMode／
 *     businessType／smallBatch／sample：直接進 SQL WHERE conditions，
 *     必須涵蓋。
 *   - q／aiSearchConversationId：決定 rankingSignals／AI Search Mode 是否
 *     啟用，AI Search Mode 分支的 whereClause／content OR 條件跟一般模式不
 *     同，會改變 total，必須涵蓋。
 *   - sortBy：容易被誤判成「只影響排序」而略過——但 server/db.ts 裡
 *     `useAIMode = hasIntent && (!sortBy || sortBy === 'rating')`，sortBy
 *     會決定 useAIMode 分支是否啟用、進而改變 contentConds 是否加進
 *     WHERE，因此**也會實際影響 total**，必須涵蓋。
 *   - page／pageSize：只影響 LIMIT/OFFSET 切片，完全不影響 total，且現有
 *     產品定義本來就是「換頁不算新的一次搜尋」（見 Search.tsx 既有
 *     filterFingerprint 排除 page 的註解），故不涵蓋——涵蓋 page 只會讓同一
 *     次搜尋的第 2 頁被誤判成「不同的搜尋」，錯誤地漏記／擋下合法事件。
 *
 * normalization 規則：
 *   - 字串：trim；undefined／null／空字串一律正規化成 ""。
 *   - businessType 的 "all" 視同未篩選（跟 server 實際 WHERE 組裝邏輯
 *     一致：`businessType !== 'all' ? businessType : undefined`）。
 *   - sortBy 空值正規化成 "rating"（跟 server `!sortBy` 视为 'rating' 的
 *     語意一致，見上面 useAIMode 判斷式）。
 *   - 陣列：trim 每個元素、過濾空字串、去重、**排序**後再比較——
 *     industry／subIndustry／region／capitalLevel 在 SQL 端都是集合語意
 *     （JSON_OVERLAPS／JSON_CONTAINS OR／IN），排列順序不影響查詢結果，
 *     所以 fingerprint 也不應該因為陣列元素順序不同而被誤判成不同查詢。
 *   - boolean：一律正規化成 true／false（== true 才算 true）。
 *   - number（aiSearchConversationId）：非有限數字一律正規化成 0
 *     （代表「未使用」，跟 undefined 等價）。
 *   - 輸出：固定 key 順序的 [key, value] tuple 陣列做 JSON.stringify，
 *     不直接對物件字面量做 JSON.stringify（物件 key 順序雖然在 JS 引擎裡
 *     多半穩定，但這裡刻意不依賴這個隱含保證）。
 */

export interface SearchFingerprintInput {
  keyword?: string | null;
  industry?: string[] | null;
  subIndustry?: string[] | null;
  region?: string[] | null;
  capitalLevel?: string[] | null;
  mfgMode?: string | null;
  businessType?: string | null;
  smallBatch?: boolean | null;
  sample?: boolean | null;
  sortBy?: string | null;
  q?: string | null;
  aiSearchConversationId?: number | null;
}

function normStr(v: string | undefined | null): string {
  return v == null ? "" : v.trim();
}

function normArr(v: string[] | undefined | null): string[] {
  if (!v || v.length === 0) return [];
  return Array.from(new Set(v.map(s => s.trim()).filter(s => s.length > 0))).sort();
}

function normBool(v: boolean | undefined | null): boolean {
  return v === true;
}

function normNum(v: number | undefined | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function buildSearchFingerprint(input: SearchFingerprintInput): string {
  const businessType = normStr(input.businessType);
  const sortBy = normStr(input.sortBy);

  const entries: [string, string | string[] | boolean | number][] = [
    ["keyword", normStr(input.keyword)],
    ["industry", normArr(input.industry)],
    ["subIndustry", normArr(input.subIndustry)],
    ["region", normArr(input.region)],
    ["capitalLevel", normArr(input.capitalLevel)],
    ["mfgMode", normStr(input.mfgMode)],
    ["businessType", businessType === "all" ? "" : businessType],
    ["smallBatch", normBool(input.smallBatch)],
    ["sample", normBool(input.sample)],
    ["sortBy", sortBy === "" ? "rating" : sortBy],
    ["q", normStr(input.q)],
    ["aiSearchConversationId", normNum(input.aiSearchConversationId)],
  ];
  return JSON.stringify(entries);
}
