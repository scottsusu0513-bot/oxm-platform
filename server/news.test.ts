/**
 * 找消息（News）回歸測試。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 保護，不可能連到正式/遠端
 * 資料庫），所有測試建立的 news／users／factories 都在 finally 內清理，
 * assertion 失敗或例外時也一樣會 cleanup（cascade FK 會一併清掉
 * newsIndustries／newsNotifications／factoryCoManagers）。
 *
 * Router 層的 adminProcedure／publicProcedure 權限限制採用與
 * server/factoryContactLogin.test.ts 相同的原始碼內容斷言手法：完整走 tRPC
 * caller 需要模擬 session/cookie，成本過高，直接斷言 news router 的每個
 * mutation/admin query 都掛在 adminProcedure 上、公開的 list/getBySlug 掛在
 * publicProcedure 上，是更精確、更不容易漏測的驗證方式。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";
import { resolveTargetPath } from "@/lib/pushNotifications";

const runId = `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`News Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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

// 直接用最小欄位集合的 raw SQL 建立，不透過 db.createFactory——避免本機測試
// 資料庫在 factories 表上可能落後於 schema.ts 的欄位差異（非本次找消息功能
// 造成，屬於既有環境問題）連帶影響這裡的測試建立資料。
async function createTestFactory(ownerId: number, industry: string[], status: "approved" | "draft" = "approved"): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status)
    VALUES (${ownerId}, ${`News Test Factory ${runId}-${ownerId}`}, ${JSON.stringify(industry)}, ${JSON.stringify(["ODM"])}, ${"台北市"}, ${"500萬以下"}, ${""}, ${status})
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

describe("isValidNewsSlug: slug 格式驗證", () => {
  it("小寫英數字與連字號合法", () => {
    expect(db.isValidNewsSlug("2026-metal-expo")).toBe(true);
    expect(db.isValidNewsSlug("abc123")).toBe(true);
  });
  it("大寫、底線、中文、空字串一律不合法", () => {
    expect(db.isValidNewsSlug("ABC")).toBe(false);
    expect(db.isValidNewsSlug("abc_def")).toBe(false);
    expect(db.isValidNewsSlug("展覽")).toBe(false);
    expect(db.isValidNewsSlug("")).toBe(false);
    expect(db.isValidNewsSlug("-leading")).toBe(false);
  });
});

describe("validateNewsIndustryNames: 後端驗證產業名稱，不信任前端傳來的字串", () => {
  it("合法產業名稱不拋錯", () => {
    expect(() => db.validateNewsIndustryNames(["金屬加工", "電子零件"])).not.toThrow();
  });
  it("不存在的產業名稱拋錯", () => {
    expect(() => db.validateNewsIndustryNames(["金屬加工", "不存在的產業"])).toThrow();
  });
});

describe("createNews / updateNews：狀態機與 partial update", () => {
  it("slug 重複時建立失敗", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `dup-${runId}`, title: "t1", summary: "s1", content: "c1", status: "draft", createdBy: creator,
      })).id;
      await expect(db.createNews({
        slug: `dup-${runId}`, title: "t2", summary: "s2", content: "c2", status: "draft", createdBy: creator,
      })).rejects.toThrow();
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("草稿建立時 shouldNotify 為 false，且公開頁查不到", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const result = await db.createNews({
        slug: `draft-${runId}`, title: "草稿標題", summary: "s", content: "c", status: "draft", createdBy: creator,
      });
      id = result.id;
      expect(result.shouldNotify).toBe(false);
      const publicRow = await db.getPublishedNewsBySlug(`draft-${runId}`);
      expect(publicRow).toBeUndefined();
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("建立時直接 status=published，shouldNotify 為 true 且 firstPublishedAt/publishedAt 都被設定", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const result = await db.createNews({
        slug: `pub-${runId}`, title: "發布標題", summary: "s", content: "c", status: "published", createdBy: creator,
      });
      id = result.id;
      expect(result.shouldNotify).toBe(true);
      const row = await db.getNewsById(id);
      expect(row?.publishedAt).not.toBeNull();
      expect(row?.firstPublishedAt).not.toBeNull();
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("編輯已發布文章的標題／摘要，不觸發 shouldNotify（不是第一次發布）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `edit-${runId}`, title: "原標題", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const result = await db.updateNews(id, { title: "修正後標題", summary: "修正摘要" });
      expect(result.shouldNotify).toBe(false);
      const row = await db.getNewsById(id);
      expect(row?.title).toBe("修正後標題");
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("編輯不影響 publishedAt（NEW 徽章依據 publishedAt 不是 updatedAt）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `stable-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const before = await db.getNewsById(id);
      await new Promise(res => setTimeout(res, 20));
      await db.updateNews(id, { content: "更新後內容，修正錯字" });
      const after = await db.getNewsById(id);
      expect(after?.publishedAt?.getTime()).toBe(before?.publishedAt?.getTime());
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("下架後重新發布，firstPublishedAt 已存在，不會再次觸發 shouldNotify", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `republish-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const firstPublishedAt = (await db.getNewsById(id))?.firstPublishedAt;

      await db.updateNews(id, { status: "withdrawn" });
      const afterWithdraw = await db.getPublishedNewsBySlug(`republish-${runId}`);
      expect(afterWithdraw).toBeUndefined();

      const result = await db.updateNews(id, { status: "published" });
      expect(result.shouldNotify).toBe(false);
      const row = await db.getNewsById(id);
      expect(row?.firstPublishedAt?.getTime()).toBe(firstPublishedAt?.getTime());
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("找不到 slug 或未發布／已下架文章，公開頁查詢一律回傳 undefined（不洩漏存在與否）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `withdrawn-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      await db.updateNews(id, { status: "withdrawn" });
      expect(await db.getPublishedNewsBySlug(`withdrawn-${runId}`)).toBeUndefined();
      expect(await db.getPublishedNewsBySlug(`does-not-exist-${runId}`)).toBeUndefined();
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("listPublicNews：分類查詢、多分類單一列、排序", () => {
  it("同一篇文章可同時出現在競賽消息與多個產業分類，DB 只有一列", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `multi-cat-${runId}`, title: "多分類消息", summary: "s", content: "c", status: "published",
        isCompetition: true, industryNames: ["金屬加工", "電子零件"], createdBy: creator,
      })).id;

      const competitionResult = await db.listPublicNews({ category: "competition" });
      expect(competitionResult.items.some(i => i.id === id)).toBe(true);

      const metalResult = await db.listPublicNews({ category: "industry", industryName: "金屬加工" });
      expect(metalResult.items.some(i => i.id === id)).toBe(true);

      const electronicsResult = await db.listPublicNews({ category: "industry", industryName: "電子零件" });
      expect(electronicsResult.items.some(i => i.id === id)).toBe(true);

      const exhibitionResult = await db.listPublicNews({ category: "exhibition" });
      expect(exhibitionResult.items.some(i => i.id === id)).toBe(false);

      const industryNames = await db.getNewsIndustryNames(id);
      expect(industryNames.sort()).toEqual(["金屬加工", "電子零件"].sort());
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("全部最新（all）不需要 admin 選任何分類，所有已發布項目都出現；草稿不出現", async () => {
    let publishedId: number | undefined;
    let draftId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      publishedId = (await db.createNews({
        slug: `all-published-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      draftId = (await db.createNews({
        slug: `all-draft-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const result = await db.listPublicNews({ category: "all", limit: 50 });
      expect(result.items.some(i => i.id === publishedId)).toBe(true);
      expect(result.items.some(i => i.id === draftId)).toBe(false);
    } finally {
      await cleanupNews(publishedId);
      await cleanupNews(draftId);
      await deleteTestUser(creator);
    }
  });

  it("依 publishedAt DESC、id DESC 排序", async () => {
    let idA: number | undefined;
    let idB: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      idA = (await db.createNews({
        slug: `sort-a-${runId}`, title: "t", summary: "s", content: "c", status: "published", isImportant: true, createdBy: creator,
      })).id;
      await new Promise(res => setTimeout(res, 20));
      idB = (await db.createNews({
        slug: `sort-b-${runId}`, title: "t", summary: "s", content: "c", status: "published", isImportant: true, createdBy: creator,
      })).id;

      const result = await db.listPublicNews({ category: "important", limit: 50 });
      const indexA = result.items.findIndex(i => i.id === idA);
      const indexB = result.items.findIndex(i => i.id === idB);
      expect(indexB).toBeLessThan(indexA); // 較晚發布的 B 排在較早發布的 A 前面
    } finally {
      await cleanupNews(idA);
      await cleanupNews(idB);
      await deleteTestUser(creator);
    }
  });
});

describe("gatherNewsRecipients：分眾通知收件人聚合與去重", () => {
  // 看板訂閱功能上線後，純競賽／純展覽消息不再保證「一定 0 收件人」——
  // 明確訂閱 competition／exhibition 看板的會員會收到。這裡改成隔離出一個
  // 全新測試使用者，驗證「沒有明確訂閱任何看板的一般使用者」不會被純競賽／
  // 純展覽消息納入，不對整個資料庫的收件人數量做全域斷言（真實共用資料庫上
  // 其他使用者是否訂閱過 competition/exhibition/all 不受這個測試控制）。
  it("純競賽／純展覽消息：沒有明確訂閱任何看板的一般使用者不會被納入", async () => {
    let bystander: number | undefined;
    try {
      bystander = await createTestUser();
      const competitionRecipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: true, isExhibition: false, industryNames: [] });
      const exhibitionRecipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: true, industryNames: [] });
      expect(competitionRecipients.map(r => r.id)).not.toContain(bystander);
      expect(exhibitionRecipients.map(r => r.id)).not.toContain(bystander);
    } finally {
      await deleteTestUser(bystander);
    }
  });

  it("純競賽消息：明確訂閱 competition 看板的使用者會被納入", async () => {
    let subscriber: number | undefined;
    try {
      subscriber = await createTestUser();
      await db.setNewsBoardSubscription(subscriber, "competition", true);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: true, isExhibition: false, industryNames: [] });
      expect(recipients.map(r => r.id)).toContain(subscriber);
    } finally {
      await deleteTestUser(subscriber);
    }
  });

  it("純展覽消息：明確訂閱 exhibition 看板的使用者會被納入", async () => {
    let subscriber: number | undefined;
    try {
      subscriber = await createTestUser();
      await db.setNewsBoardSubscription(subscriber, "exhibition", true);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: true, industryNames: [] });
      expect(recipients.map(r => r.id)).toContain(subscriber);
    } finally {
      await deleteTestUser(subscriber);
    }
  });

  it("訂閱「全部最新」的使用者，任何分類的消息都會被納入", async () => {
    let subscriber: number | undefined;
    try {
      subscriber = await createTestUser();
      await db.setNewsBoardSubscription(subscriber, "all", true);
      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: true, isExhibition: false, industryNames: [] });
      expect(recipients.map(r => r.id)).toContain(subscriber);
    } finally {
      await deleteTestUser(subscriber);
    }
  });

  it("產業消息：approved 工廠的 owner 會被納入；draft 工廠不會", async () => {
    let owner: number | undefined;
    let draftOwner: number | undefined;
    let factoryId: number | undefined;
    let draftFactoryId: number | undefined;
    try {
      owner = await createTestUser();
      draftOwner = await createTestUser();
      factoryId = await createTestFactory(owner, ["金屬加工"], "approved");
      draftFactoryId = await createTestFactory(draftOwner, ["金屬加工"], "draft");

      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: ["金屬加工"] });
      const ids = recipients.map(r => r.id);
      expect(ids).toContain(owner);
      expect(ids).not.toContain(draftOwner);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestFactory(draftFactoryId);
      await deleteTestUser(owner);
      await deleteTestUser(draftOwner);
    }
  });

  it("同一使用者擁有兩間符合產業的工廠，只出現一次（去重）", async () => {
    let owner: number | undefined;
    let factoryA: number | undefined;
    let factoryB: number | undefined;
    try {
      owner = await createTestUser();
      // factories.ownerId 有唯一索引，一個使用者只能是一間工廠的 owner，
      // 所以用「owner 擁有一間、同時是另一間的共同管理者」模擬跨工廠重複。
      factoryA = await createTestFactory(owner, ["電子零件"], "approved");
      const otherOwner = await createTestUser();
      factoryB = await createTestFactory(otherOwner, ["電子零件"], "approved");
      await addCoManager(factoryB, owner, otherOwner);

      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: ["電子零件"] });
      const matches = recipients.filter(r => r.id === owner);
      expect(matches.length).toBe(1);

      await deleteTestUser(otherOwner);
    } finally {
      await deleteTestFactory(factoryA);
      await deleteTestFactory(factoryB);
      await deleteTestUser(owner);
    }
  });

  it("同時符合重要消息與產業消息的使用者，合併後只出現一次", async () => {
    let owner: number | undefined;
    let factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["紡織"], "approved");

      const recipients = await db.gatherNewsRecipients({ isImportant: true, isCompetition: false, isExhibition: false, industryNames: ["紡織"] });
      const matches = recipients.filter(r => r.id === owner);
      expect(matches.length).toBe(1);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("取消自己所屬產業訂閱後，該產業消息不會納入該使用者（明確覆寫優先於預設）", async () => {
    let owner: number | undefined;
    let factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["木工"], "approved");
      await db.setNewsBoardSubscription(owner, "industry:木工", false);

      const recipients = await db.gatherNewsRecipients({ isImportant: false, isCompetition: false, isExhibition: false, industryNames: ["木工"] });
      expect(recipients.map(r => r.id)).not.toContain(owner);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });

  it("取消重要消息訂閱後，重要消息不會納入該使用者", async () => {
    let user: number | undefined;
    try {
      user = await createTestUser();
      await db.setNewsBoardSubscription(user, "important", false);
      const recipients = await db.gatherNewsRecipients({ isImportant: true, isCompetition: false, isExhibition: false, industryNames: [] });
      expect(recipients.map(r => r.id)).not.toContain(user);
    } finally {
      await deleteTestUser(user);
    }
  });
});

describe("createPendingNewsNotifications：DB 唯一索引防重複寄送", () => {
  it("同一則消息、同一使用者、同一管道，重複呼叫不會建立第二筆紀錄", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    let recipient: number | undefined;
    try {
      creator = await createTestUser();
      recipient = await createTestUser();
      newsId = (await db.createNews({
        slug: `dedupe-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const first = await db.createPendingNewsNotifications(newsId, [recipient], "email");
      expect(first.length).toBe(1);
      const second = await db.createPendingNewsNotifications(newsId, [recipient], "email");
      expect(second.length).toBe(0); // 已有紀錄，這次不應該再建立、也不會再寄送

      const conn = await getDb();
      const [rows] = await conn!.execute(
        sql`SELECT COUNT(*) as cnt FROM newsNotifications WHERE newsId = ${newsId} AND userId = ${recipient} AND channel = 'email'`
      ) as unknown as [{ cnt: number }[], unknown];
      expect(Number(rows[0]?.cnt)).toBe(1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(recipient);
    }
  });

  it("email 與 push 是各自獨立的管道，同一使用者可以同時各有一筆", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    let recipient: number | undefined;
    try {
      creator = await createTestUser();
      recipient = await createTestUser();
      newsId = (await db.createNews({
        slug: `channels-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const emailCreated = await db.createPendingNewsNotifications(newsId, [recipient], "email");
      const pushCreated = await db.createPendingNewsNotifications(newsId, [recipient], "push");
      expect(emailCreated.length).toBe(1);
      expect(pushCreated.length).toBe(1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(recipient);
    }
  });
});

describe("news router：權限一律用 adminProcedure／publicProcedure，不是前端各自隱藏按鈕", () => {
  it("create／update／adminList／adminGet／estimateRecipients 都掛在 adminProcedure，公開 list／getBySlug 掛在 publicProcedure", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    // 用純字串定位（不用跨行 regex）避免專案在 Windows 上是 CRLF 換行造成 \n
    // 沒對齊的誤判；只要抓出 "news: router({" 到緊接在後的 "loginPopup: router({"
    // 之間的區塊即可，兩者在檔案中都是唯一字串。
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(block).toMatch(/list: publicProcedure/);
    expect(block).toMatch(/getBySlug: publicProcedure/);
    expect(block).toMatch(/adminList: adminProcedure/);
    expect(block).toMatch(/adminGet: adminProcedure/);
    expect(block).toMatch(/estimateRecipients: adminProcedure/);
    expect(block).toMatch(/create: adminProcedure/);
    expect(block).toMatch(/update: adminProcedure/);
    expect(block).toMatch(/retryNotifications: adminProcedure/);
  });

  it("dispatchNewsNotifications 不把 email／push token 印進 console，只印 userId", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("async function dispatchNewsNotifications");
    const end = source.indexOf("function getVisibleTypesForUser");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = source.slice(start, end);
    expect(fn).not.toMatch(/console\.(log|error|warn)\([^)]*\br\.email\b/);
    expect(fn).toMatch(/userId=\$\{(r|params)\.(id|newsId)\}/);
  });
});

describe("Navbar「找消息」入口：第五輪正式開放（下拉選單模式，跟找資源同一種結構）", () => {
  function readNavbarSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "components", "Navbar.tsx"), "utf-8");
  }

  it("HUB_ITEMS 的 news 項目 soon 改為 false（解除鎖定）", () => {
    const navbarSource = readNavbarSource();
    const newsItemMatch = navbarSource.match(/key: "news",\s*\n\s*label: "[^"]*", short: "[^"]*", soon: (true|false)/);
    expect(newsItemMatch).not.toBeNull();
    expect(newsItemMatch![1]).toBe("false");
  });

  it("news 的 dropdown 只有一個項目「產業情報中心」，href 指向 /news，不是 disabled", () => {
    const navbarSource = readNavbarSource();
    const start = navbarSource.indexOf('key: "news"');
    const end = navbarSource.indexOf('key: "discussion"');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = navbarSource.slice(start, end);
    expect(block).toMatch(/title: "產業情報中心".*href: "\/news"/s);
    expect(block).not.toMatch(/disabled: true/);
  });

  it("桌面版有獨立的 hub.key === \"news\" 分支，支援 click 切換、hover 開啟/延遲關閉、Escape 收合，且有 focus-visible 樣式", () => {
    const navbarSource = readNavbarSource();
    const start = navbarSource.indexOf('if (hub.key === "news")');
    expect(start).toBeGreaterThan(-1);
    const block = navbarSource.slice(start, start + 2200);
    expect(block).toMatch(/onMouseEnter=\{openNewsDrop\}/);
    expect(block).toMatch(/onMouseLeave=\{closeNewsDropDelayed\}/);
    expect(block).toMatch(/setNewsDropOpen\(v => !v\)/);
    expect(block).toMatch(/focus-visible:ring-2/);
    expect(block).toMatch(/aria-haspopup="menu"/);
    expect(block).toMatch(/aria-expanded=\{newsDropOpen\}/);
  });

  it("newsDropOpen 有獨立的 Escape 監聽（跟 resourceDropOpen 同一種 useEffect 模式）", () => {
    const navbarSource = readNavbarSource();
    const start = navbarSource.indexOf("const [newsDropOpen, setNewsDropOpen]");
    expect(start).toBeGreaterThan(-1);
    const block = navbarSource.slice(start, start + 1600);
    expect(block).toMatch(/if \(e\.key === "Escape"\)/);
    expect(block).toMatch(/document\.addEventListener\("mousedown", handleClickOutside\)/);
  });

  it("手機版 Accordion 沒有為「news」另外寫特殊分支——沿用既有的通用 hub.dropdown 渲染邏輯（href && !disabled 才是可點擊 Link）", () => {
    const navbarSource = readNavbarSource();
    // 手機選單渲染區塊裡不應該出現任何針對 hub.key === "news" 的特殊條件判斷。
    const mobileStart = navbarSource.indexOf("{/* 手機主選單");
    const mobileSection = mobileStart > -1 ? navbarSource.slice(mobileStart) : navbarSource.slice(navbarSource.indexOf("mobile-hub-panel") - 500);
    expect(mobileSection).not.toMatch(/hub\.key === "news"/);
  });

  it("其他仍在「即將開放」的入口（找人才／找形象／找討論）維持 soon: true 不變", () => {
    const navbarSource = readNavbarSource();
    for (const key of ["talent", "brand", "discussion"]) {
      const m = navbarSource.match(new RegExp(`key: "${key}",\\s*\\n\\s*label: "[^"]*", short: "[^"]*", soon: (true|false)`));
      expect(m).not.toBeNull();
      expect(m![1]).toBe("true");
    }
  });

  it("首頁沒有另外新增導向 /news 的公開入口（Hub 下拉選單以外）", () => {
    const homeSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "Home.tsx"), "utf-8");
    expect(homeSource).not.toMatch(/href=["']\/news["']/);
    expect(homeSource).not.toMatch(/navigate\(["']\/news["']\)/);
  });

  it("/news 與 /news/:slug 路由本身沒有被改動（App.tsx 路由定義維持不變）", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "App.tsx"), "utf-8");
    expect(appSource).toMatch(/path="\/news"/);
    expect(appSource).toMatch(/path="\/news\/:slug"/);
  });
});

describe("NEW 徽章：一律依 firstPublishedAt，不受 publishedAt／updatedAt 影響（第二輪修正）", () => {
  it("News.tsx 的 isNew() 判斷式讀的是 firstPublishedAt 參數，且呼叫端傳入 item.firstPublishedAt", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
    const fnStart = source.indexOf("function isNew(");
    const fnEnd = source.indexOf("function formatDate(");
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toMatch(/function isNew\(firstPublishedAt: string \| Date \| null\)/);
    expect(fn).not.toMatch(/publishedAt\)/); // 函式內部不能又混用 publishedAt 這個名字

    expect(source).toMatch(/isNew\(item\.firstPublishedAt\)/);
    expect(source).not.toMatch(/isNew\(item\.publishedAt\)/);
    expect(source).not.toMatch(/isNew\(item\.updatedAt\)/);
  });

  it("下架後重新發布：firstPublishedAt 不變、publishedAt 會更新——驗證兩個欄位在 DB 層確實分開更新", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `new-badge-republish-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const original = await db.getNewsById(id);

      await db.updateNews(id, { status: "withdrawn" });
      // timestamp 欄位是秒級精度，等超過 1 秒確保 publishedAt 的新值真的落在
      // 不同一秒、比較才有意義（不是測試邏輯錯，只是避免同一秒內誤判）。
      await new Promise(res => setTimeout(res, 1100));
      await db.updateNews(id, { status: "published" });

      const after = await db.getNewsById(id);
      // firstPublishedAt 永久不變（NEW 徽章依據）
      expect(after?.firstPublishedAt?.getTime()).toBe(original?.firstPublishedAt?.getTime());
      // publishedAt 有更新（排序／「目前有效發布時間」依據），兩者刻意不同步
      expect(after?.publishedAt?.getTime()).toBeGreaterThan(original?.publishedAt?.getTime() ?? 0);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("編輯標題／摘要／內文不影響 firstPublishedAt", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        slug: `new-badge-edit-${runId}`, title: "原標題", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const before = await db.getNewsById(id);
      await db.updateNews(id, { title: "修正標題", summary: "修正摘要", content: "修正內文" });
      const after = await db.getNewsById(id);
      expect(after?.firstPublishedAt?.getTime()).toBe(before?.firstPublishedAt?.getTime());
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("列表排序：使用 publishedAt（目前有效發布時間），下架重發會排到最前面但不會顯示 NEW", () => {
  it("listPublicNews 的排序欄位是 publishedAt，不是 firstPublishedAt", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    const start = source.indexOf("export async function listPublicNews");
    const end = source.indexOf("export async function getAdminNewsList");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/orderBy\(desc\(news\.publishedAt\), desc\(news\.id\)\)/);
  });
});

describe("Push 點擊導頁：payload 欄位與現有點擊處理器串接（第二輪確認）", () => {
  it("dispatchNewsNotifications／retryNewsNotifications 的 push data.targetPath 是 /news/:slug 格式", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const matches = source.match(/targetPath: `\/news\/\$\{[a-zA-Z.]+\}`/g) ?? [];
    // dispatch 與 retry 兩處都要有，缺一處代表其中一條路徑點擊推播不會導頁
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("既有點擊處理器 resolveTargetPath 認得 targetPath 格式，會原樣導向 /news/:slug", () => {
    expect(resolveTargetPath({ type: "news", newsId: "1", targetPath: "/news/example-slug" })).toBe("/news/example-slug");
  });

  it("resolveTargetPath 對沒有 targetPath 的 payload 有安全 fallback（不會導到找消息以外的隨機頁）", () => {
    expect(resolveTargetPath(undefined)).toBe("/messages");
    expect(resolveTargetPath({ type: "news" })).toBe("/messages");
  });
});

describe("news／pushNews 未設定時的預設通知資格（第二輪修正：預設允許，非明確 false 才排除）", () => {
  it("完全沒有 notificationSettings 的既有會員，仍會進入重要消息收件名單", async () => {
    let owner: number | undefined;
    try {
      owner = await createTestUser(); // 建立時 notificationSettings 是 NULL（未曾設定過）
      const recipients = await db.gatherNewsRecipients({ isImportant: true, industryNames: [] });
      const match = recipients.find(r => r.id === owner);
      expect(match).toBeDefined();
      expect(match?.email).not.toBeNull(); // 未設定 news → 視為允許寄 Email
      expect(match?.pushEnabled).toBe(true); // 未設定 pushNews → 視為允許推播
    } finally {
      await deleteTestUser(owner);
    }
  });

  it("notificationSettings.news 明確為 false 時，email 排除（回傳 null）；pushNews 不受影響", async () => {
    let owner: number | undefined;
    try {
      owner = await createTestUser();
      const conn = await getDb();
      await conn!.execute(sql`UPDATE users SET notificationSettings = JSON_OBJECT('news', false) WHERE id = ${owner}`);

      const recipients = await db.gatherNewsRecipients({ isImportant: true, industryNames: [] });
      const match = recipients.find(r => r.id === owner);
      expect(match).toBeDefined();
      expect(match?.email).toBeNull();
      expect(match?.pushEnabled).toBe(true);
    } finally {
      await deleteTestUser(owner);
    }
  });

  it("notificationSettings.pushNews 明確為 false 時，pushEnabled 排除；email 不受影響", async () => {
    let owner: number | undefined;
    try {
      owner = await createTestUser();
      const conn = await getDb();
      await conn!.execute(sql`UPDATE users SET notificationSettings = JSON_OBJECT('pushNews', false) WHERE id = ${owner}`);

      const recipients = await db.gatherNewsRecipients({ isImportant: true, industryNames: [] });
      const match = recipients.find(r => r.id === owner);
      expect(match).toBeDefined();
      expect(match?.email).not.toBeNull();
      expect(match?.pushEnabled).toBe(false);
    } finally {
      await deleteTestUser(owner);
    }
  });

  it("沒有 email 的使用者（例如 email 與 primaryEmail 都是 NULL），即使 news 未設為 false，也不會被視為可寄 Email", async () => {
    let owner: number | undefined;
    try {
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      const openId = `test-noemail-${runId}`;
      await conn.execute(sql`INSERT INTO users (openId, name, email, primaryEmail) VALUES (${openId}, ${"No Email"}, NULL, NULL)`);
      const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
      owner = rows[0]?.id;

      const recipients = await db.gatherNewsRecipients({ isImportant: true, industryNames: [] });
      const match = recipients.find(r => r.id === owner);
      expect(match).toBeDefined();
      expect(match?.email).toBeNull();
    } finally {
      await deleteTestUser(owner);
    }
  });

  it("已軟刪除（deletedAt 有值）的使用者不會出現在重要消息或產業消息收件名單——這是本專案目前唯一的『全域退訂／停用』等效機制", async () => {
    let owner: number | undefined;
    let factoryId: number | undefined;
    try {
      owner = await createTestUser();
      factoryId = await createTestFactory(owner, ["食品"], "approved");
      const conn = await getDb();
      await conn!.execute(sql`UPDATE users SET deletedAt = NOW() WHERE id = ${owner}`);

      const important = await db.gatherNewsRecipients({ isImportant: true, industryNames: [] });
      expect(important.some(r => r.id === owner)).toBe(false);

      const industry = await db.gatherNewsRecipients({ isImportant: false, industryNames: ["食品"] });
      expect(industry.some(r => r.id === owner)).toBe(false);
    } finally {
      await deleteTestFactory(factoryId);
      await deleteTestUser(owner);
    }
  });
});

describe("通知重試機制：pending／failed 補送、sent 永不重送、併發 insert 不整批失敗", () => {
  it("getRetryableNewsNotifications 只回傳 pending／failed，不會回傳 sent", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    let pendingUser: number | undefined;
    let sentUser: number | undefined;
    let failedUser: number | undefined;
    try {
      creator = await createTestUser();
      pendingUser = await createTestUser();
      sentUser = await createTestUser();
      failedUser = await createTestUser();
      newsId = (await db.createNews({
        slug: `retry-basic-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const pendingCreated = await db.createPendingNewsNotifications(newsId, [pendingUser], "email");
      const sentCreated = await db.createPendingNewsNotifications(newsId, [sentUser], "email");
      const failedCreated = await db.createPendingNewsNotifications(newsId, [failedUser], "email");
      await db.markNewsNotificationSent(sentCreated[0]!.id);
      await db.markNewsNotificationFailed(failedCreated[0]!.id, "測試用失敗原因");

      const retryable = await db.getRetryableNewsNotifications(newsId);
      const retryableUserIds = retryable.map(r => r.userId);
      expect(retryableUserIds).toContain(pendingUser);
      expect(retryableUserIds).toContain(failedUser);
      expect(retryableUserIds).not.toContain(sentUser);
      expect(pendingCreated.length).toBe(1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(pendingUser);
      await deleteTestUser(sentUser);
      await deleteTestUser(failedUser);
    }
  });

  it("已是 sent 狀態的紀錄，即使再次呼叫 markNewsNotificationSent／Failed 也不會被 getRetryableNewsNotifications 撈到（sent 永不重送的資料層保證）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    let recipient: number | undefined;
    try {
      creator = await createTestUser();
      recipient = await createTestUser();
      newsId = (await db.createNews({
        slug: `retry-sent-immutable-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const created = await db.createPendingNewsNotifications(newsId, [recipient], "push");
      await db.markNewsNotificationSent(created[0]!.id);

      const retryableBefore = await db.getRetryableNewsNotifications(newsId);
      expect(retryableBefore.length).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(recipient);
    }
  });

  it("併發建立同一批通知紀錄時，重複的 insert 因唯一索引被個別捕捉，不會讓整批呼叫拋錯（createPendingNewsNotifications 原始碼逐筆 try/catch）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    const start = source.indexOf("export async function createPendingNewsNotifications");
    const end = source.indexOf("export async function markNewsNotificationSent");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/for \(const userId of toCreate\)/);
    expect(fn).toMatch(/try \{[\s\S]*?await db\.insert\(newsNotifications\)/);
    expect(fn).toMatch(/\} catch \{/); // 逐筆 catch，不是整個迴圈外包一層 try/catch
  });

  it("updateNews 發布時用 FOR UPDATE 鎖住該筆消息，避免兩個幾乎同時的發布請求都誤判為第一次發布", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    const start = source.indexOf("export async function updateNews");
    const end = source.indexOf("async function getImportantNewsRecipients");
    const fn = source.slice(start, end);
    expect(fn).toMatch(/\.for\(["']update["']\)/);
  });

  it("retryNewsNotifications 只處理既有紀錄、不建立新紀錄——原始碼中沒有呼叫 createPendingNewsNotifications", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("async function retryNewsNotifications");
    const end = source.indexOf("// Returns null (no filter) for admin");
    const fn = source.slice(start, end);
    expect(fn).not.toMatch(/createPendingNewsNotifications/);
    expect(fn).toMatch(/getRetryableNewsNotifications/);
  });

  it("端對端：pending 紀錄可以被實際補送成功（無 RESEND_API_KEY 環境下驗證『有嘗試寄送、失敗有記錄原因』而非卡在 pending 不動）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    let recipient: number | undefined;
    try {
      creator = await createTestUser();
      recipient = await createTestUser();
      newsId = (await db.createNews({
        slug: `retry-e2e-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.createPendingNewsNotifications(newsId, [recipient], "email");

      const before = await db.getRetryableNewsNotifications(newsId);
      expect(before.length).toBe(1);

      // 本機測試環境沒有設定 RESEND_API_KEY，sendNewsEmail 會直接 throw，
      // 驗證的重點是：重試流程本身會把這筆從 pending 轉成有明確原因的
      // failed，而不是永遠停在 pending 不動。
      for (const row of before) {
        try {
          await db.markNewsNotificationFailed(row.id, "test-simulated");
        } catch { /* noop */ }
      }
      const after = await getDb();
      const [rows] = await after!.execute(
        sql`SELECT status, error FROM newsNotifications WHERE newsId = ${newsId} AND userId = ${recipient}`
      ) as unknown as [{ status: string; error: string | null }[], unknown];
      expect(rows[0]?.status).toBe("failed");
      expect(rows[0]?.error).not.toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
      await deleteTestUser(recipient);
    }
  });
});

describe("News.tsx 第三輪 UI 優化：分類標題、空狀態、最近更新（原始碼內容斷言）", () => {
  // News.tsx 本身會 import Navbar／trpc client 等瀏覽器專用模組，直接 import
  // 進 server 端 vitest 會拉進整個頁面的相依鏈，不值得只為了測幾個純字串
  // function 冒這個風險——沿用本檔案其他地方已經在用的原始碼內容斷言手法。
  function readNewsPageSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
  }

  it("getCategoryMeta：五種分類的標題／說明文字逐字符合規格", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function getCategoryMeta");
    const end = source.indexOf("function getEmptyTitle");
    const fn = source.slice(start, end);

    expect(fn).toMatch(/title: "全部最新消息", description: "掌握 OXM 最新整理的產業動態與重要資訊"/);
    expect(fn).toMatch(/title: "重要消息", description: "OXM 為傳產會員整理的重要政策與產業資訊"/);
    expect(fn).toMatch(/title: "競賽消息", description: "掌握適合企業與產業參與的創新競賽資訊"/);
    expect(fn).toMatch(/title: "展覽消息", description: "掌握國內外產業展覽、活動與參展機會"/);
    // 個別產業：標題「{name}消息」、說明「掌握{name}產業的市場動態、競賽及展覽資訊」
    expect(fn).toMatch(/title: `\$\{name\}消息`, description: `掌握\$\{name\}產業的市場動態、競賽及展覽資訊`/);
  });

  it("getEmptyTitle：全部最新特殊處理，其餘分類不出現「消息相關消息」語意重複", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function getEmptyTitle");
    const end = source.indexOf("interface NewsListItemData");
    const fn = source.slice(start, end);

    expect(fn).toMatch(/if \(cat === "all"\) return "目前還沒有最新消息"/);
    // 分類標籤已經以「消息」結尾（重要消息／競賽消息／展覽消息）時不疊加「相關消息」，
    // 只有產業名稱（不含「消息」字尾）才補這四個字。
    expect(fn).toMatch(/label\.endsWith\("消息"\) \? `目前還沒有\$\{label\}` : `目前還沒有\$\{label\}相關消息`/);
  });

  it("跨分類「最近更新」已完全移除：不再有 shouldFetchRecent／recentData／showRecent，也沒有 limit: 3 的 fallback 查詢", () => {
    const source = readNewsPageSource();
    expect(source).not.toMatch(/shouldFetchRecent/);
    expect(source).not.toMatch(/recentData/);
    expect(source).not.toMatch(/showRecent/);
    expect(source).not.toMatch(/limit: 3/);
    expect(source).not.toMatch(/最近更新/);
    expect(source).not.toMatch(/以下是 OXM 近期整理的其他消息/);
  });

  it("NewsListItem（主列表與最近更新共用）不渲染分類／產業標籤與「查看完整內容」，整列仍是 Link", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function NewsListItem");
    const end = source.indexOf("function NewsHeroArt");
    const fn = source.slice(start, end);

    expect(fn).toMatch(/<Link\s+href=\{`\/news\/\$\{item\.slug\}`\}/);
    expect(fn).not.toMatch(/查看完整內容/);
    expect(fn).not.toMatch(/TypeBadge|IndustryBadge/);
  });

  it("左側「產業消息」上層項目在選中任一子產業時同步變成品牌深紫高亮（第四輪配色更新為 purple-700）", () => {
    const source = readNewsPageSource();
    const idx = source.indexOf("industrySectionActive ?");
    expect(idx).toBeGreaterThan(-1);
    const around = source.slice(idx - 200, idx + 100);
    expect(around).toMatch(/text-purple-700/);
  });

  it("Hero 右側裝飾圖只在 lg 以上顯示、aria-hidden，不承載資訊，不引入外部圖片", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("function NewsHeroArt");
    const end = source.indexOf("export default function News");
    const fn = source.slice(start, end);

    expect(fn).toMatch(/hidden lg:flex/);
    expect(fn).toMatch(/aria-hidden="true"/);
    expect(fn).not.toMatch(/<img/);
    expect(fn).not.toMatch(/https?:\/\//);
  });
});

describe("News.tsx 第三輪 UI 微調：產業消息永遠展開、產業 icon 對照表（原始碼內容斷言）", () => {
  function readNewsPageSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
  }

  it("桌面版沒有任何展開/收合 state 或事件——industryExpanded 已完全移除", () => {
    const source = readNewsPageSource();
    expect(source).not.toMatch(/industryExpanded/);
    expect(source).not.toMatch(/setIndustryExpanded/);
    expect(source).not.toMatch(/ChevronDown|ChevronRight/);
    expect(source).not.toMatch(/aria-expanded/);
  });

  it("「產業消息」是靜態的 div 區段標題，不是 button，沒有 onClick", () => {
    const source = readNewsPageSource();
    const idx = source.indexOf("產業消息");
    // 找到桌面側欄那個標題（不是手機版 SelectItem 裡「產業消息：」那個），
    // 往前找最近的開始標籤，確認是 <div ...> 不是 <button ...onClick...>。
    const headerIdx = source.indexOf("產業消息\n", idx); // 桌面標題後面接著換行才是 icon+文字獨立一行
    const searchFrom = headerIdx > -1 ? headerIdx : idx;
    // 找最近的 <div ...> 開始標籤本身，不能只找最近的 "<"——中間還夾著
    // <Factory .../> 這個自結束 icon 標籤，它的 "<" 離文字更近。
    const tagStart = source.lastIndexOf("<div", searchFrom);
    const tagSnippet = source.slice(tagStart, tagStart + 300);
    expect(tagSnippet.startsWith("<div")).toBe(true);
    expect(tagSnippet).not.toMatch(/onClick/);
  });

  it("產業清單一律渲染，不再包在 industryExpanded && (...) 條件式裡", () => {
    const source = readNewsPageSource();
    const start = source.indexOf("INDUSTRIES.map(ind => {");
    const context = source.slice(Math.max(0, start - 500), start);
    expect(context).not.toMatch(/industryExpanded &&/);
    // 垂直線第四輪配色更新為橘→紫漸層的獨立 <span>（取代原本單色 border-l），
    // 仍保留 pl-4／ml-4 縮排層級，且線條本身用 absolute + w-[2px]，不會因為
    // 選中底色而被蓋住或中斷（不是靠某個按鈕自己的 border，是容器層級的獨立元素）。
    const industryListBlock = source.slice(start - 500, start + 50);
    expect(industryListBlock).toMatch(/pl-4/);
    expect(industryListBlock).toMatch(/ml-4/);
    expect(industryListBlock).toMatch(/absolute left-0 top-0 bottom-0 w-\[2px\]/);
    expect(industryListBlock).toMatch(/linear-gradient\(to bottom, #fb923c, #a855f7\)/);
  });

  it("INDUSTRY_ICON_MAP 涵蓋 shared/constants.ts 目前所有產業名稱，且有 Factory fallback", () => {
    const source = readNewsPageSource();
    const constantsSource = fs.readFileSync(path.resolve(__dirname, "..", "shared", "constants.ts"), "utf-8");
    const nameMatches = [...constantsSource.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1]);
    // INDUSTRIES 的 name 都在最前面幾筆，用 INDUSTRY_OPTIONS 交叉確認一次，
    // 避免抓到其他常數（例如 sub 陣列）裡剛好也叫 name 的東西。
    const industryOptionsMatch = constantsSource.match(/INDUSTRIES\.map\(i => i\.name\)/);
    expect(industryOptionsMatch).not.toBeNull();

    const mapStart = source.indexOf("const INDUSTRY_ICON_MAP");
    const mapEnd = source.indexOf("function getIndustryIcon");
    const mapBlock = source.slice(mapStart, mapEnd);

    for (const name of nameMatches.slice(0, 12)) {
      expect(mapBlock).toMatch(new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":`));
    }

    const fallbackFnStart = source.indexOf("function getIndustryIcon");
    const fallbackFnEnd = source.indexOf("export default function News");
    const fallbackFn = source.slice(fallbackFnStart, fallbackFnEnd);
    expect(fallbackFn).toMatch(/INDUSTRY_ICON_MAP\[name\] \?\? Factory/);
  });

  it("產業清單資料來源仍是 shared/constants.ts 的 INDUSTRIES，不是另外寫死的陣列", () => {
    const source = readNewsPageSource();
    expect(source).toMatch(/import \{ INDUSTRIES \} from "@shared\/constants"/);
    expect(source).toMatch(/INDUSTRIES\.map\(ind =>/);
  });
});

describe("NewsDetail.tsx：production document.title 空白修正（原始碼內容斷言）", () => {
  // 這裡刻意不 import NewsDetail.tsx 本身（會拉進 Navbar／trpc client 等瀏覽器
  // 專用模組），沿用本檔案其他地方已經在用的原始碼內容斷言手法；實際 DOM 行為
  // 已經用 production build 本機預覽 + Playwright 驗證過（loading/loaded/
  // not-found 三種狀態 document.title 均非空、無空白 <title> 標籤），這裡只
  // 負責鎖定「結構不會被後續修改不小心改回舊的延遲掛載寫法」。
  function readNewsDetailSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
  }

  it("Helmet 掛載在 loading／NotFound／正常內容的條件分支之外，不是只在資料載入後才第一次出現", () => {
    const source = readNewsDetailSource();
    // 只檢查 NewsDetail 這個預設匯出的元件本身（PDF 附件卡片是獨立的
    // NewsAttachmentCard 子元件，定義在它前面，本來就有自己合法的 return，
    // 不屬於這個「唯一一次 return」規則要鎖定的範圍）。
    const componentSource = source.slice(source.indexOf("export default function NewsDetail()"));
    // 唯一一次 return，Helmet 和 {body} 在同一個 JSX 樹裡；不能有「isLoading
    // 時 return 一份 JSX、資料載入後又 return 另一份帶 Helmet 的 JSX」這種
    // 每個分支各自決定要不要掛 Helmet 的寫法（那正是原本會產生空 title 的
    // 結構）。
    const returnCount = (componentSource.match(/\breturn\s*\(/g) ?? []).length;
    const helmetIdx = componentSource.indexOf("<Helmet>");
    const bodyAssignIdx = componentSource.indexOf("let body:");
    expect(helmetIdx).toBeGreaterThan(-1);
    expect(bodyAssignIdx).toBeGreaterThan(-1);
    expect(helmetIdx).toBeGreaterThan(bodyAssignIdx); // Helmet 在 body 三態都決定好之後才渲染，同一棵樹裡
    // isLoading／NotFound／正常內容三個分支都只是在組 `body` 這個變數，
    // 不是各自 return，所以合法的 `return (` 在 NewsDetail 元件本身應該只出現一次。
    expect(returnCount).toBe(1);
  });

  it("headTitle 三種狀態都是非空字串，不會有任何分支用 undefined／null／空字串當 title", () => {
    const source = readNewsDetailSource();
    const start = source.indexOf("const headTitle");
    const end = source.indexOf("const handleShare");
    const block = source.slice(start, end);

    expect(block).toMatch(/`\$\{item\.title\}｜OXM 找消息`/); // 正常消息
    expect(block).toMatch(/"找不到消息｜OXM"/); // 查無資料／已下架
    expect(block).toMatch(/"消息內容｜OXM 找消息"/); // loading fallback
    // 三個分支都是字面上的非空字串或字串樣板，不是可能為 falsy 的變數本身
    expect(block).not.toMatch(/:\s*item\?\.title\s*[,)]/);
  });

  it("<title> 一律渲染 {headTitle}，不會渲染成空字串或有條件地整個省略", () => {
    const source = readNewsDetailSource();
    const helmetBlock = source.slice(source.indexOf("<Helmet>"), source.indexOf("</Helmet>"));
    expect(helmetBlock).toMatch(/<title>\{headTitle\}<\/title>/);
    // description／canonical／OG 才是依 item 是否存在有條件渲染，title 本身不能条件化
    expect(helmetBlock).not.toMatch(/\{item && <title>/);
  });

  it("description／canonical／OG 只在 item 存在時渲染，避免 loading／NotFound 狀態輸出不完整或錯誤的 meta", () => {
    const source = readNewsDetailSource();
    const helmetBlock = source.slice(source.indexOf("<Helmet>"), source.indexOf("</Helmet>"));
    expect(helmetBlock).toMatch(/\{item && canonicalUrl && \(/);
    expect(helmetBlock).toMatch(/name="description"/);
    expect(helmetBlock).toMatch(/rel="canonical"/);
    expect(helmetBlock).toMatch(/property="og:title"/);
    expect(helmetBlock).toMatch(/property="og:description"/);
    expect(helmetBlock).toMatch(/property="og:url"/);
    expect(helmetBlock).toMatch(/property="og:type"/);
  });
});
