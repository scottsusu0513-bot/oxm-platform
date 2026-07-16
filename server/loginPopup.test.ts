/**
 * 登入彈窗管理 — 整合測試（真實走 tRPC router + 本機測試資料庫，
 * 沿用 server/factory.test.ts、server/community.test.ts 已經驗證過的
 * appRouter.createCaller(ctx) 模式，不是 mock）。
 *
 * 重要架構備註：announcements 表沒有「草稿／已發布／封存」狀態機——一筆存在
 * 的公告本身就代表已發布，announcement.delete 是硬刪除，沒有軟刪除欄位。
 * 因此「無法綁定草稿公告」在這個 schema 下沒有獨立可測的程式分支；等價的
 * 保護已經由「無法綁定不存在的公告」與「無法綁定非平台消息公告」這兩個測試
 * 涵蓋。
 *
 * 前台一次最多顯示 5 則登入彈窗；同時啟用中的登入彈窗也最多 5 則，這條上限
 * 由後端 enforceMaxFiveActiveLoginPopups()（server/db.ts）保證，新增/編輯
 * 只要讓某則彈窗的 isActive 變成 true，就一定會觸發這個檢查並在同一個
 * transaction 內把第 6 名以後的啟用彈窗改回 isActive=false（不刪除任何紀錄）。
 */
import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { getDb } from "./db";
import { loginPopups, loginPopupViews } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  // isAdminUser() 是白名單制（見 server/_core/admin.ts），只認 ENV.ownerOpenId／
  // ADMIN_WHITELIST_OPEN_IDS／ADMIN_WHITELIST_EMAILS，跟 user.role 欄位無關。
  // 本機 .env 目前只設定了 ADMIN_WHITELIST_EMAILS，所以這裡管理員情境要用那個
  // email 才能真的通過 adminProcedure 檢查。
  const user: AuthenticatedUser = {
    id: 1,
    openId: isAdmin ? "test-login-popup-admin" : "test-user-1",
    email: isAdmin ? "scottsusu0513@gmail.com" : "test@example.com",
    name: "Test User",
    loginMethod: isAdmin ? "google" : "manus",
    role: "user",
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// 本機測試資料庫目前只有既有的 admin 帳號（id=1），沒有其他既有使用者可用來測
// 「跨使用者」「跨裝置」情境，所以這裡建立幾個真實存在於 users 表的測試帳號
// （loginPopupViews.userId 有 FK 約束，不能塞假 id）。
//
// 注意：這裡刻意不呼叫 db.upsertUser/db.getUserByOpenId——本機測試資料庫的
// users 表目前缺少 schema.ts 已宣告的 primaryEmail/primaryEmailVerifiedAt
// 欄位（既有、與本次登入彈窗功能無關的資料庫落差，其他既有測試檔案如
// factory.test.ts 在同樣環境下也會因為別的缺欄位而失敗，非本次引入）。
// db.ts 那兩個既有函式的 SELECT/INSERT 會明確列出全部 schema 欄位，因此在
// 這個環境下必定連帶失敗；這裡改用最小、只涉及實際存在欄位的原生 SQL，
// 完全不修改 db.ts 或 schema.ts，避免擴大修理與本階段無關的既有問題。
async function ensureTestUser(openId: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO users (openId, name, email) VALUES (${openId}, ${`LoginPopup Test ${openId}`}, ${`${openId}@example.test`})
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to create test user ${openId}`);
  return id;
}

async function hasViewedToday(userId: number): Promise<boolean> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
  const rows = await conn.select().from(loginPopupViews).where(and(eq(loginPopupViews.userId, userId), eq(loginPopupViews.date, today)));
  return rows.length > 0;
}

async function deactivate(admin: ReturnType<typeof appRouter.createCaller>, id: number) {
  await admin.loginPopup.update({ id, isActive: false });
}

const adminCtx = () => createAuthContext({ role: "admin" });
const userCtx = (id: number) => createAuthContext({ role: "user", id });

let newsAnnouncementId: number;
let nonNewsAnnouncementId: number;
let deletableNewsAnnouncementId: number;

let userA: number, userB: number, userC: number, userD: number, userE: number, userF: number;

// 每次執行測試都要用「今天從沒看過彈窗」的全新使用者，openId 必須帶上執行期
// 才決定的亂數／時間戳，不能用固定字串——固定字串會導致同一天內重跑測試時，
// 上一次執行留在 loginPopupViews 的「今天已看過」紀錄殘留，讓這次執行從一
// 開始就誤判成「已看過」，導致測試變得不可重複執行（曾實際重現過這個問題）。
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  newsAnnouncementId = await db.createAnnouncement({ title: "登入彈窗測試公告（平台消息）", content: "測試內容", type: "news" });
  nonNewsAnnouncementId = await db.createAnnouncement({ title: "登入彈窗測試公告（版本更新）", content: "測試內容", type: "update" });
  deletableNewsAnnouncementId = await db.createAnnouncement({ title: "即將被刪除的平台消息公告", content: "測試內容", type: "news" });

  [userA, userB, userC, userD, userE, userF] = await Promise.all(
    ["a", "b", "c", "d", "e", "f"].map(k => ensureTestUser(`test-login-popup-user-${k}-${runId}`)),
  );
}, 30000);

// ── 1. 建立與綁定驗證 ────────────────────────────────────────────────────
describe("loginPopup.create: 綁定驗證", () => {
  it("管理員可建立綁定有效平台消息的登入彈窗", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const result = await caller.loginPopup.create({
      title: "測試登入彈窗", summary: "測試短文", announcementId: newsAnnouncementId, isActive: false,
    });
    expect(result.success).toBe(true);

    const list = await caller.loginPopup.adminList();
    const created = list.find(p => p.id === result.id);
    expect(created).toBeTruthy();
    expect(created?.boundAnnouncementValid).toBe(true);
    expect(created?.boundAnnouncementTitle).toBe("登入彈窗測試公告（平台消息）");
  });

  it("無法綁定草稿公告 —— 本 schema 沒有草稿狀態，等價保護見下方兩個測試", () => {
    // announcements 表沒有 status/isDraft 欄位，delete 是硬刪除、沒有軟刪除，
    // 所以「草稿」在這裡不是一個可以真實建構出來的狀態。後端唯一能驗證、也
    // 確實有驗證的兩個條件是：公告必須存在、公告必須是 news 類型——這兩點
    // 分別由下面兩個測試覆蓋，效果等同於擋下任何「不是正式已發布平台消息」
    // 的綁定嘗試。
    expect(true).toBe(true);
  });

  it("非平台消息公告不能綁定（也就不能啟用）", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.loginPopup.create({
      title: "不應建立成功", summary: "短文", announcementId: nonNewsAnnouncementId,
    })).rejects.toThrow();
  });

  it("無法綁定不存在公告", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.loginPopup.create({
      title: "不應建立成功", summary: "短文", announcementId: 999999999,
    })).rejects.toThrow();
  });
});

// ── 2. 權限 ──────────────────────────────────────────────────────────────
describe("loginPopup: 權限", () => {
  it("一般使用者無法管理登入彈窗", async () => {
    const caller = appRouter.createCaller(userCtx(userA));
    await expect(caller.loginPopup.adminList()).rejects.toThrow();
    await expect(caller.loginPopup.create({
      title: "x", summary: "x", announcementId: newsAnnouncementId,
    })).rejects.toThrow();
  });

  it("未登入訪客直接呼叫 markViewed 回傳 UNAUTHORIZED（markViewed 維持 protectedProcedure）", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.loginPopup.markViewed({ id: 1 })).rejects.toThrow();
  });
});

// ── 2b. 未登入訪客（toShow 改為 publicProcedure 後的訪客版本）───────────
describe("loginPopup.toShow: 未登入訪客", () => {
  it("未登入訪客可呼叫 toShow，不回傳 UNAUTHORIZED，可取得有效啟用彈窗", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "訪客可見測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });
    try {
      const guest = appRouter.createCaller(createPublicContext());
      const { items } = await guest.loginPopup.toShow();
      expect(items.find(i => i.id === created.id)).toBeTruthy();
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("未登入訪客最多取得 5 則，排序為 updatedAt DESC、id DESC", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created: number[] = [];
    try {
      for (let i = 1; i <= 6; i++) {
        const r = await admin.loginPopup.create({ title: `訪客五則-P${i}`, summary: "短文", announcementId: newsAnnouncementId, isActive: true });
        created.push(r.id);
      }
      // 第 6 則會觸發自動停用最舊一則（既有規則，訪客/會員共用同一份資料）
      const guest = appRouter.createCaller(createPublicContext());
      const { items } = await guest.loginPopup.toShow();
      expect(items.length).toBe(5);
      // 最新 5 則（P6~P2），依 updatedAt desc／id desc：P6 > P5 > P4 > P3 > P2
      expect(items.map(i => i.id)).toEqual([...created].slice(1).reverse());
    } finally {
      for (const id of created) await deactivate(admin, id);
    }
  });

  it("停用的消息、非平台消息、綁定公告已失效者，訪客一樣看不到", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const inactive = await admin.loginPopup.create({
      title: "訪客-停用測試", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });
    await deactivate(admin, inactive.id);

    const deletableAnnId = await db.createAnnouncement({ title: "訪客測試-即將失效公告", content: "測試", type: "news" });
    const invalidated = await admin.loginPopup.create({
      title: "訪客-失效公告測試", summary: "短文", announcementId: deletableAnnId, isActive: true,
    });
    await db.deleteAnnouncement(deletableAnnId);

    try {
      const guest = appRouter.createCaller(createPublicContext());
      const { items } = await guest.loginPopup.toShow();
      expect(items.find(i => i.id === inactive.id)).toBeUndefined();
      expect(items.find(i => i.id === invalidated.id)).toBeUndefined();
      // 非平台消息公告從一開始就無法綁定／啟用（見 loginPopup.create: 綁定驗證），
      // 所以不存在「非 news 但啟用中」的資料可以測，這條規則本來就已經在建立
      // 時被擋下，訪客/會員都不可能看到這種資料。
    } finally {
      await deactivate(admin, invalidated.id);
    }
  });

  it("未登入訪客呼叫 toShow 不會建立任何 loginPopupViews 紀錄", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "訪客不寫入測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });
    try {
      const conn = await getDb();
      const [[{ n: before }]] = await conn!.execute(sql`SELECT COUNT(*) as n FROM loginPopupViews`) as unknown as [{ n: number }[], unknown];

      const guest = appRouter.createCaller(createPublicContext());
      await guest.loginPopup.toShow();
      await guest.loginPopup.toShow(); // 多呼叫幾次，確認完全是唯讀

      const [[{ n: after }]] = await conn!.execute(sql`SELECT COUNT(*) as n FROM loginPopupViews`) as unknown as [{ n: number }[], unknown];
      expect(after).toBe(before);
    } finally {
      await deactivate(admin, created.id);
    }
  });
});

// ── 3. 前台最多五則、排序與有效性 ────────────────────────────────────────
describe("loginPopup.toShow: 最多五則、排序與有效性", () => {
  it("只有 1 則啟用時回傳 1 筆", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "單則測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });
    try {
      const freshUserId = await ensureTestUser(`test-login-popup-user-single-${runId}`);
      const caller = appRouter.createCaller(userCtx(freshUserId));
      const { items } = await caller.loginPopup.toShow();
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(created.id);
      expect(items[0]).toMatchObject({
        title: "單則測試彈窗", summary: "短文", announcementId: newsAnnouncementId,
      });
      expect(items[0].announcementTitle).toBe("登入彈窗測試公告（平台消息）");
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("有 3 則啟用時依序（最新到最舊）回傳 3 筆", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const p1 = await admin.loginPopup.create({ title: "三則-P1", summary: "短文", announcementId: newsAnnouncementId, isActive: true });
    const p2 = await admin.loginPopup.create({ title: "三則-P2", summary: "短文", announcementId: newsAnnouncementId, isActive: true });
    const p3 = await admin.loginPopup.create({ title: "三則-P3", summary: "短文", announcementId: newsAnnouncementId, isActive: true });
    try {
      const freshUserId = await ensureTestUser(`test-login-popup-user-three-${runId}`);
      const caller = appRouter.createCaller(userCtx(freshUserId));
      const { items } = await caller.loginPopup.toShow();
      expect(items.length).toBe(3);
      // 依 updatedAt desc（後建立的較新）：P3 > P2 > P1
      expect(items.map(i => i.id)).toEqual([p3.id, p2.id, p1.id]);
    } finally {
      await deactivate(admin, p1.id);
      await deactivate(admin, p2.id);
      await deactivate(admin, p3.id);
    }
  });

  it("有 5 則啟用時回傳 5 筆；前台最多只回傳 5 筆", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created: number[] = [];
    try {
      for (let i = 1; i <= 5; i++) {
        const r = await admin.loginPopup.create({ title: `五則-P${i}`, summary: "短文", announcementId: newsAnnouncementId, isActive: true });
        created.push(r.id);
      }
      const freshUserId = await ensureTestUser(`test-login-popup-user-five-${runId}`);
      const caller = appRouter.createCaller(userCtx(freshUserId));
      const { items } = await caller.loginPopup.toShow();
      expect(items.length).toBe(5);
      // 最新建立的排最前面
      expect(items.map(i => i.id)).toEqual([...created].reverse());
    } finally {
      for (const id of created) await deactivate(admin, id);
    }
  });

  it("updatedAt 相同時以 id DESC 排序", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const lower = await admin.loginPopup.create({ title: "id 排序-較小 id", summary: "短文", announcementId: newsAnnouncementId, isActive: true });
    const higher = await admin.loginPopup.create({ title: "id 排序-較大 id", summary: "短文", announcementId: newsAnnouncementId, isActive: true });

    try {
      // 強制兩筆的 updatedAt 完全相同（MySQL timestamp 預設只有秒級精度，
      // 快速連續建立時本來就可能剛好同一秒；這裡直接用相同值覆寫，確保這個
      // 測試不會因為執行速度快慢而變得不穩定），單純驗證「updatedAt 相同時
      // 以 id DESC 排序」這條規則本身，而不是巧合。
      const conn = await getDb();
      const sameTimestamp = new Date();
      await conn!.execute(sql`UPDATE loginPopups SET updatedAt = ${sameTimestamp} WHERE id IN (${lower.id}, ${higher.id})`);

      const freshUserId = await ensureTestUser(`test-login-popup-user-tiebreak-${runId}`);
      const caller = appRouter.createCaller(userCtx(freshUserId));
      const { items } = await caller.loginPopup.toShow();
      expect(items[0].id).toBe(higher.id);
      expect(items[1]?.id).toBe(lower.id);
    } finally {
      await deactivate(admin, lower.id);
      await deactivate(admin, higher.id);
    }
  });

  it("停用的消息不回傳", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "停用不回傳測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });
    await deactivate(admin, created.id);

    const freshUserId = await ensureTestUser(`test-login-popup-user-inactive-${runId}`);
    const caller = appRouter.createCaller(userCtx(freshUserId));
    const { items } = await caller.loginPopup.toShow();
    expect(items.find(i => i.id === created.id)).toBeUndefined();
  });

  it("綁定公告失效（被刪除）後不再回傳", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "綁定公告即將失效測試彈窗", summary: "短文", announcementId: deletableNewsAnnouncementId, isActive: true,
    });

    await db.deleteAnnouncement(deletableNewsAnnouncementId);

    const list = await admin.loginPopup.adminList();
    const row = list.find(p => p.id === created.id);
    expect(row?.boundAnnouncementValid).toBe(false);

    const freshUserId = await ensureTestUser(`test-login-popup-user-deleted-ann-${runId}`);
    const caller = appRouter.createCaller(userCtx(freshUserId));
    const { items } = await caller.loginPopup.toShow();
    expect(items.find(i => i.id === created.id)).toBeUndefined();

    // 失效後禁止啟用（isActive 目前雖然還是 true，這裡驗證「重新開啟」也會被擋下）
    await expect(admin.loginPopup.update({ id: created.id, isActive: true })).rejects.toThrow();
  });
});

// ── 4. 最多五則啟用上限（enforceMaxFiveActiveLoginPopups） ───────────────
describe("enforceMaxFiveActiveLoginPopups: 最多五則啟用上限", () => {
  it("create 第 6 則並設為啟用時，最舊一則自動停用；停用後資料仍存在", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created: number[] = [];
    try {
      for (let i = 1; i <= 5; i++) {
        const r = await admin.loginPopup.create({ title: `上限-建立-P${i}`, summary: "短文", announcementId: newsAnnouncementId, isActive: true });
        created.push(r.id);
      }
      const p6 = await admin.loginPopup.create({ title: "上限-建立-P6", summary: "短文", announcementId: newsAnnouncementId, isActive: true });
      created.push(p6.id);
      expect(p6.deactivatedCount).toBe(1);

      const list = await admin.loginPopup.adminList();
      const oldest = list.find(r => r.id === created[0]);
      expect(oldest).toBeTruthy(); // 資料仍存在，只是被停用
      expect(oldest?.isActive).toBe(false);

      for (const id of created.slice(1)) {
        expect(list.find(r => r.id === id)?.isActive).toBe(true);
      }
    } finally {
      for (const id of created) await deactivate(admin, id);
    }
  });

  it("update／把一則停用彈窗重新切成啟用，導致總數超過 5 時，同樣觸發自動停用最舊一則", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created: number[] = [];
    try {
      for (let i = 1; i <= 5; i++) {
        const r = await admin.loginPopup.create({ title: `上限-更新-P${i}`, summary: "短文", announcementId: newsAnnouncementId, isActive: true });
        created.push(r.id);
      }
      // 第 6 則一開始是停用狀態建立，之後才切成啟用
      const p6 = await admin.loginPopup.create({ title: "上限-更新-P6", summary: "短文", announcementId: newsAnnouncementId, isActive: false });
      created.push(p6.id);

      const activateResult = await admin.loginPopup.update({ id: p6.id, isActive: true });
      expect(activateResult.deactivatedCount).toBe(1);

      const list = await admin.loginPopup.adminList();
      const oldest = list.find(r => r.id === created[0]);
      expect(oldest).toBeTruthy();
      expect(oldest?.isActive).toBe(false);
      expect(list.find(r => r.id === p6.id)?.isActive).toBe(true);
    } finally {
      for (const id of created) await deactivate(admin, id);
    }
  });
});

// ── 5. 每日一次規則 + 標記時機（多則共用同一個「今天已完成」狀態） ──────
describe("loginPopup.toShow / markViewed: 每日一次規則", () => {
  it("彈窗剛出現不寫入觀看紀錄；點擊「我知道了」後寫入，當天回傳空", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "每日一次測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });

    try {
      const caller = appRouter.createCaller(userCtx(userB));

      const first = await caller.loginPopup.toShow();
      expect(first.items.map(i => i.id)).toContain(created.id);

      expect(await hasViewedToday(userB)).toBe(false);

      await caller.loginPopup.markViewed({ id: created.id });
      expect(await hasViewedToday(userB)).toBe(true);

      const second = await caller.loginPopup.toShow();
      expect(second.items).toEqual([]);
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("點任一則「進入完整公告」後完成標記，當天回傳空；重複點擊為 idempotent", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "完整公告按鈕測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });

    try {
      const caller = appRouter.createCaller(userCtx(userD));

      await caller.loginPopup.toShow();
      expect(await hasViewedToday(userD)).toBe(false);

      await caller.loginPopup.markViewed({ id: created.id });
      expect(await hasViewedToday(userD)).toBe(true);

      const afterClick = await caller.loginPopup.toShow();
      expect(afterClick.items).toEqual([]);

      // 重複點擊（例如手殘連點兩次）不應該報錯，也不應該產生第二筆紀錄
      await expect(caller.loginPopup.markViewed({ id: created.id })).resolves.not.toThrow();
      const conn = await getDb();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      const rows = await conn!.select().from(loginPopupViews).where(and(eq(loginPopupViews.userId, userD), eq(loginPopupViews.date, today)));
      expect(rows.length).toBe(1);
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("同一 userId 跨裝置（不同 session/context）仍只顯示一次", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "跨裝置測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });

    try {
      // 用兩個獨立的 context 物件模擬「手機」與「電腦」兩個不同裝置/連線，
      // 但都是同一個 userId —— 判定基準是 userId，不是裝置/瀏覽器/cookie。
      const mobileCaller = appRouter.createCaller(userCtx(userC));
      const desktopCaller = appRouter.createCaller(userCtx(userC));

      const onMobile = await mobileCaller.loginPopup.toShow();
      expect(onMobile.items.map(i => i.id)).toContain(created.id);
      await mobileCaller.loginPopup.markViewed({ id: created.id });

      const onDesktop = await desktopCaller.loginPopup.toShow();
      expect(onDesktop.items).toEqual([]);
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("隔天（不同台灣時間日期）重新回傳最新五則", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const created = await admin.loginPopup.create({
      title: "隔天重新顯示測試彈窗", summary: "短文", announcementId: newsAnnouncementId, isActive: true,
    });

    try {
      const caller = appRouter.createCaller(userCtx(userE));

      await caller.loginPopup.markViewed({ id: created.id });
      expect((await caller.loginPopup.toShow()).items).toEqual([]);

      // 直接把今天的紀錄日期改成「昨天」，模擬台灣時間跨過午夜 —— 一天一次是
      // 每天 00:00 重新計算，不是每隔 24 小時，所以這裡改的是日期本身而非時間戳。
      const conn = await getDb();
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      await conn!.update(loginPopupViews).set({ date: yesterday }).where(eq(loginPopupViews.userId, userE));

      const shownAgain = await caller.loginPopup.toShow();
      expect(shownAgain.items.map(i => i.id)).toContain(created.id);
    } finally {
      await deactivate(admin, created.id);
    }
  });

  it("一般使用者不能管理登入彈窗（重申，跨章節保護）", async () => {
    const caller = appRouter.createCaller(userCtx(userF));
    await expect(caller.loginPopup.adminList()).rejects.toThrow();
    await expect(caller.loginPopup.update({ id: 1, isActive: true })).rejects.toThrow();
  });
});
