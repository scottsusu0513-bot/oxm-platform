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

describe("LIBRARY_ARTICLES：目前共 4 筆（Phase 1 三篇 + 新增「代工是什麼」一篇）", () => {
  it("目前正好 4 篇文章", () => {
    expect(LIBRARY_ARTICLES.length).toBe(4);
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

  it("libraryId 集合剛好是 LIB-001～004（依上架順序遞增，沒有跳號或重複編號；libraryId 反映上架順序，不代表閱讀順序，見 learningOrder）", () => {
    expect(new Set(LIBRARY_ARTICLES.map(a => a.libraryId))).toEqual(new Set(["LIB-001", "LIB-002", "LIB-003", "LIB-004"]));
  });

  it("每篇文章的 category 都在 LIBRARY_CATEGORIES 合法清單內", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(LIBRARY_CATEGORIES).toContain(article.category);
    }
  });

  it("目前 4 篇全部歸類在「代工基礎」（見任務定案，不做 13 主產業分類版圖書館）", () => {
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
    expect(LIBRARY_ARTICLE_BY_SLUG["what-is-contract-manufacturing"].faq).toBeUndefined();
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

  it("代工是什麼文章的 CTA 指向 /search（一般搜尋入口，不是其他 URL）", () => {
    const intro = LIBRARY_ARTICLE_BY_SLUG["what-is-contract-manufacturing"];
    expect(intro.cta.label).toBe("前往 OXM 找工廠");
    expect(intro.cta.href).toBe("/search");
  });

  it("relatedIndustrySlugs／relatedSubIndustrySlugs／relatedFactoryLandingSlugs 目前刻意留空（4 篇都是跨產業通用概念文章，不虛構關聯）", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.relatedIndustrySlugs).toEqual([]);
      expect(article.relatedSubIndustrySlugs).toEqual([]);
      expect(article.relatedFactoryLandingSlugs).toEqual([]);
    }
  });
});

describe("learningOrder：入門閱讀順序（見任務定案「傳產圖書館新增文章 + 入門閱讀順序重整」）", () => {
  it("每篇文章都有 learningOrder，且是正整數", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(Number.isInteger(article.learningOrder)).toBe(true);
      expect(article.learningOrder).toBeGreaterThan(0);
    }
  });

  it("learningOrder 全部唯一（不允許並列，排序才有明確結果）", () => {
    const orders = LIBRARY_ARTICLES.map(a => a.learningOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("依 learningOrder 排序後，順序是「代工是什麼 → OEM/ODM → MOQ → 第一次找代工廠」——概念先於細節，不是機械照 libraryId 或陣列宣告順序", () => {
    const sorted = [...LIBRARY_ARTICLES].sort((a, b) => a.learningOrder - b.learningOrder);
    expect(sorted.map(a => a.slug)).toEqual([
      "what-is-contract-manufacturing",
      "oem-vs-odm",
      "what-is-moq",
      "first-time-factory-guide",
    ]);
  });

  it("learningOrder 跟 libraryId（上架順序）刻意不同：最新上架的 LIB-004 反而 learningOrder 最小", () => {
    const intro = LIBRARY_ARTICLE_BY_SLUG["what-is-contract-manufacturing"];
    expect(intro.libraryId).toBe("LIB-004");
    expect(intro.learningOrder).toBe(Math.min(...LIBRARY_ARTICLES.map(a => a.learningOrder)));
  });
});

describe("新文章：代工是什麼？代工廠是什麼？", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["what-is-contract-manufacturing"];

  it("slug 不與任何現有文章衝突", () => {
    expect(article).toBeDefined();
    expect(article.slug).toBe("what-is-contract-manufacturing");
  });

  it("title／h1 一致，且涵蓋「代工」「代工廠」，不是拿 OEM/ODM 當標題搶既有文章的主題", () => {
    expect(article.title).toBe(article.h1);
    expect(article.title).toContain("代工");
    expect(article.title).toContain("代工廠");
  });

  it("body 剛好包含 7 個核心問題 heading，順序固定由淺入深，不多拆也不少拆", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    const questionHeadings = headings.filter(h => h.text !== "OXM 小整理");
    expect(questionHeadings.map(h => h.text)).toEqual([
      "代工是什麼？",
      "代工廠是什麼？是不是所有工廠都一樣？",
      "哪些人會需要找代工廠？",
      "找代工廠前，要準備什麼？",
      "為什麼同一個產品，不同工廠報價會差很多？",
      "我要怎麼知道自己該找哪一種工廠？",
      "OEM、ODM 跟代工有什麼關係？",
    ]);
  });

  it("結尾有獨立的「OXM 小整理」區塊，剛好 5 個重點，不是整篇重複摘要", () => {
    const headingIndex = article.body.findIndex(b => b.type === "heading" && b.text === "OXM 小整理");
    expect(headingIndex).toBeGreaterThan(-1);
    const summaryList = article.body[headingIndex + 1];
    expect(summaryList.type).toBe("list");
    if (summaryList.type === "list") {
      expect(summaryList.items).toEqual([
        "先確認需求",
        "找對工廠類型",
        "數量會影響工廠選擇",
        "價格不是唯一條件",
        "找適合的製造合作夥伴",
      ]);
    }
  });

  it("正文含連到 what-is-moq 與 oem-vs-odm 的 contextual relatedLink，不深講 OEM/ODM 細節（已有獨立館藏）", () => {
    const relatedLinks = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "relatedLink" }> => b.type === "relatedLink");
    expect(relatedLinks.map(l => l.slug)).toEqual(["what-is-moq", "oem-vs-odm"]);
  });

  it("relatedArticleSlugs 是 oem-vs-odm 與 first-time-factory-guide（下一步概念 + 實際行動），沒有硬塞全部文章", () => {
    expect(article.relatedArticleSlugs).toEqual(["oem-vs-odm", "first-time-factory-guide"]);
  });

  it("沒有 faq（跟 what-is-moq／first-time-factory-guide 一樣，不是每篇都硬加）", () => {
    expect(article.faq).toBeUndefined();
  });
});

describe("既有文章的 relatedArticleSlugs 更新：oem-vs-odm 新增前置知識連結", () => {
  it("oem-vs-odm 的相關館藏新增 what-is-contract-manufacturing 作為前置知識，維持在 1–3 筆之內", () => {
    const oemOdm = LIBRARY_ARTICLE_BY_SLUG["oem-vs-odm"];
    expect(oemOdm.relatedArticleSlugs).toEqual(["what-is-contract-manufacturing", "what-is-moq", "first-time-factory-guide"]);
    expect(oemOdm.relatedArticleSlugs.length).toBeLessThanOrEqual(3);
  });

  it("what-is-moq／first-time-factory-guide 本輪內容與既有 relatedArticleSlugs 不變（不修改現有文章文字）", () => {
    expect(LIBRARY_ARTICLE_BY_SLUG["what-is-moq"].relatedArticleSlugs).toEqual(["oem-vs-odm", "first-time-factory-guide"]);
    expect(LIBRARY_ARTICLE_BY_SLUG["first-time-factory-guide"].relatedArticleSlugs).toEqual(["what-is-moq", "oem-vs-odm"]);
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
    expect(byCategory.length).toBe(4);
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
