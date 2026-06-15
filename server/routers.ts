import { COOKIE_NAME, THIRTY_DAYS_MS, COMMUNITY_FEATURE_STATUS, PLATFORM_NOTIFICATION_TYPES, COMMUNITY_PUBLIC_ENTRY_ENABLED } from "@shared/const";
import { sdk } from "./_core/sdk";
import { enhanceSearchKeyword, getSearchIntent } from './semantic-search';
import { sendNewInquiryEmail, sendFactoryApprovedEmail, sendFactoryRejectedEmail, sendFactorySubmittedEmail, sendReportEmail, sendSupportTicketEmail, sendReviewReplyEmail, sendNewMessageNotificationEmail, sendReportStatusUpdateEmail, sendTicketStatusUpdateEmail, sendMessageReplyNotificationEmail, sendEmailVerificationEmail, sendAdminBroadcastEmail, sendRevisionSubmittedEmail, sendRevisionApprovedEmail, sendRevisionRejectedEmail, sendUpgradeApplicationEmail } from './email';
import { sha256Hex, generateRawToken } from './_core/oauthHelpers';
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { notifyOwner } from "./_core/notification";
import { storagePut, storagePresignedUrl } from "./storage";
import { validateImageUpload } from "./_core/security";
import { INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS, INDUSTRY_SLUGS } from "../shared/constants";
import { nanoid } from "nanoid";
import { factories, conversations, reviews, reports, factoryCoManagers, users, upgradeConsultants } from "../drizzle/schema";
import { desc, eq, and, sql, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { sendPushToUser, sendPushToRecipients } from "./push";
import { createPlatformNotifications } from "./notifications";

function requireVerifiedEmail(user: { primaryEmailVerifiedAt: Date | null }): void {
  if (!user.primaryEmailVerifiedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "UNVERIFIED_EMAIL" });
  }
}

// Returns null (no filter) for admin or when community is public; otherwise restricts to platform-only types.
function getVisibleTypesForUser(role: string): string[] | null {
  return (role === "admin" || COMMUNITY_PUBLIC_ENTRY_ENABLED)
    ? null
    : Array.from(PLATFORM_NOTIFICATION_TYPES);
}

async function assertFactoryManager(factoryId: number, userId: number) {
  const factory = await db.getFactoryById(factoryId);
  if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
  if (factory.ownerId !== userId) {
    const isCoMgr = await db.isActiveCoManager(factory.id, userId);
    if (!isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限操作此工廠" });
  }
  return factory;
}

// Validates proposedData field types — enforces correct types at submission and approve time.
// All fields are partial since proposedData only includes the fields being changed.
const FactoryBasicDataSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.array(z.string()),
  subIndustry: z.array(z.string()),
  mfgModes: z.array(z.string()),
  region: z.string(),
  description: z.string().nullable(),
  capitalLevel: z.string(),
  foundedYear: z.number().int().nullable(),
  ownerName: z.string().nullable(),
  contactPersonName: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string(),
  operationStatus: z.enum(["normal", "busy", "full"]),
  weekdayHours: z.string().nullable(),
  weekendHours: z.string().nullable(),
  businessNote: z.string().nullable(),
  avatarUrl: z.string().nullable(),
}).partial();

// ===== 商案討論區 helpers =====
// Valid space codes: 12 industry slugs + "cross-industry"
const COMMUNITY_CROSS_INDUSTRY_SLUG = "cross-industry" as const;

// Returns the expected URL prefix for community post images uploaded via uploadPostImage.
// The key pattern is community-posts/{userId}/{nanoid}.{ext}
// If S3 is not configured, returns null and validation is skipped (dev/test env).
function getCommunityImageUrlPrefix(userId: number): string | null {
  const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "")
    ?? (process.env.AWS_S3_BUCKET
      ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-southeast-1"}.amazonaws.com`
      : null);
  if (!base) return null;
  return `${base}/community-posts/${userId}/`;
}

function assertCommunityImagesOwned(images: string[], userId: number): void {
  if (images.length === 0) return;
  const s3Bucket = process.env.AWS_S3_BUCKET;
  const s3Region = process.env.AWS_REGION ?? "ap-southeast-1";
  const s3PublicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!s3Bucket && !s3PublicBase) {
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "圖片儲存服務未設定，無法提交圖片" });
    }
    return; // dev/test only: S3 not configured, skip validation
  }
  const expectedOrigin = s3PublicBase
    ? new URL(s3PublicBase).origin
    : `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;
  const expectedPathPrefix = `/community-posts/${userId}/`;
  for (const urlStr of images) {
    let parsed: URL;
    try { parsed = new URL(urlStr); } catch {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
    if (parsed.origin !== expectedOrigin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath.includes("/..") || !decodedPath.startsWith(expectedPathPrefix)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
  }
}
const VALID_SPACE_CODES = new Set<string>([
  ...Object.values(INDUSTRY_SLUGS),
  COMMUNITY_CROSS_INDUSTRY_SLUG,
]);

// Reverse mapping: slug → display name (for notifications)
const SPACE_CODE_TO_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [COMMUNITY_CROSS_INDUSTRY_SLUG]: "跨產業交流區",
};
function getSpaceName(spaceCode: string): string {
  return SPACE_CODE_TO_NAME[spaceCode] ?? spaceCode;
}

type TrpcUserCtx = { role: "user" | "admin"; id: number } | null | undefined;

function checkCommunityRead(user: TrpcUserCtx): void {
  if (COMMUNITY_FEATURE_STATUS === "coming_soon" || COMMUNITY_FEATURE_STATUS === "maintenance") {
    throw new TRPCError({ code: "FORBIDDEN", message: "商案討論區尚未開放" });
  }
  if (COMMUNITY_FEATURE_STATUS === "beta" && user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "此功能目前僅限管理員內測使用" });
  }
}

function checkCommunityWrite(user: TrpcUserCtx): void {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  checkCommunityRead(user);
}

function assertValidSpaceCode(spaceCode: string): void {
  if (!VALID_SPACE_CODES.has(spaceCode)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "無效的討論區代碼" });
  }
}

export const appRouter = router({
  system: systemRouter,

  analytics: router({
    record: publicProcedure.input(z.object({ visitorId: z.string().regex(/^[a-zA-Z0-9\-_]+$/).min(1).max(64) })).mutation(async ({ input }) => {
      await db.recordPageView(input.visitorId);
    }),
    getStats: adminProcedure.query(async () => {
      return db.getPageViewStats();
    }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const isLocal = ["localhost", "127.0.0.1", "::1"].includes(ctx.req.hostname);
      const secureFlag = isLocal ? "" : "; Secure";
      ctx.res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`);
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),

    // 設定主要信箱（未驗證，之後再寄驗證信）
    setPrimaryEmail: protectedProcedure.input(z.object({
      email: z.string().email().max(320),
    })).mutation(async ({ ctx, input }) => {
      if (input.email.toLowerCase().endsWith("@privaterelay.appleid.com")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不可使用 Apple 隱藏信箱作為主要信箱" });
      }
      await db.setPrimaryEmail(ctx.user.id, input.email);
      return { success: true };
    }),

    // 寄送驗證信（寄到 primaryEmail）
    sendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user?.primaryEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先設定主要信箱" });
      }
      if (user.primaryEmailVerifiedAt) {
        return { success: true, alreadyVerified: true };
      }
      // Cooldown: prevent re-sending within 5 minutes
      const recent = await db.getLatestEmailVerificationToken(user.id, user.primaryEmail);
      if (recent && recent.createdAt > new Date(Date.now() - 5 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "驗證信已寄出，請稍後再試" });
      }
      const rawToken = generateRawToken();
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.createEmailVerificationToken({ userId: user.id, tokenHash, email: user.primaryEmail, expiresAt });
      const baseUrl = process.env.OAUTH_SERVER_URL || "https://www.oxmmatch.com";
      const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;
      try {
        await sendEmailVerificationEmail({
          toEmail: user.primaryEmail,
          userName: user.name,
          verifyUrl,
        });
      } catch (err) {
        console.error("[auth] sendVerificationEmail failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "驗證信寄送失敗，請稍後再試" });
      }
      return { success: true };
    }),

    // 驗證信箱 token（從 email 點連結後呼叫）
    verifyEmail: publicProcedure.input(z.object({
      token: z.string().min(1).max(128),
    })).mutation(async ({ input, ctx }) => {
      const tokenHash = sha256Hex(input.token);
      const result = await db.consumeEmailVerificationToken(tokenHash);
      if (!result.valid || !result.userId || !result.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TOKEN_INVALID_OR_EXPIRED" });
      }

      // 主帳號制：查是否已有其他 user 驗證同一個 primaryEmail
      const existingVerified = await db.getUserByPrimaryEmail(result.email);

      if (!existingVerified || existingVerified.id === result.userId) {
        // 無衝突：一般流程
        await db.setPrimaryEmailVerified(result.userId, result.email);
        return { success: true, merged: false };
      }

      // 已有主帳號 — 執行綁定合併
      // 安全檢查：暫時 user 是否已有重要資料
      const hasActivity = await db.userHasImportantActivity(result.userId);
      if (hasActivity) {
        throw new TRPCError({ code: "CONFLICT", message: "此帳號已有使用紀錄，請聯繫客服協助合併帳號。" });
      }

      // 取得暫時 user 的所有 provider auth accounts
      const tempAccounts = await db.getAuthAccountsByUserId(result.userId);

      // 檢查主帳號是否已有相同 provider（避免覆蓋）
      for (const acc of tempAccounts) {
        const conflict = await db.getAuthAccountByProviderForUser(existingVerified.id, acc.provider);
        if (conflict) {
          throw new TRPCError({ code: "CONFLICT", message: "此登入方式已綁定到您的既有帳號，請直接使用原登入方式登入。" });
        }
      }

      // 改綁所有 auth accounts 到主帳號，清空暫時 user 的 primaryEmail
      for (const acc of tempAccounts) {
        await db.reassignAuthAccountToUser(acc.id, existingVerified.id);
      }
      await db.clearPrimaryEmail(result.userId);

      // 切換 session 到主帳號（與 OAuth 登入完全一致的 cookie 設定）
      const sessionToken = await sdk.createSessionToken(existingVerified.openId, { expiresInMs: THIRTY_DAYS_MS });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });

      return { success: true, merged: true };
    }),

    // 查目前登入 user 已綁定的 provider 列表
    myLinkedProviders: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await db.getAuthAccountsByUserId(ctx.user.id);
      return accounts.map(a => ({ provider: a.provider, providerEmail: a.providerEmail ?? null }));
    }),
  }),

  // ===== 會員中心 =====
  user: router({
    updateProfile: protectedProcedure.input(z.object({
      name: z.string().min(1).max(100).optional(),
      phone: z.string().max(30).optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.updateUserProfile(ctx.user.id, input);
      return { success: true };
    }),
    updateNotificationSettings: protectedProcedure.input(z.object({
      settings: z.record(z.string(), z.boolean()),
    })).mutation(async ({ ctx, input }) => {
      await db.updateUserNotificationSettings(ctx.user.id, input.settings as Record<string, boolean>);
      return { success: true };
    }),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      await db.softDeleteUser(ctx.user.id);
      const isLocalReq = ["localhost", "127.0.0.1", "::1"].includes(ctx.req.hostname);
      ctx.res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isLocalReq ? "" : "; Secure"}`);
      return { success: true };
    }),
  }),

  // ===== 客服工單 =====
  support: router({
    create: protectedProcedure.input(z.object({
      type: z.string().min(1).max(50),
      subject: z.string().min(1).max(200),
      description: z.string().min(1).max(5000),
    })).mutation(async ({ ctx, input }) => {
      await db.createSupportTicket({ ...input, userId: ctx.user.id });
      sendSupportTicketEmail({
        userName: ctx.user.name ?? '未知用戶',
        userEmail: ctx.user.email,
        type: input.type,
        subject: input.subject,
        description: input.description,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),
    myTickets: protectedProcedure.query(async ({ ctx }) => {
      return db.getMySupportTickets(ctx.user.id);
    }),
    myTicketHistory: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const myTickets = await db.getMySupportTickets(ctx.user.id);
      if (!myTickets.find(t => t.id === input.id)) throw new Error("無權限");
      return db.getTicketHistory(input.id);
    }),
  }),

  // ===== 工廠 =====
  factory: router({
    getById: publicProcedure.input(z.object({
      id: z.number(),
      // Pass true from FactoryDashboard to include latestRevision without a separate query.
      // Omit (or false) for public browsing to avoid the extra DB round-trip.
      includeRevision: z.boolean().optional().default(false),
    })).query(async ({ input, ctx }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) return null;
      const authedUser = ctx.user;
      let isAuthorized = false;
      // Non-approved factories are only visible to their owner, co-managers, and admins
      if (factory.status !== "approved") {
        if (!authedUser) return null;
        if (authedUser.isAdmin) {
          isAuthorized = true;
        } else {
          const isOwner = factory.ownerId === authedUser.id;
          if (isOwner) {
            isAuthorized = true;
          } else {
            const isCoMgr = await db.isActiveCoManager(factory.id, authedUser.id);
            if (!isCoMgr) return null;
            isAuthorized = true;
          }
        }
      } else if (input.includeRevision && authedUser) {
        // Approved factory: only fetch revision info when explicitly requested by an authorized user
        if (authedUser.isAdmin || factory.ownerId === authedUser.id) {
          isAuthorized = true;
        } else {
          isAuthorized = await db.isActiveCoManager(factory.id, authedUser.id);
        }
      }
      const [prods, latestRevision] = await Promise.all([
        db.getProductsByFactoryId(input.id),
        isAuthorized && input.includeRevision ? db.getLatestRevisionByFactory(input.id) : Promise.resolve(null),
      ]);
      return { ...factory, products: prods, latestRevision: latestRevision ?? null };
    }),

    getMine: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) return null;
      const [prods, latestRevision] = await Promise.all([
        db.getProductsByFactoryId(factory.id),
        db.getLatestRevisionByFactory(factory.id),
      ]);
      return { ...factory, products: prods, latestRevision: latestRevision ?? null };
    }),

    create: protectedProcedure.input(z.object({
      name: z.string().min(1).max(200),
      industry: z.array(z.string()).min(1),
      subIndustry: z.array(z.string()).optional(),
      mfgModes: z.array(z.string()).min(1),
      region: z.string(),
      description: z.string().optional(),
      capitalLevel: z.string(),
      address: z.string().min(1),
      foundedYear: z.number().min(1800).max(2100).optional().nullable(),
      avatarUrl: z.string().regex(/^https?:\/\//, "avatarUrl 必須為 http/https URL").optional().nullable(),
      businessType: z.enum(["factory", "studio"]).default("factory"),
      ownerName: z.string().optional(),
      contactPersonName: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().email().optional().or(z.literal("")),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      try {
        // createFactoryAtomic 使用 transaction + users row lock
        // admin 亦受同一規則約束：無法繞過一人一間工廠限制
        const factoryId = await db.createFactoryAtomic(ctx.user.id, input);
        return { id: factoryId };
      } catch (err: any) {
        const BAD = ["您已擁有工廠，無法再次建立工廠", "您已隸屬其他工廠，無法建立新的工廠"];
        if (BAD.includes(err?.message)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        console.error('[factory.create] DB error:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '建立工廠失敗，請稍後再試' });
      }
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      industry: z.array(z.string()).min(1).optional(),
      subIndustry: z.array(z.string()).optional(),
      mfgModes: z.array(z.string()).optional(),
      region: z.string().optional(),
      description: z.string().optional(),
      capitalLevel: z.string().optional(),
      foundedYear: z.number().min(1800).max(2100).optional().nullable(),
      ownerName: z.string().optional(),
      contactPersonName: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().optional(),
      businessType: z.enum(["factory", "studio"]).optional(),
      avatarUrl: z.string().regex(/^https?:\/\//, "avatarUrl 必須為 http/https URL").optional(),
      address: z.string().optional(),
      operationStatus: z.enum(["normal", "busy", "full"]).optional(),
      weekdayHours: z.string().max(50).optional(),
      weekendHours: z.string().max(50).optional(),
      businessNote: z.string().max(500).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const { id, ...data } = input;
      const factory = await db.getFactoryById(id);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '工廠不存在' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限修改此工廠' });

      // Status-based routing
      if (factory.status === 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '首次申請審核中，請等待審核完成後再修改資料' });
      }
      if (factory.status === 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '已上線工廠的基本資料需透過「修改申請」流程更改，請使用提交修改申請功能' });
      }

      // draft / rejected → allow direct update
      try {
        await db.updateFactory(id, isOwner ? ctx.user.id : -1, data);
      } catch (err: any) {
        console.error('[factory.update] DB error:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '更新工廠失敗，請稍後再試' });
      }
      return { success: true };
    }),

    submitRevision: protectedProcedure.input(z.object({
      factoryId: z.number(),
      proposedData: z.record(z.string(), z.any()),
      revisionReason: z.string().trim().min(2, "修改原因至少 2 個字").max(200, "修改原因最多 200 個字"),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });

      // Only owner or active co-manager may submit a revision
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '無權限提交此工廠的修改申請' });
      }

      if (factory.status !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '只有已上線的工廠才能提交修改申請' });
      }

      // Application-layer duplicate check (DB unique index is the final safety net)
      const existing = await db.getPendingRevisionByFactory(factory.id);
      if (existing) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '已有一筆審核中的修改申請，請等待審核完成後再提交新申請' });
      }

      // Read original data from DB — never trust the frontend for originalData
      const originalData = db.extractBasicData(factory);

      // Whitelist: strip any fields not in BASIC_DATA_FIELDS
      const allowedSet = new Set(db.BASIC_DATA_FIELDS as readonly string[]);
      const proposedData: Record<string, any> = {};
      for (const key of Object.keys(input.proposedData)) {
        if (allowedSet.has(key)) {
          proposedData[key] = input.proposedData[key];
        }
      }

      if (Object.keys(proposedData).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請必須包含至少一個欄位' });
      }

      // Runtime type validation: reject incorrect field value types (e.g. string where array expected)
      const typeCheck = FactoryBasicDataSchema.safeParse(proposedData);
      if (!typeCheck.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請包含無效欄位值，請重新整理頁面後再試' });
      }

      let revisionId: number;
      try {
        revisionId = await db.createRevision(
          factory.id,
          ctx.user.id,
          originalData,
          proposedData,
          input.revisionReason,
        );
      } catch (err: any) {
        if (err?.message === 'DUPLICATE_PENDING_REVISION') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '已有一筆基本資料修改申請正在審核中' });
        }
        throw err;
      }

      // Notify admin (fire-and-forget)
      sendRevisionSubmittedEmail({
        factoryName: factory.name,
        factoryId: factory.id,
        submitterName: ctx.user.name ?? null,
        revisionReason: input.revisionReason,
      }).catch(err => console.error('[Email] sendRevisionSubmittedEmail failed:', err));

      return { success: true, revisionId };
    }),

    search: publicProcedure.input(z.object({
  industry: z.array(z.string().max(50)).max(15).optional(),
  subIndustry: z.array(z.string().max(50)).max(20).optional(),
  region: z.array(z.string().max(20)).max(25).optional(),
  capitalLevel: z.array(z.string().max(30)).max(10).optional(),
  mfgMode: z.string().max(10).optional(),
  keyword: z.string().max(100).optional(),
  businessType: z.string().max(20).optional(),
  sortBy: z.enum(["rating", "reviews", "response", "newest"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
})).query(async ({ input }) => {
  const industry      = input.industry     && input.industry.length > 0     ? input.industry     : undefined;
  const subIndustry   = input.subIndustry  && input.subIndustry.length > 0  ? input.subIndustry  : undefined;
  const region        = input.region       && input.region.length > 0       ? input.region       : undefined;
  const capitalLevel  = input.capitalLevel && input.capitalLevel.length > 0 ? input.capitalLevel : undefined;
  const businessType  = input.businessType && input.businessType !== 'all'  ? input.businessType : undefined;

  // 使用者是否有手動選主產業（影響 AI matchTier 計算範圍）
  const userHasSelectedIndustry = !!(industry && industry.length > 0);

  // 取得 AI 搜尋意圖（keyword 有值時嘗試；有 industry 時仍呼叫，用於 productKeywords 加權）
  const intent = input.keyword ? await getSearchIntent(input.keyword) : null;

  // fallback keyword：intent 無法使用時沿用舊有 enhanceSearchKeyword
  const keyword = input.keyword
    ? (intent ? input.keyword : await enhanceSearchKeyword(input.keyword))
    : undefined;

  const result = await db.searchFactories({
    ...input,
    industry, subIndustry, region, capitalLevel, businessType,
    keyword,
    intent,
    userHasSelectedIndustry,
  });
  let ads: Awaited<ReturnType<typeof db.getActiveAds>> = [];

  if (input.page === 1) {
    ads = await db.getActiveAds({ industry: input.industry?.[0], capitalLevel: input.capitalLevel?.[0], region: input.region?.[0] });
    const adFactoryIds = new Set(ads.slice(0, 5).map(a => a.factoryId));
    const promoted = result.items.filter(f => adFactoryIds.has(f.id));
    const regular = result.items.filter(f => !adFactoryIds.has(f.id));
    result.items = [...promoted, ...regular];
  }

  // 廣告資料一起回傳，前端不需要再打一支 ad.getActive
  return { ...result, ads };
}),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限刪除此工廠");
      await db.deleteFactory(input.id, ctx.user.id);
      await db.setFactoryOwner(ctx.user.id, false);
      return { success: true };
    }),

    uploadAvatar: protectedProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      // Optional: pass factoryId to support co-managers; falls back to owner lookup when omitted.
      factoryId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      let factory: Awaited<ReturnType<typeof db.getFactoryByOwnerId>>;
      if (input.factoryId) {
        factory = await db.getFactoryById(input.factoryId);
        if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
        const isOwner = factory.ownerId === ctx.user.id;
        const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
        if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限上傳此工廠大頭貼' });
      } else {
        factory = await db.getFactoryByOwnerId(ctx.user.id);
        if (!factory) throw new Error("找不到工廠");
      }
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";

      switch (factory.status) {
        case 'draft':
        case 'rejected': {
          // Direct update: upload and save to DB
          const key = `factory-avatars/${factory.id}/${nanoid()}.${ext}`;
          const { url } = await storagePut(key, buffer, input.mimeType);
          await db.updateFactory(factory.id, ctx.user.id, { avatarUrl: url });
          return { url, savedToDb: true };
        }
        case 'pending': {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '首次申請審核中，不可更換大頭貼' });
        }
        case 'approved': {
          // Upload to a separate temp prefix. factories.avatarUrl is NOT updated here.
          // The URL is staged on the client and included in proposedData upon revision submission.
          // If the user abandons without submitting, the object is orphaned under factory-avatars-temp/.
          // A S3 lifecycle rule on the factory-avatars-temp/ prefix (e.g., expire after 30 days)
          // can be applied to clean up abandoned temp objects without affecting production avatars.
          const key = `factory-avatars-temp/${factory.id}/${nanoid()}.${ext}`;
          const { url } = await storagePut(key, buffer, input.mimeType);
          return { url, savedToDb: false };
        }
        default:
          throw new Error("未知的工廠狀態");
      }
    }),

    submitForReview: protectedProcedure.mutation(async ({ ctx }) => {
      requireVerifiedEmail(ctx.user);
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      if (factory.status !== 'draft' && factory.status !== 'rejected') throw new Error("只有未送審或已拒絕的工廠才能送出審核");
      // 管理員不受產品數量限制
      if (ctx.user.role !== 'admin') {
        const products = await db.getProductsByFactoryId(factory.id);
        if (products.length === 0) throw new Error("請至少新增一項產品後再送出審核");
      }
      await db.updateFactory(factory.id, ctx.user.id, { status: 'pending', submittedAt: new Date() });
      sendFactorySubmittedEmail({
        factoryName: factory.name ?? '未命名工廠',
        factoryId: factory.id,
        ownerName: ctx.user.name ?? '未知用戶',
        ownerEmail: ctx.user.email,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),

    getPhotos: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getPhotosByFactoryId(input.factoryId);
    }),

    uploadPhoto: protectedProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      caption: z.string().max(200).optional(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `factory-photos/${factory.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      const id = await db.addFactoryPhoto(factory.id, url, input.caption);
      return { id, url };
    }),

    deletePhoto: protectedProcedure.input(z.object({ photoId: z.number() })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.deleteFactoryPhoto(input.photoId, factory.id);
      return { success: true };
    }),

    updatePhotoCaption: protectedProcedure.input(z.object({
      photoId: z.number(),
      caption: z.string().max(200),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.updateFactoryPhotoCaption(input.photoId, factory.id, input.caption);
      return { success: true };
    }),

    reviewHistory: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
      return [] as { id: number; action: string; createdAt: Date; submitCountSnapshot?: number; note?: string; rejectReason?: string }[];
    }),

    // ===== 共同管理者 =====
    inviteCoManager: protectedProcedure.input(z.object({
      email: z.string().email(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");

      const invitee = await db.getUserByEmail(input.email);
      // Don't reveal whether email is registered — prevents enumeration
      if (!invitee) return { success: true as const, conversationId: null as number | null };
      if (invitee.id === ctx.user.id) throw new Error("不能邀請自己");

      // 跨廠唯一性預檢：被邀請人是否已有工廠角色
      // 注意：此預檢不能取代 acceptInvitation 內的正式鎖定檢查
      const inviteeAffil = await db.getActiveFactoryAffiliation(invitee.id);
      if (inviteeAffil) {
        if (inviteeAffil.factoryId === factory.id && inviteeAffil.role === "co_manager") {
          throw new Error("此用戶已是本工廠的次管理者");
        }
        throw new Error("此使用者已擁有或管理其他工廠，無法邀請");
      }

      const hasPending = await db.hasPendingInvitation(factory.id, invitee.id);
      if (hasPending) throw new Error("已有一筆待處理的邀請，請等對方回應後再試");

      const count = await db.getActiveCoManagerCount(factory.id);
      if (count >= 6) throw new Error("次管理者已達 6 人上限");

      const conv = await db.getOrCreateConversation(invitee.id, factory.id);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invitationId = await db.createCoManagerInvitation({
        factoryId: factory.id,
        inviterUserId: ctx.user.id,
        inviteeUserId: invitee.id,
        conversationId: conv.id,
        expiresAt,
      });

      const content = `您好，我是【${factory.name}】的主管理者 ${ctx.user.name ?? ctx.user.email}，誠摯邀請您成為本工廠的次管理者，共同管理工廠後台。\n\n邀請有效期限：7 天\n\n請點選下方按鈕確認是否接受。`;
      const messageId = await db.sendCoManagerInviteMessage(conv.id, ctx.user.id, content);
      await db.linkInvitationToMessage(invitationId, messageId);

      // 站內通知：通知被邀請人
      createPlatformNotifications([{
        recipientUserId: invitee.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "",
        actorFactoryId: factory.id,
        actorFactoryName: factory.name,
        eventType: "co_manager_invitation",
        eventGroup: "co_manager",
        message: `「${factory.name}」邀請你成為次管理者，請到對話頁面確認`,
        actionUrl: `/chat/${conv.id}`,
        dedupeKey: `co_manager_invitation:${invitationId}`,
      }]).catch(() => {});

      return { success: true, conversationId: conv.id };
    }),

    respondToInvitation: protectedProcedure.input(z.object({
      invitationId: z.number(),
      action: z.enum(["accept", "decline"]),
    })).mutation(async ({ ctx, input }) => {
      if (input.action === "accept") requireVerifiedEmail(ctx.user);
      // Fetch invitation before mutating so we can send a notification
      const inv = await db.getInvitationById(input.invitationId);
      if (input.action === "accept") {
        await db.acceptInvitation(input.invitationId, ctx.user.id);
      } else {
        await db.declineInvitation(input.invitationId, ctx.user.id);
      }
      // 站內通知：通知邀請人（工廠主管理者），fire-and-forget 避免阻塞回應
      if (inv) {
        void (async () => {
          try {
            const [factory, invitee] = await Promise.all([
              db.getFactoryById(inv.factoryId),
              db.getUserById(ctx.user.id),
            ]);
            const inviteeName = invitee?.name ?? invitee?.email ?? "使用者";
            const factoryName = factory?.name ?? "工廠";
            await createPlatformNotifications([{
              recipientUserId: inv.inviterUserId,
              actorUserId: ctx.user.id,
              actorName: inviteeName,
              actorFactoryId: factory?.id ?? null,
              actorFactoryName: factoryName,
              eventType: input.action === "accept"
                ? "co_manager_invitation_accepted"
                : "co_manager_invitation_rejected",
              eventGroup: "co_manager",
              message: input.action === "accept"
                ? `${inviteeName} 已接受邀請，加入「${factoryName}」成為次管理者`
                : `${inviteeName} 婉拒了次管理者邀請`,
              actionUrl: "/dashboard",
              dedupeKey: `co_manager_respond:${input.invitationId}:${input.action}`,
            }]);
          } catch (e) {
            console.warn("[respondToInvitation] notification failed", e);
          }
        })();
      }
      return { success: true };
    }),

    removeCoManager: protectedProcedure.input(z.object({
      userId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");
      if (input.userId === ctx.user.id) throw new Error("無法移除自己");
      await db.removeCoManager(factory.id, input.userId);
      return { success: true };
    }),

    getCoManagers: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");
      const [coManagers, pending] = await Promise.all([
        db.getCoManagersByFactory(factory.id),
        db.getPendingInvitationsByFactory(factory.id),
      ]);
      return { coManagers, pending };
    }),

    getCoManagedFactories: protectedProcedure.query(async ({ ctx }) => {
      return db.getCoManagedFactories(ctx.user.id);
    }),
  }),

  // ===== 產品分類 =====
  category: router({
    getByFactory: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getCategoriesByFactoryId(input.factoryId);
    }),

    create: protectedProcedure.input(z.object({
      name: z.string().min(1).max(100),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      const id = await db.createCategory(factory.id, input.name.trim());
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.updateCategory(input.id, factory.id, input.name.trim());
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.deleteCategory(input.id, factory.id);
      return { success: true };
    }),

    assignProduct: protectedProcedure.input(z.object({
      productId: z.number(),
      categoryId: z.number().nullable(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.updateProductCategory(input.productId, factory.id, input.categoryId);
      return { success: true };
    }),
  }),

  // ===== 產品 =====
  product: router({
    getByFactory: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getProductsByFactoryId(input.factoryId);
    }),

    getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getProductById(input.id);
    }),

    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      name: z.string().min(1).max(200),
      categoryId: z.number().nullable().optional(),
      priceMin: z.string().optional(),
      priceMax: z.string().optional(),
      priceType: z.enum(["range", "fixed", "market"]).optional(),
      acceptSmallOrder: z.boolean().default(false),
      provideSample: z.boolean().default(false),
      description: z.string().optional(),
      images: z.array(z.string()).max(3).optional(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      if (input.categoryId != null) {
        const cats = await db.getCategoriesByFactoryId(input.factoryId);
        if (!cats.some((c) => c.id === input.categoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分類不屬於此工廠" });
        }
      }
      const id = await db.createProduct(input);
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
      name: z.string().min(1).max(200).optional(),
      categoryId: z.number().nullable().optional(),
      priceMin: z.string().optional(),
      priceMax: z.string().optional(),
      priceType: z.enum(["range", "fixed", "market"]).optional(),
      acceptSmallOrder: z.boolean().optional(),
      provideSample: z.boolean().optional(),
      description: z.string().optional(),
      images: z.array(z.string()).max(3).optional(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      const { id, factoryId, ...data } = input;
      if (data.categoryId != null) {
        const cats = await db.getCategoriesByFactoryId(factoryId);
        if (!cats.some((c) => c.id === data.categoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分類不屬於此工廠" });
        }
      }
      await db.updateProduct(id, factoryId, data);
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.deleteProduct(input.id, input.factoryId);
      return { success: true };
    }),

    // 上傳產品圖片（base64）
    uploadImage: protectedProcedure.input(z.object({
      factoryId: z.number(),
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `product-images/${factory.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),
  }),

  // ===== 聊天 =====
  chat: router({
    getOrCreate: protectedProcedure.input(z.object({
      factoryId: z.number(),
      productId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const conv = await db.getOrCreateConversation(ctx.user.id, input.factoryId, input.productId);
      return conv;
    }),

    // 只查詢已存在的對話，不建立（供「聯繫工廠」按鈕跳轉前使用）
    getExisting: protectedProcedure.input(z.object({
      factoryId: z.number(),
      productId: z.number().optional(),
    })).query(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) return null;
      const conditions = [
        eq(conversations.userId, ctx.user.id),
        eq(conversations.factoryId, input.factoryId),
      ];
      if (input.productId) conditions.push(eq(conversations.productId, input.productId));
      else conditions.push(sql`${conversations.productId} IS NULL`);
      const existing = await db_.select().from(conversations).where(and(...conditions)).limit(1);
      return existing.length > 0 ? existing[0] : null;
    }),

    // 取得使用者的一般對話（排除一鍵詢價批次建立的對話）+ 站內信
    myConversations: protectedProcedure.query(async ({ ctx }) => {
      const all = await db.getConversationsByUserWithDetails(ctx.user.id);
      let batchConvIds = new Set<number>();
      try {
        batchConvIds = await db.getInquiryBatchConversationIdsByUser(ctx.user.id);
      } catch {
        // inquiry 資料表尚未建立時不影響一般訊息
      }
      const regularConvs = all.map(c => ({ ...c, isAdminMessage: false as const, hasInquiry: batchConvIds.has(c.id) }));

      let adminMsgs: any[] = [];
      try {
        const campaigns = await db.getAdminMessagesForUser(ctx.user.id);
        adminMsgs = campaigns.map(c => ({
          id: -c.campaignId,
          isAdminMessage: true as const,
          adminCampaignId: c.campaignId,
          factoryName: "★ 平台管理員",
          productName: null,
          lastMessage: c.content.substring(0, 60),
          lastSenderRole: "admin",
          lastMessageAt: c.createdAt,
          unreadCount: c.isRead ? 0 : 1,
          senderIsAdmin: true,
          title: c.title,
        }));
      } catch {
        // 站內信資料表尚未建立時不影響一般訊息
      }

      const merged = [...regularConvs, ...adminMsgs];
      merged.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      return merged;
    }),

    getAdminMessage: protectedProcedure.input(z.object({ campaignId: z.number() })).query(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      return campaign;
    }),

    getAdminMessageThread: protectedProcedure.input(z.object({ campaignId: z.number() })).query(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      return db.getMessageThread(input.campaignId, ctx.user.id);
    }),

    replyToAdminMessage: protectedProcedure.input(z.object({
      campaignId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      await db.createMessageReply({
        campaignId: input.campaignId,
        userId: ctx.user.id,
        content: input.content,
        senderRole: "user",
      });
      sendMessageReplyNotificationEmail({
        userName: ctx.user.name ?? '使用者',
        userEmail: ctx.user.email ?? undefined,
        campaignTitle: campaign.title,
        replyContent: input.content,
        campaignId: input.campaignId,
      });
      return { success: true };
    }),

    markAdminMessageRead: protectedProcedure.input(z.object({ campaignId: z.number() })).mutation(async ({ ctx, input }) => {
      await db.markAdminMessageAsRead(input.campaignId, ctx.user.id);
      return { success: true };
    }),

    // 取得工廠的所有對話（含未讀計數與最後訊息）
    factoryConversations: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new Error("工廠不存在");
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(input.factoryId, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new Error("無權限");
      return db.getConversationsByFactoryWithDetails(input.factoryId, ctx.user.id);
    }),

    getMessages: protectedProcedure.input(z.object({
      conversationId: z.number(),
      page: z.number().int().min(1).default(1),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (conv.userId !== ctx.user.id && !isFactoryOwner && !isCoMgr && ctx.user.role !== 'admin') throw new Error("無權限");
      try {
        return await db.getMessagesByConversation(input.conversationId, input.page);
      } catch (error) {
        console.error("[getMessages] DB query failed", {
          conversationId: input.conversationId,
          userId: ctx.user.id,
          error,
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '訊息載入失敗，請稍後再試' });
      }
    }),

    // Explicit mark-read mutation — replaces the former side-effect inside getMessages.
    // Idempotent: marking an already-read conversation is a no-op.
    markConversationRead: protectedProcedure.input(z.object({
      conversationId: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: '對話不存在' });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (conv.userId !== ctx.user.id && !isFactoryOwner && !isCoMgr) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '無法標記此對話已讀' });
      }
      await db.markMessagesAsRead(input.conversationId, ctx.user.id);
      return { conversationId: input.conversationId };
    }),

    // 取得對話的 metadata（工廠名稱、產品名稱，用於 ChatPage 預填）
    getConversationMeta: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) return null;
      const factory = await db.getFactoryById(conv.factoryId);
      const product = conv.productId ? await db.getProductById(conv.productId) : null;
      const isConvUser = conv.userId === ctx.user.id;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isConvUser && !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isConvUser && !isFactoryOwner && !isCoMgr && ctx.user.role !== 'admin') return null;
      // 取得買家姓名與工廠身分（供工廠端顯示詢問者身分用）
      const [buyer, buyerAffiliation] = await Promise.all([
        db.getUserById(conv.userId),
        db.getActiveFactoryAffiliationDetail(conv.userId),
      ]);
      return {
        factoryName: factory?.name ?? "未知工廠",
        productName: product?.name ?? null,
        factoryId: conv.factoryId,
        productId: conv.productId,
        userId: conv.userId,
        factoryOwnerId: factory?.ownerId ?? null,
        isCoMgr,
        buyerName: buyer?.name ?? null,
        buyerAffiliation: buyerAffiliation
          ? { factoryId: buyerAffiliation.factoryId, factoryName: buyerAffiliation.factoryName, factoryStatus: buyerAffiliation.factoryStatus, role: buyerAffiliation.role }
          : null,
      };
    }),

    send: protectedProcedure.input(z.object({
      conversationId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isUser = conv.userId === ctx.user.id;
      if (!isFactoryOwner && !isCoMgr && !isUser) throw new Error("無權限");
      const senderRole = (isFactoryOwner || isCoMgr) ? "factory" as const : "user" as const;
      await db.saveMessage(input.conversationId, ctx.user.id, senderRole, input.content);

      // 工廠回覆時通知使用者（若有開啟 newMessage 通知設定）
      if (senderRole === "factory") {
        db.getUserById(conv.userId).then((convUser) => {
          const settings = (convUser?.notificationSettings as Record<string, boolean> | null) ?? {};
          if (convUser?.email && settings.newMessage !== false) {
            sendNewMessageNotificationEmail({
              userEmail: convUser.email,
              userName: convUser.name ?? '您',
              factoryName: factory?.name ?? '工廠',
              messagePreview: input.content.substring(0, 200),
              conversationId: input.conversationId,
            }).catch(() => {});
          }
          if (settings.pushNewMessage !== false) {
            sendPushToRecipients({
              userIds: [conv.userId],
              excludeUserId: ctx.user.id,
              title: "OXM 有新的訊息",
              body: `${factory?.name ?? "工廠"} 傳來一則新訊息`,
              data: {
                type: "chat_message",
                conversationId: String(input.conversationId),
                targetPath: `/chat/${input.conversationId}`,
              },
            }).catch(() => {});
          }
          // 站內通知
          createPlatformNotifications([{
            recipientUserId: conv.userId,
            actorUserId: ctx.user.id,
            actorFactoryId: factory?.id ?? null,
            actorFactoryName: factory?.name ?? null,
            actorName: factory?.name ?? "",
            eventType: "chat_message",
            eventGroup: "chat",
            message: `${factory?.name ?? "工廠"} 傳了一則新訊息`,
            actionUrl: `/chat/${input.conversationId}`,
            dedupeKey: `chat_message:conv:${input.conversationId}:ts:${Date.now()}`,
          }]).catch(() => {});
        }).catch(() => {});
      }

      if (senderRole === "user") {
        const productInfo = conv.productId ? await db.getProductById(conv.productId) : null;

        // notifyOwner 獨立 fire-and-forget，失敗不影響 Email
        notifyOwner({
          title: `[OXM] 新客戶詢問 - ${factory?.name ?? "工廠"}`,
          content: [
            `工廠名稱：${factory?.name}`,
            factory?.contactEmail ? `工廠信箱：${factory.contactEmail}` : null,
            productInfo ? `詢問產品：${productInfo.name}` : null,
            `客戶名稱：${ctx.user.name ?? "匿名"}`,
            `客戶信箱：${ctx.user.email ?? "未提供"}`,
            ``,
            `訊息內容：`,
            `「${input.content.substring(0, 500)}」`,
            ``,
            `請登入 OXM 平台回覆客戶。`,
          ].filter(Boolean).join("\n"),
        }).catch((e) => { console.warn("[chat.send] notifyOwner 失敗（非嚴重）", e); });

        // 寄 Email 通知工廠端：factory.contactEmail 受 owner 的 newMessage 設定控制，co-manager 各自判斷
        if (factory) {
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagersWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const recipients = new Set<string>();
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (factory.contactEmail && ownerSettings.newMessage !== false) {
              recipients.add(factory.contactEmail);
            }
            for (const { email, notificationSettings } of coMgrs) {
              if (email === ctx.user.email) continue;
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.newMessage !== false) recipients.add(email);
            }
            recipients.forEach((email) => {
              sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? '匿名',
                productName: productInfo?.name,
                message: input.content,
              }).catch(() => {});
            });
          }).catch((e) => {
            console.warn('[chat.send] 通知設定查詢失敗，fallback 寄送所有收件人', e);
            const fallback = new Set<string>();
            if (factory.contactEmail) fallback.add(factory.contactEmail);
            db.getFactoryCoManagerEmails(factory.id).then((emails) => {
              emails.forEach(e => { if (e && e !== ctx.user.email) fallback.add(e); });
              fallback.forEach(email => sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? '匿名',
                productName: productInfo?.name,
                message: input.content,
              }).catch(() => {}));
            }).catch(() => {});
          });
        }

        // 手機推播：通知工廠端（buyer 傳訊時）
        if (factory) {
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagerUserIdsWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const pushIds: number[] = [];
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (owner && ownerSettings.pushNewMessage !== false) pushIds.push(factory.ownerId);
            for (const { userId, notificationSettings } of coMgrs) {
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.pushNewMessage !== false) pushIds.push(userId);
            }
            return sendPushToRecipients({
              userIds: pushIds,
              excludeUserId: ctx.user.id,
              title: "OXM 有新的詢問訊息",
              body: `${ctx.user.name ?? "客戶"} 傳來一則新訊息`,
              data: {
                type: "chat_message",
                conversationId: String(input.conversationId),
                targetPath: `/chat/${input.conversationId}`,
              },
            });
          }).catch((e) => { console.warn("[Push] chat.send factory push error", e); });
        }

        // 站內通知：通知工廠端（owner + co-managers）
        if (factory) {
          Promise.all([
            Promise.resolve(factory.ownerId),
            db.getActiveCoManagerUserIds(factory.id),
          ]).then(([ownerId, coMgrIds]) => {
            const recipientIds = Array.from(new Set([ownerId, ...coMgrIds])).filter(id => id !== ctx.user.id);
            if (recipientIds.length === 0) return;
            return createPlatformNotifications(recipientIds.map(uid => ({
              recipientUserId: uid,
              actorUserId: ctx.user.id,
              actorName: ctx.user.name ?? ctx.user.email ?? "",
              eventType: "chat_message",
              eventGroup: "chat",
              message: `${ctx.user.name ?? "客戶"} 傳了一則新詢問訊息`,
              actionUrl: `/chat/${input.conversationId}`,
              dedupeKey: `chat_message:conv:${input.conversationId}:r:${uid}:ts:${Date.now()}`,
            })));
          }).catch(() => {});
        }
      }
      return { success: true };
    }),

    // 查詢工廠可傳送的商品（工廠 owner 或 co-manager 可呼叫）
    getFactoryProducts: protectedProcedure.input(z.object({ conversationId: z.number() })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可存取" });
      return db.getProductsByFactoryId(factory!.id);
    }),

    // 傳送商品附件訊息
    sendProduct: protectedProcedure.input(z.object({
      conversationId: z.number(),
      productIds: z.array(z.number().int()).min(1).max(10),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwnerSP = factory?.ownerId === ctx.user.id;
      const isCoMgrSP = !isFactoryOwnerSP && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwnerSP && !isCoMgrSP) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可傳送商品" });

      const factoryProducts = await db.getProductsByFactoryId(factory.id);
      const factoryProductMap = new Map(factoryProducts.map(p => [p.id, p]));
      if (!input.productIds.every(id => factoryProductMap.has(id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "包含不屬於此工廠的商品" });
      }

      const snapshot = input.productIds.map(id => {
        const p = factoryProductMap.get(id)!;
        return {
          id: p.id,
          name: p.name,
          imageUrl: ((p.images as string[] | null)?.[0]) ?? null,
          description: p.description ? p.description.substring(0, 100) : null,
          factoryId: factory.id,
          detailUrl: `/factory/${factory.id}`,
        };
      });

      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "", "product", {
        productIds: input.productIds,
        snapshot,
      });
      return { success: true };
    }),

    // 上傳 PDF 型錄並傳送訊息
    sendPdf: protectedProcedure.input(z.object({
      conversationId: z.number(),
      fileData: z.string().min(1),
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().min(1).max(10 * 1024 * 1024),
      mimeType: z.literal("application/pdf"),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwnerPdf = factory?.ownerId === ctx.user.id;
      const isCoMgrPdf = !isFactoryOwnerPdf && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwnerPdf && !isCoMgrPdf) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可上傳型錄" });

      // Strip path traversal and dangerous chars; allow spaces and CJK
      let safeName = input.fileName
        .replace(/\.\./g, "_")
        .replace(/[/\\<>"'&]/g, "_")
        .replace(/[\x00-\x1f\x7f]/g, "_")
        .substring(0, 100)
        .trim();
      if (!safeName || safeName === ".pdf") safeName = "catalog.pdf";
      if (!safeName.toLowerCase().endsWith(".pdf")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只允許上傳 PDF 檔案" });
      }

      const base64Data = input.fileData.replace(/^data:application\/pdf;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "檔案大小不可超過 10MB" });
      }
      if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "檔案格式不正確，請上傳 PDF" });
      }

      const fileKey = `chat-pdfs/${factory.id}/${nanoid()}.pdf`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, "application/pdf");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "", "pdf", {
        fileUrl,
        fileKey,
        fileName: safeName,
        fileSize: buffer.length,
        expiresAt,
      });
      return { success: true };
    }),

    // 取得 PDF 下載 URL（需通過權限+過期驗證，回傳 5 分鐘有效的 presigned URL）
    getPdfDownloadUrl: protectedProcedure.input(z.object({ messageId: z.number() })).mutation(async ({ ctx, input }) => {
      const msg = await db.getMessageById(input.messageId);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "訊息不存在" });
      if (msg.type !== "pdf") throw new TRPCError({ code: "BAD_REQUEST", message: "此訊息不是 PDF 附件" });

      // 驗證對話存取權限（使用者本人、工廠 owner、active co-manager、admin）
      const conv = await db.getConversationById(msg.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isConvUser = conv.userId === ctx.user.id;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgrPdf = !isConvUser && !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isConvUser && !isFactoryOwner && !isCoMgrPdf && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });
      }

      const attachment = (msg.attachmentData ?? {}) as {
        fileKey?: string; fileUrl?: string; expiresAt?: string; deleted?: boolean;
      };
      if (attachment.deleted) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此型錄已被刪除" });
      if (!attachment.expiresAt || new Date(attachment.expiresAt) < new Date()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此型錄已逾期，無法下載" });
      }

      // 優先 presigned URL（5 分鐘），fallback 到 fileUrl
      if (attachment.fileKey) {
        const url = await storagePresignedUrl(attachment.fileKey, 300);
        return { url };
      }
      if (attachment.fileUrl) return { url: attachment.fileUrl };
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到檔案" });
    }),

    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const [regularCount, adminCount] = await Promise.all([
        db.getUnreadCount(ctx.user.id),
        db.getUnreadAdminMessageCount(ctx.user.id),
      ]);
      const userCount = regularCount + adminCount;
      const factoryCount = await db.getUnreadCountForUser(ctx.user.id);
      return { userCount, factoryCount };
    }),

    // 刪除對話
    deleteConversation: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwner && !isCoMgr) throw new Error("無權限刪除此對話");
      // 傳 factory.ownerId 讓 DB 層的 owner 檢查通過（co-manager 已在上方驗過）
      await db.deleteConversation(input.conversationId, factory!.ownerId);
      return { success: true };
    }),
  }),

  // ===== 合作確認單 =====
  collaborationOrder: router({
    create: protectedProcedure.input(z.object({
      conversationId: z.number(),
      productId: z.number().nullable().optional(),
      projectName: z.string().min(1).max(200),
      description: z.string().min(1),
      // note: requireVerifiedEmail checked below
      depositDueDate: z.string().max(10).nullable().optional(),
      productionStartDate: z.string().max(10).nullable().optional(),
      expectedCompletionDate: z.string().max(10).nullable().optional(),
      expectedShipmentDate: z.string().max(10).nullable().optional(),
      finalPaymentDueDate: z.string().max(10).nullable().optional(),
      note: z.string().max(2000).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      const [conv] = await db_.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "找不到對話" });
      const factory = await db.getFactoryById(conv.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可建立合作確認單" });
      // 若帶 productId，確認屬於同一工廠
      if (input.productId) {
        const prod = await db.getProductById(input.productId);
        if (!prod || prod.factoryId !== factory.id) throw new TRPCError({ code: "BAD_REQUEST", message: "指定商品不屬於此工廠" });
      }
      const orderId = await db.createCollaborationOrder({
        conversationId: input.conversationId,
        factoryId: factory.id,
        buyerUserId: conv.userId,
        createdByUserId: ctx.user.id,
        productId: input.productId ?? null,
        projectName: input.projectName,
        description: input.description,
        depositDueDate: input.depositDueDate ?? null,
        productionStartDate: input.productionStartDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        expectedShipmentDate: input.expectedShipmentDate ?? null,
        finalPaymentDueDate: input.finalPaymentDueDate ?? null,
        note: input.note ?? null,
      });
      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "合作確認單", "collaboration_order", {
        orderId,
        projectName: input.projectName,
        description: input.description,
        depositDueDate: input.depositDueDate ?? null,
        productionStartDate: input.productionStartDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        expectedShipmentDate: input.expectedShipmentDate ?? null,
        finalPaymentDueDate: input.finalPaymentDueDate ?? null,
        note: input.note ?? null,
      });
      return { orderId };
    }),

    respond: protectedProcedure.input(z.object({
      orderId: z.number(),
      action: z.enum(["accepted", "rejected"]),
    })).mutation(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.buyerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅需求方可回應" });
      if (order.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單已不是待回應狀態" });
      await db.respondCollaborationOrder(order.id, input.action);
      const sysMsg = input.action === "accepted"
        ? "需求方已同意合作確認單，本筆合作已成立"
        : "需求方已拒絕此合作確認單";
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        if (conv) await db.saveMessage(order.conversationId, conv.userId, "user", sysMsg, "text");
      }
      return { success: true };
    }),

    updateStatus: protectedProcedure.input(z.object({
      orderId: z.number(),
      status: z.enum(["in_progress", "shipped", "completed"]),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status === "cancelled" || order.status === "cancel_requested") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單已取消或正在取消申請中" });
      }
      if (order.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "已完成的合作確認單不可再更新" });
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      const allowedFrom: Record<string, string[]> = {
        in_progress: ["accepted"],
        shipped: ["in_progress"],
        completed: ["shipped"],
      };
      if (!allowedFrom[input.status]?.includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `無法從「${order.status}」改為「${input.status}」` });
      }
      await db.updateCollaborationOrderStatus(order.id, input.status);
      return { success: true };
    }),

    requestCancel: protectedProcedure.input(z.object({
      orderId: z.number(),
      reason: z.string().min(1).max(500),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      const allowedStatuses = ["pending", "accepted", "in_progress", "shipped"];
      if (!allowedStatuses.includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此狀態不可申請取消" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = order.buyerUserId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      await db.requestCancelCollaborationOrder(order.id, ctx.user.id, input.reason, order.status);
      const isFactorySide = isOwner || isCoMgr;
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        const senderId = conv?.userId ?? ctx.user.id;
        const senderRole = isFactorySide ? "factory" : "user";
        await db.saveMessage(order.conversationId, senderId, senderRole, "取消合作申請", "collaboration_order", {
          subType: "cancel_request",
          orderId: order.id,
          projectName: order.projectName,
          reason: input.reason,
          requestedByUserId: ctx.user.id,
          requestedByRole: isFactorySide ? "factory" : "buyer",
        });
      }
      return { success: true };
    }),

    respondCancel: protectedProcedure.input(z.object({
      orderId: z.number(),
      action: z.enum(["accept", "reject"]),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status !== "cancel_requested") throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單不在取消申請狀態" });
      if (order.cancelRequestedByUserId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "不能回應自己提出的取消申請" });
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = order.buyerUserId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      await db.respondCancelCollaborationOrder(order.id, input.action);
      const sysMsg = input.action === "accept"
        ? "對方已同意取消，合作確認單已取消"
        : "對方已拒絕取消，合作確認單維持原狀態";
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        if (conv) await db.saveMessage(order.conversationId, conv.userId, "user", sysMsg, "text");
      }
      return { success: true };
    }),

    listForFactory: protectedProcedure.input(z.object({
      factoryId: z.number(),
    })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      return db.listFactoryCollaborationOrders(input.factoryId);
    }),

    getForConversation: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) return [];
      const [conv] = await db_.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv) return [];
      const factory = await db.getFactoryById(conv.factoryId);
      const isOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = conv.userId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) return [];
      return db.getCollaborationOrdersForConversation(input.conversationId);
    }),

    createVerifiedReview: protectedProcedure.input(z.object({
      collaborationOrderId: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderById(input.collaborationOrderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.buyerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅該合作需求方可留下評價" });
      if (order.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "合作尚未完成" });
      await db.createVerifiedOrderReview({
        factoryId: order.factoryId,
        userId: ctx.user.id,
        collaborationOrderId: order.id,
        rating: input.rating,
        comment: input.comment,
      });
      return { success: true };
    }),
  }),

  // ===== 評價 =====
  review: router({
    getByFactory: publicProcedure.input(z.object({
      factoryId: z.number(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getReviewsByFactory(input.factoryId, input.page, input.pageSize);
    }),

    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const existing = await db.getReviewByUserAndFactory(ctx.user.id, input.factoryId);
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "您已為此工廠留過評價" });
      await db.createReview({ ...input, userId: ctx.user.id });
      return { success: true };
    }),

    myReviews: protectedProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ ctx, input }) => {
      return db.getReviewsByUser(ctx.user.id, input.page, input.pageSize);
    }),
    getMyReviewForFactory: protectedProcedure.input(z.object({
      factoryId: z.number(),
    })).query(async ({ ctx, input }) => {
      return db.getReviewByUserAndFactory(ctx.user.id, input.factoryId);
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateReview(id, ctx.user.id, data);
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({
      id: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await db.deleteReview(input.id, ctx.user.id);
      return { success: true };
    }),
    unreadCount: protectedProcedure
      .input(z.object({ since: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const factory = await db.getFactoryByOwnerId(ctx.user.id);
        if (!factory) return { count: 0 };
        const since = input?.since ? new Date(input.since) : undefined;
        return db.countNewReviewsSince(factory.id, since);
      }),

    reply: protectedProcedure.input(z.object({
      reviewId: z.number(),
      reply: z.string().max(1000),
    })).mutation(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      const [review] = await db_.select().from(reviews).where(eq(reviews.id, input.reviewId)).limit(1);
      if (!review) throw new Error("評價不存在");
      const factory = await db.getFactoryById(review.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
      await db_.update(reviews).set({
        reply: input.reply,
        repliedAt: new Date(),
      }).where(eq(reviews.id, input.reviewId));

      // 通知評價者（若有開啟 reviewReply 通知設定）
      db.getUserById(review.userId).then((reviewer) => {
        const settings = (reviewer?.notificationSettings as Record<string, boolean> | null) ?? {};
        if (reviewer?.email && settings.reviewReply !== false) {
          sendReviewReplyEmail({
            userEmail: reviewer.email,
            userName: reviewer.name ?? '您',
            factoryName: factory.name,
            originalComment: review.comment ?? '',
            replyContent: input.reply,
            factoryId: factory.id,
          }).catch(() => {});
        }
        if (settings.pushReviewReply !== false) {
          sendPushToRecipients({
            userIds: [review.userId],
            excludeUserId: ctx.user.id,
            title: "OXM 工廠回覆了你的評價",
            body: `${factory.name} 回覆了你的評價`,
            data: {
              type: "review_reply",
              factoryId: String(factory.id),
              targetPath: `/factory/${factory.id}`,
            },
          }).catch(() => {});
        }
        // 站內通知
        createPlatformNotifications([{
          recipientUserId: review.userId,
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "review_reply",
          eventGroup: "review",
          message: `${factory.name} 回覆了你的評價`,
          actionUrl: `/factory/${factory.id}#reviews`,
          dedupeKey: `review_reply:${input.reviewId}`,
        }]).catch(() => {});
      }).catch(() => {});

      return { success: true };
    }),
  }),

  // ===== 工廠收藏 =====
  favorite: router({
  toggle: protectedProcedure.input(z.object({ factoryId: z.number() })).mutation(async ({ ctx, input }) => {
    const isFavorited = await db.toggleFavorite(ctx.user.id, input.factoryId);
    return { isFavorited };
  }),

  isLiked: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
    const isFavorited = await db.isFavorited(ctx.user.id, input.factoryId);
    return { isFavorited };
  }),

  batchIsLiked: protectedProcedure
    .input(z.object({ factoryIds: z.array(z.number()).max(100) }))
    .query(async ({ ctx, input }) => {
      const favoritedSet = await db.getFavoritedFactoryIds(ctx.user.id, input.factoryIds);
      const result: Record<number, boolean> = {};
      for (const id of input.factoryIds) {
        result[id] = favoritedSet.has(id);
      }
      return result;
    }),

  getByUser: protectedProcedure.input(z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })).query(async ({ ctx, input }) => {
    return db.getFavoritesByUser(ctx.user.id, input.page, input.pageSize);
  }),
}),

  // ===== 管理員儀表板 =====
  admin: router({
    getStats: adminProcedure.query(async () => {
      return db.getAdminStats();
    }),
    getPendingCount: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') return { count: 0, factoryCount: 0, revisionCount: 0 };
      const [factoryCount, revisionCount] = await Promise.all([
        (async () => {
          const db_ = await getDb();
          if (!db_) return 0;
          const [result] = await db_.select({ count: sql<number>`COUNT(*)` })
            .from(factories).where(eq(factories.status, 'pending'));
          return Number(result?.count ?? 0);
        })(),
        db.getPendingRevisionCount(),
      ]);
      return { count: factoryCount + revisionCount, factoryCount, revisionCount };
    }),

    getAdminNotifications: adminProcedure.query(async () => {
      return db.getAdminPendingNotifications();
    }),

    getFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      status: z.enum(['approved', 'pending', 'rejected']).optional(),
    })).query(async ({ input }) => {
      return db.getAdminFactories(input.page, input.pageSize, input.search, input.status);
    }),

    getUsers: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    })).query(async ({ input }) => {
      return db.getAdminUsers(input.page, input.pageSize, input.search);
    }),

    getAds: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminAds(input.page, input.pageSize);
    }),

    getReviews: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminReviews(input.page, input.pageSize);
    }),

    getFactoryDetail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) return null;
      const owner = await db.getUserById(factory.ownerId);
      const drizzle = await getDb();
      let coManagers: Array<{ userId: number; name: string | null; email: string | null }> = [];
      if (drizzle) {
        const cmRows = await drizzle
          .select({
            userId: factoryCoManagers.userId,
            name: users.name,
            primaryEmail: users.primaryEmail,
            email: users.email,
          })
          .from(factoryCoManagers)
          .innerJoin(users, eq(factoryCoManagers.userId, users.id))
          .where(and(
            eq(factoryCoManagers.factoryId, input.id),
            isNull(factoryCoManagers.removedAt),
          ));
        coManagers = cmRows.map(r => ({ userId: r.userId, name: r.name, email: r.primaryEmail ?? r.email }));
      }
      return { ...factory, ownerAccountName: owner?.name ?? null, ownerAccountEmail: owner?.email ?? null, coManagers };
    }),

    approveFactory: adminProcedure.input(z.object({ factoryId: z.number() })).mutation(async ({ input }) => {
  await db.updateFactory(input.factoryId, -1, { status: 'approved' });
  const factory = await db.getFactoryById(input.factoryId);
  if (factory?.contactEmail) {
    await sendFactoryApprovedEmail({
      factoryName: factory.name,
      factoryEmail: factory.contactEmail,
    });
  }
  if (factory) {
    sendPushToRecipients({
      userIds: [factory.ownerId],
      title: "OXM 工廠審核通過",
      body: `「${factory.name}」已通過審核，現已正式上架`,
      data: { type: "factory_approved", targetPath: "/dashboard" },
    }).catch(() => {});
    createPlatformNotifications([{
      recipientUserId: factory.ownerId,
      eventType: "factory_approved",
      eventGroup: "factory",
      message: `「${factory.name}」已通過審核，現已正式上架`,
      actionUrl: "/dashboard",
      dedupeKey: `factory_approved:${factory.id}:${Date.now()}`,
    }]).catch(() => {});
  }
  return { success: true };
}),

    rejectFactory: adminProcedure.input(z.object({ factoryId: z.number(), reason: z.string() })).mutation(async ({ input }) => {
      await db.updateFactory(input.factoryId, -1, { status: 'rejected', rejectionReason: input.reason });
      const rejectedFactory = await db.getFactoryById(input.factoryId);
      if (rejectedFactory?.contactEmail) {
        sendFactoryRejectedEmail({
          factoryName: rejectedFactory.name,
          factoryEmail: rejectedFactory.contactEmail,
          reason: input.reason || undefined,
        }).catch((err) => { console.error('[Email] 審核退回通知寄送失敗:', err); });
      }
      if (rejectedFactory) {
        sendPushToRecipients({
          userIds: [rejectedFactory.ownerId],
          title: "OXM 工廠審核結果",
          body: `「${rejectedFactory.name}」審核未通過，請修改後重新送審`,
          data: { type: "factory_rejected", targetPath: "/dashboard" },
        }).catch(() => {});
        createPlatformNotifications([{
          recipientUserId: rejectedFactory.ownerId,
          eventType: "factory_rejected",
          eventGroup: "factory",
          message: `「${rejectedFactory.name}」審核未通過，請修改後重新送審`,
          actionUrl: "/dashboard",
          dedupeKey: `factory_rejected:${rejectedFactory.id}:${Date.now()}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),

    getPendingFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminPendingFactories(input.page, input.pageSize);
    }),

    getPendingRevisions: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminPendingRevisions(input.page, input.pageSize);
    }),

    approveRevision: adminProcedure.input(z.object({ revisionId: z.number() })).mutation(async ({ ctx, input }) => {
      // Pre-validate proposedData types before applying (defense-in-depth; submitRevision also validates)
      const revision = await db.getRevisionById(input.revisionId);
      if (revision && revision.status === 'pending') {
        const proposed = typeof revision.proposedData === 'string'
          ? JSON.parse(revision.proposedData as string)
          : revision.proposedData;
        const check = FactoryBasicDataSchema.safeParse(proposed);
        if (!check.success) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請資料格式有誤，無法套用，請要求工廠重新提交' });
        }
      }
      const result = await db.approveRevisionAtomic(input.revisionId, ctx.user!.id);
      // Notifications to owner + all active co-managers — fire-and-forget after successful transaction
      db.getCoManagersByFactory(result.factoryId).then(coMgrs => {
        // Email: deduplicated recipients (avoid Map/Set iteration; use array + includes check)
        const seenEmails: string[] = [];
        const recipients: Array<{ email: string; name: string | null }> = [];
        const addEmailRecipient = (email: string | null | undefined, name: string | null) => {
          if (!email || seenEmails.includes(email)) return;
          seenEmails.push(email);
          recipients.push({ email, name });
        };
        addEmailRecipient(result.ownerEmail, result.ownerName);
        for (const mgr of coMgrs) addEmailRecipient(mgr.email, mgr.name ?? null);
        for (const { email, name } of recipients) {
          sendRevisionApprovedEmail({
            factoryName: result.factoryName,
            factoryEmail: email,
            recipientName: name,
          }).catch(err => console.error('[Email] sendRevisionApprovedEmail failed:', err));
        }
        // Push: deduplicated userIds
        const pushIds: number[] = result.ownerId ? [result.ownerId] : [];
        for (const mgr of coMgrs) {
          if (mgr.userId && !pushIds.includes(mgr.userId)) pushIds.push(mgr.userId);
        }
        if (pushIds.length > 0) {
          sendPushToRecipients({
            userIds: pushIds,
            title: "OXM 資料修改申請通過",
            body: `「${result.factoryName}」的基本資料修改申請已通過`,
            data: { type: "revision_approved", targetPath: "/dashboard" },
          }).catch(() => {});
        }
      }).catch(() => {});
      return { success: true };
    }),

    rejectRevision: adminProcedure.input(z.object({
      revisionId: z.number(),
      reason: z.string().trim().min(1, "請填寫拒絕原因").max(500),
    })).mutation(async ({ ctx, input }) => {
      const result = await db.rejectRevisionAtomic(input.revisionId, ctx.user!.id, input.reason);
      // Notifications to owner + all active co-managers — fire-and-forget after successful transaction
      db.getCoManagersByFactory(result.factoryId).then(coMgrs => {
        const seenEmails: string[] = [];
        const recipients: Array<{ email: string; name: string | null }> = [];
        const addEmailRecipient = (email: string | null | undefined, name: string | null) => {
          if (!email || seenEmails.includes(email)) return;
          seenEmails.push(email);
          recipients.push({ email, name });
        };
        addEmailRecipient(result.ownerEmail, result.ownerName);
        for (const mgr of coMgrs) addEmailRecipient(mgr.email, mgr.name ?? null);
        for (const { email, name } of recipients) {
          sendRevisionRejectedEmail({
            factoryName: result.factoryName,
            factoryEmail: email,
            recipientName: name,
            reason: input.reason,
          }).catch(err => console.error('[Email] sendRevisionRejectedEmail failed:', err));
        }
        const pushIds: number[] = result.ownerId ? [result.ownerId] : [];
        for (const mgr of coMgrs) {
          if (mgr.userId && !pushIds.includes(mgr.userId)) pushIds.push(mgr.userId);
        }
        if (pushIds.length > 0) {
          sendPushToRecipients({
            userIds: pushIds,
            title: "OXM 資料修改申請結果",
            body: `「${result.factoryName}」的基本資料修改申請未通過，請確認原因後重新申請`,
            data: { type: "revision_rejected", targetPath: "/dashboard" },
          }).catch(() => {});
        }
      }).catch(() => {});
      return { success: true };
    }),

    getApprovedFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminApprovedFactories(input.page, input.pageSize);
    }),

    getRejectedFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminRejectedFactories(input.page, input.pageSize);
    }),

    setCertified: adminProcedure.input(z.object({
      factoryId: z.number(),
      certified: z.boolean(),
    })).mutation(async ({ input }) => {
      await db.updateFactory(input.factoryId, -1, { certified: input.certified });
      return { success: true };
    }),

    updateFactoryIndustry: adminProcedure.input(z.object({
      factoryId: z.number(),
      industry: z.array(z.string()).min(1, "請至少選擇一個產業分類"),
    })).mutation(async ({ input }) => {
      const invalid = input.industry.filter(v => !(INDUSTRY_OPTIONS as readonly string[]).includes(v));
      if (invalid.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: `非合法產業值：${invalid.join('、')}` });
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      await db.updateFactory(input.factoryId, -1, { industry: input.industry as any });
      return { success: true };
    }),

    getProducts: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      industry: z.string().optional(),
    })).query(async ({ input }) => {
      return db.getAdminProducts(input.page, input.pageSize, input.search, input.industry);
    }),

    getConversations: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      factoryId: z.number().optional(),
    })).query(async ({ input }) => {
      return db.getAdminConversations(input.page, input.pageSize, input.search, input.factoryId);
    }),

    getReviewsWithFilter: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      rating: z.number().optional(),
    })).query(async ({ input }) => {
      return db.getAdminReviews(input.page, input.pageSize);
    }),

    getReports: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      excludeResolved: z.boolean().optional(),
    })).query(async ({ input }) => {
      return db.getAdminReports(input.page, input.pageSize, input.status, input.excludeResolved);
    }),

    updateReportStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(['pending', 'received', 'reviewing', 'processing', 'resolved']),
      adminNote: z.string().optional(),
    })).mutation(async ({ input }) => {
      const report = await db.getReportById(input.id);
      await db.updateReportStatus(input.id, input.status, input.adminNote);
      // 通知檢舉者（Email + 站內通知）
      if (report?.userId) {
        const settings = (report.notificationSettings as Record<string, boolean> | null) ?? {};
        if (report.userEmail && settings.reportUpdate !== false) {
          sendReportStatusUpdateEmail({
            userEmail: report.userEmail,
            userName: report.userName ?? '您',
            factoryName: report.factoryName ?? '工廠',
            status: input.status,
          }).catch(() => {});
        }
        createPlatformNotifications([{
          recipientUserId: report.userId,
          eventType: "report_status_changed",
          eventGroup: "report",
          message: `您對「${report.factoryName ?? "工廠"}」的檢舉狀態已更新`,
          actionUrl: "/member",
          dedupeKey: `report_status:${input.id}:${input.status}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),
    getReportHistory: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getReportHistory(input.id);
    }),

    getSupportTickets: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      excludeResolved: z.boolean().optional(),
    })).query(async ({ input }) => {
      return db.getAdminSupportTickets(input.page, input.pageSize, input.status, input.excludeResolved);
    }),

    updateTicketStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(['pending', 'received', 'reviewing', 'processing', 'resolved']),
      adminNote: z.string().optional(),
    })).mutation(async ({ input }) => {
      const ticket = await db.getSupportTicketById(input.id);
      await db.updateSupportTicketStatus(input.id, input.status, input.adminNote);
      // 通知投訴者（Email + 站內通知）
      if (ticket?.userId) {
        const settings = (ticket.notificationSettings as Record<string, boolean> | null) ?? {};
        if (ticket.userEmail && settings.ticketUpdate !== false) {
          sendTicketStatusUpdateEmail({
            userEmail: ticket.userEmail,
            userName: ticket.userName ?? '您',
            subject: ticket.subject,
            status: input.status,
          }).catch(() => {});
        }
        createPlatformNotifications([{
          recipientUserId: ticket.userId,
          eventType: "support_ticket_updated",
          eventGroup: "support",
          message: `您的客服投訴案件「${ticket.subject}」狀態已更新`,
          actionUrl: "/member",
          dedupeKey: `ticket_status:${input.id}:${input.status}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),
    getTicketHistory: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getTicketHistory(input.id);
    }),

    getMessageCampaigns: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    })).query(async ({ input }) => {
      return db.getAdminMessageCampaigns(input.page, input.pageSize);
    }),

    createAdminMessage: adminProcedure.input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      targetType: z.enum(['all_users', 'all_factory_managers', 'single']),
      receiverId: z.number().int().optional(),
    })).mutation(async ({ ctx, input }) => {
      const campaignId = await db.createMessageCampaign({
        title: input.title,
        content: input.content,
        senderId: ctx.user!.id,
        targetType: input.targetType,
      });
      let receiverIds: number[] = [];
      if (input.targetType === 'all_users') {
        receiverIds = await db.getAllActiveUserIds();
      } else if (input.targetType === 'all_factory_managers') {
        receiverIds = await db.getFactoryManagerIds();
      } else if (input.targetType === 'single' && input.receiverId != null) {
        receiverIds = [input.receiverId];
      }
      await db.createMessageRecipients(campaignId, receiverIds);

      // 站內通知：通知所有收件人，fire-and-forget
      (async () => {
        try {
          if (receiverIds.length > 0) {
            const titleSnap = input.title.length > 100 ? input.title.slice(0, 97) + "..." : input.title;
            await createPlatformNotifications(receiverIds.map(uid => ({
              recipientUserId: uid,
              eventType: "admin_announcement",
              eventGroup: "platform",
              message: `平台通知：${titleSnap}`,
              actionUrl: `/admin-message/${campaignId}`,
              titleSnapshot: titleSnap,
              dedupeKey: `admin_announcement:${campaignId}:r:${uid}`,
            })));
          }
        } catch (err) {
          console.warn("[notification] admin_announcement station error:", err instanceof Error ? err.message : String(err));
        }
      })();

      // 手機推播：只推給 announcement === true 的使用者，fire-and-forget
      (async () => {
        try {
          const recipients = await db.getRecipientsWithEmails(campaignId);
          const pushIds = recipients
            .filter(r => ((r.notificationSettings as Record<string, boolean> | null) ?? {}).pushAnnouncement === true)
            .map(r => r.userId);
          if (pushIds.length > 0) {
            const bodyText = input.title.length > 100 ? input.title.slice(0, 97) + "..." : input.title;
            await sendPushToRecipients({
              userIds: pushIds,
              title: "OXM 平台通知",
              body: bodyText,
              data: {
                type: "admin_announcement",
                campaignId: String(campaignId),
                targetPath: "/messages",
              },
            });
          }
        } catch (err) {
          console.warn("[Push] campaign push error:", err instanceof Error ? err.message : String(err));
        }
      })();

      // 非同步寄信，不阻塞 response；sequential queue 避免 Resend 429
      (async () => {
        const INTER_EMAIL_DELAY_MS = 500;
        const RETRY_DELAYS_MS = [1500, 3000, 5000];

        const isRateLimitError = (err: unknown): boolean => {
          if (!err || typeof err !== 'object') return false;
          const e = err as Record<string, unknown>;
          const status = e['statusCode'] ?? e['status'] ?? (e['response'] as any)?.status;
          return status === 429;
        };

        try {
          const recipients = await db.getRecipientsWithEmails(campaignId);
          // announcement 預設 false（opt-in），只有明確設為 true 才寄
          const withEmail = recipients.filter(r => {
            if (!r.email) return false;
            const s = (r.notificationSettings as Record<string, boolean> | null) ?? {};
            return s.announcement === true;
          });
          const skipped = recipients.length - withEmail.length;
          console.log(`[adminMessage] email queue start campaignId=${campaignId} total=${recipients.length} withEmail=${withEmail.length} skipped=${skipped}`);

          let successCount = 0;
          let failCount = 0;

          for (const r of withEmail) {
            let lastErr: unknown;
            let sent = false;

            for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
              try {
                await sendAdminBroadcastEmail({
                  toEmail: r.email!,
                  toName: r.name,
                  campaignTitle: input.title,
                  campaignContent: input.content,
                  campaignId,
                });
                console.log(`[adminMessage] email sent success campaignId=${campaignId} email=${r.email} attempt=${attempt}`);
                successCount++;
                sent = true;
                break;
              } catch (err) {
                lastErr = err;
                if (attempt <= RETRY_DELAYS_MS.length && isRateLimitError(err)) {
                  const wait = RETRY_DELAYS_MS[attempt - 1];
                  console.warn(`[adminMessage] email retry campaignId=${campaignId} email=${r.email} attempt=${attempt + 1} reason=429 waitMs=${wait}`);
                  await new Promise(res => setTimeout(res, wait));
                } else {
                  break;
                }
              }
            }

            if (!sent) {
              failCount++;
              console.error(`[adminMessage] email failed campaignId=${campaignId} email=${r.email} attempts=${RETRY_DELAYS_MS.length + 1} error=`, lastErr);
            }

            // 每封之間固定間隔，避免 rate limit
            await new Promise(res => setTimeout(res, INTER_EMAIL_DELAY_MS));
          }

          console.log(`[adminMessage] email queue done campaignId=${campaignId} success=${successCount} failed=${failCount} skipped=${skipped}`);
        } catch (err) {
          console.error(`[adminMessage] getRecipientsWithEmails failed for campaignId=${campaignId}:`, err);
        }
      })();
      return { campaignId, recipientCount: receiverIds.length };
    }),

    searchMessageReceivers: adminProcedure.input(z.object({
      query: z.string().min(1),
    })).query(async ({ input }) => {
      return db.searchUsersForMessage(input.query);
    }),

    previewMessageRecipientCount: adminProcedure.input(z.object({
      targetType: z.enum(['all_users', 'all_factory_managers', 'single']),
    })).query(async ({ input }) => {
      if (input.targetType === 'all_users') {
        const ids = await db.getAllActiveUserIds();
        return { count: ids.length };
      }
      if (input.targetType === 'all_factory_managers') {
        const ids = await db.getFactoryManagerIds();
        return { count: ids.length };
      }
      return { count: 1 };
    }),

    getMessageCampaignDetail: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      const campaign = await db.getAdminMessageCampaignById(input.campaignId);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此站內信' });
      return campaign;
    }),

    getCampaignAllRecipients: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      return db.getCampaignAllRecipients(input.campaignId);
    }),

    getCampaignReplyingUsers: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      return db.getCampaignReplyingUsers(input.campaignId);
    }),

    getCampaignThread: adminProcedure.input(z.object({
      campaignId: z.number(),
      userId: z.number(),
    })).query(async ({ input }) => {
      return db.getMessageThread(input.campaignId, input.userId);
    }),

    replyToUser: adminProcedure.input(z.object({
      campaignId: z.number(),
      userId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ input }) => {
      await db.createMessageReply({
        campaignId: input.campaignId,
        userId: input.userId,
        content: input.content,
        senderRole: "admin",
      });
      return { success: true };
    }),

    markCampaignRecipientViewed: adminProcedure.input(z.object({
      campaignId: z.number().int(),
      recipientUserId: z.number().int(),
    })).mutation(async ({ input }) => {
      await db.markCampaignRecipientViewed(input.campaignId, input.recipientUserId);
      return { success: true };
    }),

    getAdminMessageCampaignUnreadStats: adminProcedure.query(async () => {
      return db.getCampaignsWithUnreadReplies();
    }),

    retractAdminMessage: adminProcedure.input(z.object({
      campaignId: z.number().int(),
      reason: z.string().max(500).default(''),
    })).mutation(async ({ ctx, input }) => {
      console.log(`[adminMessage] retract campaignId=${input.campaignId} by adminId=${ctx.user!.id} reason=${input.reason}`);
      await db.retractAdminMessageCampaign(input.campaignId, ctx.user!.id, input.reason);
      return { success: true };
    }),

    // 測試推播（admin only — 不輸出完整 token，只回傳統計數字）
    sendTestPushNotification: adminProcedure.input(z.object({
      userId: z.number().int().positive().optional(),
      title: z.string().max(100).optional(),
      body: z.string().max(200).optional(),
    })).mutation(async ({ ctx, input }) => {
      const targetUserId = input.userId ?? ctx.user!.id;
      const result = await sendPushToUser(targetUserId, {
        title: input.title ?? "OXM 測試通知",
        body: input.body ?? "你的手機推播通知已設定成功",
      });
      return { targetUserId, ...result };
    }),

    // ===== 商案討論區後台管理 =====
    community: router({
      hidePost: adminProcedure
        .input(z.object({ postId: z.number().int(), hidden: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isHidden: input.hidden });
          return { success: true };
        }),

      lockPost: adminProcedure
        .input(z.object({ postId: z.number().int(), locked: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isLocked: input.locked });
          return { success: true };
        }),

      pinPost: adminProcedure
        .input(z.object({ postId: z.number().int(), pinned: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isPinned: input.pinned });
          return { success: true };
        }),

      hideComment: adminProcedure
        .input(z.object({ commentId: z.number().int(), hidden: z.boolean() }))
        .mutation(async ({ input }) => {
          const comment = await db.getCommunityCommentById(input.commentId);
          if (!comment) throw new TRPCError({ code: "NOT_FOUND", message: "找不到留言" });
          await db.adminSetCommunityCommentHidden(input.commentId, input.hidden);
          return { success: true };
        }),

      deletePost: adminProcedure
        .input(z.object({ postId: z.number().int() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminHardDeleteCommunityPost(input.postId);
          return { success: true };
        }),

      listPendingBids: adminProcedure
        .input(z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(50).default(20),
        }))
        .query(async ({ input }) => {
          return db.listCommunityBids({ status: "pending_review", page: input.page, pageSize: input.pageSize });
        }),

      approveBid: adminProcedure
        .input(z.object({ bidId: z.number().int() }))
        .mutation(async ({ ctx, input }) => {
          const bid = await db.getCommunityBidById(input.bidId);
          if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
          if (bid.status !== "pending_review") {
            throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核狀態可以通過審核" });
          }
          // Re-validate completeness before approving
          if (!bid.title?.trim() || !bid.description?.trim()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "需求缺少必填欄位（標題或說明），無法通過審核" });
          }
          await db.approveCommunityBid(input.bidId, ctx.user!.id, ctx.user!.name ?? "管理員");
          // Notify author
          if (bid.authorUserId != null) {
            try {
              await db.createCommunityNotificationsBatch([{
                recipientUserId: bid.authorUserId,
                actorUserId: ctx.user!.id,
                actorFactoryId: null,
                eventType: "bid_review_approved",
                eventGroup: "bid_review",
                postId: null,
                commentId: null,
                spaceCode: bid.spaceCode,
                titleSnapshot: bid.title,
                actorNameSnapshot: "管理員",
                actorFactoryNameSnapshot: null,
                message: `您的需求「${bid.title}」已通過審核，現在開放廠商接案`,
                dedupeKey: `bid:${bid.id}:approved:r:${bid.authorUserId}`,
              }]);
            } catch { /* best-effort */ }
          }
          return { success: true };
        }),

      rejectBid: adminProcedure
        .input(z.object({ bidId: z.number().int(), reason: z.string().min(1).max(1000).trim() }))
        .mutation(async ({ ctx, input }) => {
          const bid = await db.getCommunityBidById(input.bidId);
          if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
          if (bid.status !== "pending_review") {
            throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核狀態可以退回" });
          }
          await db.rejectCommunityBid(input.bidId, ctx.user!.id, ctx.user!.name ?? "管理員", input.reason);
          // Notify author
          if (bid.authorUserId != null) {
            try {
              await db.createCommunityNotificationsBatch([{
                recipientUserId: bid.authorUserId,
                actorUserId: ctx.user!.id,
                actorFactoryId: null,
                eventType: "bid_review_rejected",
                eventGroup: "bid_review",
                postId: null,
                commentId: null,
                spaceCode: bid.spaceCode,
                titleSnapshot: bid.title,
                actorNameSnapshot: "管理員",
                actorFactoryNameSnapshot: null,
                message: `您的需求「${bid.title}」審核未通過：${input.reason}`,
                dedupeKey: `bid:${bid.id}:rejected:r:${bid.authorUserId}`,
              }]);
            } catch { /* best-effort */ }
          }
          return { success: true };
        }),
    }),
  }),

  // ===== 廣告 =====
  ad: router({
    getActive: publicProcedure.input(z.object({
      industry: z.string().optional(),
      capitalLevel: z.string().optional(),
      region: z.string().optional(),
    })).query(async ({ input }) => {
      const ads = await db.getActiveAds(input);
      return ads.slice(0, 5);
    }),

    create: adminProcedure.input(z.object({
      factoryId: z.number(),
      industry: z.string(),
      capitalLevel: z.string(),
      region: z.string(),
      extraRegions: z.array(z.string()).optional(),
      startDate: z.date(),
      endDate: z.date(),
    })).mutation(async ({ input }) => {
      await db.createAd(input);
      return { success: true };
    }),
  }),

  // ===== 平台公告 =====
  announcement: router({
    list: publicProcedure.input(z.object({ limit: z.number().default(20) })).query(async ({ input }) => {
      return db.getAnnouncements(input.limit);
    }),
    create: adminProcedure.input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      type: z.enum(["update", "maintenance", "news"]).default("news"),
      isPinned: z.boolean().default(false),
    })).mutation(async ({ input }) => {
      await db.createAnnouncement(input);
      return { success: true };
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      title: z.string().min(1).max(200).optional(),
      content: z.string().min(1).optional(),
      type: z.enum(["update", "maintenance", "news"]).optional(),
      isPinned: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateAnnouncement(id, data);
      return { success: true };
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteAnnouncement(input.id);
      return { success: true };
    }),
  }),

  // ===== 一鍵詢價 =====
  inquiryBatch: router({
    createAndSend: protectedProcedure.input(z.object({
      title: z.string().min(1).max(50),
      message: z.string().min(1).max(2000),
      factoryIds: z.array(z.number().int().positive()).min(1).max(20),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const uniqueIds = Array.from(new Set(input.factoryIds));

      // 驗證每間工廠
      const factoryList = await Promise.all(uniqueIds.map(id => db.getFactoryById(id)));
      for (let i = 0; i < uniqueIds.length; i++) {
        const f = factoryList[i];
        if (!f) throw new TRPCError({ code: "BAD_REQUEST", message: `工廠 #${uniqueIds[i]} 不存在` });
        if (f.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: `工廠「${f.name}」尚未上架` });
        if (f.ownerId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: `不可對自己的工廠送一鍵詢價` });
      }

      // 建立批次，逐一建立 conversation 並送訊息
      const batchId = await db.createInquiryBatch(ctx.user.id, input.title, input.message);
      let successCount = 0;

      for (let i = 0; i < uniqueIds.length; i++) {
        const factoryId = uniqueIds[i];
        const factory = factoryList[i]!;
        try {
          const conv = await db.getOrCreateConversation(ctx.user.id, factoryId);
          await db.saveMessage(conv.id, ctx.user.id, "user", input.message);
          await db.createInquiryBatchItem(batchId, factoryId, conv.id);
          successCount++;

          // 手機推播：通知工廠端
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagerUserIdsWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const pushIds: number[] = [];
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (owner && ownerSettings.pushNewMessage !== false) pushIds.push(factory.ownerId);
            for (const { userId, notificationSettings } of coMgrs) {
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.pushNewMessage !== false) pushIds.push(userId);
            }
            return sendPushToRecipients({
              userIds: pushIds,
              excludeUserId: ctx.user.id,
              title: "OXM 有新的詢價需求",
              body: "你收到一筆新的合作詢價",
              data: {
                type: "inquiry_batch",
                conversationId: String(conv.id),
                inquiryBatchId: String(batchId),
                targetPath: "/dashboard?tab=messages",
              },
            });
          }).catch((e) => { console.warn(`[Push] inquiryBatch factory #${factoryId} push error`, e); });

          // 通知工廠端：factory.contactEmail 受 owner 的 newMessage 設定控制，co-manager 各自判斷
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagersWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const recipients = new Set<string>();
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (factory.contactEmail && ownerSettings.newMessage !== false) {
              recipients.add(factory.contactEmail);
            }
            for (const { email, notificationSettings } of coMgrs) {
              if (email === ctx.user.email) continue;
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.newMessage !== false) recipients.add(email);
            }
            recipients.forEach((email) => {
              sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? "匿名",
                message: input.message,
                inquiryType: "batch",
              }).catch(() => {});
            });
          }).catch((e) => {
            console.warn(`[inquiryBatch.createAndSend] factory #${factory.id} 通知設定查詢失敗，fallback 寄送所有收件人`, e);
            const fallback = new Set<string>();
            if (factory.contactEmail) fallback.add(factory.contactEmail);
            db.getFactoryCoManagerEmails(factory.id).then((emails) => {
              emails.forEach(e => { if (e && e !== ctx.user.email) fallback.add(e); });
              fallback.forEach(email => sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? "匿名",
                message: input.message,
                inquiryType: "batch",
              }).catch(() => {}));
            }).catch(() => {});
          });
        } catch (err) {
          console.error(`[inquiryBatch.createAndSend] factory #${factoryId} failed:`, err);
        }
      }

      return { batchId, successCount };
    }),

    listMine: protectedProcedure.query(async ({ ctx }) => {
      return db.getInquiryBatchesByUser(ctx.user.id);
    }),

    getDetail: protectedProcedure.input(z.object({
      batchId: z.number().int().positive(),
    })).query(async ({ ctx, input }) => {
      const detail = await db.getInquiryBatchDetail(input.batchId, ctx.user.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "批次不存在或無權限" });
      return detail;
    }),

    updateTitle: protectedProcedure.input(z.object({
      batchId: z.number().int().positive(),
      title: z.string().min(1).max(50),
    })).mutation(async ({ ctx, input }) => {
      await db.updateInquiryBatchTitle(input.batchId, ctx.user.id, input.title);
      return { success: true };
    }),
  }),

  // ===== 檢舉 =====
  report: router({
    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      reason: z.string().min(1).max(1000),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      await db_.insert(reports).values({ factoryId: input.factoryId, userId: ctx.user.id, reason: input.reason });
      const reportedFactory = await db.getFactoryById(input.factoryId);
      sendReportEmail({
        reporterName: ctx.user.name ?? '未知用戶',
        factoryName: reportedFactory?.name ?? `工廠 #${input.factoryId}`,
        factoryId: input.factoryId,
        reason: input.reason,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),
    myReports: protectedProcedure.query(async ({ ctx }) => {
      return db.getReportsByUser(ctx.user.id);
    }),
    myReportHistory: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const userReports = await db.getReportsByUser(ctx.user.id);
      if (!userReports.find(r => r.id === input.id)) throw new Error("無權限");
      return db.getReportHistory(input.id);
    }),
  }),

  // ===== Push Notification Tokens =====
  notification: router({
    registerPushToken: protectedProcedure.input(z.object({
      token: z.string().min(1).max(512),
      platform: z.enum(["android", "ios", "unknown"]),
      deviceId: z.string().max(100).optional(),
      appVersion: z.string().max(50).optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.upsertPushNotificationToken(ctx.user.id, input);
      return { success: true };
    }),

    unregisterPushToken: protectedProcedure.input(z.object({
      token: z.string().min(1).max(512),
    })).mutation(async ({ ctx, input }) => {
      await db.disablePushNotificationToken(ctx.user.id, input.token);
      return { success: true };
    }),

    // 開發用：回傳 token 遮罩清單（不完整輸出 token）
    getMyPushTokens: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getEnabledPushTokensByUserId(ctx.user.id);
      return rows.map(r => ({
        id: r.id,
        platform: r.platform,
        deviceId: r.deviceId,
        appVersion: r.appVersion,
        enabled: r.enabled,
        lastSeenAt: r.lastSeenAt,
        createdAt: r.createdAt,
        // token 僅回傳前 8 碼 + 後 6 碼，避免完整暴露
        tokenPreview: r.token.length > 14
          ? `${r.token.substring(0, 8)}...${r.token.substring(r.token.length - 6)}`
          : r.token.substring(0, 4) + '****',
      }));
    }),

    // App badge count — 彙整所有紅點來源，沿用 Navbar 相同邏輯
    getAppBadgeCount: protectedProcedure
      .input(z.object({ reviewSince: z.number().int().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // 使用者未讀：chat 訊息 + 管理員站內信
        const [regularCount, adminMsgCount] = await Promise.all([
          db.getUnreadCount(userId),
          db.getUnreadAdminMessageCount(userId),
        ]);
        const userUnread = regularCount + adminMsgCount;

        // 工廠方未讀：客戶詢問 + 新評價（工廠業主才有）
        let factoryUnread = 0;
        let reviewUnread = 0;
        const factory = await db.getFactoryByOwnerId(userId);
        if (factory) {
          factoryUnread = await db.getUnreadCountForFactory(factory.id);
          const since = (input?.reviewSince ?? 0) > 0 ? new Date(input!.reviewSince!) : undefined;
          const { count } = await db.countNewReviewsSince(factory.id, since);
          reviewUnread = count;
        }

        // 管理員：待審工廠數 + 管理員通知
        let pendingAdminCount = 0;
        if (ctx.user.role === 'admin') {
          const db_ = await getDb();
          if (db_) {
            const [result] = await db_
              .select({ count: sql<number>`COUNT(*)` })
              .from(factories)
              .where(eq(factories.status, 'pending'));
            pendingAdminCount = Number(result?.count ?? 0);
          }
          const { hasMessageReplies, hasSupportPending } = await db.getAdminPendingNotifications();
          if (hasMessageReplies) pendingAdminCount += 1;
          if (hasSupportPending) pendingAdminCount += 1;
        }

        const total = Math.max(0, userUnread + factoryUnread + reviewUnread + pendingAdminCount);
        return {
          total,
          breakdown: { userUnread, factoryUnread, reviewUnread, pendingAdminCount },
        };
      }),
  }),

  // ===== 商案討論區 =====
  community: router({
    // Space list with post counts (13 spaces)
    getSpaces: publicProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const slugToName: Record<string, string> = {};
      for (const [name, slug] of Object.entries(INDUSTRY_SLUGS)) {
        slugToName[slug] = name;
      }
      const allSpaceCodes = [COMMUNITY_CROSS_INDUSTRY_SLUG, ...Object.values(INDUSTRY_SLUGS)];
      const stats = await db.getCommunitySpaceStats(allSpaceCodes);
      return allSpaceCodes.map((code) => ({
        code,
        name: code === COMMUNITY_CROSS_INDUSTRY_SLUG ? "跨產業交流區" : (slugToName[code] ?? code),
        postCount: stats[code] ?? 0,
      }));
    }),

    // Paginated posts for a space
    listPosts: publicProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        return db.listCommunityPosts(input.spaceCode, input.page, input.pageSize);
      }),

    // Single post with comments
    getPost: publicProcedure
      .input(z.object({ postId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        // Non-admins cannot see hidden or deleted posts
        if (ctx.user?.role !== "admin") {
          if (post.isHidden || post.deletedAt) {
            throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
          }
        }
        const comments = await db.getCommunityCommentsByPost(input.postId);
        const pinnedProductIds = (post.pinnedProductIds ?? []) as number[];
        const pinnedProducts = await db.getProductsByIds(pinnedProductIds);
        const mentionRows = await db.getMentionsBySource("post", input.postId);
        const postMentions = mentionRows.map(m => ({
          type: m.mentionedUserId != null ? ("user" as const) : ("factory" as const),
          id: (m.mentionedUserId ?? m.mentionedFactoryId)!,
        }));
        return { post, comments, pinnedProducts, postMentions };
      }),

    // Author identity options (user + any owned/co-managed approved factories)
    getMyIdentityOptions: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const factories = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
      return { identities: factories };
    }),

    // Returns the personalised default spaceCode for the /community entry redirect.
    // Uses the user's first approved factory's first valid industry (owner > co-manager, stable by id ASC).
    // Falls back to cross-industry if no qualifying factory or industry is found.
    getDefaultSpace: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const spaceCode = await db.getUserDefaultCommunitySpace(ctx.user.id);
      return { spaceCode };
    }),

    // Upload post image (max 8 MB, max 6 per post enforced on frontend)
    uploadPostImage: protectedProcedure
      .input(z.object({
        base64: z.string().max(12 * 1024 * 1024),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.byteLength > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "圖片不得超過 8MB" });
        }
        const validation = await validateImageUpload(buffer);
        if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error ?? "圖片格式不正確" });
        const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
        const key = `community-posts/${ctx.user.id}/${nanoid()}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),

    // Create a post
    createPost: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        title: z.string().min(1).max(200).trim(),
        content: z.string().min(1).max(10000).trim(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
        commentsEnabled: z.boolean().default(true),
        authorFactoryId: z.number().int().positive().optional(),
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(10).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        assertCommunityImagesOwned(input.images, ctx.user.id);

        // Enforce author identity rules: resolve which factoryId to actually use
        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;

        let resolvedFactoryId: number | null = null;

        if (factoryOptions.length === 0) {
          // No qualified factories → must post as personal
          if (input.authorFactoryId != null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "您目前沒有符合資格的工廠，只能以個人身分發文" });
          }
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          // Exactly 1 qualified factory → auto-assign, input is ignored but validated if provided
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          // Multiple qualified factories → must specify one; no personal option
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        // Validate pinnedProductIds: personal post cannot have products; products must belong to resolvedFactoryId
        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          if (resolvedFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "個人貼文不能附加工廠商品" });
          }
          const factoryProducts = await db.getProductsByFactoryId(resolvedFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const postId = await db.createCommunityPost({
          spaceCode: input.spaceCode,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          title: input.title,
          content: input.content,
          images: input.images,
          pinnedProductIds: dedupedProductIds,
          commentsEnabled: input.commentsEnabled,
        });

        // Fan-out: follow notifications + mention notifications (best-effort)
        try {
          // 1. Save mention relations
          const dedupedMentions = Array.from(
            new Map(input.mentions.map(m => [`${m.type}:${m.id}`, m])).values(),
          );
          if (dedupedMentions.length > 0) {
            await db.createMentions(
              "post", postId,
              dedupedMentions.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );
          }

          // 2. Board+factory follower notifications
          const followNotifInputs = await db.buildNewPostNotifications({
            postId,
            spaceCode: input.spaceCode,
            spaceName: getSpaceName(input.spaceCode),
            authorUserId: ctx.user.id,
            authorFactoryId: resolvedFactoryId,
            titleSnapshot: input.title,
            actorNameSnapshot: ctx.user.name ?? "",
            actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          });
          await db.createCommunityNotificationsBatch(followNotifInputs);

          // 3. Mention notifications
          if (dedupedMentions.length > 0) {
            const actorName = resolvedFactory?.label ?? ctx.user.name ?? "";
            type CommunityEventType = "community_mention";
            const mentionNotifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];

            // Collect all candidate recipient IDs from user + factory mentions
            const candidateMap = new Map<number, CommunityEventType>();
            for (const m of dedupedMentions) {
              if (m.type === "user") {
                if (m.id !== ctx.user.id) candidateMap.set(m.id, "community_mention");
              } else {
                const factory = await db.getFactoryById(m.id);
                if (!factory || factory.status !== "approved") continue;
                const ownerIds = factory.ownerId != null ? [factory.ownerId] : [];
                const coManagerIds = await db.getActiveCoManagerUserIds(m.id);
                for (const uid of [...ownerIds, ...coManagerIds]) {
                  if (uid !== ctx.user.id) candidateMap.set(uid, "community_mention");
                }
              }
            }

            const eligibleIds = await db.filterCommunityEligibleRecipientIds(
              Array.from(candidateMap.keys()), ctx.user.id,
            );
            for (const recipientUserId of eligibleIds) {
              mentionNotifInputs.push({
                recipientUserId,
                actorUserId: ctx.user.id,
                actorFactoryId: resolvedFactoryId ?? null,
                eventType: "community_mention",
                eventGroup: "mention",
                postId,
                spaceCode: input.spaceCode,
                titleSnapshot: input.title,
                actorNameSnapshot: ctx.user.name ?? "",
                actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
                message: `${actorName} 在貼文中提及了您`,
                dedupeKey: `mention:post:${postId}:r:${recipientUserId}`,
              });
            }
            await db.createCommunityNotificationsBatch(mentionNotifInputs);
          }
        } catch (err) {
          console.error("[community.createPost] notification fan-out error", err);
        }

        return { postId };
      }),

    // Edit a post (author only; cannot change spaceCode, authorUserId, authorFactoryId)
    updatePost: protectedProcedure
      .input(z.object({
        postId: z.number().int(),
        title: z.string().min(1).max(200).trim().optional(),
        content: z.string().min(1).max(10000).trim().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
        commentsEnabled: z.boolean().optional(),
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(10).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        if (post.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此貼文" });
        }
        if (post.isLocked && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "此貼文已鎖定，無法編輯" });
        }
        if (input.images !== undefined) {
          assertCommunityImagesOwned(input.images, ctx.user.id);
        }

        // Validate pinnedProductIds if being updated
        if (input.pinnedProductIds !== undefined) {
          const dedupedIds = Array.from(new Set(input.pinnedProductIds));
          if (dedupedIds.length > 0) {
            if (post.authorFactoryId == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "個人貼文不能附加工廠商品" });
            }
            const factoryProducts = await db.getProductsByFactoryId(post.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            const invalid = dedupedIds.find(id => !validIds.has(id));
            if (invalid != null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
            }
            input = { ...input, pinnedProductIds: dedupedIds };
          }
        }

        const { postId, mentions, ...updates } = input;
        if (Object.keys(updates).length > 0) {
          await db.updateCommunityPost(postId, updates);
        }

        // Sync mentions and notify only newly-added ones (best-effort)
        if (mentions !== undefined) {
          try {
            const dedupedNew = Array.from(
              new Map(mentions.map(m => [`${m.type}:${m.id}`, m])).values(),
            );
            const addedMentions = await db.syncMentionsBySource(
              "post", postId,
              dedupedNew.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );

            if (addedMentions.length > 0) {
              const actorName = post.authorFactoryNameSnapshot ?? ctx.user.name ?? "";
              const mentionNotifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];
              const candidateMap = new Map<number, true>();

              for (const m of addedMentions) {
                if (m.userId != null) {
                  if (m.userId !== ctx.user.id) candidateMap.set(m.userId, true);
                } else if (m.factoryId != null) {
                  const factory = await db.getFactoryById(m.factoryId);
                  if (!factory || factory.status !== "approved") continue;
                  const ownerIds = factory.ownerId != null ? [factory.ownerId] : [];
                  const coManagerIds = await db.getActiveCoManagerUserIds(m.factoryId);
                  for (const uid of [...ownerIds, ...coManagerIds]) {
                    if (uid !== ctx.user.id) candidateMap.set(uid, true);
                  }
                }
              }

              const eligibleIds = await db.filterCommunityEligibleRecipientIds(
                Array.from(candidateMap.keys()), ctx.user.id,
              );
              for (const recipientUserId of eligibleIds) {
                mentionNotifInputs.push({
                  recipientUserId,
                  actorUserId: ctx.user.id,
                  actorFactoryId: post.authorFactoryId ?? null,
                  eventType: "community_mention",
                  eventGroup: "mention",
                  postId,
                  spaceCode: post.spaceCode,
                  titleSnapshot: post.title,
                  actorNameSnapshot: ctx.user.name ?? "",
                  actorFactoryNameSnapshot: post.authorFactoryNameSnapshot ?? null,
                  message: `${actorName} 在貼文中提及了您`,
                  dedupeKey: `mention:post:${postId}:edit:r:${recipientUserId}`,
                });
              }
              await db.createCommunityNotificationsBatch(mentionNotifInputs);
            }
          } catch (err) {
            console.error("[community.updatePost] mention sync error", err);
          }
        }

        return { success: true };
      }),

    // Soft delete a post (author only)
    deletePost: protectedProcedure
      .input(z.object({ postId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        if (post.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此貼文" });
        }
        await db.softDeleteCommunityPost(input.postId);
        return { success: true };
      }),

    // Create a comment or a reply
    createComment: protectedProcedure
      .input(z.object({
        postId: z.number().int(),
        content: z.string().min(1).max(5000).trim(),
        parentCommentId: z.number().int().positive().optional(),
        replyToUserId: z.number().int().positive().optional(),
        // Front-end passes the auto-resolved or user-selected factoryId
        authorFactoryId: z.number().int().positive().optional(),
        // Mentions extracted from content (max 5)
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(5).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt || post.isHidden) {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        }
        if (post.isLocked && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "此貼文已鎖定，無法留言" });
        }
        if (!post.commentsEnabled && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "作者已關閉此貼文的留言功能" });
        }

        // Enforce 2-layer depth limit
        if (input.parentCommentId != null) {
          const parent = await db.getCommunityCommentById(input.parentCommentId);
          if (!parent || parent.postId !== input.postId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "無效的父留言" });
          }
          if (parent.parentCommentId != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "只允許兩層留言結構，不可回覆第二層留言" });
          }
        }

        // Enforce author identity rules (same as createPost)
        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;

        let resolvedFactoryId: number | null = null;
        if (factoryOptions.length === 0) {
          if (input.authorFactoryId != null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "您目前沒有符合資格的工廠" });
          }
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const commentId = await db.createCommunityComment({
          postId: input.postId,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          content: input.content,
          parentCommentId: input.parentCommentId ?? null,
          replyToUserId: input.replyToUserId ?? null,
        });

        // Post-comment side-effects (best-effort, never fail comment creation)
        try {
          // 1. Save mentions
          if (input.mentions.length > 0) {
            await db.createMentions(
              "comment",
              commentId,
              input.mentions.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );
          }

          // 2. Auto-follow the post content for the commenter
          await db.followContent(ctx.user.id, "discussion", input.postId);

          // 3. Build reply + mention notifications
          const actorName = resolvedFactory?.label ?? ctx.user.name ?? "";
          const mentionedUserIds = new Set(
            input.mentions.filter(m => m.type === "user").map(m => m.id),
          );

          type CommunityEventType = "community_post_reply" | "community_comment_reply" | "community_mention" | "community_reply_and_mention";
          // Notification recipients map: userId → eventType
          const notifMap = new Map<number, CommunityEventType>();

          // Reply notification: post author (if not the commenter themselves)
          if (post.authorUserId != null && post.authorUserId !== ctx.user.id) {
            const isMentioned = mentionedUserIds.has(post.authorUserId);
            notifMap.set(
              post.authorUserId,
              isMentioned ? "community_reply_and_mention" : "community_post_reply",
            );
          }

          // Reply notification: parent comment author (if this is a nested reply)
          if (input.parentCommentId != null) {
            const parentComment = await db.getCommunityCommentById(input.parentCommentId);
            if (parentComment?.authorUserId != null && parentComment.authorUserId !== ctx.user.id) {
              const isMentioned = mentionedUserIds.has(parentComment.authorUserId);
              const current = notifMap.get(parentComment.authorUserId);
              if (!current || current === "community_post_reply") {
                notifMap.set(
                  parentComment.authorUserId,
                  isMentioned ? "community_reply_and_mention" : "community_comment_reply",
                );
              }
            }
          }

          // Mention-only notifications for directly mentioned users not already covered
          for (const mentionedUserId of Array.from(mentionedUserIds)) {
            if (mentionedUserId === ctx.user.id) continue;
            if (!notifMap.has(mentionedUserId)) {
              notifMap.set(mentionedUserId, "community_mention");
            }
          }

          // Factory mentions → notify factory owner + active co-managers (deduplicated)
          const mentionedFactoryIds = new Set(
            input.mentions.filter(m => m.type === "factory").map(m => m.id),
          );
          for (const factoryId of Array.from(mentionedFactoryIds)) {
            // Get factory owner
            const factory = await db.getFactoryById(factoryId);
            const factoryOwnerIds = factory?.ownerId != null ? [factory.ownerId] : [];
            // Get active co-managers
            const coManagerIds = await db.getActiveCoManagerUserIds(factoryId);
            const candidateIds = Array.from(new Set([...factoryOwnerIds, ...coManagerIds]));
            for (const candidateId of candidateIds) {
              if (candidateId === ctx.user.id) continue; // don't notify self
              if (!notifMap.has(candidateId)) {
                notifMap.set(candidateId, "community_mention");
              } else {
                // Upgrade reply to reply_and_mention
                const current = notifMap.get(candidateId);
                if (current === "community_post_reply" || current === "community_comment_reply") {
                  notifMap.set(candidateId, "community_reply_and_mention");
                }
              }
            }
          }

          // Filter all recipients through beta/live eligibility gate
          const eligibleRecipientIds = await db.filterCommunityEligibleRecipientIds(
            Array.from(notifMap.keys()), ctx.user.id,
          );
          const eligibleSet = new Set(eligibleRecipientIds);

          // Build notification inputs
          const notifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];
          for (const [recipientUserId, eventType] of Array.from(notifMap.entries())) {
            if (!eligibleSet.has(recipientUserId)) continue;
            const isReply = eventType === "community_post_reply" || eventType === "community_comment_reply" || eventType === "community_reply_and_mention";
            const isMention = eventType === "community_mention" || eventType === "community_reply_and_mention";
            let message: string;
            if (eventType === "community_reply_and_mention") {
              message = `${actorName} 在討論中回覆並提及了您`;
            } else if (eventType === "community_mention") {
              message = `${actorName} 在討論中提及了您`;
            } else if (eventType === "community_comment_reply") {
              message = `${actorName} 回覆了您的留言`;
            } else {
              message = `${actorName} 在您的討論中留言`;
            }
            const dedupeKey = (eventType === "community_reply_and_mention" || eventType === "community_mention")
              ? (isReply ? `rmention:c:${commentId}:r:${recipientUserId}` : `mention:comment:${commentId}:r:${recipientUserId}`)
              : `reply:c:${commentId}:r:${recipientUserId}`;
            notifInputs.push({
              recipientUserId,
              actorUserId: ctx.user.id,
              actorFactoryId: resolvedFactoryId ?? null,
              eventType,
              eventGroup: isMention ? "mention" : "reply",
              postId: input.postId,
              commentId,
              spaceCode: post.spaceCode,
              titleSnapshot: post.title,
              actorNameSnapshot: actorName,
              actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
              message,
              dedupeKey,
            });
          }
          await db.createCommunityNotificationsBatch(notifInputs);
        } catch (err) {
          console.error("[community.createComment] post-comment side-effects error", err);
        }

        return { commentId };
      }),

    // Edit a comment (author only)
    updateComment: protectedProcedure
      .input(z.object({
        commentId: z.number().int(),
        content: z.string().min(1).max(5000).trim(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const comment = await db.getCommunityCommentById(input.commentId);
        if (!comment || comment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此留言" });
        if (comment.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此留言" });
        }
        await db.updateCommunityComment(input.commentId, input.content);
        return { success: true };
      }),

    // Soft delete a comment (author only)
    deleteComment: protectedProcedure
      .input(z.object({ commentId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const comment = await db.getCommunityCommentById(input.commentId);
        if (!comment || comment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此留言" });
        if (comment.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此留言" });
        }
        await db.softDeleteCommunityComment(input.commentId);
        return { success: true };
      }),

    // ===== Phase 2A: Board follows =====

    boardFollowStatus: protectedProcedure
      .input(z.object({ spaceCode: z.string().min(1).max(60) }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        const row = await db.getBoardFollowStatus(ctx.user.id, input.spaceCode);
        return { following: !!row, notifyNewDiscussions: row?.notifyNewDiscussions ?? true };
      }),

    followBoard: protectedProcedure
      .input(z.object({ spaceCode: z.string(), notifyNewDiscussions: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        await db.followBoard(ctx.user.id, input.spaceCode, input.notifyNewDiscussions);
        return { success: true };
      }),

    unfollowBoard: protectedProcedure
      .input(z.object({ spaceCode: z.string() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowBoard(ctx.user.id, input.spaceCode);
        return { success: true };
      }),

    // ===== Phase 2A: Factory follows =====

    factoryFollowStatus: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const row = await db.getFactoryFollowStatus(ctx.user.id, input.factoryId);
        return { following: !!row, notifyNewDiscussions: row?.notifyNewDiscussions ?? true };
      }),

    followFactory: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive(), notifyNewDiscussions: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const factory = await db.getFactoryById(input.factoryId);
        if (!factory || factory.status !== "approved") {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此工廠" });
        }
        await db.followFactory(ctx.user.id, input.factoryId, input.notifyNewDiscussions);
        return { success: true };
      }),

    unfollowFactory: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowFactory(ctx.user.id, input.factoryId);
        return { success: true };
      }),

    // ===== Phase 2A: Content follows =====

    contentFollowStatus: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const row = await db.getContentFollowStatus(ctx.user.id, input.contentType, input.contentId);
        return { following: !!row };
      }),

    followContent: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.followContent(ctx.user.id, input.contentType, input.contentId);
        return { success: true };
      }),

    unfollowContent: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowContent(ctx.user.id, input.contentType, input.contentId);
        return { success: true };
      }),

    // ===== Phase 2A: Reactions =====

    toggleReaction: protectedProcedure
      .input(z.object({
        targetType: z.enum(["post", "comment"]),
        targetId: z.number().int().positive(),
        reactionType: z.enum(["helpful"]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        if (input.targetType === "post") {
          const post = await db.getCommunityPostById(input.targetId);
          if (!post || post.deletedAt || post.isHidden) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
        } else {
          const comment = await db.getCommunityCommentById(input.targetId);
          if (!comment || comment.deletedAt || comment.isHidden) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
        }
        const result = await db.toggleReaction(ctx.user.id, input.targetType, input.targetId, input.reactionType);
        return result;
      }),

    reactionSummary: publicProcedure
      .input(z.object({
        targetType: z.enum(["post", "comment"]),
        targetId: z.number().int().positive(),
        reactionType: z.enum(["helpful"]),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.getReactionSummary(input.targetType, input.targetId, ctx.user?.id);
      }),

    // ===== Phase 2A: Mention search =====

    searchMentionTargets: protectedProcedure
      .input(z.object({
        query: z.string().min(1).max(50),
        postId: z.number().int().positive().optional(),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.searchMentionTargets(input.query, ctx.user.id, input.postId);
      }),

    // ===== Phase 2A: Notifications =====

    notificationUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      const visibleTypes = getVisibleTypesForUser(ctx.user.role);
      const count = await db.getCommunityNotificationUnreadCount(ctx.user.id, visibleTypes);
      return { count };
    }),

    notificationList: protectedProcedure
      .input(z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        const visibleTypes = getVisibleTypesForUser(ctx.user.role);
        return db.listCommunityNotifications(ctx.user.id, input.page, input.pageSize, visibleTypes);
      }),

    notificationMarkRead: protectedProcedure
      .input(z.object({ notificationId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const visibleTypes = getVisibleTypesForUser(ctx.user.role);
        await db.markCommunityNotificationRead(input.notificationId, ctx.user.id, visibleTypes);
        return { success: true };
      }),

    notificationMarkAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      const visibleTypes = getVisibleTypesForUser(ctx.user.role);
      await db.markAllCommunityNotificationsRead(ctx.user.id, visibleTypes);
      return { success: true };
    }),

    // ===== Phase 3A: Community Bids =====

    // 1 ≤ durationHours ≤ 168 (7 days)
    createBid: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        title: z.string().min(1).max(200).trim(),
        description: z.string().min(1).max(10000).trim(),
        quantity: z.string().max(200).trim().nullable().optional(),
        material: z.string().max(200).trim().nullable().optional(),
        specifications: z.string().max(5000).trim().nullable().optional(),
        sampleRequired: z.boolean().default(false),
        desiredDeliveryDate: z.string().max(100).trim().nullable().optional(),
        deliveryLocation: z.string().max(200).trim().nullable().optional(),
        budgetMin: z.number().int().positive().nullable().optional(),
        budgetMax: z.number().int().positive().nullable().optional(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
        durationHours: z.number().int().min(1).max(168),
        authorFactoryId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        assertCommunityImagesOwned(input.images, ctx.user.id);
        if (input.budgetMin != null && input.budgetMax != null && input.budgetMin > input.budgetMax) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "預算下限不可高於上限" });
        }

        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;
        let resolvedFactoryId: number | null = null;
        if (factoryOptions.length === 0) {
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        // Validate pinnedProductIds: personal bid cannot have products; must belong to resolved factory
        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          if (resolvedFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "個人競標需求不能附加工廠商品" });
          }
          const factoryProducts = await db.getProductsByFactoryId(resolvedFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const bidId = await db.createCommunityBid({
          spaceCode: input.spaceCode,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          title: input.title,
          description: input.description,
          quantity: input.quantity ?? null,
          material: input.material ?? null,
          specifications: input.specifications ?? null,
          sampleRequired: input.sampleRequired,
          desiredDeliveryDate: input.desiredDeliveryDate ?? null,
          deliveryLocation: input.deliveryLocation ?? null,
          budgetMin: input.budgetMin ?? null,
          budgetMax: input.budgetMax ?? null,
          images: input.images,
          pinnedProductIds: dedupedProductIds,
          durationHours: input.durationHours,
        });
        return { bidId };
      }),

    updateBid: protectedProcedure
      .input(z.object({
        bidId: z.number().int(),
        title: z.string().min(1).max(200).trim().optional(),
        description: z.string().min(1).max(10000).trim().optional(),
        quantity: z.string().max(200).trim().nullable().optional(),
        material: z.string().max(200).trim().nullable().optional(),
        specifications: z.string().max(5000).trim().nullable().optional(),
        sampleRequired: z.boolean().optional(),
        desiredDeliveryDate: z.string().max(100).trim().nullable().optional(),
        deliveryLocation: z.string().max(200).trim().nullable().optional(),
        budgetMin: z.number().int().positive().nullable().optional(),
        budgetMax: z.number().int().positive().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
        durationHours: z.number().int().min(1).max(168).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此需求" });
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以編輯" });
        }
        if (input.images !== undefined) {
          assertCommunityImagesOwned(input.images, ctx.user.id);
        }
        if (input.budgetMin != null && input.budgetMax != null && input.budgetMin > input.budgetMax) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "預算下限不可高於上限" });
        }
        // Validate pinnedProductIds update: must belong to bid's authorFactory
        let dedupedUpdatedProductIds: number[] | undefined;
        if (input.pinnedProductIds !== undefined) {
          dedupedUpdatedProductIds = Array.from(new Set(input.pinnedProductIds));
          if (dedupedUpdatedProductIds.length > 0) {
            if (bid.authorFactoryId == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "個人競標需求不能附加工廠商品" });
            }
            const factoryProducts = await db.getProductsByFactoryId(bid.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            const invalid = dedupedUpdatedProductIds.find(id => !validIds.has(id));
            if (invalid != null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
            }
          }
        }
        const { bidId, pinnedProductIds: _pp, ...updates } = input;
        await db.updateCommunityBid(bidId, { ...updates, ...(dedupedUpdatedProductIds !== undefined ? { pinnedProductIds: dedupedUpdatedProductIds } : {}) });
        return { success: true };
      }),

    submitBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        requireVerifiedEmail(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限提交此需求" });
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以提交審核" });
        }
        // Re-validate authorFactoryId still approved
        if (bid.authorFactoryId != null) {
          const factory = await db.getFactoryById(bid.authorFactoryId);
          if (!factory || factory.status !== "approved") {
            throw new TRPCError({ code: "FORBIDDEN", message: "代表工廠不符合條件，請重新建立需求" });
          }
        }
        // Re-validate pinnedProductIds: strip deleted/unavailable products; reject cross-factory ones
        const existingProductIds = (bid.pinnedProductIds ?? []) as number[];
        let removedProductCount = 0;
        if (existingProductIds.length > 0) {
          if (bid.authorFactoryId == null) {
            // Personal bid somehow has products — strip all (shouldn't happen, but guard)
            await db.updateCommunityBid(input.bidId, { pinnedProductIds: [] });
            removedProductCount = existingProductIds.length;
          } else {
            const factoryProducts = await db.getProductsByFactoryId(bid.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            // Any ID not in factory's product list is either deleted or cross-factory — strip it
            const survivingIds = existingProductIds.filter(id => validIds.has(id));
            removedProductCount = existingProductIds.length - survivingIds.length;
            if (removedProductCount > 0) {
              await db.updateCommunityBid(input.bidId, { pinnedProductIds: survivingIds });
            }
          }
        }
        await db.submitCommunityBidForReview(input.bidId, ctx.user.id, ctx.user.name ?? "");
        return { success: true, removedProductCount };
      }),

    withdrawBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此需求" });
        if (bid.status !== "pending_review") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核中的需求可以撤回" });
        }
        await db.withdrawCommunityBid(input.bidId, ctx.user.id, ctx.user.name ?? "");
        return { success: true };
      }),

    deleteBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此需求" });
        }
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以刪除" });
        }
        await db.softDeleteCommunityBid(input.bidId);
        return { success: true };
      }),

    cancelBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限取消此需求" });
        }
        if (bid.status !== "active") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有進行中的需求可以取消" });
        }
        await db.cancelCommunityBid(input.bidId);
        return { success: true };
      }),

    listBids: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        return db.listCommunityBids({ spaceCode: input.spaceCode, status: "active", page: input.page, pageSize: input.pageSize });
      }),

    getMyBids: protectedProcedure
      .input(z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.listCommunityBids({ authorUserId: ctx.user.id, page: input.page, pageSize: input.pageSize });
      }),

    getBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const isOwner = bid.authorUserId === ctx.user.id;
        const isAdmin = ctx.user.role === "admin";
        // Only owner or admin can see non-active states
        if (!isOwner && !isAdmin && bid.status !== "active") {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        }
        const targetIndustries = await db.getCommunityBidIndustries(input.bidId);
        const reviewHistory = isAdmin ? await db.listCommunityBidReviewHistory(input.bidId) : [];
        const pinnedProductIdsArr = (bid.pinnedProductIds ?? []) as number[];
        const pinnedProducts = pinnedProductIdsArr.length > 0 ? await db.getProductsByIds(pinnedProductIdsArr) : [];
        return { bid, targetIndustries, reviewHistory, pinnedProducts };
      }),

    pendingBidCount: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      if (ctx.user.role !== "admin") return { count: 0 };
      const count = await db.countPendingCommunityBids();
      return { count };
    }),

    // ===== Phase 3B: 廠商投標報價 =====

    createBidOffer: protectedProcedure
      .input(z.object({
        bidId: z.number().int().positive(),
        bidderFactoryId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        currency: z.string().max(10).default("TWD"),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().default(false),
        proposal: z.string().min(1).max(5000).trim(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        requireVerifiedEmail(ctx.user);

        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法投標" });
        }
        if (bid.authorUserId === ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "不可對自己的需求投標" });
        }

        const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
        if (myFactories.length === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "需以已審核工廠身分參與投標" });
        }
        const selectedFactory = myFactories.find(f => f.factoryId === input.bidderFactoryId);
        if (!selectedFactory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠，或工廠尚未審核通過" });
        }

        assertCommunityImagesOwned(input.images, ctx.user.id);

        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          const factoryProducts = await db.getProductsByFactoryId(input.bidderFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        let offerId: number;
        try {
          offerId = await db.createCommunityBidOffer({
            bidId: input.bidId,
            bidderUserId: ctx.user.id,
            bidderFactoryId: input.bidderFactoryId,
            bidderNameSnapshot: ctx.user.name ?? "",
            bidderFactoryNameSnapshot: selectedFactory.factoryName,
            bidderRoleSnapshot: selectedFactory.role,
            amount: input.amount ?? null,
            currency: input.currency,
            deliveryDays: input.deliveryDays ?? null,
            moq: input.moq ?? null,
            sampleAvailable: input.sampleAvailable,
            proposal: input.proposal,
            commercialTerms: input.commercialTerms ?? null,
            images: input.images,
            pinnedProductIds: dedupedProductIds,
          });
        } catch (e: any) {
          if (e?.code === "CONFLICT") {
            throw new TRPCError({ code: "CONFLICT", message: "此工廠已有投標紀錄" });
          }
          if (e?.code === "BID_UNAVAILABLE") {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          throw e;
        }

        // Notify bid author of new offer (station-only, no Email/Push per Phase 3B spec)
        if (bid.authorUserId) {
          await db.createCommunityNotificationsBatch([{
            recipientUserId: bid.authorUserId,
            actorUserId: ctx.user.id,
            actorFactoryId: input.bidderFactoryId,
            eventType: "bid_new_offer",
            eventGroup: `bid:${input.bidId}`,
            titleSnapshot: bid.title,
            actorNameSnapshot: ctx.user.name ?? "",
            actorFactoryNameSnapshot: selectedFactory.factoryName,
            message: `您的需求「${bid.title}」收到新投標`,
            dedupeKey: `bid:${input.bidId}:new-offer:factory:${input.bidderFactoryId}`,
          }]);
        }

        return { offerId };
      }),

    updateBidOffer: protectedProcedure
      .input(z.object({
        offerId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().optional(),
        proposal: z.string().min(1).max(5000).trim().optional(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const { offerId, ...fields } = input;
        const offerRow = await db.getCommunityBidOfferById(offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "只有進行中的投標可以編輯" });

        // bidderFactoryId=null means factory was deleted; no one can update such an offer
        if (offerRow.bidderFactoryId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "工廠已失效，無法更新此投標" });
        }

        // Access: original bidder OR active co-manager of bidder factory
        if (offerRow.bidderUserId !== ctx.user.id) {
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          if (!myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此投標" });
          }
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (!bid || bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標修改" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法修改投標" });
        }

        if (fields.images !== undefined) {
          assertCommunityImagesOwned(fields.images, ctx.user.id);
        }

        let removedProductCount = 0;
        {
          // Validate pinnedProductIds: soft-skip deleted, hard-reject cross-factory
          const rawIds = fields.pinnedProductIds !== undefined
            ? Array.from(new Set(fields.pinnedProductIds))
            : ((offerRow.pinnedProductIds as number[]) ?? []);
          const userChangedProducts = fields.pinnedProductIds !== undefined;
          if (rawIds.length > 0) {
            const foundProducts = await db.getProductsByIds(rawIds);
            const foundById = new Map(foundProducts.map(p => [p.id, p]));
            const validPinned: number[] = [];
            for (const id of rawIds) {
              const product = foundById.get(id);
              if (!product) {
                removedProductCount++;
              } else if (product.factoryId !== offerRow.bidderFactoryId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${id} 不屬於此工廠` });
              } else {
                validPinned.push(id);
              }
            }
            if (userChangedProducts || removedProductCount > 0) {
              fields.pinnedProductIds = validPinned;
            } else {
              delete fields.pinnedProductIds;
            }
          } else if (userChangedProducts) {
            fields.pinnedProductIds = [];
          }
        }

        try {
          await db.updateCommunityBidOfferSafe(offerId, fields, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true, removedProductCount };
      }),

    withdrawBidOffer: protectedProcedure
      .input(z.object({ offerId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const offerRow = await db.getCommunityBidOfferById(input.offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "只有進行中的投標可以撤回" });

        // Access: original bidder OR active co-manager of bidder factory
        // (null bidderFactoryId: factory deleted; only original bidder can withdraw)
        if (offerRow.bidderUserId !== ctx.user.id) {
          if (offerRow.bidderFactoryId == null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此投標" });
          }
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          if (!myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此投標" });
          }
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (bid && bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法撤回投標" });
        }

        try {
          await db.withdrawCommunityBidOffer(input.offerId, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true };
      }),

    resubmitBidOffer: protectedProcedure
      .input(z.object({
        offerId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().optional(),
        proposal: z.string().min(1).max(5000).trim().optional(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const { offerId, ...fields } = input;
        const offerRow = await db.getCommunityBidOfferById(offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "withdrawn") throw new TRPCError({ code: "BAD_REQUEST", message: "只有已撤回的投標可以重新投標" });

        // null bidderFactoryId = factory was deleted; cannot resubmit
        if (offerRow.bidderFactoryId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "工廠已失效，無法重新投標" });
        }

        // Access: original bidder OR active co-manager; also validates factory still approved
        const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
        const hasAccess = offerRow.bidderUserId === ctx.user.id
          ? myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)  // original bidder: also re-validate factory
          : myFactories.some(f => f.factoryId === offerRow.bidderFactoryId); // co-manager check
        if (!hasAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限重新投標，或代表工廠已失效" });
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (!bid || bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法重新投標" });
        }

        if (fields.images !== undefined) {
          assertCommunityImagesOwned(fields.images, ctx.user.id);
        }

        let removedProductCount = 0;
        if (fields.pinnedProductIds !== undefined) {
          const dedupedIds = Array.from(new Set(fields.pinnedProductIds));
          if (dedupedIds.length > 0) {
            const foundProducts = await db.getProductsByIds(dedupedIds);
            const foundById = new Map(foundProducts.map(p => [p.id, p]));
            const validPinned: number[] = [];
            for (const id of dedupedIds) {
              const product = foundById.get(id);
              if (!product) {
                removedProductCount++;
              } else if (product.factoryId !== offerRow.bidderFactoryId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${id} 不屬於此工廠` });
              } else {
                validPinned.push(id);
              }
            }
            fields.pinnedProductIds = validPinned;
          } else {
            fields.pinnedProductIds = [];
          }
        }

        try {
          await db.resubmitCommunityBidOffer(offerId, fields, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true, removedProductCount };
      }),

    getMyBidOffer: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);

        // Try userId-based lookup first (original bidder)
        let offer = await db.getCommunityBidOfferByUser(input.bidId, ctx.user.id);

        // Fallback: factory-based lookup for co-managers
        if (!offer) {
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          for (const f of myFactories) {
            const factoryOffer = await db.getCommunityBidOfferByFactory(input.bidId, f.factoryId);
            if (factoryOffer) { offer = factoryOffer; break; }
          }
        }

        if (!offer) return { offer: null, pinnedProducts: [] };
        const pinnedProducts = await db.getProductsByIds((offer.pinnedProductIds as number[]) ?? []);
        return { offer, pinnedProducts };
      }),

    getBidOfferCount: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const count = await db.getCommunityBidOfferCount(input.bidId);
        return { count };
      }),

    listBidOffersForOwner: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const isOwner = bid.authorUserId === ctx.user.id;
        const isAdmin = ctx.user.role === "admin";
        if (!isOwner && !isAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有發包者或管理員可以查看所有投標" });
        }
        const offers = await db.listCommunityBidOffersForOwner(input.bidId);

        // Batch-fetch all products pinned across all offers (deduped)
        const allPinnedIds = Array.from(new Set(offers.flatMap(o => (o.pinnedProductIds as number[]) ?? [])));
        const allProducts = await db.getProductsByIds(allPinnedIds);

        return { offers, allProducts, isAdmin };
      }),
  }),

  // ===== 企業升級中心 =====
  upgradeCenter: router({
    submitApplication: publicProcedure.input(z.object({
      companyName: z.string().min(1).max(200),
      contactName: z.string().min(1).max(100),
      phone: z.string().min(7).max(30),
      email: z.string().email().max(320),
      location: z.string().min(1).max(100),
      capitalAmount: z.string().min(1).max(30),
      employeeCount: z.string().min(1).max(30),
      factoryType: z.string().min(1).max(30),
      hasGovernmentProject: z.boolean(),
      governmentProjectName: z.string().max(200).optional(),
      hasGovernmentAward: z.boolean(),
      governmentAwardName: z.string().max(200).optional(),
      hasPatent: z.boolean(),
      patentCount: z.number().int().min(1).max(9999).optional(),
      exportStatus: z.string().min(1).max(30),
      notes: z.string().max(2000).optional(),
      consentAgreed: z.literal(true),
    })).mutation(async ({ input }) => {
      const isDuplicate = await db.findRecentUpgradeApplication(input.email, input.phone);
      if (isDuplicate) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "您已在 10 分鐘內送出過申請，請稍後再試。",
        });
      }
      // Auto-assign to regional consultant
      const regionKey = db.resolveRegionKey(input.location);
      let assignedConsultantId: number | null = null;
      let status: "new" | "unassigned" = "unassigned";
      if (regionKey) {
        const consultant = await db.getConsultantByRegion(regionKey);
        if (consultant) {
          assignedConsultantId = consultant.id;
          status = "new";
        }
      }
      const id = await db.createUpgradeApplication({
        companyName: input.companyName,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        location: input.location,
        capitalAmount: input.capitalAmount,
        employeeCount: input.employeeCount,
        factoryType: input.factoryType,
        hasGovernmentProject: input.hasGovernmentProject,
        governmentProjectName: input.governmentProjectName ?? null,
        hasGovernmentAward: input.hasGovernmentAward,
        governmentAwardName: input.governmentAwardName ?? null,
        hasPatent: input.hasPatent,
        patentCount: input.patentCount ?? null,
        exportStatus: input.exportStatus,
        notes: input.notes ?? null,
        consentAgreed: true,
        status,
        assignedConsultantId,
      });
      sendUpgradeApplicationEmail({
        companyName: input.companyName,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        location: input.location,
        applicationId: id,
      }).catch((err) => {
        console.error("[Email] upgrade center notification failed:", err);
      });
      return { success: true, id };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new", "viewed", "contacted", "consulting", "submitted", "completed", "unassigned", "archived"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listUpgradeApplications({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countUpgradeApplications(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getUpgradeApplicationById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到申請案件" });
      return item;
    }),

    adminUpdateStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["new", "viewed", "contacted", "consulting", "submitted", "completed", "unassigned", "archived"]),
    })).mutation(async ({ input }) => {
      await db.updateUpgradeApplicationStatus(input.id, input.status);
      return { success: true };
    }),
  }),

  // ===== 顧問案件管理 =====
  upgradeConsultant: router({
    // 取得目前登入者的顧問身份
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getConsultantsByUserId(ctx.user.id);
    }),

    // 顧問查看自己地區的案件
    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new", "viewed", "contacted", "consulting", "submitted", "completed", "unassigned", "archived"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ ctx, input }) => {
      const consultants = await db.getConsultantsByUserId(ctx.user.id);
      if (consultants.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
      const ids = consultants.map(c => c.id);
      const [items, total] = await Promise.all([
        db.listApplicationsByConsultantIds(ids, { status: input.status, limit: input.limit, offset: input.offset }),
        db.countApplicationsByConsultantIds(ids, input.status),
      ]);
      return { items, total, consultants };
    }),

    // 顧問查收案件
    acknowledge: protectedProcedure.input(z.object({
      applicationId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const consultants = await db.getConsultantsByUserId(ctx.user.id);
      if (consultants.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
      // Find which consultant this application belongs to
      const app = await db.getUpgradeApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      const belongsToMe = consultants.some(c => c.id === app.assignedConsultantId);
      if (!belongsToMe) throw new TRPCError({ code: "FORBIDDEN", message: "此案件不屬於您的地區" });
      if (app.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "此案件已查收或狀態不符" });
      const result = await db.acknowledgeUpgradeApplication(app.id, app.assignedConsultantId!, ctx.user.id);
      if (!result.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "查收失敗，請重試" });
      return { success: true };
    }),

    // 管理員：查看所有顧問設定
    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllConsultants();
    }),

    // 管理員：綁定 / 解除顧問 userId
    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ input }) => {
      await db.bindConsultantUser(input.consultantId, input.userId);
      return { success: true };
    }),

    // 管理員：統計
    adminStats: adminProcedure.query(async () => {
      return db.adminGetUpgradeStats();
    }),
  }),

});

export type AppRouter = typeof appRouter;
