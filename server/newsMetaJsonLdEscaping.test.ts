/**
 * GEO Phase 3A — 安全校準：/news/:slug 的 server 端 metadata／JSON-LD escaping。
 *
 * 這裡驗證的是輸出安全，不是 GEO 文案：一篇文章的 title／summary 直接來自
 * 使用者（管理員）輸入，注入進 <title>／<meta>／<script type="application/
 * ld+json"> 前必須經過安全處理，不能讓 "<"、"&"、'"'、"'"、"</script>" 這類
 * 字元破壞 HTML 結構或提前結束 <script> 標籤。
 *
 * 兩層既有防護（見 server/_core/ogMeta.ts）：
 * 1. buildNewsTitle／buildNewsDescription 都先經過 normalizeText()，會把
 *    任何 "<...>" 樣式的內容整段換成空白（不只是逃逸，是直接拿掉），title／
 *    meta description／og:title／og:description 因此不會殘留任何標籤片段。
 * 2. injectMetaIntoHtml／renderMetaHtml 對所有輸出值一律呼叫 escapeHtml()
 *    （& < > " ' 五個字元都會被轉成對應 HTML entity），JSON-LD 則呼叫既有
 *    的 shared/seo/schema.ts toSafeJsonLdString()（JSON.stringify 之後把
 *    "<" 全部換成 "<"，"</script>" 不可能以字面量形式出現在輸出裡）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { buildNewsMeta, injectMetaIntoHtml, escapeHtml } from "./_core/ogMeta";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜台灣傳統產業數位資源平台</title>
    <meta name="description" content="OXM 是台灣傳統產業的數位資源平台。">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// 涵蓋任務指定的每一種危險字元：< > & " ' </script> Unicode/中文 換行。
const HOSTILE_TITLE = `<script>alert(1)</script>惡意標題 & "雙引號" '單引號' ${runId}`;
const HOSTILE_SUMMARY = `</script><img src=x onerror=alert(1)>惡意摘要\n換行第二行 & "雙引號" '單引號' 中文 ${runId}`;

let ownerId: number;
let hostileNewsId: number;
let hostileSlug: string;

beforeAll(async () => {
  ownerId = await ensureTestUser(`news-escape-owner-${runId}`, "News Escaping Test Owner");
  const created = await db.createNews({
    title: HOSTILE_TITLE,
    summary: HOSTILE_SUMMARY,
    content: "內文與這個測試無關",
    status: "published",
    createdBy: ownerId,
  });
  hostileNewsId = created.id;
  const row = await db.getNewsById(hostileNewsId);
  if (!row) throw new Error("fixture: hostile 消息建立後查不到");
  hostileSlug = row.slug;
  // 確認 DB 原樣存回危險字元，不是在寫入路徑被悄悄過濾掉——否則下面的測試
  // 其實什麼都沒驗證到。
  if (row.title !== HOSTILE_TITLE || row.summary !== HOSTILE_SUMMARY) {
    throw new Error("fixture: DB 儲存的 title/summary 跟輸入不一致，測試前提不成立");
  }
});

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) await conn.execute(sql`DELETE FROM news WHERE id = ${hostileNewsId}`);
  await deleteTestUser(ownerId);
});

describe("buildNewsMeta：title／description 對 hostile 內容的處理", () => {
  it("title／description 完全不含裸露的 '<' 或 '>'（normalizeText 已整段拿掉標籤樣式內容）", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    expect(meta.title).not.toContain("<");
    expect(meta.title).not.toContain(">");
    expect(meta.description).not.toContain("<");
    expect(meta.description).not.toContain(">");
  });

  it("description 仍保留真實內容（中文、& 與引號字元本身沒有被過度過濾，只是拿掉了標籤樣式片段）", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    expect(meta.description).toContain("惡意摘要");
    expect(meta.description).toContain("中文");
    expect(meta.description).toContain("&");
  });
});

describe("injectMetaIntoHtml：原始 HTML 字串裡 <title>／<meta> 的值精確等於 escapeHtml() 後的結果", () => {
  it("<title> 標籤內容精確等於 escapeHtml(meta.title)，沒有任何字面量的 <script> 殘留", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain(`<title>${escapeHtml(meta.title)}</title>`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html.toLowerCase()).not.toContain("<script>");
  });

  it("<meta name=\"description\"> 的 content 屬性精確等於 escapeHtml(meta.description)，雙引號不會提前結束屬性", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain(`<meta name="description" content="${escapeHtml(meta.description)}">`);
  });

  it("og:title／og:description 屬性同樣精確等於 escapeHtml() 後的值", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    expect(html).toContain(`<meta property="og:title" content="${escapeHtml(meta.title)}">`);
    expect(html).toContain(`<meta property="og:description" content="${escapeHtml(meta.description)}">`);
  });
});

describe("NewsArticle JSON-LD：安全序列化，</script> 不會提前結束 <script> 標籤", () => {
  it("<script type=\"application/ld+json\"> 區塊內完全沒有裸露的 '<' 字元", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const jsonLdRaw = match![1];
    expect(jsonLdRaw).not.toContain("<");
    expect(jsonLdRaw.toLowerCase()).not.toContain("</script>");
  });

  it("整段輸出 HTML 不含字面量 '</script>' 以外的 script 提前結束序列（大小寫變化也涵蓋）", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    // 只應該有一個 </script>（JSON-LD 自己合法的結尾標籤），其餘全部被轉義。
    const closeTagCount = (html.match(/<\/script>/gi) || []).length;
    expect(closeTagCount).toBe(1);
  });

  it("JSON-LD 內容仍是合法可解析的 JSON，且 round-trip 後與原始 hostile title/summary 完全一致（沒有被破壞或截斷，只是安全編碼）", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const html = injectMetaIntoHtml(BASE_HTML, meta);
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(match![1]);
    expect(parsed["@type"]).toBe("NewsArticle");
    expect(parsed.headline).toBe(HOSTILE_TITLE);
    expect(parsed.description).toBe(HOSTILE_SUMMARY);
  });

  it("中文與換行字元正確保留在 JSON-LD 裡（沒有被過度過濾）", async () => {
    const meta = await buildNewsMeta(hostileSlug, `/news/${hostileSlug}`);
    const jsonLd = meta.jsonLd as Record<string, any>;
    expect(jsonLd.headline).toContain("惡意標題");
    expect(jsonLd.description).toContain("中文");
    expect(jsonLd.description).toContain("\n");
  });
});
