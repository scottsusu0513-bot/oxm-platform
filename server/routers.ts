import { COOKIE_NAME } from "@shared/const";
import { enhanceSearchKeyword } from './semantic-search';
import { sendNewInquiryEmail, sendFactoryApprovedEmail } from './email';
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { notifyOwner } from "./_core/notification";
import { storagePut } from "./storage";
import { validateImageUpload } from "./_core/security";
import { INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS } from "../shared/constants";
import { nanoid } from "nanoid";
import { factories, conversations, reviews, reports } from "../drizzle/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { getDb } from "./db";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "lax", secure: true });
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
      ctx.res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "lax", secure: true });
      return { success: true };
    }),
  }),

  // ===== 客服工單 =====
  support: router({
    create: protectedProcedure.input(z.object({
      type: z.string().min(1).max(50),
      subject: z.string().min(1).max(200),
      description: z.string().min(1),
    })).mutation(async ({ ctx, input }) => {
      await db.createSupportTicket({ ...input, userId: ctx.user.id });
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
      industry: z.string(),
      subIndustry: z.array(z.string()).optional(),
      mfgModes: z.array(z.string()).min(1),
      region: z.string(),
      description: z.string().optional(),
      capitalLevel: z.string(),
      address: z.string().min(1),
      foundedYear: z.number().min(1800).max(2100).optional().nullable(),
      avatarUrl: z.string().optional().nullable(),
      businessType: z.enum(["factory", "studio"]).default("factory"),
      ownerName: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().email().optional().or(z.literal("")),
    })).mutation(async ({ ctx, input }) => {
      // 管理員可以重複建立工廠（測試用），一般使用者只能建立一次
      if (ctx.user.role !== 'admin') {
        const existing = await db.getFactoryByOwnerId(ctx.user.id);
        if (existing) throw new Error("您已經註冊過工廠");
      }
      const factoryId = await db.createFactory({ ...input, ownerId: ctx.user.id, status: 'draft' });
      await db.setFactoryOwner(ctx.user.id, true);
      return { id: factoryId };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      industry: z.string().optional(),
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
      avatarUrl: z.string().optional(),
      address: z.string().optional(),
      operationStatus: z.enum(["normal", "busy", "full"]).optional(),
      weekdayHours: z.string().max(50).optional(),
      weekendHours: z.string().max(50).optional(),
      businessNote: z.string().max(500).optional(),
    })).mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateFactory(id, ctx.user.id, data);
      return { success: true };
    }),

    search: publicProcedure.input(z.object({
  industry: z.string().max(50).optional(),
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
  const industry = input.industry === 'all' ? undefined : input.industry;
  const subIndustry = input.subIndustry && input.subIndustry.length > 0 ? input.subIndustry : undefined;
  const region = input.region && input.region.length > 0 ? input.region : undefined;
  const capitalLevel = input.capitalLevel && input.capitalLevel.length > 0 ? input.capitalLevel : undefined;
  const businessType = input.businessType && input.businessType !== 'all' ? input.businessType : undefined;
  const result = await db.searchFactories({ ...input, industry, subIndustry, region, capitalLevel, keyword: enhancedKeyword, businessType });
  let ads: Awaited<ReturnType<typeof db.getActiveAds>> = [];

  if (input.page === 1) {
    ads = await db.getActiveAds({ industry: input.industry, capitalLevel: input.capitalLevel?.[0], region: input.region?.[0] });
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
      mimeType: z.string().default("image/jpeg"),
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
      return { success: true };
    }),

    getPhotos: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getPhotosByFactoryId(input.factoryId);
    }),

    uploadPhoto: protectedProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.string().default("image/jpeg"),
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
      mimeType: z.string().default("image/jpeg"),
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
  if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
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
    .input(z.object({ factoryIds: z.array(z.number()) }))
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
      return db.getFactoryById(input.id);
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
      await db.updateReportStatus(input.id, input.status, input.adminNote);
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
      await db.updateSupportTicketStatus(input.id, input.status, input.adminNote);
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
