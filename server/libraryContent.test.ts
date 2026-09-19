/**
 * shared/content/library.ts：傳產圖書館文章資料的結構性驗證（見任務定案
 * 「傳產圖書館 Phase 1 實作」）。這裡不測 SEO meta／JSON-LD 的產生邏輯
 * （見 server/libraryPages.test.ts），只驗證資料本身的完整性與內部一致性
 * ——slug／libraryId 不重複、category 合法、relatedArticleSlugs／faq 指向
 * 的 slug 都真的存在、cta 的 href 格式合理、paragraph.segments（見任務
 * 定案「Library 重點文字標示」）跟 text 逐字一致。
 *
 * relatedLink（正文裡「延伸閱讀：連到另一篇館藏文章」的區塊）與 oxmLink
 * （正文裡連到 OXM 服務入口的區塊）都已整個移除（見任務定案「Library UX
 * 修正」／「移除正文 OXM 導流」），不是只清資料——這裡不再有任何 body 區塊
 * 層級的 relatedLink／oxmLink 驗證，改成全域測試確認兩者都真的完全消失、
 * 正文只剩 paragraph／heading／list／table 四種區塊。所有 OXM 導流集中到
 * 文末既有的 NEXT STEP CTA，LIBRARY_OXM_LINK_HREF_ALLOWLIST 仍保留、仍在
 * 驗證 cta.href——這是它現在唯一、但正當持續使用中的用途，不是死掉的常數。
 *
 * secondary CTA（原 cta.secondaryLabel／cta.secondaryHref）已整個移除（見
 * 任務定案「Library CTA consistency audit」：每篇文末最多一個 CTA），不是
 * 只清資料——型別欄位、LibraryArticle 的 render 分支、CSS class 與這裡的
 * 驗證都一併刪掉，並改用下面的全域測試確認 production usage 永遠為 0。
 */
import { describe, expect, it } from "vitest";
import {
  LIBRARY_ARTICLES, LIBRARY_ARTICLE_BY_SLUG, LIBRARY_CATEGORIES, LIBRARY_OXM_LINK_HREF_ALLOWLIST,
  getLibraryArticle, getLibraryArticlesByCategory, estimateReadingMinutes,
  type LibraryArticle, type LibraryEmphasis,
} from "@shared/content/library";
import { SUB_INDUSTRY_SEARCH_ENTRIES } from "@shared/constants";

const EMPHASIS_VALUES: LibraryEmphasis[] = ["bold", "primary", "secondary"];

describe("LIBRARY_ARTICLES：目前共 45 筆（Level 1～2 九篇 + Level 3～6「內容完成階段」36 篇）", () => {
  it("目前正好 45 篇文章", () => {
    expect(LIBRARY_ARTICLES.length).toBe(45);
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

  it("libraryId 集合剛好是 LIB-001～045（依上架順序遞增，沒有跳號或重複編號；libraryId 反映上架順序，不代表閱讀順序，見 learningOrder）", () => {
    const expected = new Set(Array.from({ length: 45 }, (_, i) => `LIB-${String(i + 1).padStart(3, "0")}`));
    expect(new Set(LIBRARY_ARTICLES.map(a => a.libraryId))).toEqual(expected);
  });

  it("每篇文章的 category 都在 LIBRARY_CATEGORIES 合法清單內", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(LIBRARY_CATEGORIES).toContain(article.category);
    }
  });

  it("category 分配：代工基礎 5／採購與品質 7／製程與設備 23／材料知識 10；沒有新增第 5 個分類（見任務定案「傳產圖書館內容完成階段」）", () => {
    const byCategory = (cat: (typeof LIBRARY_CATEGORIES)[number]) => LIBRARY_ARTICLES.filter(a => a.category === cat).map(a => a.slug);
    expect(byCategory("代工基礎").sort()).toEqual([
      "first-time-factory-guide", "oem-vs-odm", "small-batch-manufacturing", "what-is-contract-manufacturing", "what-is-moq",
    ].sort());
    expect(byCategory("採購與品質").sort()).toEqual([
      "how-to-choose-a-factory", "how-to-read-factory-quotes", "new-product-development-partners",
      "what-is-prototyping", "what-is-rfq", "what-is-tolerance", "what-is-yield-rate",
    ].sort());
    expect(byCategory("材料知識").sort()).toEqual([
      "biodegradable-vs-compostable", "food-grade-vs-medical-grade-silicone", "how-to-choose-plastic-materials",
      "natural-fiber-and-biocomposite-materials", "rubber-silicone-pu-comparison", "stainless-steel-304-vs-316",
      "stainless-steel-aluminum-iron-comparison", "what-is-bioplastics", "what-is-recycled-materials",
      "what-is-sustainable-materials",
    ].sort());
    expect(byCategory("製程與設備").length).toBe(23);
    expect(byCategory("製程與設備").sort()).toEqual([
      "business-card-dm-catalog-printing", "casting-forging-cnc-comparison", "cosmetic-oem-odm-collaboration",
      "factory-inspection-equipment-and-quality-control", "food-oem-odm-selection", "how-to-find-packaging-manufacturer",
      "how-to-start-food-oem", "jig-fixture-mold-comparison", "packaging-printing-methods",
      "paper-box-bag-soft-packaging-comparison", "pcb-pcba-smt-comparison", "pcb-prototyping-process",
      "plastic-molding-process-comparison", "sticker-label-printing-guide", "surface-finishing-comparison",
      "what-is-cnc-machining", "what-is-metal-stamping", "what-is-mold-making", "what-is-plastic-injection-molding",
      "what-is-production-line-automation", "what-is-sheet-metal-fabrication", "what-is-smt",
      "what-is-wire-harness-assembly",
    ].sort());
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

  it("body 陣列不為空，且每個區塊都是合法的已知 type（正文只剩 paragraph／heading／list／table，relatedLink／oxmLink 都已移除）", () => {
    const validTypes = ["paragraph", "heading", "list", "table"];
    for (const article of LIBRARY_ARTICLES) {
      expect(article.body.length).toBeGreaterThan(0);
      for (const block of article.body) {
        expect(validTypes).toContain(block.type);
      }
    }
  });

  it("全 Library 正文完全沒有 relatedLink 或 oxmLink 區塊（見任務定案「移除正文 OXM 導流」：所有 OXM 導流集中到文末 NEXT STEP CTA，文章間關聯只在文末「相關館藏」出現一次，正文不被任何連結打斷）", () => {
    for (const article of LIBRARY_ARTICLES) {
      for (const block of article.body) {
        expect(block.type).not.toBe("relatedLink");
        expect(block.type).not.toBe("oxmLink");
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

  it("paragraph.segments（有提供時）逐片段接起來必須跟 text 逐字一致，避免兩個欄位日後改一邊忘了改另一邊而悄悄失準", () => {
    const mismatches: string[] = [];
    for (const article of LIBRARY_ARTICLES) {
      const paragraphsWithSegments = article.body.filter(
        (b): b is Extract<LibraryArticle["body"][number], { type: "paragraph" }> & { segments: NonNullable<Extract<LibraryArticle["body"][number], { type: "paragraph" }>["segments"]> } =>
          b.type === "paragraph" && b.segments !== undefined,
      );
      for (const block of paragraphsWithSegments) {
        const reconstructed = block.segments.map(seg => (typeof seg === "string" ? seg : seg.text)).join("");
        if (reconstructed !== block.text) mismatches.push(`[${article.slug}] text=${JSON.stringify(block.text)} recon=${JSON.stringify(reconstructed)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("paragraph.segments 裡帶 emphasis 的片段，emphasis 值都在合法清單內（bold／primary／secondary）", () => {
    for (const article of LIBRARY_ARTICLES) {
      for (const block of article.body) {
        if (block.type !== "paragraph" || !block.segments) continue;
        for (const seg of block.segments) {
          if (typeof seg === "string") continue;
          expect(EMPHASIS_VALUES).toContain(seg.emphasis);
        }
      }
    }
  });

  it("有 segments 的段落，至少有一個片段真的帶 emphasis（不會出現整段都是純字串、等於沒有標示任何重點的空 segments）", () => {
    for (const article of LIBRARY_ARTICLES) {
      for (const block of article.body) {
        if (block.type !== "paragraph" || !block.segments) continue;
        const hasEmphasis = block.segments.some(seg => typeof seg !== "string");
        expect(hasEmphasis).toBe(true);
      }
    }
  });

  it("全 Library 至少有多篇文章使用了重點標示（不是新增功能後沒有實際套用），且三種 emphasis 至少都各出現過一次", () => {
    const allSegments = LIBRARY_ARTICLES.flatMap(a =>
      a.body.flatMap(b => (b.type === "paragraph" && b.segments ? b.segments : [])),
    );
    const emphasisSegments = allSegments.filter((s): s is Extract<typeof s, { emphasis: LibraryEmphasis }> => typeof s !== "string");
    expect(emphasisSegments.length).toBeGreaterThan(10);
    for (const value of EMPHASIS_VALUES) {
      expect(emphasisSegments.some(s => s.emphasis === value)).toBe(true);
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
    for (const slug of [
      "what-is-moq", "first-time-factory-guide", "what-is-contract-manufacturing",
      "small-batch-manufacturing", "how-to-read-factory-quotes", "how-to-choose-a-factory",
      "what-is-rfq", "what-is-prototyping",
    ]) {
      expect(LIBRARY_ARTICLE_BY_SLUG[slug].faq).toBeUndefined();
    }
  });

  it("cta.href 一律是站內相對路徑（以 / 開頭），不是外部網址", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.cta.href.startsWith("/")).toBe(true);
    }
  });

  it("全部 45 篇都有 CTA，且 label／href／description 都非空字串", () => {
    expect(LIBRARY_ARTICLES.length).toBe(45);
    for (const article of LIBRARY_ARTICLES) {
      expect(article.cta, article.slug).toBeDefined();
      expect(article.cta.label.trim().length, article.slug).toBeGreaterThan(0);
      expect(article.cta.href.trim().length, article.slug).toBeGreaterThan(0);
      expect(article.cta.description.trim().length, article.slug).toBeGreaterThan(0);
    }
  });

  it("secondary CTA 的 production usage 為 0：cta 物件只剩 label／href／description 三個欄位，沒有殘留 secondaryLabel／secondaryHref", () => {
    for (const article of LIBRARY_ARTICLES) {
      const cta = article.cta as Record<string, unknown>;
      expect(Object.keys(cta).sort(), article.slug).toEqual(["description", "href", "label"]);
      expect("secondaryLabel" in cta, article.slug).toBe(false);
      expect("secondaryHref" in cta, article.slug).toBe(false);
    }
  });

  it("MOQ 文章的 CTA 指向 /search 的可接小量／可打樣篩選（真實存在的 query param，見 Search.tsx）", () => {
    const moq = LIBRARY_ARTICLE_BY_SLUG["what-is-moq"];
    expect(moq.cta.href).toBe("/search?smallBatch=true&sample=true");
  });

  it("OEM/ODM 文章只有一顆中立的 /search CTA：這篇本身是 OEM／ODM 比較，不由 OXM 在文末替使用者預選其中一種代工模式", () => {
    const oemOdm = LIBRARY_ARTICLE_BY_SLUG["oem-vs-odm"];
    expect(oemOdm.cta.label).toBe("前往 OXM 找代工廠");
    expect(oemOdm.cta.href).toBe("/search");
    expect(Object.keys(oemOdm.cta).sort()).toEqual(["description", "href", "label"]);
  });

  it("多選項比較型文章不強迫導到其中一個子產業，沒有真正中立的 factory landing 時一律 fallback /search", () => {
    for (const slug of [
      "oem-vs-odm", "casting-forging-cnc-comparison", "plastic-molding-process-comparison",
      "paper-box-bag-soft-packaging-comparison", "surface-finishing-comparison",
      "rubber-silicone-pu-comparison", "biodegradable-vs-compostable",
      "pcb-pcba-smt-comparison", "jig-fixture-mold-comparison",
    ]) {
      expect(LIBRARY_ARTICLE_BY_SLUG[slug].cta.href, slug).toBe("/search");
    }
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

  it("Level 2 第一批 5 篇的 CTA href 都是已驗證的真實 query param 組合", () => {
    expect(LIBRARY_ARTICLE_BY_SLUG["small-batch-manufacturing"].cta.href).toBe("/search?smallBatch=true&sample=true");
    expect(LIBRARY_ARTICLE_BY_SLUG["how-to-read-factory-quotes"].cta.href).toBe("/search");
    expect(LIBRARY_ARTICLE_BY_SLUG["how-to-choose-a-factory"].cta.href).toBe("/search");
    expect(LIBRARY_ARTICLE_BY_SLUG["what-is-rfq"].cta.href).toBe("/search");
    expect(LIBRARY_ARTICLE_BY_SLUG["what-is-prototyping"].cta.href).toBe("/search?sample=true");
  });

  it("所有文章的 cta.href 都在 LIBRARY_OXM_LINK_HREF_ALLOWLIST 內，不得自行發明新的 query param", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(LIBRARY_OXM_LINK_HREF_ALLOWLIST, article.slug).toContain(article.cta.href);
    }
  });

  it("cta.href 用到的 /search query param 都是 Search.tsx 真實支援的參數（smallBatch／sample／mfgMode），不是臆造", () => {
    const SUPPORTED_SEARCH_PARAMS = new Set([
      "mfgMode", "industry", "subIndustry", "region", "keyword", "q",
      "aiSearch", "businessType", "smallBatch", "sample", "sortBy",
    ]);
    for (const article of LIBRARY_ARTICLES) {
      const [path, query] = article.cta.href.split("?");
      if (path !== "/search") continue;
      for (const key of new URLSearchParams(query ?? "").keys()) {
        expect(SUPPORTED_SEARCH_PARAMS.has(key), `${article.slug} 的 CTA 用了 Search.tsx 不支援的 query param：${key}`).toBe(true);
      }
    }
  });

  it("relatedIndustrySlugs／relatedSubIndustrySlugs／relatedFactoryLandingSlugs 目前刻意留空（9 篇都是跨產業通用概念文章，不虛構關聯）", () => {
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

  it("依 learningOrder 排序後，Level 1～6 依實際閱讀順序排列（概念先於細節，同 Level 內基礎→比較→進階），不是機械照 libraryId／陣列宣告順序／Master Plan 題號", () => {
    const sorted = [...LIBRARY_ARTICLES].sort((a, b) => a.learningOrder - b.learningOrder);
    expect(sorted.map(a => a.slug)).toEqual([
      // Level 1
      "what-is-contract-manufacturing", "oem-vs-odm", "what-is-moq", "first-time-factory-guide",
      // Level 2
      "small-batch-manufacturing", "what-is-rfq", "how-to-read-factory-quotes", "how-to-choose-a-factory", "what-is-prototyping",
      // Level 3：製程與製造知識（10～25）
      "new-product-development-partners", "what-is-cnc-machining", "what-is-sheet-metal-fabrication",
      "what-is-metal-stamping", "casting-forging-cnc-comparison", "surface-finishing-comparison",
      "what-is-mold-making", "what-is-plastic-injection-molding", "plastic-molding-process-comparison",
      "what-is-smt", "pcb-prototyping-process", "pcb-pcba-smt-comparison", "what-is-wire-harness-assembly",
      "how-to-start-food-oem", "food-oem-odm-selection", "cosmetic-oem-odm-collaboration",
      // Level 4：材料知識（26～35，內部依「基礎→比較→進階」，跟題號順序不完全一致）
      "how-to-choose-plastic-materials", "rubber-silicone-pu-comparison", "food-grade-vs-medical-grade-silicone",
      "stainless-steel-aluminum-iron-comparison", "stainless-steel-304-vs-316", "what-is-sustainable-materials",
      "what-is-bioplastics", "what-is-recycled-materials", "biodegradable-vs-compostable",
      "natural-fiber-and-biocomposite-materials",
      // Level 5：包裝／印刷與品牌製造（36～40）
      "how-to-find-packaging-manufacturer", "paper-box-bag-soft-packaging-comparison", "packaging-printing-methods",
      "business-card-dm-catalog-printing", "sticker-label-printing-guide",
      // Level 6：設備與工廠營運知識（41～45）
      "what-is-production-line-automation", "factory-inspection-equipment-and-quality-control",
      "jig-fixture-mold-comparison", "what-is-tolerance", "what-is-yield-rate",
    ]);
  });

  it("RFQ（LIB-008）的 learningOrder 排在報價（LIB-006）之前，證明 learningOrder 跟 libraryId 上架順序刻意不同", () => {
    const rfq = LIBRARY_ARTICLE_BY_SLUG["what-is-rfq"];
    const quotes = LIBRARY_ARTICLE_BY_SLUG["how-to-read-factory-quotes"];
    expect(rfq.libraryId).toBe("LIB-008");
    expect(quotes.libraryId).toBe("LIB-006");
    expect(rfq.learningOrder).toBeLessThan(quotes.learningOrder);
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

  it("不深講 OEM/ODM 細節（已有獨立館藏，正文不再有 relatedLink 這種延伸閱讀連結，見 Library UX 修正）", () => {
    expect(article.body.some(b => b.type === "relatedLink")).toBe(false);
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

describe("Level 2 第一批 5 篇：slug／libraryId／category／learningOrder", () => {
  const expectedMeta: Record<string, { libraryId: string; category: string; learningOrder: number }> = {
    "small-batch-manufacturing": { libraryId: "LIB-005", category: "代工基礎", learningOrder: 50 },
    "what-is-rfq": { libraryId: "LIB-008", category: "採購與品質", learningOrder: 60 },
    "how-to-read-factory-quotes": { libraryId: "LIB-006", category: "採購與品質", learningOrder: 70 },
    "how-to-choose-a-factory": { libraryId: "LIB-007", category: "採購與品質", learningOrder: 80 },
    "what-is-prototyping": { libraryId: "LIB-009", category: "採購與品質", learningOrder: 90 },
  };

  it("5 篇 slug 都不與既有 4 篇或彼此衝突", () => {
    for (const slug of Object.keys(expectedMeta)) {
      expect(LIBRARY_ARTICLE_BY_SLUG[slug]).toBeDefined();
    }
  });

  it("每篇的 libraryId／category／learningOrder 都符合本輪規劃", () => {
    for (const [slug, meta] of Object.entries(expectedMeta)) {
      const article = LIBRARY_ARTICLE_BY_SLUG[slug];
      expect(article.libraryId).toBe(meta.libraryId);
      expect(article.category).toBe(meta.category);
      expect(article.learningOrder).toBe(meta.learningOrder);
    }
  });

  it("每篇 title／h1 一致，且 Title 不互相重複搶主題（不是五篇都用「找代工廠」「怎麼找工廠」當標題）", () => {
    for (const slug of Object.keys(expectedMeta)) {
      const article = LIBRARY_ARTICLE_BY_SLUG[slug];
      expect(article.title).toBe(article.h1);
    }
    const titles = Object.keys(expectedMeta).map(slug => LIBRARY_ARTICLE_BY_SLUG[slug].title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.filter(t => t.includes("找代工廠")).length).toBe(0);
  });
});

describe("小量代工怎麼找？MOQ 太高怎麼辦？（small-batch-manufacturing）", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["small-batch-manufacturing"];

  it("6 個問題 heading，順序固定", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    expect(headings.map(h => h.text)).toEqual([
      "為什麼很多工廠不太願意接小量？",
      "所以數量少，就一定找不到工廠嗎？",
      "MOQ 太高，可以跟工廠談嗎？",
      "我是不是應該先打樣，不要一開始就量產？",
      "小量生產為什麼單價常常比較高？",
      "第一次做產品，小量代工比較適合怎麼開始？",
    ]);
  });

  it("relatedArticleSlugs 是 what-is-moq 與 what-is-prototyping", () => {
    expect(article.relatedArticleSlugs).toEqual(["what-is-moq", "what-is-prototyping"]);
  });
});

describe("工廠報價怎麼看？（how-to-read-factory-quotes）", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["how-to-read-factory-quotes"];

  it("6 個問題 heading，順序固定", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    expect(headings.map(h => h.text)).toEqual([
      "同一張圖給三家工廠，為什麼報價可以差很多？",
      "是不是報價最低的工廠最好？",
      "看報價單時最重要的是哪些項目？",
      "為什麼有些工廠模具費很高，但產品單價比較低？",
      "拿到幾家報價後，我應該怎麼比較？",
      "什麼才算是一個好的報價？",
    ]);
  });

  it("relatedArticleSlugs 是 what-is-rfq 與 how-to-choose-a-factory", () => {
    expect(article.relatedArticleSlugs).toEqual(["what-is-rfq", "how-to-choose-a-factory"]);
  });
});

describe("怎麼判斷一間工廠適不適合你的案子？（how-to-choose-a-factory）", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["how-to-choose-a-factory"];

  it("7 個問題 heading，順序固定", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    expect(headings.map(h => h.text)).toEqual([
      "找到很多工廠之後，我要怎麼選？",
      "第一個要看什麼？",
      "看工廠以前做過什麼產品有用嗎？",
      "工廠規模越大越好嗎？",
      "除了設備，還要看什麼？",
      "第一次合作，需要直接下大量訂單嗎？",
      "最後應該怎麼判斷？",
    ]);
  });

  it("relatedArticleSlugs 是 how-to-read-factory-quotes 與 what-is-prototyping", () => {
    expect(article.relatedArticleSlugs).toEqual(["how-to-read-factory-quotes", "what-is-prototyping"]);
  });
});

describe("詢價要提供哪些資料？RFQ 怎麼準備？（what-is-rfq）", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["what-is-rfq"];

  it("7 個問題 heading，順序固定", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    expect(headings.map(h => h.text)).toEqual([
      "RFQ 是什麼？",
      "最基本要提供哪些資料？",
      "如果是零件加工，要準備更多資料嗎？",
      "只有照片，沒有圖面怎麼辦？",
      "數量為什麼一定要先講？",
      "詢價時，有哪些資訊很容易漏掉？",
      "詢價是不是資料越多越好？",
    ]);
  });

  it("relatedArticleSlugs 是 first-time-factory-guide 與 how-to-read-factory-quotes", () => {
    expect(article.relatedArticleSlugs).toEqual(["first-time-factory-guide", "how-to-read-factory-quotes"]);
  });
});

describe("打樣是什麼？從樣品到量產通常要經過哪些階段？（what-is-prototyping）", () => {
  const article = LIBRARY_ARTICLE_BY_SLUG["what-is-prototyping"];

  it("7 個問題 heading，順序固定", () => {
    const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading");
    expect(headings.map(h => h.text)).toEqual([
      "打樣是什麼？",
      "有圖面了，為什麼還需要打樣？",
      "一般會從打樣直接進量產嗎？",
      "小量試產跟打樣有什麼差別？",
      "是不是每一個產品都一定要打樣？",
      "找打樣工廠時要注意什麼？",
      "樣品確認後，就可以放心量產了嗎？",
    ]);
  });

  it("relatedArticleSlugs 是 small-batch-manufacturing 與 how-to-choose-a-factory", () => {
    expect(article.relatedArticleSlugs).toEqual(["small-batch-manufacturing", "how-to-choose-a-factory"]);
  });
});

describe("全 Library：內容原則驗證（見任務定案「傳產圖書館內容完成階段」— 每篇 4～7 個核心問題、問題不重複、relatedArticleSlugs 1～3 篇）", () => {
  it("每篇文章的核心問題（heading 區塊）數量在 4～7 之間", () => {
    for (const article of LIBRARY_ARTICLES) {
      // what-is-contract-manufacturing 是唯一的例外：見「傳產圖書館新增文章」
      // 那一輪，額外有一個獨立的「OXM 小整理」收尾 heading，不算在 7 個核心
      // 問題之內（那一輪的測試也是這樣排除），本輪 45 篇的其餘 44 篇都沒有
      // 這個額外 heading。
      const headingCount = article.body.filter(b => b.type === "heading" && b.text !== "OXM 小整理").length;
      expect(headingCount, `${article.slug} 有 ${headingCount} 個 heading`).toBeGreaterThanOrEqual(4);
      expect(headingCount, `${article.slug} 有 ${headingCount} 個 heading`).toBeLessThanOrEqual(7);
    }
  });

  it("每篇文章內的核心問題文字彼此不重複", () => {
    for (const article of LIBRARY_ARTICLES) {
      const headings = article.body.filter((b): b is Extract<LibraryArticle["body"][number], { type: "heading" }> => b.type === "heading").map(h => h.text);
      expect(new Set(headings).size, `${article.slug} 的 heading 有重複`).toBe(headings.length);
    }
  });

  it("每篇 relatedArticleSlugs 都在 1～3 篇之間，不是互相全部串滿", () => {
    for (const article of LIBRARY_ARTICLES) {
      expect(article.relatedArticleSlugs.length, `${article.slug} 的 relatedArticleSlugs 數量`).toBeGreaterThanOrEqual(1);
      expect(article.relatedArticleSlugs.length, `${article.slug} 的 relatedArticleSlugs 數量`).toBeLessThanOrEqual(3);
    }
  });
});

describe("全 Library：CTA 的 /factories/:slug 都是 SUB_INDUSTRY_SEARCH_ENTRIES 裡真實存在的 slug（不臆測，見任務定案「NEXT STEP CTA」）", () => {
  const validSubIndustrySlugs = new Set(SUB_INDUSTRY_SEARCH_ENTRIES.map(e => e.slug));

  it("/factories/:slug 這個路由格式的 CTA href，slug 部分都能在 SUB_INDUSTRY_SEARCH_ENTRIES 查到", () => {
    for (const article of LIBRARY_ARTICLES) {
      const href = article.cta.href;
      if (!href.startsWith("/factories/")) continue;
      const slug = href.replace("/factories/", "");
      expect(validSubIndustrySlugs.has(slug), `${article.slug} 的 CTA href ${href} 對應的 slug 不存在於 SUB_INDUSTRY_SEARCH_ENTRIES`).toBe(true);
    }
  });

  it("LIBRARY_OXM_LINK_HREF_ALLOWLIST 裡的 /factories/:slug 條目，同樣都能在 SUB_INDUSTRY_SEARCH_ENTRIES 查到", () => {
    for (const href of LIBRARY_OXM_LINK_HREF_ALLOWLIST) {
      if (!href.startsWith("/factories/")) continue;
      const slug = href.replace("/factories/", "");
      expect(validSubIndustrySlugs.has(slug), `allowlist 裡的 ${href} 對應的 slug 不存在於 SUB_INDUSTRY_SEARCH_ENTRIES`).toBe(true);
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

  it("依分類回傳的文章筆數與 filter 結果一致：代工基礎 5／採購與品質 7／製程與設備 23／材料知識 10（見任務定案「傳產圖書館內容完成階段」）", () => {
    const expectCategoryCount = (cat: "代工基礎" | "採購與品質" | "製程與設備" | "材料知識", count: number) => {
      const list = getLibraryArticlesByCategory(cat);
      expect(list.length).toBe(count);
      for (const a of list) expect(a.category).toBe(cat);
    };
    expectCategoryCount("代工基礎", 5);
    expectCategoryCount("採購與品質", 7);
    expectCategoryCount("製程與設備", 23);
    expectCategoryCount("材料知識", 10);
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
