/**
 * 子產業「搜尋」SEO slug 系統（shared/constants.ts 的 SUB_INDUSTRY_SEARCH_ENTRIES／
 * SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY／SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL）
 * ——純資料層測試，不查 DB。涵蓋任務定案「子產業 slug 系統」的要求：
 *   1. 每個可搜尋子產業有 label／slug／parent industry／parent industry slug
 *   2. 不允許同一子產業在多個地方各自 hardcode slug（唯一 source of truth）
 *   3. slug 全域唯一，且不跟 13 個主產業 slug 撞名
 *   4. reverse lookup（slug → 子產業資料）正確
 *   5. 非法 slug 可辨識（查表對不到）
 *   6. 「其他」不建 SEO 頁；「塑膠包裝」parent-aware collision 各自獨立不合併
 */
import { describe, expect, it } from "vitest";
import {
  INDUSTRIES, INDUSTRY_SLUGS, INDUSTRY_OPTIONS,
  SUB_INDUSTRY_SEARCH_ENTRIES, SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY,
  SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL,
} from "@shared/constants";

describe("SUB_INDUSTRY_SEARCH_ENTRIES：涵蓋率（除了「其他」，一筆不漏、一筆不多）", () => {
  const expectedPairs = new Set<string>();
  for (const ind of INDUSTRIES) {
    for (const sub of ind.sub) {
      if (sub === "其他") continue;
      expectedPairs.add(`${ind.name}|||${sub}`);
    }
  }

  it("entries 數量與 INDUSTRIES（扣掉「其他」）的原始 (industry, sub) pair 數量一致", () => {
    expect(SUB_INDUSTRY_SEARCH_ENTRIES.length).toBe(expectedPairs.size);
  });

  it("每一筆 INDUSTRIES 裡的 (industry, sub) pair（扣掉「其他」）都能在 entries 找到，沒有遺漏", () => {
    const actualPairs = new Set(SUB_INDUSTRY_SEARCH_ENTRIES.map(e => `${e.parentIndustry}|||${e.label}`));
    const missing = Array.from(expectedPairs).filter(p => !actualPairs.has(p));
    expect(missing).toEqual([]);
  });

  it("entries 裡沒有多出 INDUSTRIES 資料裡不存在的 (industry, sub) pair", () => {
    const actualPairs = SUB_INDUSTRY_SEARCH_ENTRIES.map(e => `${e.parentIndustry}|||${e.label}`);
    const extra = actualPairs.filter(p => !expectedPairs.has(p));
    expect(extra).toEqual([]);
  });

  it("「其他」完全不出現在 entries 裡（13 個主產業底下的「其他」都不建 SEO 頁）", () => {
    expect(SUB_INDUSTRY_SEARCH_ENTRIES.some(e => e.label === "其他")).toBe(false);
  });
});

describe("SUB_INDUSTRY_SEARCH_ENTRIES：slug 唯一性與命名規則", () => {
  it("每個 slug 在全部子產業之間唯一（0 duplicate）", () => {
    const slugs = SUB_INDUSTRY_SEARCH_ENTRIES.map(e => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("沒有任何子產業 slug 跟 13 個主產業 slug（INDUSTRY_SLUGS 的值）撞名", () => {
    const mainSlugs = new Set(Object.values(INDUSTRY_SLUGS));
    const collided = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => mainSlugs.has(e.slug));
    expect(collided).toEqual([]);
  });

  it("slug 只包含小寫英文字母、數字與連字號（不含中文／空白／斜線／全形符號）", () => {
    const invalid = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => !/^[a-z0-9-]+$/.test(e.slug));
    expect(invalid).toEqual([]);
  });

  it("每筆 entry 的 parentIndustrySlug 都正確對應 INDUSTRY_SLUGS[parentIndustry]（不是各自 hardcode 出來的另一份值）", () => {
    const mismatched = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => INDUSTRY_SLUGS[e.parentIndustry] !== e.parentIndustrySlug);
    expect(mismatched).toEqual([]);
  });

  it("每筆 entry 的 parentIndustry 都是合法的主產業名稱（INDUSTRY_OPTIONS 之一）", () => {
    const invalid = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => !INDUSTRY_OPTIONS.includes(e.parentIndustry as any));
    expect(invalid).toEqual([]);
  });

  it("displayName 只供顯示用，不含「/」「（」「）」等 DB label 才有的複合寫法", () => {
    const withSlash = SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => /[/（）]/.test(e.displayName));
    expect(withSlash).toEqual([]);
  });
});

describe("SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY：reverse lookup（slug → 子產業資料）", () => {
  it("每個 entry 都能用自己的 slug 反查回同一筆 entry", () => {
    for (const e of SUB_INDUSTRY_SEARCH_ENTRIES) {
      expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[e.slug]).toEqual(e);
    }
  });

  it("非法 slug 反查回 undefined（可用來判斷非法子產業 slug）", () => {
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY["not-a-real-sub-industry"]).toBeUndefined();
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[""]).toBeUndefined();
  });

  it("反查表筆數與 entries 陣列筆數一致（沒有因為 key 撞名而互相覆蓋掉任何一筆）", () => {
    expect(Object.keys(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY).length).toBe(SUB_INDUSTRY_SEARCH_ENTRIES.length);
  });
});

describe("「塑膠包裝」parent-aware collision：資料設計上允許同名子產業存在於不同主產業，兩筆都保留、各自唯一 slug", () => {
  const plasticEntry = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL["塑膠|||塑膠包裝"];
  const packagingEntry = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL["包裝|||塑膠包裝"];

  it("兩筆 entry 都存在，不是只保留其中一筆", () => {
    expect(plasticEntry).toBeDefined();
    expect(packagingEntry).toBeDefined();
  });

  it("兩筆的 label 都是「塑膠包裝」（title/H1 可以都顯示這個字）", () => {
    expect(plasticEntry!.label).toBe("塑膠包裝");
    expect(packagingEntry!.label).toBe("塑膠包裝");
  });

  it("兩筆的 slug 各自獨立、彼此不同", () => {
    expect(plasticEntry!.slug).not.toBe(packagingEntry!.slug);
  });

  it("兩筆的 parentIndustry 分別正確是「塑膠」與「包裝」", () => {
    expect(plasticEntry!.parentIndustry).toBe("塑膠");
    expect(packagingEntry!.parentIndustry).toBe("包裝");
  });

  it("用 slug 反查回來的 parentIndustry 跟用 (parentIndustry, label) 查表查到的是同一筆", () => {
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[plasticEntry!.slug]).toEqual(plasticEntry);
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[packagingEntry!.slug]).toEqual(packagingEntry);
  });

  it("全部子產業裡，「塑膠包裝」是唯一一個同時屬於兩個以上主產業的 label（再次確認沒有其他遺漏的 collision）", () => {
    const labelToParents = new Map<string, Set<string>>();
    for (const e of SUB_INDUSTRY_SEARCH_ENTRIES) {
      if (!labelToParents.has(e.label)) labelToParents.set(e.label, new Set());
      labelToParents.get(e.label)!.add(e.parentIndustry);
    }
    const multiParentLabels = Array.from(labelToParents.entries()).filter(([, parents]) => parents.size > 1);
    expect(multiParentLabels).toEqual([["塑膠包裝", new Set(["塑膠", "包裝"])]]);
  });
});
