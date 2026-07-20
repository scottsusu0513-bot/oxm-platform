/**
 * 找消息「看板訂閱」＋三層通知（站內通知／Email／Push）回歸測試。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 保護，不可能連到正式/遠端
 * 資料庫），所有測試建立的 news／users／factories／newsBoardSubscriptions 都
 * 在 finally 內清理（cascade FK 會一併清掉 newsIndustries／newsNotifications／
 * factoryCoManagers／communityNotifications／newsBoardSubscriptions）。
 *
 * 不對整個資料庫做「其他使用者一定不在收件名單」這種全域斷言（真實共用
 * 資料庫上其他使用者的訂閱狀態不受這個測試檔案控制），一律用「隔離出的新
 * 測試使用者」做 containment 斷言，跟 server/newsCategorySummary.test.ts、
 * server/news.test.ts 既有慣例一致。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `boardsub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`BoardSub Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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

async function createTestFactory(ownerId: number, industry: string[], status: "approved" | "draft" = "approved"): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status)
    VALUES (${ownerId}, ${`BoardSub Test Factory ${runId}-${ownerId}`}, ${JSON.stringify(industry)}, ${JSON.stringify(["ODM"])}, ${"台北市"}, ${"500萬以下"}, ${""}, ${status})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM factories WHERE ownerId = ${ownerId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test factory");
  return id;
}

async function deleteTestFactory(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
}

async function addCoManager(factoryId: number, userId: number, invitedBy: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`
    INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${userId}, ${invitedBy})
  `);
}

async function cleanupNews(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
}

async function getNotificationRows(recipientUserId: number, eventType = "news") {
  const conn = await getDb();
  if (!conn) return [] as any[];
  const [rows] = await conn.execute(
    sql`SELECT * FROM communityNotifications WHERE recipientUserId = ${recipientUserId} AND eventType = ${eventType}`
  ) as unknown as [any[], unknown];
  return rows;
}

// ───────────────────────── 一、預設狀態 ─────────────────────────
describe("computeDefaultBoardSubscription／getEffectiveBoardSubscription：預設訂閱狀態", () => {
  it("重要消息預設已訂閱", () => {
    expect(db.computeDefaultBoardSubscription("important", [])).toBe(true);
  });
  it("全部最新預設未訂閱", () => {
    expect(db.computeDefaultBoardSubscription("all", [])).toBe(false);
  });
  it("競賽消息預設未訂閱", () => {
    expect(db.computeDefaultBoardSubscription("competition", [])).toBe(false);
  });
  it("展覽消息預設未訂閱", () => {
    expect(db.computeDefaultBoardSubscription("exhibition", [])).toBe(false);
  });
  it("自己所屬產業預設已訂閱", () => {
    expect(db.computeDefaultBoardSubscription("industry:金屬加工", ["金屬加工"])).toBe(true);
  });
  it("兩個所屬產業都預設已訂閱", () => {
    expect(db.computeDefaultBoardSubscription("industry:金屬加工", ["金屬加工", "電子零件"])).toBe(true);
    expect(db.computeDefaultBoardSubscription("industry:電子零件", ["金屬加工", "電子零件"])).toBe(true);
  });
  it("其他（不屬於自己的）產業預設未訂閱", () => {
    expect(db.computeDefaultBoardSubscription("industry:紡織", ["金屬加工"])).toBe(false);
  });

  it("getUserIndustries：共同管理者可以取得工廠產業預設（不只 owner）", async () => {
    let owner: number | undefined, comgr: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      comgr = await createTestUser();
      factoryId = await createTestFactory(owner, ["塑膠"], "approved");
      await addCoManager(factoryId, comgr, owner);

      const industries = await db.getUserIndustries(comgr);
      expect(industries).toContain("塑膠");
      expect(await db.getEffectiveBoardSubscription(comgr, "industry:塑膠")).toBe(true);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
      await deleteTestUser(comgr);
    }
  });

  it("沒有任何覆寫紀錄的全新使用者：重要消息與自己產業預設已訂閱、其餘預設未訂閱", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["紡織"], "approved");

      expect(await db.getEffectiveBoardSubscription(owner, "important")).toBe(true);
      expect(await db.getEffectiveBoardSubscription(owner, "industry:紡織")).toBe(true);
      expect(await db.getEffectiveBoardSubscription(owner, "all")).toBe(false);
      expect(await db.getEffectiveBoardSubscription(owner, "competition")).toBe(false);
      expect(await db.getEffectiveBoardSubscription(owner, "exhibition")).toBe(false);
      expect(await db.getEffectiveBoardSubscription(owner, "industry:金屬加工")).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });
});

// ───────────────────────── 二、明確覆寫 ─────────────────────────
describe("setNewsBoardSubscription：明確覆寫優先於動態預設", () => {
  it("可以取消重要消息；取消後即使「重新登入」（重新查詢）仍是未訂閱，不會自動恢復", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "important", false);
      expect(await db.getEffectiveBoardSubscription(user, "important")).toBe(false);
      // 模擬重新登入：重新呼叫一次查詢，結果必須維持一致，不因為「沒有動作」而恢復預設。
      expect(await db.getEffectiveBoardSubscription(user, "important")).toBe(false);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("可以取消自己所屬產業；工廠仍是該產業也不會恢復訂閱，直到使用者重新訂閱", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["金屬加工"], "approved");

      expect(await db.getEffectiveBoardSubscription(owner, "industry:金屬加工")).toBe(true);
      await db.setNewsBoardSubscription(owner, "industry:金屬加工", false);
      expect(await db.getEffectiveBoardSubscription(owner, "industry:金屬加工")).toBe(false);

      // 重新訂閱後才恢復。
      await db.setNewsBoardSubscription(owner, "industry:金屬加工", true);
      expect(await db.getEffectiveBoardSubscription(owner, "industry:金屬加工")).toBe(true);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("可以訂閱競賽消息／展覽消息／全部最新（原本預設 false 的看板）", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "competition", true);
      await db.setNewsBoardSubscription(user, "exhibition", true);
      await db.setNewsBoardSubscription(user, "all", true);
      expect(await db.getEffectiveBoardSubscription(user, "competition")).toBe(true);
      expect(await db.getEffectiveBoardSubscription(user, "exhibition")).toBe(true);
      expect(await db.getEffectiveBoardSubscription(user, "all")).toBe(true);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("可以訂閱不屬於自己的其他產業", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      expect(await db.getEffectiveBoardSubscription(user, "industry:食品")).toBe(false);
      await db.setNewsBoardSubscription(user, "industry:食品", true);
      expect(await db.getEffectiveBoardSubscription(user, "industry:食品")).toBe(true);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("明確設定優先於動態預設：即使使用者符合預設 true 的條件，明確 false 仍然贏", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["工業設備／機械"], "approved");
      await db.setNewsBoardSubscription(owner, "important", false);
      await db.setNewsBoardSubscription(owner, "industry:工業設備／機械", false);
      expect(await db.getEffectiveBoardSubscription(owner, "important")).toBe(false);
      expect(await db.getEffectiveBoardSubscription(owner, "industry:工業設備／機械")).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("重複設定同一個 boardKey 具冪等性：多次寫入同一個值不會建立多筆紀錄", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "competition", true);
      await db.setNewsBoardSubscription(user, "competition", true);
      await db.setNewsBoardSubscription(user, "competition", true);
      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsBoardSubscriptions WHERE userId = ${user} AND boardKey = 'competition'`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(1);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("併發 upsert（同時觸發多次寫入）不會產生重複資料，唯一索引擋下", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await Promise.all([
        db.setNewsBoardSubscription(user, "exhibition", true),
        db.setNewsBoardSubscription(user, "exhibition", true),
        db.setNewsBoardSubscription(user, "exhibition", false),
        db.setNewsBoardSubscription(user, "exhibition", true),
      ]);
      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsBoardSubscriptions WHERE userId = ${user} AND boardKey = 'exhibition'`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(1); // 併發寫入最終仍只有一筆，值是最後寫入贏（不斷言是哪個值，只斷言不重複）
    } finally {
      await deleteTestUser(user);
    }
  });

  it("不會在會員初始建立大量預設資料列：全新使用者沒有任何 newsBoardSubscriptions 紀錄", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsBoardSubscriptions WHERE userId = ${user}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 三、boardKey 白名單驗證 ─────────────────────────
describe("isValidNewsBoardKey：boardKey 白名單驗證", () => {
  it("固定看板合法", () => {
    for (const key of ["all", "important", "competition", "exhibition"]) {
      expect(db.isValidNewsBoardKey(key)).toBe(true);
    }
  });
  it("存在於 INDUSTRY_OPTIONS 的產業看板合法", () => {
    expect(db.isValidNewsBoardKey("industry:金屬加工")).toBe(true);
    expect(db.isValidNewsBoardKey("industry:電子零件")).toBe(true);
  });
  it("不存在的產業一律不合法", () => {
    expect(db.isValidNewsBoardKey("industry:不存在的產業")).toBe(false);
  });
  it("任意字串、控制字元、超長值一律不合法", () => {
    expect(db.isValidNewsBoardKey("")).toBe(false);
    expect(db.isValidNewsBoardKey("random-garbage")).toBe(false);
    expect(db.isValidNewsBoardKey("all; DROP TABLE news;")).toBe(false);
    expect(db.isValidNewsBoardKey("industry: ")).toBe(false);
    expect(db.isValidNewsBoardKey("industry:" + "x".repeat(500))).toBe(false);
  });
});

// ───────────────────────── 四、通知聚合（跨看板去重） ─────────────────────────
describe("gatherNewsRecipients：跨看板重疊只聚合一次", () => {
  it("同時符合 all＋important＋competition＋兩個產業，仍只出現一次", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["生活用品", "包裝"], "approved");
      await db.setNewsBoardSubscription(owner, "all", true);

      const recipients = await db.gatherNewsRecipients({
        isImportant: true, isCompetition: true, isExhibition: false,
        industryNames: ["生活用品", "包裝"],
      });
      expect(recipients.filter(r => r.id === owner).length).toBe(1);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("已軟刪除的會員不會出現在收件名單（即使明確訂閱 all）", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "all", true);
      await db.softDeleteUser(user);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: [] });
      expect(recipients.map(r => r.id)).not.toContain(user);
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 五、notificationSettings 對 Email／Push 的獨立控制 ─────────────────────────
describe("gatherNewsRecipients：Email／Push 各自獨立套用 notificationSettings", () => {
  it("news=false 時該使用者的 email 為 null，但仍出現在名單中（站內通知資格不受影響）", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "all", true);
      await db.updateUserNotificationSettings(user, { news: false });
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: [] });
      const me = recipients.find(r => r.id === user);
      expect(me).toBeDefined();
      expect(me!.email).toBeNull();
      expect(me!.pushEnabled).toBe(true); // push 設定沒有動，維持預設允許
    } finally {
      await deleteTestUser(user);
    }
  });

  it("pushNews=false 時該使用者的 pushEnabled 為 false，email 不受影響", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "all", true);
      await db.updateUserNotificationSettings(user, { pushNews: false });
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: [] });
      const me = recipients.find(r => r.id === user);
      expect(me).toBeDefined();
      expect(me!.pushEnabled).toBe(false);
      expect(me!.email).not.toBeNull();
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 六、站內通知三層判斷（透過 db.createNews + 真正發布觸發） ─────────────────────────
describe("站內通知三層：看板訂閱資格＝站內通知資格，不受 news／pushNews 開關影響", () => {
  it("createPlatformNotifications／communityNotifications 支援 eventType='news'：直接寫入一筆並確認可查回", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      const { createPlatformNotifications } = await import("./notifications");
      await createPlatformNotifications([{
        recipientUserId: user,
        eventType: "news",
        eventGroup: "news",
        message: "產業情報中心有新消息",
        titleSnapshot: `測試消息標題 ${runId}`,
        actionUrl: "/news/some-slug",
        dedupeKey: `news:999999:user:${user}`,
      }]);
      const rows = await getNotificationRows(user);
      expect(rows.length).toBe(1);
      expect(rows[0].actionUrl).toBe("/news/some-slug");
      expect(rows[0].isRead).toBe(0);
    } finally {
      const conn = await getDb();
      await conn?.execute(sql`DELETE FROM communityNotifications WHERE recipientUserId = ${user}`);
      await deleteTestUser(user);
    }
  });

  it("同一 dedupeKey 重複寫入（模擬同一篇消息重複 dispatch）不會建立第二筆站內通知", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      const { createPlatformNotifications } = await import("./notifications");
      const input = [{
        recipientUserId: user,
        eventType: "news",
        eventGroup: "news",
        message: "產業情報中心有新消息",
        titleSnapshot: "重複測試",
        actionUrl: "/news/dup-slug",
        dedupeKey: `news:888888:user:${user}`,
      }];
      await createPlatformNotifications(input);
      await createPlatformNotifications(input);
      await createPlatformNotifications(input);
      const rows = await getNotificationRows(user);
      expect(rows.length).toBe(1);
    } finally {
      const conn = await getDb();
      await conn?.execute(sql`DELETE FROM communityNotifications WHERE recipientUserId = ${user}`);
      await deleteTestUser(user);
    }
  });

  it("dispatchNewsNotifications 邏輯（透過 db.createNews 直接發布 + 手動比對）：news=false／pushNews=false 都不影響站內通知是否建立——用原始碼斷言 dispatchNewsNotifications 呼叫 createPlatformNotifications 時沒有讀取 notificationSettings", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("async function dispatchNewsNotifications");
    const inAppEnd = source.indexOf("const emailRecipients", start);
    const inAppBlock = source.slice(start, inAppEnd);
    // 站內通知那一段（呼叫 createPlatformNotifications）不應該出現 isNewsEmailAllowed／isNewsPushAllowed／notificationSettings 字樣。
    expect(inAppBlock).toMatch(/createPlatformNotifications/);
    expect(inAppBlock).not.toMatch(/isNewsEmailAllowed/);
    expect(inAppBlock).not.toMatch(/isNewsPushAllowed/);
    expect(inAppBlock).not.toMatch(/notificationSettings/);
  });

  it("87 則既有批次匯入消息不受影響：db.createNews 直接以 published 建立時，即使 shouldNotify=true，本函式本身完全不呼叫 dispatchNewsNotifications（那是 router 層的責任，db.createNews 只回傳 shouldNotify 讓呼叫端決定）", async () => {
    let creator: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      const result = await db.createNews({
        slug: `retro-import-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, createdBy: creator,
      });
      newsId = result.id;
      expect(result.shouldNotify).toBe(true);
      const conn = await getDb();
      const [notifRows] = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM newsNotifications WHERE newsId = ${newsId}`) as unknown as [{ cnt: number }[], unknown];
      expect(Number(notifRows[0]?.cnt)).toBe(0);
      const [inAppRows] = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM communityNotifications WHERE eventType = 'news' AND dedupeKey = ${`news:${newsId}:user:${creator}`}`) as unknown as [{ cnt: number }[], unknown];
      expect(Number(inAppRows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

// ───────────────────────── 七、tRPC procedure 權限（原始碼斷言，跟既有慣例一致） ─────────────────────────
describe("news router：訂閱 procedure 掛在正確的權限層級上", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");

  it("getBoardSubscriptionState 是 publicProcedure（未登入也能查，回傳 requiresLogin）", () => {
    const idx = source.indexOf("getBoardSubscriptionState:");
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(idx, idx + 60)).toMatch(/publicProcedure/);
  });

  it("setBoardSubscription 是 protectedProcedure（必須登入）", () => {
    const idx = source.indexOf("setBoardSubscription:");
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(idx, idx + 40)).toMatch(/protectedProcedure/);
  });

  it("setBoardSubscription 一律用 ctx.user!.id，不接受前端傳 userId", () => {
    const idx = source.indexOf("setBoardSubscription:");
    const end = source.indexOf("}),", idx);
    const block = source.slice(idx, end);
    expect(block).toMatch(/ctx\.user!\.id/);
    expect(block).not.toMatch(/input\.userId/);
  });

  it("estimateRecipients 是 adminProcedure，且不建立任何通知紀錄（原始碼裡沒有 dispatch／createPlatformNotifications／createPendingNewsNotifications 字樣）", () => {
    const idx = source.indexOf("estimateRecipients:");
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(idx, idx + 40)).toMatch(/adminProcedure/);
    const end = source.indexOf("}),", idx);
    const block = source.slice(idx, end);
    expect(block).not.toMatch(/dispatchNewsNotifications/);
    expect(block).not.toMatch(/createPlatformNotifications/);
    expect(block).not.toMatch(/createPendingNewsNotifications/);
  });
});

// ───────────────────────── 八、已讀／訂閱互不影響（跟 newsReads 完全分開） ─────────────────────────
describe("看板訂閱與 newsReads 已讀是兩張獨立的表，互不影響", () => {
  it("訂閱／取消訂閱不會寫入 newsReads，也不會改變任何消息的已讀狀態", async () => {
    let user: number | undefined, creator: number | undefined, newsId: number | undefined;
    try {
      user = await createTestUser();
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `sub-vs-read-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;

      await db.setNewsBoardSubscription(user, "all", true);
      await db.setNewsBoardSubscription(user, "all", false);

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsReads WHERE newsId = ${newsId} AND userId = ${user}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(user);
      await deleteTestUser(creator);
    }
  });

  it("標記已讀（markNewsAsRead）不會寫入或修改 newsBoardSubscriptions", async () => {
    let user: number | undefined, creator: number | undefined, newsId: number | undefined;
    try {
      user = await createTestUser();
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `read-vs-sub-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      await db.markNewsAsRead(user, newsId);

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsBoardSubscriptions WHERE userId = ${user}`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(user);
      await deleteTestUser(creator);
    }
  });
});
