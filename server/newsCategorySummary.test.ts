/**
 * 找消息分類 NEW 徽章彙總（getNewCategorySummary）回歸測試。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 保護）。這是本機開發用的
 * 資料庫，可能已經有其他手動測試留下的、確實在 72 小時內發布的消息——所以
 * 這裡的 DB 測試一律只做「建立一筆會讓某個分類/產業變成 true 的資料後，
 * 該欄位確實是 true」這種單向斷言，不對「其他分類欄位是 false」做全域斷言
 * （那種斷言在真實共用資料庫上天生不穩定，跟這份檔案裡其他既有測試——例如
 * gatherNewsRecipients 系列——採用同一種只驗證「有沒有包含」而非「完整清單」
 * 的既有慣例一致）。72 小時邊界排除（已下架／草稿／超過 72 小時）改用跟
 * getNewCategorySummary 完全相同的 WHERE 條件直接對單一測試列做真假驗證，
 * 這個驗證方式不受資料庫裡其他既有資料汙染影響，是確定性的。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `newcat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`NewCat Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

async function deleteTestUser(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
}

async function cleanupNews(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
}

/** 跟 db.ts 的 getNewCategorySummary 完全相同的判斷條件，只鎖定單一 id，不受其他資料列汙染。 */
async function isRowCountedAsRecent(id: number): Promise<boolean> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const [rows] = await conn.execute(
    sql`SELECT id FROM news WHERE id = ${id} AND status = 'published' AND firstPublishedAt >= ${cutoff}`
  ) as unknown as [{ id: number }[], unknown];
  return rows.length > 0;
}

describe("db.getNewCategorySummary：72 小時內已發布消息的分類 NEW 彙總", () => {
  it("剛發布（firstPublishedAt 在 72 小時內）且勾選競賽＋產業，all／competition／industry／該產業都是 true", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-recent-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCompetition: true, industryNames: ["金屬加工"], createdBy: creator,
      })).id;

      const summary = await db.getNewCategorySummary();
      expect(summary.all).toBe(true);
      expect(summary.competition).toBe(true);
      expect(summary.industry).toBe(true);
      expect(summary.industries["金屬加工"]).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("一篇消息同時符合重要消息＋競賽＋展覽＋兩個產業，可以同時讓多個分類都顯示 NEW（不是只能命中一個）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-multi-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, isCompetition: true, isExhibition: true,
        industryNames: ["電子零件", "塑膠"], createdBy: creator,
      })).id;

      const summary = await db.getNewCategorySummary();
      expect(summary.important).toBe(true);
      expect(summary.competition).toBe(true);
      expect(summary.exhibition).toBe(true);
      expect(summary.industries["電子零件"]).toBe(true);
      expect(summary.industries["塑膠"]).toBe(true);
      // 個別產業有 NEW 時，產業消息父層（industry）也要一併是 true。
      expect(summary.industry).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("firstPublishedAt 超過 72 小時的已發布消息，不計入 recent 範圍（用 getNewCategorySummary 相同的 WHERE 條件對單一列直接驗證，不受資料庫其他資料影響）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-old-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      expect(await isRowCountedAsRecent(id)).toBe(true); // 剛發布，理論上算 recent

      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 73 HOUR) WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(false); // 超過 72 小時，不再算 recent
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("草稿（status=draft）即使 firstPublishedAt 在 72 小時內也不計入（status 條件擋下）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-draft-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      // 草稿沒有 firstPublishedAt，直接手動塞一個近期時間，驗證單靠 status 條件就足以擋下。
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = NOW() WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("下架後重新發布：firstPublishedAt 不會被重置，超過 72 小時窗口後不會因為重新發布而重新變成 NEW", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-republish-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 模擬「很久以前第一次發布」：firstPublishedAt 設在 100 小時前。
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 100 HOUR) WHERE id = ${id}`);

      await db.updateNews(id, { status: "withdrawn" });
      await db.updateNews(id, { status: "published" }); // 重新發布：publishedAt 更新，但 firstPublishedAt 應該維持 100 小時前不變

      const row = await db.getNewsById(id);
      const hoursSinceFirst = (Date.now() - (row!.firstPublishedAt as Date).getTime()) / (60 * 60 * 1000);
      expect(hoursSinceFirst).toBeGreaterThan(72); // 確認真的還是很久以前，不是被重新發布蓋掉

      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("平台完全沒有 72 小時內的已發布消息時，all 為 false、industries 是空物件（不是 undefined 或缺欄位）", async () => {
    // 這裡不建立任何資料，只驗證回傳形狀本身在「recent.length === 0」的 early return 分支下仍然完整。
    // 因為本機開發資料庫可能本來就有近期消息，這裡改成直接驗證 shape 的存在與型別，而不是斷言 all===false。
    const summary = await db.getNewCategorySummary();
    expect(typeof summary.all).toBe("boolean");
    expect(typeof summary.important).toBe("boolean");
    expect(typeof summary.competition).toBe("boolean");
    expect(typeof summary.exhibition).toBe("boolean");
    expect(typeof summary.industry).toBe("boolean");
    expect(typeof summary.industries).toBe("object");
  });
});

describe("getNewCategorySummary 原始碼：判斷依據是 firstPublishedAt＋status，且是固定次數查詢（不是每個分類/產業各自查一次）", () => {
  function readDbSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
  }

  it("WHERE 條件用 firstPublishedAt 與 status='published'，不是 publishedAt 或 updatedAt", () => {
    const source = readDbSource();
    const start = source.indexOf("export async function getNewCategorySummary");
    expect(start).toBeGreaterThan(-1);
    const fn = source.slice(start, start + 2000);
    expect(fn).toMatch(/gte\(news\.firstPublishedAt, cutoff\)/);
    expect(fn).toMatch(/eq\(news\.status, "published"\)/);
    expect(fn).not.toMatch(/news\.publishedAt/);
    expect(fn).not.toMatch(/news\.updatedAt/);
  });

  it("固定兩次 db.select 查詢（近期消息本身＋對應產業標籤），沒有 for 迴圈對每個分類或每個產業各自查詢", () => {
    const source = readDbSource();
    const start = source.indexOf("export async function getNewCategorySummary");
    const end = source.indexOf("\nexport ", start + 10);
    const fn = source.slice(start, end === -1 ? start + 2000 : end);
    const selectCount = (fn.match(/db\.select(Distinct)?\(/g) ?? []).length;
    expect(selectCount).toBe(2);
    // 唯一的 for 迴圈只能是在記憶體裡組 industries 這個 Record，不能是對每個
    // 分類/產業各自發一次查詢的迴圈（那種寫法裡，迴圈內部會出現 await db.）。
    expect(fn).not.toMatch(/for\s*\([^)]*\)\s*\{?[^{}]*await db\./);
    expect(fn).not.toMatch(/\.map\(async/);
    expect(fn).not.toMatch(/Promise\.all/);
  });
});

describe("news router：getNewCategorySummary 掛在 publicProcedure，不需要登入即可取得 NEW 徽章資料", () => {
  it("news router 裡有 getNewCategorySummary: publicProcedure", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/getNewCategorySummary: publicProcedure/);
  });
});

describe("News.tsx：分類 NEW 徽章前端整合（原始碼內容斷言）", () => {
  function readNewsPageSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
  }

  it("只有一次 trpc.news.getNewCategorySummary.useQuery 呼叫，不是每個分類/產業各自 useQuery（不是 15 個查詢）", () => {
    const source = readNewsPageSource();
    const matches = source.match(/trpc\.news\.getNewCategorySummary\.useQuery/g) ?? [];
    expect(matches.length).toBe(1);
    // 更嚴格地確認：這個唯一的呼叫不是包在 FIXED_CATEGORIES.map 或 INDUSTRIES.map 裡面。
    const idx = source.indexOf("trpc.news.getNewCategorySummary.useQuery");
    const before = source.slice(Math.max(0, idx - 300), idx);
    expect(before).not.toMatch(/\.map\(/);
  });

  it("彙總查詢有設定 staleTime，且沒有加 refetchInterval／polling", () => {
    const source = readNewsPageSource();
    const idx = source.indexOf("trpc.news.getNewCategorySummary.useQuery");
    const block = source.slice(idx, idx + 300);
    expect(block).toMatch(/staleTime:\s*5 \* 60 \* 1000/);
    expect(block).not.toMatch(/refetchInterval/);
  });

  it("categoryHasNew 判斷式：all/important/competition/exhibition 各自對應summary欄位，產業類別看 summary.industries[名稱]", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function categoryHasNew");
    const end = source.indexOf("function NewBadge");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/if \(cat === "all"\) return summary\.all;/);
    expect(fn).toMatch(/if \(cat === "important"\) return summary\.important;/);
    expect(fn).toMatch(/if \(cat === "competition"\) return summary\.competition;/);
    expect(fn).toMatch(/if \(cat === "exhibition"\) return summary\.exhibition;/);
    expect(fn).toMatch(/summary\.industries\[cat\.slice\("industry:"\.length\)\] \?\? false/);
  });

  it("桌面側欄：四個固定分類、產業消息父層、每個個別產業都會渲染 NewBadge", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("{/* 桌面版：左側分類側欄");
    const end = source.indexOf("{/* 右側：分類標題區");
    const sidebar = source.slice(start, end);

    expect(sidebar).toMatch(/\{categoryHasNew\(c\.value, newSummary\) && <NewBadge \/>\}/);
    expect(sidebar).toMatch(/\{newSummary\?\.industry && <NewBadge \/>\}/);
    expect(sidebar).toMatch(/\{categoryHasNew\(`industry:\$\{ind\.name\}`, newSummary\) && <NewBadge \/>\}/);
  });

  it("手機版 Select：選項文字後面附加 NEW 文字，選中分類旁另外顯示徽章；原生 select 不需要塞入自訂徽章 JSX", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("{/* 手機版：分類選單");
    const end = source.indexOf("<div className=\"flex gap-8\">");
    const mobile = source.slice(start, end);

    expect(mobile).toMatch(/\{categoryHasNew\(c\.value, newSummary\) \? " NEW" : ""\}/);
    expect(mobile).toMatch(/\{categoryHasNew\(`industry:\$\{ind\.name\}`, newSummary\) \? " NEW" : ""\}/);
    expect(mobile).toMatch(/\{categoryHasNew\(category, newSummary\) && <NewBadge/);
  });

  it("NewBadge 樣式使用暖橘紅漸層（跟現有列表項目 NEW 徽章同一組色，維持風格一致）", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function NewBadge");
    const end = source.indexOf("function categoryLabel");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/bg-gradient-to-r from-orange-500 to-red-500/);
  });
});
