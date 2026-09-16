// @vitest-environment jsdom
/**
 * /search 的「可接小量」／「可打樣」URL query params 序列化／往返解析測試
 * （見 CLAUDE.md 本輪「搜尋篩選優化」）。
 *
 * buildParams 是 Search.tsx 裡唯一的序列化實作，元件內每個會寫 URL 的地方
 * （syncURL／handleSearch／removeFilter／clearFilters／handleShareSearch／
 * canonicalQs）都呼叫同一份，所以直接測這個函式等於測元件實際寫出的 URL。
 * 「解析」邏輯本身是元件 mount 時對 URLSearchParams 的內聯讀取
 * （`params.get("smallBatch") === "true"`），沒有獨立函式可以匯出測試，這裡
 * 改用「序列化出的 query string 用 URLSearchParams 解回來，值是否符合預期」
 * 的往返測試涵蓋同一件事：字面值必須剛好是 "true" 才視為已勾選，其餘一律
 * 視為不限（跟元件內聯解析用的判斷式完全一致）。
 */
import { describe, expect, it } from "vitest";
import { buildParams, buildSearchShareSummary } from "./Search";

const BASE = { mfgMode: "", industry: [], subIndustry: [], region: [], keyword: "", businessType: "all", sortBy: "rating" };

describe("buildParams（URL serializer）", () => {
  it("兩個都不勾：不出現 smallBatch／sample", () => {
    const qs = buildParams({ ...BASE }).toString();
    expect(qs.includes("smallBatch")).toBe(false);
    expect(qs.includes("sample")).toBe(false);
  });

  it("只勾可接小量：只寫入 smallBatch=true", () => {
    const p = buildParams({ ...BASE, smallBatch: true });
    expect(p.get("smallBatch")).toBe("true");
    expect(p.has("sample")).toBe(false);
  });

  it("只勾可打樣：只寫入 sample=true", () => {
    const p = buildParams({ ...BASE, sample: true });
    expect(p.get("sample")).toBe("true");
    expect(p.has("smallBatch")).toBe(false);
  });

  it("兩個都勾：smallBatch=true 且 sample=true 同時出現", () => {
    const p = buildParams({ ...BASE, smallBatch: true, sample: true });
    expect(p.get("smallBatch")).toBe("true");
    expect(p.get("sample")).toBe("true");
  });

  it("smallBatch:false／sample:false 顯式傳入時，不留下 false 值（不是冗餘的 xxx=false）", () => {
    const qs = buildParams({ ...BASE, smallBatch: false, sample: false }).toString();
    expect(qs.includes("smallBatch")).toBe(false);
    expect(qs.includes("sample")).toBe(false);
  });

  it("不破壞既有 region／industry／subIndustry／businessType／mfgMode／keyword 參數行為", () => {
    const p = buildParams({
      mfgMode: "ODM",
      industry: ["電子"],
      subIndustry: ["晶圓"],
      region: ["新竹市", "台北市"],
      keyword: "CNC",
      businessType: "factory",
      sortBy: "newest",
      smallBatch: true,
      sample: true,
    });
    expect(p.get("mfgMode")).toBe("ODM");
    expect(p.getAll("industry")).toEqual(["電子"]);
    expect(p.getAll("subIndustry")).toEqual(["晶圓"]);
    expect(p.getAll("region")).toEqual(["新竹市", "台北市"]);
    expect(p.get("keyword")).toBe("CNC");
    expect(p.get("businessType")).toBe("factory");
    expect(p.get("sortBy")).toBe("newest");
    expect(p.get("smallBatch")).toBe("true");
    expect(p.get("sample")).toBe("true");
  });
});

describe("URL round-trip（序列化 → URLSearchParams 解析），對齊元件內聯解析邏輯", () => {
  it("只有字面值 'true' 才視為已勾選；其餘一律視為不限", () => {
    const qs = buildParams({ ...BASE, smallBatch: true, sample: true }).toString();
    const parsed = new URLSearchParams(qs);
    expect(parsed.get("smallBatch") === "true").toBe(true);
    expect(parsed.get("sample") === "true").toBe(true);
  });

  it("沒有 param 時，解析結果視為不限（false）", () => {
    const qs = buildParams({ ...BASE }).toString();
    const parsed = new URLSearchParams(qs);
    expect(parsed.get("smallBatch") === "true").toBe(false);
    expect(parsed.get("sample") === "true").toBe(false);
  });

  it("手動組出非預期值（例如 smallBatch=1）也視為不限，不會誤判成已勾選", () => {
    const parsed = new URLSearchParams("smallBatch=1&sample=yes");
    expect(parsed.get("smallBatch") === "true").toBe(false);
    expect(parsed.get("sample") === "true").toBe(false);
  });
});

describe("buildSearchShareSummary 納入生產條件文字（分享摘要，非 URL 本身）", () => {
  it("勾選可接小量／可打樣時，摘要文字包含對應片語", () => {
    const text = buildSearchShareSummary({
      keyword: "", region: [], industry: [], subIndustry: [],
      businessType: "all", mfgMode: "", smallBatch: true, sample: true,
    });
    expect(text).toContain("可接小量");
    expect(text).toContain("可打樣");
  });
});
