/**
 * OXM 第一批「找消息」正式發布（90 則母表、87 則實際發布）回歸測試。
 *
 * 涵蓋：一次性批次匯入工具本身不觸發任何通知（架構層面：它只呼叫
 * server/db.ts 的 createNews，完全不 import／呼叫 server/routers.ts 的
 * dispatchNewsNotifications）、資料檔案內容正確性（87 筆、N017 特殊規則、
 * 異常報告 3 筆）、以及「直接呼叫 createNews 不會意外觸發通知」這個機制
 * 本身的即時資料庫驗證。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `batch1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${"Batch1 Test"}, ${`${runId}@example.test`})`);
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

describe("scripts/import-news-batch1.ts：原始碼結構斷言，確認架構上不可能觸發通知", () => {
  function readScriptSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "scripts", "import-news-batch1.ts"), "utf-8");
  }

  it("完全沒有 import 或呼叫 dispatchNewsNotifications／server/routers（檔案開頭的說明註解裡「提到」這個名字是為了解釋原理，不算違規；這裡鎖定的是實際的 import／函式呼叫語法）", () => {
    const source = readScriptSource();
    expect(source).not.toMatch(/import[^;]*dispatchNewsNotifications/);
    expect(source).not.toMatch(/dispatchNewsNotifications\(/);
    expect(source).not.toMatch(/from\s+["']\.\.\/server\/routers["']/);
  });

  it("只 import server/db 的 getDb／createNews，不 import tRPC caller 或 appRouter", () => {
    const source = readScriptSource();
    expect(source).toMatch(/import \{ getDb, createNews \} from "\.\.\/server\/db"/);
    expect(source).not.toMatch(/appRouter|createCaller/);
  });

  it("status 一律寫死 \"published\"，firstPublishedAt／publishedAt 交給 createNews 內部邏輯決定，腳本本身不手動組這兩個欄位", () => {
    const source = readScriptSource();
    expect(source).toMatch(/status:\s*"published"/);
    expect(source).not.toMatch(/firstPublishedAt:/);
    expect(source).not.toMatch(/publishedAt:/);
  });

  it("冪等性：寫入前一定先用 title 查詢既有 news，找到就跳過（不是每次都無條件 insert）", () => {
    const source = readScriptSource();
    const start = source.indexOf("for (const item of items)");
    const end = source.indexOf("console.log(\"\\n===== 總結");
    const loopBody = source.slice(start, end);
    expect(loopBody).toMatch(/eq\(news\.title, item\.title\)/);
    expect(loopBody).toMatch(/skipped\.push/);
  });

  it("不寫封面圖片／PDF 附件欄位——只呼叫 createNews，沒有任何 newsAttachments／coverImage 相關程式碼", () => {
    const source = readScriptSource();
    expect(source).not.toMatch(/newsAttachments/);
    expect(source).not.toMatch(/coverImage/);
  });

  it("預設 dry-run（沒有 --publish 旗標就不寫入），避免誤觸發正式發布", () => {
    const source = readScriptSource();
    expect(source).toMatch(/const DRY_RUN = !process\.argv\.includes\("--publish"\)/);
    expect(source).toMatch(/if \(DRY_RUN\)/);
  });
});

describe("scripts/news-batch1-data.json：87 則發布內容資料正確性", () => {
  function readData(): Array<{
    id: string; title: string; summary: string; content: string;
    isImportant: boolean; isCompetition: boolean; isExhibition: boolean;
    industryNames: string[]; sourceName: string | null; sourceUrl: string | null;
  }> {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "scripts", "news-batch1-data.json"), "utf-8"));
  }

  it("恰好 87 筆，且每一筆都有非空 title/summary/content", () => {
    const data = readData();
    expect(data.length).toBe(87);
    for (const item of data) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.summary.length).toBeGreaterThan(0);
      expect(item.content.length).toBeGreaterThan(0);
    }
  });

  it("標題彼此不重複（跟母表 dry-run 分析一致）", () => {
    const data = readData();
    const titles = data.map(i => i.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("N017：同時勾選重要消息與競賽消息，不勾展覽消息，產業標籤為空（跨產業資訊不對應到任何真實產業）", () => {
    const data = readData();
    const n017 = data.find(i => i.id === "N017");
    expect(n017).toBeDefined();
    expect(n017!.isImportant).toBe(true);
    expect(n017!.isCompetition).toBe(true);
    expect(n017!.isExhibition).toBe(false);
    expect(n017!.industryNames).toEqual([]);
  });

  it("N017：sourceName／sourceUrl 皆為 null（不提供官方報名來源按鈕），內文不含官方報名網址、報名費用等字樣，但有 11 次金獎與 LINE 引導文字", () => {
    const data = readData();
    const n017 = data.find(i => i.id === "N017");
    expect(n017!.sourceName).toBeNull();
    expect(n017!.sourceUrl).toBeNull();
    const text = n017!.title + n017!.summary + n017!.content;
    expect(text).not.toMatch(/innosociety\.org/);
    expect(text).not.toMatch(/報名費/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toMatch(/11\s*次金獎/);
    expect(text).toMatch(/LINE/);
  });

  it("除了 N017 以外，凡有 sourceName 的項目也一定有 sourceUrl（不會有名稱點不了的狀態）", () => {
    const data = readData();
    for (const item of data) {
      if (item.id === "N017") continue;
      if (item.sourceName) expect(item.sourceUrl).toBeTruthy();
    }
  });

  it("industryNames 裡沒有「跨產業資訊」這個偽值，也沒有跟真實產業字面不符的字串（例如全形斜線版的橡膠／矽膠）", () => {
    const REAL_INDUSTRIES = ["紡織", "金屬加工", "電子零件", "塑膠", "橡膠 / 矽膠", "木工", "包裝", "食品", "化工製造", "生活用品", "印刷", "工業設備／機械"];
    const data = readData();
    for (const item of data) {
      for (const name of item.industryNames) {
        expect(name).not.toBe("跨產業資訊");
        expect(REAL_INDUSTRIES).toContain(name);
      }
    }
  });

  it("至少有一筆使用了正規化後的「橡膠 / 矽膠」（半形斜線＋空格），證明全形斜線已經被正確轉換", () => {
    const data = readData();
    expect(data.some(i => i.industryNames.includes("橡膠 / 矽膠"))).toBe(true);
  });
});

describe("scripts/news-batch1-anomaly-report.json：異常報告（來源無法開啟／內容與母表不符）", () => {
  it("恰好 3 筆（N039／N056／N057），每筆都有明確原因，且不在發布名單中", () => {
    const anomalies = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "scripts", "news-batch1-anomaly-report.json"), "utf-8"));
    expect(anomalies.map((a: { id: string }) => a.id).sort()).toEqual(["N039", "N056", "N057"]);
    for (const a of anomalies) expect(a.reason.length).toBeGreaterThan(0);

    const publishData: Array<{ id: string }> = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "scripts", "news-batch1-data.json"), "utf-8"));
    const publishIds = new Set(publishData.map(i => i.id));
    for (const a of anomalies) expect(publishIds.has(a.id)).toBe(false);
  });
});

describe("機制驗證：直接呼叫 db.createNews（不經過 tRPC router）不會建立任何 newsNotifications 紀錄", () => {
  it("以 status=published 直接呼叫 createNews，即使 shouldNotify 回傳 true，newsNotifications 表也完全沒有新紀錄（因為從沒呼叫 dispatchNewsNotifications／createPendingNewsNotifications）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const result = await db.createNews({
        slug: `batch1-notify-check-${runId}`, title: `批次驗證用標題 ${runId}`, summary: "s", content: "c",
        status: "published", isImportant: true, industryNames: ["金屬加工"], createdBy: creator,
      });
      id = result.id;
      expect(result.shouldNotify).toBe(true); // 這個布林值只是回傳給呼叫端參考，本身不會觸發任何動作

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsNotifications WHERE newsId = ${id}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("News.tsx Hero：新增「產業情報中心」eyebrow 小標，不取代主要標題", () => {
  function readNewsPageSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
  }

  it("Hero 區塊內有「產業情報中心」文字，且主要標題仍然存在（GEO Phase 3A：H1 改引用 shared/content/news.ts 的 NEWS_CONTENT.heroH1，不再是頁面內的字面量）", () => {
    const source = readNewsPageSource();
    const heroStart = source.indexOf("Hero：左側文字");
    const heroEnd = source.indexOf("NewsHeroArt();", heroStart);
    const heroBlock = source.slice(heroStart, heroEnd);
    expect(heroBlock).toMatch(/產業情報中心/);
    expect(heroBlock).toMatch(/\{NEWS_CONTENT\.heroH1\}/);

    const newsContent = fs.readFileSync(path.resolve(__dirname, "..", "shared", "content", "news.ts"), "utf-8");
    expect(newsContent).toMatch(/heroH1: "OXM，給你傳產需要的第一手消息"/);
  });

  it("eyebrow 用橘紫漸層文字（bg-clip-text text-transparent），沿用 OXM 品牌配色", () => {
    const source = readNewsPageSource();
    const idx = source.indexOf("產業情報中心");
    const around = source.slice(Math.max(0, idx - 300), idx);
    expect(around).toMatch(/bg-gradient-to-r from-orange-500 to-purple-500/);
    expect(around).toMatch(/bg-clip-text text-transparent/);
  });

  it("document.title 與既有 SEO meta（description／canonical／og:*）沒有被移除或改成空字串", () => {
    const source = readNewsPageSource();
    expect(source).toMatch(/<title>\{pageTitle\}<\/title>/);
    expect(source).toMatch(/name="description" content=\{pageDesc\}/);
    expect(source).toMatch(/rel="canonical"/);
    expect(source).toMatch(/property="og:title" content=\{pageTitle\}/);
  });
});
