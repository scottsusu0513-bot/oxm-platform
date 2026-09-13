import { describe, expect, it } from "vitest";
import {
  parsePageParam,
  pageToQueryValue,
  computeTotalPages,
  clampPage,
  getPaginationRange,
} from "./industryPagination";

describe("parsePageParam：URL page 參數正規化", () => {
  it("缺少 page 參數視為第 1 頁", () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
  });
  it("page=1 維持第 1 頁", () => {
    expect(parsePageParam("1")).toBe(1);
  });
  it("page=2 正確解析為第 2 頁", () => {
    expect(parsePageParam("2")).toBe(2);
  });
  it("page=abc（非數字字串）視為第 1 頁，不拋錯", () => {
    expect(parsePageParam("abc")).toBe(1);
  });
  it("page=0 視為第 1 頁", () => {
    expect(parsePageParam("0")).toBe(1);
  });
  it("page=-1 視為第 1 頁", () => {
    expect(parsePageParam("-1")).toBe(1);
  });
  it("非整數字串（例如 2.5）視為第 1 頁", () => {
    expect(parsePageParam("2.5")).toBe(1);
  });
});

describe("pageToQueryValue：page 轉回 URL query 值", () => {
  it("第 1 頁不需要 query 參數（回傳 null）", () => {
    expect(pageToQueryValue(1)).toBeNull();
  });
  it("第 2 頁以後回傳字串頁碼", () => {
    expect(pageToQueryValue(2)).toBe("2");
    expect(pageToQueryValue(30)).toBe("30");
  });
});

describe("computeTotalPages", () => {
  it("total 為 0 時仍是第 1 頁（顯示空清單，不是 0 頁）", () => {
    expect(computeTotalPages(0, 15)).toBe(1);
  });
  it("total 剛好整除 pageSize", () => {
    expect(computeTotalPages(30, 15)).toBe(2);
  });
  it("total 無法整除 pageSize 時無條件進位", () => {
    expect(computeTotalPages(16, 15)).toBe(2);
    expect(computeTotalPages(31, 15)).toBe(3);
  });
});

describe("clampPage：page 超過 totalPages 時 normalize 到最後一頁", () => {
  it("page 超過 totalPages → normalize 到 totalPages", () => {
    expect(clampPage(20, 5)).toBe(5);
  });
  it("page 在範圍內維持不變", () => {
    expect(clampPage(3, 5)).toBe(3);
  });
  it("page 小於 1 → normalize 到第 1 頁", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });
});

describe("getPaginationRange：精簡頁碼列（含省略號規則）", () => {
  it("totalPages=1：只有一頁", () => {
    expect(getPaginationRange(1, 1)).toEqual([1]);
  });
  it("totalPages=5：頁數少，全部列出，不出現省略號", () => {
    expect(getPaginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPaginationRange(5, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("totalPages=7：頁數少，全部列出，不出現省略號", () => {
    expect(getPaginationRange(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(getPaginationRange(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(getPaginationRange(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("totalPages=30, current=1：第一頁附近視窗 + 尾端錨點", () => {
    expect(getPaginationRange(1, 30)).toEqual([1, 2, 3, 4, 5, "ellipsis", 29, 30]);
  });
  it("totalPages=30, current=2：視窗被起始邊界頂住，仍維持 5 頁寬", () => {
    expect(getPaginationRange(2, 30)).toEqual([1, 2, 3, 4, 5, "ellipsis", 29, 30]);
  });
  it("totalPages=30, current=15：中間頁，前後都有省略號", () => {
    expect(getPaginationRange(15, 30)).toEqual([1, 2, "ellipsis", 13, 14, 15, 16, 17, "ellipsis", 29, 30]);
  });
  it("totalPages=30, current=29：接近尾端", () => {
    expect(getPaginationRange(29, 30)).toEqual([1, 2, "ellipsis", 26, 27, 28, 29, 30]);
  });
  it("totalPages=30, current=30：最後一頁", () => {
    expect(getPaginationRange(30, 30)).toEqual([1, 2, "ellipsis", 26, 27, 28, 29, 30]);
  });
});
