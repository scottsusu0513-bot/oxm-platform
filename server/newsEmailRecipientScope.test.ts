/**
 * 產業消息「Email 收件對象」(emailRecipientScope) 回歸測試。走真實本機測試
 * 資料庫（受 server/test-db-guard.ts 保護），真的會打 Resend API 的
 * sendNewsEmail 一律 vi.mock 取代。
 *
 * 本次功能：把原本單一 boolean「同時發送 Email 通知」演進成三選一：
 *   - none         ：完全不寄 Email（站內通知／Push 照舊）
 *   - all_users    ：沿用既有規則＝eligible recipients 中有 email 的人
 *   - factory_users：在 all_users 的基礎上，再交集「目前管理 ≥1 間 approved
 *                    且未軟刪除工廠」的會員
 *
 * 核心不變量：factory_users 只是 Email channel 的第二層過濾，
 * gatherNewsRecipients／站內通知／Push recipient 完全不受影響。
 *
 * 覆蓋（對應交辦清單編號）：
 *   A. none：1
 *   B. all_users：2、20、21（backward compat）
 *   C. factory_users 資格（getApprovedFactoryManagerIds）：3-9
 *   D. 去重：10、11
 *   E. important 核心情境：12、13
 *   G. 產業情境：14
 *   H. notificationSettings 退訂：15
 *   I. estimate 與 dispatch 共用 eligibility：16
 *   J. draft / publish / edit 防重寄：17、18、19
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const mockSendNewsEmail = vi.fn(async (_params: { toEmail: string; toName: string | null; newsTitle: string; newsSummary: string; newsSlug: string }) => undefined);

vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendNewsEmail: (params: Parameters<typeof mockSendNewsEmail>[0]) => mockSendNewsEmail(params),
  };
});

const { appRouter, dispatchNewsNotifications } = await import("./routers");
const db = await import("./db");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;
type FactoryStatus = "draft" | "pending" | "approved" | "rejected" | "delisted";

const runId = `news-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

const createdUserIds: number[] = [];
const createdFactoryIds: number[] = [];
const createdNewsIds: number[] = [];

function adminCtx(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `news-scope-admin-${userId}`, email: "scottsusu0513@gmail.com",
    name: "News Scope Test Admin", loginMethod: "manus", role: "admin", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

async function createTestUser(opts: { notificationSettings?: Record<string, boolean> } = {}): Promise<{ id: number; email: string }> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  seq += 1;
  const openId = `test-${runId}-${seq}`;
  const email = `${runId}-${seq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, notificationSettings)
    VALUES (${openId}, ${`News Scope Test ${runId}-${seq}`}, ${email}, ${opts.notificationSettings ? JSON.stringify(opts.notificationSettings) : null})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return { id, email };
}

async function createTestFactory(
  ownerId: number,
  opts: { status?: FactoryStatus; deleted?: boolean; industry?: string[] } = {},
): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const status = opts.status ?? "approved";
  const industry = JSON.stringify(opts.industry ?? ["金屬加工"]);
  const deletedAt = opts.deleted ? sql`NOW()` : sql`NULL`;
  await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, deletedAt)
    VALUES (${ownerId}, ${`Scope Test Factory ${runId}-${ownerId}`}, ${industry}, ${JSON.stringify(["ODM"])}, ${"台北市"}, ${"500萬以下"}, ${""}, ${status}, ${deletedAt})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM factories WHERE ownerId = ${ownerId} ORDER BY id DESC LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test factory");
  createdFactoryIds.push(id);
  return id;
}

async function addCoManager(factoryId: number, userId: number, opts: { removed?: boolean } = {}): Promise<void> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const removedAt = opts.removed ? sql`NOW()` : sql`NULL`;
  await conn.execute(sql`
    INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, removedAt)
    VALUES (${factoryId}, ${userId}, ${userId}, ${removedAt})
  `);
}

async function subscribeBoard(userId: number, boardKey: string): Promise<void> {
  await db.setNewsBoardSubscription(userId, boardKey, true);
}

async function createPublishedNews(opts: {
  isImportant?: boolean; isCompetition?: boolean; industryNames?: string[]; createdBy: number;
}): Promise<{ id: number; slug: string; title: string; summary: string }> {
  seq += 1;
  const title = `${runId} news ${seq}`;
  const { id } = await db.createNews({
    title, summary: "摘要", content: "內容", status: "published",
    isImportant: opts.isImportant ?? false,
    isCompetition: opts.isCompetition ?? false,
    industryNames: opts.industryNames ?? [],
    createdBy: opts.createdBy,
  });
  createdNewsIds.push(id);
  const row = await db.getNewsById(id);
  return { id, slug: row!.slug, title, summary: "摘要" };
}

/** 這則消息的 Email 收件名單（newsNotifications 是 dispatch 建立 email pending 紀錄的唯一入口）。 */
async function emailAudienceUserIds(newsId: number): Promise<number[]> {
  const conn = await getDb();
  if (!conn) return [];
  const [rows] = await conn.execute(
    sql`SELECT userId FROM newsNotifications WHERE newsId = ${newsId} AND channel = 'email'`,
  ) as unknown as [{ userId: number }[], unknown];
  return rows.map(r => r.userId);
}

async function inAppRecipientUserIds(slug: string): Promise<number[]> {
  const conn = await getDb();
  if (!conn) return [];
  const [rows] = await conn.execute(
    sql`SELECT recipientUserId FROM communityNotifications WHERE actionUrl = ${`/news/${slug}`} AND eventType = 'news'`,
  ) as unknown as [{ recipientUserId: number }[], unknown];
  return rows.map(r => r.recipientUserId);
}

/** 這則消息（依 slug 精準比對）實際嘗試寄出的收件 email 清單。module-level
 *  的 mockSendNewsEmail 會被其他測試的 fire-and-forget 寄送迴圈污染，所以一律
 *  用 newsSlug 過濾，不用全域 toHaveBeenCalled。 */
function sentEmailsForSlug(slug: string): string[] {
  return mockSendNewsEmail.mock.calls.filter(c => c[0].newsSlug === slug).map(c => c[0].toEmail);
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function dispatchCompetition(
  news: { id: number; slug: string; title: string; summary: string },
  emailScope: "none" | "factory_users" | "all_users",
  flags: { isImportant?: boolean; industryNames?: string[] } = {},
): Promise<void> {
  await dispatchNewsNotifications({
    newsId: news.id,
    title: news.title,
    summary: news.summary,
    slug: news.slug,
    isImportant: flags.isImportant ?? false,
    isCompetition: !flags.industryNames,
    isExhibition: false,
    isCrossIndustry: false,
    industryNames: flags.industryNames ?? [],
    emailScope,
  });
}

beforeEach(() => {
  mockSendNewsEmail.mockClear();
});

// 每個測試結束就清掉自己建立的資料（尤其是 newsBoardSubscriptions），
// 避免同檔案後面的 competition 消息把前面測試訂閱的使用者也算成收件人、
// 讓寄送迴圈越跑越久。
afterEach(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const id of createdNewsIds.splice(0)) await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
  for (const id of createdFactoryIds.splice(0)) {
    await conn.execute(sql`DELETE FROM factoryCoManagers WHERE factoryId = ${id}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  }
  for (const id of createdUserIds.splice(0)) {
    await conn.execute(sql`DELETE FROM newsBoardSubscriptions WHERE userId = ${id}`);
    await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
  }
});

// ───────────────────────── A. none ─────────────────────────
describe("A. emailRecipientScope = none", () => {
  it("1. none：不建立任何 Email notification，站內通知照舊建立", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const news = await createPublishedNews({ isCompetition: true, createdBy: admin.id });

    await dispatchCompetition(news, "none");

    await waitFor(async () => (await inAppRecipientUserIds(news.slug)).includes(user.id));
    await new Promise(res => setTimeout(res, 400)); // 給 email 分支足夠時間「如果真的有跑」
    expect(sentEmailsForSlug(news.slug)).toEqual([]);
    expect(await emailAudienceUserIds(news.id)).toEqual([]);

    const item = await db.getNewsById(news.id);
    expect(item?.emailNotificationSentAt).toBeNull();
  });
});

// ───────────────────────── B. all_users ─────────────────────────
describe("B. emailRecipientScope = all_users", () => {
  it("2. all_users：既有 eligible recipients 中有 email 的人都收到（與舊 sendEmail=true 一致）", async () => {
    const admin = await createTestUser();
    const a = await createTestUser();
    const b = await createTestUser();
    await subscribeBoard(a.id, "competition");
    await subscribeBoard(b.id, "competition");
    const news = await createPublishedNews({ isCompetition: true, createdBy: admin.id });

    await dispatchCompetition(news, "all_users");

    await waitFor(async () => {
      const ids = await emailAudienceUserIds(news.id);
      return ids.includes(a.id) && ids.includes(b.id);
    });
    await waitFor(async () => (await db.getNewsById(news.id))?.emailNotificationSentAt != null);
  });

  it("20. backward compat：沒有 emailRecipientScope、sendEmailNotification=true → 等同 all_users", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const res = await caller.news.create({
      title: `${runId} compat-true`, summary: "摘要", content: "內容",
      status: "published", isCompetition: true, sendEmailNotification: true,
    });
    createdNewsIds.push(res.id);

    await waitFor(async () => (await emailAudienceUserIds(res.id)).includes(user.id));
  });

  it("21. backward compat：沒有 emailRecipientScope、sendEmailNotification=false → 等同 none", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const res = await caller.news.create({
      title: `${runId} compat-false`, summary: "摘要", content: "內容",
      status: "published", isCompetition: true, sendEmailNotification: false,
    });
    createdNewsIds.push(res.id);

    const slug = (await db.getNewsById(res.id))!.slug;
    await waitFor(async () => (await inAppRecipientUserIds(slug)).includes(user.id));
    await new Promise(res2 => setTimeout(res2, 400));
    expect(sentEmailsForSlug(slug)).toEqual([]);
    expect(await emailAudienceUserIds(res.id)).toEqual([]);
  });
});

// ───────────────────────── C. factory_users 資格 ─────────────────────────
describe("C. getApprovedFactoryManagerIds：factory_users 資格判斷", () => {
  it("3. approved 工廠 owner → 具備資格", async () => {
    const owner = await createTestUser();
    await createTestFactory(owner.id, { status: "approved" });
    expect((await db.getApprovedFactoryManagerIds()).has(owner.id)).toBe(true);
  });

  it("4. approved 工廠有效共同管理者 → 具備資格", async () => {
    const owner = await createTestUser();
    const coMgr = await createTestUser();
    const factoryId = await createTestFactory(owner.id, { status: "approved" });
    await addCoManager(factoryId, coMgr.id);
    expect((await db.getApprovedFactoryManagerIds()).has(coMgr.id)).toBe(true);
  });

  it("5. 只有 pending 工廠 → 不具備資格", async () => {
    const owner = await createTestUser();
    await createTestFactory(owner.id, { status: "pending" });
    expect((await db.getApprovedFactoryManagerIds()).has(owner.id)).toBe(false);
  });

  it("6. 只有 rejected 工廠 → 不具備資格", async () => {
    const owner = await createTestUser();
    await createTestFactory(owner.id, { status: "rejected" });
    expect((await db.getApprovedFactoryManagerIds()).has(owner.id)).toBe(false);
  });

  it("7. 只有 delisted 工廠 → 不具備資格", async () => {
    const owner = await createTestUser();
    await createTestFactory(owner.id, { status: "delisted" });
    expect((await db.getApprovedFactoryManagerIds()).has(owner.id)).toBe(false);
  });

  it("8. soft-deleted 的 approved 工廠 → 不具備資格（owner 與 co-manager 都是）", async () => {
    const owner = await createTestUser();
    const coMgr = await createTestUser();
    const factoryId = await createTestFactory(owner.id, { status: "approved", deleted: true });
    await addCoManager(factoryId, coMgr.id);
    const ids = await db.getApprovedFactoryManagerIds();
    expect(ids.has(owner.id)).toBe(false);
    expect(ids.has(coMgr.id)).toBe(false);
  });

  it("9. co-manager relation 已 removedAt（removedAt IS NOT NULL）→ 不因該 relation 具備資格", async () => {
    const owner = await createTestUser();
    const exCoMgr = await createTestUser();
    const factoryId = await createTestFactory(owner.id, { status: "approved" });
    await addCoManager(factoryId, exCoMgr.id, { removed: true });
    expect((await db.getApprovedFactoryManagerIds()).has(exCoMgr.id)).toBe(false);
  });
});

// ───────────────────────── D. 去重 ─────────────────────────
describe("D. Email 去重（同一 user 多個 relation 命中只寄一封）", () => {
  it("10 & 11. 同時是 approved 工廠 owner 又是另一間 approved 工廠有效 co-manager → 只一封 Email", async () => {
    const admin = await createTestUser();
    const otherOwner = await createTestUser();
    const dual = await createTestUser();
    await subscribeBoard(dual.id, "competition");

    await createTestFactory(dual.id, { status: "approved" }); // dual 當 owner
    const otherFactoryId = await createTestFactory(otherOwner.id, { status: "approved" });
    await addCoManager(otherFactoryId, dual.id); // dual 同時當 co-manager

    // getApprovedFactoryManagerIds 是 Set：dual 只會出現一次
    const ids = await db.getApprovedFactoryManagerIds();
    expect([...ids].filter(id => id === dual.id).length).toBe(1);

    const news = await createPublishedNews({ isCompetition: true, createdBy: admin.id });
    await dispatchCompetition(news, "factory_users");

    await waitFor(() => sentEmailsForSlug(news.slug).includes(dual.email));
    await new Promise(res => setTimeout(res, 400));
    expect(sentEmailsForSlug(news.slug).filter(e => e === dual.email).length).toBe(1);
    expect((await emailAudienceUserIds(news.id)).filter(id => id === dual.id).length).toBe(1);
  });
});

// ───────────────────────── E. important 核心情境 ─────────────────────────
describe("E. important + emailRecipientScope（站內 recipient 不得因 factory_users 縮小）", () => {
  it("12. important + factory_users：一般會員有站內、無 Email；工廠會員站內+Email 皆有", async () => {
    const plain = await createTestUser();
    const factoryOwner = await createTestUser();
    await createTestFactory(factoryOwner.id, { status: "approved" });

    // important 的站內 recipient 來自 gatherNewsRecipients（本次未改動），涵蓋
    // 所有現存有效會員——兩位測試會員都應在內。
    const recipients = await db.gatherNewsRecipients({
      isImportant: true, isCompetition: false, isExhibition: false, isCrossIndustry: false, industryNames: [],
    });
    const recipientIds = new Set(recipients.map(r => r.id));
    expect(recipientIds.has(plain.id)).toBe(true);
    expect(recipientIds.has(factoryOwner.id)).toBe(true);

    // Email 分支的實際過濾（與 dispatchNewsNotifications 內同一行邏輯）：
    const factoryIds = await db.getApprovedFactoryManagerIds();
    const emailAudience = recipients.filter(r => r.email && factoryIds.has(r.id)).map(r => r.id);
    expect(emailAudience).toContain(factoryOwner.id);
    expect(emailAudience).not.toContain(plain.id);
  });

  it("13. important + all_users：一般會員與工廠會員的 Email 行為維持既有 important 邏輯（兩者都在 Email 名單）", async () => {
    const plain = await createTestUser();
    const factoryOwner = await createTestUser();
    await createTestFactory(factoryOwner.id, { status: "approved" });

    const recipients = await db.gatherNewsRecipients({
      isImportant: true, isCompetition: false, isExhibition: false, isCrossIndustry: false, industryNames: [],
    });
    const emailAudience = recipients.filter(r => r.email).map(r => r.id); // all_users 分支
    expect(emailAudience).toContain(plain.id);
    expect(emailAudience).toContain(factoryOwner.id);
  });
});

// ───────────────────────── G. 產業情境 ─────────────────────────
describe("G. industry + factory_users", () => {
  it("14. 產業消息：gatherNewsRecipients 的產業 eligibility 不變，只在 Email channel 套 factory filter", async () => {
    const admin = await createTestUser();
    const plain = await createTestUser();
    const factoryOwner = await createTestUser();
    await createTestFactory(factoryOwner.id, { status: "approved", industry: ["金屬加工"] });
    // 一般會員沒有工廠，要靠明確訂閱該產業看板才會是 in-app recipient。
    await subscribeBoard(plain.id, "industry:金屬加工");

    const news = await createPublishedNews({ industryNames: ["金屬加工"], createdBy: admin.id });
    await dispatchCompetition(news, "factory_users", { industryNames: ["金屬加工"] });

    await waitFor(async () => {
      const inApp = await inAppRecipientUserIds(news.slug);
      return inApp.includes(plain.id) && inApp.includes(factoryOwner.id);
    });
    await waitFor(() => sentEmailsForSlug(news.slug).includes(factoryOwner.email));
    await new Promise(res => setTimeout(res, 400));
    expect(sentEmailsForSlug(news.slug)).not.toContain(plain.email);
    const emailIds = await emailAudienceUserIds(news.id);
    expect(emailIds).toContain(factoryOwner.id);
    expect(emailIds).not.toContain(plain.id);

    // all_users 對照：同一份產業 recipient，Email 名單應含一般會員。
    const news2 = await createPublishedNews({ industryNames: ["金屬加工"], createdBy: admin.id });
    await dispatchCompetition(news2, "all_users", { industryNames: ["金屬加工"] });
    await waitFor(async () => (await emailAudienceUserIds(news2.id)).includes(plain.id));
  });
});

// ───────────────────────── H. notificationSettings 退訂 ─────────────────────────
describe("H. notificationSettings.news = false 不得被 factory_users 繞過", () => {
  it("15. approved 工廠會員但已退訂 news Email → 站內通知照收、Email 不寄", async () => {
    const admin = await createTestUser();
    const optOut = await createTestUser({ notificationSettings: { news: false } });
    await subscribeBoard(optOut.id, "competition");
    await createTestFactory(optOut.id, { status: "approved" });

    const news = await createPublishedNews({ isCompetition: true, createdBy: admin.id });
    await dispatchCompetition(news, "factory_users");

    await waitFor(async () => (await inAppRecipientUserIds(news.slug)).includes(optOut.id));
    await new Promise(res => setTimeout(res, 400));
    expect(sentEmailsForSlug(news.slug)).not.toContain(optOut.email);
    expect(await emailAudienceUserIds(news.id)).not.toContain(optOut.id);
  });
});

// ───────────────────────── I. estimate / dispatch 共用 eligibility ─────────────────────────
describe("I. estimateRecipients 與 dispatch 共用 factory_users eligibility", () => {
  it("16. estimate.factoryEmailCount 與實際 factory_users dispatch 的 Email 名單數一致", async () => {
    const admin = await createTestUser();
    const factoryOwner = await createTestUser();
    const plain = await createTestUser();
    await subscribeBoard(factoryOwner.id, "competition");
    await subscribeBoard(plain.id, "competition");
    await createTestFactory(factoryOwner.id, { status: "approved" });

    const input = { isImportant: false, isCompetition: true, isExhibition: false, isCrossIndustry: false, industryNames: [] as string[] };
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const estimate = await caller.news.estimateRecipients(input);

    // estimate 必須等於用同一組 helper 重新推導的結果（證明兩邊共用邏輯）。
    const recipients = await db.gatherNewsRecipients(input);
    const factoryIds = await db.getApprovedFactoryManagerIds();
    expect(estimate.factoryEmailCount).toBe(recipients.filter(r => r.email && factoryIds.has(r.id)).length);
    expect(estimate.emailCount).toBe(recipients.filter(r => r.email).length);
    expect(estimate.factoryEmailCount).toBeLessThanOrEqual(estimate.emailCount);

    // 實際 dispatch（fileParallelism:false → 測試期間 DB 狀態穩定）。
    const news = await createPublishedNews({ isCompetition: true, createdBy: admin.id });
    await dispatchCompetition(news, "factory_users");
    await waitFor(async () => (await emailAudienceUserIds(news.id)).includes(factoryOwner.id));
    await new Promise(res => setTimeout(res, 400));
    expect((await emailAudienceUserIds(news.id)).length).toBe(estimate.factoryEmailCount);
  });
});

// ───────────────────────── J. draft / publish / edit 防重寄 ─────────────────────────
describe("J. draft / publish / edit 防重寄", () => {
  it("17. 儲存草稿（即使 emailRecipientScope=all_users）→ 不 dispatch、不寄 Email", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const res = await caller.news.create({
      title: `${runId} draft`, summary: "摘要", content: "內容",
      status: "draft", isCompetition: true, emailRecipientScope: "all_users",
    });
    createdNewsIds.push(res.id);
    const slug = (await db.getNewsById(res.id))!.slug;

    await new Promise(r => setTimeout(r, 500));
    expect(sentEmailsForSlug(slug)).toEqual([]);
    expect(await emailAudienceUserIds(res.id)).toEqual([]);
    expect((await db.getNewsById(res.id))?.emailNotificationSentAt).toBeNull();
  });

  it("18. 第一次 publish + emailRecipientScope=all_users → 依 scope 寄 Email、寫入 emailNotificationSentAt", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const draft = await caller.news.create({
      title: `${runId} draft-then-publish`, summary: "摘要", content: "內容",
      status: "draft", isCompetition: true,
    });
    createdNewsIds.push(draft.id);

    await caller.news.update({ id: draft.id, status: "published", emailRecipientScope: "all_users" });

    await waitFor(async () => (await emailAudienceUserIds(draft.id)).includes(user.id));
    await waitFor(async () => (await db.getNewsById(draft.id))?.emailNotificationSentAt != null);
  });

  it("19. 已發布消息再編輯（帶 emailRecipientScope=all_users）→ 不重寄，emailNotificationSentAt 不變", async () => {
    const admin = await createTestUser();
    const user = await createTestUser();
    await subscribeBoard(user.id, "competition");
    const caller = appRouter.createCaller(adminCtx(admin.id));
    const created = await caller.news.create({
      title: `${runId} publish-then-edit`, summary: "摘要", content: "內容",
      status: "published", isCompetition: true, emailRecipientScope: "all_users",
    });
    createdNewsIds.push(created.id);
    const slug = (await db.getNewsById(created.id))!.slug;

    await waitFor(async () => (await db.getNewsById(created.id))?.emailNotificationSentAt != null);
    // 等首次發布的整批寄送迴圈（每封間隔 500ms）完全跑完再取基準值，
    // 否則會把「原本那批還沒寄完的信」誤判成編輯造成的補寄。
    await waitFor(async () => {
      const audience = (await emailAudienceUserIds(created.id)).length;
      return audience > 0 && sentEmailsForSlug(slug).length >= audience;
    });
    await new Promise(r => setTimeout(r, 600));
    const sentAtBefore = (await db.getNewsById(created.id))?.emailNotificationSentAt?.getTime();
    const sentCountBefore = sentEmailsForSlug(slug).length;
    const audienceBefore = (await emailAudienceUserIds(created.id)).length;

    await caller.news.update({ id: created.id, title: `${runId} edited`, emailRecipientScope: "all_users" });

    await new Promise(r => setTimeout(r, 600));
    // 編輯已發布消息不得再觸發任何寄送——這則消息的寄送次數與 Email 名單、
    // emailNotificationSentAt 都必須完全不變。
    expect(sentEmailsForSlug(slug).length).toBe(sentCountBefore);
    expect((await emailAudienceUserIds(created.id)).length).toBe(audienceBefore);
    expect((await db.getNewsById(created.id))?.emailNotificationSentAt?.getTime()).toBe(sentAtBefore);
  });
});

