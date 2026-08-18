/**
 * Phase 6B：AI 找消息——server/ai/newsSearchAction.ts 驗證。
 *
 * 完全 deterministic（見對話中「十五：不要增加新的 LLM call」），不需要 mock
 * 任何模型呼叫——這裡直接連本機測試 DB，驗證抽取邏輯與 Hard Filter／Ranking
 * 分工是否正確。
 */
import { describe, expect, it, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import {
  extractNewsCategoriesFromText,
  extractIndustriesFromText,
  extractNewsKeywords,
  buildNewsQueryInputFromHistory,
  runNewsSearchAction,
} from "./newsSearchAction";

describe("extractNewsCategoriesFromText：封閉關鍵字集合，對應 news 表既有四個布林欄位", () => {
  it("命中展覽", () => {
    expect(extractNewsCategoriesFromText("最近有沒有金屬加工相關展覽？")).toEqual({
      isImportant: false, isCompetition: false, isExhibition: true, isCrossIndustry: false,
    });
  });
  it("命中競賽", () => {
    expect(extractNewsCategoriesFromText("最近有什麼競賽？")).toEqual({
      isImportant: false, isCompetition: true, isExhibition: false, isCrossIndustry: false,
    });
  });
  it("沒有命中任何類型 → 全部 false", () => {
    expect(extractNewsCategoriesFromText("最近有什麼食品產業活動？")).toEqual({
      isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: false,
    });
  });
});

describe("extractIndustriesFromText：白名單子字串比對，沿用 shared/constants.ts INDUSTRY_OPTIONS", () => {
  it("命中一個產業", () => {
    expect(extractIndustriesFromText("最近有什麼食品產業活動？")).toContain("食品");
  });
  it("沒有提到任何產業 → 空陣列", () => {
    expect(extractIndustriesFromText("最近有什麼競賽？")).toEqual([]);
  });
});

describe("buildNewsQueryInputFromHistory：只拼接 user 訊息，且有長度上限", () => {
  it("只取 role=user 的內容", () => {
    const text = buildNewsQueryInputFromHistory([
      { role: "user", content: "最近有什麼展覽？" },
      { role: "assistant", content: "請問哪個產業？" },
      { role: "user", content: "食品的" },
    ]);
    expect(text).toBe("最近有什麼展覽？ 食品的");
  });
  it("空歷史回傳空字串", () => {
    expect(buildNewsQueryInputFromHistory([])).toBe("");
  });
});

describe("extractNewsKeywords：拿掉已抽取的產業／類型／語助詞後才是自由關鍵字", () => {
  it("純類型／產業查詢沒有剩餘關鍵字", () => {
    const keywords = extractNewsKeywords({ text: "最近有沒有金屬加工相關展覽？", matchedIndustries: ["金屬加工"] });
    expect(keywords).toEqual([]);
  });
  it("有具體主題時保留為關鍵字", () => {
    const keywords = extractNewsKeywords({ text: "最近有沒有SEMICON展？", matchedIndustries: [] });
    expect(keywords.join("")).toContain("SEMICON");
  });
});

// ===== 真實 DB 區塊 =====
const { getDb, createNews } = await import("../db");

const runId = `nsa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueTag = `NSA${runId.replace(/[^a-zA-Z0-9]/g, "")}`;
const cleanupNewsIds: number[] = [];
const cleanupUserIds: number[] = [];

async function makeUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}-${cleanupUserIds.length}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`NSA ${runId}`}, ${`${runId}-${cleanupUserIds.length}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]!.id;
  cleanupUserIds.push(id);
  return id;
}

async function makeNews(params: {
  title: string;
  summary?: string;
  content?: string;
  isImportant?: boolean;
  isCompetition?: boolean;
  isExhibition?: boolean;
  isCrossIndustry?: boolean;
  industryNames?: string[];
}): Promise<number> {
  const userId = await makeUser();
  const { id } = await createNews({
    title: params.title,
    summary: params.summary ?? params.title,
    content: params.content ?? params.title,
    status: "published",
    isImportant: params.isImportant ?? false,
    isCompetition: params.isCompetition ?? false,
    isExhibition: params.isExhibition ?? false,
    isCrossIndustry: params.isCrossIndustry ?? false,
    industryNames: params.industryNames ?? [],
    createdBy: userId,
  });
  cleanupNewsIds.push(id);
  return id;
}

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const id of cleanupNewsIds) {
    await conn.execute(sql`DELETE FROM newsIndustries WHERE newsId = ${id}`);
    await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
  }
  for (const id of cleanupUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

describe("CASE N1：展覽＋產業 hard filter", () => {
  it("同時符合展覽類型與產業別的消息才出現，不符合的（類型不對／產業不對）不出現", async () => {
    const tag = uniqueTag + "N1";
    // industryNames 必須是 shared/constants.ts INDUSTRY_OPTIONS 的真實白名單值
    // （db.createNews 的 validateNewsIndustryNames 會擋掉非白名單字串），測試
    // 隔離改靠標題的 tag 前綴，不對 total 做精確計數斷言（避免跟同一份白名單
    // 產業的其他並行資料互相干擾）。
    const matchId = await makeNews({
      title: `${tag} 金屬加工展覽會`, isExhibition: true, industryNames: ["金屬加工"],
    });
    const wrongTypeId = await makeNews({ title: `${tag} 金屬加工徵才活動`, isExhibition: false, industryNames: ["金屬加工"] });
    const wrongIndustryId = await makeNews({ title: `${tag} 食品展覽會`, isExhibition: true, industryNames: ["食品"] });

    const result = await runNewsSearchAction([{ role: "user", content: `最近有沒有${tag}金屬加工相關展覽？` }]);
    const ids = result.candidates.map(c => c.id);
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(wrongTypeId);
    expect(ids).not.toContain(wrongIndustryId);
  });
});

describe("CASE N3：純類型 hard filter（競賽），不需要產業", () => {
  it("只偵測到競賽類型時，任何產業的競賽消息都出現", async () => {
    const tag = uniqueTag + "N3";
    const compId = await makeNews({ title: `${tag} 創新競賽開跑`, isCompetition: true });
    await makeNews({ title: `${tag} 純資訊公告`, isCompetition: false });

    const result = await runNewsSearchAction([{ role: "user", content: `最近有什麼${tag}競賽？` }]);
    const ids = result.candidates.map(c => c.id);
    expect(ids).toContain(compId);
  });
});

describe("CASE N5：完全沒有符合的消息 → 誠實回報 0 results，不 fallback", () => {
  it("查詢條件（唯一 tag 關鍵字，資料庫裡保證不存在）→ zeroResult=true，不會被其他測試資料誤命中", async () => {
    // 不觸發任何類型（展覽／競賽／重要／跨產業）或真實產業關鍵字，純粹用一個
    // 唯一 tag 當關鍵字（見「完全沒有類型也沒有產業時，keyword 本身當 hard
    // filter」的設計）——這樣才能保證跟同一份測試檔案裡其他 CASE 建立的真實
    // 展覽／產業資料完全不會誤命中。
    const tag = uniqueTag + "N5NOTEXIST";
    const result = await runNewsSearchAction([{ role: "user", content: `${tag}關鍵字保證不存在` }]);
    expect(result.zeroResult).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("Ranking：關鍵字命中 title 排在只符合結構化條件的前面", () => {
  it("同樣是金屬加工新聞，標題命中關鍵字的 tier 較高、排序在前", async () => {
    const tag = uniqueTag + "RANK";
    const titleMatchId = await makeNews({
      title: `${tag} SEMICON 半導體展登場`, industryNames: ["金屬加工"],
    });
    const noMatchId = await makeNews({
      title: `${tag} 一般產業公告`, industryNames: ["金屬加工"],
    });

    // 直接呼叫 db 層、給大一點的 limit，避開 runNewsSearchAction 預設只顯示
    // 3 則的截斷——這裡要驗證的是 tier 排序邏輯本身，不是「查看前 3 則」這件
    // 事（那個由 CASE N1／viewAllUrl 等其他測試涵蓋）。
    const { searchNewsForAi } = await import("../db");
    const dbResult = await searchNewsForAi({
      categoryFilters: { isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: false },
      industryNames: ["金屬加工"],
      keywords: ["SEMICON"],
      limit: 50,
    });
    const titleMatchCandidate = dbResult.items.find(c => c.id === titleMatchId);
    const noMatchCandidate = dbResult.items.find(c => c.id === noMatchId);
    expect(titleMatchCandidate).toBeDefined();
    expect(noMatchCandidate).toBeDefined();
    expect(titleMatchCandidate!.tier).toBe(2);
    expect(noMatchCandidate!.tier).toBe(0);
    expect(dbResult.items.indexOf(titleMatchCandidate!)).toBeLessThan(dbResult.items.indexOf(noMatchCandidate!));
  });
});

describe("viewAllUrl：對應 News.tsx 真實使用的 query param", () => {
  it("有偵測到產業時組出 /news?category=industry&industry=xxx", async () => {
    const result = await runNewsSearchAction([{ role: "user", content: "最近食品產業有什麼消息？" }]);
    expect(result.viewAllUrl).toContain("category=industry");
    expect(decodeURIComponent(result.viewAllUrl)).toContain("industry=食品");
  });
  it("只偵測到展覽類型時組出 /news?category=exhibition", async () => {
    const result = await runNewsSearchAction([{ role: "user", content: "最近有什麼展覽？" }]);
    expect(result.viewAllUrl).toBe("/news?category=exhibition");
  });
});

describe("Visibility：draft／withdrawn 不得出現在 AI 搜尋結果", () => {
  it("只有 published 的消息會被搜到", async () => {
    const tag = uniqueTag + "VIS";
    const publishedId = await makeNews({ title: `${tag} 已發布消息`, isImportant: true });
    const userId = await makeUser();
    const { id: draftId } = await createNews({
      title: `${tag} 草稿消息`, summary: "x", content: "x", status: "draft", isImportant: true, createdBy: userId,
    });
    cleanupNewsIds.push(draftId);

    const result = await runNewsSearchAction([{ role: "user", content: `最近有什麼${tag}重要消息？` }]);
    const ids = result.candidates.map(c => c.id);
    expect(ids).toContain(publishedId);
    expect(ids).not.toContain(draftId);
  });
});
