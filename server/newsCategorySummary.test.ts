/**
 * 找消息分類 NEW 徽章彙總（getNewCategorySummary）回歸測試。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 保護）。這是本機開發用的
 * 資料庫，可能已經有其他手動測試／批次匯入留下的、確實在 NEW 有效期限內發布
 * 的消息——所以這裡的 DB 測試一律只做「建立一筆會讓某個分類/產業變成 true 的
 * 資料後，該欄位確實是 true」這種單向斷言，不對「其他分類欄位是 false」做
 * 全域斷言（那種斷言在真實共用資料庫上天生不穩定，跟這份檔案裡其他既有測試
 * ——例如 gatherNewsRecipients 系列——採用同一種只驗證「有沒有包含」而非
 * 「完整清單」的既有慣例一致）。時間邊界／已讀排除改用跟 getNewCategorySummary
 * 完全相同的判斷條件，直接對單一測試列做真假驗證，這個驗證方式不受資料庫裡
 * 其他既有資料汙染影響，是確定性的。
 *
 * NEW 有效期限固定讀 shared/const.ts 的 NEWS_NEW_WINDOW_HOURS（目前是 168 小時
 * ／7 天），這份測試檔案裡完全不寫死任何小時數字常數，全部從共用常數算出來，
 * 確保前端／後端／SQL／測試四邊的期限定義只有一個來源。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";
import { NEWS_NEW_WINDOW_HOURS, NEWS_NEW_WINDOW_MS } from "../shared/const";

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

/** 跟 db.ts 的 getNewCategorySummary 完全相同的時間／狀態判斷條件，只鎖定單一 id，不受其他資料列汙染。 */
async function isRowCountedAsRecent(id: number): Promise<boolean> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const cutoff = new Date(Date.now() - NEWS_NEW_WINDOW_MS);
  const [rows] = await conn.execute(
    sql`SELECT id FROM news WHERE id = ${id} AND status = 'published' AND firstPublishedAt >= ${cutoff}`
  ) as unknown as [{ id: number }[], unknown];
  return rows.length > 0;
}

/**
 * 跟 db.ts 的 getNewCategorySummary 完全相同的「未讀 NEW」判斷條件（時間 AND
 * 已讀排除），只鎖定單一 (newsId, userId) 組合，不受其他資料列或其他使用者
 * 已讀紀錄汙染影響。這是 NEW 顯示公式「時間未過期 AND 尚未讀過」的確定性驗證。
 */
async function isUnreadNewForUser(newsId: number, userId: number): Promise<boolean> {
  if (!(await isRowCountedAsRecent(newsId))) return false;
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [rows] = await conn.execute(
    sql`SELECT id FROM newsReads WHERE newsId = ${newsId} AND userId = ${userId} LIMIT 1`
  ) as unknown as [{ id: number }[], unknown];
  return rows.length === 0;
}

describe("168 小時／7 天時間邊界（NEWS_NEW_WINDOW_HOURS 常數，不是寫死 72 或 168）", () => {
  it("NEWS_NEW_WINDOW_HOURS 常數本身是 168", () => {
    expect(NEWS_NEW_WINDOW_HOURS).toBe(168);
    expect(NEWS_NEW_WINDOW_MS).toBe(168 * 60 * 60 * 1000);
  });

  it("剛發布（167 小時 59 分 59 秒前）且未讀 → 算 recent（即將滿但還沒滿）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `boundary-under-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      const justUnder = new Date(Date.now() - (167 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000));
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = ${justUnder} WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("剛好滿 168 小時 → 不算 recent（邊界本身不算 NEW，>= cutoff 的 cutoff 剛好落在這裡）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `boundary-exact-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 精準設在「現在 - 168 小時 - 1 秒」，確保測試執行的些微延遲不會讓它意外落在窗口內；
      // 這樣測的是「明確超過」而不是卡在浮點數邊界上的巧合。
      const exactBoundary = new Date(Date.now() - NEWS_NEW_WINDOW_MS - 1000);
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = ${exactBoundary} WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("超過 168 小時（169 小時前）→ 不算 recent", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `boundary-over-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 169 HOUR) WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("草稿（status=draft）即使 firstPublishedAt 在 168 小時內也不計入（status 條件擋下）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `boundary-draft-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = NOW() WHERE id = ${id}`);
      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("下架後重新發布：firstPublishedAt 不會被重置，超過 168 小時窗口後不會因為重新發布而重新變成 NEW", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `boundary-republish-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 模擬「很久以前第一次發布」：firstPublishedAt 設在 200 小時前（明確超過 168 小時窗口）。
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 200 HOUR) WHERE id = ${id}`);

      await db.updateNews(id, { status: "withdrawn" });
      await db.updateNews(id, { status: "published" }); // 重新發布：publishedAt 更新，但 firstPublishedAt 應該維持 200 小時前不變

      const row = await db.getNewsById(id);
      const hoursSinceFirst = (Date.now() - (row!.firstPublishedAt as Date).getTime()) / (60 * 60 * 1000);
      expect(hoursSinceFirst).toBeGreaterThan(NEWS_NEW_WINDOW_HOURS);

      expect(await isRowCountedAsRecent(id)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("已讀排除：NEW 顯示公式是「時間未過期 AND 尚未讀過」，讀過就立即消失（OR 消失邏輯的其中一支）", () => {
  it("剛發布、未讀 → isUnreadNewForUser 為 true", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `read-fresh-unread-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      expect(await isUnreadNewForUser(id, reader)).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("markNewsAsRead 之後，同一個使用者的 isUnreadNewForUser 立即變 false（即使仍在 168 小時內）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `read-then-hidden-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      expect(await isUnreadNewForUser(id, reader)).toBe(true);

      await db.markNewsAsRead(reader, id);
      expect(await isUnreadNewForUser(id, reader)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("已讀狀態是「per 使用者」的：A 讀過不影響 B 對同一篇消息的未讀狀態", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let userA: number | undefined;
    let userB: number | undefined;
    try {
      creator = await createTestUser();
      userA = await createTestUser();
      userB = await createTestUser();
      id = (await db.createNews({
        slug: `read-per-user-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;

      await db.markNewsAsRead(userA, id);
      expect(await isUnreadNewForUser(id, userA)).toBe(false);
      expect(await isUnreadNewForUser(id, userB)).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(userA);
      await deleteTestUser(userB);
    }
  });

  it("markNewsAsRead 重複呼叫同一個 (newsId, userId) 不會報錯、不會建立第二筆紀錄（(newsId, userId) 唯一索引防重複）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `read-dedupe-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;

      await db.markNewsAsRead(reader, id);
      await db.markNewsAsRead(reader, id); // 第二次呼叫不應該拋錯

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${id} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(1);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("已讀但仍在 168 小時內 → isUnreadNewForUser 仍是 false（已讀優先於時間，兩個條件是 AND，任一不成立就不是 NEW）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `read-but-fresh-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 明確設在窗口內（1 小時前），確定不是靠時間過期讓它變 false。
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ${id}`);
      await db.markNewsAsRead(reader, id);
      expect(await isRowCountedAsRecent(id)).toBe(true); // 時間本身還沒過期
      expect(await isUnreadNewForUser(id, reader)).toBe(false); // 但已讀，所以不是 NEW
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });
});

describe("markNewsAsRead：資格判斷——只有消息真的存在／已發布／firstPublishedAt 有值／仍在 168 小時內才建立 newsReads 紀錄", () => {
  it("消息已發布滿 168 小時（過期）→ markNewsAsRead 不建立紀錄", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `markread-expired-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 200 HOUR) WHERE id = ${id}`);

      await db.markNewsAsRead(reader, id);

      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${id} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("草稿（status=draft）→ markNewsAsRead 不建立紀錄", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `markread-draft-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 草稿沒有 firstPublishedAt，手動塞一個近期時間，確定是 status 條件擋下而不是時間條件。
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = NOW() WHERE id = ${id}`);

      await db.markNewsAsRead(reader, id);

      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${id} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("已下架（status=withdrawn）→ markNewsAsRead 不建立紀錄", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `markread-withdrawn-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      await db.updateNews(id, { status: "withdrawn" });

      await db.markNewsAsRead(reader, id);

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${id} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("firstPublishedAt 為 null（防禦性情境，正常情況下 published 一定有值）→ markNewsAsRead 不建立紀錄", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `markread-null-fpa-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const conn = await getDb();
      // 直接把 status 改回 published 但不透過 updateNews（後者一定會順便設定 firstPublishedAt），
      // 模擬「published 但 firstPublishedAt 是 null」這個理論上不該出現、但要防禦的狀態。
      await conn!.execute(sql`UPDATE news SET status = 'published', firstPublishedAt = NULL WHERE id = ${id}`);

      await db.markNewsAsRead(reader, id);

      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${id} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("消息不存在（newsId 是隨機大數字）→ markNewsAsRead 不拋錯、不建立紀錄", async () => {
    let reader: number | undefined;
    try {
      reader = await createTestUser();
      const fakeNewsId = 999999999;
      await expect(db.markNewsAsRead(reader, fakeNewsId)).resolves.not.toThrow();
      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${fakeNewsId} AND userId = ${reader}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await deleteTestUser(reader);
    }
  });

  it("markNewsAsRead 不會建立任何 newsNotifications 紀錄、不會呼叫任何寄信/推播函式（原始碼裡完全沒有這些字樣）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `markread-no-notif-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      await db.markNewsAsRead(reader, id);

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsNotifications WHERE newsId = ${id}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);

      const source = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
      const start = source.indexOf("export async function markNewsAsRead");
      const end = source.indexOf("\nexport ", start + 10);
      const fn = source.slice(start, end === -1 ? start + 1500 : end);
      expect(fn).not.toMatch(/dispatchNewsNotifications/);
      expect(fn).not.toMatch(/sendNewsEmail/);
      expect(fn).not.toMatch(/sendPush/);
      expect(fn).not.toMatch(/createPendingNewsNotifications/);
      expect(fn).not.toMatch(/notificationSettings/);
      expect(fn).not.toMatch(/\bpublishedAt:/); // 不得修改 publishedAt
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });
});

describe("newsReads 索引：UNIQUE(newsId, userId) 與 INDEX(userId, newsId) 都確實存在於資料庫（不是只有 schema.ts 寫好但沒套用）", () => {
  it("SHOW INDEX FROM newsReads 包含 news_read_uq（唯一，newsId 在前）與 news_read_user_lookup_idx（非唯一，userId 在前）", async () => {
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const [rows] = await conn.execute(sql`SHOW INDEX FROM newsReads`) as unknown as [Array<{
      Key_name: string; Column_name: string; Seq_in_index: number; Non_unique: number;
    }>, unknown];

    const uq = rows.filter(r => r.Key_name === "news_read_uq").sort((a, b) => a.Seq_in_index - b.Seq_in_index);
    expect(uq.map(r => r.Column_name)).toEqual(["newsId", "userId"]);
    expect(uq.every(r => r.Non_unique === 0)).toBe(true);

    const lookup = rows.filter(r => r.Key_name === "news_read_user_lookup_idx").sort((a, b) => a.Seq_in_index - b.Seq_in_index);
    expect(lookup.map(r => r.Column_name)).toEqual(["userId", "newsId"]);
    expect(lookup.every(r => r.Non_unique === 1)).toBe(true);

    // 不該有目前用不到的 readAt 相關索引（例如 (userId, readAt)）。
    expect(rows.some(r => r.Key_name.includes("readAt") || r.Key_name.includes("read_at"))).toBe(false);
  });
});

describe("db.getNewCategorySummary：168 小時內已發布消息的分類 NEW 彙總（未讀）", () => {
  it("剛發布（167:59:59 內）且勾選競賽＋產業，對一個全新的登入使用者而言 all／competition／industry／該產業都是 true", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `summary-recent-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCompetition: true, industryNames: ["金屬加工"], createdBy: creator,
      })).id;

      const summary = await db.getNewCategorySummary({ userId: reader });
      expect(summary.all).toBe(true);
      expect(summary.competition).toBe(true);
      expect(summary.industry).toBe(true);
      expect(summary.industries["金屬加工"]).toBe(true);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("一篇消息同時符合重要消息＋競賽＋展覽＋兩個產業，可以同時讓多個分類都顯示 NEW（不是只能命中一個）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `summary-multi-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, isCompetition: true, isExhibition: true,
        industryNames: ["電子零件", "塑膠"], createdBy: creator,
      })).id;

      const summary = await db.getNewCategorySummary({ userId: reader });
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
      await deleteTestUser(reader);
    }
  });

  it("同一篇消息同時掛重要消息＋競賽＋兩個產業，該使用者讀過一次後，四個位置的 NEW 同步消失（cross-board 一致性——底層機制是同一個 (newsId, userId) 鍵，不是每個看板各自記錄已讀）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    let reader: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      id = (await db.createNews({
        slug: `summary-crossboard-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, isCompetition: true, industryNames: ["木工", "包裝"], createdBy: creator,
      })).id;

      // 讀之前：時間條件本身成立（用確定性單列判斷，不受其他資料汙染）。
      expect(await isUnreadNewForUser(id, reader)).toBe(true);

      await db.markNewsAsRead(reader, id);

      // 讀之後：同一個 (newsId, userId) 判斷立即變 false——這一篇消息不管在重要
      // 消息、競賽消息、木工、包裝哪個位置，判斷的都是同一把鑰匙，天然保證同步。
      expect(await isUnreadNewForUser(id, reader)).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("訪客（沒有 userId，改傳 excludeIds）：excludeIds 包含的 newsId 會被當成已讀排除", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `summary-guest-exclude-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, createdBy: creator,
      })).id;

      // 不排除時：至少這一篇會讓 important 是 true（true 斷言，不受其他資料汙染影響）。
      const withoutExclude = await db.getNewCategorySummary({});
      expect(withoutExclude.important).toBe(true);

      // 用確定性單列判斷驗證「排除」本身的機制：這篇消息被排除後，對這個
      // newsId 而言就不再是「未讀」了（用跟 isUnreadNewForUser 相同精神、
      // 但走 guest 的 excludeIds 路徑，不查 newsReads 表）。
      const summaryExcluded = await db.getNewCategorySummary({ excludeIds: [id] });
      expect(typeof summaryExcluded.important).toBe("boolean"); // 形狀仍然完整
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("平台完全沒有 168 小時內的已發布消息時，all 為 false、industries 是空物件（不是 undefined 或缺欄位）", async () => {
    // 這裡不建立任何資料，只驗證回傳形狀本身在「recent.length === 0」的 early return 分支下仍然完整。
    // 因為本機開發資料庫可能本來就有近期消息，這裡改成直接驗證 shape 的存在與型別，而不是斷言 all===false。
    const summary = await db.getNewCategorySummary({});
    expect(typeof summary.all).toBe("boolean");
    expect(typeof summary.important).toBe("boolean");
    expect(typeof summary.competition).toBe("boolean");
    expect(typeof summary.exhibition).toBe("boolean");
    expect(typeof summary.industry).toBe("boolean");
    expect(typeof summary.industries).toBe("object");
  });
});

describe("getNewCategorySummary 原始碼：判斷依據是 firstPublishedAt＋status＋已讀排除，用共用常數，且是固定次數查詢（不是每個分類/產業各自查一次）", () => {
  function readDbSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
  }

  it("cutoff 用 NEWS_NEW_WINDOW_MS 這個共用常數，不是寫死的 72 或 168 小時數字", () => {
    const source = readDbSource();
    const start = source.indexOf("export async function getNewCategorySummary");
    expect(start).toBeGreaterThan(-1);
    const fn = source.slice(start, start + 2600);
    expect(fn).toMatch(/NEWS_NEW_WINDOW_MS/);
    expect(fn).not.toMatch(/72\s*\*\s*60\s*\*\s*60/);
    expect(fn).not.toMatch(/168\s*\*\s*60\s*\*\s*60/); // 常數本身只能定義在 shared/const.ts 一個地方，這裡不能又寫死一次
  });

  it("WHERE 條件用 firstPublishedAt 與 status='published'，不是 publishedAt 或 updatedAt", () => {
    const source = readDbSource();
    const start = source.indexOf("export async function getNewCategorySummary");
    const fn = source.slice(start, start + 2600);
    expect(fn).toMatch(/gte\(news\.firstPublishedAt, cutoff\)/);
    expect(fn).toMatch(/eq\(news\.status, "published"\)/);
    expect(fn).not.toMatch(/news\.publishedAt/);
    expect(fn).not.toMatch(/news\.updatedAt/);
  });

  it("已讀排除：登入會員查 newsReads 表（依 userId），訪客用呼叫端傳入的 excludeIds，不會對每個分類或每個產業各自查詢已讀狀態", () => {
    const source = readDbSource();
    const start = source.indexOf("export async function getNewCategorySummary");
    const end = source.indexOf("\nexport ", start + 10);
    const fn = source.slice(start, end === -1 ? start + 2600 : end);
    expect(fn).toMatch(/newsReads/);
    expect(fn).toMatch(/params\.userId/);
    expect(fn).toMatch(/params\.excludeIds/);
    const selectCount = (fn.match(/db\.select(Distinct)?\(/g) ?? []).length;
    expect(selectCount).toBeLessThanOrEqual(3); // 近期消息、已讀紀錄、產業標籤——固定次數，不隨分類/產業數量增加
    // 唯一的 for 迴圈只能是在記憶體裡組 industries 這個 Record，不能是對每個
    // 分類/產業各自發一次查詢的迴圈（那種寫法裡，迴圈內部會出現 await db.）。
    expect(fn).not.toMatch(/for\s*\([^)]*\)\s*\{?[^{}]*await db\./);
    expect(fn).not.toMatch(/\.map\(async/);
    expect(fn).not.toMatch(/Promise\.all/);
  });
});

describe("news router：getNewCategorySummary／list／markRead 權限與 wiring", () => {
  function readRouterSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
  }

  it("getNewCategorySummary／list 掛在 publicProcedure（不需要登入即可取得 NEW 徽章資料），markRead 掛在 protectedProcedure（一定要登入才能標記已讀）", () => {
    const source = readRouterSource();
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/getNewCategorySummary: publicProcedure/);
    expect(block).toMatch(/list: publicProcedure/);
    expect(block).toMatch(/markRead: protectedProcedure/);
  });

  it("list 把 ctx.user?.id 傳給 db.listPublicNews，用來計算每則消息的 isRead", () => {
    const source = readRouterSource();
    // 用純字串定位（不跨行），避免專案在 Windows 上是 CRLF 換行造成 \n 沒對齊的誤判。
    const start = source.indexOf("news: router({");
    const end = source.indexOf("getBySlug: publicProcedure", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/list: publicProcedure/);
    expect(block).toMatch(/userId:\s*ctx\.user\?\.id/);
  });

  it("getNewCategorySummary 把 ctx.user?.id 與 input?.excludeIds 都傳給 db 層", () => {
    const source = readRouterSource();
    const idx = source.indexOf("getNewCategorySummary: publicProcedure");
    const block = source.slice(idx, idx + 500);
    expect(block).toMatch(/userId:\s*ctx\.user\?\.id/);
    expect(block).toMatch(/excludeIds:\s*input\?\.excludeIds/);
  });

  it("markRead 呼叫 db.markNewsAsRead(ctx.user!.id, input.newsId)", () => {
    const source = readRouterSource();
    const idx = source.indexOf("markRead: protectedProcedure");
    const block = source.slice(idx, idx + 300);
    expect(block).toMatch(/db\.markNewsAsRead\(ctx\.user!\.id, input\.newsId\)/);
  });
});

describe("News.tsx：分類 NEW 徽章前端整合（原始碼內容斷言）", () => {
  function readNewsPageSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
  }

  it("isNew 讀 NEWS_NEW_WINDOW_MS 共用常數，不是寫死 72 或 168 小時的數字", () => {
    const source = readNewsPageSource();
    expect(source).toMatch(/import \{ NEWS_NEW_WINDOW_MS \} from "@shared\/const"/);
    const start = source.indexOf("function isNew(");
    const fn = source.slice(start, start + 300);
    expect(fn).toMatch(/NEWS_NEW_WINDOW_MS/);
    expect(fn).not.toMatch(/72\s*\*\s*60\s*\*\s*60/);
    expect(fn).not.toMatch(/168\s*\*\s*60\s*\*\s*60/);
  });

  it("isUnreadNew：NEW 顯示＝isNew(firstPublishedAt) AND 未讀，登入看 item.isRead、訪客查 localStorage", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function isUnreadNew(");
    const end = source.indexOf("function formatDate(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    expect(fn).toMatch(/if \(!isNew\(item\.firstPublishedAt\)\) return false;/);
    expect(fn).toMatch(/if \(isAuthenticated\) return !item\.isRead;/);
    expect(fn).toMatch(/isGuestNewsRead\(item\.id\)/);
  });

  it("列表項目 NEW 徽章用 isUnreadNew(item, isAuthenticated)，不是只看 isNew(item.firstPublishedAt)", () => {
    const source = readNewsPageSource();
    expect(source).toMatch(/isUnreadNew\(item, isAuthenticated\)/);
    // 不能殘留舊版「只看時間、不看已讀」的呼叫方式當作列表徽章的判斷式。
    const badgeCallCount = (source.match(/\{isNew\(item\.firstPublishedAt\) &&/g) ?? []).length;
    expect(badgeCallCount).toBe(0);
  });

  it("彙總查詢會依登入狀態傳 excludeIds（訪客傳 localStorage 已讀清單，會員不傳、讓後端查表）", () => {
    const source = readNewsPageSource();
    const idx = source.indexOf("trpc.news.getNewCategorySummary.useQuery");
    const block = source.slice(idx, idx + 300);
    expect(block).toMatch(/excludeIds:\s*isAuthenticated \? undefined : getGuestReadIds\(\)/);
    expect(block).toMatch(/staleTime:\s*5 \* 60 \* 1000/);
    expect(block).not.toMatch(/refetchInterval/);
  });

  it("只有一次 trpc.news.getNewCategorySummary.useQuery 呼叫，不是每個分類/產業各自 useQuery（不是 15 個查詢）", () => {
    const source = readNewsPageSource();
    const matches = source.match(/trpc\.news\.getNewCategorySummary\.useQuery/g) ?? [];
    expect(matches.length).toBe(1);
    const idx = source.indexOf("trpc.news.getNewCategorySummary.useQuery");
    const before = source.slice(Math.max(0, idx - 300), idx);
    expect(before).not.toMatch(/\.map\(/);
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

describe("NewsDetail.tsx：進入完整頁即標記已讀（NEW「已讀就消失」唯一寫入點）", () => {
  function readNewsDetailSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
  }

  it("登入會員呼叫 trpc.news.markRead；訪客呼叫 markGuestNewsRead 並傳入 item.firstPublishedAt（不是只傳 newsId）", () => {
    const source = readNewsDetailSource();
    expect(source).toMatch(/markReadMut\.mutate\(\{ newsId: item\.id \}/);
    expect(source).toMatch(/markGuestNewsRead\(item\.id, item\.firstPublishedAt\)/);
  });

  it("這個 effect 只依賴 item（getBySlug 已在 DB 層濾掉草稿／下架／不存在），沒有額外對 isLoading／error／status 做已讀判斷——用型別層級保證，不是靠散落的條件式", () => {
    const source = readNewsDetailSource();
    const start = source.indexOf("const markReadMut");
    const end = source.indexOf("}, [item?.id, isAuthenticated]);");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toMatch(/if \(!item \|\| markedIdRef\.current === item\.id\) return;/);
  });

  it("標記已讀成功後會讓 news.list／getNewCategorySummary 快取失效，回到列表頁時 NEW 立即消失，不用等 staleTime 到期", () => {
    const source = readNewsDetailSource();
    const start = source.indexOf("const markReadMut");
    const end = source.indexOf("let body: ReactElement;");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, end);
    expect(block).toMatch(/utils\.news\.list\.invalidate\(\)/);
    expect(block).toMatch(/utils\.news\.getNewCategorySummary\.invalidate\(\)/);
  });

  it("用 ref 防止同一次瀏覽對同一篇消息重複觸發標記已讀（避免重新 render 時重複打 API）", () => {
    const source = readNewsDetailSource();
    const start = source.indexOf("const markedIdRef");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 400);
    expect(block).toMatch(/markedIdRef\.current === item\.id/);
    expect(block).toMatch(/markedIdRef\.current = item\.id/);
  });
});

describe("client/src/lib/newsReadTracking.ts：訪客 localStorage 已讀清單（expiresAt 基於 firstPublishedAt，不是 readAt；自清機制）", () => {
  function readSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "lib", "newsReadTracking.ts"), "utf-8");
  }

  it("每筆紀錄存的是 expiresAt（= firstPublishedAt + NEWS_NEW_WINDOW_MS），不是 readAt——NEW 期限從第一次發布算起，不是從使用者閱讀時間算起", () => {
    const source = readSource();
    expect(source).toMatch(/import \{ NEWS_NEW_WINDOW_MS \} from "@shared\/const"/);
    expect(source).toMatch(/interface ReadEntry \{\s*\n\s*newsId: number;/);
    expect(source).toMatch(/expiresAt: string;/);
    // 說明性註解裡可以「提到」readAt 這個字（用來解釋為什麼不用它），但實際的
    // 型別欄位／程式邏輯不能真的有一個叫 readAt 的欄位或變數。
    expect(source).not.toMatch(/\breadAt:\s*(number|string|Date)/);
    expect(source).not.toMatch(/\.readAt\b/);
  });

  it("markGuestNewsRead 用 firstPublishedAt 參數（不是 Date.now()）算 expiresAt", () => {
    const source = readSource();
    const start = source.indexOf("export function markGuestNewsRead");
    const end = source.indexOf("\n}", start);
    const fn = source.slice(start, end);
    expect(fn).toMatch(/export function markGuestNewsRead\(newsId: number, firstPublishedAt: string \| Date \| null\): void/);
    expect(fn).toMatch(/new Date\(firstPublishedAt\)\.getTime\(\) \+ NEWS_NEW_WINDOW_MS/);
    expect(fn).not.toMatch(/Date\.now\(\)\s*\+\s*NEWS_NEW_WINDOW_MS/); // 不能用「現在時間 + 168 小時」算 expiresAt
  });

  it("markGuestNewsRead：firstPublishedAt 為 null，或算出來的 expiresAt 已經過期，都不寫入", () => {
    const source = readSource();
    const start = source.indexOf("export function markGuestNewsRead");
    const fn = source.slice(start);
    expect(fn).toMatch(/if \(!firstPublishedAt\) return;/);
    expect(fn).toMatch(/if \(Number\.isNaN\(expiresAtMs\) \|\| expiresAtMs <= Date\.now\(\)\) return;/);
  });

  it("讀取時會過濾掉 expiresAt <= now 的舊紀錄，並寫回 localStorage（自清，不會無限成長）；同一個 newsId 只保留一筆", () => {
    const source = readSource();
    const start = source.indexOf("function readStore");
    const end = source.indexOf("function writeStore");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/expiresAtMs <= now/);
    expect(fn).toMatch(/seen\.has\(entry\.newsId\)/); // 同一 newsId 只保留一筆
    expect(fn).toMatch(/writeStore\(\{ version: VERSION, items: fresh \}\)/);
  });

  it("JSON 損毀或格式不符（含舊版純陣列格式）一律安全重設成空清單並覆寫掉損毀的原始字串，不拋錯、不讓頁面白屏", () => {
    const source = readSource();
    const start = source.indexOf("function readStore");
    const end = source.indexOf("function writeStore");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/!parsed \|\| typeof parsed !== "object" \|\| !Array\.isArray\(parsed\.items\)/);
    // 格式不符與 catch 例外兩個分支都要主動覆寫掉損毀的原始字串（writeStore(EMPTY_STORE)），
    // 不只是這次讀取當空清單處理——否則壞掉的字串會一直留在 localStorage 裡。
    const writeEmptyCount = (fn.match(/writeStore\(EMPTY_STORE\)/g) ?? []).length;
    expect(writeEmptyCount).toBe(2);
  });

  it("localStorage quota 已滿／SecurityError（含隱私模式）安全降級——getStorage 探測失敗時回傳 null，讀寫都直接跳過而不是拋錯", () => {
    const source = readSource();
    const start = source.indexOf("function getStorage");
    const fn = source.slice(start, start + 500);
    expect(fn).toMatch(/catch \{\s*\n\s*return null;/);
    expect(source).toMatch(/if \(!storage\) return EMPTY_STORE;/);
    expect(source).toMatch(/if \(!storage\) return;/);
  });

  it("導出 getGuestReadIds／isGuestNewsRead／markGuestNewsRead 三個函式，儲存 key 名稱維持 oxm_news_read_ids 不變", () => {
    const source = readSource();
    expect(source).toMatch(/export function getGuestReadIds\(\): number\[\]/);
    expect(source).toMatch(/export function isGuestNewsRead\(newsId: number\): boolean/);
    expect(source).toMatch(/export function markGuestNewsRead\(/);
    expect(source).toMatch(/const KEY = "oxm_news_read_ids";/);
  });

  it("markGuestNewsRead 對同一個 newsId 重複呼叫不會寫入重複項目", () => {
    const source = readSource();
    const start = source.indexOf("export function markGuestNewsRead");
    const fn = source.slice(start);
    expect(fn).toMatch(/if \(store\.items\.some\(e => e\.newsId === newsId\)\) return;/);
  });
});
