import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import { sdk } from "./_core/sdk";
import { enhanceSearchKeyword } from './semantic-search';
import { sendNewInquiryEmail, sendFactoryApprovedEmail, sendFactorySubmittedEmail, sendReportEmail, sendSupportTicketEmail, sendReviewReplyEmail, sendNewMessageNotificationEmail, sendReportStatusUpdateEmail, sendTicketStatusUpdateEmail, sendMessageReplyNotificationEmail, sendEmailVerificationEmail, sendAdminBroadcastEmail } from './email';
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
import { INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS } from "../shared/constants";
import { nanoid } from "nanoid";
import { factories, conversations, reviews, reports } from "../drizzle/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";

function requireVerifiedEmail(user: { primaryEmailVerifiedAt: Date | null }): void {
  if (!user.primaryEmailVerifiedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "UNVERIFIED_EMAIL" });
  }
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

export const appRouter = router({
  system: systemRouter,

  analytics: router({
    record: publicProcedure.input(z.object({ visitorId: z.string().max(64) })).mutation(async ({ input }) => {
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
    getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) return null;
      const prods = await db.getProductsByFactoryId(input.id);
      return { ...factory, products: prods };
    }),

    getMine: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) return null;
      const prods = await db.getProductsByFactoryId(factory.id);
      return { ...factory, products: prods };
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
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().email().optional().or(z.literal("")),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      if (ctx.user.role !== 'admin') {
        const existing = await db.getFactoryByOwnerId(ctx.user.id);
        if (existing) throw new TRPCError({ code: 'BAD_REQUEST', message: '您已經註冊過工廠' });
      }
      try {
        const factoryId = await db.createFactory({ ...input, ownerId: ctx.user.id, status: 'draft' });
        await db.setFactoryOwner(ctx.user.id, true);
        return { id: factoryId };
      } catch (err: any) {
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
      try {
        await db.updateFactory(id, isOwner ? ctx.user.id : -1, data);
      } catch (err: any) {
        console.error('[factory.update] DB error:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '更新工廠失敗，請稍後再試' });
      }
      return { success: true };
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
  const enhancedKeyword = input.keyword ? await enhanceSearchKeyword(input.keyword) : input.keyword;
  const industry = input.industry && input.industry.length > 0 ? input.industry : undefined;
  const subIndustry = input.subIndustry && input.subIndustry.length > 0 ? input.subIndustry : undefined;
  const region = input.region && input.region.length > 0 ? input.region : undefined;
  const capitalLevel = input.capitalLevel && input.capitalLevel.length > 0 ? input.capitalLevel : undefined;
  const businessType = input.businessType && input.businessType !== 'all' ? input.businessType : undefined;
  const result = await db.searchFactories({ ...input, industry, subIndustry, region, capitalLevel, keyword: enhancedKeyword, businessType });
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
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `factory-avatars/${factory.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await db.updateFactory(factory.id, ctx.user.id, { avatarUrl: url });
      return { url };
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
      if (!invitee) throw new Error("此 Email 尚未在平台上註冊");
      if (invitee.id === ctx.user.id) throw new Error("不能邀請自己");

      const alreadyCoManager = await db.isActiveCoManager(factory.id, invitee.id);
      if (alreadyCoManager) throw new Error("此用戶已是本工廠的次管理者");

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

      return { success: true, conversationId: conv.id };
    }),

    respondToInvitation: protectedProcedure.input(z.object({
      invitationId: z.number(),
      action: z.enum(["accept", "decline"]),
    })).mutation(async ({ ctx, input }) => {
      if (input.action === "accept") requireVerifiedEmail(ctx.user);
      if (input.action === "accept") {
        await db.acceptInvitation(input.invitationId, ctx.user.id);
      } else {
        await db.declineInvitation(input.invitationId, ctx.user.id);
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
      const filtered = batchConvIds.size === 0 ? all : all.filter(c => !batchConvIds.has(c.id));
      const regularConvs = filtered.map(c => ({ ...c, isAdminMessage: false as const }));

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
        await db.markMessagesAsRead(input.conversationId, ctx.user.id);
        return await db.getMessagesByConversation(input.conversationId, input.page);
      } catch (error) {
        console.error("[getMessages] DB query failed", {
          conversationId: input.conversationId,
          userId: ctx.user.id,
          error,
        });
        throw error;
      }
    }),

    // 取得對話的 metadata（工廠名稱、產品名稱，用於 ChatPage 預填）
    getConversationMeta: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) return null;
      const factory = await db.getFactoryById(conv.factoryId);
      const product = conv.productId ? await db.getProductById(conv.productId) : null;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      return {
        factoryName: factory?.name ?? "未知工廠",
        productName: product?.name ?? null,
        factoryId: conv.factoryId,
        productId: conv.productId,
        userId: conv.userId,
        factoryOwnerId: factory?.ownerId ?? null,
        isCoMgr,
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
        }).catch(() => {});
      }

      if (senderRole === "user") {
        try {
          const productInfo = conv.productId ? await db.getProductById(conv.productId) : null;
          await notifyOwner({
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
          });
          // 寄 email 給工廠（只有填了 contactEmail 才寄）
          if (factory?.contactEmail) {
            await sendNewInquiryEmail({
              factoryName: factory.name,
              factoryEmail: factory.contactEmail,
              userName: ctx.user.name ?? '匿名',
              productName: productInfo?.name,
              message: input.content,
            });
          }
        } catch (e) { console.warn("通知發送失敗", e); }
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

      // 驗證對話存取權限（使用者本人 or 工廠 owner）
      const conv = await db.getConversationById(msg.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isConvUser = conv.userId === ctx.user.id;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      if (!isConvUser && !isFactoryOwner) throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });

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
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      const factoryCount = factory ? await db.getUnreadCountForFactory(factory.id) : 0;
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
  if (ctx.user.role !== 'admin') return { count: 0 };
  const db_ = await getDb();
  if (!db_) return { count: 0 };
  const [result] = await db_.select({ count: sql<number>`COUNT(*)` })
    .from(factories)
    .where(eq(factories.status, 'pending'));
  return { count: Number(result?.count ?? 0) };
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
      return { ...factory, ownerAccountName: owner?.name ?? null, ownerAccountEmail: owner?.email ?? null };
    }),

    approveFactory: adminProcedure.input(z.object({ factoryId: z.number() })).mutation(async ({ input }) => {
  await db.updateFactory(input.factoryId, -1, { status: 'approved' });
  // 寄 email 通知工廠審核通過（只有填了 contactEmail 才寄）
  const factory = await db.getFactoryById(input.factoryId);
  if (factory?.contactEmail) {
    await sendFactoryApprovedEmail({
      factoryName: factory.name,
      factoryEmail: factory.contactEmail,
    });
  }
  return { success: true };
}),

    rejectFactory: adminProcedure.input(z.object({ factoryId: z.number(), reason: z.string() })).mutation(async ({ input }) => {
      await db.updateFactory(input.factoryId, -1, { status: 'rejected', rejectionReason: input.reason });
      return { success: true };
    }),

    getPendingFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminPendingFactories(input.page, input.pageSize);
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
      // 通知檢舉者（若有開啟 reportUpdate 通知設定）
      if (report?.userEmail) {
        const settings = (report.notificationSettings as Record<string, boolean> | null) ?? {};
        if (settings.reportUpdate !== false) {
          sendReportStatusUpdateEmail({
            userEmail: report.userEmail,
            userName: report.userName ?? '您',
            factoryName: report.factoryName ?? '工廠',
            status: input.status,
          }).catch(() => {});
        }
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
      // 通知投訴者（若有開啟 ticketUpdate 通知設定）
      if (ticket?.userEmail) {
        const settings = (ticket.notificationSettings as Record<string, boolean> | null) ?? {};
        if (settings.ticketUpdate !== false) {
          sendTicketStatusUpdateEmail({
            userEmail: ticket.userEmail,
            userName: ticket.userName ?? '您',
            subject: ticket.subject,
            status: input.status,
          }).catch(() => {});
        }
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
      // 非同步寄信，不阻塞 response
      db.getRecipientsWithEmails(campaignId).then(recipients => {
        for (const r of recipients) {
          if (r.email) {
            sendAdminBroadcastEmail({
              toEmail: r.email,
              toName: r.name,
              campaignTitle: input.title,
              campaignContent: input.content,
              campaignId,
            });
          }
        }
      });
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

          // 通知工廠（非同步，失敗不影響主流程）
          if (factory.contactEmail) {
            import("./email").then(({ sendNewInquiryEmail }) => {
              sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: factory.contactEmail!,
                userName: ctx.user.name ?? "匿名",
                message: input.message,
              }).catch(() => {});
            }).catch(() => {});
          }
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

});

export type AppRouter = typeof appRouter;
