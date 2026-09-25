import { describe, expect, it } from "vitest";
import { buildSearchFingerprint } from "./searchFingerprint";

describe("buildSearchFingerprint — canonical fingerprint（見對話「Search Analytics resultCount 方案 A」）", () => {
  it("key 順序不同的輸入物件 → fingerprint 相同（只看值，不看呼叫端怎麼組物件）", () => {
    const a = buildSearchFingerprint({ keyword: "包裝", industry: ["電子"], sortBy: "rating" });
    const b = buildSearchFingerprint({ sortBy: "rating", industry: ["電子"], keyword: "包裝" });
    expect(a).toBe(b);
  });

  it("undefined／null／空字串一律正規化成同一種值", () => {
    const a = buildSearchFingerprint({ keyword: undefined });
    const b = buildSearchFingerprint({ keyword: null });
    const c = buildSearchFingerprint({ keyword: "" });
    const d = buildSearchFingerprint({ keyword: "   " }); // trim 後也是空字串
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });

  it("陣列元素順序不同 → fingerprint 相同（集合語意，SQL 端用 JSON_OVERLAPS／IN 不看順序）", () => {
    const a = buildSearchFingerprint({ industry: ["電子", "金屬加工", "紡織"] });
    const b = buildSearchFingerprint({ industry: ["紡織", "電子", "金屬加工"] });
    expect(a).toBe(b);
  });

  it("陣列有重複元素 → 正規化去重後 fingerprint 相同", () => {
    const a = buildSearchFingerprint({ region: ["新竹市", "新竹市", "台中市"] });
    const b = buildSearchFingerprint({ region: ["台中市", "新竹市"] });
    expect(a).toBe(b);
  });

  it("陣列元素含前後空白／空字串 → trim 並過濾空字串後相同", () => {
    const a = buildSearchFingerprint({ subIndustry: [" 沖壓 ", "", "焊接"] });
    const b = buildSearchFingerprint({ subIndustry: ["沖壓", "焊接"] });
    expect(a).toBe(b);
  });

  it("undefined 陣列與空陣列視為相同（都代表「未篩選」）", () => {
    const a = buildSearchFingerprint({ industry: undefined });
    const b = buildSearchFingerprint({ industry: [] });
    expect(a).toBe(b);
  });

  it("keyword 不同 → fingerprint 不同", () => {
    const a = buildSearchFingerprint({ keyword: "包裝" });
    const b = buildSearchFingerprint({ keyword: "精密" });
    expect(a).not.toBe(b);
  });

  it("filter（industry）不同 → fingerprint 不同", () => {
    const a = buildSearchFingerprint({ keyword: "包裝", industry: ["電子"] });
    const b = buildSearchFingerprint({ keyword: "包裝", industry: ["金屬加工"] });
    expect(a).not.toBe(b);
  });

  it("filter（region/capitalLevel/mfgMode/smallBatch/sample）不同 → fingerprint 都不同", () => {
    const base = buildSearchFingerprint({ keyword: "測試" });
    expect(buildSearchFingerprint({ keyword: "測試", region: ["台中市"] })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", capitalLevel: ["<1000萬"] })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", mfgMode: "ODM" })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", smallBatch: true })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", sample: true })).not.toBe(base);
  });

  it("businessType='all' 與未帶 businessType 視為相同（跟 server 實際 WHERE 組裝邏輯一致）", () => {
    const a = buildSearchFingerprint({ businessType: "all" });
    const b = buildSearchFingerprint({ businessType: undefined });
    expect(a).toBe(b);
    const c = buildSearchFingerprint({ businessType: "factory" });
    expect(c).not.toBe(a);
  });

  it("sortBy 未帶值與 sortBy='rating' 視為相同（跟 server useAIMode 判斷式 `!sortBy` 語意一致）", () => {
    const a = buildSearchFingerprint({ sortBy: undefined });
    const b = buildSearchFingerprint({ sortBy: "rating" });
    expect(a).toBe(b);
  });

  it("sortBy 不同（非 rating）→ fingerprint 不同（sortBy 會改變 server 的 useAIMode 分支，進而影響 total，見 searchFingerprint.ts 開頭說明）", () => {
    const a = buildSearchFingerprint({ keyword: "測試", sortBy: "rating" });
    const b = buildSearchFingerprint({ keyword: "測試", sortBy: "newest" });
    expect(a).not.toBe(b);
  });

  it("AI mode 不同（q 或 aiSearchConversationId）→ fingerprint 不同", () => {
    const base = buildSearchFingerprint({ keyword: "測試" });
    expect(buildSearchFingerprint({ keyword: "測試", q: "CNC 五軸" })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", aiSearchConversationId: 123 })).not.toBe(base);
    expect(buildSearchFingerprint({ keyword: "測試", aiSearchConversationId: 123 })).not.toBe(
      buildSearchFingerprint({ keyword: "測試", aiSearchConversationId: 456 })
    );
  });

  it("page／pageSize 不在 fingerprint 涵蓋範圍內（換頁不算新的一次搜尋，見 searchFingerprint.ts 開頭說明）", () => {
    // SearchFingerprintInput 型別本身就沒有 page/pageSize 欄位——這個測試
    // 用「完全相同的其餘欄位」驗證 fingerprint 穩定，間接證明呼叫端就算
    // 換頁也不需要、也不能把 page 塞進來影響 fingerprint。
    const a = buildSearchFingerprint({ keyword: "測試", industry: ["電子"] });
    const b = buildSearchFingerprint({ keyword: "測試", industry: ["電子"] });
    expect(a).toBe(b);
  });

  it("aiSearchConversationId 非有限數字（NaN/Infinity）正規化成 0（等同未使用）", () => {
    const a = buildSearchFingerprint({ aiSearchConversationId: undefined });
    const b = buildSearchFingerprint({ aiSearchConversationId: NaN });
    const c = buildSearchFingerprint({ aiSearchConversationId: Infinity });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("完全相同輸入多次呼叫 → fingerprint 完全穩定（deterministic）", () => {
    const input = { keyword: "精密", industry: ["電子", "金屬加工"], smallBatch: true, sortBy: "newest" as const };
    const results = new Set(Array.from({ length: 5 }, () => buildSearchFingerprint(input)));
    expect(results.size).toBe(1);
  });
});
