import { COOKIE_NAME } from "@shared/const";
import { enhanceSearchKeyword } from './semantic-search';
import { sendNewInquiryEmail, sendFactoryApprovedEmail, sendFactorySubmittedEmail, sendReportEmail, sendSupportTicketEmail, sendReviewReplyEmail, sendNewMessageNotificationEmail, sendReportStatusUpdateEmail, sendTicketStatusUpdateEmail } from './email';
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

    create: protectedProcedure.input(z.object({ name: z.string().min(1).max(100) })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      const id = await db.createCategory(factory.id, input.name.trim());
      return { id };
    }),

    update: protectedProcedure.input(z.object({ id: z.number(), name: z.string().min(1).max(100) })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.updateCategory(input.id, factory.id, input.name.trim());
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.deleteCategory(input.id, factory.id);
      return { success: true };
    }),

    assignProduct: protectedProcedure.input(z.object({
      productId: z.number(),
      categoryId: z.number().nullable(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
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
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限操作此工廠");
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
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限操作此工廠");
      const { id, factoryId, ...data } = input;
      await db.updateProduct(id, factoryId, data);
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限操作此工廠");
      await db.deleteProduct(input.id, input.factoryId);
      return { success: true };
    }),

    // 上傳產品圖片（base64）
    uploadImage: protectedProcedure.input(z.object({
      factoryId: z.number(),
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
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

    // 取得使用者的所有對話（含未讀計數與最後訊息）
    myConversations: protectedProcedure.query(async ({ ctx }) => {
  return db.getConversationsByUserWithDetails(ctx.user.id);
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
      if (conv.userId !== ctx.user.id && factory?.ownerId !== ctx.user.id && ctx.user.role !== 'admin') throw new Error("無權限");
      await db.markMessagesAsRead(input.conversationId, ctx.user.id);
      return db.getMessagesByConversation(input.conversationId, input.page);
    }),

    // 取得對話的 metadata（工廠名稱、產品名稱，用於 ChatPage 預填）
    getConversationMeta: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) return null;
      const factory = await db.getFactoryById(conv.factoryId);
      const product = conv.productId ? await db.getProductById(conv.productId) : null;
      return {
        factoryName: factory?.name ?? "未知工廠",
        productName: product?.name ?? null,
        factoryId: conv.factoryId,
        productId: conv.productId,
        userId: conv.userId,
        factoryOwnerId: factory?.ownerId ?? null,
      };
    }),

    send: protectedProcedure.input(z.object({
      conversationId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isUser = conv.userId === ctx.user.id;
      if (!isFactoryOwner && !isUser) throw new Error("無權限");
      const senderRole = isFactoryOwner ? "factory" as const : "user" as const;
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

    // 查詢工廠可傳送的商品（僅工廠 owner 可呼叫）
    getFactoryProducts: protectedProcedure.input(z.object({ conversationId: z.number() })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      if (factory?.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠擁有者可存取" });
      return db.getProductsByFactoryId(factory.id);
    }),

    // 傳送商品附件訊息
    sendProduct: protectedProcedure.input(z.object({
      conversationId: z.number(),
      productIds: z.array(z.number().int()).min(1).max(10),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      if (factory?.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠擁有者可傳送商品" });

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
      if (factory?.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠擁有者可上傳型錄" });

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
      const userCount = await db.getUnreadCount(ctx.user.id);
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      const factoryCount = factory ? await db.getUnreadCountForFactory(factory.id) : 0;
      return { userCount, factoryCount };
    }),

    // 刪除對話
    deleteConversation: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await db.deleteConversation(input.conversationId, ctx.user.id);
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
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) return { count: 0 };
      return db.countUnrepliedReviews(factory.id);
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

  // ===== 檢舉 =====
  report: router({
    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      reason: z.string().min(1).max(1000),
    })).mutation(async ({ ctx, input }) => {
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
