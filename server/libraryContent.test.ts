/**
 * shared/content/library.ts：傳產圖書館文章資料的結構性驗證（見任務定案
 * 「傳產圖書館 Phase 1 實作」）。這裡不測 SEO meta／JSON-LD 的產生邏輯
 * （見 server/libraryPages.test.ts），只驗證資料本身的完整性與內部一致性
 * ——slug／libraryId 不重複、category 合法、relatedArticleSlugs／faq／
 * relatedLink 區塊指向的 slug 都真的存在、cta 的 href 格式合理。
 */
import { describe, expect, it } from "vitest";
import {
  LIBRARY_ARTICLES, LIBRARY_ARTICLE_BY_SLUG, LIBRARY_CATEGORIES,
  getLibraryArticle, getLibraryArticlesByCategory, estimateReadingMinutes,
  type LibraryArticle,
} from "@shared/content/library";

describe("LIBRARY_ARTICLES：Phase 1 共 3 筆", () => {
  it("目前正好 3 篇文章", () => {
    expect(LIBRARY_ARTICLES.length).toBe(3);
  });

  it("slug 全部唯一", () => {
    const slugs = LIBRARY_ARTICLES.map(a => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("libraryId 全部唯一，且格式固定 LIB-XXX（三位數）", () => {
    const ids = LIBRARY_ARTICLES.map(a => a.libraryId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^LIB-\d{3}$/);
    }
  });

  it("libraryId 依上架順序遞增，沒有跳號或重複編號", () => {
    expect(LIBRARY_ARTICLES.map(a => a.libraryId)).toEqual(["LIB-001", "LIB-002", "LIB-003"]);
  });

  it("每篇文章的 category 都在 LIBRARY_CATEGORIES 合法清單內", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(LIBRARY_CATEGORIES).toContain(article.category);
    }
  });

  it("Phase 1 三篇全部歸類在「代工基礎」（見任務定案，不做 13 主產業分類版圖書館）", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.category).toBe("代工基礎");
    }
  });

  it("必填欄位都是非空字串", () => {
    for (const article of LIBRARY_ARTICLES) {
      for (const field of ["slug", "libraryId", "title", "metaDescription", "h1", "excerpt", "publishedAt", "updatedAt"] as const) {
        expect(typeof article[field]).toBe("string");
        expect((article[field] as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("publishedAt／updatedAt 是合法 ISO 日期字串（YYYY-MM-DD），且 updatedAt 不早於 publishedAt", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(article.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(article.publishedAt).getTime());
    }
  });

  it("body 陣列不為空，且每個區塊都是合法的已知 type", () => {
    const validTypes = ["paragraph", "heading", "list", "table", "relatedLink"];
    for (const article of LIBRARY_ARTICLES) {
      expect(article.body.length).toBeGreaterThan(0);
      for (const block of article.body) {
        expect(validTypes).toContain(block.type);
      }
    }
  });

  it("relatedArticleSlugs 指向的 slug 都是真實存在的文章，且不包含自己", () => {
    for (const article of LIBRARY_ARTICLES) {
      for (const relSlug of article.relatedArticleSlugs) {
        expect(LIBRARY_ARTICLE_BY_SLUG[relSlug]).toBeDefined();
        expect(relSlug).not.toBe(article.slug);
      }
    }
  });

  it("body 裡 relatedLink 區塊指向的 slug 都是真實存在的文章，且不包含自己", () => {
    for (const article of LIBRARY_ARTICLES) {
      const relatedLinkBlocks = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "relatedLink" }> => b.type === "relatedLink");
      for (const block of relatedLinkBlocks) {
        expect(LIBRARY_ARTICLE_BY_SLUG[block.slug]).toBeDefined();
        expect(block.slug).not.toBe(article.slug);
      }
    }
  });

  it("faq（有設定時）每一項都有非空 question／answer；沒有 faq 的文章維持 undefined，不強制每篇都有", () => {
    for (const article of LIBRARY_ARTICLES) {
      if (article.faq === undefined) continue;
      expect(article.faq.length).toBeGreaterThan(0);
      for (const qa of article.faq) {
        expect(qa.question.length).toBeGreaterThan(0);
        expect(qa.answer.length).toBeGreaterThan(0);
      }
    }
  });

  it("只有 oem-vs-odm 這篇有 faq（本輪明確決定不是每篇都硬加 FAQ）", () => {
    expect(LIBRARY_ARTICLE_BY_SLUG["oem-vs-odm"].faq).toBeDefined();
    expect(LIBRARY_ARTICLE_BY_SLUG["what-is-moq"].faq).toBeUndefined();
    expect(LIBRARY_ARTICLE_BY_SLUG["first-time-factory-guide"].faq).toBeUndefined();
  });

  it("cta.href 一律是站內相對路徑（以 / 開頭），不是外部網址", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.cta.href.startsWith("/")).toBe(true);
      if (article.cta.secondaryHref) {
        expect(article.cta.secondaryHref.startsWith("/")).toBe(true);
      }
    }
  });

  it("MOQ 文章的 CTA 指向 /search 的可接小量／可打樣篩選（真實存在的 query param，見 Search.tsx）", () => {
    const moq = LIBRARY_ARTICLE_BY_SLUG["what-is-moq"];
    expect(moq.cta.href).toBe("/search?smallBatch=true&sample=true");
  });

  it("OEM/ODM 文章的 CTA 同時提供 ODM／OEM 兩個並列選項，不假設所有工廠都支援同一種代工模式", () => {
    const oemOdm = LIBRARY_ARTICLE_BY_SLUG["oem-vs-odm"];
    expect(oemOdm.cta.href).toBe("/search?mfgMode=ODM");
    expect(oemOdm.cta.secondaryHref).toBe("/search?mfgMode=OEM");
  });

  it("第一次找代工廠文章的 CTA 指向 /search（一般搜尋入口）", () => {
    const guide = LIBRARY_ARTICLE_BY_SLUG["first-time-factory-guide"];
    expect(guide.cta.href).toBe("/search");
  });

  it("relatedIndustrySlugs／relatedSubIndustrySlugs／relatedFactoryLandingSlugs 目前刻意留空（3 篇都是跨產業通用概念文章，不虛構關聯）", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.relatedIndustrySlugs).toEqual([]);
      expect(article.relatedSubIndustrySlugs).toEqual([]);
      expect(article.relatedFactoryLandingSlugs).toEqual([]);
    }
  });
});

describe("getLibraryArticle／getLibraryArticlesByCategory", () => {
  it("合法 slug 回傳對應文章", () => {
    expect(getLibraryArticle("what-is-moq")?.libraryId).toBe("LIB-001");
  });

  it("不存在的 slug 回傳 undefined", () => {
    expect(getLibraryArticle("does-not-exist")).toBeUndefined();
  });

  it("依分類回傳的文章筆數與 filter 結果一致", () => {
    const byCategory = getLibraryArticlesByCategory("代工基礎");
    expect(byCategory.length).toBe(3);
    for (const a of byCategory) expect(a.category).toBe("代工基礎");
  });

  it("其餘 3 個分類目前沒有文章（Phase 1 只有代工基礎）", () => {
    expect(getLibraryArticlesByCategory("製程與設備")).toEqual([]);
    expect(getLibraryArticlesByCategory("材料知識")).toEqual([]);
    expect(getLibraryArticlesByCategory("採購與品質")).toEqual([]);
  });
});

describe("estimateReadingMinutes", () => {
  it("回傳正整數，至少 1 分鐘", () => {
    for (const article of LIBRARY_ARTICLES) {
      const minutes = estimateReadingMinutes(article);
      expect(Number.isInteger(minutes)).toBe(true);
      expect(minutes).toBeGreaterThanOrEqual(1);
    }
  });
});
