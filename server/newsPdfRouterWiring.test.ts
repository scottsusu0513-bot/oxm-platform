/**
 * 找消息 PDF 附件 tRPC procedure 真正接線測試。
 *
 * 跟 server/newsMedia.test.ts 裡的原始碼字串斷言不同：這裡用
 * appRouter.createCaller(ctx) 真正呼叫 procedure，證明這些 procedure 確實掛在
 * App 實際使用的主 router（server/routers.ts 匯出的 appRouter，被
 * server/_core/index.ts 的 createExpressMiddleware({ router: appRouter, ... })
 * 掛載為真正的 tRPC HTTP handler），不是只存在於獨立函式或測試 mock 裡。
 *
 * 判斷「procedure 是否存在」的方式：呼叫時如果拿到的是業務邏輯錯誤
 * （UNAUTHORIZED／FORBIDDEN／PRECONDITION_FAILED 等 TRPCError），代表 tRPC
 * 已經成功解析到這個 procedure、執行了它的 middleware／resolver；如果
 * procedure 根本不存在，tRPC 會在解析路徑階段就丟出不同形狀的錯誤
 * （TypeError／"No procedure found on path" 之類），不會是這裡預期的
 * TRPCError code。
 *
 * DB 走真實本機測試資料庫（受 server/test-db-guard.ts 保護）；不呼叫任何
 * AWS SDK（本機沒有設定 AWS_PRIVATE_FILES_BUCKET，procedure 內部的
 * isPrivateStorageConfigured() 檢查會在碰到 AWS SDK 之前就先 throw）。
 */
import { afterAll, describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { isAdminUser } from "./_core/admin";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import type { User } from "../drizzle/schema";

function buildCtx(user: TrpcContext["user"]): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user,
  };
}

const runId = `pdfwiring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createNonAdminTestUser(): Promise<User> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, role)
    VALUES (${openId}, ${`PDF Wiring Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`}, 'user')
  `);
  const [rows] = await conn.execute(sql`SELECT * FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [User[], unknown];
  const row = rows[0];
  if (!row) throw new Error("failed to create test user");
  return row;
}

async function deleteTestUser(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
}

/**
 * Test fixture 缺口修正：優先重用資料庫裡本來就存在、通過
 * ADMIN_WHITELIST_EMAILS／ADMIN_WHITELIST_OPEN_IDS 白名單的既有使用者——
 * 這是這支測試原本的設計精神（驗證真實白名單機制，不是靠 mock ctx.user.role
 * 抄捷徑）。但 oxm_test 是每個環境各自獨立、乾淨的隔離測試庫，不會天生就有
 * 跟 .env 白名單對得上的使用者列——如果真的找不到，改成在這裡（run 階段，
 * 不是模組頂層）建立一筆通過白名單、值只在這個測試 process 存在的 fixture，
 * 一樣是「真實 DB row + 真實 isAdminUser() 判斷」，不是 mock，只是補上
 * oxm_test 原本就沒有的資料，afterAll 清乾淨、不留在 oxm_test。
 */
let createdFixtureAdminId: number | undefined;

afterAll(async () => {
  if (createdFixtureAdminId != null) {
    const conn = await getDb();
    if (conn) await conn.execute(sql`DELETE FROM users WHERE id = ${createdFixtureAdminId}`);
  }
});

async function getRealWhitelistedAdminUser(): Promise<User> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [rows] = await conn.execute(sql`SELECT * FROM users WHERE role = 'admin' LIMIT 5`) as unknown as [User[], unknown];
  const existing = rows.find(u => isAdminUser(u));
  if (existing) return existing;

  const whitelistedEmail = ENV.adminWhitelistEmails[0];
  if (!whitelistedEmail) {
    throw new Error("本機 .env 沒有設定 ADMIN_WHITELIST_EMAILS，無法建立通過白名單的 fixture 使用者");
  }
  const openId = `pdfwiring-admin-fixture-${runId}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, role)
    VALUES (${openId}, ${`PDF Wiring Test Admin ${runId}`}, ${whitelistedEmail}, 'admin')
  `);
  const [created] = await conn.execute(sql`SELECT * FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [User[], unknown];
  const admin = created[0];
  if (!admin || !isAdminUser(admin)) throw new Error("建立的 fixture 使用者未能通過 isAdminUser() 白名單判斷");
  createdFixtureAdminId = admin.id;
  return admin;
}

describe("news router：PDF procedures 真正掛在 appRouter 上（appRouter.createCaller 實際呼叫）", () => {
  it("未登入呼叫 news.getPdfDownloadUrl（protectedProcedure）回傳 UNAUTHORIZED，證明 procedure 真的存在並執行了 requireUser middleware", async () => {
    const caller = appRouter.createCaller(buildCtx(null));
    await expect(caller.news.getPdfDownloadUrl({ attachmentId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("非管理員呼叫 news.createPdfUploadSession（adminProcedure）回傳 FORBIDDEN，證明 procedure 存在並掛在 adminProcedure", async () => {
    let user: User | undefined;
    try {
      user = await createNonAdminTestUser();
      const caller = appRouter.createCaller(buildCtx({ ...user, isAdmin: false }));
      await expect(caller.news.createPdfUploadSession({
        newsId: 1, fileName: "a.pdf", declaredMimeType: "application/pdf", declaredSizeBytes: 1000,
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await deleteTestUser(user?.id);
    }
  });

  it("非管理員呼叫 news.finalizePdfUpload／getAdminAttachments／updateAttachmentExpiration／deleteAttachment 全部回傳 FORBIDDEN（都是 adminProcedure，不是只有部分接線）", async () => {
    let user: User | undefined;
    try {
      user = await createNonAdminTestUser();
      const caller = appRouter.createCaller(buildCtx({ ...user, isAdmin: false }));

      await expect(caller.news.finalizePdfUpload({
        newsId: 1, storageKey: "news-attachments/tmp/abcdef123456.pdf",
        displayName: "x", originalFileName: "x.pdf", expirationType: "never",
      })).rejects.toMatchObject({ code: "FORBIDDEN" });

      await expect(caller.news.getAdminAttachments({ newsId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.news.updateAttachmentExpiration({ id: 1, expirationType: "never" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.news.deleteAttachment({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.news.renameAttachment({ id: 1, displayName: "y" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await deleteTestUser(user?.id);
    }
  });

  it("管理員（真實白名單使用者）呼叫 news.createPdfUploadSession，本機未設定私有 bucket 時真的回 PRECONDITION_FAILED——證明 admin 授權有通過、procedure body 真的執行，且 fail-closed 行為在真實 caller 呼叫下也成立", async () => {
    const admin = await getRealWhitelistedAdminUser();
    expect(isAdminUser(admin)).toBe(true);
    const caller = appRouter.createCaller(buildCtx({ ...admin, isAdmin: true }));
    await expect(caller.news.createPdfUploadSession({
      newsId: 999999999, fileName: "a.pdf", declaredMimeType: "application/pdf", declaredSizeBytes: 1000,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("私有附件儲存尚未設定") });
  });

  it("管理員呼叫 news.getPdfDownloadUrl（未登入以外的一般 protectedProcedure 檢查）：附件不存在時回 NOT_FOUND，不是路由層級錯誤", async () => {
    const admin = await getRealWhitelistedAdminUser();
    const caller = appRouter.createCaller(buildCtx({ ...admin, isAdmin: true }));
    await expect(caller.news.getPdfDownloadUrl({ attachmentId: 999999999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("procedure 名稱與前端 AdminNews／NewsDetail 呼叫完全一致（appRouter 型別層級檢查，只要能通過 pnpm check 就代表沒有 any／缺漏屬性）", () => {
    // 這裡只是把「有沒有這個屬性」的檢查明確寫出來；真正的型別安全保證來自
    // tsc（pnpm check）——如果任何一個 procedure 名稱跟前端呼叫對不上，
    // client/src/pages/AdminNews.tsx／NewsDetail.tsx 裡對應的
    // trpc.news.xxx.useMutation()／useQuery() 呼叫就會編譯失敗，不會是
    // 靜默的 any。
    expect(typeof appRouter.news.createPdfUploadSession).toBe("function");
    expect(typeof appRouter.news.finalizePdfUpload).toBe("function");
    expect(typeof appRouter.news.getPdfDownloadUrl).toBe("function");
    expect(typeof appRouter.news.getAdminAttachments).toBe("function");
    expect(typeof appRouter.news.updateAttachmentExpiration).toBe("function");
    expect(typeof appRouter.news.deleteAttachment).toBe("function");
    expect(typeof appRouter.news.renameAttachment).toBe("function");
  });
});
