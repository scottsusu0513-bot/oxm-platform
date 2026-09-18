/**
 * shared/seo/libraryPages.ts + server/_core/ogMeta.ts 的
 * buildLibraryIndexMeta／buildLibraryArticleMeta（見任務定案「傳產圖書館
 * Phase 1 實作」）。涵蓋：
 *   - /library index：固定 200 + index，title／description／canonical
 *   - /library/:slug：合法 slug 200 + index + Article／BreadcrumbList／
 *     FAQPage（只在文章有 faq 才有）JSON-LD；非法 slug 真 404 + noindex
 *   - canonical 一律 self-canonical，不指回舊 /blog
 *   - Article JSON-LD 至少含 headline／description／datePublished／
 *     dateModified／author／publisher／mainEntityOfPage／url
 *   - FAQPage 內容與畫面上會 render 的 article.faq 逐字一致（同一份資料）
 */
import { describe, expect, it } from "vitest";
import {
  parseLibraryIndexPath, parseLibraryArticlePath, resolveLibraryArticle,
  buildLibraryIndexContent, buildLibraryArticleContent,
  buildLibraryIndexBreadcrumbJsonLd, buildLibraryArticleBreadcrumbJsonLd,
  buildLibraryArticleJsonLd, buildLibraryArticleFaqJsonLd, buildLibraryArticleAllJsonLd,
  resolveLegacyBlogRedirect,
} from "@shared/seo/libraryPages";
import { buildLibraryIndexMeta, buildLibraryArticleMeta } from "./_core/ogMeta";
import { LIBRARY_ARTICLE_BY_SLUG, LIBRARY_ARTICLES } from "@shared/content/library";

describe("parseLibraryIndexPath", () => {
  it("命中 /library 與 /library/（結尾斜線）", () => {
    expect(parseLibraryIndexPath("/library")).toBe(true);
    expect(parseLibraryIndexPath("/library/")).toBe(true);
  });

  it("不命中文章頁或其他路徑", () => {
    expect(parseLibraryIndexPath("/library/what-is-moq")).toBe(false);
    expect(parseLibraryIndexPath("/news")).toBe(false);
    expect(parseLibraryIndexPath("/")).toBe(false);
  });
});

describe("parseLibraryArticlePath", () => {
  it("解析合法單段文章路徑，忽略結尾斜線", () => {
    expect(parseLibraryArticlePath("/library/what-is-moq")).toEqual({ slug: "what-is-moq" });
    expect(parseLibraryArticlePath("/library/what-is-moq/")).toEqual({ slug: "what-is-moq" });
  });

  it("不命中 /library 本身（沒有 slug）或兩段以上路徑", () => {
    expect(parseLibraryArticlePath("/library")).toBeNull();
    expect(parseLibraryArticlePath("/library/a/b")).toBeNull();
  });
});

describe("resolveLibraryArticle", () => {
  it("合法 slug 回傳 { slug, article }", () => {
    const resolved = resolveLibraryArticle("what-is-moq");
    expect(resolved?.slug).toBe("what-is-moq");
    expect(resolved?.article.libraryId).toBe("LIB-001");
  });

  it("不存在的 slug 回傳 null", () => {
    expect(resolveLibraryArticle("does-not-exist")).toBeNull();
  });
});

describe("buildLibraryIndexContent／buildLibraryIndexMeta", () => {
  it("title／description／canonical／h1 都是固定值，self-canonical 指向 /library", () => {
    const content = buildLibraryIndexContent();
    expect(content.canonical).toBe("https://www.oxmmatch.com/library");
    expect(content.title).toContain("OXM");
    expect(content.title).toContain("傳產圖書館");
    expect(content.h1).toBe("OXM 傳產圖書館");
  });

  it("buildLibraryIndexMeta 永遠 200 + index（不是 noindex）", () => {
    const meta = buildLibraryIndexMeta("/library");
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
  });

  it("BreadcrumbList JSON-LD：首頁 → 傳產圖書館", () => {
    const jsonLd = buildLibraryIndexBreadcrumbJsonLd();
    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    const items = jsonLd.itemListElement as any[];
    expect(items[0].name).toBe("首頁");
    expect(items[1].name).toBe("傳產圖書館");
    expect(items[1].item).toBe("https://www.oxmmatch.com/library");
  });
});

describe("buildLibraryArticleContent／buildLibraryArticleMeta：合法 slug", () => {
  it("title 帶文章標題與品牌，description 用 metaDescription，canonical self-canonical", () => {
    const resolved = resolveLibraryArticle("what-is-moq")!;
    const content = buildLibraryArticleContent(resolved);
    expect(content.title).toBe("MOQ 是什麼？代工廠最低訂購量怎麼談｜OXM 傳產圖書館");
    expect(content.description).toBe(LIBRARY_ARTICLE_BY_SLUG["what-is-moq"].metaDescription);
    expect(content.canonical).toBe("https://www.oxmmatch.com/library/what-is-moq");
    expect(content.h1).toBe(LIBRARY_ARTICLE_BY_SLUG["what-is-moq"].h1);
  });

  it("canonical 不會指回舊 /blog（含全部 9 篇，含 Level 2 第一批 5 篇）", () => {
    for (const slug of [
      "what-is-moq", "oem-vs-odm", "first-time-factory-guide", "what-is-contract-manufacturing",
      "small-batch-manufacturing", "how-to-read-factory-quotes", "how-to-choose-a-factory", "what-is-rfq", "what-is-prototyping",
    ]) {
      const resolved = resolveLibraryArticle(slug)!;
      const content = buildLibraryArticleContent(resolved);
      expect(content.canonical).not.toContain("/blog");
      expect(content.canonical).toContain(`/library/${slug}`);
    }
  });

  it("buildLibraryArticleMeta 對合法 slug 回傳 200 + index + ogType article", () => {
    const meta = buildLibraryArticleMeta("what-is-moq", "/library/what-is-moq");
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
    expect(meta.ogType).toBe("article");
  });
});

describe("新文章路由：what-is-contract-manufacturing", () => {
  it("resolveLibraryArticle 正確解析，libraryId 為 LIB-004", () => {
    const resolved = resolveLibraryArticle("what-is-contract-manufacturing");
    expect(resolved?.slug).toBe("what-is-contract-manufacturing");
    expect(resolved?.article.libraryId).toBe("LIB-004");
  });

  it("buildLibraryArticleMeta 回傳 200 + index + ogType article，跟其他 3 篇一致", () => {
    const meta = buildLibraryArticleMeta("what-is-contract-manufacturing", "/library/what-is-contract-manufacturing");
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
    expect(meta.ogType).toBe("article");
  });

  it("buildLibraryArticleAllJsonLd 只回傳 [Article, BreadcrumbList]（沒有 faq，不硬加 FAQPage）", () => {
    const all = buildLibraryArticleAllJsonLd(resolveLibraryArticle("what-is-contract-manufacturing")!);
    expect(all.map(x => x["@type"])).toEqual(["Article", "BreadcrumbList"]);
  });
});

describe("Level 2 第一批 5 篇路由", () => {
  const slugs = [
    "small-batch-manufacturing", "how-to-read-factory-quotes", "how-to-choose-a-factory", "what-is-rfq", "what-is-prototyping",
  ];

  it("每篇都能正確 resolve", () => {
    for (const slug of slugs) {
      const resolved = resolveLibraryArticle(slug);
      expect(resolved?.slug).toBe(slug);
    }
  });

  it("每篇 buildLibraryArticleMeta 都回傳 200 + index + ogType article", () => {
    for (const slug of slugs) {
      const meta = buildLibraryArticleMeta(slug, `/library/${slug}`);
      expect(meta.status).toBe(200);
      expect(meta.noindex).toBe(false);
      expect(meta.ogType).toBe("article");
    }
  });

  it("每篇 buildLibraryArticleAllJsonLd 都只回傳 [Article, BreadcrumbList]（本批 5 篇都沒有 faq）", () => {
    for (const slug of slugs) {
      const all = buildLibraryArticleAllJsonLd(resolveLibraryArticle(slug)!);
      expect(all.map(x => x["@type"])).toEqual(["Article", "BreadcrumbList"]);
    }
  });
});

describe("全 Library（45 篇，見任務定案「傳產圖書館內容完成階段」）：route resolve／meta／JSON-LD 逐篇驗證", () => {
  it("每篇 slug 都能正確 resolve，resolved.article.libraryId 跟資料源一致", () => {
    for (const article of LIBRARY_ARTICLES) {
      const resolved = resolveLibraryArticle(article.slug);
      expect(resolved?.slug).toBe(article.slug);
      expect(resolved?.article.libraryId).toBe(article.libraryId);
    }
  });

  it("每篇 buildLibraryArticleMeta 都回傳 200 + index + ogType article，canonical self-canonical 不指回 /blog", () => {
    for (const article of LIBRARY_ARTICLES) {
      const meta = buildLibraryArticleMeta(article.slug, `/library/${article.slug}`);
      expect(meta.status, article.slug).toBe(200);
      expect(meta.noindex, article.slug).toBe(false);
      expect(meta.ogType, article.slug).toBe("article");

      const content = buildLibraryArticleContent(resolveLibraryArticle(article.slug)!);
      expect(content.canonical, article.slug).toBe(`https://www.oxmmatch.com/library/${article.slug}`);
      expect(content.canonical, article.slug).not.toContain("/blog");
    }
  });

  it("每篇 buildLibraryArticleAllJsonLd 都是 [Article, BreadcrumbList]，只有 oem-vs-odm 多一個 FAQPage", () => {
    for (const article of LIBRARY_ARTICLES) {
      const all = buildLibraryArticleAllJsonLd(resolveLibraryArticle(article.slug)!);
      const expectedTypes = article.slug === "oem-vs-odm" ? ["Article", "BreadcrumbList", "FAQPage"] : ["Article", "BreadcrumbList"];
      expect(all.map(x => x["@type"]), article.slug).toEqual(expectedTypes);
    }
  });

  it("每篇 Article JSON-LD 的 headline／description 跟資料源逐字一致", () => {
    for (const article of LIBRARY_ARTICLES) {
      const jsonLd = buildLibraryArticleJsonLd(resolveLibraryArticle(article.slug)!);
      expect(jsonLd.headline, article.slug).toBe(article.title);
      expect(jsonLd.description, article.slug).toBe(article.metaDescription);
    }
  });
});

describe("buildLibraryArticleMeta：非法 slug", () => {
  it("回傳真 404 + noindex，不是 200 + 通用 fallback（避免軟式 404）", () => {
    const meta = buildLibraryArticleMeta("does-not-exist", "/library/does-not-exist");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildLibraryArticleBreadcrumbJsonLd", () => {
  it("首頁 → 傳產圖書館 → 文章（不含 category 這一層，避免虛構不存在的 URL）", () => {
    const resolved = resolveLibraryArticle("oem-vs-odm")!;
    const jsonLd = buildLibraryArticleBreadcrumbJsonLd(resolved);
    const items = jsonLd.itemListElement as any[];
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("首頁");
    expect(items[1].name).toBe("傳產圖書館");
    expect(items[1].item).toBe("https://www.oxmmatch.com/library");
    expect(items[2].name).toBe(resolved.article.h1);
    expect(items[2].item).toBe("https://www.oxmmatch.com/library/oem-vs-odm");
  });
});

describe("buildLibraryArticleJsonLd：Article schema", () => {
  it("至少含 headline／description／datePublished／dateModified／author／publisher／mainEntityOfPage／url", () => {
    const resolved = resolveLibraryArticle("what-is-moq")!;
    const jsonLd = buildLibraryArticleJsonLd(resolved);
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.headline).toBe(resolved.article.title);
    expect(jsonLd.description).toBe(resolved.article.metaDescription);
    expect(jsonLd.datePublished).toBe(new Date(resolved.article.publishedAt).toISOString());
    expect(jsonLd.dateModified).toBe(new Date(resolved.article.updatedAt).toISOString());
    expect(jsonLd.url).toBe("https://www.oxmmatch.com/library/what-is-moq");
    expect((jsonLd.mainEntityOfPage as any)["@id"]).toBe(jsonLd.url);
    expect((jsonLd.author as any).name).toBe("OXM");
    expect((jsonLd.publisher as any).name).toBe("OXM");
    expect((jsonLd.publisher as any).logo).toBeDefined();
  });

  it("不是 BlogPosting，也沒有疊加 WebPage 頂層 schema（只用 Article 一種型別）", () => {
    const resolved = resolveLibraryArticle("what-is-moq")!;
    const jsonLd = buildLibraryArticleJsonLd(resolved);
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd["@type"]).not.toBe("BlogPosting");
  });
});

describe("buildLibraryArticleFaqJsonLd：只在文章真的有 faq 時才產生", () => {
  it("oem-vs-odm 有 faq → 回傳 FAQPage，且內容與 article.faq 逐字一致", () => {
    const resolved = resolveLibraryArticle("oem-vs-odm")!;
    const jsonLd = buildLibraryArticleFaqJsonLd(resolved);
    expect(jsonLd).not.toBeNull();
    expect(jsonLd!["@type"]).toBe("FAQPage");
    const mainEntity = jsonLd!.mainEntity as any[];
    const faq = resolved.article.faq!;
    expect(mainEntity.length).toBe(faq.length);
    mainEntity.forEach((q, i) => {
      expect(q.name).toBe(faq[i].question);
      expect(q.acceptedAnswer.text).toBe(faq[i].answer);
    });
  });

  it("what-is-moq／first-time-factory-guide 沒有 faq → 回傳 null，不硬加 FAQPage", () => {
    expect(buildLibraryArticleFaqJsonLd(resolveLibraryArticle("what-is-moq")!)).toBeNull();
    expect(buildLibraryArticleFaqJsonLd(resolveLibraryArticle("first-time-factory-guide")!)).toBeNull();
  });
});

describe("buildLibraryArticleAllJsonLd：組合順序", () => {
  it("有 faq 的文章回傳 [Article, BreadcrumbList, FAQPage] 三個", () => {
    const all = buildLibraryArticleAllJsonLd(resolveLibraryArticle("oem-vs-odm")!);
    expect(all.map(x => x["@type"])).toEqual(["Article", "BreadcrumbList", "FAQPage"]);
  });

  it("沒有 faq 的文章只回傳 [Article, BreadcrumbList] 兩個", () => {
    const all = buildLibraryArticleAllJsonLd(resolveLibraryArticle("what-is-moq")!);
    expect(all.map(x => x["@type"])).toEqual(["Article", "BreadcrumbList"]);
  });
});

describe("resolveLegacyBlogRedirect（同時在這裡驗證一次匯出正確，完整行為測試見 server/legacyBlogRedirect.test.ts）", () => {
  it("3 筆 mapping 存在", () => {
    expect(resolveLegacyBlogRedirect("/blog/what-is-moq")).toBe("/library/what-is-moq");
  });
});
