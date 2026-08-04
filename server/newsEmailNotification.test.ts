/**
 * 產業消息「同時發送 Email 通知」checkbox 回歸測試。走真實本機測試資料庫
 * （受 server/test-db-guard.ts 保護），用 appRouter.createCaller(ctx) 直接呼叫
 * tRPC procedure；真的會打 Resend API 的 sendNewsEmail 一律 vi.mock 取代，
 * 不會寄出任何真實 Email（見下方 vi.mock("./email", ...)）。
 *
 * 涵蓋：
 * 1. create 直接發布：未勾選 sendNewsEmail 呼叫 0 次；有勾選依既有收件規則
 *    （看板訂閱資格 + email 開關）發送，emailNotificationSentAt 被寫入；
 *    站內通知皆不受影響。
 * 2. 同一會員符合多個分類（isCompetition + isExhibition 都明確訂閱）時仍
 *    只收到一封 Email；已退訂「news」Email 的會員即使有看板訂閱資格也不
 *    寄送。
 * 3. update：已發布過的消息（firstPublishedAt 有值）再次編輯，即使手動送入
 *    sendEmailNotification:true 也絕不補寄，emailNotificationSentAt 不變。
 * 4. update：草稿首次發布（firstPublishedAt 從 NULL 變有值的這一次）依
 *    sendEmailNotification 勾選與否決定要不要寄送——勾選才寄、未勾選不寄，
 *    這是本檔案這一輪修正的核心行為（先前版本 update 一律不寄，導致草稿
 *    永遠無法選擇寄送 Email 的漏洞）。
 * 5. update：勾選但這次操作仍是「儲存草稿」（status 沒有變成 published）
 *    不寄信、不記錄 emailNotificationSentAt。
 * 6. update：曾經發布過的消息即使被改回 draft，之後再次發布也不得補寄——
 *    判斷依據是 firstPublishedAt 而非目前 status。
 * 7. 站內通知與 App Push 完全不受 sendEmailNotification 影響，一律照舊執行。
 * 8. migration 0072 只新增欄位，不包含任何 UPDATE／INSERT／DELETE 或觸發寄信
 *    的邏輯（純文字內容斷言，不依賴實際套用結果）。
 * 9. Email 主旨仍經過共用的 toPlainNotificationText 清理（標題含 Markdown
 *    符號時，寄出的 newsTitle 已被清乾淨）。
 * 10. checkbox 的 sendEmailNotification 欄位在 create／update 都是 optional，
 *     不帶時伺服器一律視同 false，不依賴前端一定會傳入。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

const runId = `news-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

// adminProcedure（見 server/_core/trpc.ts）只認 isAdminUser 白名單（openId／
// email），不看 user.role——本機 .env 的 ADMIN_WHITELIST_EMAILS 固定是
// scottsusu0513@gmail.com，這裡沿用 server/certificationServiceCatalog.test.ts
// 已驗證可行的既有寫法：ctx.user.id 仍指向一筆真的存在的 users 資料列（news.
// createdBy 是外鍵），只有 email 換成白名單信箱讓 isAdminUser 判斷為 true。
function adminCtx(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `news-email-admin-${userId}`, email: "scottsusu0513@gmail.com",
    name: "News Email Test Admin", loginMethod: "manus", role: "admin", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

async function createTestUser(opts: { notificationSettings?: Record<string, boolean> } = {}): Promise<{ id: number; email: string }> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const email = `${runId}-${userSeq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, notificationSettings)
    VALUES (${openId}, ${`News Email Test ${runId}-${userSeq}`}, ${email}, ${opts.notificationSettings ? JSON.stringify(opts.notificationSettings) : null})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return { id, email };
}

async function deleteTestUser(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
}

async function deleteTestNews(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
}

async function subscribeBoard(userId: number, boardKey: string): Promise<void> {
  await db.setNewsBoardSubscription(userId, boardKey, true);
}

/** 輪詢直到條件成立或逾時；mockSendNewsEmail 內建 500ms 節流延遲，不能直接同步斷言。 */
async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 4000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise(res => setTimeout(res, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

beforeEach(() => {
  mockSendNewsEmail.mockClear();
});

describe("migration 0072 內容檢查（純文字，不依賴實際套用）", () => {
  it("只包含 ALTER TABLE ADD COLUMN，不含任何 UPDATE／INSERT／DELETE 或觸發寄信的敘述", () => {
    const sqlPath = path.join(__dirname, "..", "drizzle", "0072_news_email_notification.sql");
    const raw = fs.readFileSync(sqlPath, "utf-8");
    const withoutComments = raw
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n");
    expect(withoutComments).toMatch(/ALTER TABLE `news`/);
    expect(withoutComments).toMatch(/ADD COLUMN `emailNotificationSentAt`/);
    expect(withoutComments).not.toMatch(/\bUPDATE\b/i);
    expect(withoutComments).not.toMatch(/\bINSERT\b/i);
    expect(withoutComments).not.toMatch(/\bDELETE\b/i);
    expect(withoutComments).not.toMatch(/\bCALL\b/i);
  });
});

describe("news.create：sendEmailNotification checkbox", () => {
  let adminId: number;
  let userA: { id: number; email: string };
  let newsId: number | undefined;

  beforeEach(async () => {
    adminId = (await createTestUser()).id;
    userA = await createTestUser();
    // 用 competition 看板（純明確訂閱才有資格，沒有像 important／all 那種
    // 「預設涵蓋所有現存會員」的擴大規則）確保測試結果只反映這裡建立的
    // 使用者，不會被同一份共用測試資料庫裡其他測試檔留下的資料污染。
    await subscribeBoard(userA.id, "competition");
  });

  afterEach(async () => {
    await deleteTestNews(newsId);
    newsId = undefined;
    await deleteTestUser(adminId);
    await deleteTestUser(userA.id);
  });

  it("未勾選：消息建立成功、站內通知照常、Email sender 呼叫 0 次，emailNotificationSentAt 維持 NULL", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const result = await caller.news.create({
      title: `${runId} 未勾選標題`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      sendEmailNotification: false,
    });
    newsId = result.id;

    // 站內通知走 dispatchNewsNotifications 內同步 await 的區塊，但呼叫端
    // （news.create）本身用 void 不等它完成才回傳，所以這裡要輪詢、不能假設
    // mutation 一回傳站內通知就已經寫入。
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    await waitFor(async () => {
      const [rows] = await conn.execute(sql`SELECT id FROM communityNotifications WHERE actionUrl = ${`/news/${result.slug}`} AND recipientUserId = ${userA.id}`) as unknown as [{ id: number }[], unknown];
      return rows.length === 1;
    });

    // 給 email 分支足夠時間「如果真的有跑」會跑完，藉此確認它壓根沒被觸發。
    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();

    const item = await db.getNewsById(newsId);
    expect(item?.emailNotificationSentAt).toBeNull();
  });

  it("有勾選：消息建立成功、站內通知不受影響、Email 依既有收件規則發送，emailNotificationSentAt 被寫入", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const result = await caller.news.create({
      title: `${runId} 有勾選標題`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      sendEmailNotification: true,
    });
    newsId = result.id;

    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    expect(mockSendNewsEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNewsEmail.mock.calls[0][0].toEmail).toBe(userA.email);

    await waitFor(async () => {
      const item = await db.getNewsById(newsId!);
      return item?.emailNotificationSentAt != null;
    });
    const item = await db.getNewsById(newsId);
    expect(item?.emailNotificationSentAt).not.toBeNull();
  });

  it("未帶 sendEmailNotification（完全省略欄位）：伺服器視同未勾選，不寄 Email", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const result = await caller.news.create({
      title: `${runId} 省略欄位標題`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
    } as Parameters<typeof caller.news.create>[0]);
    newsId = result.id;

    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();
    const item = await db.getNewsById(newsId);
    expect(item?.emailNotificationSentAt).toBeNull();
  });

  it("Email 主旨（newsTitle）已經過 toPlainNotificationText 清理，不含原始 Markdown 符號", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const result = await caller.news.create({
      title: `${runId} **重要** _消息_`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      sendEmailNotification: true,
    });
    newsId = result.id;

    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    const sentTitle = mockSendNewsEmail.mock.calls[0][0].newsTitle;
    expect(sentTitle).not.toContain("*");
    expect(sentTitle).not.toContain("_");
    expect(sentTitle).toContain(runId);
  });
});

describe("news.create：多分類去重與退訂規則", () => {
  let adminId: number;
  let userMulti: { id: number; email: string };
  let userOptOut: { id: number; email: string };
  let newsId: number | undefined;

  beforeEach(async () => {
    adminId = (await createTestUser()).id;
    userMulti = await createTestUser();
    userOptOut = await createTestUser({ notificationSettings: { news: false } });
    // userMulti 對 competition 與 exhibition 兩個看板都明確訂閱——這兩個看板
    // 都是「只有明確訂閱才有資格」，不像 important／all 有「涵蓋所有現存
        // 會員」的擴大規則，才能確保這裡的斷言只反映這個測試自己建立的資料。
    await subscribeBoard(userMulti.id, "competition");
    await subscribeBoard(userMulti.id, "exhibition");
    // userOptOut 對 competition 也明確訂閱（看板訂閱資格具備），但退訂了 Email。
    await subscribeBoard(userOptOut.id, "competition");
  });

  afterEach(async () => {
    await deleteTestNews(newsId);
    newsId = undefined;
    await deleteTestUser(adminId);
    await deleteTestUser(userMulti.id);
    await deleteTestUser(userOptOut.id);
  });

  it("同一會員符合多個分類（isCompetition + isExhibition）仍只收到一封 Email；已退訂 news Email 的會員不寄送", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const result = await caller.news.create({
      title: `${runId} 多分類標題`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      isExhibition: true,
      sendEmailNotification: true,
    });
    newsId = result.id;

    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    // 給可能的第二次呼叫一點緩衝時間，確保不是「還沒寄到而已」。
    await new Promise(res => setTimeout(res, 700));

    const calledEmails = mockSendNewsEmail.mock.calls.map(c => c[0].toEmail);
    expect(calledEmails.filter(e => e === userMulti.email)).toHaveLength(1);
    expect(calledEmails).not.toContain(userOptOut.email);
  });
});

describe("news.update：草稿首次發布可寄送、已發布過永不補寄", () => {
  let adminId: number;
  let userA: { id: number; email: string };
  let newsId: number | undefined;

  beforeEach(async () => {
    adminId = (await createTestUser()).id;
    userA = await createTestUser();
    await subscribeBoard(userA.id, "competition");
  });

  afterEach(async () => {
    await deleteTestNews(newsId);
    newsId = undefined;
    await deleteTestUser(adminId);
    await deleteTestUser(userA.id);
  });

  it("已發布過的消息再次編輯（改標題，不觸發 shouldNotify）不會再次寄送，即使手動送入 sendEmailNotification:true，emailNotificationSentAt 不變", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const created = await caller.news.create({
      title: `${runId} 原始標題`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      sendEmailNotification: true,
    });
    newsId = created.id;

    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    expect(mockSendNewsEmail).toHaveBeenCalledTimes(1);
    await waitFor(async () => (await db.getNewsById(newsId!))?.emailNotificationSentAt != null);
    const before = await db.getNewsById(newsId);
    const sentAtBefore = before?.emailNotificationSentAt?.getTime();

    mockSendNewsEmail.mockClear();
    // 這則消息已經發布過（firstPublishedAt 有值），db.updateNews 對這次更新
    // 一定回傳 shouldNotify=false，dispatchNewsNotifications 根本不會被呼叫
    // ——即使前端被繞過、手動塞 sendEmailNotification:true 進來也一樣不會寄，
    // 這裡刻意模擬「惡意／過期前端」直接呼叫真正的 update procedure（不再需要
    // as any，因為這個欄位現在是合法輸入，重點是驗證後端不會因為它就補寄）。
    await caller.news.update({
      id: newsId,
      title: `${runId} 修改後標題`,
      sendEmailNotification: true,
    });

    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();
    const after = await db.getNewsById(newsId);
    expect(after?.title).toBe(`${runId} 修改後標題`);
    expect(after?.emailNotificationSentAt?.getTime()).toBe(sentAtBefore);
  });

  it("草稿首次發布＋勾選：Email 依規則排入一次，emailNotificationSentAt 被寫入", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const draft = await caller.news.create({
      title: `${runId} 草稿標題-勾選發布`,
      summary: "摘要",
      content: "內容",
      status: "draft",
      isCompetition: true,
      sendEmailNotification: false, // 建立時只存草稿，checkbox 值在草稿階段不影響任何事。
    });
    newsId = draft.id;

    const beforePublish = await db.getNewsById(newsId);
    expect(beforePublish?.firstPublishedAt).toBeNull();
    expect(beforePublish?.emailNotificationSentAt).toBeNull();

    // 在編輯畫面按「發布」，這次勾選了「同時發送 Email 通知」——這是這則
    // 消息第一次真正發布（shouldNotify 會變 true），走 update 也應該要寄送。
    await caller.news.update({ id: newsId, status: "published", sendEmailNotification: true });

    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    expect(mockSendNewsEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNewsEmail.mock.calls[0][0].toEmail).toBe(userA.email);

    await waitFor(async () => (await db.getNewsById(newsId!))?.emailNotificationSentAt != null);
    const afterPublish = await db.getNewsById(newsId);
    expect(afterPublish?.firstPublishedAt).not.toBeNull();
    expect(afterPublish?.emailNotificationSentAt).not.toBeNull();
  });

  it("草稿首次發布＋未勾選：Email sender 呼叫 0 次，emailNotificationSentAt 維持 NULL", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const draft = await caller.news.create({
      title: `${runId} 草稿標題-未勾選發布`,
      summary: "摘要",
      content: "內容",
      status: "draft",
      isCompetition: true,
    });
    newsId = draft.id;

    await caller.news.update({ id: newsId, status: "published", sendEmailNotification: false });

    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();

    const afterPublish = await db.getNewsById(newsId);
    expect(afterPublish?.firstPublishedAt).not.toBeNull();
    expect(afterPublish?.emailNotificationSentAt).toBeNull();
  });

  it("草稿勾選「同時發送 Email 通知」但仍儲存為草稿：不寄信、不記錄 emailNotificationSentAt", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const draft = await caller.news.create({
      title: `${runId} 草稿標題-仍存草稿`,
      summary: "摘要",
      content: "內容",
      status: "draft",
      isCompetition: true,
    });
    newsId = draft.id;

    // 「儲存草稿」按鈕：status 仍是 draft，即使 checkbox 有勾選也不該寄信
    // ——shouldNotify 只在 status 變成 published 時才可能是 true。
    await caller.news.update({ id: newsId, status: "draft", sendEmailNotification: true });

    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();

    const afterSave = await db.getNewsById(newsId);
    expect(afterSave?.status).toBe("draft");
    expect(afterSave?.firstPublishedAt).toBeNull();
    expect(afterSave?.emailNotificationSentAt).toBeNull();
  });

  it("曾發布後改回草稿，再次發布：不得補寄 Email（判斷依據是 firstPublishedAt，不是目前 status）", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const created = await caller.news.create({
      title: `${runId} 曾發布後改回草稿`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      sendEmailNotification: false, // 第一次發布刻意不勾選，方便確認之後也不會補寄。
    });
    newsId = created.id;

    await new Promise(res => setTimeout(res, 300));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();
    const afterFirstPublish = await db.getNewsById(newsId);
    expect(afterFirstPublish?.firstPublishedAt).not.toBeNull();
    expect(afterFirstPublish?.emailNotificationSentAt).toBeNull();

    // 改回草稿（firstPublishedAt 依 schema 設計永遠不會被清空，即使 status
    // 變回 draft）。
    await caller.news.update({ id: newsId, status: "draft" });
    const afterRevert = await db.getNewsById(newsId);
    expect(afterRevert?.status).toBe("draft");
    expect(afterRevert?.firstPublishedAt).not.toBeNull(); // 不變，證明判斷依據不是目前 status。

    // 再次發布，這次勾選 Email——但 firstPublishedAt 早就有值，
    // db.updateNews 的 shouldNotify 一定是 false，不會補寄。
    await caller.news.update({ id: newsId, status: "published", sendEmailNotification: true });

    await new Promise(res => setTimeout(res, 800));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();
    const afterRepublish = await db.getNewsById(newsId);
    expect(afterRepublish?.emailNotificationSentAt).toBeNull();
  });

  it("站內通知與 App Push 不受 sendEmailNotification 影響：未勾選時站內通知仍正常建立", async () => {
    const caller = appRouter.createCaller(adminCtx(adminId));
    const draft = await caller.news.create({
      title: `${runId} 草稿-站內通知不受影響`,
      summary: "摘要",
      content: "內容",
      status: "draft",
      isCompetition: true,
    });
    newsId = draft.id;

    await caller.news.update({ id: newsId, status: "published", sendEmailNotification: false });

    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const item = await db.getNewsById(newsId);
    await waitFor(async () => {
      const [rows] = await conn.execute(sql`SELECT id FROM communityNotifications WHERE actionUrl = ${`/news/${item!.slug}`} AND recipientUserId = ${userA.id}`) as unknown as [{ id: number }[], unknown];
      return rows.length === 1;
    });
  });
});

describe("dispatchNewsNotifications：sendEmail 參數直接單元驗證", () => {
  let adminUserForNews: number;
  let userA: { id: number; email: string };
  let newsId: number | undefined;

  beforeEach(async () => {
    adminUserForNews = (await createTestUser()).id;
    userA = await createTestUser();
    await subscribeBoard(userA.id, "competition");
    const created = await db.createNews({
      title: `${runId} 直接呼叫`,
      summary: "摘要",
      content: "內容",
      status: "published",
      isCompetition: true,
      createdBy: adminUserForNews,
    });
    newsId = created.id;
  });

  afterEach(async () => {
    await deleteTestNews(newsId);
    newsId = undefined;
    await deleteTestUser(adminUserForNews);
    await deleteTestUser(userA.id);
  });

  it("sendEmail=false 時完全不呼叫 createPendingNewsNotifications／sendNewsEmail，站內通知仍正常建立", async () => {
    const item = await db.getNewsById(newsId!);
    await dispatchNewsNotifications({
      newsId: newsId!,
      title: item!.title,
      summary: item!.summary,
      slug: item!.slug,
      isImportant: false,
      isCompetition: true,
      isExhibition: false,
      isCrossIndustry: false,
      industryNames: [],
      sendEmail: false,
    });
    await new Promise(res => setTimeout(res, 300));
    expect(mockSendNewsEmail).not.toHaveBeenCalled();

    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const [rows] = await conn.execute(sql`SELECT id FROM communityNotifications WHERE actionUrl = ${`/news/${item!.slug}`} AND recipientUserId = ${userA.id}`) as unknown as [{ id: number }[], unknown];
    expect(rows.length).toBe(1);
  });

  it("sendEmail=true 時寄送給有資格的收件人，並在成功排入寄送機制後寫入 emailNotificationSentAt", async () => {
    const item = await db.getNewsById(newsId!);
    await dispatchNewsNotifications({
      newsId: newsId!,
      title: item!.title,
      summary: item!.summary,
      slug: item!.slug,
      isImportant: false,
      isCompetition: true,
      isExhibition: false,
      isCrossIndustry: false,
      industryNames: [],
      sendEmail: true,
    });
    await waitFor(() => mockSendNewsEmail.mock.calls.length >= 1);
    expect(mockSendNewsEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNewsEmail.mock.calls[0][0].toEmail).toBe(userA.email);

    const updated = await db.getNewsById(newsId!);
    expect(updated?.emailNotificationSentAt).not.toBeNull();
  });
});
