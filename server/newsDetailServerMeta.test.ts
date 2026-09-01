/**
 * GEO Phase 3A — /news/:slug 的 server 端 metadata 注入。
 *
 * 背景：Audit 確認 server/_core/vite.ts 對 /news/:slug 完全沒有專屬分支，
 * raw HTML（未執行 JS）一律 fallback 到 client/index.html 的全站預設
 * title/description——而且是 Phase 2 校準前的舊 OXM 定位（「全台最齊全工廠與
 * 工作室媒合平台」／「找代工不再浪費時間」）。已 sitemap 收錄的每一篇消息
 * 網址都受影響。
 *
 * 這裡驗證修正後的 buildNewsMeta／parseNewsPath／injectMetaIntoHtml：已發布
 * 文章有專屬 title／description／canonical／og:type=article／NewsArticle
 * JSON-LD；草稿與不存在的 slug 一律 404 + noindex，不洩漏草稿內容；原始
 * HTML 字串（等同 Googlebot／AI 未執行 JS 拿到的內容）確認不再含舊 OXM
 * fallback 文字。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { buildNewsMeta, injectMetaIntoHtml, parseNewsPath } from "./_core/ogMeta";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜台灣傳統產業數位資源平台</title>
    <meta name="description" content="OXM 是台灣傳統產業的數位資源平台，整合工廠媒合、企業升級、產業人才、品牌形象與產業資訊，協助企業找到合適的製造與轉型資源。">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let ownerId: number;
let publishedNewsId: number;
let publishedSlug: string;
let draftNewsId: number;
let draftSlug: string;

beforeAll(async () => {
  ownerId = await ensureTestUser(`news-meta-owner-${runId}`, "News Meta Test Owner");

  const published = await db.createNews({
    title: `GEO測試消息-已發布-${runId}`,
    summary: `GEO測試摘要-${runId}`,
    content: "完整內文不應該出現在 meta description 或 JSON-LD headline 裡。".repeat(3),
    status: "published",
    createdBy: ownerId,
  });
  publishedNewsId = published.id;
  const publishedRow = await db.getNewsById(publishedNewsId);
  if (!publishedRow) throw new Error("fixture: 已發布消息建立後查不到");
  publishedSlug = publishedRow.slug;

  const draft = await db.createNews({
    title: `GEO測試消息-草稿-${runId}`,
    summary: `GEO測試摘要-草稿-${runId}`,
    content: "草稿內文",
    status: "draft",
    createdBy: ownerId,
  });
  draftNewsId = draft.id;
  const draftRow = await db.getNewsById(draftNewsId);
  if (!draftRow) throw new Error("fixture: 草稿消息建立後查不到");
  draftSlug = draftRow.slug;
});

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    await conn.execute(sql`DELETE FROM news WHERE id IN (${publishedNewsId}, ${draftNewsId})`);
  }
  await deleteTestUser(ownerId);
});

describe("parseNewsPath：只解析 /news/:slug，不吃掉沒有 slug 的 /news 本身", () => {
  it("解析出真實 slug", () => {
    expect(parseNewsPath(`/news/${publishedSlug}`)).toEqual({ slug: publishedSlug });
  });

  it("/news（沒有 slug 段）回傳 null，不影響既有 /news 列表頁 SEO 分支", () => {
    expect(parseNewsPath("/news")).toBeNull();
    expect(parseNewsPath("/news/")).toBeNull();
  });
});

describe("buildNewsMeta：已發布消息 → 200，metadata 是這篇文章專屬內容", () => {
  it("status 200、noindex false", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
  });

  it("title 包含真實文章標題，且符合「{標題}｜OXM 產業情報中心」慣例（跟 NewsDetail.tsx 的 headTitle 一致）", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.title).toContain(`GEO測試消息-已發布-${runId}`);
    expect(meta.title).toContain("OXM 產業情報中心");
  });

  it("description 來自 summary，不是完整 content", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.description).toContain(`GEO測試摘要-${runId}`);
    expect(meta.description).not.toContain("完整內文不應該出現在 meta description");
  });

  it("canonical 自我指向 /news/{slug}，用既有 SITE_BASE_URL 來源，不是另外硬寫第二套 domain", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.url).toBe(`https://www.oxmmatch.com/news/${publishedSlug}`);
  });

  it("ogType 是 article", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.ogType).toBe("article");
  });

  it("不會 fallback 到全站舊 OXM title", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.title).not.toContain("全台最齊全工廠與工作室");
    expect(meta.description).not.toContain("找代工不再浪費時間");
  });

  it("含 NewsArticle JSON-LD：headline／url／datePublished 為真實資料，publisher 來自既有 BRAND", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    expect(meta.jsonLd).toBeDefined();
    const jsonLd = meta.jsonLd as Record<string, any>;
    expect(jsonLd["@type"]).toBe("NewsArticle");
    expect(jsonLd.headline).toBe(`GEO測試消息-已發布-${runId}`);
    expect(jsonLd.description).toBe(`GEO測試摘要-${runId}`);
    expect(jsonLd.url).toBe(`https://www.oxmmatch.com/news/${publishedSlug}`);
    expect(typeof jsonLd.datePublished).toBe("string");
    expect(jsonLd.publisher.name).toBe("OXM");
    expect(jsonLd.publisher.url).toBe("https://www.oxmmatch.com");
  });

  it("沒有真實封面圖片時 JSON-LD 不假造 image；不填 author／dateModified／rating／review／award", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    const jsonLd = meta.jsonLd as Record<string, any>;
    expect(jsonLd).not.toHaveProperty("image");
    expect(jsonLd).not.toHaveProperty("author");
    expect(jsonLd).not.toHaveProperty("dateModified");
    expect(jsonLd).not.toHaveProperty("rating");
    expect(jsonLd).not.toHaveProperty("review");
    expect(jsonLd).not.toHaveProperty("award");
  });
});

describe("buildNewsMeta：草稿／不存在的 slug → 404 + noindex，不洩漏內容（沿用 getPublishedNewsBySlug 既有的公開性規則）", () => {
  it("草稿消息回傳 404，title 不含草稿標題", async () => {
    const meta = await buildNewsMeta(draftSlug, `/news/${draftSlug}`);
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
    expect(meta.title).not.toContain(`GEO測試消息-草稿-${runId}`);
    expect(meta.jsonLd).toBeUndefined();
  });

  it("不存在的 slug 回傳 404，不拋錯", async () => {
    const meta = await buildNewsMeta(`not-a-real-slug-${runId}`, `/news/not-a-real-slug-${runId}`);
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("injectMetaIntoHtml + buildNewsMeta：原始 HTML 字串（等同未執行 JS 拿到的內容）不再 fallback 到舊 OXM title", () => {
  it("已發布消息注入後含正確 title／description／canonical／og:type=article，且不含舊定位文字", async () => {
    const meta = await buildNewsMeta(publishedSlug, `/news/${publishedSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain(`<title>${meta.title}</title>`);
    expect(html).toContain(`<meta name="description" content="${meta.description}">`);
    expect(html).toContain(`<link rel="canonical" href="${meta.url}">`);
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('"@type":"NewsArticle"');
    expect(html).not.toContain("全台最齊全工廠與工作室");
    expect(html).not.toContain("找代工不再浪費時間");
  });

  it("草稿 slug 注入後含 noindex，且不含草稿標題", async () => {
    const meta = await buildNewsMeta(draftSlug, `/news/${draftSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain(`GEO測試消息-草稿-${runId}`);
  });
});
