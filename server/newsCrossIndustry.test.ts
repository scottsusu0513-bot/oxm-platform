/**
 * 「跨產業資訊」看板（boardKey="cross-industry"）回歸測試。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 保護，不可能連到正式/遠端
 * 資料庫），所有測試建立的 news／users／factories／newsBoardSubscriptions 都
 * 在 finally 內清理。跟既有 server/newsBoardSubscription.test.ts、
 * server/news.test.ts 一致：用「隔離出的新測試使用者／新測試消息」做
 * containment 斷言，不對整個共用資料庫做全域斷言。
 *
 * cross-industry 刻意用獨立布林欄位 news.isCrossIndustry（不是塞進
 * newsIndustries），所以收件人聚合、預設訂閱、NEW summary 都跟
 * isCompetition／isExhibition 走同一套邏輯，不是走 industry:<name> 那條路。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `crossind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`CrossInd Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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
    VALUES (${ownerId}, ${`CrossInd Test Factory ${runId}-${ownerId}`}, ${JSON.stringify(industry)}, ${JSON.stringify(["ODM"])}, ${"台北市"}, ${"500萬以下"}, ${""}, ${status})
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

// ───────────────────────── 一、boardKey 白名單 ─────────────────────────
describe("isValidNewsBoardKey：cross-industry 是合法固定看板", () => {
  it("cross-industry 通過白名單驗證", () => {
    expect(db.isValidNewsBoardKey("cross-industry")).toBe(true);
  });
});

// ───────────────────────── 二、預設訂閱一律 false ─────────────────────────
describe("cross-industry 預設訂閱：任何會員一律 false，不受所屬產業影響", () => {
  it("computeDefaultBoardSubscription：不論傳入哪些 userIndustries 都回傳 false", () => {
    expect(db.computeDefaultBoardSubscription("cross-industry", [])).toBe(false);
    expect(db.computeDefaultBoardSubscription("cross-industry", ["金屬加工"])).toBe(false);
    expect(db.computeDefaultBoardSubscription("cross-industry", ["金屬加工", "電子零件", "紡織"])).toBe(false);
  });

  it("一般會員（沒有任何工廠）預設未訂閱", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      expect(await db.getEffectiveBoardSubscription(user, "cross-industry")).toBe(false);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("單一產業工廠 owner 預設未訂閱", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["金屬加工"], "approved");
      expect(await db.getEffectiveBoardSubscription(owner, "cross-industry")).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("多產業工廠 owner（同時屬於多個產業）依然預設未訂閱", async () => {
    let owner: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["金屬加工", "電子零件", "塑膠"], "approved");
      expect(await db.getEffectiveBoardSubscription(owner, "cross-industry")).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("共同管理者（屬於工廠但非 owner）預設未訂閱", async () => {
    let owner: number | undefined, comgr: number | undefined, factoryId: number | undefined;
    try {
      owner = await createTestUser();
      comgr = await createTestUser();
      factoryId = await createTestFactory(owner, ["食品"], "approved");
      const conn = await getDb();
      await conn!.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${comgr}, ${owner})`);
      expect(await db.getEffectiveBoardSubscription(comgr, "cross-industry")).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
      await deleteTestUser(comgr);
    }
  });
});

// ───────────────────────── 三、主動訂閱／取消訂閱 ─────────────────────────
describe("cross-industry：主動訂閱後才變 true，取消後恢復 false", () => {
  it("明確訂閱後 getEffectiveBoardSubscription 回傳 true", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      expect(await db.getEffectiveBoardSubscription(user, "cross-industry")).toBe(false);
      await db.setNewsBoardSubscription(user, "cross-industry", true);
      expect(await db.getEffectiveBoardSubscription(user, "cross-industry")).toBe(true);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("取消訂閱後恢復 false，且不再收到未來消息通知資格", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "cross-industry", true);
      expect(await db.getEffectiveBoardSubscription(user, "cross-industry")).toBe(true);

      await db.setNewsBoardSubscription(user, "cross-industry", false);
      expect(await db.getEffectiveBoardSubscription(user, "cross-industry")).toBe(false);

      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: true, industryNames: [] });
      expect(recipients.map(r => r.id)).not.toContain(user);
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 四、收件人聚合／去重 ─────────────────────────
describe("gatherNewsRecipients：isCrossIndustry 只有明確訂閱者符合資格", () => {
  it("沒有訂閱任何看板的一般使用者，不會被純跨產業消息納入", async () => {
    let bystander: number | undefined;
    try {
      bystander = await createTestUser();
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: true, industryNames: [] });
      expect(recipients.map(r => r.id)).not.toContain(bystander);
    } finally {
      await deleteTestUser(bystander);
    }
  });

  it("明確訂閱 cross-industry 的使用者會被納入", async () => {
    let subscriber: number | undefined;
    try {
      subscriber = await createTestUser();
      await db.setNewsBoardSubscription(subscriber, "cross-industry", true);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: true, industryNames: [] });
      expect(recipients.map(r => r.id)).toContain(subscriber);
    } finally {
      await deleteTestUser(subscriber);
    }
  });

  it("重要消息＋cross-industry 同時成立時，同一使用者只出現一次（userId 去重）", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser(); // 一般有效會員：重要消息預設會納入
      await db.setNewsBoardSubscription(user, "cross-industry", true); // 也明確訂閱跨產業資訊
      const recipients = await db.gatherNewsRecipients({ isImportant: true, isCompetition: false, isExhibition: false, isCrossIndustry: true, industryNames: [] });
      const matches = recipients.filter(r => r.id === user);
      expect(matches.length).toBe(1);
    } finally {
      await deleteTestUser(user);
    }
  });

  it("已軟刪除的會員即使明確訂閱 cross-industry，也不出現在收件名單", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "cross-industry", true);
      await db.softDeleteUser(user);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, isCrossIndustry: true, industryNames: [] });
      expect(recipients.map(r => r.id)).not.toContain(user);
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 五、公開列表／NEW summary ─────────────────────────
describe("listPublicNews：category=cross-industry 只回傳 isCrossIndustry=true 的消息", () => {
  it("純跨產業消息出現在 cross-industry 分類，不出現在 all 以外的其他固定分類", async () => {
    let creator: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-list-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCrossIndustry: true, createdBy: creator,
      })).id;

      const crossList = await db.listPublicNews({ category: "cross-industry" });
      expect(crossList.items.map(i => i.id)).toContain(newsId);

      const importantList = await db.listPublicNews({ category: "important" });
      expect(importantList.items.map(i => i.id)).not.toContain(newsId);
      const competitionList = await db.listPublicNews({ category: "competition" });
      expect(competitionList.items.map(i => i.id)).not.toContain(newsId);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("非跨產業消息不會混入 cross-industry 分類（空看板不混入其他分類消息）", async () => {
    let creator: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-not-tagged-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isImportant: true, createdBy: creator,
      })).id;

      const crossList = await db.listPublicNews({ category: "cross-industry" });
      expect(crossList.items.map(i => i.id)).not.toContain(newsId);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("getNewCategorySummary：crossIndustry 欄位與 industry 父層聚合", () => {
  it("剛發布的純跨產業消息，未讀時 crossIndustry=true，industry 父層也一併 true", async () => {
    let creator: number | undefined, reader: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-new-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCrossIndustry: true, createdBy: creator,
      })).id;

      const summary = await db.getNewCategorySummary({ userId: reader });
      expect(summary.crossIndustry).toBe(true);
      expect(summary.industry).toBe(true); // 父層聚合：跨產業資訊也要讓「產業消息」父層顯示 NEW
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("已讀後 crossIndustry 立即變 false", async () => {
    let creator: number | undefined, reader: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-read-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCrossIndustry: true, createdBy: creator,
      })).id;

      expect((await db.getNewCategorySummary({ userId: reader })).crossIndustry).toBe(true);
      await db.markNewsAsRead(reader, newsId);
      expect((await db.getNewCategorySummary({ userId: reader })).crossIndustry).toBe(false);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("超過 168 小時窗口後 crossIndustry 變 false（即使未讀）", async () => {
    // 用 300 小時（遠遠超過 168 小時門檻，留足安全邊際）而不是貼著邊界的
    // 169 小時：getNewCategorySummary 的 168 小時邊界精確度已經由
    // server/newsCategorySummary.test.ts 用不受任何時區換算影響的原始 SQL
    // （isRowCountedAsRecent）詳細覆蓋，那是所有分類（含 crossIndustry）共用
    // 的同一個 recent 查詢，不需要在這裡重測邊界精度；這裡只需要確認
    // crossIndustry 欄位有跟著這個共用的 recent 結果集合一起變化。
    let creator: number | undefined, reader: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      reader = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-expired-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCrossIndustry: true, createdBy: creator,
      })).id;
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET firstPublishedAt = DATE_SUB(NOW(), INTERVAL 300 HOUR) WHERE id = ${newsId}`);

      expect((await db.getNewCategorySummary({ userId: reader })).crossIndustry).toBe(false);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(reader);
    }
  });

  it("訪客（無 userId）依 excludeIds 排除已讀的跨產業消息", async () => {
    let creator: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `crossind-guest-${runId}`, title: "t", summary: "s", content: "c", status: "published",
        isCrossIndustry: true, createdBy: creator,
      })).id;

      expect((await db.getNewCategorySummary({})).crossIndustry).toBe(true);
      expect((await db.getNewCategorySummary({ excludeIds: [newsId] })).crossIndustry).toBe(false);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

// ───────────────────────── 六、批次補分類不觸發任何通知、不改時間欄位 ─────────────────────────
describe("批次補上 isCrossIndustry 標籤：不建立通知、不改 publishedAt／firstPublishedAt", () => {
  it("對既有已發布消息執行 UPDATE news SET isCrossIndustry=true 不會建立 newsNotifications 或 communityNotifications，且 publishedAt／firstPublishedAt／title 都不變", async () => {
    let creator: number | undefined, newsId: number | undefined;
    try {
      creator = await createTestUser();
      const created = await db.createNews({
        slug: `crossind-backfill-${runId}`, title: "原始標題不得被改動", summary: "s", content: "c", status: "published",
        isImportant: true, createdBy: creator,
      });
      newsId = created.id;
      const before = await db.getNewsById(newsId);

      // 模擬正式 migration 的批次補分類：直接 UPDATE isCrossIndustry，不透過
      // db.updateNews（那支函式的 shouldNotify 邏輯只在 status 變成
      // published 的當下才會是 true，這裡刻意用最貼近真實 migration 腳本的
      // 純 SQL UPDATE 驗證「補分類」這個動作本身不會意外觸發任何通知路徑）。
      const conn = await getDb();
      await conn!.execute(sql`UPDATE news SET isCrossIndustry = true WHERE id = ${newsId}`);

      const after = await db.getNewsById(newsId);
      expect(after!.title).toBe(before!.title);
      expect(after!.publishedAt?.getTime()).toBe(before!.publishedAt?.getTime());
      expect(after!.firstPublishedAt?.getTime()).toBe(before!.firstPublishedAt?.getTime());
      expect(after!.isCrossIndustry).toBe(true);

      const [notifRows] = await conn!.execute(sql`SELECT COUNT(*) as c FROM newsNotifications WHERE newsId = ${newsId}`) as unknown as [{ c: number }[], unknown];
      expect(Number(notifRows[0]?.c)).toBe(0);
      const [inAppRows] = await conn!.execute(sql`SELECT COUNT(*) as c FROM communityNotifications WHERE eventType = 'news' AND dedupeKey LIKE ${`news:${newsId}:%`}`) as unknown as [{ c: number }[], unknown];
      expect(Number(inAppRows[0]?.c)).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

// ───────────────────────── 七、newsBoardSubscriptions／newsReads 互不影響 ─────────────────────────
describe("cross-industry 訂閱與 newsReads 已讀是完全獨立的兩件事", () => {
  it("訂閱／取消訂閱 cross-industry 不會寫入或修改 newsReads", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "cross-industry", true);
      await db.setNewsBoardSubscription(user, "cross-industry", false);
      const conn = await getDb();
      const [rows] = await conn!.execute(sql`SELECT COUNT(*) as c FROM newsReads WHERE userId = ${user}`) as unknown as [{ c: number }[], unknown];
      expect(Number(rows[0]?.c)).toBe(0);
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ───────────────────────── 八、router 層 zod schema／權限（原始碼斷言） ─────────────────────────
describe("news router：category／isCrossIndustry 相關欄位確實存在", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");

  it("news.list 的 category enum 包含 cross-industry", () => {
    const idx = source.indexOf('category: z.enum(["all", "important", "competition", "exhibition"');
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(idx, idx + 120)).toMatch(/"cross-industry"/);
  });

  it("news.create／news.update／estimateRecipients 的 zod schema 都有 isCrossIndustry", () => {
    // news router 底下也有自己的 create／update procedure，但其他 router
    // 命名空間（例如廣告管理）也用了同樣的 "create:" 字面量，indexOf 必須先
    // 定位到 "news: router({" 這個區塊開頭，再往後找，才不會誤中別的 router。
    const newsRouterIdx = source.indexOf("news: router({");
    expect(newsRouterIdx).toBeGreaterThan(-1);

    const createIdx = source.indexOf("create: adminProcedure.input(z.object({", newsRouterIdx);
    const createEnd = source.indexOf("})).mutation", createIdx);
    expect(source.slice(createIdx, createEnd)).toMatch(/isCrossIndustry: z\.boolean/);

    const updateIdx = source.indexOf("update: adminProcedure.input(z.object({", newsRouterIdx);
    const updateEnd = source.indexOf("})).mutation", updateIdx);
    expect(source.slice(updateIdx, updateEnd)).toMatch(/isCrossIndustry: z\.boolean/);

    const estimateIdx = source.indexOf("estimateRecipients: adminProcedure.input(z.object({", newsRouterIdx);
    const estimateEnd = source.indexOf("})).query", estimateIdx);
    expect(source.slice(estimateIdx, estimateEnd)).toMatch(/isCrossIndustry: z\.boolean/);
  });
});
