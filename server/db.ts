import { eq, and, like, desc, asc, sql, inArray, or, isNull, gt, isNotNull, lte, ne, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { createHash } from "crypto";
import type { EventEmitter } from "events";
import {
  InsertUser, users, factories, products, productCategories,
  conversations, conversations as conversationsTable,
  messages, messages as messagesTable,
  reviews, reviews as reviewsTable,
  advertisements, advertisements as advertisementsTable,
  favorites, factoryPhotos, reports, supportTickets, reportStatusHistory, ticketStatusHistory,
  announcements, pageViews, loginPopups, loginPopupViews,
  factoryCoManagerInvitations, factoryCoManagers,
  inquiryBatches, inquiryBatchItems,
  messageCampaigns, messageRecipients, messageReplies,
  oauthStates, appLoginTickets, collaborationOrders, collaborationOrderChangeRequests, collaborationOrderOverdueNotifications, collaborationOrderRepeatRequests, collaborationOrderStageHistory,
  userAuthAccounts, emailVerificationTokens,
  pushNotificationTokens,
  factoryRevisions,
  communityPosts, communityComments,
  communityBoardFollows, factoryFollows, communityContentFollows,
  communityReactions, communityMentions, communityNotifications,
  communityBids, communityBidIndustries, communityBidReviewHistory, communityBidOffers,
  upgradeApplications, upgradeConsultants,
  news, newsIndustries, newsNotifications, newsAttachments,
  type Factory, type InsertFactory, type Product, type InsertProduct, type Favorite, type InsertFavorite,
  type CommunityPost, type CommunityComment,
  type CommunityBoardFollow, type FactoryFollow, type CommunityContentFollow,
  type CommunityReaction, type CommunityMention, type CommunityNotification,
  type CommunityBid, type CommunityBidReviewHistory, type CommunityBidOffer,
  type UpgradeApplication, type InsertUpgradeApplication,
  type UpgradeConsultant,
  type Announcement,
  type News, type InsertNews, type NewsAttachment,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { ADJACENT_REGIONS, INDUSTRY_SLUGS, INDUSTRY_OPTIONS } from "../shared/constants";
import { COMMUNITY_FEATURE_STATUS, COMMUNITY_CROSS_INDUSTRY_SLUG } from "../shared/const";
import type { AISearchIntent } from './semantic-search';

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

function isRetryableDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "PROTOCOL_CONNECTION_LOST" || code === "ECONNRESET" || code === "ETIMEDOUT";
}

export function resetDbPool(): void {
  console.error("[Database] Resetting pool after connection error");
  _pool = null;
  _db = null;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      if (!_pool) {
        _pool = await mysql.createPool({
          uri: process.env.DATABASE_URL,
          connectionLimit: 50,
          waitForConnections: true,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
        });
        (_pool as unknown as EventEmitter).on("error", (rawErr: unknown) => {
          const err = rawErr as Error & { code?: string; fatal?: boolean };
          console.error("[Database] Pool error:", {
            code: err.code,
            message: err.message,
            fatal: err.fatal,
          });
          if (isRetryableDbError(err)) {
            _pool = null;
            _db = null;
          }
        });
      }
      _db = drizzle(_pool) as unknown as ReturnType<typeof drizzle>;
      const conn = await _pool.getConnection();
      await conn.execute("SELECT 1");
      conn.release();
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

// ===== User helpers =====
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
else if (
  user.openId === ENV.ownerOpenId ||
  ENV.adminWhitelistOpenIds.includes(user.openId) ||
  (user.email != null && ENV.adminWhitelistEmails.includes(user.email))
) {
  values.role = 'admin';
  updateSet.role = 'admin';
}
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function setFactoryOwner(userId: number, isOwner: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isFactoryOwner: isOwner }).where(eq(users.id, userId));
}

// ===== Factory helpers =====
export async function createFactory(data: Omit<InsertFactory, "id" | "createdAt" | "updatedAt" | "avgRating" | "reviewCount">) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // Normalize JSON array fields — Drizzle's json() mapToDriverValue requires a real JS array.
  // If a bare string arrives (e.g. from a stale deployed schema treating these as varchar),
  // wrap it so mysql2 receives valid JSON text for the JSON NOT NULL column.
  const toArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string" && v) return [v];
    return [];
  };
  const rawAvatar = (data as any).avatarUrl as string | null | undefined;
  const normalizedData = {
    ...data,
    industry: toArray((data as any).industry),
    mfgModes: toArray((data as any).mfgModes),
    subIndustry: Array.isArray((data as any).subIndustry) ? (data as any).subIndustry : [],
    avatarUrl: rawAvatar && /^https?:\/\//.test(rawAvatar) ? rawAvatar : null,
  };

  const result = await db.insert(factories).values(normalizedData as any);
  return (result as any)[0].insertId;
}

export async function updateFactory(id: number, ownerId: number, data: Partial<InsertFactory>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const toArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[];
    if (typeof v === "string" && v) return [v];
    return [];
  };
  const normalized: Partial<InsertFactory> = { ...data };
  if ("industry" in data) (normalized as any).industry = toArray((data as any).industry);
  if ("mfgModes" in data) (normalized as any).mfgModes = toArray((data as any).mfgModes);
  if ("subIndustry" in data) (normalized as any).subIndustry = Array.isArray((data as any).subIndustry) ? (data as any).subIndustry : [];

  if (ownerId === -1) {
    await db.update(factories).set(normalized).where(eq(factories.id, id));
  } else {
    await db.update(factories).set(normalized).where(and(eq(factories.id, id), eq(factories.ownerId, ownerId)));
  }
}
export async function getApprovedFactoriesForSitemap(): Promise<{ id: number; updatedAt: Date }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: factories.id, updatedAt: factories.updatedAt })
    .from(factories)
    .where(eq(factories.status, 'approved'));
}

export async function getFactoryById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factories).where(eq(factories.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getFactoryByOwnerId(ownerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(factories).where(eq(factories.ownerId, ownerId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// AI 搜尋候選集上限：避免全表掃後在 JS 排序太多筆
const AI_CANDIDATE_LIMIT = 300;

function computeMatchTier(
  factory: Factory,
  productTexts: string[],
  intent: AISearchIntent,
  userHasSelectedIndustry: boolean,
  keyword?: string,
): 0 | 1 | 2 | 3 | 4 {
  const mainMatch = !userHasSelectedIndustry &&
    (factory.industry as string[]).some(i => intent.mainIndustries.includes(i));

  const subMatch = !userHasSelectedIndustry &&
    ((factory.subIndustry ?? []) as string[]).some(s => intent.subIndustries.includes(s));

  // 商品文字包含原始 keyword（最強訊號）
  const productExactMatch = !!keyword && productTexts.some(text =>
    text.toLowerCase().includes(keyword.toLowerCase())
  );

  // 商品文字包含 AI 推測近義詞
  const intentKws = [...intent.productKeywords, ...intent.searchSynonyms].map(k => k.toLowerCase());
  const productIntentMatch = intentKws.length > 0 && productTexts.some(text =>
    intentKws.some(kw => text.toLowerCase().includes(kw))
  );

  if (userHasSelectedIndustry) {
    // 使用者已手動選產業，main/sub 由 SQL 保證，只依商品命中程度排序
    if (productExactMatch)    return 3;
    if (productIntentMatch)   return 1;
    return 0;
  }

  // 完整 5 tier（0–4）
  if (mainMatch && subMatch && productExactMatch) return 4;
  if (productExactMatch)                          return 3;
  if (mainMatch && subMatch && productIntentMatch) return 2;
  if (mainMatch && subMatch)                      return 1;
  return 0;
}

export async function searchFactories(params: {
  industry?: string[];
  subIndustry?: string[];
  region?: string[];
  capitalLevel?: string[];
  mfgMode?: string;
  keyword?: string;
  businessType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  intent?: AISearchIntent | null;
  userHasSelectedIndustry?: boolean;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const {
    industry, subIndustry, region, capitalLevel, mfgMode, keyword,
    businessType, page = 1, pageSize = 20, sortBy,
    intent, userHasSelectedIndustry = false,
  } = params;

  // 使用者手動篩選條件（最高優先，永遠在 SQL WHERE 層處理）
  const conditions = [eq(factories.status, 'approved')];
  if (industry && industry.length > 0)
    conditions.push(sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify(industry)})`);
  if (subIndustry && subIndustry.length > 0) {
    const subConds = subIndustry.map(s => sql`JSON_CONTAINS(${factories.subIndustry}, ${JSON.stringify([s])})`);
    conditions.push(or(...subConds)!);
  }
  if (businessType) conditions.push(eq(factories.businessType, businessType as "factory" | "studio"));
  if (region && region.length > 0)       conditions.push(inArray(factories.region, region));
  if (capitalLevel && capitalLevel.length > 0) conditions.push(inArray(factories.capitalLevel, capitalLevel));
  if (mfgMode)                           conditions.push(sql`JSON_CONTAINS(${factories.mfgModes}, ${JSON.stringify([mfgMode])})`);

  const hasIntent = !!intent && intent.confidence >= 0.5;
  const useAIMode = hasIntent && (!sortBy || sortBy === 'rating');

  // === 共用：不論 AI 是否成功，只要有 keyword 就先查 products（原始 keyword only）===
  // AI timeout 時走 non-AI mode 仍能把商品命中的工廠拉進候選集
  let keywordProductIds: number[] = [];
  if (keyword) {
    try {
      const rows = await db
        .select({ factoryId: products.factoryId })
        .from(products)
        .where(or(
          like(products.name,        `%${keyword}%`),
          like(products.description, `%${keyword}%`),
        )!);
      keywordProductIds = Array.from(new Set(rows.map(r => r.factoryId))).slice(0, 200);
    } catch (e) {
      console.error('[AISearch] keyword product prequery FAILED:', e);
    }
  }

  console.log(`[AISearch] keyword="${keyword ?? ''}" useAIMode=${useAIMode} confidence=${intent?.confidence ?? 0} keywordProductIds=[${keywordProductIds.join(',')}]`);

  if (useAIMode) {
    // AI mode Step 1: 額外查 intent.productKeywords / searchSynonyms 命中的 products
    let aiProductIds: number[] = [];
    try {
      const aiTerms = [...intent!.productKeywords, ...intent!.searchSynonyms]
        .filter((t): t is string => !!t && t.trim().length > 0);
      if (aiTerms.length > 0) {
        const aiConds = aiTerms.flatMap(term => [
          like(products.name,        `%${term}%`),
          like(products.description, `%${term}%`),
        ]);
        const rows = await db
          .select({ factoryId: products.factoryId })
          .from(products)
          .where(or(...aiConds)!);
        aiProductIds = Array.from(new Set(rows.map(r => r.factoryId))).slice(0, 200);
      }
    } catch (e) {
      console.error('[AISearch] AI product prequery FAILED:', e);
    }

    const productMatchedIds = Array.from(new Set([...keywordProductIds, ...aiProductIds])).slice(0, 200);
    console.log(`[AISearch] productMatchedIds=[${productMatchedIds.join(',')}] (keyword:${keywordProductIds.length} ai:${aiProductIds.length})`);

    // Step 2: 候選集 content layer（OR 層）
    // 外層 AND：status='approved' + 使用者手動篩選
    // 內層 OR：factory 文字命中 | AI 主產業命中 | factory.id IN productMatchedIds
    const contentConds: any[] = [];
    if (keyword) {
      contentConds.push(
        like(factories.name,        `%${keyword}%`),
        like(factories.description, `%${keyword}%`),
        sql`JSON_SEARCH(${factories.industry}, 'one', ${`%${keyword}%`}) IS NOT NULL`,
      );
    }
    if (!userHasSelectedIndustry && intent!.mainIndustries.length > 0) {
      contentConds.push(sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify(intent!.mainIndustries)})`);
    }
    if (productMatchedIds.length > 0) {
      contentConds.push(inArray(factories.id, productMatchedIds));
    }

    const keywordCondCount   = keyword ? 3 : 0;
    const industryCondCount  = (!userHasSelectedIndustry && intent!.mainIndustries.length > 0) ? 1 : 0;
    const productIdCondCount = productMatchedIds.length > 0 ? 1 : 0;
    console.log(`[AISearch] contentConds count=${contentConds.length} (keyword:${keywordCondCount} industry:${industryCondCount} product_ids:${productIdCondCount})`);

    if (contentConds.length > 0) conditions.push(or(...contentConds)!);

    const whereClause = and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(factories).where(whereClause);
    const total = Number(countResult?.count ?? 0);

    const candidates = await db.select().from(factories).where(whereClause)
      .orderBy(desc(factories.avgRating), desc(factories.reviewCount))
      .limit(AI_CANDIDATE_LIMIT);

    console.log(`[AISearch] total=${total} candidates=${candidates.length}`);

    // Step 3: 批次查候選工廠的所有商品
    const productMap = new Map<number, string[]>();
    if (candidates.length > 0) {
      const candidateIds = candidates.map(f => f.id);
      const productRows = await db
        .select({ factoryId: products.factoryId, name: products.name, desc: products.description })
        .from(products)
        .where(inArray(products.factoryId, candidateIds));
      for (const p of productRows) {
        const list = productMap.get(p.factoryId) ?? [];
        list.push(`${p.name} ${p.desc ?? ''}`);
        productMap.set(p.factoryId, list);
      }
    }

    // Step 4: 計算 5-tier matchTier 並排序
    const scored = candidates.map(f => ({
      factory: f,
      tier: computeMatchTier(f, productMap.get(f.id) ?? [], intent!, userHasSelectedIndustry, keyword),
    }));

    scored.sort((a, b) => {
      if (b.tier !== a.tier)                                   return b.tier - a.tier;
      const rDiff = Number(b.factory.avgRating ?? 0) - Number(a.factory.avgRating ?? 0);
      if (rDiff !== 0)                                         return rDiff;
      const rcDiff = (b.factory.reviewCount ?? 0) - (a.factory.reviewCount ?? 0);
      if (rcDiff !== 0)                                        return rcDiff;
      return new Date(b.factory.updatedAt).getTime() - new Date(a.factory.updatedAt).getTime();
    });

    const topLog = scored.slice(0, 3).map(s => `{id:${s.factory.id},name:"${s.factory.name}",tier:${s.tier}}`).join(',');
    console.log(`[AISearch] topResults=[${topLog}]`);

    const offset = (page - 1) * pageSize;
    const items = scored.slice(offset, offset + pageSize).map(s => s.factory);
    return { items, total };
  }

  // 非 AI 模式（AI timeout / disabled / 低信心度 fallback）
  // keywordProductIds 來自上方共用 pre-query，同樣加入 OR 候選條件
  console.log(`[AISearch] non-AI mode keyword="${keyword ?? ''}" confidence=${intent?.confidence ?? 0} keywordProductIds=[${keywordProductIds.join(',')}]`);
  if (keyword) {
    const nonAiConds: any[] = [
      like(factories.name,        `%${keyword}%`),
      like(factories.description, `%${keyword}%`),
      sql`JSON_SEARCH(${factories.industry}, 'one', ${`%${keyword}%`}) IS NOT NULL`,
    ];
    if (keywordProductIds.length > 0) {
      nonAiConds.push(inArray(factories.id, keywordProductIds));
    }
    conditions.push(or(...nonAiConds)!);
  }

  const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(factories).where(whereClause);
  const total = Number(countResult?.count ?? 0);

  let orderClauses;
  switch (sortBy) {
    case "reviews":
      orderClauses = [desc(factories.reviewCount), desc(factories.avgRating)];
      break;
    case "response":
      orderClauses = [
        sql`CASE WHEN ${factories.avgResponseHours} IS NULL THEN 1 ELSE 0 END`,
        asc(factories.avgResponseHours),
        desc(factories.avgRating),
      ];
      break;
    case "newest":
      orderClauses = [desc(factories.createdAt)];
      break;
    default:
      orderClauses = [desc(factories.avgRating), desc(factories.reviewCount)];
  }

  const items = await db.select().from(factories).where(whereClause)
    .orderBy(...orderClauses)
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items, total };
}

// ===== Product helpers =====
export async function createProduct(data: { factoryId: number; name: string; categoryId?: number | null; priceMin?: string; priceMax?: string; priceType?: "range" | "fixed" | "market"; acceptSmallOrder?: boolean; provideSample?: boolean; description?: string; images?: string[] }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(products).values(data);
  return result[0].insertId;
}

export async function updateProduct(id: number, factoryId: number, data: Partial<{ name: string; categoryId: number | null; priceMin: string; priceMax: string; priceType: "range" | "fixed" | "market"; acceptSmallOrder: boolean; provideSample: boolean; description: string; images: string[] }>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(products).set(data).where(and(eq(products.id, id), eq(products.factoryId, factoryId)));
}

export async function deleteProduct(id: number, factoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(products).where(and(eq(products.id, id), eq(products.factoryId, factoryId)));
}

export async function getProductsByFactoryId(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).where(eq(products.factoryId, factoryId)).orderBy(asc(products.name)).limit(100);
}

export async function getProductsByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db.select().from(products).where(inArray(products.id, ids));
}

export async function getProductById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== Conversation / Message helpers =====
export async function getOrCreateConversation(userId: number, factoryId: number, productId?: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.factoryId, factoryId)))
      .limit(1);
  if (existing.length > 0) return existing[0];
  const result = await db.insert(conversations).values({ userId, factoryId, productId: productId ?? null });
  const newConv = await db.select().from(conversations).where(eq(conversations.id, result[0].insertId)).limit(1);
  return newConv[0];
}

export async function getConversationsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.lastMessageAt)).limit(50);
}

export async function getConversationsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.factoryId, factoryId)).orderBy(desc(conversations.lastMessageAt)).limit(50);
}

export async function getConversationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function sendMessage(conversationId: number, senderId: number, senderRole: "user" | "factory", content: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(messages).values({ conversationId, senderId, senderRole, content });
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
}

export async function getMessagesByConversation(conversationId: number, page = 1, pageSize = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: messages.id,
    conversationId: messages.conversationId,
    senderId: messages.senderId,
    senderRole: messages.senderRole,
    content: messages.content,
    isRead: messages.isRead,
    type: messages.type,
    invitationId: messages.invitationId,
    attachmentData: messages.attachmentData,
    createdAt: messages.createdAt,
    invitationStatus: factoryCoManagerInvitations.status,
    invitationExpiresAt: factoryCoManagerInvitations.expiresAt,
  })
    .from(messages)
    .leftJoin(factoryCoManagerInvitations, eq(messages.invitationId, factoryCoManagerInvitations.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

export async function getMessageById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function markMessagesAsRead(conversationId: number, readerId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(messages).set({ isRead: true })
    .where(and(eq(messages.conversationId, conversationId), sql`${messages.senderId} != ${readerId}`, eq(messages.isRead, false)));
}

export async function getUnreadCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  // 取得使用者參與的所有對話
  const userConvs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId));
  if (userConvs.length === 0) return 0;
  const convIds = userConvs.map(c => c.id);
  const [result] = await db.select({ count: sql<number>`COUNT(*)` }).from(messages)
    .where(and(inArray(messages.conversationId, convIds), sql`${messages.senderId} != ${userId}`, eq(messages.isRead, false)));
  return Number(result?.count ?? 0);
}

export async function getUnreadCountForFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return 0;
  const factoryConvs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.factoryId, factoryId));
  if (factoryConvs.length === 0) return 0;
  const convIds = factoryConvs.map(c => c.id);
  const [result] = await db.select({ count: sql<number>`COUNT(*)` }).from(messages)
    .where(and(inArray(messages.conversationId, convIds), eq(messages.senderRole, "user"), eq(messages.isRead, false)));
  return Number(result?.count ?? 0);
}

// 取得使用者作為工廠側（owner + co-manager）所有工廠的未讀訊息總數，避免 N+1 query。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// _dbOverride: 僅供測試注入；正式路徑不得傳入
export async function getUnreadCountForUser(userId: number, _dbOverride?: any): Promise<number> {
  const db = _dbOverride ?? await getDb();
  if (!db) return 0;
  // Gather all factory IDs where user is owner or active co-manager (deduped via Set)
  const [ownedRows, coMgrRows] = await Promise.all([
    db.select({ id: factories.id }).from(factories).where(eq(factories.ownerId, userId)),
    db.select({ factoryId: factoryCoManagers.factoryId })
      .from(factoryCoManagers)
      .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt))),
  ]);
  const factoryIds = Array.from(new Set([
    ...(ownedRows as { id: number }[]).map(r => r.id),
    ...(coMgrRows as { factoryId: number }[]).map(r => r.factoryId),
  ]));
  if (factoryIds.length === 0) return 0;
  // One query: count unread buyer messages across all managed factories
  const factoryConvs = (await db.select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.factoryId, factoryIds))) as { id: number }[];
  if (factoryConvs.length === 0) return 0;
  const convIds = factoryConvs.map(c => c.id);
  const [result] = await db.select({ count: sql<number>`COUNT(*)` }).from(messages)
    .where(and(inArray(messages.conversationId, convIds), eq(messages.senderRole, "user"), eq(messages.isRead, false)));
  return Number(result?.count ?? 0);
}

// 取得單一對話的未讀計數（對於某個讀者）
export async function getUnreadCountForConversation(conversationId: number, readerId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ count: sql<number>`COUNT(*)` }).from(messages)
    .where(and(eq(messages.conversationId, conversationId), sql`${messages.senderId} != ${readerId}`, eq(messages.isRead, false)));
  return Number(result?.count ?? 0);
}

// 取得對話的最後一則訊息
export async function getLastMessage(conversationId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(messages).where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// 刪除對話（只刪除對話與訊息）
export async function deleteConversation(conversationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const conv = await getConversationById(conversationId);
  if (!conv) throw new Error("對話不存在");
  // 驗證權限：使用者或工廠業主
  const factory = await getFactoryById(conv.factoryId);
  if (conv.userId !== userId && factory?.ownerId !== userId) throw new Error("無權限刪除此對話");
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
}

// ===== Review helpers =====
export async function createReview(data: { factoryId: number; userId: number; rating: number; comment?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // 檢查是否已評價過
  const existing = await db.select().from(reviews)
    .where(and(eq(reviews.factoryId, data.factoryId), eq(reviews.userId, data.userId))).limit(1);
  if (existing.length > 0) throw new Error("您已經評價過此工廠");
  await db.insert(reviews).values(data);
  // 更新工廠平均評分
  await recalcFactoryRating(data.factoryId);
}
export async function getReviewByUserAndFactory(userId: number, factoryId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.factoryId, factoryId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateReview(id: number, userId: number, data: { rating: number; comment?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(reviews)
    .set({ rating: data.rating, comment: data.comment ?? null })
    .where(and(eq(reviews.id, id), eq(reviews.userId, userId)));
  const review = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  if (review.length > 0) {
    await recalcFactoryRating(review[0].factoryId);
  }
}
export async function countNewReviewsSince(factoryId: number, since?: Date): Promise<{ count: number }> {
  const db = await getDb();
  if (!db) return { count: 0 };
  const conditions = [eq(reviews.factoryId, factoryId)];
  if (since) conditions.push(gt(reviews.createdAt, since));
  const [result] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .where(and(...conditions));
  return { count: Number(result?.count ?? 0) };
}

export async function countUnrepliedReviews(factoryId: number) {
  const db = await getDb();
  if (!db) return { count: 0 };
  const [result] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(reviews)
    .where(and(eq(reviews.factoryId, factoryId), isNull(reviews.reply)));
  return { count: Number(result?.count ?? 0) };
}

export async function getReviewsByFactory(factoryId: number, page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(reviews).where(eq(reviews.factoryId, factoryId));
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: reviews.id,
    rating: reviews.rating,
    comment: reviews.comment,
    createdAt: reviews.createdAt,
    userId: reviews.userId,
    userName: users.name,
    reply: reviews.reply,
    repliedAt: reviews.repliedAt,
    reviewType: reviews.reviewType,
    collaborationOrderId: reviews.collaborationOrderId,
    projectName: collaborationOrders.projectName,
  }).from(reviews)
    .leftJoin(users, eq(reviews.userId, users.id))
    .leftJoin(collaborationOrders, eq(reviews.collaborationOrderId, collaborationOrders.id))
    .where(eq(reviews.factoryId, factoryId))
    .orderBy(desc(reviews.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { items, total };
}

async function recalcFactoryRating(factoryId: number) {
  const db = await getDb();
  if (!db) return;
  const [result] = await db.select({
    avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
    count: sql<number>`COUNT(*)`,
  }).from(reviews).where(eq(reviews.factoryId, factoryId));
  const avg = parseFloat(String(result?.avg ?? "0")).toFixed(2);
  const count = Number(result?.count ?? 0);
  await db.update(factories).set({ avgRating: avg, reviewCount: count }).where(eq(factories.id, factoryId));
}

// ===== Advertisement helpers =====
export async function getActiveAds(params: { industry?: string; capitalLevel?: string; region?: string }) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const conditions = [
    eq(advertisements.isActive, true),
    sql`${advertisements.startDate} <= ${now}`,
    sql`${advertisements.endDate} >= ${now}`,
  ];
  if (params.industry) conditions.push(eq(advertisements.industry, params.industry));
  if (params.capitalLevel) conditions.push(eq(advertisements.capitalLevel, params.capitalLevel));
  // 地區匹配：廣告的 region 或 extraRegions 包含搜尋地區
  if (params.region) {
    conditions.push(
      or(
        eq(advertisements.region, params.region),
        sql`JSON_CONTAINS(${advertisements.extraRegions}, ${JSON.stringify(params.region)})`
      )!
    );
  }
  const ads = await db.select().from(advertisements).where(and(...conditions)).limit(10);
  // 取得對應的工廠資料
  if (ads.length === 0) return [];
  const factoryIds = ads.map(a => a.factoryId);
  const factoryList = await db.select().from(factories).where(inArray(factories.id, factoryIds));
  return ads.map(ad => ({
    ...ad,
    factory: factoryList.find(f => f.id === ad.factoryId),
  }));
}

export async function createAd(data: { factoryId: number; industry: string; capitalLevel: string; region: string; extraRegions?: string[]; startDate: Date; endDate: Date }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // 自動帶入鄰近兩縣市
  const autoRegions = data.extraRegions ?? (ADJACENT_REGIONS[data.region] ?? []).slice(0, 2);
  await db.insert(advertisements).values({
    ...data,
    extraRegions: autoRegions,
  });
}

// ===== 我的評價 =====
export async function getReviewsByUser(userId: number, page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(reviews).where(eq(reviews.userId, userId));
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: reviews.id,
    rating: reviews.rating,
    comment: reviews.comment,
    reply: reviews.reply,
    repliedAt: reviews.repliedAt,
    createdAt: reviews.createdAt,
    factoryId: reviews.factoryId,
    factoryName: factories.name,
  }).from(reviews).leftJoin(factories, eq(reviews.factoryId, factories.id))
    .where(eq(reviews.userId, userId))
    .orderBy(desc(reviews.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { items, total };
}

// ===== 刪除工廠 =====
export async function deleteFactory(id: number, ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // 1. 先取得所有對話 ID
  const convRows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.factoryId, id));

  // 2. 批次刪除訊息（一次 DELETE，不用 for 迴圈）
  if (convRows.length > 0) {
    const convIds = convRows.map(c => c.id);
    await db.delete(messagesTable).where(inArray(messagesTable.conversationId, convIds));
  }

  // 3. 刪除所有對話
  await db.delete(conversationsTable).where(eq(conversationsTable.factoryId, id));

  // 4. 刪除所有產品
  await db.delete(products).where(eq(products.factoryId, id));

  // 5. 刪除所有評價
  await db.delete(reviewsTable).where(eq(reviewsTable.factoryId, id));

  // 6. 刪除所有廣告
  await db.delete(advertisementsTable).where(eq(advertisementsTable.factoryId, id));

  // 7. 刪除工廠本體
  await db.delete(factories).where(and(eq(factories.id, id), eq(factories.ownerId, ownerId)));
}

// ===== 全站瀏覽統計 =====

// 台灣時間 (UTC+8) 的日期字串 YYYY-MM-DD
export function twDateStr(offsetDays = 0): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  if (offsetDays) now.setUTCDate(now.getUTCDate() - offsetDays);
  return now.toISOString().slice(0, 10);
}

// 台灣時間的當前小時 (0-23)
function twHour(): number {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
}

export async function recordPageView(visitorId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const today = twDateStr();
  const hour = twHour();
  try {
    await db.execute(sql`INSERT IGNORE INTO pageViews (visitorId, date, hour) VALUES (${visitorId}, ${today}, ${hour})`);
  } catch {
    // 重複或其他錯誤，靜默忽略
  }
}

export async function getPageViewStats() {
  const db = await getDb();
  if (!db) return { today: 0, yesterday: 0, last7Days: 0, todayHours: Array(24).fill(0) };

  const todayStr = twDateStr();
  const yesterdayStr = twDateStr(1);
  const sevenDaysAgoStr = twDateStr(6);

  const [todayRow] = await db.select({ count: sql<number>`COUNT(DISTINCT visitorId)` })
    .from(pageViews).where(eq(pageViews.date, todayStr));

  const [yesterdayRow] = await db.select({ count: sql<number>`COUNT(DISTINCT visitorId)` })
    .from(pageViews).where(eq(pageViews.date, yesterdayStr));

  const [weekRow] = await db.select({ count: sql<number>`COUNT(DISTINCT visitorId)` })
    .from(pageViews).where(sql`date >= ${sevenDaysAgoStr}`);

  const hourlyRows = await db.select({ hour: pageViews.hour, count: sql<number>`COUNT(DISTINCT visitorId)` })
    .from(pageViews).where(eq(pageViews.date, todayStr))
    .groupBy(pageViews.hour);

  const todayHours = Array(24).fill(0);
  for (const row of hourlyRows) {
    todayHours[row.hour] = Number(row.count);
  }

  return {
    today: Number(todayRow?.count ?? 0),
    yesterday: Number(yesterdayRow?.count ?? 0),
    last7Days: Number(weekRow?.count ?? 0),
    todayHours,
  };
}

// ===== 管理員統計 =====
export async function getAdminStats() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  const [userCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(users);
  const [factoryCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(factories);
  const [productCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(products);
  const [reviewCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(reviews);
  const [adCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(advertisements);
  const [messageCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(conversations);
  
  return {
    totalUsers: Number(userCount?.count ?? 0),
    totalFactories: Number(factoryCount?.count ?? 0),
    totalProducts: Number(productCount?.count ?? 0),
    totalReviews: Number(reviewCount?.count ?? 0),
    totalAds: Number(adCount?.count ?? 0),
    totalMessages: Number(messageCount?.count ?? 0), // 現在是對話數而非訊息數
  };
}

export async function getAdminFactories(page = 1, pageSize = 20, search?: string, status?: 'approved' | 'pending' | 'rejected') {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const conditions: any[] = [];
  if (search) {
    conditions.push(
      or(
        like(factories.name, `%${search}%`),
        sql`JSON_SEARCH(${factories.industry}, 'one', ${`%${search}%`}) IS NOT NULL`,
        like(factories.region, `%${search}%`)
      )
    );
  }
  if (status) {
    conditions.push(eq(factories.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(factories);
  if (whereClause) {
    countQuery = countQuery.where(whereClause) as any;
  }
  const [countResult] = await countQuery;
  const total = Number(countResult?.count ?? 0);

  let itemsQuery = db.select(adminFactorySelect).from(factories)
    .leftJoin(users, eq(factories.ownerId, users.id));
  if (whereClause) {
    itemsQuery = itemsQuery.where(whereClause) as any;
  }
  const rows = await itemsQuery
    .orderBy(desc(factories.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const baseItems = rows.map(r => ({ ...r.factory, ownerAccountName: r.ownerAccountName, ownerAccountEmail: r.ownerAccountEmail }));

  // Batch-fetch active co-managers for all factories on this page (no N+1)
  const coManagersByFactory = new Map<number, Array<{ userId: number; name: string | null; email: string | null }>>();
  if (baseItems.length > 0) {
    const factoryIds = baseItems.map(f => f.id);
    const cmRows = await db
      .select({
        factoryId: factoryCoManagers.factoryId,
        userId: factoryCoManagers.userId,
        name: users.name,
        primaryEmail: users.primaryEmail,
        email: users.email,
      })
      .from(factoryCoManagers)
      .innerJoin(users, eq(factoryCoManagers.userId, users.id))
      .where(and(
        inArray(factoryCoManagers.factoryId, factoryIds),
        isNull(factoryCoManagers.removedAt),
      ));
    for (const row of cmRows) {
      const list = coManagersByFactory.get(row.factoryId) ?? [];
      list.push({ userId: row.userId, name: row.name, email: row.primaryEmail ?? row.email });
      coManagersByFactory.set(row.factoryId, list);
    }
  }

  const items = baseItems.map(f => ({
    ...f,
    coManagers: coManagersByFactory.get(f.id) ?? [] as Array<{ userId: number; name: string | null; email: string | null }>,
  }));
  return { items, total, page, pageSize };
}

export async function getAdminUsers(page = 1, pageSize = 20, search?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const conditions: any[] = [];
  if (search) {
    conditions.push(
      or(
        like(users.name, `%${search}%`),
        like(users.email, `%${search}%`),
        like(users.primaryEmail, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(users);
  if (whereClause) {
    countQuery = countQuery.where(whereClause) as any;
  }
  const [countResult] = await countQuery;
  const total = Number(countResult?.count ?? 0);

  const adminUserSelect = {
    user: users,
    factoryName: factories.name,
    factoryId: factories.id,
  };

  let itemsQuery = db.select(adminUserSelect).from(users)
    .leftJoin(factories, eq(factories.ownerId, users.id));
  if (whereClause) {
    itemsQuery = itemsQuery.where(whereClause) as any;
  }
  const rows = await itemsQuery
    .orderBy(desc(users.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  const items = rows.map(r => ({ ...r.user, factoryName: r.factoryName, factoryId: r.factoryId }));

  // Batch-fetch linked providers (google / line)
  const googleSet = new Set<number>();
  const lineSet = new Set<number>();
  if (items.length > 0) {
    const userIds = items.map(u => u.id);
    const authRows = await db
      .select({ userId: userAuthAccounts.userId, provider: userAuthAccounts.provider })
      .from(userAuthAccounts)
      .where(inArray(userAuthAccounts.userId, userIds));
    for (const row of authRows) {
      if (row.provider === 'google') googleSet.add(row.userId);
      if (row.provider === 'line') lineSet.add(row.userId);
    }
  }

  // Batch-fetch active co-managed factories for all users on this page (no N+1)
  const coManagedByUser = new Map<number, Array<{ factoryId: number; factoryName: string }>>();
  if (items.length > 0) {
    const userIds = items.map(u => u.id);
    const cmRows = await db
      .select({
        userId: factoryCoManagers.userId,
        factoryId: factoryCoManagers.factoryId,
        factoryName: factories.name,
      })
      .from(factoryCoManagers)
      .innerJoin(factories, eq(factoryCoManagers.factoryId, factories.id))
      .where(and(
        inArray(factoryCoManagers.userId, userIds),
        isNull(factoryCoManagers.removedAt),
      ));
    for (const row of cmRows) {
      const list = coManagedByUser.get(row.userId) ?? [];
      list.push({ factoryId: row.factoryId, factoryName: row.factoryName });
      coManagedByUser.set(row.userId, list);
    }
  }

  const enriched = items.map(u => ({
    ...u,
    hasVerifiedPrimaryEmail: !!u.primaryEmailVerifiedAt,
    hasGoogleLinked: googleSet.has(u.id),
    hasLineLinked: lineSet.has(u.id),
    coManagedFactories: coManagedByUser.get(u.id) ?? [] as Array<{ factoryId: number; factoryName: string }>,
  }));

  return { items: enriched, total, page, pageSize };
}

export async function getAdminAds(page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(advertisements);
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: advertisements.id,
    factoryId: advertisements.factoryId,
    industry: advertisements.industry,
    capitalLevel: advertisements.capitalLevel,
    region: advertisements.region,
    startDate: advertisements.startDate,
    endDate: advertisements.endDate,
    createdAt: advertisements.createdAt,
    factoryName: factories.name,
  }).from(advertisements)
    .innerJoin(factories, eq(advertisements.factoryId, factories.id))
    .orderBy(desc(advertisements.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  
  return { items, total, page, pageSize };
}

export async function getAdminReviews(page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(reviews);
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: reviews.id,
    factoryId: reviews.factoryId,
    userId: reviews.userId,
    rating: reviews.rating,
    comment: reviews.comment,
    createdAt: reviews.createdAt,
    updatedAt: reviews.updatedAt,
    factoryName: factories.name,
    userName: users.name,
  }).from(reviews)
    .innerJoin(factories, eq(reviews.factoryId, factories.id))
    .innerJoin(users, eq(reviews.userId, users.id))
    .orderBy(desc(reviews.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  
  return { items, total, page, pageSize };
}


// ===== Favorite helpers =====
export async function toggleFavorite(userId: number, factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  // 檢查是否已收藏
  const existing = await db.select().from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.factoryId, factoryId)))
    .limit(1);
  
  if (existing.length > 0) {
    // 已收藏，則刪除
    await db.delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.factoryId, factoryId)));
    return false; // 已取消收藏
  } else {
    // 未收藏，則新增
    await db.insert(favorites).values({ userId, factoryId });
    return true; // 已收藏
  }
}

export async function isFavorited(userId: number, factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  const result = await db.select().from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.factoryId, factoryId)))
    .limit(1);
  
  return result.length > 0;
}

export async function getFavoritesByUser(userId: number, page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  // 計算總數
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(favorites)
    .where(eq(favorites.userId, userId));
  const total = Number(countResult?.count ?? 0);
  
  // 獲取收藏的工廠
  const favoriteRecords = await db.select().from(favorites)
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  
  const factoryIds = favoriteRecords.map(f => f.factoryId);
  if (factoryIds.length === 0) {
    return { items: [], total, page, pageSize };
  }
  
  const items = await db.select().from(factories)
    .where(inArray(factories.id, factoryIds));
  
  return { items, total, page, pageSize };
}


// ===== Admin helpers =====
const adminFactorySelect = {
  factory: factories,
  ownerAccountName: users.name,
  ownerAccountEmail: users.email,
};

async function queryAdminFactories(db: ReturnType<typeof drizzle>, status: 'pending' | 'rejected' | 'approved', page: number, pageSize: number) {
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(factories).where(eq(factories.status, status));
  const total = Number(countResult?.count ?? 0);
  const rows = await db.select(adminFactorySelect).from(factories)
    .leftJoin(users, eq(factories.ownerId, users.id))
    .where(eq(factories.status, status))
    .orderBy(desc(factories.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  const items = rows.map(r => ({ ...r.factory, ownerAccountName: r.ownerAccountName, ownerAccountEmail: r.ownerAccountEmail }));
  return { items, total, page, pageSize };
}

export async function getAdminPendingFactories(page: number = 1, pageSize: number = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  return queryAdminFactories(db, 'pending', page, pageSize);
}

export async function getAdminRejectedFactories(page: number = 1, pageSize: number = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  return queryAdminFactories(db, 'rejected', page, pageSize);
}

export async function getAdminApprovedFactories(page: number = 1, pageSize: number = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  return queryAdminFactories(db, 'approved', page, pageSize);
}

export async function getAdminProducts(page = 1, pageSize = 20, search?: string, industry?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  // 構建查詢條件
  const conditions: any[] = [];
  
  if (search) {
    conditions.push(
      or(
        like(products.name, `%${search}%`),
        like(products.description, `%${search}%`)
      )
    );
  }
  
  if (industry) {
    const factoriesInIndustry = await db.select({ id: factories.id }).from(factories)
      .where(sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify([industry])})`);
    const factoryIds = factoriesInIndustry.map(f => f.id);
    if (factoryIds.length > 0) {
      conditions.push(inArray(products.factoryId, factoryIds));
    } else {
      return { items: [], total: 0, page, pageSize };
    }
  }
  
  // 計算總數
  let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(products);
  if (conditions.length > 0) {
    countQuery = countQuery.where(and(...conditions)) as any;
  }
  const [countResult] = await countQuery;
  const total = Number(countResult?.count ?? 0);
  
  // 獲取分頁數據（JOIN factories 取得工廠名稱與產業）
  let itemsQuery = db.select({
    id: products.id,
    factoryId: products.factoryId,
    name: products.name,
    description: products.description,
    priceMin: products.priceMin,
    priceMax: products.priceMax,
    priceType: products.priceType,
    acceptSmallOrder: products.acceptSmallOrder,
    provideSample: products.provideSample,
    images: products.images,
    createdAt: products.createdAt,
    factory: {
      name: factories.name,
      industry: factories.industry,
    },
  }).from(products).leftJoin(factories, eq(products.factoryId, factories.id));

  if (conditions.length > 0) {
    itemsQuery = itemsQuery.where(and(...conditions)) as any;
  }
  const items = await itemsQuery
    .orderBy(desc(products.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  return { items, total, page, pageSize };
}

export async function getAdminConversations(page = 1, pageSize = 20, search?: string, factoryId?: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  
  // 構建查詢條件
  const conditions: any[] = [];
  
  if (factoryId) {
    conditions.push(eq(conversations.factoryId, factoryId));
  }
  
  if (search) {
    // 搜尋工廠名稱或使用者名稱
    const matchingFactories = await db.select({ id: factories.id }).from(factories)
      .where(like(factories.name, `%${search}%`));
    const matchingUsers = await db.select({ id: users.id }).from(users)
      .where(like(users.name, `%${search}%`));
    
    const factoryIds = matchingFactories.map(f => f.id);
    const userIds = matchingUsers.map(u => u.id);
    
    if (factoryIds.length > 0 || userIds.length > 0) {
      const searchConditions = [];
      if (factoryIds.length > 0) searchConditions.push(inArray(conversations.factoryId, factoryIds));
      if (userIds.length > 0) searchConditions.push(inArray(conversations.userId, userIds));
      conditions.push(or(...searchConditions));
    } else {
      return { items: [], total: 0, page, pageSize };
    }
  }
  
  // 計算總數
  let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(conversations);
  if (conditions.length > 0) {
    countQuery = countQuery.where(and(...conditions)) as any;
  }
  const [countResult] = await countQuery;
  const total = Number(countResult?.count ?? 0);
  
  // 獲取分頁數據（帶上工廠和使用者資訊）
  let items: any[] = [];
  try {
    const result = await db.execute(sql`
      SELECT 
        c.id, c.userId, c.factoryId, c.createdAt, c.lastMessageAt,
        u.name as userName,
        f.name as factoryName
      FROM conversations c
      LEFT JOIN users u ON c.userId = u.id
      LEFT JOIN factories f ON c.factoryId = f.id
      ORDER BY c.lastMessageAt DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);
    items = (result as any)[0];
  } catch (e) {
    console.error('[AdminConversations] query error:', e);
  }
  
  return { items, total, page, pageSize };
}
// ===== 批次查詢對話列表（解決 N+1）=====

export async function getConversationsByUserWithDetails(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.lastMessageAt));

  if (convs.length === 0) return [];

  // 批次查工廠
  const factoryIds = Array.from(new Set(convs.map(c => c.factoryId)));
  const factoryList = await db
    .select({ id: factories.id, name: factories.name, avatarUrl: factories.avatarUrl, businessType: factories.businessType })
    .from(factories)
    .where(inArray(factories.id, factoryIds));
  const factoryMap = new Map(factoryList.map(f => [f.id, f]));

  // 批次查產品
  const productIds = Array.from(new Set(convs.map(c => c.productId).filter((id): id is number => id != null)));
  const productMap = new Map<number, { id: number; name: string }>();
  if (productIds.length > 0) {
    const productList = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, productIds));
    productList.forEach(p => productMap.set(p.id, p));
  }

  // 批次查每個對話的未讀數與最後訊息
  const convIds = convs.map(c => c.id);

  // 未讀數：一次查出所有未讀，在記憶體中計算
  const unreadRows = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, convIds),
        sql`${messages.senderId} != ${userId}`,
        eq(messages.isRead, false)
      )
    );
  const unreadMap = new Map<number, number>();
  for (const row of unreadRows) {
    unreadMap.set(row.conversationId, (unreadMap.get(row.conversationId) ?? 0) + 1);
  }

  // 最後訊息：用 GROUP BY + MAX 一次撈
  const lastMsgRows = await db
    .select({
      conversationId: messages.conversationId,
      content: messages.content,
      senderRole: messages.senderRole,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(desc(messages.createdAt));

  // 每個 conversation 只取第一筆（最新）
  const lastMsgMap = new Map<number, { content: string; senderRole: string }>();
  for (const row of lastMsgRows) {
    if (!lastMsgMap.has(row.conversationId)) {
      lastMsgMap.set(row.conversationId, {
        content: row.content,
        senderRole: row.senderRole,
      });
    }
  }

  return convs.map(conv => {
    const lastMsg = lastMsgMap.get(conv.id);
    return {
      ...conv,
      factoryName: factoryMap.get(conv.factoryId)?.name ?? '未知工廠',
      factoryAvatarUrl: factoryMap.get(conv.factoryId)?.avatarUrl ?? null,
      factoryBusinessType: factoryMap.get(conv.factoryId)?.businessType ?? 'factory',
      productName: conv.productId ? (productMap.get(conv.productId)?.name ?? null) : null,
      unreadCount: unreadMap.get(conv.id) ?? 0,
      lastMessage: lastMsg ? lastMsg.content.substring(0, 60) : null,
      lastSenderRole: lastMsg?.senderRole ?? null,
    };
  });
}

export async function getConversationsByFactoryWithDetails(factoryId: number, readerId: number) {
  const db = await getDb();
  if (!db) return [];

  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.factoryId, factoryId))
    .orderBy(desc(conversations.lastMessageAt));

  if (convs.length === 0) return [];

  // 批次查用戶
  const userIds = Array.from(new Set(convs.map(c => c.userId)));
  const userList = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = new Map(userList.map(u => [u.id, u]));

  // 批次查產品
  const productIds = Array.from(new Set(convs.map(c => c.productId).filter((id): id is number => id != null)));
  const productMap = new Map<number, { id: number; name: string }>();
  if (productIds.length > 0) {
    const productList = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, productIds));
    productList.forEach(p => productMap.set(p.id, p));
  }

  // 批次查買家工廠身分（與 userMap 同一批 userIds，不產生 N+1）
  const affiliationMap = await getActiveFactoryAffiliationsByUserIds(userIds);

  const convIds = convs.map(c => c.id);

  // 批次查未讀（工廠角度：讀者是工廠owner，所以排除 factory 自己送的）
  const unreadRows = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, convIds),
        eq(messages.senderRole, 'user'),
        eq(messages.isRead, false)
      )
    );
  const unreadMap = new Map<number, number>();
  for (const row of unreadRows) {
    unreadMap.set(row.conversationId, (unreadMap.get(row.conversationId) ?? 0) + 1);
  }

  // 批次查最後訊息
  const lastMsgRows = await db
    .select({
      conversationId: messages.conversationId,
      content: messages.content,
      senderRole: messages.senderRole,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(desc(messages.createdAt));

  const lastMsgMap = new Map<number, { content: string; senderRole: string }>();
  for (const row of lastMsgRows) {
    if (!lastMsgMap.has(row.conversationId)) {
      lastMsgMap.set(row.conversationId, {
        content: row.content,
        senderRole: row.senderRole,
      });
    }
  }

  return convs.map(conv => {
    const lastMsg = lastMsgMap.get(conv.id);
    return {
      ...conv,
      userName: userMap.get(conv.userId)?.name ?? '匿名使用者',
      productName: conv.productId ? (productMap.get(conv.productId)?.name ?? null) : null,
      unreadCount: unreadMap.get(conv.id) ?? 0,
      lastMessage: lastMsg ? lastMsg.content.substring(0, 60) : null,
      lastSenderRole: lastMsg?.senderRole ?? null,
      buyerAffiliation: affiliationMap.get(conv.userId) ?? null,
    };
  });
}
// ===== 批次查詢收藏狀態 =====
export async function getFavoritedFactoryIds(userId: number, factoryIds: number[]): Promise<Set<number>> {
  const db = await getDb();
  if (!db || factoryIds.length === 0) return new Set();

  const rows = await db
    .select({ factoryId: favorites.factoryId })
    .from(favorites)
    .where(
      and(
        eq(favorites.userId, userId),
        inArray(favorites.factoryId, factoryIds)
      )
    );

  return new Set(rows.map(r => r.factoryId));
}
export async function saveMessage(
  conversationId: number,
  senderId: number,
  senderRole: "user" | "factory",
  content: string,
  type: "text" | "co_manager_invite" | "product" | "pdf" | "collaboration_order" = "text",
  attachmentData?: Record<string, any> | null,
) {
  const db = await getDb();
  if (!db) return;
  await db.insert(messages).values({ conversationId, senderId, senderRole, content, type, attachmentData: attachmentData ?? null });
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
  if (senderRole === "factory") {
    const [conv] = await db.select({ factoryId: conversations.factoryId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (conv) recalcFactoryResponseTime(conv.factoryId).catch(() => {});
  }
}

export async function recalcFactoryResponseTime(factoryId: number) {
  const db = await getDb();
  if (!db) return;
  const [result] = await db.execute(sql`
    SELECT AVG(diff_hours) as avg_hours FROM (
      SELECT
        TIMESTAMPDIFF(SECOND,
          MIN(CASE WHEN m.senderRole = 'user'    THEN m.createdAt END),
          MIN(CASE WHEN m.senderRole = 'factory' THEN m.createdAt END)
        ) / 3600.0 AS diff_hours
      FROM conversations c
      JOIN messages m ON m.conversationId = c.id
      WHERE c.factoryId = ${factoryId}
      GROUP BY c.id
      HAVING
        MIN(CASE WHEN m.senderRole = 'user'    THEN m.createdAt END) IS NOT NULL AND
        MIN(CASE WHEN m.senderRole = 'factory' THEN m.createdAt END) IS NOT NULL AND
        MIN(CASE WHEN m.senderRole = 'factory' THEN m.createdAt END) >
        MIN(CASE WHEN m.senderRole = 'user'    THEN m.createdAt END)
    ) t
  `) as any;
  const avg = result?.[0]?.avg_hours ?? null;
  await db.update(factories).set({ avgResponseHours: avg != null ? String(parseFloat(avg).toFixed(2)) : null }).where(eq(factories.id, factoryId));
}

// ===== 工廠照片集 =====
export async function getPhotosByFactoryId(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(factoryPhotos)
    .where(eq(factoryPhotos.factoryId, factoryId))
    .orderBy(asc(factoryPhotos.sortOrder), asc(factoryPhotos.createdAt));
}

export async function addFactoryPhoto(factoryId: number, url: string, caption?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: factoryPhotos.id }).from(factoryPhotos).where(eq(factoryPhotos.factoryId, factoryId));
  if (existing.length >= 20) throw new Error("照片集最多 20 張");
  const sortOrder = existing.length;
  const result = await db.insert(factoryPhotos).values({ factoryId, url, caption, sortOrder });
  return result[0].insertId;
}

export async function deleteFactoryPhoto(id: number, factoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(factoryPhotos).where(and(eq(factoryPhotos.id, id), eq(factoryPhotos.factoryId, factoryId)));
}

export async function updateFactoryPhotoCaption(id: number, factoryId: number, caption: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(factoryPhotos).set({ caption }).where(and(eq(factoryPhotos.id, id), eq(factoryPhotos.factoryId, factoryId)));
}

// ===== 產品分類 =====
export async function getCategoriesByFactoryId(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(productCategories)
    .where(eq(productCategories.factoryId, factoryId))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.createdAt));
}

export async function createCategory(factoryId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories).where(eq(productCategories.factoryId, factoryId));
  if (existing.length >= 20) throw new Error("分類最多 20 個");
  if (existing.some(c => c.name === name)) throw new Error("此分類名稱已存在");
  const result = await db.insert(productCategories).values({ factoryId, name, sortOrder: existing.length });
  return result[0].insertId;
}

export async function updateCategory(id: number, factoryId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(productCategories).set({ name }).where(and(eq(productCategories.id, id), eq(productCategories.factoryId, factoryId)));
}

export async function deleteCategory(id: number, factoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // 方案 A：刪除分類，產品的 categoryId 自動設為 NULL（FK ON DELETE SET NULL）
  await db.delete(productCategories).where(and(eq(productCategories.id, id), eq(productCategories.factoryId, factoryId)));
}

export async function updateProductCategory(productId: number, factoryId: number, categoryId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(products).set({ categoryId }).where(and(eq(products.id, productId), eq(products.factoryId, factoryId)));
}

// ===== 會員中心 =====
export async function updateUserProfile(userId: number, data: { name?: string; phone?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, userId));
}

export async function updateUserNotificationSettings(userId: number, settings: Record<string, boolean>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const current = await db.select({ notificationSettings: users.notificationSettings })
    .from(users).where(eq(users.id, userId)).limit(1);
  const existing = (current[0]?.notificationSettings as Record<string, boolean> | null) ?? {};
  const merged = { ...existing, ...settings };
  await db.update(users).set({ notificationSettings: merged }).where(eq(users.id, userId));
}

export async function softDeleteUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
}

export async function deleteReview(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(reviews).where(and(eq(reviews.id, id), eq(reviews.userId, userId)));
}

export async function getReportsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: reports.id,
    factoryId: reports.factoryId,
    factoryName: factories.name,
    reason: reports.reason,
    status: reports.status,
    createdAt: reports.createdAt,
  }).from(reports)
    .leftJoin(factories, eq(reports.factoryId, factories.id))
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.createdAt));
}

export async function createSupportTicket(data: { userId: number; type: string; subject: string; description: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(supportTickets).values(data);
}

export async function getMySupportTickets(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt));
}

// ===== 管理員客服中心 =====
export async function getAdminReports(page = 1, pageSize = 20, status?: string, excludeResolved?: boolean) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conditions = status
    ? [eq(reports.status, status as any)]
    : excludeResolved
    ? [sql`${reports.status} != 'resolved'`]
    : [];
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(reports)
    .where(conditions.length ? and(...conditions) : undefined);
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: reports.id,
    reason: reports.reason,
    status: reports.status,
    adminNote: reports.adminNote,
    createdAt: reports.createdAt,
    factoryId: reports.factoryId,
    factoryName: factories.name,
    userId: reports.userId,
    userName: users.name,
    userEmail: users.email,
  }).from(reports)
    .leftJoin(factories, eq(reports.factoryId, factories.id))
    .leftJoin(users, eq(reports.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items, total };
}

export async function getReportById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({
    id: reports.id,
    userId: reports.userId,
    factoryId: reports.factoryId,
    factoryName: factories.name,
    userName: users.name,
    userEmail: users.email,
    notificationSettings: users.notificationSettings,
  }).from(reports)
    .leftJoin(factories, eq(reports.factoryId, factories.id))
    .leftJoin(users, eq(reports.userId, users.id))
    .where(eq(reports.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateReportStatus(id: number, status: string, adminNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const updateData: any = { status };
  if (adminNote !== undefined) updateData.adminNote = adminNote;
  await db.update(reports).set(updateData).where(eq(reports.id, id));
  await db.insert(reportStatusHistory).values({ reportId: id, status: status as any, adminNote: adminNote ?? null });
}

export async function getReportHistory(reportId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reportStatusHistory)
    .where(eq(reportStatusHistory.reportId, reportId))
    .orderBy(asc(reportStatusHistory.createdAt));
}

export async function getAdminSupportTickets(page = 1, pageSize = 20, status?: string, excludeResolved?: boolean) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conditions = status
    ? [eq(supportTickets.status, status as any)]
    : excludeResolved
    ? [sql`${supportTickets.status} != 'resolved'`]
    : [];
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(supportTickets)
    .where(conditions.length ? and(...conditions) : undefined);
  const total = Number(countResult?.count ?? 0);
  const items = await db.select({
    id: supportTickets.id,
    type: supportTickets.type,
    subject: supportTickets.subject,
    description: supportTickets.description,
    status: supportTickets.status,
    adminNote: supportTickets.adminNote,
    createdAt: supportTickets.createdAt,
    userId: supportTickets.userId,
    userName: users.name,
    userEmail: users.email,
  }).from(supportTickets)
    .leftJoin(users, eq(supportTickets.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTickets.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items, total };
}

export async function getSupportTicketById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({
    id: supportTickets.id,
    userId: supportTickets.userId,
    subject: supportTickets.subject,
    userName: users.name,
    userEmail: users.email,
    notificationSettings: users.notificationSettings,
  }).from(supportTickets)
    .leftJoin(users, eq(supportTickets.userId, users.id))
    .where(eq(supportTickets.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateSupportTicketStatus(id: number, status: string, adminNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const updateData: any = { status };
  if (adminNote !== undefined) updateData.adminNote = adminNote;
  await db.update(supportTickets).set(updateData).where(eq(supportTickets.id, id));
  await db.insert(ticketStatusHistory).values({ ticketId: id, status: status as any, adminNote: adminNote ?? null });
}

export async function getTicketHistory(ticketId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ticketStatusHistory)
    .where(eq(ticketStatusHistory.ticketId, ticketId))
    .orderBy(asc(ticketStatusHistory.createdAt));
}
// ===== 平台公告 =====
export async function getAnnouncements(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(announcements)
    .orderBy(desc(announcements.isPinned), desc(announcements.createdAt))
    .limit(limit);
}

export type AnnouncementType = "update" | "maintenance" | "news";

/**
 * actionUrl 格式驗證：只接受兩種形式。
 *   - 站內路徑：以 "/" 開頭，且不是 "//" 開頭（protocol-relative URL 會被誤判
 *     成站內路徑但實際指向任意網域，必須明確排除）
 *   - 站外網址：必須以 "https://" 開頭，且能被 new URL() 成功解析
 * 一律拒絕 javascript:／data:／vbscript:／http:／無協定字串／其他任意格式。
 * 這是全站唯一的 actionUrl 格式規則，Router 與資料層都呼叫這個函式，避免
 * 兩邊各自維護一份可能不一致的規則。
 */
export function isValidAnnouncementActionUrl(url: string): boolean {
  if (url.startsWith("//")) return false;
  if (url.startsWith("/")) return true;
  if (url.startsWith("https://")) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * actionUrl 正規化 — createAnnouncement／updateAnnouncement 共用的唯一收斂點，
 * 是「type !== news 一律 null」這條規則實際落地保證的地方（不只依賴前端或
 * Router；即使呼叫端繞過 Router 直接呼叫這個函式，規則依然成立）。
 *
 * 回傳三態，呼叫端據此判斷要不要把 actionUrl 放進實際要寫入的欄位集合：
 *   - undefined：這次不需要更動 actionUrl（只有 type === "news" 且呼叫端明確
 *     表示「這次沒有要動 actionUrl」時才會發生，用於 update 的 partial 語意，
 *     保留資料庫既有值）
 *   - null：明確清空（非 news、或呼叫端明確傳入 null／空字串時）
 *   - string：驗證通過、trim 後的合法網址
 *
 * type !== "news" 時一律回傳 null（無論 actionUrl 傳入什麼，包含 undefined），
 * 不會因為值不合法而拋錯——非 news 公告本來就不該有這個欄位，不需要因此擋住
 * 其他類型公告的儲存。只有 type === "news" 且確定「這次要設定/清除」時，才會
 * 對非空字串做格式驗證，格式不合法會拋出 Error（由呼叫端轉換成清楚的錯誤訊息）。
 *
 * @param hasIntent 這次呼叫是否明確表示「要處理 actionUrl 這個欄位」。create
 *   永遠是 true（沒有「維持原值」這個語意）；update 只有 payload 真的包含
 *   actionUrl 這個 key 時才是 true。
 */
export function normalizeAnnouncementActionUrl(
  type: AnnouncementType,
  actionUrl: string | null | undefined,
  hasIntent: boolean,
): string | null | undefined {
  if (type !== "news") return null;
  if (!hasIntent) return undefined;
  if (actionUrl == null) return null;
  const trimmed = actionUrl.trim();
  if (trimmed === "") return null;
  if (!isValidAnnouncementActionUrl(trimmed)) {
    throw new Error(`無效的相關內容連結：${trimmed}`);
  }
  return trimmed;
}

export async function getAnnouncementById(id: number): Promise<Announcement | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return row;
}

export async function createAnnouncement(data: {
  title: string;
  content: string;
  type: AnnouncementType;
  isPinned?: boolean;
  actionUrl?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // create 沒有「維持原值」的語意，一定會明確寫入 actionUrl（hasIntent 固定
  // true），未提供時視同「明確沒有網址」。
  const actionUrl = normalizeAnnouncementActionUrl(data.type, data.actionUrl ?? null, true);
  const result = await db.insert(announcements).values({
    title: data.title,
    content: data.content,
    type: data.type,
    isPinned: data.isPinned,
    actionUrl: actionUrl ?? null,
  });
  return result[0].insertId;
}

export async function updateAnnouncement(
  id: number,
  data: Partial<{ title: string; content: string; type: AnnouncementType; isPinned: boolean; actionUrl: string | null }>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const { actionUrl, type, ...rest } = data;
  const setData: Partial<{ title: string; content: string; type: AnnouncementType; isPinned: boolean; actionUrl: string | null }> = { ...rest };
  if (type !== undefined) setData.type = type;

  // 決定「這次更新完成後」實際生效的 type：payload 有帶就用那個，沒帶就要查
  // 資料庫目前的值——即使這次完全沒有要動 type／actionUrl，也必須知道有效
  // type，才能判斷是否該強制把 actionUrl 清成 null（例如既有非 news 公告若
  // 因為舊資料異常仍殘留 actionUrl，任何一次更新都應該順便清掉，不能只在
  // 明確改 type 或 actionUrl 時才處理）。
  const effectiveType = type ?? (await getAnnouncementById(id))?.type;
  const hasActionUrlIntent = "actionUrl" in data;

  if (effectiveType) {
    const normalized = normalizeAnnouncementActionUrl(effectiveType, actionUrl, hasActionUrlIntent);
    if (normalized !== undefined) {
      setData.actionUrl = normalized;
    }
  }

  await db.update(announcements).set(setData).where(eq(announcements.id, id));
}

export async function deleteAnnouncement(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(announcements).where(eq(announcements.id, id));
}

// ===== 找消息（產業情報／News）=====
//
// 刻意獨立於 announcements 之外（見 drizzle/schema.ts news 表註解），只共用底層
// 能力：Markdown 顯示交給前端沿用既有的 MarkdownContent；Email／Push 分別呼叫
// email.ts／push.ts 既有的底層寄送函式，不重寫一套新的寄送機制。

export type NewsCategory = "all" | "important" | "competition" | "exhibition" | "industry";

/** slug 格式：小寫英數字，可用 "-" 分段，避免任何需要額外編碼的字元進到網址。 */
export function isValidNewsSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 200 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/** 後端一律用 shared/constants.ts 的 INDUSTRY_OPTIONS 驗證，不信任前端傳來的產業名稱字串。 */
export function validateNewsIndustryNames(names: string[]): void {
  const invalid = names.filter(n => !(INDUSTRY_OPTIONS as readonly string[]).includes(n));
  if (invalid.length > 0) {
    throw new Error(`無效的產業分類：${invalid.join("、")}`);
  }
}

async function setNewsIndustries(newsId: number, industryNames: string[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const unique = Array.from(new Set(industryNames));
  validateNewsIndustryNames(unique);
  await db.delete(newsIndustries).where(eq(newsIndustries.newsId, newsId));
  if (unique.length > 0) {
    await db.insert(newsIndustries).values(unique.map(industryName => ({ newsId, industryName })));
  }
}

export async function getNewsIndustryNames(newsId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ industryName: newsIndustries.industryName }).from(newsIndustries).where(eq(newsIndustries.newsId, newsId));
  return rows.map(r => r.industryName);
}

/** 列表頁批次取多筆消息各自的產業標籤，避免每筆消息各查一次造成 N+1。 */
export async function getNewsIndustryNamesBatch(newsIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (newsIds.length === 0) return map;
  const db = await getDb();
  if (!db) return map;
  const rows = await db.select({ newsId: newsIndustries.newsId, industryName: newsIndustries.industryName })
    .from(newsIndustries).where(inArray(newsIndustries.newsId, newsIds));
  for (const r of rows) {
    const arr = map.get(r.newsId) ?? [];
    arr.push(r.industryName);
    map.set(r.newsId, arr);
  }
  return map;
}

export async function getNewsById(id: number): Promise<News | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(news).where(eq(news.id, id)).limit(1);
  return row;
}

/** 公開頁專用：只回傳 status === "published"，草稿／已下架一律視為不存在（給前端當 404 處理）。 */
export async function getPublishedNewsBySlug(slug: string): Promise<News | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(news)
    .where(and(eq(news.slug, slug), eq(news.status, "published")))
    .limit(1);
  return row;
}

export interface ListPublicNewsParams {
  category: NewsCategory;
  industryName?: string;
  offset?: number;
  limit?: number;
}

/** 只有 status === "published" 會出現；依 publishedAt DESC、id DESC 排序，避免同秒發布時排序不穩定。 */
export async function listPublicNews(params: ListPublicNewsParams): Promise<{ items: News[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const limit = Math.min(params.limit ?? 20, 50);
  const offset = params.offset ?? 0;

  const conditions = [eq(news.status, "published")];
  if (params.category === "important") conditions.push(eq(news.isImportant, true));
  else if (params.category === "competition") conditions.push(eq(news.isCompetition, true));
  else if (params.category === "exhibition") conditions.push(eq(news.isExhibition, true));
  else if (params.category === "industry") {
    if (!params.industryName) return { items: [], total: 0 };
    const idRows = await db.selectDistinct({ newsId: newsIndustries.newsId })
      .from(newsIndustries).where(eq(newsIndustries.industryName, params.industryName));
    const ids = idRows.map(r => r.newsId);
    if (ids.length === 0) return { items: [], total: 0 };
    conditions.push(inArray(news.id, ids));
  }
  // category === "all"：不額外限制，所有已發布項目都出現，不需要 admin 選任何分類。

  const where = and(...conditions);
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(news).where(where);
  const items = await db.select().from(news).where(where)
    .orderBy(desc(news.publishedAt), desc(news.id))
    .limit(limit).offset(offset);
  return { items, total: Number(countResult?.count ?? 0) };
}

export async function getAdminNewsList(limit = 100): Promise<News[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(news).orderBy(desc(news.updatedAt)).limit(limit);
}

export interface CreateNewsInput {
  slug: string;
  title: string;
  summary: string;
  content: string;
  status: "draft" | "published";
  isImportant?: boolean;
  isCompetition?: boolean;
  isExhibition?: boolean;
  industryNames?: string[];
  createdBy: number;
}

export async function createNews(data: CreateNewsInput): Promise<{ id: number; shouldNotify: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (!isValidNewsSlug(data.slug)) throw new Error(`無效的網址代稱：${data.slug}`);
  const industryNames = Array.from(new Set(data.industryNames ?? []));
  validateNewsIndustryNames(industryNames);

  const existing = await db.select({ id: news.id }).from(news).where(eq(news.slug, data.slug)).limit(1);
  if (existing.length > 0) throw new Error(`此網址代稱已被使用：${data.slug}`);

  const publishNow = data.status === "published";
  const now = new Date();
  const result = await db.insert(news).values({
    slug: data.slug,
    title: data.title,
    summary: data.summary,
    content: data.content,
    status: data.status,
    isImportant: data.isImportant ?? false,
    isCompetition: data.isCompetition ?? false,
    isExhibition: data.isExhibition ?? false,
    publishedAt: publishNow ? now : null,
    firstPublishedAt: publishNow ? now : null,
    createdBy: data.createdBy,
  });
  const id = result[0].insertId;
  if (industryNames.length > 0) {
    await db.insert(newsIndustries).values(industryNames.map(industryName => ({ newsId: id, industryName })));
  }
  // 建立當下就是 published，等同「第一次從草稿轉為已發布」，需要觸發分眾通知。
  return { id, shouldNotify: publishNow };
}

export interface UpdateNewsInput {
  slug?: string;
  title?: string;
  summary?: string;
  content?: string;
  status?: "draft" | "published" | "withdrawn";
  isImportant?: boolean;
  isCompetition?: boolean;
  isExhibition?: boolean;
  industryNames?: string[];
}

/**
 * Partial update。是否要觸發分眾通知只看 firstPublishedAt 在這次更新「之前」
 * 是不是 NULL——用 transaction 包住「讀取目前 firstPublishedAt → 條件式寫入」，
 * 避免發布流程重跑或併發呼叫把同一次發布誤判成兩次「第一次發布」。真正防止
 * 重複寄送的最後防線仍是 newsNotifications 的唯一索引（見
 * createPendingNewsNotifications），這裡的 transaction 只是讓絕大多數情況下
 * 第一層就不會誤判，屬於防禦縱深，不是唯一保證。
 */
export async function updateNews(id: number, data: UpdateNewsInput): Promise<{ shouldNotify: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  if (data.slug !== undefined) {
    if (!isValidNewsSlug(data.slug)) throw new Error(`無效的網址代稱：${data.slug}`);
    const existing = await db.select({ id: news.id }).from(news).where(eq(news.slug, data.slug)).limit(1);
    if (existing.length > 0 && existing[0].id !== id) throw new Error(`此網址代稱已被使用：${data.slug}`);
  }

  if (data.industryNames !== undefined) {
    await setNewsIndustries(id, data.industryNames);
  }

  return db.transaction(async (tx) => {
    // FOR UPDATE：兩個發布請求幾乎同時進入時（例如同一個 API 因逾時被重試、
    // 或使用者連點兩下），沒有這個鎖的話兩個 transaction 可能都讀到
    // firstPublishedAt 仍是 NULL、都判斷「這是第一次發布」而各自觸發一次分眾
    // 通知。加上 FOR UPDATE 後，第二個 transaction 會被擋到第一個 commit
    // 為止，取得鎖之後讀到的一定是「已經有 firstPublishedAt」的最新值，
    // shouldNotify 自然變成 false，只有真正最先執行的那個會觸發通知。
    const [current] = await tx.select().from(news).where(eq(news.id, id)).limit(1).for("update");
    if (!current) throw new Error("找不到此則消息");

    const setData: Partial<InsertNews> = {};
    if (data.slug !== undefined) setData.slug = data.slug;
    if (data.title !== undefined) setData.title = data.title;
    if (data.summary !== undefined) setData.summary = data.summary;
    if (data.content !== undefined) setData.content = data.content;
    if (data.isImportant !== undefined) setData.isImportant = data.isImportant;
    if (data.isCompetition !== undefined) setData.isCompetition = data.isCompetition;
    if (data.isExhibition !== undefined) setData.isExhibition = data.isExhibition;

    let shouldNotify = false;
    if (data.status !== undefined) {
      setData.status = data.status;
      if (data.status === "published") {
        const publishNow = new Date();
        setData.publishedAt = publishNow;
        if (current.firstPublishedAt == null) {
          setData.firstPublishedAt = publishNow;
          shouldNotify = true;
        }
      }
    }

    if (Object.keys(setData).length > 0) {
      await tx.update(news).set(setData).where(eq(news.id, id));
    }

    if (shouldNotify) {
      // 第一次發布：把「草稿階段就上傳、規則是發布後 30 天」且還沒被算出期限的
      // 附件，一次設定 downloadExpiresAt = firstPublishedAt + 30 天。跟上面同一個
      // transaction、同一把 news 列鎖之下完成——重試或併發呼叫第二次進來時，
      // current.firstPublishedAt 一定已經有值，shouldNotify 為 false，不會再次
      // 執行這段、也就不會把期限往後推。
      const expiresAt = new Date((setData.firstPublishedAt as Date).getTime() + THIRTY_DAYS_MS);
      await tx.update(newsAttachments)
        .set({ downloadExpiresAt: expiresAt })
        .where(and(
          eq(newsAttachments.newsId, id),
          eq(newsAttachments.expirationType, "after_publish_30d"),
          isNull(newsAttachments.downloadExpiresAt),
        ));
    }
    return { shouldNotify };
  });
}

// ===== 找消息：封面圖片 =====
// 封面是公開消息內容的一部分（訪客可見），不像 PDF 附件需要登入保護，因此
// 直接沿用 storagePut 既有的「回傳公開 URL」慣例即可，跟工廠大頭貼／封面圖
// 是同一套做法。coverImageKey 只在後端內部用來精準刪除舊的 S3 object。

/** 回傳「更新前」的 coverImageKey，讓呼叫端（router）決定要不要刪除舊的 S3 object。 */
export async function setNewsCover(
  newsId: number,
  cover: { key: string; url: string; alt: string | null },
): Promise<{ previousKey: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [current] = await db.select({ coverImageKey: news.coverImageKey }).from(news).where(eq(news.id, newsId)).limit(1);
  await db.update(news).set({
    coverImageKey: cover.key,
    coverImageUrl: cover.url,
    coverImageAlt: cover.alt,
  }).where(eq(news.id, newsId));
  return { previousKey: current?.coverImageKey ?? null };
}

export async function clearNewsCover(newsId: number): Promise<{ previousKey: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [current] = await db.select({ coverImageKey: news.coverImageKey }).from(news).where(eq(news.id, newsId)).limit(1);
  await db.update(news).set({ coverImageKey: null, coverImageUrl: null, coverImageAlt: null }).where(eq(news.id, newsId));
  return { previousKey: current?.coverImageKey ?? null };
}

// ===== 找消息：PDF 附件 metadata =====
// storageKey 只給後端內部使用（刪除物件、簽發下載連結），公開/會員端查詢一律
// 用下面的白名單 select，結構性保證 storageKey／mimeType 這類內部欄位不會被
// 意外回傳給前端。

export const MAX_NEWS_ATTACHMENTS_PER_NEWS = 5;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getNewsAttachmentCount(newsId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [[{ n }]] = [await db.select({ n: sql<number>`COUNT(*)` }).from(newsAttachments).where(eq(newsAttachments.newsId, newsId))];
  return Number(n);
}

export type NewsAttachmentExpirationType = "after_publish_30d" | "custom" | "never";

export interface CreateNewsAttachmentInput {
  newsId: number;
  displayName: string;
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number;
  expirationType: NewsAttachmentExpirationType;
  /** 僅 expirationType === "custom" 時使用；呼叫端需先驗證是未來時間。 */
  customDownloadExpiresAt?: Date | null;
}

/**
 * 用 transaction + news 表的 FOR UPDATE 鎖，讓「這篇目前有幾筆附件」「這篇是否
 * 已經發布過」的讀取跟這次新增鎖在一起，避免多個 finalize 併發呼叫各自讀到
 * 舊的數量一起衝破 5 份上限，也確保 after_publish_30d 的初始到期時間是根據
 * 當下最新的發布狀態算出來，不是根據過期的讀取結果。
 */
export async function createNewsAttachment(data: CreateNewsAttachmentInput): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  return db.transaction(async (tx) => {
    const [newsRow] = await tx.select({ id: news.id, firstPublishedAt: news.firstPublishedAt })
      .from(news).where(eq(news.id, data.newsId)).limit(1).for("update");
    if (!newsRow) throw new Error("找不到此則消息");

    const [[{ n }]] = [await tx.select({ n: sql<number>`COUNT(*)` }).from(newsAttachments).where(eq(newsAttachments.newsId, data.newsId))];
    if (Number(n) >= MAX_NEWS_ATTACHMENTS_PER_NEWS) {
      throw new Error(`每篇消息最多只能有 ${MAX_NEWS_ATTACHMENTS_PER_NEWS} 份附件`);
    }

    let downloadExpiresAt: Date | null = null;
    if (data.expirationType === "custom") {
      if (!data.customDownloadExpiresAt || data.customDownloadExpiresAt.getTime() <= Date.now()) {
        throw new Error("自訂到期時間必須晚於目前時間");
      }
      downloadExpiresAt = data.customDownloadExpiresAt;
    } else if (data.expirationType === "after_publish_30d" && newsRow.firstPublishedAt != null) {
      // 這篇消息已經發布過，代表這份附件是「發布後才補上傳」——直接從上傳完成
      // 時間起算 30 天。還沒發布過的話 downloadExpiresAt 維持 NULL，交給
      // updateNews() 在第一次真正轉為 published 的當下才寫入。
      downloadExpiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
    }
    // expirationType === "never"，或 after_publish_30d 且尚未發布：downloadExpiresAt 維持 null。

    const [[{ maxOrder }]] = [await tx.select({ maxOrder: sql<number>`COALESCE(MAX(${newsAttachments.sortOrder}), -1)` }).from(newsAttachments).where(eq(newsAttachments.newsId, data.newsId))];
    const result = await tx.insert(newsAttachments).values({
      newsId: data.newsId,
      displayName: data.displayName,
      originalFileName: data.originalFileName,
      storageKey: data.storageKey,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      sortOrder: Number(maxOrder) + 1,
      uploadedBy: data.uploadedBy,
      expirationType: data.expirationType,
      downloadExpiresAt,
    });
    return result[0].insertId;
  });
}

/**
 * 管理員調整某一份附件的到期規則（延長期限／改成自訂日期／改成永久有效）。
 * storageDeletedAt 一旦有值就代表實體檔案已經從私有 bucket 刪除——這裡刻意
 * 拒絕修改，不讓「改期限」變成偷偷「復活」一份已經不存在的檔案；管理員只能
 * 走重新上傳。
 */
export async function updateNewsAttachmentExpiration(
  id: number,
  update: { expirationType: NewsAttachmentExpirationType; downloadExpiresAt?: Date | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.select({ storageDeletedAt: newsAttachments.storageDeletedAt })
    .from(newsAttachments).where(eq(newsAttachments.id, id)).limit(1);
  if (!row) throw new Error("找不到此附件");
  if (row.storageDeletedAt != null) {
    throw new Error("檔案已從儲存空間刪除，如需重新提供，請重新上傳");
  }

  if (update.expirationType === "custom") {
    if (!update.downloadExpiresAt || update.downloadExpiresAt.getTime() <= Date.now()) {
      throw new Error("自訂到期時間必須晚於目前時間");
    }
    await db.update(newsAttachments)
      .set({ expirationType: "custom", downloadExpiresAt: update.downloadExpiresAt })
      .where(eq(newsAttachments.id, id));
  } else if (update.expirationType === "never") {
    await db.update(newsAttachments)
      .set({ expirationType: "never", downloadExpiresAt: null })
      .where(eq(newsAttachments.id, id));
  } else {
    await db.update(newsAttachments)
      .set({ expirationType: "after_publish_30d" })
      .where(eq(newsAttachments.id, id));
  }
}

/** isExpired／isStorageDeleted 一律由後端算，不信任前端傳入的時間。 */
export function computeNewsAttachmentStatus(a: {
  expirationType: NewsAttachmentExpirationType;
  downloadExpiresAt: Date | null;
  storageDeletedAt: Date | null;
}): { isExpired: boolean; isStorageDeleted: boolean } {
  const isStorageDeleted = a.storageDeletedAt != null;
  const isExpired = a.expirationType !== "never" && a.downloadExpiresAt != null && a.downloadExpiresAt.getTime() <= Date.now();
  return { isExpired, isStorageDeleted };
}

/** 管理員後台用：包含 storageKey，僅限 adminProcedure 呼叫端使用，不得直接轉發給公開/會員端。 */
export async function getNewsAttachmentsForAdmin(newsId: number): Promise<NewsAttachment[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(newsAttachments).where(eq(newsAttachments.newsId, newsId)).orderBy(newsAttachments.sortOrder);
}

export interface PublicNewsAttachment {
  id: number;
  displayName: string;
  sizeBytes: number;
  sortOrder: number;
  expirationType: NewsAttachmentExpirationType;
  downloadExpiresAt: Date | null;
  isExpired: boolean;
  isStorageDeleted: boolean;
}

/**
 * 公開/會員端用：白名單欄位，結構性保證不會洩漏 storageKey／mimeType／
 * deleteFailureReason 等內部欄位。即使已過期或已被清除，還是回傳這筆
 * metadata（isExpired/isStorageDeleted 標示狀態），讓文章頁能顯示「已過期」
 * 而不是整筆消失。
 */
export async function getNewsAttachmentsPublic(newsId: number): Promise<PublicNewsAttachment[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: newsAttachments.id,
    displayName: newsAttachments.displayName,
    sizeBytes: newsAttachments.sizeBytes,
    sortOrder: newsAttachments.sortOrder,
    expirationType: newsAttachments.expirationType,
    downloadExpiresAt: newsAttachments.downloadExpiresAt,
    storageDeletedAt: newsAttachments.storageDeletedAt,
  }).from(newsAttachments).where(eq(newsAttachments.newsId, newsId)).orderBy(newsAttachments.sortOrder);
  return rows.map(({ storageDeletedAt, ...r }) => ({
    ...r,
    ...computeNewsAttachmentStatus({ expirationType: r.expirationType, downloadExpiresAt: r.downloadExpiresAt, storageDeletedAt }),
  }));
}

export async function getNewsAttachmentById(id: number): Promise<NewsAttachment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(newsAttachments).where(eq(newsAttachments.id, id)).limit(1);
  return row;
}

export async function renameNewsAttachment(id: number, displayName: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(newsAttachments).set({ displayName }).where(eq(newsAttachments.id, id));
}

/** 回傳被刪除那一筆的 storageKey，讓呼叫端決定要不要刪除對應的 S3 object。 */
export async function deleteNewsAttachment(id: number): Promise<{ storageKey: string } | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select({ storageKey: newsAttachments.storageKey }).from(newsAttachments).where(eq(newsAttachments.id, id)).limit(1);
  if (!row) return undefined;
  await db.delete(newsAttachments).where(eq(newsAttachments.id, id));
  return row;
}

// ===== 找消息：PDF 附件自動清理排程用 =====
// 跟上面「管理員手動刪除」（deleteNewsAttachment，整筆連 metadata 一起刪掉）不同，
// 排程清理只刪實體檔案、保留 metadata 列（storageDeletedAt 標示已刪），讓文章頁
// 還能顯示「已超過下載期限」而不是整筆消失，也保留稽核紀錄。

export interface CleanupCandidateAttachment {
  id: number;
  storageKey: string;
  displayName: string;
}

/**
 * 排程清理用：到期、非永久、尚未刪除過實體檔案的附件。一律用後端 now，不信任
 * 呼叫端傳入的時間。
 *
 * 刻意用 lte(downloadExpiresAt, new Date()) 而不是原始 SQL 的 NOW()：drizzle 的
 * mysql timestamp 欄位寫入時是把 JS Date 的 UTC 年月日時分秒數字原樣當成字面
 * 字串送給 MySQL（見 drizzle-orm mysql-core timestamp.js 的 mapToDriverValue），
 * 讀回時再把那組數字原樣當成 UTC 重建成 Date——只要「寫入」跟「讀取」都經過
 * drizzle，兩邊互相抵銷、還原出原本的正確時間。但如果拿一個「drizzle 寫入的
 * 欄位」去跟「MySQL 原生 NOW()」比較，NOW() 反映的是 session time_zone 真正
 * 的當下時刻，兩者就不是同一套換算方式，只要 MySQL session time_zone 不是
 * UTC（例如本機常見的 SYSTEM／Asia/Taipei），比較結果就會整整偏移一個時區
 * offset（本機環境下曾經因此把「一小時後才到期」的附件誤判成「已經到期」）。
 * 用 lte() 讓「現在」也走 drizzle 的同一套序列化，兩邊的偏移量互相抵銷，
 * 不管 MySQL session time_zone 設定什麼都能得到正確的先後順序判斷。
 */
export async function getNewsAttachmentsDueForCleanup(limit = 200): Promise<CleanupCandidateAttachment[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: newsAttachments.id,
    storageKey: newsAttachments.storageKey,
    displayName: newsAttachments.displayName,
  }).from(newsAttachments).where(and(
    isNotNull(newsAttachments.downloadExpiresAt),
    lte(newsAttachments.downloadExpiresAt, new Date()),
    ne(newsAttachments.expirationType, "never"),
    isNull(newsAttachments.storageDeletedAt),
  )).limit(limit);
}

/** 單筆 S3 DeleteObject 成功（或物件本來就已經不存在，視同成功）後呼叫。 */
export async function markNewsAttachmentStorageDeleted(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db.update(newsAttachments)
    .set({ storageDeletedAt: now, lastDeleteAttemptAt: now, deleteFailureReason: null })
    .where(eq(newsAttachments.id, id));
}

/**
 * 單筆刪除失敗時呼叫：只累加次數、記錄精簡的失敗原因，不設定 storageDeletedAt，
 * 讓下次排程可以重試；單筆失敗不影響同一批次其他附件（呼叫端逐筆 try/catch）。
 */
export async function recordNewsAttachmentDeleteFailure(id: number, reason: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const truncated = reason.replace(/[\r\n]/g, " ").slice(0, 280);
  await db.update(newsAttachments)
    .set({
      deleteAttempts: sql`${newsAttachments.deleteAttempts} + 1`,
      lastDeleteAttemptAt: new Date(),
      deleteFailureReason: truncated,
    })
    .where(eq(newsAttachments.id, id));
}

/** 「重要消息」的收件資格：沿用既有平台公告的通知資格規則，不另外維護一套判斷邏輯。 */
async function getImportantNewsRecipients() {
  return getActiveUsersForAnnouncement();
}

/**
 * 「產業消息」收件資格：擁有或共同管理「主產業符合、且審核狀態為 approved」
 * 工廠的使用者。同一使用者可能同時是不同工廠的 owner／co-manager，這裡先在
 * userId 這層用 Set 去重，回傳的清單本身就不會有重複 id。
 */
async function getIndustryNewsRecipients(industryNames: string[]) {
  if (industryNames.length === 0) return [];
  const db = await getDb();
  if (!db) return [];

  const matchedFactories = await db.select({ id: factories.id, ownerId: factories.ownerId })
    .from(factories)
    .where(and(
      eq(factories.status, "approved"),
      sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify(industryNames)})`,
    ));
  if (matchedFactories.length === 0) return [];

  const userIds = new Set<number>(matchedFactories.map(f => f.ownerId));
  const factoryIds = matchedFactories.map(f => f.id);
  const coMgrRows = await db.select({ userId: factoryCoManagers.userId })
    .from(factoryCoManagers)
    .where(and(inArray(factoryCoManagers.factoryId, factoryIds), isNull(factoryCoManagers.removedAt)));
  for (const r of coMgrRows) userIds.add(r.userId);
  if (userIds.size === 0) return [];

  return db.select({
    id: users.id,
    email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})`,
    name: users.name,
    notificationSettings: users.notificationSettings,
  }).from(users).where(and(inArray(users.id, Array.from(userIds)), isNull(users.deletedAt)));
}

export interface NewsRecipientInfo {
  id: number;
  email: string | null; // 已套用「news」opt-out 規則；opt-out 或無 email 時為 null
  name: string | null;
  pushEnabled: boolean; // 已套用「pushNews」opt-out 規則
}

/**
 * 找消息目前還沒有會員中心 UI 可以設定 notificationSettings.news／pushNews，
 * 所以本階段的預設值刻意是「預設允許」——未設定（undefined/null）或非 false
 * 的任何值都視為允許；只有明確設成 false 才排除。等之後補上設定 UI，使用者
 * 才有辦法主動關閉，在那之前不應該讓完全没設定過的既有會員被排除在外。
 */
function isNewsEmailAllowed(settings: Record<string, boolean> | null | undefined): boolean {
  return (settings ?? {})['news'] !== false;
}
function isNewsPushAllowed(settings: Record<string, boolean> | null | undefined): boolean {
  return (settings ?? {})['pushNews'] !== false;
}

/**
 * 找消息分眾通知的唯一收件人聚合入口：重要消息 + 產業消息兩個來源合併、以
 * userId 去重（對應規格「蒐集 → 蒐集 → 合併 → 去重 → 才建立各管道寄送工作」）。
 * 純競賽／純展覽（isImportant=false 且沒有勾選任何產業）一律回傳空陣列，
 * 呼叫端據此完全不建立 Email／Push 工作、也不寄送。
 */
export async function gatherNewsRecipients(opts: { isImportant: boolean; industryNames: string[] }): Promise<NewsRecipientInfo[]> {
  if (!opts.isImportant && opts.industryNames.length === 0) return [];

  const [importantList, industryList] = await Promise.all([
    opts.isImportant ? getImportantNewsRecipients() : Promise.resolve([] as Awaited<ReturnType<typeof getImportantNewsRecipients>>),
    opts.industryNames.length > 0 ? getIndustryNewsRecipients(opts.industryNames) : Promise.resolve([] as Awaited<ReturnType<typeof getIndustryNewsRecipients>>),
  ]);

  const merged = new Map<number, NewsRecipientInfo>();
  for (const u of [...importantList, ...industryList]) {
    if (merged.has(u.id)) continue;
    const s = (u.notificationSettings as Record<string, boolean> | null) ?? {};
    merged.set(u.id, {
      id: u.id,
      email: (u.email && isNewsEmailAllowed(s)) ? u.email : null,
      name: u.name,
      pushEnabled: isNewsPushAllowed(s),
    });
  }
  return Array.from(merged.values());
}

/**
 * 針對這則消息、這批使用者、這個管道，把「還沒有紀錄」的部分建成 pending 通知
 * 紀錄；已經存在的（不論任何狀態）一律跳過，不重複建立、也不重複寄送。唯一
 * 防線是 news_notif_uq (newsId, userId, channel)——就算這個函式因重試被呼叫
 * 兩次，第二次的 insert 會因唯一索引衝突被 catch 吞掉，不會造成兩筆紀錄或
 * 兩次寄送。回傳「這次真的新建立」的紀錄，只有這些才需要實際寄送。
 */
export async function createPendingNewsNotifications(
  newsId: number,
  userIds: number[],
  channel: "email" | "push",
): Promise<{ id: number; userId: number }[]> {
  if (userIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];

  const existingRows = await db.select({ userId: newsNotifications.userId })
    .from(newsNotifications)
    .where(and(
      eq(newsNotifications.newsId, newsId),
      eq(newsNotifications.channel, channel),
      inArray(newsNotifications.userId, userIds),
    ));
  const existingIds = new Set(existingRows.map(r => r.userId));
  const toCreate = userIds.filter(uid => !existingIds.has(uid));
  if (toCreate.length === 0) return [];

  const created: { id: number; userId: number }[] = [];
  for (const userId of toCreate) {
    try {
      const result = await db.insert(newsNotifications).values({ newsId, userId, channel, status: "pending" });
      created.push({ id: result[0].insertId, userId });
    } catch {
      // 唯一索引衝突：代表已經有紀錄了（例如併發呼叫），略過即可，不是錯誤。
      console.warn(`[news] duplicate notification record skipped newsId=${newsId} channel=${channel}`);
    }
  }
  return created;
}

export async function markNewsNotificationSent(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(newsNotifications).set({ status: "sent", sentAt: new Date() }).where(eq(newsNotifications.id, id));
}

export async function markNewsNotificationFailed(id: number, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(newsNotifications).set({ status: "failed", error: error.slice(0, 500) }).where(eq(newsNotifications.id, id));
}

/**
 * 撈出這則消息「還沒有成功送達」的通知紀錄（pending 或 failed），供管理員
 * 手動觸發補寄——涵蓋「pending 建立後程序中斷、從未真正寄送」與「寄送失敗」
 * 兩種情況。查詢條件只有 pending／failed 這兩種狀態，status='sent' 的紀錄
 * 從資料來源這一層就不會被撈到，不可能被這個機制誤觸重寄。
 */
export async function getRetryableNewsNotifications(newsId: number): Promise<{ id: number; userId: number; channel: "email" | "push" }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: newsNotifications.id, userId: newsNotifications.userId, channel: newsNotifications.channel })
    .from(newsNotifications)
    .where(and(eq(newsNotifications.newsId, newsId), inArray(newsNotifications.status, ["pending", "failed"])));
}

// ===== 登入彈窗（綁定既有「平台消息」公告的登入曝光入口）=====
//
// 這個表的資料結構刻意不做「草稿／已發布／封存」狀態機——announcements 這張表
// 本身就沒有這個概念（一筆存在即代表已發布，delete 是直接硬刪除，沒有軟刪除
// 欄位）。因此這裡「公告是否有效可綁定」的唯一判斷依據簡化為：
//   1. announcementId 對應的公告仍然存在（沒被刪除）
//   2. 該公告的 type === "news"（平台消息）
// 這與需求文件假設的「草稿/已發布/已封存」狀態機不同，是依實際 schema 現況
// 做的最小合理調整。

// 「一天一次」判定沿用上方 pageViews 已經驗證過的 twDateStr()（台灣時間
// YYYY-MM-DD），確保每天重新計算的基準是 Asia/Taipei 00:00，而不是每隔 24 小時。

async function getValidNewsAnnouncementById(announcementId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);
  if (!row) return null;
  if (row.type !== "news") return null;
  return row;
}

/** 管理員後台專用：可綁定的公告清單（類型為平台消息）。給下拉／可搜尋選擇器用，不含草稿/其他類型。 */
export async function getPublishedNewsAnnouncementsForPicker(keyword?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(announcements.type, "news")];
  if (keyword && keyword.trim()) {
    conditions.push(like(announcements.title, `%${keyword.trim()}%`));
  }
  return db.select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt })
    .from(announcements)
    .where(and(...conditions))
    .orderBy(desc(announcements.createdAt))
    .limit(50);
}

export type LoginPopupAdminRow = {
  id: number;
  title: string;
  summary: string;
  announcementId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  boundAnnouncementTitle: string | null;
  boundAnnouncementCreatedAt: Date | null;
  boundAnnouncementValid: boolean;
  // 啟用中彈窗依 updatedAt DESC、id DESC 排序後的順位（1~5）；未啟用則為 null。
  activeRank: number | null;
};

/** 管理員後台列表：帶出綁定公告的標題/發布日期、即時判斷綁定是否仍然有效、
 * 以及啟用中彈窗目前的排序順位（1~5，對應前台會顯示的順序）。 */
export async function getLoginPopupsForAdmin(): Promise<LoginPopupAdminRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: loginPopups.id,
    title: loginPopups.title,
    summary: loginPopups.summary,
    announcementId: loginPopups.announcementId,
    isActive: loginPopups.isActive,
    createdAt: loginPopups.createdAt,
    updatedAt: loginPopups.updatedAt,
    boundAnnouncementTitle: announcements.title,
    boundAnnouncementCreatedAt: announcements.createdAt,
    boundAnnouncementType: announcements.type,
  })
    .from(loginPopups)
    .leftJoin(announcements, eq(loginPopups.announcementId, announcements.id))
    .orderBy(desc(loginPopups.updatedAt), desc(loginPopups.id));

  let activeRankCounter = 0;
  return rows.map(r => {
    const isActive = r.isActive;
    const activeRank = isActive ? ++activeRankCounter : null;
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      announcementId: r.announcementId,
      isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      boundAnnouncementTitle: r.boundAnnouncementTitle,
      boundAnnouncementCreatedAt: r.boundAnnouncementCreatedAt,
      // 公告已刪除（announcementId 被 FK 設成 NULL 或找不到 join 結果）或類型已被
      // 改成非平台消息，都視為「綁定公告已失效」。
      boundAnnouncementValid: r.announcementId != null && r.boundAnnouncementTitle != null && r.boundAnnouncementType === "news",
      activeRank,
    };
  });
}

export const MAX_ACTIVE_LOGIN_POPUPS = 5;

/**
 * 保證同時最多 MAX_ACTIVE_LOGIN_POPUPS 則登入彈窗處於啟用狀態。
 *
 * 任何可能讓 isActive 由 false 變 true 的流程（新增即啟用、編輯切換成啟用）
 * 完成後都必須呼叫這個函式：在同一個 transaction 內查出所有 isActive=true、
 * 依 updatedAt DESC、id DESC 排序，只保留前 5 筆，其餘一律改成 isActive=false
 * ——只調整狀態，不刪除任何登入彈窗紀錄。
 *
 * 回傳被自動停用的 id 清單，方便呼叫端（router）回報「已超過上限，較舊消息
 * 已自動停用」的提示。
 */
export async function enforceMaxFiveActiveLoginPopups(): Promise<{ deactivatedIds: number[] }> {
  const db = await getDb();
  if (!db) return { deactivatedIds: [] };

  return db.transaction(async (tx) => {
    const active = await tx.select({ id: loginPopups.id })
      .from(loginPopups)
      .where(eq(loginPopups.isActive, true))
      .orderBy(desc(loginPopups.updatedAt), desc(loginPopups.id));

    if (active.length <= MAX_ACTIVE_LOGIN_POPUPS) return { deactivatedIds: [] };

    const idsToDeactivate = active.slice(MAX_ACTIVE_LOGIN_POPUPS).map(r => r.id);
    await tx.update(loginPopups).set({ isActive: false }).where(inArray(loginPopups.id, idsToDeactivate));
    return { deactivatedIds: idsToDeactivate };
  });
}

export async function createLoginPopup(data: {
  title: string;
  summary: string;
  announcementId: number;
  isActive?: boolean;
}): Promise<{ id: number; deactivatedIds: number[] }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const announcement = await getValidNewsAnnouncementById(data.announcementId);
  if (!announcement) {
    throw new Error("綁定的公告不存在，或不是已發布的平台消息公告");
  }

  const isActive = data.isActive ?? false;
  const result = await db.insert(loginPopups).values({
    title: data.title,
    summary: data.summary,
    announcementId: data.announcementId,
    isActive,
  });
  const id = result[0].insertId;

  const { deactivatedIds } = isActive ? await enforceMaxFiveActiveLoginPopups() : { deactivatedIds: [] as number[] };
  return { id, deactivatedIds };
}

export async function updateLoginPopup(id: number, data: Partial<{
  title: string;
  summary: string;
  announcementId: number;
  isActive: boolean;
}>): Promise<{ deactivatedIds: number[] }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  if (data.announcementId !== undefined) {
    const announcement = await getValidNewsAnnouncementById(data.announcementId);
    if (!announcement) {
      throw new Error("綁定的公告不存在，或不是已發布的平台消息公告");
    }
  }

  // 停用中的彈窗要重新啟用前，必須確認目前綁定（可能是本次更新前就已存在的
  // 綁定，未必是這次一起更新的 announcementId）仍然有效，不能只信任前端。
  if (data.isActive === true) {
    const [current] = await db.select().from(loginPopups).where(eq(loginPopups.id, id)).limit(1);
    if (!current) throw new Error("找不到該登入彈窗");
    const effectiveAnnouncementId = data.announcementId ?? current.announcementId;
    if (!effectiveAnnouncementId) {
      throw new Error("綁定公告已失效，請重新綁定有效的平台消息公告後才能啟用");
    }
    const announcement = await getValidNewsAnnouncementById(effectiveAnnouncementId);
    if (!announcement) {
      throw new Error("綁定公告已失效，請重新綁定有效的平台消息公告後才能啟用");
    }
  }

  await db.update(loginPopups).set(data).where(eq(loginPopups.id, id));

  const { deactivatedIds } = data.isActive === true
    // 這則彈窗自己也可能被 enforce 判定為第 6 名以後而被停用（例如同時有 5 則
    // 已經啟用、時間又比較舊），這是預期行為：規則對所有彈窗一視同仁，不會
    // 因為是「剛剛這次更新」的就特別放行。
    ? await enforceMaxFiveActiveLoginPopups()
    : { deactivatedIds: [] as number[] };
  return { deactivatedIds };
}

export type LoginPopupToShowItem = {
  id: number;
  title: string;
  summary: string;
  announcementId: number;
  announcementTitle: string;
  updatedAt: Date;
};

/**
 * 共用查詢：目前有效且啟用中的登入彈窗，最多 MAX_ACTIVE_LOGIN_POPUPS 則。
 * 顯示條件只有：isActive=true、綁定公告存在且為平台消息；沒有時間區間
 * 判斷——啟用立即生效、停用立即停止顯示。不論訪客或會員都是同一份資料，
 * 差別只在於「今天是否已看過」這一層要不要檢查（見下方兩個呼叫端函式），
 * 避免維護兩份幾乎一樣的 SQL。
 */
async function getActiveLoginPopupsForDisplay(): Promise<LoginPopupToShowItem[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db.select({
    id: loginPopups.id,
    title: loginPopups.title,
    summary: loginPopups.summary,
    announcementId: loginPopups.announcementId,
    updatedAt: loginPopups.updatedAt,
    announcementTitle: announcements.title,
    announcementType: announcements.type,
  })
    .from(loginPopups)
    .innerJoin(announcements, eq(loginPopups.announcementId, announcements.id))
    .where(and(
      eq(loginPopups.isActive, true),
      eq(announcements.type, "news"),
    ))
    // 排序：1) 最新更新（updatedAt desc）2) updatedAt 相同時以 id desc 穩定排序。
    .orderBy(desc(loginPopups.updatedAt), desc(loginPopups.id))
    .limit(MAX_ACTIVE_LOGIN_POPUPS);

  return rows
    .filter((r): r is typeof r & { announcementId: number } => r.announcementId != null) // 理論上 inner join 已保證非 null，這裡再防一層
    .map(r => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      announcementId: r.announcementId,
      announcementTitle: r.announcementTitle,
      updatedAt: r.updatedAt,
    }));
}

/**
 * 未登入訪客版本：不查詢、也不建立任何觀看紀錄（不使用 cookie／localStorage／
 * IP／裝置識別等替代身分），每次進首頁或重新整理都直接回傳目前有效啟用的
 * 消息——訪客沒有「今天是否看過」這個狀態可言。
 */
export async function getLoginPopupsToShowForGuest(): Promise<LoginPopupToShowItem[]> {
  return getActiveLoginPopupsForDisplay();
}

/**
 * 已登入會員版本：以 userId + 台灣時間日期判斷今天是否已完成顯示過，是的話
 * 回傳空陣列；否則回傳目前有效啟用的消息（與訪客版本共用同一份查詢）。
 */
export async function getLoginPopupsToShowForUser(userId: number): Promise<LoginPopupToShowItem[]> {
  const db = await getDb();
  if (!db) return [];

  const today = twDateStr();

  // 今天已經看過（點過「我知道了」或任一「進入完整公告」）就不再顯示，
  // 判定基準是 userId + 台灣時間日期，與裝置/瀏覽器/cookie/localStorage 無關。
  const [alreadyViewed] = await db.select({ id: loginPopupViews.id })
    .from(loginPopupViews)
    .where(and(eq(loginPopupViews.userId, userId), eq(loginPopupViews.date, today)))
    .limit(1);
  if (alreadyViewed) return [];

  return getActiveLoginPopupsForDisplay();
}

/**
 * 使用者點擊「我知道了」或「點擊進入完整公告」後，由後端寫入今天已完成顯示。
 * 用 INSERT IGNORE + (userId, date) 唯一索引達成 idempotent：重複點擊、網路重試
 * 都不會產生重複紀錄或拋錯。
 */
export async function markLoginPopupViewed(userId: number, loginPopupId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const today = twDateStr();
  await db.execute(sql`INSERT IGNORE INTO loginPopupViews (userId, date, loginPopupId) VALUES (${userId}, ${today}, ${loginPopupId})`);
}

// ===== 共同管理者 =====

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? null;
}

export async function hasPendingInvitation(factoryId: number, inviteeUserId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: factoryCoManagerInvitations.id })
    .from(factoryCoManagerInvitations)
    .where(and(
      eq(factoryCoManagerInvitations.factoryId, factoryId),
      eq(factoryCoManagerInvitations.inviteeUserId, inviteeUserId),
      eq(factoryCoManagerInvitations.status, "pending"),
      sql`${factoryCoManagerInvitations.expiresAt} > NOW()`
    ))
    .limit(1);
  return result.length > 0;
}

export async function isActiveCoManager(factoryId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: factoryCoManagers.id })
    .from(factoryCoManagers)
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      eq(factoryCoManagers.userId, userId),
      isNull(factoryCoManagers.removedAt)
    ))
    .limit(1);
  return result.length > 0;
}

export async function getActiveCoManagerCount(factoryId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`COUNT(*)` })
    .from(factoryCoManagers)
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ));
  return result[0]?.count ?? 0;
}

export async function createCoManagerInvitation(data: {
  factoryId: number;
  inviterUserId: number;
  inviteeUserId: number;
  conversationId: number;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(factoryCoManagerInvitations).values({
    ...data,
    status: "pending",
  });
  return result[0].insertId;
}

export async function linkInvitationToMessage(invitationId: number, messageId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(messages).set({ invitationId }).where(eq(messages.id, messageId));
}

export async function getInvitationById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(factoryCoManagerInvitations)
    .where(eq(factoryCoManagerInvitations.id, id))
    .limit(1);
  return result[0] ?? null;
}

// 查詢使用者當前有效的工廠身分（owner 或 active co-manager）
// 若意外發現多重身分，記錄錯誤並拋出例外，不靜默取第一筆
// conn 參數用於在 transaction 內部呼叫（已持有鎖時不另開連線）
export async function getActiveFactoryAffiliation(
  userId: number,
  conn?: mysql.PoolConnection
): Promise<{ factoryId: number; role: "owner" | "co_manager" } | null> {
  let ownerRows: { id: number }[];
  let coManagerRows: { factoryId: number }[];

  if (conn) {
    const [oRows]: any = await conn.execute(
      "SELECT id FROM factories WHERE ownerId = ?",
      [userId]
    );
    const [cRows]: any = await conn.execute(
      "SELECT factoryId FROM factoryCoManagers WHERE userId = ? AND removedAt IS NULL",
      [userId]
    );
    ownerRows = oRows as { id: number }[];
    coManagerRows = cRows as { factoryId: number }[];
  } else {
    const db = await getDb();
    if (!db) return null;
    ownerRows = await db.select({ id: factories.id })
      .from(factories)
      .where(eq(factories.ownerId, userId));
    coManagerRows = await db.select({ factoryId: factoryCoManagers.factoryId })
      .from(factoryCoManagers)
      .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt)));
  }

  const isOwner = ownerRows.length > 0;
  const isCoManager = coManagerRows.length > 0;

  if (isOwner && isCoManager) {
    console.error(
      `[getActiveFactoryAffiliation] Data integrity violation: userId ${userId} is simultaneously owner (factoryId ${ownerRows[0].id}) and co-manager (factoryId ${coManagerRows[0].factoryId})`
    );
    throw new Error("帳號資料異常：同時身兼工廠負責人與共同管理者，請聯繫客服");
  }

  if (isOwner) {
    if (ownerRows.length > 1) {
      console.error(
        `[getActiveFactoryAffiliation] Data integrity violation: userId ${userId} owns ${ownerRows.length} factories`
      );
      throw new Error("帳號資料異常：同時擁有多間工廠，請聯繫客服");
    }
    return { factoryId: ownerRows[0].id, role: "owner" };
  }

  if (isCoManager) {
    if (coManagerRows.length > 1) {
      console.error(
        `[getActiveFactoryAffiliation] Data integrity violation: userId ${userId} is active co-manager of ${coManagerRows.length} factories`
      );
      throw new Error("帳號資料異常：同時身兼多間工廠的共同管理者，請聯繫客服");
    }
    return { factoryId: coManagerRows[0].factoryId, role: "co_manager" };
  }

  return null;
}

// 批次取得多個 userId 的工廠身分（含工廠名稱與狀態），最多兩次批次查詢，避免 N+1。
export async function getActiveFactoryAffiliationsByUserIds(
  userIds: number[]
): Promise<Map<number, { factoryId: number; factoryName: string; role: "owner" | "co_manager"; factoryStatus: string }>> {
  if (userIds.length === 0) return new Map();
  const db = await getDb();
  if (!db) return new Map();

  const uniqueIds = Array.from(new Set(userIds));
  const result = new Map<number, { factoryId: number; factoryName: string; role: "owner" | "co_manager"; factoryStatus: string }>();

  // Query 1: approved 工廠 owner（非 approved 不算有效公開身分）
  const ownerRows = await db
    .select({ ownerUserId: factories.ownerId, factoryId: factories.id, factoryName: factories.name, factoryStatus: factories.status })
    .from(factories)
    .where(and(inArray(factories.ownerId, uniqueIds), eq(factories.status, "approved")));

  // Query 2: approved 工廠 active co-manager（removedAt IS NULL + status approved）
  const coMgrRows = await db
    .select({ userId: factoryCoManagers.userId, factoryId: factoryCoManagers.factoryId, factoryName: factories.name, factoryStatus: factories.status })
    .from(factoryCoManagers)
    .innerJoin(factories, eq(factoryCoManagers.factoryId, factories.id))
    .where(and(inArray(factoryCoManagers.userId, uniqueIds), isNull(factoryCoManagers.removedAt), eq(factories.status, "approved")));

  const ownerMap = new Map<number, typeof ownerRows[0]>();
  for (const row of ownerRows) {
    const uid = row.ownerUserId as number;
    if (ownerMap.has(uid)) {
      console.error(`[getActiveFactoryAffiliationsByUserIds] userId ${uid} owns multiple factories`);
      throw new Error("帳號資料異常：同時擁有多間工廠，請聯繫客服");
    }
    ownerMap.set(uid, row);
  }

  const coMgrMap = new Map<number, typeof coMgrRows[0]>();
  for (const row of coMgrRows) {
    if (coMgrMap.has(row.userId)) {
      console.error(`[getActiveFactoryAffiliationsByUserIds] userId ${row.userId} is active co-manager of multiple factories`);
      throw new Error("帳號資料異常：同時身兼多間工廠的共同管理者，請聯繫客服");
    }
    coMgrMap.set(row.userId, row);
  }

  for (const userId of uniqueIds) {
    const ownerEntry = ownerMap.get(userId);
    const coMgrEntry = coMgrMap.get(userId);
    if (ownerEntry && coMgrEntry) {
      console.error(`[getActiveFactoryAffiliationsByUserIds] userId ${userId} is simultaneously owner and co-manager`);
      throw new Error("帳號資料異常：同時身兼工廠負責人與共同管理者，請聯繫客服");
    }
    if (ownerEntry) {
      result.set(userId, { factoryId: ownerEntry.factoryId, factoryName: ownerEntry.factoryName, role: "owner", factoryStatus: ownerEntry.factoryStatus });
    } else if (coMgrEntry) {
      result.set(userId, { factoryId: coMgrEntry.factoryId, factoryName: coMgrEntry.factoryName, role: "co_manager", factoryStatus: coMgrEntry.factoryStatus });
    }
  }

  return result;
}

// 取得單一 userId 的工廠身分詳情（含名稱與狀態），委派給批次 helper 避免重複邏輯。
export async function getActiveFactoryAffiliationDetail(
  userId: number
): Promise<{ factoryId: number; factoryName: string; factoryStatus: string; role: "owner" | "co_manager" } | null> {
  const map = await getActiveFactoryAffiliationsByUserIds([userId]);
  return map.get(userId) ?? null;
}

// 在 transaction 內建立工廠，以 users row lock 防止並發競態
// 同時承擔 router 層的唯一性檢查責任，不再依賴外層非 atomic 的 check-then-insert
export async function createFactoryAtomic(
  userId: number,
  data: Omit<InsertFactory, "id" | "createdAt" | "updatedAt" | "avgRating" | "reviewCount" | "ownerId" | "status">
): Promise<number> {
  await getDb();
  const pool = _pool;
  if (!pool) throw new Error("DB not available");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 鎖定 users row，與 acceptInvitation 使用相同鎖序
    // 保證「建立工廠」與「接受邀請」兩條路徑不能同時為同一個 userId 建立工廠身分
    const [userLock]: any = await conn.execute(
      "SELECT id FROM users WHERE id = ? FOR UPDATE",
      [userId]
    );
    if (!userLock || userLock.length === 0) {
      throw new Error("使用者不存在");
    }

    // 跨廠唯一性：已擁有任何工廠？
    const [ownerRows]: any = await conn.execute(
      "SELECT id FROM factories WHERE ownerId = ? LIMIT 1",
      [userId]
    );
    if (ownerRows && ownerRows.length > 0) {
      throw new Error("您已擁有工廠，無法再次建立工廠");
    }

    // 跨廠唯一性：已是任何工廠的 active co-manager？
    const [coMgrRows]: any = await conn.execute(
      "SELECT id FROM factoryCoManagers WHERE userId = ? AND removedAt IS NULL LIMIT 1",
      [userId]
    );
    if (coMgrRows && coMgrRows.length > 0) {
      throw new Error("您已隸屬其他工廠，無法建立新的工廠");
    }

    const toArray = (v: unknown): string[] => {
      if (Array.isArray(v)) return v as string[];
      if (typeof v === "string" && v) return [v];
      return [];
    };
    const industry = toArray((data as any).industry);
    const mfgModes = toArray((data as any).mfgModes);
    const subIndustry = Array.isArray((data as any).subIndustry) ? (data as any).subIndustry : [];
    const rawAvatar = (data as any).avatarUrl as string | null | undefined;
    const avatarUrl = rawAvatar && /^https?:\/\//.test(rawAvatar) ? rawAvatar : null;

    const [insertResult]: any = await conn.execute(
      `INSERT INTO factories (
        ownerId, name, industry, mfgModes, region, description, capitalLevel, address,
        foundedYear, avatarUrl, businessType, ownerName, contactPersonName, phone, website,
        contactEmail, subIndustry, status, operationStatus, certified, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'normal', FALSE, NOW(), NOW())`,
      [
        userId,
        data.name,
        JSON.stringify(industry),
        JSON.stringify(mfgModes),
        data.region,
        (data as any).description ?? null,
        data.capitalLevel,
        data.address,
        (data as any).foundedYear ?? null,
        avatarUrl,
        (data as any).businessType ?? "factory",
        (data as any).ownerName ?? null,
        (data as any).contactPersonName ?? null,
        (data as any).phone ?? null,
        (data as any).website ?? null,
        (data as any).contactEmail ?? null,
        JSON.stringify(subIndustry),
      ]
    );

    const factoryId = insertResult.insertId;

    await conn.execute(
      "UPDATE users SET isFactoryOwner = TRUE WHERE id = ?",
      [userId]
    );

    await conn.commit();
    return factoryId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function acceptInvitation(invitationId: number, inviteeUserId: number): Promise<void> {
  await getDb(); // 確保 _pool 已初始化
  const pool = _pool;
  if (!pool) throw new Error("DB not available");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 鎖住這筆邀請，防止競態
    const [rows]: any = await conn.execute(
      "SELECT * FROM factoryCoManagerInvitations WHERE id = ? AND status = 'pending' AND expiresAt > NOW() FOR UPDATE",
      [invitationId]
    );
    if (!rows || rows.length === 0) {
      throw new Error("邀請不存在、已處理或已過期");
    }
    const inv = rows[0];
    if (inv.inviteeUserId !== inviteeUserId) {
      throw new Error("無權限操作此邀請");
    }

    // 鎖定被邀請人的 users row，與 createFactoryAtomic 使用相同鎖序
    // 保證兩間不同工廠同時發送邀請，最多只能有一筆接受成功
    const [userLock]: any = await conn.execute(
      "SELECT id FROM users WHERE id = ? FOR UPDATE",
      [inviteeUserId]
    );
    if (!userLock || userLock.length === 0) {
      throw new Error("使用者不存在");
    }

    // 跨廠唯一性：已擁有任何工廠？
    const [ownerRows]: any = await conn.execute(
      "SELECT id FROM factories WHERE ownerId = ? LIMIT 1",
      [inviteeUserId]
    );
    if (ownerRows && ownerRows.length > 0) {
      throw new Error("您已擁有或管理其他工廠，無法加入此工廠");
    }

    // 跨廠唯一性：已是任何工廠的 active co-manager？
    // 區分「同一工廠」和「其他工廠」，給出不同訊息
    const [coMgrAny]: any = await conn.execute(
      "SELECT factoryId FROM factoryCoManagers WHERE userId = ? AND removedAt IS NULL LIMIT 1",
      [inviteeUserId]
    );
    if (coMgrAny && coMgrAny.length > 0) {
      if (Number(coMgrAny[0].factoryId) === Number(inv.factoryId)) {
        throw new Error("您已是此工廠的次管理者");
      }
      throw new Error("您已擁有或管理其他工廠，無法加入此工廠");
    }

    // 檢查人數上限
    const [countRows]: any = await conn.execute(
      "SELECT COUNT(*) as cnt FROM factoryCoManagers WHERE factoryId = ? AND removedAt IS NULL",
      [inv.factoryId]
    );
    if (countRows[0].cnt >= 6) {
      throw new Error("此工廠次管理者已達 6 人上限");
    }

    // 寫入 co-manager
    await conn.execute(
      "INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, createdAt) VALUES (?, ?, ?, NOW())",
      [inv.factoryId, inviteeUserId, inv.inviterUserId]
    );

    // 更新邀請狀態
    await conn.execute(
      "UPDATE factoryCoManagerInvitations SET status = 'accepted', respondedAt = NOW() WHERE id = ?",
      [invitationId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function declineInvitation(invitationId: number, inviteeUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const inv = await getInvitationById(invitationId);
  if (!inv || inv.status !== "pending") throw new Error("邀請不存在或已處理");
  if (inv.inviteeUserId !== inviteeUserId) throw new Error("無權限操作此邀請");
  await db.update(factoryCoManagerInvitations)
    .set({ status: "declined", respondedAt: new Date() })
    .where(eq(factoryCoManagerInvitations.id, invitationId));
}

export async function getCoManagersByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: factoryCoManagers.id,
    userId: factoryCoManagers.userId,
    invitedBy: factoryCoManagers.invitedBy,
    createdAt: factoryCoManagers.createdAt,
    name: users.name,
    email: users.email,
  })
    .from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ))
    .orderBy(asc(factoryCoManagers.createdAt));
}

export async function getFactoryCoManagerEmails(factoryId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ email: users.email })
    .from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ));
  return rows.map(r => r.email).filter((e): e is string => typeof e === 'string' && e.length > 0);
}

export async function getFactoryCoManagersWithPreferences(factoryId: number): Promise<{ email: string; notificationSettings: Record<string, boolean> | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    email: users.email,
    notificationSettings: users.notificationSettings,
  })
    .from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ));
  return rows.filter(r => typeof r.email === 'string' && r.email.length > 0) as { email: string; notificationSettings: Record<string, boolean> | null }[];
}

export async function getFactoryCoManagersFullProfile(factoryId: number): Promise<{ userId: number; email: string; name: string | null; notificationSettings: Record<string, boolean> | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    userId: factoryCoManagers.userId,
    email: users.email,
    name: users.name,
    notificationSettings: users.notificationSettings,
  })
    .from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ));
  return rows.filter(r => typeof r.email === 'string' && r.email.length > 0) as { userId: number; email: string; name: string | null; notificationSettings: Record<string, boolean> | null }[];
}

export async function getFactoryCoManagerUserIdsWithPreferences(factoryId: number): Promise<{ userId: number; notificationSettings: Record<string, boolean> | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    userId: factoryCoManagers.userId,
    notificationSettings: users.notificationSettings,
  })
    .from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt)
    ));
  return rows as { userId: number; notificationSettings: Record<string, boolean> | null }[];
}

export async function getPendingInvitationsByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: factoryCoManagerInvitations.id,
    inviteeUserId: factoryCoManagerInvitations.inviteeUserId,
    expiresAt: factoryCoManagerInvitations.expiresAt,
    createdAt: factoryCoManagerInvitations.createdAt,
    name: users.name,
    email: users.email,
  })
    .from(factoryCoManagerInvitations)
    .innerJoin(users, eq(factoryCoManagerInvitations.inviteeUserId, users.id))
    .where(and(
      eq(factoryCoManagerInvitations.factoryId, factoryId),
      eq(factoryCoManagerInvitations.status, "pending"),
      sql`${factoryCoManagerInvitations.expiresAt} > NOW()`
    ))
    .orderBy(desc(factoryCoManagerInvitations.createdAt));
}

export async function removeCoManager(factoryId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(factoryCoManagers)
    .set({ removedAt: new Date() })
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      eq(factoryCoManagers.userId, userId),
      isNull(factoryCoManagers.removedAt)
    ));
}

export async function getCoManagedFactories(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    factoryId: factoryCoManagers.factoryId,
    name: factories.name,
    region: factories.region,
    contactEmail: factories.contactEmail,
    phone: factories.phone,
    contactPersonName: factories.contactPersonName,
    capitalLevel: factories.capitalLevel,
    industry: factories.industry,
    status: factories.status,
  })
    .from(factoryCoManagers)
    .innerJoin(factories, eq(factoryCoManagers.factoryId, factories.id))
    .where(and(
      eq(factoryCoManagers.userId, userId),
      isNull(factoryCoManagers.removedAt)
    ));
}

// ===== 一鍵詢價 =====

export async function createInquiryBatch(userId: number, title: string, message: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(inquiryBatches).values({ userId, title, message });
  return result[0].insertId as number;
}

export async function createInquiryBatchItem(batchId: number, factoryId: number, conversationId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(inquiryBatchItems).values({ batchId, factoryId, conversationId });
}

export async function getInquiryBatchesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const batches = await db.select().from(inquiryBatches)
    .where(eq(inquiryBatches.userId, userId))
    .orderBy(desc(inquiryBatches.createdAt));
  if (batches.length === 0) return [];

  const batchIds = batches.map(b => b.id);
  const items = await db.select().from(inquiryBatchItems).where(inArray(inquiryBatchItems.batchId, batchIds));

  const itemCountMap = new Map<number, number>();
  const convIdsByBatch = new Map<number, number[]>();
  for (const item of items) {
    itemCountMap.set(item.batchId, (itemCountMap.get(item.batchId) ?? 0) + 1);
    if (item.conversationId != null) {
      const arr = convIdsByBatch.get(item.batchId) ?? [];
      arr.push(item.conversationId);
      convIdsByBatch.set(item.batchId, arr);
    }
  }

  const allConvIds = items.map(i => i.conversationId).filter((id): id is number => id != null);
  const lastMsgAtMap = new Map<number, Date>();
  if (allConvIds.length > 0) {
    const convRows = await db.select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt })
      .from(conversations).where(inArray(conversations.id, allConvIds));
    for (const conv of convRows) lastMsgAtMap.set(conv.id, conv.lastMessageAt);
  }

  return batches.map(batch => {
    const batchConvIds = convIdsByBatch.get(batch.id) ?? [];
    let latestMessageAt: Date | null = null;
    for (const cid of batchConvIds) {
      const at = lastMsgAtMap.get(cid);
      if (at && (!latestMessageAt || at > latestMessageAt)) latestMessageAt = at;
    }
    return {
      id: batch.id,
      title: batch.title,
      message: batch.message,
      createdAt: batch.createdAt,
      itemCount: itemCountMap.get(batch.id) ?? 0,
      latestMessageAt,
    };
  });
}

export async function getInquiryBatchDetail(batchId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [batch] = await db.select().from(inquiryBatches)
    .where(and(eq(inquiryBatches.id, batchId), eq(inquiryBatches.userId, userId))).limit(1);
  if (!batch) return null;

  const items = await db.select().from(inquiryBatchItems).where(eq(inquiryBatchItems.batchId, batchId));
  if (items.length === 0) return { ...batch, items: [] as any[] };

  const factoryIds = items.map(i => i.factoryId);
  const convIds = items.map(i => i.conversationId).filter((id): id is number => id != null);

  const factoryList = await db.select({ id: factories.id, name: factories.name, avatarUrl: factories.avatarUrl, businessType: factories.businessType })
    .from(factories).where(inArray(factories.id, factoryIds));
  const factoryMap = new Map(factoryList.map(f => [f.id, f]));

  const lastMsgMap = new Map<number, string>();
  const lastMsgAtMap2 = new Map<number, Date>();
  const unreadMap = new Map<number, number>();

  if (convIds.length > 0) {
    const lastMsgRows = await db.select({
      conversationId: messages.conversationId,
      content: messages.content,
      createdAt: messages.createdAt,
    }).from(messages).where(inArray(messages.conversationId, convIds)).orderBy(desc(messages.createdAt));
    for (const row of lastMsgRows) {
      if (!lastMsgMap.has(row.conversationId)) {
        lastMsgMap.set(row.conversationId, row.content.substring(0, 60));
        lastMsgAtMap2.set(row.conversationId, row.createdAt);
      }
    }

    const unreadRows = await db.select({ conversationId: messages.conversationId })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, convIds),
        sql`${messages.senderId} != ${userId}`,
        eq(messages.isRead, false)
      ));
    for (const row of unreadRows) {
      unreadMap.set(row.conversationId, (unreadMap.get(row.conversationId) ?? 0) + 1);
    }
  }

  return {
    id: batch.id,
    title: batch.title,
    message: batch.message,
    createdAt: batch.createdAt,
    items: items.map(item => ({
      id: item.id,
      factoryId: item.factoryId,
      factoryName: factoryMap.get(item.factoryId)?.name ?? '未知工廠',
      factoryAvatarUrl: factoryMap.get(item.factoryId)?.avatarUrl ?? null,
      factoryBusinessType: factoryMap.get(item.factoryId)?.businessType ?? 'factory',
      conversationId: item.conversationId,
      lastMessage: item.conversationId ? (lastMsgMap.get(item.conversationId) ?? null) : null,
      lastMessageAt: item.conversationId ? (lastMsgAtMap2.get(item.conversationId) ?? null) : null,
      unreadCount: item.conversationId ? (unreadMap.get(item.conversationId) ?? 0) : 0,
    })),
  };
}

export async function updateInquiryBatchTitle(batchId: number, userId: number, title: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(inquiryBatches).set({ title })
    .where(and(eq(inquiryBatches.id, batchId), eq(inquiryBatches.userId, userId)));
}

export async function getInquiryBatchConversationIdsByUser(userId: number): Promise<Set<number>> {
  try {
    const db = await getDb();
    if (!db) return new Set();

    const batches = await db.select({ id: inquiryBatches.id }).from(inquiryBatches)
      .where(eq(inquiryBatches.userId, userId));
    if (batches.length === 0) return new Set();

    const batchIds = batches.map(b => b.id);
    const items = await db.select({ conversationId: inquiryBatchItems.conversationId })
      .from(inquiryBatchItems).where(inArray(inquiryBatchItems.batchId, batchIds));

    return new Set(items.map(i => i.conversationId).filter((id): id is number => id != null));
  } catch {
    // 資料表尚未建立時 fallback，不影響一般訊息顯示
    return new Set();
  }
}

export async function sendCoManagerInviteMessage(
  conversationId: number,
  senderId: number,
  content: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(messages).values({
    conversationId,
    senderId,
    senderRole: "factory",
    content,
    type: "co_manager_invite",
    isRead: false,
  });
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
  return result[0].insertId;
}

// ===== 站內信 (Admin Messages) =====

export async function createMessageCampaign(data: {
  title: string;
  content: string;
  senderId: number;
  targetType: "all_users" | "all_factory_managers" | "single";
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(messageCampaigns).values(data);
  return result[0].insertId;
}

export async function createMessageRecipients(campaignId: number, receiverIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (receiverIds.length === 0) return;
  // Pre-filter: skip already-existing recipients to avoid duplicate key errors
  const existing = await db
    .select({ receiverId: messageRecipients.receiverId })
    .from(messageRecipients)
    .where(eq(messageRecipients.campaignId, campaignId));
  const existingSet = new Set(existing.map(r => r.receiverId));
  const newIds = receiverIds.filter(id => !existingSet.has(id));
  if (newIds.length === 0) return;
  for (let i = 0; i < newIds.length; i += 500) {
    const batch = newIds.slice(i, i + 500);
    await db.insert(messageRecipients).values(batch.map(receiverId => ({ campaignId, receiverId })));
  }
}

export async function getAllActiveUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users).where(isNull(users.deletedAt));
  return rows.map(r => r.id);
}

export async function getActiveUsersForAnnouncement(): Promise<{ id: number; email: string | null; name: string | null; notificationSettings: Record<string, boolean> | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: users.id, email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})`, name: users.name, notificationSettings: users.notificationSettings })
    .from(users)
    .where(isNull(users.deletedAt));
}

export async function getFactoryManagerIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const owners = await db.selectDistinct({ id: factories.ownerId }).from(factories);
  const coMgrs = await db.selectDistinct({ id: factoryCoManagers.userId })
    .from(factoryCoManagers)
    .where(isNull(factoryCoManagers.removedAt));
  const ids = new Set([...owners.map(r => r.id), ...coMgrs.map(r => r.id)]);
  return Array.from(ids);
}

export async function getAdminMessagesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      campaignId: messageCampaigns.id,
      title: messageCampaigns.title,
      content: messageCampaigns.content,
      createdAt: messageCampaigns.createdAt,
      isRead: messageRecipients.isRead,
    })
    .from(messageRecipients)
    .innerJoin(messageCampaigns, eq(messageRecipients.campaignId, messageCampaigns.id))
    .where(and(eq(messageRecipients.receiverId, userId), isNull(messageCampaigns.deletedAt)))
    .orderBy(desc(messageCampaigns.createdAt));
}

export async function getUnreadAdminMessageCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(messageRecipients)
    .innerJoin(messageCampaigns, eq(messageRecipients.campaignId, messageCampaigns.id))
    .where(and(
      eq(messageRecipients.receiverId, userId),
      eq(messageRecipients.isRead, false),
      isNull(messageCampaigns.deletedAt),
    ));
  return Number(result?.count ?? 0);
}

export async function retractAdminMessageCampaign(campaignId: number, deletedById: number, reason: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(messageCampaigns)
    .set({ deletedAt: new Date(), deletedById, deleteReason: reason || null })
    .where(and(eq(messageCampaigns.id, campaignId), isNull(messageCampaigns.deletedAt)));
}

export async function markAdminMessageAsRead(campaignId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(messageRecipients)
    .set({ isRead: true })
    .where(and(eq(messageRecipients.campaignId, campaignId), eq(messageRecipients.receiverId, userId)));
}

export async function getRecipientsWithEmails(campaignId: number): Promise<{ userId: number; email: string | null; name: string | null; notificationSettings: Record<string, boolean> | null }[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ userId: users.id, email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})`, name: users.name, notificationSettings: users.notificationSettings })
    .from(messageRecipients)
    .innerJoin(users, eq(messageRecipients.receiverId, users.id))
    .where(and(eq(messageRecipients.campaignId, campaignId), isNull(users.deletedAt)));
}

export async function getMessageCampaignById(campaignId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const recipient = await db.select().from(messageRecipients)
    .where(and(eq(messageRecipients.campaignId, campaignId), eq(messageRecipients.receiverId, userId)))
    .limit(1);
  if (recipient.length === 0) return null;
  const rows = await db.select().from(messageCampaigns)
    .where(and(eq(messageCampaigns.id, campaignId), isNull(messageCampaigns.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAdminMessageCampaigns(page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const offset = (page - 1) * pageSize;
  const items = await db
    .select({
      id: messageCampaigns.id,
      title: messageCampaigns.title,
      targetType: messageCampaigns.targetType,
      createdAt: messageCampaigns.createdAt,
      deletedAt: messageCampaigns.deletedAt,
      deleteReason: messageCampaigns.deleteReason,
      recipientCount: sql<number>`COUNT(${messageRecipients.id})`,
    })
    .from(messageCampaigns)
    .leftJoin(messageRecipients, eq(messageRecipients.campaignId, messageCampaigns.id))
    .groupBy(messageCampaigns.id)
    .orderBy(desc(messageCampaigns.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(messageCampaigns);
  return { items, total: Number(countRow?.count ?? 0) };
}

export async function searchUsersForMessage(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const pattern = `%${query}%`;
  return db
    .select({ id: users.id, name: users.name, email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})` })
    .from(users)
    .where(and(isNull(users.deletedAt), or(like(users.name, pattern), like(users.email, pattern), like(users.primaryEmail, pattern))))
    .limit(limit);
}

// ===== 站內信回覆 =====

export async function createMessageReply(data: {
  campaignId: number;
  userId: number;
  content: string;
  senderRole: "user" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(messageReplies).values(data);
  return result[0].insertId;
}

export async function getMessageThread(campaignId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messageReplies)
    .where(and(eq(messageReplies.campaignId, campaignId), eq(messageReplies.userId, userId)))
    .orderBy(asc(messageReplies.createdAt));
}

export async function getCampaignAllRecipients(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      userId: messageRecipients.receiverId,
      userName: users.name,
      userEmail: users.email,
      adminViewedAt: messageRecipients.adminViewedAt,
      latestReplyAt: sql<string | null>`MAX(${messageReplies.createdAt})`,
    })
    .from(messageRecipients)
    .innerJoin(users, eq(messageRecipients.receiverId, users.id))
    .leftJoin(
      messageReplies,
      and(
        eq(messageReplies.campaignId, messageRecipients.campaignId),
        eq(messageReplies.userId, messageRecipients.receiverId),
      ),
    )
    .where(eq(messageRecipients.campaignId, campaignId))
    .groupBy(messageRecipients.receiverId, users.name, users.email, messageRecipients.adminViewedAt)
    .orderBy(desc(sql`MAX(${messageReplies.createdAt})`), users.name);
}

export async function getCampaignReplyingUsers(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      userId: messageReplies.userId,
      userName: users.name,
      userEmail: users.email,
      latestReply: sql<string>`MAX(${messageReplies.createdAt})`,
      replyCount: sql<number>`COUNT(*)`,
    })
    .from(messageReplies)
    .innerJoin(users, eq(messageReplies.userId, users.id))
    .where(eq(messageReplies.campaignId, campaignId))
    .groupBy(messageReplies.userId, users.name, users.email)
    .orderBy(desc(sql`MAX(${messageReplies.createdAt})`));
  return rows;
}

export async function getAdminMessageCampaignById(campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      id: messageCampaigns.id,
      title: messageCampaigns.title,
      content: messageCampaigns.content,
      targetType: messageCampaigns.targetType,
      createdAt: messageCampaigns.createdAt,
      deletedAt: messageCampaigns.deletedAt,
      deleteReason: messageCampaigns.deleteReason,
      recipientCount: sql<number>`COUNT(${messageRecipients.id})`,
    })
    .from(messageCampaigns)
    .leftJoin(messageRecipients, eq(messageRecipients.campaignId, messageCampaigns.id))
    .where(eq(messageCampaigns.id, campaignId))
    .groupBy(messageCampaigns.id)
    .limit(1);
  return rows[0] ?? null;
}

export async function getCampaignReplyCounts(campaignIds: number[]): Promise<Record<number, number>> {
  const db = await getDb();
  if (!db || campaignIds.length === 0) return {};
  const rows = await db
    .select({
      campaignId: messageReplies.campaignId,
      count: sql<number>`COUNT(DISTINCT ${messageReplies.userId})`,
    })
    .from(messageReplies)
    .where(inArray(messageReplies.campaignId, campaignIds))
    .groupBy(messageReplies.campaignId);
  return Object.fromEntries(rows.map(r => [r.campaignId, Number(r.count)]));
}

// ===== OAuth State (DB-based CSRF) =====

export async function createOauthState(params: {
  state: string;
  redirectTo?: string;
  source?: string;
  provider?: string;
  userAgent?: string;
  ip?: string;
}): Promise<void> {
  const now = new Date();
  const values = {
    state: params.state,
    redirectTo: params.redirectTo ?? null,
    source: params.source ?? null,
    provider: params.provider ?? "google",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    usedAt: null,
    userAgent: params.userAgent ?? null,
    ip: params.ip ?? null,
  };

  const doInsert = async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available when creating OAuth state");
    await db.insert(oauthStates).values(values);
  };

  try {
    await doInsert();
  } catch (err) {
    if (isRetryableDbError(err)) {
      console.error("[OAuth] Retrying state creation after DB connection error", { code: (err as { code?: string }).code });
      resetDbPool();
      await doInsert();
    } else {
      throw err;
    }
  }
}

export async function consumeOauthState(state: string): Promise<{ valid: boolean; redirectTo?: string | null; source?: string | null; provider?: string | null }> {
  const db = await getDb();
  if (!db) return { valid: false };
  const now = new Date();

  const rows = await db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.state, state))
    .limit(1);

  const row = rows[0];
  if (!row) return { valid: false };
  if (row.usedAt !== null) return { valid: false };
  if (row.expiresAt < now) return { valid: false };

  await db
    .update(oauthStates)
    .set({ usedAt: now })
    .where(eq(oauthStates.state, state));

  return { valid: true, redirectTo: row.redirectTo, source: row.source, provider: row.provider };
}

// ===== Multi-provider Auth =====

export async function getUserByAuthAccount(provider: string, providerAccountId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({ user: users })
    .from(userAuthAccounts)
    .innerJoin(users, eq(userAuthAccounts.userId, users.id))
    .where(and(
      eq(userAuthAccounts.provider, provider),
      eq(userAuthAccounts.providerAccountId, providerAccountId),
    ))
    .limit(1);
  return rows[0]?.user;
}

export async function getUserByPrimaryEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(users)
    .where(and(
      eq(users.primaryEmail, email),
      sql`${users.primaryEmailVerifiedAt} IS NOT NULL`,
    ))
    .limit(1);
  return rows[0];
}

export async function upsertUserAuthAccount(params: {
  userId: number;
  provider: string;
  providerAccountId: string;
  providerEmail?: string | null;
  providerEmailVerified?: boolean;
  displayName?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(userAuthAccounts)
    .values({
      userId: params.userId,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      providerEmail: params.providerEmail ?? null,
      providerEmailVerified: params.providerEmailVerified ?? false,
      displayName: params.displayName ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        providerEmail: params.providerEmail ?? null,
        providerEmailVerified: params.providerEmailVerified ?? false,
        displayName: params.displayName ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function setPrimaryEmail(userId: number, email: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ primaryEmail: email, primaryEmailVerifiedAt: null })
    .where(eq(users.id, userId));
}

export async function setPrimaryEmailVerified(userId: number, email: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ primaryEmail: email, primaryEmailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getAuthAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userAuthAccounts).where(eq(userAuthAccounts.userId, userId));
}

export async function getAuthAccountByProviderForUser(userId: number, provider: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(userAuthAccounts)
    .where(and(eq(userAuthAccounts.userId, userId), eq(userAuthAccounts.provider, provider)))
    .limit(1);
  return rows[0];
}

export async function reassignAuthAccountToUser(authAccountId: number, toUserId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userAuthAccounts)
    .set({ userId: toUserId, updatedAt: new Date() })
    .where(eq(userAuthAccounts.id, authAccountId));
}

export async function clearPrimaryEmail(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ primaryEmail: null, primaryEmailVerifiedAt: null })
    .where(eq(users.id, userId));
}

export async function userHasImportantActivity(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [[f], [c], [r], [m]] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)` }).from(factories).where(eq(factories.ownerId, userId)),
    db.select({ n: sql<number>`COUNT(*)` }).from(conversations).where(eq(conversations.userId, userId)),
    db.select({ n: sql<number>`COUNT(*)` }).from(reviews).where(eq(reviews.userId, userId)),
    db.select({ n: sql<number>`COUNT(*)` }).from(factoryCoManagers).where(eq(factoryCoManagers.userId, userId)),
  ]);
  return Number(f?.n) > 0 || Number(c?.n) > 0 || Number(r?.n) > 0 || Number(m?.n) > 0;
}

export async function getLatestEmailVerificationToken(userId: number, email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select()
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.userId, userId),
      eq(emailVerificationTokens.email, email),
      sql`${emailVerificationTokens.usedAt} IS NULL`,
    ))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);
  return rows[0] ?? undefined;
}

export async function createEmailVerificationToken(params: {
  userId: number;
  tokenHash: string;
  email: string;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Invalidate prior unused tokens for same user+email
  await db
    .delete(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.userId, params.userId),
      eq(emailVerificationTokens.email, params.email),
      sql`${emailVerificationTokens.usedAt} IS NULL`,
    ));
  await db.insert(emailVerificationTokens).values({
    userId: params.userId,
    tokenHash: params.tokenHash,
    email: params.email,
    expiresAt: params.expiresAt,
    usedAt: null,
  });
}

export async function consumeEmailVerificationToken(tokenHash: string): Promise<{
  valid: boolean;
  userId?: number;
  email?: string;
}> {
  const db = await getDb();
  if (!db) return { valid: false };
  const now = new Date();
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.tokenHash, tokenHash),
      sql`${emailVerificationTokens.usedAt} IS NULL`,
      sql`${emailVerificationTokens.expiresAt} > ${now}`,
    ))
    .limit(1);
  const row = rows[0];
  if (!row) return { valid: false };
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(eq(emailVerificationTokens.id, row.id));
  return { valid: true, userId: row.userId, email: row.email };
}

export async function createAppLoginTicket(params: {
  ticket: string;
  userId: number;
  userAgent?: string;
  ip?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 分鐘有效
  await db.insert(appLoginTickets).values({
    ticket: params.ticket,
    userId: params.userId,
    createdAt: now,
    expiresAt,
    usedAt: null,
    userAgent: params.userAgent ?? null,
    ip: params.ip ?? null,
  });
}

export async function consumeAppLoginTicket(ticket: string): Promise<{ valid: boolean; userId?: number }> {
  const db = await getDb();
  if (!db) return { valid: false };
  const now = new Date();

  const rows = await db
    .select()
    .from(appLoginTickets)
    .where(eq(appLoginTickets.ticket, ticket))
    .limit(1);

  const row = rows[0];
  if (!row) return { valid: false };
  if (row.usedAt !== null) return { valid: false };
  if (row.expiresAt < now) return { valid: false };

  await db
    .update(appLoginTickets)
    .set({ usedAt: now })
    .where(eq(appLoginTickets.ticket, ticket));

  return { valid: true, userId: row.userId };
}

export async function purgeExpiredOauthStates(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(oauthStates)
    .where(sql`${oauthStates.expiresAt} < ${cutoff} OR (${oauthStates.usedAt} IS NOT NULL AND ${oauthStates.createdAt} < ${cutoff})`);
}

// ===== 後台通知 =====

export async function getAdminPendingNotifications(): Promise<{
  hasMessageReplies: boolean;
  hasSupportPending: boolean;
}> {
  const db = await getDb();
  if (!db) return { hasMessageReplies: false, hasSupportPending: false };

  try {
    // 找到任何 recipient：有 user reply，且 reply.createdAt > adminViewedAt（或 adminViewedAt IS NULL）
    const pendingReplies = await db
      .select({ x: sql<number>`1` })
      .from(messageRecipients)
      .where(sql`EXISTS (
        SELECT 1 FROM messageReplies mr
        WHERE mr.campaignId = ${messageRecipients.campaignId}
        AND mr.userId = ${messageRecipients.receiverId}
        AND mr.senderRole = 'user'
        AND (${messageRecipients.adminViewedAt} IS NULL OR mr.createdAt > ${messageRecipients.adminViewedAt})
      )`)
      .limit(1);

    const pendingSupport = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.status, "pending"))
      .limit(1);

    return {
      hasMessageReplies: pendingReplies.length > 0,
      hasSupportPending: pendingSupport.length > 0,
    };
  } catch (err) {
    console.error("[getAdminPendingNotifications] query error:", err);
    return { hasMessageReplies: false, hasSupportPending: false };
  }
}

export async function getCampaignsWithUnreadReplies(): Promise<{ campaignId: number; latestUnreadAt: string | null }[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return db
      .select({
        campaignId: messageRecipients.campaignId,
        latestUnreadAt: sql<string | null>`MAX(${messageReplies.createdAt})`,
      })
      .from(messageRecipients)
      .innerJoin(
        messageReplies,
        and(
          eq(messageReplies.campaignId, messageRecipients.campaignId),
          eq(messageReplies.userId, messageRecipients.receiverId),
          eq(messageReplies.senderRole, "user"),
        ),
      )
      .where(sql`(${messageRecipients.adminViewedAt} IS NULL OR ${messageReplies.createdAt} > ${messageRecipients.adminViewedAt})`)
      .groupBy(messageRecipients.campaignId);
  } catch (err) {
    console.error("[getCampaignsWithUnreadReplies] query error:", err);
    return [];
  }
}

export async function markCampaignRecipientViewed(campaignId: number, receiverId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(messageRecipients)
    .set({ adminViewedAt: new Date() })
    .where(
      and(
        eq(messageRecipients.campaignId, campaignId),
        eq(messageRecipients.receiverId, receiverId),
      ),
    );
}

// ===== 合作確認單 =====

export type CreateCollaborationOrderData = {
  conversationId: number;
  factoryId: number;
  buyerUserId: number;
  createdByUserId: number;
  productId?: number | null;
  projectName: string;
  description: string;
  depositDueDate?: string | null;
  productionStartDate?: string | null;
  expectedCompletionDate?: string | null;
  expectedShipmentDate?: string | null;
  finalPaymentDueDate?: string | null;
  note?: string | null;
};

export async function createCollaborationOrder(data: CreateCollaborationOrderData): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(collaborationOrders).values({
    conversationId: data.conversationId,
    factoryId: data.factoryId,
    buyerUserId: data.buyerUserId,
    createdByUserId: data.createdByUserId,
    productId: data.productId ?? null,
    projectName: data.projectName,
    description: data.description,
    depositDueDate: data.depositDueDate ?? null,
    productionStartDate: data.productionStartDate ?? null,
    expectedCompletionDate: data.expectedCompletionDate ?? null,
    expectedShipmentDate: data.expectedShipmentDate ?? null,
    finalPaymentDueDate: data.finalPaymentDueDate ?? null,
    note: data.note ?? null,
  });
  return (result as any)[0].insertId as number;
}

export async function getCollaborationOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(collaborationOrders).where(eq(collaborationOrders.id, id)).limit(1);
  return rows[0] ?? null;
}

// Phase 4A: 單筆訂單詳情（含 factory name / buyer name + email join）
export async function getCollaborationOrderDetail(id: number) {
  const db = await getDb();
  if (!db) return null;
  const buyerAlias = users;
  const rows = await db.select({
    id: collaborationOrders.id,
    conversationId: collaborationOrders.conversationId,
    factoryId: collaborationOrders.factoryId,
    factoryName: factories.name,
    buyerUserId: collaborationOrders.buyerUserId,
    buyerName: buyerAlias.name,
    buyerEmail: buyerAlias.email,
    createdByUserId: collaborationOrders.createdByUserId,
    productId: collaborationOrders.productId,
    projectName: collaborationOrders.projectName,
    description: collaborationOrders.description,
    note: collaborationOrders.note,
    depositDueDate: collaborationOrders.depositDueDate,
    productionStartDate: collaborationOrders.productionStartDate,
    expectedCompletionDate: collaborationOrders.expectedCompletionDate,
    expectedShipmentDate: collaborationOrders.expectedShipmentDate,
    finalPaymentDueDate: collaborationOrders.finalPaymentDueDate,
    status: collaborationOrders.status,
    currentStage: collaborationOrders.currentStage,
    acceptedAt: collaborationOrders.acceptedAt,
    rejectedAt: collaborationOrders.rejectedAt,
    completedAt: collaborationOrders.completedAt,
    completedByUserId: collaborationOrders.completedByUserId,
    completionNote: collaborationOrders.completionNote,
    cancelledAt: collaborationOrders.cancelledAt,
    cancelRequestedAt: collaborationOrders.cancelRequestedAt,
    cancelRequestReason: collaborationOrders.cancelRequestReason,
    cancelRequestedFromStatus: collaborationOrders.cancelRequestedFromStatus,
    acceptedAsType: collaborationOrders.acceptedAsType,
    acceptedAsFactoryId: collaborationOrders.acceptedAsFactoryId,
    acceptedByUserId: collaborationOrders.acceptedByUserId,
    earlyCompletedAt: collaborationOrders.earlyCompletedAt,
    earlyCompletedByUserId: collaborationOrders.earlyCompletedByUserId,
    earlyShippedAt: collaborationOrders.earlyShippedAt,
    earlyShippedByUserId: collaborationOrders.earlyShippedByUserId,
    createdAt: collaborationOrders.createdAt,
    updatedAt: collaborationOrders.updatedAt,
  }).from(collaborationOrders)
    .leftJoin(factories, eq(collaborationOrders.factoryId, factories.id))
    .leftJoin(buyerAlias, eq(collaborationOrders.buyerUserId, buyerAlias.id))
    .where(eq(collaborationOrders.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ===== Phase 4B: 訂單日期修改申請 =====

export async function createCollaborationOrderChangeRequest(data: {
  orderId: number;
  requestedByUserId: number;
  reason?: string | null;
  oldValues: Record<string, string | null>;
  newValues: Record<string, string | null>;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: collaborationOrderChangeRequests.id })
    .from(collaborationOrderChangeRequests)
    .where(and(
      eq(collaborationOrderChangeRequests.orderId, data.orderId),
      eq(collaborationOrderChangeRequests.status, "pending")
    )).limit(1);
  if (existing.length > 0) throw new Error("PENDING_EXISTS");
  await db.insert(collaborationOrderChangeRequests).values({
    orderId: data.orderId,
    requestedByUserId: data.requestedByUserId,
    reason: data.reason ?? null,
    oldValuesJson: data.oldValues,
    newValuesJson: data.newValues,
  });
}

export async function getCollaborationOrderChangeRequestById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(collaborationOrderChangeRequests)
    .where(eq(collaborationOrderChangeRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getPendingCollaborationOrderChangeRequest(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    id: collaborationOrderChangeRequests.id,
    orderId: collaborationOrderChangeRequests.orderId,
    requestedByUserId: collaborationOrderChangeRequests.requestedByUserId,
    requesterName: users.name,
    status: collaborationOrderChangeRequests.status,
    reason: collaborationOrderChangeRequests.reason,
    oldValuesJson: collaborationOrderChangeRequests.oldValuesJson,
    newValuesJson: collaborationOrderChangeRequests.newValuesJson,
    createdAt: collaborationOrderChangeRequests.createdAt,
  }).from(collaborationOrderChangeRequests)
    .leftJoin(users, eq(collaborationOrderChangeRequests.requestedByUserId, users.id))
    .where(and(
      eq(collaborationOrderChangeRequests.orderId, orderId),
      eq(collaborationOrderChangeRequests.status, "pending")
    )).limit(1);
  return rows[0] ?? null;
}

export async function listAcceptedCollaborationOrderChangeRequests(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: collaborationOrderChangeRequests.id,
    requestedByUserId: collaborationOrderChangeRequests.requestedByUserId,
    requesterName: users.name,
    reason: collaborationOrderChangeRequests.reason,
    oldValuesJson: collaborationOrderChangeRequests.oldValuesJson,
    newValuesJson: collaborationOrderChangeRequests.newValuesJson,
    acceptedAt: collaborationOrderChangeRequests.acceptedAt,
    createdAt: collaborationOrderChangeRequests.createdAt,
  }).from(collaborationOrderChangeRequests)
    .leftJoin(users, eq(collaborationOrderChangeRequests.requestedByUserId, users.id))
    .where(and(
      eq(collaborationOrderChangeRequests.orderId, orderId),
      eq(collaborationOrderChangeRequests.status, "accepted")
    )).orderBy(asc(collaborationOrderChangeRequests.acceptedAt));
}

export async function respondCollaborationOrderChangeRequest(
  requestId: number,
  action: "accepted" | "rejected"
): Promise<{ orderId: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const rows = await db.select().from(collaborationOrderChangeRequests)
    .where(eq(collaborationOrderChangeRequests.id, requestId)).limit(1);
  const req = rows[0];
  if (!req) throw new Error("NOT_FOUND");
  if (req.status !== "pending") throw new Error("NOT_PENDING");
  if (action === "accepted") {
    const newValues = req.newValuesJson as Record<string, string | null>;
    await db.update(collaborationOrderChangeRequests).set({
      status: "accepted",
      acceptedAt: now,
    }).where(eq(collaborationOrderChangeRequests.id, requestId));
    await db.update(collaborationOrders).set({
      depositDueDate: newValues.depositDueDate ?? null,
      productionStartDate: newValues.productionStartDate ?? null,
      expectedCompletionDate: newValues.expectedCompletionDate ?? null,
      expectedShipmentDate: newValues.expectedShipmentDate ?? null,
      finalPaymentDueDate: newValues.finalPaymentDueDate ?? null,
    }).where(eq(collaborationOrders.id, req.orderId));
  } else {
    await db.update(collaborationOrderChangeRequests).set({
      status: "rejected",
      rejectedAt: now,
    }).where(eq(collaborationOrderChangeRequests.id, requestId));
  }
  return { orderId: req.orderId };
}

// ===== Phase 4C: 訂單日期逾期 Email 通知 =====

const OVERDUE_DATE_FIELDS = [
  "depositDueDate",
  "productionStartDate",
  "expectedCompletionDate",
  "expectedShipmentDate",
  "finalPaymentDueDate",
] as const;
type OverdueDateField = typeof OVERDUE_DATE_FIELDS[number];

export async function listOverdueCollaborationOrderDateNodes() {
  const db = await getDb();
  if (!db) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const orders = await db.select({
    id: collaborationOrders.id,
    projectName: collaborationOrders.projectName,
    factoryId: collaborationOrders.factoryId,
    factoryName: factories.name,
    buyerUserId: collaborationOrders.buyerUserId,
    acceptedAsType: collaborationOrders.acceptedAsType,
    acceptedAsFactoryId: collaborationOrders.acceptedAsFactoryId,
    conversationId: collaborationOrders.conversationId,
    depositDueDate: collaborationOrders.depositDueDate,
    productionStartDate: collaborationOrders.productionStartDate,
    expectedCompletionDate: collaborationOrders.expectedCompletionDate,
    expectedShipmentDate: collaborationOrders.expectedShipmentDate,
    finalPaymentDueDate: collaborationOrders.finalPaymentDueDate,
  }).from(collaborationOrders)
    .leftJoin(factories, eq(collaborationOrders.factoryId, factories.id))
    .where(inArray(collaborationOrders.status, ["accepted", "in_progress", "shipped"]));

  const notifiedRows = await db.select({
    orderId: collaborationOrderOverdueNotifications.orderId,
    dateField: collaborationOrderOverdueNotifications.dateField,
  }).from(collaborationOrderOverdueNotifications);

  const notifiedSet = new Set(notifiedRows.map(n => `${n.orderId}:${n.dateField}`));

  const nodes: Array<typeof orders[0] & { dateField: OverdueDateField; dueDate: string }> = [];
  for (const order of orders) {
    for (const field of OVERDUE_DATE_FIELDS) {
      const dueDate = order[field];
      if (!dueDate) continue;
      if (dueDate >= todayStr) continue;
      if (notifiedSet.has(`${order.id}:${field}`)) continue;
      nodes.push({ ...order, dateField: field, dueDate });
    }
  }
  return nodes;
}

export async function createCollaborationOrderOverdueNotification(
  orderId: number,
  dateField: string,
  dueDate: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(collaborationOrderOverdueNotifications).values({
    orderId,
    dateField,
    dueDate,
  }).onDuplicateKeyUpdate({ set: { notifiedAt: sql`notifiedAt` } }); // no-op on duplicate
}

export async function getFactoryEmailRecipients(
  factoryId: number,
): Promise<Array<{ email: string | null; name: string | null }>> {
  const db = await getDb();
  if (!db) return [];

  const ownerRows = await db.select({
    email: users.email,
    primaryEmail: users.primaryEmail,
    name: users.name,
  }).from(factories)
    .innerJoin(users, eq(factories.ownerId, users.id))
    .where(eq(factories.id, factoryId))
    .limit(1);

  const cmRows = await db.select({
    email: users.email,
    primaryEmail: users.primaryEmail,
    name: users.name,
  }).from(factoryCoManagers)
    .innerJoin(users, eq(factoryCoManagers.userId, users.id))
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt),
    ));

  return [
    ...ownerRows.map(r => ({ email: r.primaryEmail ?? r.email, name: r.name })),
    ...cmRows.map(r => ({ email: r.primaryEmail ?? r.email, name: r.name })),
  ];
}

export async function respondCollaborationOrder(
  id: number,
  action: "accepted" | "rejected",
  acceptedAs?: {
    acceptedByUserId: number;
    acceptedAsType: "user" | "factory";
    acceptedAsFactoryId: number | null;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  if (action === "accepted") {
    if (!acceptedAs?.acceptedByUserId) {
      throw new Error("acceptedByUserId is required when accepting a collaboration order");
    }
    await db.update(collaborationOrders).set({
      status: "accepted",
      // 訂單被接受的當下才初始化製作階段（不是建立訂單時）——pending 狀態沒有 currentStage
      currentStage: "awaiting_deposit",
      acceptedAt: now,
      acceptedByUserId: acceptedAs.acceptedByUserId,
      acceptedAsType: acceptedAs.acceptedAsType ?? "user",
      acceptedAsFactoryId: acceptedAs.acceptedAsFactoryId,
    }).where(eq(collaborationOrders.id, id));
  } else {
    await db.update(collaborationOrders).set({ status: "rejected", rejectedAt: now }).where(eq(collaborationOrders.id, id));
  }
}

export async function requestCancelCollaborationOrder(
  id: number,
  requestedByUserId: number,
  reason: string,
  fromStatus: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(collaborationOrders).set({
    status: "cancel_requested",
    cancelRequestedByUserId: requestedByUserId,
    cancelRequestedAt: new Date(),
    cancelRequestReason: reason,
    cancelRequestedFromStatus: fromStatus,
  }).where(eq(collaborationOrders.id, id));
}

export async function respondCancelCollaborationOrder(
  id: number,
  action: "accept" | "reject"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [order] = await db.select().from(collaborationOrders).where(eq(collaborationOrders.id, id)).limit(1);
  if (!order) throw new Error("找不到合作確認單");
  const now = new Date();
  if (action === "accept") {
    await db.update(collaborationOrders).set({ status: "cancelled", cancelledAt: now }).where(eq(collaborationOrders.id, id));
  } else {
    const restored = (order.cancelRequestedFromStatus ?? "accepted") as any;
    await db.update(collaborationOrders).set({
      status: restored,
      cancelRequestedByUserId: null,
      cancelRequestedAt: null,
      cancelRequestReason: null,
      cancelRequestedFromStatus: null,
    }).where(eq(collaborationOrders.id, id));
  }
}

export async function updateCollaborationOrderStatus(
  id: number,
  status: "in_progress" | "shipped" | "completed"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const extra: Record<string, any> = {};
  if (status === "completed") extra.completedAt = now;
  await db.update(collaborationOrders).set({ status, ...extra }).where(eq(collaborationOrders.id, id));
}

export async function earlyCompleteOrder(orderId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(collaborationOrders).set({
    earlyCompletedAt: new Date(),
    earlyCompletedByUserId: userId,
  }).where(eq(collaborationOrders.id, orderId));
}

export async function earlyShipOrder(orderId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(collaborationOrders).set({
    earlyShippedAt: new Date(),
    earlyShippedByUserId: userId,
  }).where(eq(collaborationOrders.id, orderId));
}

// 最小的 transaction connection 介面（mysql2 PoolConnection 的子集），只列出這裡用到的方法，
// 方便單元測試用 mock 物件取代真正的資料庫連線，驗證呼叫順序與 rollback 行為。
export type TxConnection = {
  execute: (sql: string, values?: unknown[]) => Promise<[any, any]>;
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

/**
 * markCollaborationOrderComplete 的核心 transaction 邏輯，接受外部傳入的連線（測試可注入
 * mock connection）。UPDATE 與 history INSERT 使用同一條連線、同一個 transaction：
 * 任何一步失敗都會 rollback，兩者一起成功才 commit，不會出現「訂單已完成但沒有歷史紀錄」
 * 或「歷史寫入但訂單其實沒完成」的不一致狀態。
 *
 * WHERE 條件同時擋兩件事：
 *   1. status 必須是 accepted/in_progress/shipped 之一（不可重複完成、不可對 pending 等狀態操作）
 *   2. currentStage 必須是 NULL（舊資料，沒有階段紀錄）或剛好是 awaiting_final_payment
 *      （不可跳階，需先用 advanceStage 推進到待結款）
 * affectedRows=0 代表以上任一條件不成立，直接 CONFLICT，不寫任何歷史。
 *
 * fromStage 直接用「transaction 內查到的目前 currentStage」原樣寫入（可能是 null）——
 * 舊訂單 currentStage 從未被初始化時，fromStage 就是 null，不偽造它曾經處於
 * awaiting_final_payment 或任何其他階段。
 */
export async function markCollaborationOrderCompleteOnConn(
  conn: TxConnection,
  params: {
    orderId: number;
    completedByUserId: number;
    completionNote: string | null;
    actorNameSnapshot: string;
    actorFactoryNameSnapshot: string;
    isEarly: boolean;
    expectedDateAtTransition: string | null;
  },
): Promise<void> {
  await conn.beginTransaction();
  try {
    const [rows] = await conn.execute(
      "SELECT `currentStage` FROM `collaborationOrders` WHERE `id` = ? FOR UPDATE",
      [params.orderId],
    );
    const fromStage: string | null = (rows as any[])[0]?.currentStage ?? null;

    const [header] = await conn.execute(
      "UPDATE `collaborationOrders` " +
      "SET `status` = ?, `currentStage` = ?, `completedAt` = NOW(), `completedByUserId` = ?, `completionNote` = ? " +
      "WHERE `id` = ? AND `status` IN (?, ?, ?) AND (`currentStage` IS NULL OR `currentStage` = ?)",
      [
        "completed", "completed", params.completedByUserId, params.completionNote,
        params.orderId, "accepted", "in_progress", "shipped", "awaiting_final_payment",
      ],
    );
    if ((header as mysql.ResultSetHeader).affectedRows === 0) {
      throw Object.assign(new Error("訂單狀態已更新，請重新整理"), { code: "CONFLICT" });
    }

    await conn.execute(
      "INSERT INTO `collaborationOrderStageHistory` " +
      "(`orderId`, `actorUserId`, `actorNameSnapshot`, `actorFactoryNameSnapshot`, `fromStage`, `toStage`, `note`, `isEarly`, `expectedDateAtTransition`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        params.orderId, params.completedByUserId, params.actorNameSnapshot, params.actorFactoryNameSnapshot,
        fromStage, "completed", params.completionNote, params.isEarly, params.expectedDateAtTransition,
      ],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  }
}

export async function markCollaborationOrderComplete(
  orderId: number,
  completedByUserId: number,
  completionNote: string | null,
  actorNameSnapshot: string,
  actorFactoryNameSnapshot: string,
  isEarly: boolean,
  expectedDateAtTransition: string | null,
): Promise<void> {
  const pool = await getRawPool();
  const conn = await pool.getConnection();
  try {
    await markCollaborationOrderCompleteOnConn(conn, {
      orderId, completedByUserId, completionNote, actorNameSnapshot, actorFactoryNameSnapshot,
      isEarly, expectedDateAtTransition,
    });
  } finally {
    conn.release();
  }
}

// 訂單製作階段合法下一階段／預計日期節點 mapping：與前端共用同一份定義（shared/collaborationOrderStage.ts）
export { COLLABORATION_ORDER_NEXT_STAGE, COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD } from "@shared/collaborationOrderStage";

/**
 * advanceCollaborationOrderStage 的核心 transaction 邏輯，接受外部傳入的連線（測試可注入
 * mock connection）。conditional UPDATE 與 history INSERT 在同一條連線、同一個 transaction
 * 內完成：UPDATE 用 WHERE status='accepted' AND currentStage=expectedCurrentStage 做樂觀鎖，
 * affectedRows=0（代表已被別的操作改變）就直接 rollback + CONFLICT，不寫入任何歷史；
 * 如果後續 history INSERT 失敗，UPDATE 也會一併 rollback，不會出現「階段已推進但沒有歷史」
 * 的不一致狀態。
 */
export async function advanceCollaborationOrderStageOnConn(
  conn: TxConnection,
  params: {
    orderId: number;
    expectedCurrentStage: string;
    nextStage: string;
    actorUserId: number;
    actorNameSnapshot: string;
    actorFactoryNameSnapshot: string;
    note: string | null;
    isEarly: boolean;
    expectedDateAtTransition: string | null;
  },
): Promise<void> {
  await conn.beginTransaction();
  try {
    const [header] = await conn.execute(
      "UPDATE `collaborationOrders` SET `currentStage` = ? WHERE `id` = ? AND `status` = ? AND `currentStage` = ?",
      [params.nextStage, params.orderId, "accepted", params.expectedCurrentStage],
    );
    if ((header as mysql.ResultSetHeader).affectedRows === 0) {
      throw Object.assign(new Error("訂單狀態已更新，請重新整理"), { code: "CONFLICT" });
    }

    await conn.execute(
      "INSERT INTO `collaborationOrderStageHistory` " +
      "(`orderId`, `actorUserId`, `actorNameSnapshot`, `actorFactoryNameSnapshot`, `fromStage`, `toStage`, `note`, `isEarly`, `expectedDateAtTransition`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        params.orderId, params.actorUserId, params.actorNameSnapshot, params.actorFactoryNameSnapshot,
        params.expectedCurrentStage, params.nextStage, params.note, params.isEarly, params.expectedDateAtTransition,
      ],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  }
}

export async function advanceCollaborationOrderStage(params: {
  orderId: number;
  expectedCurrentStage: string;
  nextStage: string;
  actorUserId: number;
  actorNameSnapshot: string;
  actorFactoryNameSnapshot: string;
  note: string | null;
  isEarly: boolean;
  expectedDateAtTransition: string | null;
}): Promise<void> {
  const pool = await getRawPool();
  const conn = await pool.getConnection();
  try {
    await advanceCollaborationOrderStageOnConn(conn, params);
  } finally {
    conn.release();
  }
}

export async function getCollaborationOrderStageHistory(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collaborationOrderStageHistory)
    .where(eq(collaborationOrderStageHistory.orderId, orderId))
    .orderBy(collaborationOrderStageHistory.createdAt);
}

export async function listFactoryCollaborationOrders(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: collaborationOrders.id,
    conversationId: collaborationOrders.conversationId,
    productId: collaborationOrders.productId,
    projectName: collaborationOrders.projectName,
    description: collaborationOrders.description,
    depositDueDate: collaborationOrders.depositDueDate,
    productionStartDate: collaborationOrders.productionStartDate,
    expectedCompletionDate: collaborationOrders.expectedCompletionDate,
    expectedShipmentDate: collaborationOrders.expectedShipmentDate,
    finalPaymentDueDate: collaborationOrders.finalPaymentDueDate,
    note: collaborationOrders.note,
    status: collaborationOrders.status,
    currentStage: collaborationOrders.currentStage,
    acceptedAt: collaborationOrders.acceptedAt,
    rejectedAt: collaborationOrders.rejectedAt,
    completedAt: collaborationOrders.completedAt,
    completionNote: collaborationOrders.completionNote,
    cancelledAt: collaborationOrders.cancelledAt,
    cancelRequestedByUserId: collaborationOrders.cancelRequestedByUserId,
    cancelRequestedAt: collaborationOrders.cancelRequestedAt,
    cancelRequestReason: collaborationOrders.cancelRequestReason,
    cancelRequestedFromStatus: collaborationOrders.cancelRequestedFromStatus,
    earlyCompletedAt: collaborationOrders.earlyCompletedAt,
    earlyShippedAt: collaborationOrders.earlyShippedAt,
    createdAt: collaborationOrders.createdAt,
    buyerUserId: collaborationOrders.buyerUserId,
    buyerName: users.name,
    productName: products.name,
  }).from(collaborationOrders)
    .leftJoin(users, eq(collaborationOrders.buyerUserId, users.id))
    .leftJoin(products, eq(collaborationOrders.productId, products.id))
    .where(eq(collaborationOrders.factoryId, factoryId))
    .orderBy(desc(collaborationOrders.createdAt));
}

// Phase 3D: 查詢某工廠「下訂訂單」（以該工廠身分接受的對外合作確認單）
export async function listFactoryPlacedCollaborationOrders(factoryId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: collaborationOrders.id,
    conversationId: collaborationOrders.conversationId,
    productId: collaborationOrders.productId,
    projectName: collaborationOrders.projectName,
    description: collaborationOrders.description,
    depositDueDate: collaborationOrders.depositDueDate,
    productionStartDate: collaborationOrders.productionStartDate,
    expectedCompletionDate: collaborationOrders.expectedCompletionDate,
    expectedShipmentDate: collaborationOrders.expectedShipmentDate,
    finalPaymentDueDate: collaborationOrders.finalPaymentDueDate,
    note: collaborationOrders.note,
    status: collaborationOrders.status,
    acceptedAt: collaborationOrders.acceptedAt,
    rejectedAt: collaborationOrders.rejectedAt,
    completedAt: collaborationOrders.completedAt,
    completionNote: collaborationOrders.completionNote,
    cancelledAt: collaborationOrders.cancelledAt,
    cancelRequestedAt: collaborationOrders.cancelRequestedAt,
    cancelRequestReason: collaborationOrders.cancelRequestReason,
    cancelRequestedFromStatus: collaborationOrders.cancelRequestedFromStatus,
    earlyCompletedAt: collaborationOrders.earlyCompletedAt,
    earlyShippedAt: collaborationOrders.earlyShippedAt,
    createdAt: collaborationOrders.createdAt,
    buyerUserId: collaborationOrders.buyerUserId,
    buyerName: users.name,
    productName: products.name,
    sellerFactoryName: factories.name,
  }).from(collaborationOrders)
    .leftJoin(users, eq(collaborationOrders.buyerUserId, users.id))
    .leftJoin(products, eq(collaborationOrders.productId, products.id))
    .leftJoin(factories, eq(collaborationOrders.factoryId, factories.id))
    .where(eq(collaborationOrders.acceptedAsFactoryId, factoryId))
    .orderBy(desc(collaborationOrders.createdAt));
}

// Phase 3E: 查詢使用者「個人訂單」（以個人身分接受的訂單，acceptedAsType='user' 或 NULL）
export async function listUserPersonalCollaborationOrders(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: collaborationOrders.id,
    conversationId: collaborationOrders.conversationId,
    projectName: collaborationOrders.projectName,
    description: collaborationOrders.description,
    note: collaborationOrders.note,
    status: collaborationOrders.status,
    depositDueDate: collaborationOrders.depositDueDate,
    expectedShipmentDate: collaborationOrders.expectedShipmentDate,
    finalPaymentDueDate: collaborationOrders.finalPaymentDueDate,
    createdAt: collaborationOrders.createdAt,
    acceptedAt: collaborationOrders.acceptedAt,
    completedAt: collaborationOrders.completedAt,
    completionNote: collaborationOrders.completionNote,
    earlyCompletedAt: collaborationOrders.earlyCompletedAt,
    earlyShippedAt: collaborationOrders.earlyShippedAt,
    factoryId: collaborationOrders.factoryId,
    factoryName: factories.name,
  }).from(collaborationOrders)
    .leftJoin(factories, eq(collaborationOrders.factoryId, factories.id))
    .where(
      and(
        eq(collaborationOrders.buyerUserId, userId),
        or(
          eq(collaborationOrders.acceptedAsType, "user"),
          isNull(collaborationOrders.acceptedAsType)
        )
      )
    )
    .orderBy(desc(collaborationOrders.createdAt));
}

export async function getCollaborationOrdersForConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collaborationOrders)
    .where(eq(collaborationOrders.conversationId, conversationId))
    .orderBy(desc(collaborationOrders.createdAt));
}

export async function createVerifiedOrderReview(data: {
  factoryId: number;
  userId: number;
  collaborationOrderId: number;
  rating: number;
  comment?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // 檢查是否已有此訂單的評價
  const existing = await db.select().from(reviews)
    .where(eq(reviews.collaborationOrderId, data.collaborationOrderId)).limit(1);
  if (existing.length > 0) throw new Error("此合作確認單已留過評價");
  await db.insert(reviews).values({
    factoryId: data.factoryId,
    userId: data.userId,
    rating: data.rating,
    comment: data.comment ?? null,
    collaborationOrderId: data.collaborationOrderId,
    reviewType: "verified_order",
  });
  await recalcFactoryRating(data.factoryId);
}

// ===== 重複下訂申請 =====

export async function createRepeatOrderRequest(data: {
  originalOrderId: number;
  conversationId: number;
  requestedByUserId: number;
  requestedAsFactoryId?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(collaborationOrderRepeatRequests).values({
    originalOrderId: data.originalOrderId,
    conversationId: data.conversationId,
    requestedByUserId: data.requestedByUserId,
    requestedAsFactoryId: data.requestedAsFactoryId ?? null,
  });
  return (result as any)[0].insertId as number;
}

export async function getRepeatOrderRequest(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(collaborationOrderRepeatRequests)
    .where(eq(collaborationOrderRepeatRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function respondRepeatOrderRequest(requestId: number, action: "accepted" | "rejected"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(collaborationOrderRepeatRequests)
    .set({ status: action })
    .where(eq(collaborationOrderRepeatRequests.id, requestId));
}

// ===== Push Notification Tokens =====

function hashPushToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function upsertPushNotificationToken(
  userId: number,
  input: { token: string; platform: string; deviceId?: string; appVersion?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const tokenHash = hashPushToken(input.token);
  await db.insert(pushNotificationTokens)
    .values({
      userId,
      token: input.token,
      tokenHash,
      platform: input.platform,
      deviceId: input.deviceId ?? null,
      appVersion: input.appVersion ?? null,
      enabled: true,
      lastSeenAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      // ON DUPLICATE KEY 由 UNIQUE(userId, tokenHash) 觸發
      set: {
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        appVersion: input.appVersion ?? null,
        enabled: true,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function disablePushNotificationToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const tokenHash = hashPushToken(token);
  await db.update(pushNotificationTokens)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(
      eq(pushNotificationTokens.userId, userId),
      eq(pushNotificationTokens.tokenHash, tokenHash)
    ));
}

export async function getEnabledPushTokensByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select()
    .from(pushNotificationTokens)
    .where(and(
      eq(pushNotificationTokens.userId, userId),
      eq(pushNotificationTokens.enabled, true)
    ));
}

// ===== 工廠基本資料修改申請 =====

// 19 個基本資料欄位白名單（不含 businessType，申請後無法更改）
export const BASIC_DATA_FIELDS = [
  "name", "industry", "subIndustry", "mfgModes", "region", "description",
  "capitalLevel", "foundedYear", "ownerName", "contactPersonName", "phone",
  "website", "contactEmail", "address", "operationStatus",
  "weekdayHours", "weekendHours", "businessNote", "avatarUrl",
] as const;

export type BasicDataField = typeof BASIC_DATA_FIELDS[number];

export function extractBasicData(factory: Factory): Record<BasicDataField, any> {
  return {
    name: factory.name,
    industry: factory.industry,
    subIndustry: factory.subIndustry ?? [],
    mfgModes: factory.mfgModes,
    region: factory.region,
    description: factory.description ?? null,
    capitalLevel: factory.capitalLevel,
    foundedYear: factory.foundedYear ?? null,
    ownerName: factory.ownerName ?? null,
    contactPersonName: factory.contactPersonName ?? null,
    phone: factory.phone ?? null,
    website: factory.website ?? null,
    contactEmail: factory.contactEmail ?? null,
    address: factory.address,
    operationStatus: factory.operationStatus,
    weekdayHours: factory.weekdayHours ?? null,
    weekendHours: factory.weekendHours ?? null,
    businessNote: factory.businessNote ?? null,
    avatarUrl: factory.avatarUrl ?? null,
  };
}

export async function getPendingRevisionByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(factoryRevisions)
    .where(and(eq(factoryRevisions.factoryId, factoryId), eq(factoryRevisions.status, "pending")))
    .limit(1);
  return rows[0] ?? null;
}

export async function createRevision(
  factoryId: number,
  submittedBy: number,
  originalData: Record<string, any>,
  proposedData: Record<string, any>,
  revisionReason: string,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    const result = await db.insert(factoryRevisions).values({
      factoryId,
      submittedBy,
      originalData,
      proposedData,
      revisionReason,
      status: "pending",
      submittedAt: new Date(),
    } as any);
    return (result as any)[0].insertId;
  } catch (err: any) {
    // MySQL duplicate key on uq_factory_one_pending_revision
    if (err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY') {
      throw new Error('DUPLICATE_PENDING_REVISION');
    }
    throw err;
  }
}

export async function approveRevisionAtomic(revisionId: number, adminId: number): Promise<{
  factoryId: number;
  ownerId: number;
  factoryName: string;
  ownerEmail: string | null;
  ownerName: string | null;
  proposedData: Record<string, any>;
}> {
  await getDb();
  const pool = _pool;
  if (!pool) throw new Error("DB not available");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [revRows]: any = await conn.execute(
      "SELECT * FROM factoryRevisions WHERE id = ? AND status = 'pending' FOR UPDATE",
      [revisionId]
    );
    if (!revRows || revRows.length === 0) {
      throw new Error("此申請不存在或已被其他管理員處理");
    }
    const rev = revRows[0];
    const proposed = typeof rev.proposedData === "string"
      ? JSON.parse(rev.proposedData)
      : rev.proposedData;

    // Build SET clause from proposedData whitelist
    const allowedFields = BASIC_DATA_FIELDS as readonly string[];
    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of allowedFields) {
      if (field in proposed) {
        const val = proposed[field];
        // JSON fields
        if (field === "industry" || field === "subIndustry" || field === "mfgModes") {
          setClauses.push(`\`${field}\` = ?`);
          setValues.push(JSON.stringify(Array.isArray(val) ? val : []));
        } else if (field === "foundedYear") {
          // Coerce to int — guards against stale string values from old data
          const yr = val !== null && val !== undefined ? Math.floor(Number(val)) : null;
          setClauses.push(`\`${field}\` = ?`);
          setValues.push(yr !== null && !isNaN(yr) ? yr : null);
        } else {
          setClauses.push(`\`${field}\` = ?`);
          setValues.push(val ?? null);
        }
      }
    }

    if (setClauses.length > 0) {
      await conn.execute(
        `UPDATE factories SET ${setClauses.join(", ")}, updatedAt = NOW() WHERE id = ?`,
        [...setValues, rev.factoryId]
      );
    }

    await conn.execute(
      "UPDATE factoryRevisions SET status = 'approved', reviewedBy = ?, reviewedAt = NOW() WHERE id = ?",
      [adminId, revisionId]
    );

    // Fetch factory info for notification (within transaction, no lock needed)
    const [factoryRows]: any = await conn.execute(
      "SELECT id, name, ownerId FROM factories WHERE id = ?",
      [rev.factoryId]
    );
    const factory = factoryRows?.[0];

    const [userRows]: any = factory ? await conn.execute(
      "SELECT email, name FROM users WHERE id = ?",
      [factory.ownerId]
    ) : [[]];
    const owner = userRows?.[0];

    await conn.commit();
    return {
      factoryId: rev.factoryId,
      ownerId: factory?.ownerId ?? 0,
      factoryName: factory?.name ?? "",
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
      proposedData: proposed,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function rejectRevisionAtomic(revisionId: number, adminId: number, reason: string): Promise<{
  factoryId: number;
  ownerId: number;
  factoryName: string;
  ownerEmail: string | null;
  ownerName: string | null;
}> {
  await getDb();
  const pool = _pool;
  if (!pool) throw new Error("DB not available");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [revRows]: any = await conn.execute(
      "SELECT * FROM factoryRevisions WHERE id = ? AND status = 'pending' FOR UPDATE",
      [revisionId]
    );
    if (!revRows || revRows.length === 0) {
      throw new Error("此申請不存在或已被其他管理員處理");
    }
    const rev = revRows[0];
    await conn.execute(
      "UPDATE factoryRevisions SET status = 'rejected', rejectionReason = ?, reviewedBy = ?, reviewedAt = NOW() WHERE id = ?",
      [reason, adminId, revisionId]
    );
    const [factoryRows]: any = await conn.execute(
      "SELECT id, name, ownerId FROM factories WHERE id = ?",
      [rev.factoryId]
    );
    const factory = factoryRows?.[0];
    const [userRows]: any = factory ? await conn.execute(
      "SELECT email, name FROM users WHERE id = ?",
      [factory.ownerId]
    ) : [[]];
    const owner = userRows?.[0];
    await conn.commit();
    return {
      factoryId: rev.factoryId,
      ownerId: factory?.ownerId ?? 0,
      factoryName: factory?.name ?? "",
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function rejectRevision(revisionId: number, adminId: number, reason: string): Promise<{
  factoryId: number;
  factoryName: string;
  ownerEmail: string | null;
  ownerName: string | null;
}> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const rows = await db.select().from(factoryRevisions)
    .where(and(eq(factoryRevisions.id, revisionId), eq(factoryRevisions.status, "pending")))
    .limit(1);
  if (rows.length === 0) throw new Error("此申請不存在或已被其他管理員處理");
  const rev = rows[0];

  await db.update(factoryRevisions).set({
    status: "rejected",
    rejectionReason: reason,
    reviewedBy: adminId,
    reviewedAt: new Date(),
  } as any).where(eq(factoryRevisions.id, revisionId));

  const factory = await getFactoryById(rev.factoryId);
  const owner = factory ? await getUserById(factory.ownerId) : undefined;
  return {
    factoryId: rev.factoryId,
    factoryName: factory?.name ?? "",
    ownerEmail: owner?.email ?? null,
    ownerName: owner?.name ?? null,
  };
}

export async function getAdminPendingRevisions(page = 1, pageSize = 20) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(factoryRevisions)
    .where(eq(factoryRevisions.status, "pending"));
  const total = Number(countResult?.count ?? 0);

  const rows = await db.select({
    id: factoryRevisions.id,
    factoryId: factoryRevisions.factoryId,
    factoryName: factories.name,
    submittedBy: factoryRevisions.submittedBy,
    submitterName: users.name,
    originalData: factoryRevisions.originalData,
    proposedData: factoryRevisions.proposedData,
    revisionReason: factoryRevisions.revisionReason,
    status: factoryRevisions.status,
    submittedAt: factoryRevisions.submittedAt,
  }).from(factoryRevisions)
    .innerJoin(factories, eq(factoryRevisions.factoryId, factories.id))
    .innerJoin(users, eq(factoryRevisions.submittedBy, users.id))
    .where(eq(factoryRevisions.status, "pending"))
    .orderBy(asc(factoryRevisions.submittedAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  return { items: rows, total };
}

export async function getPendingRevisionCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(factoryRevisions)
    .where(eq(factoryRevisions.status, "pending"));
  return Number(result?.count ?? 0);
}

// Returns the most recent revision (any status) for a factory — used to show pending/rejected banners.
// The frontend displays a banner only if status is 'pending' or 'rejected'; 'approved' is ignored.
export async function getLatestRevisionByFactory(factoryId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(factoryRevisions)
    .where(eq(factoryRevisions.factoryId, factoryId))
    .orderBy(desc(factoryRevisions.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRevisionById(revisionId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(factoryRevisions)
    .where(eq(factoryRevisions.id, revisionId))
    .limit(1);
  return rows[0] ?? null;
}

// ===== 商案討論區 DB helpers =====

export type CommunityAuthorIdentity =
  | { type: "user"; label: string }
  | { type: "factory"; factoryId: number; label: string; role: "owner" | "co_manager" };

// Returns all identity options a user can choose from when creating a post.
// Only includes approved factories.
export async function getCommunityAuthorIdentityOptions(userId: number): Promise<CommunityAuthorIdentity[]> {
  const db = await getDb();
  if (!db) return [{ type: "user", label: "" }];

  const identities: CommunityAuthorIdentity[] = [];

  // Owned factory (if approved)
  const ownedRows = await db.select({ id: factories.id, name: factories.name, status: factories.status })
    .from(factories)
    .where(and(eq(factories.ownerId, userId), eq(factories.status, "approved")))
    .limit(1);
  if (ownedRows.length > 0) {
    identities.push({ type: "factory", factoryId: ownedRows[0].id, label: ownedRows[0].name, role: "owner" });
  }

  // Co-managed factories (approved, active)
  const coMgrRows = await db
    .select({ id: factories.id, name: factories.name })
    .from(factoryCoManagers)
    .innerJoin(factories, and(eq(factories.id, factoryCoManagers.factoryId), eq(factories.status, "approved")))
    .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt)));
  for (const row of coMgrRows) {
    identities.push({ type: "factory", factoryId: row.id, label: row.name, role: "co_manager" });
  }

  return identities;
}

// Pure function: given an ordered factory list (owner-first, then co-managers, each sorted by id ASC),
// returns the first valid Community spaceCode derived from factory industries, or cross-industry as fallback.
export function resolveDefaultCommunitySpace(
  orderedFactories: Array<{ industry: string[] | null }>
): string {
  for (const factory of orderedFactories) {
    const industries: string[] = Array.isArray(factory.industry) ? factory.industry : [];
    for (const ind of industries) {
      const slug = INDUSTRY_SLUGS[ind];
      if (slug) return slug;
    }
  }
  return COMMUNITY_CROSS_INDUSTRY_SLUG;
}

// Returns the default Community spaceCode for a user based on their approved factories.
// Stable ordering: owner factories first (sorted by id ASC), then active co-managed factories (sorted by id ASC).
// Falls back to cross-industry if no approved factory has a recognisable industry.
export async function getUserDefaultCommunitySpace(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return COMMUNITY_CROSS_INDUSTRY_SLUG;

  // Owner's approved factory (ownerId is unique so at most 1 row), stable by id ASC
  const ownedRows = await db
    .select({ id: factories.id, industry: factories.industry })
    .from(factories)
    .where(and(eq(factories.ownerId, userId), eq(factories.status, "approved")))
    .orderBy(asc(factories.id));

  // Active co-managed approved factories, stable by factoryId ASC
  const coMgrRows = await db
    .select({ id: factories.id, industry: factories.industry })
    .from(factoryCoManagers)
    .innerJoin(
      factories,
      and(eq(factories.id, factoryCoManagers.factoryId), eq(factories.status, "approved"))
    )
    .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt)))
    .orderBy(asc(factories.id));

  return resolveDefaultCommunitySpace([...ownedRows, ...coMgrRows]);
}

export interface CommunityPostWithMeta extends CommunityPost {
  authorName: string | null;
  authorFactoryName: string | null;
  commentCount: number;
}

export interface CommunityCommentWithMeta extends CommunityComment {
  authorName: string | null;
  authorFactoryName: string | null;
  replyToUserName: string | null;
  replies?: CommunityCommentWithMeta[];
}

// Returns post counts per spaceCode (for space list homepage)
export async function getCommunitySpaceStats(spaceCodes: string[]): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db || spaceCodes.length === 0) return {};
  const rows = await db
    .select({ spaceCode: communityPosts.spaceCode, count: sql<number>`COUNT(*)` })
    .from(communityPosts)
    .where(and(
      inArray(communityPosts.spaceCode, spaceCodes),
      isNull(communityPosts.deletedAt),
      eq(communityPosts.isHidden, false),
    ))
    .groupBy(communityPosts.spaceCode);
  const result: Record<string, number> = {};
  for (const row of rows) result[row.spaceCode] = Number(row.count);
  return result;
}

// Paginated posts for a space (public-facing, excludes hidden/deleted)
export async function listCommunityPosts(
  spaceCode: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: CommunityPostWithMeta[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const where = and(
    eq(communityPosts.spaceCode, spaceCode),
    isNull(communityPosts.deletedAt),
    eq(communityPosts.isHidden, false),
  );

  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(communityPosts).where(where);
  const total = Number(countResult?.count ?? 0);

  const rows = await db
    .select({
      post: communityPosts,
      authorName: users.name,
      factoryName: factories.name,
    })
    .from(communityPosts)
    .leftJoin(users, eq(users.id, communityPosts.authorUserId))
    .leftJoin(factories, eq(factories.id, communityPosts.authorFactoryId))
    .where(where)
    .orderBy(desc(communityPosts.isPinned), desc(communityPosts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Fetch comment counts
  const postIds = rows.map(r => r.post.id);
  const commentCountMap: Record<number, number> = {};
  if (postIds.length > 0) {
    const ccRows = await db
      .select({ postId: communityComments.postId, count: sql<number>`COUNT(*)` })
      .from(communityComments)
      .where(and(inArray(communityComments.postId, postIds), isNull(communityComments.deletedAt)))
      .groupBy(communityComments.postId);
    for (const r of ccRows) commentCountMap[r.postId] = Number(r.count);
  }

  const items: CommunityPostWithMeta[] = rows.map(r => ({
    ...r.post,
    authorName: r.post.authorUserId == null
      ? "已刪除的使用者"
      : (r.authorName ?? r.post.authorNameSnapshot ?? null),
    authorFactoryName: r.post.authorUserId == null
      ? null
      : (r.factoryName ?? r.post.authorFactoryNameSnapshot ?? null),
    commentCount: commentCountMap[r.post.id] ?? 0,
  }));
  return { items, total };
}

// Single post (public-facing, throws if hidden/deleted)
export async function getCommunityPostById(postId: number): Promise<CommunityPostWithMeta | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ post: communityPosts, authorName: users.name, factoryName: factories.name })
    .from(communityPosts)
    .leftJoin(users, eq(users.id, communityPosts.authorUserId))
    .leftJoin(factories, eq(factories.id, communityPosts.authorFactoryId))
    .where(eq(communityPosts.id, postId))
    .limit(1);
  if (!rows[0]) return null;
  const r = rows[0];
  const [ccResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(communityComments)
    .where(and(eq(communityComments.postId, postId), isNull(communityComments.deletedAt)));
  return {
    ...r.post,
    authorName: r.post.authorUserId == null
      ? "已刪除的使用者"
      : (r.authorName ?? r.post.authorNameSnapshot ?? null),
    authorFactoryName: r.post.authorUserId == null
      ? null
      : (r.factoryName ?? r.post.authorFactoryNameSnapshot ?? null),
    commentCount: Number(ccResult?.count ?? 0),
  };
}

// Comments for a post, structured as top-level + nested replies.
// Soft-deleted comments are INCLUDED so parent context is preserved for nested replies.
// Their content/author is cleared so clients can render "此留言已刪除".
export async function getCommunityCommentsByPost(postId: number): Promise<CommunityCommentWithMeta[]> {
  const db = await getDb();
  if (!db) return [];

  const replyToUsers = db.select({ id: users.id, name: users.name }).from(users).as("replyToUsers");

  const rows = await db
    .select({
      comment: communityComments,
      authorName: users.name,
      factoryName: factories.name,
      replyToUserName: replyToUsers.name,
    })
    .from(communityComments)
    .leftJoin(users, eq(users.id, communityComments.authorUserId))
    .leftJoin(factories, eq(factories.id, communityComments.authorFactoryId))
    .leftJoin(replyToUsers, eq(replyToUsers.id, communityComments.replyToUserId))
    .where(eq(communityComments.postId, postId))  // includes soft-deleted
    .orderBy(asc(communityComments.createdAt));

  const all: CommunityCommentWithMeta[] = rows.map(r => {
    const isDeleted = r.comment.deletedAt != null;
    const userGone = r.comment.authorUserId == null;
    return {
      ...r.comment,
      // Sanitize deleted comment content so no data leaks
      content: isDeleted ? "" : r.comment.content,
      authorName: isDeleted
        ? null
        : userGone
          ? "已刪除的使用者"
          : (r.authorName ?? r.comment.authorNameSnapshot ?? null),
      authorFactoryName: isDeleted || userGone
        ? null
        : (r.factoryName ?? r.comment.authorFactoryNameSnapshot ?? null),
      replyToUserName: r.replyToUserName ?? null,
      replies: [],
    };
  });

  const byId = new Map(all.map(c => [c.id, c]));
  const topLevel: CommunityCommentWithMeta[] = [];
  for (const c of all) {
    if (c.parentCommentId == null) {
      topLevel.push(c);
    } else {
      const parent = byId.get(c.parentCommentId);
      if (parent) {
        parent.replies ??= [];
        parent.replies.push(c);
      } else {
        topLevel.push(c); // orphaned reply (parent was physically deleted) — show at top level
      }
    }
  }
  return topLevel;
}

export async function createCommunityPost(input: {
  spaceCode: string;
  authorUserId: number;
  authorFactoryId?: number | null;
  authorNameSnapshot: string;
  authorFactoryNameSnapshot?: string | null;
  authorRoleSnapshot?: string | null;
  title: string;
  content: string;
  images?: string[];
  pinnedProductIds?: number[];
  commentsEnabled?: boolean;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(communityPosts).values({
    spaceCode: input.spaceCode,
    authorUserId: input.authorUserId,
    authorFactoryId: input.authorFactoryId ?? null,
    authorNameSnapshot: input.authorNameSnapshot,
    authorFactoryNameSnapshot: input.authorFactoryNameSnapshot ?? null,
    authorRoleSnapshot: input.authorRoleSnapshot ?? null,
    title: input.title,
    content: input.content,
    images: input.images ?? [],
    pinnedProductIds: input.pinnedProductIds ?? [],
    commentsEnabled: input.commentsEnabled ?? true,
  });
  return (result as unknown as { insertId: number }).insertId;
}

export async function updateCommunityPost(postId: number, input: {
  title?: string;
  content?: string;
  images?: string[];
  pinnedProductIds?: number[];
  commentsEnabled?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(communityPosts)
    .set({ ...input })
    .where(eq(communityPosts.id, postId));
}

export async function softDeleteCommunityPost(postId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(communityPosts)
    .set({ deletedAt: new Date() })
    .where(eq(communityPosts.id, postId));
}

export async function createCommunityComment(input: {
  postId: number;
  authorUserId: number;
  authorFactoryId?: number | null;
  authorNameSnapshot: string;
  authorFactoryNameSnapshot?: string | null;
  authorRoleSnapshot?: string | null;
  content: string;
  parentCommentId?: number | null;
  replyToUserId?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(communityComments).values({
    postId: input.postId,
    authorUserId: input.authorUserId,
    authorFactoryId: input.authorFactoryId ?? null,
    authorNameSnapshot: input.authorNameSnapshot,
    authorFactoryNameSnapshot: input.authorFactoryNameSnapshot ?? null,
    authorRoleSnapshot: input.authorRoleSnapshot ?? null,
    content: input.content,
    parentCommentId: input.parentCommentId ?? null,
    replyToUserId: input.replyToUserId ?? null,
  });
  return (result as unknown as { insertId: number }).insertId;
}

export async function updateCommunityComment(commentId: number, content: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(communityComments).set({ content }).where(eq(communityComments.id, commentId));
}

export async function softDeleteCommunityComment(commentId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(communityComments)
    .set({ deletedAt: new Date() })
    .where(eq(communityComments.id, commentId));
}

export async function adminSetCommunityPostFlags(
  postId: number,
  flags: { isHidden?: boolean; isLocked?: boolean; isPinned?: boolean },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updates: Partial<CommunityPost> = {};
  if (flags.isHidden !== undefined) updates.isHidden = flags.isHidden;
  if (flags.isLocked !== undefined) updates.isLocked = flags.isLocked;
  if (flags.isPinned !== undefined) updates.isPinned = flags.isPinned;
  if (Object.keys(updates).length === 0) return;
  await db.update(communityPosts).set(updates).where(eq(communityPosts.id, postId));
}

export async function adminSetCommunityCommentHidden(commentId: number, isHidden: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(communityComments).set({ isHidden }).where(eq(communityComments.id, commentId));
}

export async function adminHardDeleteCommunityPost(postId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityPosts).where(eq(communityPosts.id, postId));
}

export async function getCommunityCommentById(commentId: number): Promise<CommunityComment | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(communityComments)
    .where(eq(communityComments.id, commentId)).limit(1);
  return rows[0] ?? null;
}

// ===== Community Board Follows =====

export async function getBoardFollowStatus(userId: number, spaceCode: string): Promise<CommunityBoardFollow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(communityBoardFollows)
    .where(and(eq(communityBoardFollows.userId, userId), eq(communityBoardFollows.spaceCode, spaceCode)))
    .limit(1);
  return rows[0] ?? null;
}

export async function followBoard(userId: number, spaceCode: string, notifyNewDiscussions = true): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(communityBoardFollows)
    .values({ userId, spaceCode, notifyNewDiscussions })
    .onDuplicateKeyUpdate({ set: { notifyNewDiscussions, updatedAt: new Date() } });
}

export async function unfollowBoard(userId: number, spaceCode: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityBoardFollows)
    .where(and(eq(communityBoardFollows.userId, userId), eq(communityBoardFollows.spaceCode, spaceCode)));
}

/**
 * Filters candidate user IDs to only those eligible to receive Community notifications
 * based on the current COMMUNITY_FEATURE_STATUS.
 *
 * - coming_soon / maintenance: no notifications
 * - beta: only role='admin', not deleted
 * - live: any non-deleted user
 *
 * Also excludes `excludeActorId` to prevent self-notifications.
 */
export async function filterCommunityEligibleRecipientIds(
  candidateIds: number[],
  excludeActorId?: number,
): Promise<number[]> {
  if (COMMUNITY_FEATURE_STATUS === "coming_soon" || COMMUNITY_FEATURE_STATUS === "maintenance") {
    return [];
  }
  const unique = Array.from(new Set(
    excludeActorId != null
      ? candidateIds.filter(id => id !== excludeActorId)
      : candidateIds,
  ));
  if (unique.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id })
    .from(users)
    .where(and(
      inArray(users.id, unique),
      isNull(users.deletedAt),
      COMMUNITY_FEATURE_STATUS === "beta" ? eq(users.role, "admin") : undefined,
    ));
  return rows.map(r => r.id);
}

export async function getBoardFollowerUserIds(spaceCode: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: communityBoardFollows.userId })
    .from(communityBoardFollows)
    .where(and(
      eq(communityBoardFollows.spaceCode, spaceCode),
      eq(communityBoardFollows.notifyNewDiscussions, true),
    ));
  const allIds = rows.map(r => r.userId);
  return filterCommunityEligibleRecipientIds(allIds);
}

// ===== Factory Follows =====

export async function getFactoryFollowStatus(userId: number, factoryId: number): Promise<FactoryFollow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(factoryFollows)
    .where(and(eq(factoryFollows.userId, userId), eq(factoryFollows.factoryId, factoryId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function followFactory(userId: number, factoryId: number, notifyNewDiscussions = true): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(factoryFollows)
    .values({ userId, factoryId, notifyNewDiscussions })
    .onDuplicateKeyUpdate({ set: { notifyNewDiscussions, updatedAt: new Date() } });
}

export async function unfollowFactory(userId: number, factoryId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(factoryFollows)
    .where(and(eq(factoryFollows.userId, userId), eq(factoryFollows.factoryId, factoryId)));
}

export async function getFactoryFollowerUserIds(factoryId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: factoryFollows.userId })
    .from(factoryFollows)
    .where(and(
      eq(factoryFollows.factoryId, factoryId),
      eq(factoryFollows.notifyNewDiscussions, true),
    ));
  const allIds = rows.map(r => r.userId);
  return filterCommunityEligibleRecipientIds(allIds);
}

// ===== Content Follows =====

export async function getContentFollowStatus(userId: number, contentType: string, contentId: number): Promise<CommunityContentFollow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(communityContentFollows)
    .where(and(
      eq(communityContentFollows.userId, userId),
      eq(communityContentFollows.contentType, contentType),
      eq(communityContentFollows.contentId, contentId),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function followContent(userId: number, contentType: string, contentId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(communityContentFollows)
    .values({ userId, contentType, contentId })
    .onDuplicateKeyUpdate({ set: { userId } }); // no-op on duplicate
}

export async function unfollowContent(userId: number, contentType: string, contentId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityContentFollows)
    .where(and(
      eq(communityContentFollows.userId, userId),
      eq(communityContentFollows.contentType, contentType),
      eq(communityContentFollows.contentId, contentId),
    ));
}

export async function getContentFollowerUserIds(contentType: string, contentId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: communityContentFollows.userId })
    .from(communityContentFollows)
    .where(and(
      eq(communityContentFollows.contentType, contentType),
      eq(communityContentFollows.contentId, contentId),
    ));
  return rows.map(r => r.userId);
}

// ===== Reactions =====

export async function toggleReaction(
  userId: number,
  targetType: string,
  targetId: number,
  reactionType: string,
): Promise<{ added: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: communityReactions.id })
    .from(communityReactions)
    .where(and(
      eq(communityReactions.userId, userId),
      eq(communityReactions.targetType, targetType),
      eq(communityReactions.targetId, targetId),
      eq(communityReactions.reactionType, reactionType),
    ))
    .limit(1);
  if (existing.length > 0) {
    await db.delete(communityReactions)
      .where(and(
        eq(communityReactions.userId, userId),
        eq(communityReactions.targetType, targetType),
        eq(communityReactions.targetId, targetId),
        eq(communityReactions.reactionType, reactionType),
      ));
    return { added: false };
  }
  try {
    await db.insert(communityReactions).values({ userId, targetType, targetId, reactionType });
    return { added: true };
  } catch (err: any) {
    // Concurrent insert hit the UNIQUE constraint — row is now in DB (added by the other request)
    if (err?.code === "ER_DUP_ENTRY") return { added: true };
    throw err;
  }
}

export async function getReactionSummary(
  targetType: string,
  targetId: number,
  viewerUserId?: number,
): Promise<{ count: number; viewerReacted: boolean }> {
  const db = await getDb();
  if (!db) return { count: 0, viewerReacted: false };
  const [countRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(communityReactions)
    .where(and(
      eq(communityReactions.targetType, targetType),
      eq(communityReactions.targetId, targetId),
    ));
  const count = Number(countRow?.count ?? 0);
  let viewerReacted = false;
  if (viewerUserId != null) {
    const viewerRow = await db.select({ id: communityReactions.id })
      .from(communityReactions)
      .where(and(
        eq(communityReactions.userId, viewerUserId),
        eq(communityReactions.targetType, targetType),
        eq(communityReactions.targetId, targetId),
      ))
      .limit(1);
    viewerReacted = viewerRow.length > 0;
  }
  return { count, viewerReacted };
}

export async function getReactionSummaryBatch(
  items: { targetType: string; targetId: number }[],
  viewerUserId?: number,
): Promise<Map<string, { count: number; viewerReacted: boolean }>> {
  const result = new Map<string, { count: number; viewerReacted: boolean }>();
  if (items.length === 0) return result;
  const db = await getDb();
  if (!db) return result;

  // Build individual conditions for each (targetType, targetId) pair
  const conditions = items.map(item =>
    and(eq(communityReactions.targetType, item.targetType), eq(communityReactions.targetId, item.targetId))
  );
  const orCondition = conditions.length === 1 ? conditions[0]! : or(...conditions as [typeof conditions[0], ...typeof conditions])!;

  const rows = await db.select({
    targetType: communityReactions.targetType,
    targetId: communityReactions.targetId,
    userId: communityReactions.userId,
  })
    .from(communityReactions)
    .where(orCondition);

  // Aggregate counts and viewer reactions
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    const existing = result.get(key) ?? { count: 0, viewerReacted: false };
    existing.count += 1;
    if (viewerUserId != null && row.userId === viewerUserId) {
      existing.viewerReacted = true;
    }
    result.set(key, existing);
  }
  return result;
}

// ===== Mentions =====

export async function createMentions(
  sourceType: string,
  sourceId: number,
  mentions: Array<{ userId?: number; factoryId?: number }>,
): Promise<void> {
  if (mentions.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const values = mentions
    .filter(m => m.userId != null || m.factoryId != null)
    .map(m => ({
      sourceType,
      sourceId,
      mentionedUserId: m.userId ?? null,
      mentionedFactoryId: m.factoryId ?? null,
    }));
  if (values.length === 0) return;
  // INSERT IGNORE via onDuplicateKeyUpdate no-op
  for (const value of values) {
    await db.insert(communityMentions)
      .values(value)
      .onDuplicateKeyUpdate({ set: { sourceType: value.sourceType } }); // no-op on duplicate
  }
}

export async function getMentionsBySource(
  sourceType: string,
  sourceId: number,
): Promise<Array<{ mentionedUserId: number | null; mentionedFactoryId: number | null }>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    mentionedUserId: communityMentions.mentionedUserId,
    mentionedFactoryId: communityMentions.mentionedFactoryId,
  })
    .from(communityMentions)
    .where(and(
      eq(communityMentions.sourceType, sourceType),
      eq(communityMentions.sourceId, sourceId),
    ));
}

/**
 * Syncs mentions for a source. Returns newly-added mentions for notification purposes.
 * Deletes removed mentions; inserts new ones; does not touch unchanged mentions.
 */
export async function syncMentionsBySource(
  sourceType: string,
  sourceId: number,
  newMentions: Array<{ userId?: number; factoryId?: number }>,
): Promise<Array<{ userId?: number; factoryId?: number }>> {
  const existing = await getMentionsBySource(sourceType, sourceId);

  const toKey = (m: { userId?: number | null; factoryId?: number | null }) =>
    m.userId != null ? `u:${m.userId}` : `f:${m.factoryId}`;

  const existingMap = new Map(existing.map(m => [
    toKey({ userId: m.mentionedUserId, factoryId: m.mentionedFactoryId }),
    m,
  ]));
  const newMap = new Map(newMentions
    .filter(m => m.userId != null || m.factoryId != null)
    .map(m => [toKey(m), m]),
  );

  const added = Array.from(newMap.entries())
    .filter(([k]) => !existingMap.has(k))
    .map(([, m]) => m);

  const removedKeys = Array.from(existingMap.keys()).filter(k => !newMap.has(k));

  const db = await getDb();
  if (!db) return [];

  for (const key of removedKeys) {
    const row = existingMap.get(key)!;
    if (row.mentionedUserId != null) {
      await db.delete(communityMentions).where(and(
        eq(communityMentions.sourceType, sourceType),
        eq(communityMentions.sourceId, sourceId),
        eq(communityMentions.mentionedUserId, row.mentionedUserId),
      ));
    } else if (row.mentionedFactoryId != null) {
      await db.delete(communityMentions).where(and(
        eq(communityMentions.sourceType, sourceType),
        eq(communityMentions.sourceId, sourceId),
        eq(communityMentions.mentionedFactoryId, row.mentionedFactoryId),
      ));
    }
  }

  for (const m of added) {
    await db.insert(communityMentions)
      .values({
        sourceType,
        sourceId,
        mentionedUserId: m.userId ?? null,
        mentionedFactoryId: m.factoryId ?? null,
      })
      .onDuplicateKeyUpdate({ set: { sourceType } });
  }

  return added;
}

// ===== Co-managers (helper for notification fan-out) =====

export async function getActiveCoManagerUserIds(factoryId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ userId: factoryCoManagers.userId })
    .from(factoryCoManagers)
    .where(and(
      eq(factoryCoManagers.factoryId, factoryId),
      isNull(factoryCoManagers.removedAt),
    ));
  return rows.map(r => r.userId);
}

export async function getAdminUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  // Mirror isAdminUser() logic: match on ENV whitelist (openId / email), not cached users.role
  const conditions: ReturnType<typeof eq>[] = [];
  if (ENV.ownerOpenId) conditions.push(eq(users.openId, ENV.ownerOpenId));
  if (ENV.adminWhitelistOpenIds.length > 0) {
    for (const oid of ENV.adminWhitelistOpenIds) conditions.push(eq(users.openId, oid));
  }
  if (ENV.adminWhitelistEmails.length > 0) {
    for (const em of ENV.adminWhitelistEmails) conditions.push(eq(users.email, em));
  }
  if (conditions.length === 0) return [];
  const rows = await db.select({ id: users.id })
    .from(users)
    .where(and(isNull(users.deletedAt), or(...conditions)));
  return rows.map(r => r.id);
}

// ===== Community Notifications =====

export interface CreateCommunityNotificationInput {
  recipientUserId: number;
  actorUserId?: number | null;
  actorFactoryId?: number | null;
  eventType: string;
  eventGroup: string;
  postId?: number | null;
  commentId?: number | null;
  spaceCode?: string | null;
  titleSnapshot?: string | null;
  actorNameSnapshot: string;
  actorFactoryNameSnapshot?: string | null;
  message: string;
  actionUrl?: string | null;
  dedupeKey: string;
}

export async function createCommunityNotification(input: CreateCommunityNotificationInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(communityNotifications)
    .values({
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId ?? null,
      actorFactoryId: input.actorFactoryId ?? null,
      eventType: input.eventType,
      eventGroup: input.eventGroup,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      spaceCode: input.spaceCode ?? null,
      titleSnapshot: input.titleSnapshot ?? null,
      actorNameSnapshot: input.actorNameSnapshot,
      actorFactoryNameSnapshot: input.actorFactoryNameSnapshot ?? null,
      message: input.message,
      actionUrl: input.actionUrl ?? null,
      dedupeKey: input.dedupeKey,
    })
    .onDuplicateKeyUpdate({ set: { dedupeKey: input.dedupeKey } }); // no-op on dedupe collision
}

export async function createCommunityNotificationsBatch(inputs: CreateCommunityNotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const db = await getDb();
  if (!db) return;
  // Process in batches; on duplicate dedupeKey silently skip
  for (const input of inputs) {
    try {
      await db.insert(communityNotifications)
        .values({
          recipientUserId: input.recipientUserId,
          actorUserId: input.actorUserId ?? null,
          actorFactoryId: input.actorFactoryId ?? null,
          eventType: input.eventType,
          eventGroup: input.eventGroup,
          postId: input.postId ?? null,
          commentId: input.commentId ?? null,
          spaceCode: input.spaceCode ?? null,
          titleSnapshot: input.titleSnapshot ?? null,
          actorNameSnapshot: input.actorNameSnapshot,
          actorFactoryNameSnapshot: input.actorFactoryNameSnapshot ?? null,
          message: input.message,
          actionUrl: input.actionUrl ?? null,
          dedupeKey: input.dedupeKey,
        })
        .onDuplicateKeyUpdate({ set: { dedupeKey: input.dedupeKey } }); // no-op on duplicate
    } catch {
      // swallow individual insert errors so one failure doesn't abort the batch
    }
  }
}

export async function listCommunityNotifications(
  recipientUserId: number,
  page: number,
  pageSize: number,
  visibleTypes?: string[] | null,
): Promise<{ items: CommunityNotification[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const offset = (page - 1) * pageSize;
  const typeFilter = visibleTypes && visibleTypes.length > 0
    ? inArray(communityNotifications.eventType, visibleTypes)
    : undefined;
  const items = await db.select().from(communityNotifications)
    .where(and(
      eq(communityNotifications.recipientUserId, recipientUserId),
      isNull(communityNotifications.deletedAt),
      typeFilter,
    ))
    .orderBy(desc(communityNotifications.createdAt))
    .limit(pageSize)
    .offset(offset);
  const [countRow] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(communityNotifications)
    .where(and(
      eq(communityNotifications.recipientUserId, recipientUserId),
      isNull(communityNotifications.deletedAt),
      typeFilter,
    ));
  return { items, total: Number(countRow?.count ?? 0) };
}

export async function getCommunityNotificationUnreadCount(
  recipientUserId: number,
  visibleTypes?: string[] | null,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const typeFilter = visibleTypes && visibleTypes.length > 0
    ? inArray(communityNotifications.eventType, visibleTypes)
    : undefined;
  const [row] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(communityNotifications)
    .where(and(
      eq(communityNotifications.recipientUserId, recipientUserId),
      eq(communityNotifications.isRead, false),
      isNull(communityNotifications.deletedAt),
      typeFilter,
    ));
  return Number(row?.count ?? 0);
}

export async function markCommunityNotificationRead(
  notificationId: number,
  recipientUserId: number,
  visibleTypes?: string[] | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const typeFilter = visibleTypes && visibleTypes.length > 0
    ? inArray(communityNotifications.eventType, visibleTypes)
    : undefined;
  await db.update(communityNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(communityNotifications.id, notificationId),
      eq(communityNotifications.recipientUserId, recipientUserId),
      typeFilter,
    ));
}

export async function markAllCommunityNotificationsRead(
  recipientUserId: number,
  visibleTypes?: string[] | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const typeFilter = visibleTypes && visibleTypes.length > 0
    ? inArray(communityNotifications.eventType, visibleTypes)
    : undefined;
  await db.update(communityNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(communityNotifications.recipientUserId, recipientUserId),
      eq(communityNotifications.isRead, false),
      typeFilter,
    ));
}

// ===== Mention search targets =====

export interface MentionTarget {
  type: "factory" | "user";
  id: number;
  displayName: string;
  avatarUrl?: string | null;
}

export async function searchMentionTargets(
  query: string,
  viewerUserId: number,
  postId?: number,
): Promise<MentionTarget[]> {
  const db = await getDb();
  if (!db) return [];
  const pattern = `%${query}%`;

  // Factories: approved, name LIKE query, limit 10
  const factoryRows = await db.select({
    id: factories.id,
    name: factories.name,
    avatarUrl: factories.avatarUrl,
  })
    .from(factories)
    .where(and(
      eq(factories.status, "approved"),
      like(factories.name, pattern),
    ))
    .limit(10);

  const results: MentionTarget[] = factoryRows.map(f => ({
    type: "factory" as const,
    id: f.id,
    displayName: f.name ?? "",
    avatarUrl: f.avatarUrl ?? null,
  }));

  // Post participants: users who commented on this post, matching query, limit 5
  if (postId != null) {
    const participantRows = await db.select({
      id: users.id,
      name: users.name,
    })
      .from(communityComments)
      .innerJoin(users, eq(communityComments.authorUserId, users.id))
      .where(and(
        eq(communityComments.postId, postId),
        isNull(communityComments.deletedAt),
        isNotNull(communityComments.authorUserId),
        like(users.name, pattern),
      ))
      .groupBy(users.id, users.name)
      .limit(5);

    const existingFactoryIds = new Set(results.map(r => r.type === "factory" ? r.id : null));
    for (const p of participantRows) {
      // Avoid duplicates and don't include the viewer themselves
      if (p.id === viewerUserId) continue;
      results.push({
        type: "user" as const,
        id: p.id,
        displayName: p.name ?? "",
        avatarUrl: null,
      });
    }
  }

  return results.slice(0, 15);
}

// ===== Notification fan-out helper for new community posts =====

export async function buildNewPostNotifications(input: {
  postId: number;
  spaceCode: string;
  spaceName: string;
  authorUserId: number;
  authorFactoryId?: number | null;
  titleSnapshot: string;
  actorNameSnapshot: string;
  actorFactoryNameSnapshot?: string | null;
}): Promise<CreateCommunityNotificationInput[]> {
  const notifications: CreateCommunityNotificationInput[] = [];
  const notifiedUserIds = new Set<number>();
  const actorDisplay = input.actorFactoryNameSnapshot ?? input.actorNameSnapshot;

  // 1. Factory followers FIRST (more specific message; takes priority over board notification)
  if (input.authorFactoryId != null) {
    const factoryFollowers = await getFactoryFollowerUserIds(input.authorFactoryId);
    for (const recipientUserId of factoryFollowers) {
      if (recipientUserId === input.authorUserId) continue;
      notifiedUserIds.add(recipientUserId);
      notifications.push({
        recipientUserId,
        actorUserId: input.authorUserId,
        actorFactoryId: input.authorFactoryId,
        eventType: "followed_factory_new_discussion",
        eventGroup: "follow",
        postId: input.postId,
        spaceCode: input.spaceCode,
        titleSnapshot: input.titleSnapshot,
        actorNameSnapshot: input.actorNameSnapshot,
        actorFactoryNameSnapshot: input.actorFactoryNameSnapshot ?? null,
        message: `您追蹤的工廠 ${actorDisplay} 在「${input.spaceName}」看板發布了新討論：${input.titleSnapshot}`,
        dedupeKey: `factory:${input.authorFactoryId}:post:${input.postId}:r:${recipientUserId}`,
      });
    }
  }

  // 2. Board followers — skip those already notified via factory follow
  const boardFollowers = await getBoardFollowerUserIds(input.spaceCode);
  for (const recipientUserId of boardFollowers) {
    if (recipientUserId === input.authorUserId) continue;
    if (notifiedUserIds.has(recipientUserId)) continue;
    notifications.push({
      recipientUserId,
      actorUserId: input.authorUserId,
      actorFactoryId: input.authorFactoryId ?? null,
      eventType: "board_new_discussion",
      eventGroup: "follow",
      postId: input.postId,
      spaceCode: input.spaceCode,
      titleSnapshot: input.titleSnapshot,
      actorNameSnapshot: input.actorNameSnapshot,
      actorFactoryNameSnapshot: input.actorFactoryNameSnapshot ?? null,
      message: `${actorDisplay} 在您追蹤的「${input.spaceName}」看板發布了新討論：${input.titleSnapshot}`,
      dedupeKey: `board:${input.spaceCode}:post:${input.postId}:r:${recipientUserId}`,
    });
  }

  return notifications;
}

// ===== Phase 3A: Community Bids =====

export type CreateBidInput = {
  spaceCode: string;
  authorUserId: number;
  authorFactoryId: number | null;
  authorNameSnapshot: string;
  authorFactoryNameSnapshot: string | null;
  authorRoleSnapshot: string | null;
  title: string;
  description: string;
  quantity: string | null;
  material: string | null;
  specifications: string | null;
  sampleRequired: boolean;
  desiredDeliveryDate: string | null;
  deliveryLocation: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  images: string[];
  pinnedProductIds: number[];
  durationHours: number;
  targetIndustrySpaceCodes?: string[];
};

export async function createCommunityBid(input: CreateBidInput): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(communityBids).values({
    spaceCode: input.spaceCode,
    authorUserId: input.authorUserId,
    authorFactoryId: input.authorFactoryId,
    authorNameSnapshot: input.authorNameSnapshot,
    authorFactoryNameSnapshot: input.authorFactoryNameSnapshot,
    authorRoleSnapshot: input.authorRoleSnapshot,
    title: input.title,
    description: input.description,
    quantity: input.quantity,
    material: input.material,
    specifications: input.specifications,
    sampleRequired: input.sampleRequired,
    desiredDeliveryDate: input.desiredDeliveryDate,
    deliveryLocation: input.deliveryLocation,
    budgetMin: input.budgetMin,
    budgetMax: input.budgetMax,
    images: input.images,
    pinnedProductIds: input.pinnedProductIds,
    durationHours: input.durationHours,
    status: "draft",
  });
  const bidId = (result as any).insertId as number;

  if (input.targetIndustrySpaceCodes && input.targetIndustrySpaceCodes.length > 0) {
    await db_.insert(communityBidIndustries).values(
      input.targetIndustrySpaceCodes.map(sc => ({ bidId, spaceCode: sc })),
    );
  }

  return bidId;
}

export type UpdateBidInput = Partial<Omit<CreateBidInput, "spaceCode" | "authorUserId" | "authorFactoryId" | "authorNameSnapshot" | "authorFactoryNameSnapshot" | "authorRoleSnapshot">>;

export async function updateCommunityBid(bidId: number, input: UpdateBidInput): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");

  const { targetIndustrySpaceCodes, images, pinnedProductIds, ...rest } = input;
  const updateFields: Record<string, unknown> = { ...rest };
  if (images !== undefined) updateFields.images = images;
  if (pinnedProductIds !== undefined) updateFields.pinnedProductIds = pinnedProductIds;

  if (Object.keys(updateFields).length > 0) {
    await db_.update(communityBids).set(updateFields).where(eq(communityBids.id, bidId));
  }

  if (targetIndustrySpaceCodes !== undefined) {
    await db_.delete(communityBidIndustries).where(eq(communityBidIndustries.bidId, bidId));
    if (targetIndustrySpaceCodes.length > 0) {
      await db_.insert(communityBidIndustries).values(
        targetIndustrySpaceCodes.map(sc => ({ bidId, spaceCode: sc })),
      );
    }
  }
}

export async function getCommunityBidById(bidId: number): Promise<CommunityBid | null> {
  const db_ = await getDb();
  if (!db_) return null;
  const rows = await db_.select().from(communityBids).where(eq(communityBids.id, bidId)).limit(1);
  return rows[0] ?? null;
}

export async function getCommunityBidIndustries(bidId: number): Promise<string[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const rows = await db_.select({ spaceCode: communityBidIndustries.spaceCode })
    .from(communityBidIndustries)
    .where(eq(communityBidIndustries.bidId, bidId));
  return rows.map(r => r.spaceCode);
}

// Helper: raw pool for conditional UPDATE with affectedRows check
async function getRawPool(): Promise<mysql.Pool> {
  if (!_pool) await getDb();
  if (!_pool) throw new Error("DB not available");
  return _pool;
}

// mysql2 pool.execute() converts Date objects using the local timezone, which can corrupt UTC
// timestamps on systems not in UTC. Pass UTC strings directly to avoid this.
function toSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function submitCommunityBidForReview(bidId: number, actorUserId: number, actorName: string): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const bid = await getCommunityBidById(bidId);
  const statusBefore = bid?.status ?? "draft";
  const pool = await getRawPool();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `status` = ? WHERE `id` = ? AND (`status` = ? OR `status` = ?)',
    ['pending_review', bidId, 'draft', 'rejected'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("狀態不符合，無法提交審核"), { code: "CONFLICT" });
  }
  await db_.insert(communityBidReviewHistory).values({
    bidId,
    actorUserId,
    actorNameSnapshot: actorName,
    action: "submitted",
    bidStatusBefore: statusBefore,
    bidStatusAfter: "pending_review",
  });
}

export async function approveCommunityBid(bidId: number, reviewerUserId: number, reviewerName: string): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const bid = await getCommunityBidById(bidId);
  if (!bid) throw Object.assign(new Error("找不到此需求"), { code: "NOT_FOUND" });
  const publishedAt = new Date();
  const deadline = new Date(publishedAt.getTime() + bid.durationHours * 60 * 60 * 1000);
  const pool = await getRawPool();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `status` = ?, `publishedAt` = ?, `deadline` = ?, ' +
    '`rejectionReason` = NULL, `reviewedByUserId` = ?, `reviewedAt` = ? ' +
    'WHERE `id` = ? AND `status` = ?',
    ['active', toSqlUtc(publishedAt), toSqlUtc(deadline), reviewerUserId, toSqlUtc(publishedAt), bidId, 'pending_review'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("審核狀態已被更新，請重新整理後再試"), { code: "CONFLICT" });
  }
  await db_.insert(communityBidReviewHistory).values({
    bidId,
    actorUserId: reviewerUserId,
    actorNameSnapshot: reviewerName,
    action: "approved",
    bidStatusBefore: "pending_review",
    bidStatusAfter: "active",
  });
}

export async function rejectCommunityBid(bidId: number, reviewerUserId: number, reviewerName: string, reason: string): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const now = new Date();
  const pool = await getRawPool();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `status` = ?, `rejectionReason` = ?, `reviewedByUserId` = ?, `reviewedAt` = ? ' +
    'WHERE `id` = ? AND `status` = ?',
    ['rejected', reason, reviewerUserId, toSqlUtc(now), bidId, 'pending_review'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("審核狀態已被更新，請重新整理後再試"), { code: "CONFLICT" });
  }
  await db_.insert(communityBidReviewHistory).values({
    bidId,
    actorUserId: reviewerUserId,
    actorNameSnapshot: reviewerName,
    action: "rejected",
    reason,
    bidStatusBefore: "pending_review",
    bidStatusAfter: "rejected",
  });
}

export async function cancelCommunityBid(bidId: number): Promise<void> {
  const pool = await getRawPool();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `status` = ? WHERE `id` = ? AND `status` = ?',
    ['cancelled', bidId, 'active'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("只有進行中的需求可以取消"), { code: "CONFLICT" });
  }
}

export async function withdrawCommunityBid(bidId: number, actorUserId: number, actorName: string): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const pool = await getRawPool();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `status` = ? WHERE `id` = ? AND `status` = ?',
    ['draft', bidId, 'pending_review'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("只有待審核中的需求可以撤回"), { code: "CONFLICT" });
  }
  await db_.insert(communityBidReviewHistory).values({
    bidId,
    actorUserId,
    actorNameSnapshot: actorName,
    action: "withdrawn",
    bidStatusBefore: "pending_review",
    bidStatusAfter: "draft",
  });
}

export async function softDeleteCommunityBid(bidId: number): Promise<void> {
  const pool = await getRawPool();
  const now = new Date();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    'UPDATE `communityBids` SET `deletedAt` = ? WHERE `id` = ? AND (`status` = ? OR `status` = ?) AND `deletedAt` IS NULL',
    [toSqlUtc(now), bidId, 'draft', 'rejected'],
  );
  if (header.affectedRows === 0) {
    throw Object.assign(new Error("只有草稿或退回狀態的需求可以刪除"), { code: "CONFLICT" });
  }
}

export type ListBidsFilter = {
  spaceCode?: string;
  status?: CommunityBid["status"];
  authorUserId?: number;
  page: number;
  pageSize: number;
};

export async function listCommunityBids(filter: ListBidsFilter): Promise<{
  bids: (CommunityBid & { targetIndustries: string[] })[];
  total: number;
}> {
  const db_ = await getDb();
  if (!db_) return { bids: [], total: 0 };

  const conditions = [];
  if (filter.spaceCode) conditions.push(eq(communityBids.spaceCode, filter.spaceCode));
  if (filter.status) conditions.push(eq(communityBids.status, filter.status));
  if (filter.authorUserId !== undefined) conditions.push(eq(communityBids.authorUserId, filter.authorUserId));
  conditions.push(isNull(communityBids.deletedAt));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (filter.page - 1) * filter.pageSize;

  const [rows, countRows] = await Promise.all([
    db_.select().from(communityBids)
      .where(where)
      .orderBy(desc(communityBids.createdAt))
      .limit(filter.pageSize)
      .offset(offset),
    db_.select({ count: sql<number>`count(*)` }).from(communityBids).where(where),
  ]);

  const total = Number(countRows[0]?.count ?? 0);

  const bidsWithIndustries = await Promise.all(rows.map(async bid => ({
    ...bid,
    targetIndustries: await getCommunityBidIndustries(bid.id),
  })));

  return { bids: bidsWithIndustries, total };
}

export async function listCommunityBidReviewHistory(bidId: number): Promise<CommunityBidReviewHistory[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(communityBidReviewHistory)
    .where(eq(communityBidReviewHistory.bidId, bidId))
    .orderBy(asc(communityBidReviewHistory.createdAt));
}

export async function countPendingCommunityBids(): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const rows = await db_.select({ count: sql<number>`count(*)` })
    .from(communityBids)
    .where(and(eq(communityBids.status, "pending_review"), isNull(communityBids.deletedAt)));
  return Number(rows[0]?.count ?? 0);
}

// ===== 商案討論區：廠商投標報價 =====

export type ApprovedFactoryForUser = {
  factoryId: number;
  factoryName: string;
  role: "owner" | "co_manager";
};

export async function getApprovedFactoriesForUser(userId: number): Promise<ApprovedFactoryForUser[]> {
  const db_ = await getDb();
  if (!db_) return [];

  const result: ApprovedFactoryForUser[] = [];

  const ownedRows = await db_.select({ id: factories.id, name: factories.name })
    .from(factories)
    .where(and(eq(factories.ownerId, userId), eq(factories.status, "approved")))
    .limit(1);
  if (ownedRows.length > 0) {
    result.push({ factoryId: ownedRows[0].id, factoryName: ownedRows[0].name, role: "owner" });
  }

  const coMgrRows = await db_
    .select({ id: factories.id, name: factories.name })
    .from(factoryCoManagers)
    .innerJoin(factories, and(eq(factories.id, factoryCoManagers.factoryId), eq(factories.status, "approved")))
    .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt)));
  for (const row of coMgrRows) {
    result.push({ factoryId: row.id, factoryName: row.name, role: "co_manager" });
  }

  return result;
}

export type CreateBidOfferInput = {
  bidId: number;
  bidderUserId: number;
  bidderFactoryId: number;
  bidderNameSnapshot: string;
  bidderFactoryNameSnapshot: string;
  bidderRoleSnapshot: string;
  amount: number | null;
  currency: string;
  deliveryDays: number | null;
  moq: number | null;
  sampleAvailable: boolean;
  proposal: string;
  commercialTerms: string | null;
  images: string[];
  pinnedProductIds: number[];
};

export async function createCommunityBidOffer(input: CreateBidOfferInput): Promise<number> {
  const pool = await getRawPool();
  const amountStr = input.amount != null ? String(input.amount) : null;
  const imgJson = JSON.stringify(input.images ?? []);
  const pinJson = JSON.stringify(input.pinnedProductIds ?? []);
  const submittedAt = toSqlUtc(new Date());

  // Atomic conditional INSERT: only insert if bid is still active and within deadline.
  // (deadline IS NULL OR deadline > UTC_TIMESTAMP()) guards against race conditions
  // where the router's pre-check passed but the deadline expired before the DB write.
  let header: mysql.ResultSetHeader;
  try {
    [header] = await pool.execute<mysql.ResultSetHeader>(
      `INSERT INTO \`communityBidOffers\`
         (\`bidId\`, \`bidderUserId\`, \`bidderFactoryId\`,
          \`bidderNameSnapshot\`, \`bidderFactoryNameSnapshot\`, \`bidderRoleSnapshot\`,
          \`amount\`, \`currency\`, \`deliveryDays\`, \`moq\`, \`sampleAvailable\`,
          \`proposal\`, \`commercialTerms\`, \`images\`, \`pinnedProductIds\`,
          \`lastUpdatedByUserId\`, \`lastUpdatedByNameSnapshot\`, \`submittedAt\`)
       SELECT ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?
       FROM \`communityBids\`
       WHERE \`id\` = ? AND \`status\` = 'active' AND \`deletedAt\` IS NULL
         AND (\`deadline\` IS NULL OR \`deadline\` > UTC_TIMESTAMP())`,
      [
        input.bidId, input.bidderUserId, input.bidderFactoryId,
        input.bidderNameSnapshot, input.bidderFactoryNameSnapshot, input.bidderRoleSnapshot,
        amountStr, input.currency, input.deliveryDays, input.moq, input.sampleAvailable ? 1 : 0,
        input.proposal, input.commercialTerms, imgJson, pinJson,
        input.bidderUserId, input.bidderNameSnapshot, submittedAt,
        // WHERE params:
        input.bidId,
      ],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") {
      throw Object.assign(new Error("此工廠已有投標紀錄"), { code: "CONFLICT" });
    }
    throw e;
  }

  if (header.affectedRows === 0) {
    throw Object.assign(
      new Error("此需求已截止或目前不開放投標，無法投標"),
      { code: "BID_UNAVAILABLE" },
    );
  }
  return header.insertId;
}

export type UpdateBidOfferInput = Partial<{
  amount: number | null;
  currency: string;
  deliveryDays: number | null;
  moq: number | null;
  sampleAvailable: boolean;
  proposal: string;
  commercialTerms: string | null;
  images: string[];
  pinnedProductIds: number[];
}>;

export async function updateCommunityBidOffer(
  offerId: number,
  input: UpdateBidOfferInput,
  actorUserId?: number | null,
  actorNameSnapshot?: string,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const { images, pinnedProductIds, amount, ...rest } = input;
  const fields: Record<string, unknown> = { ...rest };
  if (amount !== undefined) fields.amount = amount != null ? String(amount) : null;
  if (images !== undefined) fields.images = images;
  if (pinnedProductIds !== undefined) fields.pinnedProductIds = pinnedProductIds;
  if (actorUserId !== undefined) {
    fields.lastUpdatedByUserId = actorUserId;
    fields.lastUpdatedByNameSnapshot = actorNameSnapshot ?? '';
  }
  if (Object.keys(fields).length > 0) {
    await db_.update(communityBidOffers).set(fields).where(eq(communityBidOffers.id, offerId));
  }
}

// JOIN-based UPDATE with bid deadline guard; throws CONFLICT or BID_UNAVAILABLE if affectedRows=0.
export async function updateCommunityBidOfferSafe(
  offerId: number,
  input: UpdateBidOfferInput,
  actorUserId: number,
  actorNameSnapshot: string,
): Promise<void> {
  const pool = await getRawPool();
  const setClauses: string[] = [
    '`o`.`lastUpdatedByUserId` = ?',
    '`o`.`lastUpdatedByNameSnapshot` = ?',
  ];
  const params: (string | number | boolean | null)[] = [actorUserId, actorNameSnapshot];

  if (input.proposal !== undefined) { setClauses.push('`o`.`proposal` = ?'); params.push(input.proposal); }
  if (input.amount !== undefined) { setClauses.push('`o`.`amount` = ?'); params.push(input.amount != null ? String(input.amount) : null); }
  if (input.deliveryDays !== undefined) { setClauses.push('`o`.`deliveryDays` = ?'); params.push(input.deliveryDays); }
  if (input.moq !== undefined) { setClauses.push('`o`.`moq` = ?'); params.push(input.moq); }
  if (input.sampleAvailable !== undefined) { setClauses.push('`o`.`sampleAvailable` = ?'); params.push(input.sampleAvailable ? 1 : 0); }
  if (input.commercialTerms !== undefined) { setClauses.push('`o`.`commercialTerms` = ?'); params.push(input.commercialTerms); }
  if (input.images !== undefined) { setClauses.push('`o`.`images` = ?'); params.push(JSON.stringify(input.images)); }
  if (input.pinnedProductIds !== undefined) { setClauses.push('`o`.`pinnedProductIds` = ?'); params.push(JSON.stringify(input.pinnedProductIds)); }
  if (input.currency !== undefined) { setClauses.push('`o`.`currency` = ?'); params.push(input.currency); }

  params.push(offerId);
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE \`communityBidOffers\` AS o
     INNER JOIN \`communityBids\` AS b ON b.id = o.bidId
     SET ${setClauses.join(', ')}
     WHERE o.\`id\` = ?
     AND o.\`status\` = 'active'
     AND o.\`deletedAt\` IS NULL
     AND b.\`status\` = 'active'
     AND b.\`deletedAt\` IS NULL
     AND (b.\`deadline\` IS NULL OR b.\`deadline\` > UTC_TIMESTAMP())`,
    params,
  );
  if (header.affectedRows === 0) {
    const db_ = await getDb();
    let offerStatus: string | null = null;
    if (db_) {
      const [row] = await db_.select({ status: communityBidOffers.status }).from(communityBidOffers).where(eq(communityBidOffers.id, offerId)).limit(1);
      offerStatus = row?.status ?? null;
    }
    if (offerStatus !== 'active') {
      throw Object.assign(new Error("投標狀態衝突，無法更新"), { code: "CONFLICT" });
    }
    throw Object.assign(new Error("此需求已截止或關閉，無法修改投標"), { code: "BID_UNAVAILABLE" });
  }
}

export async function withdrawCommunityBidOffer(
  offerId: number,
  actorUserId?: number | null,
  actorNameSnapshot?: string,
): Promise<void> {
  const pool = await getRawPool();
  const now = new Date();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE \`communityBidOffers\` AS o
     INNER JOIN \`communityBids\` AS b ON b.id = o.bidId
     SET o.\`status\` = 'withdrawn', o.\`withdrawnAt\` = ?, o.\`lastUpdatedByUserId\` = ?, o.\`lastUpdatedByNameSnapshot\` = ?
     WHERE o.\`id\` = ?
     AND o.\`status\` = 'active'
     AND o.\`deletedAt\` IS NULL
     AND b.\`status\` = 'active'
     AND b.\`deletedAt\` IS NULL
     AND (b.\`deadline\` IS NULL OR b.\`deadline\` > UTC_TIMESTAMP())`,
    [toSqlUtc(now), actorUserId ?? null, actorNameSnapshot ?? '', offerId],
  );
  if (header.affectedRows === 0) {
    const db_ = await getDb();
    let offerStatus: string | null = null;
    if (db_) {
      const [row] = await db_.select({ status: communityBidOffers.status }).from(communityBidOffers).where(eq(communityBidOffers.id, offerId)).limit(1);
      offerStatus = row?.status ?? null;
    }
    if (offerStatus !== 'active') {
      throw Object.assign(new Error("投標紀錄狀態不符合，無法撤回"), { code: "CONFLICT" });
    }
    throw Object.assign(new Error("此需求已截止或關閉，無法撤回投標"), { code: "BID_UNAVAILABLE" });
  }
}

export async function resubmitCommunityBidOffer(
  offerId: number,
  updateFields: UpdateBidOfferInput,
  actorUserId?: number | null,
  actorNameSnapshot?: string,
): Promise<void> {
  const pool = await getRawPool();
  const now = new Date();
  const [header] = await pool.execute<mysql.ResultSetHeader>(
    `UPDATE \`communityBidOffers\` AS o
     INNER JOIN \`communityBids\` AS b ON b.id = o.bidId
     SET o.\`status\` = 'active', o.\`submittedAt\` = ?, o.\`withdrawnAt\` = NULL, o.\`lastUpdatedByUserId\` = ?, o.\`lastUpdatedByNameSnapshot\` = ?
     WHERE o.\`id\` = ?
     AND o.\`status\` = 'withdrawn'
     AND o.\`deletedAt\` IS NULL
     AND b.\`status\` = 'active'
     AND b.\`deletedAt\` IS NULL
     AND (b.\`deadline\` IS NULL OR b.\`deadline\` > UTC_TIMESTAMP())`,
    [toSqlUtc(now), actorUserId ?? null, actorNameSnapshot ?? '', offerId],
  );
  if (header.affectedRows === 0) {
    const db_ = await getDb();
    let offerStatus: string | null = null;
    if (db_) {
      const [row] = await db_.select({ status: communityBidOffers.status }).from(communityBidOffers).where(eq(communityBidOffers.id, offerId)).limit(1);
      offerStatus = row?.status ?? null;
    }
    if (offerStatus !== 'withdrawn') {
      throw Object.assign(new Error("投標紀錄狀態不符合，無法重新投標"), { code: "CONFLICT" });
    }
    throw Object.assign(new Error("此需求已截止或關閉，無法重新投標"), { code: "BID_UNAVAILABLE" });
  }
  if (Object.keys(updateFields).length > 0) {
    await updateCommunityBidOffer(offerId, updateFields, actorUserId, actorNameSnapshot);
  }
}

// For tests only: sets communityBids.deadline to a past timestamp.
export async function setTestBidDeadlinePast(bidId: number): Promise<void> {
  const pool = await getRawPool();
  await pool.execute(
    "UPDATE `communityBids` SET `deadline` = '2020-01-01 00:00:00' WHERE `id` = ?",
    [bidId],
  );
}

// For tests only: sets communityBids.status directly (bypasses state machine).
export async function setTestBidStatus(bidId: number, status: string): Promise<void> {
  const pool = await getRawPool();
  await pool.execute(
    "UPDATE `communityBids` SET `status` = ? WHERE `id` = ?",
    [status, bidId],
  );
}

export async function getCommunityBidOfferById(offerId: number): Promise<CommunityBidOffer | null> {
  const db_ = await getDb();
  if (!db_) return null;
  const rows = await db_.select()
    .from(communityBidOffers)
    .where(eq(communityBidOffers.id, offerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCommunityBidOfferByFactory(bidId: number, factoryId: number): Promise<CommunityBidOffer | null> {
  const db_ = await getDb();
  if (!db_) return null;
  const rows = await db_.select()
    .from(communityBidOffers)
    .where(and(
      eq(communityBidOffers.bidId, bidId),
      eq(communityBidOffers.bidderFactoryId, factoryId),
      isNull(communityBidOffers.deletedAt),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCommunityBidOfferByUser(bidId: number, userId: number): Promise<CommunityBidOffer | null> {
  const db_ = await getDb();
  if (!db_) return null;
  const rows = await db_.select()
    .from(communityBidOffers)
    .where(and(
      eq(communityBidOffers.bidId, bidId),
      eq(communityBidOffers.bidderUserId, userId),
      isNull(communityBidOffers.deletedAt),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCommunityBidOfferCount(bidId: number): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(communityBidOffers)
    .where(and(
      eq(communityBidOffers.bidId, bidId),
      eq(communityBidOffers.status, "active"),
      isNull(communityBidOffers.deletedAt),
    ));
  return Number(row?.n ?? 0);
}

export async function listCommunityBidOffersForOwner(bidId: number): Promise<CommunityBidOffer[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select()
    .from(communityBidOffers)
    .where(and(
      eq(communityBidOffers.bidId, bidId),
      isNull(communityBidOffers.deletedAt),
    ))
    .orderBy(desc(communityBidOffers.submittedAt));
}

// ===== 企業升級中心 =====

// ===== 企業升級中心：地區對應 =====

// 後端規範地區關鍵字，normalize 臺→台 後比對 location 字串
const REGION_KEYWORDS: Record<"north" | "central" | "south", string[]> = {
  north:   ["基隆", "台北", "新北", "桃園", "新竹", "宜蘭"],
  central: ["苗栗", "台中", "彰化", "南投"],
  south:   ["雲林", "嘉義", "台南", "高雄", "屏東", "澎湖"],
};

export function resolveRegionKey(location: string): "north" | "central" | "south" | null {
  const normalized = location.replace(/臺/g, "台").trim();
  for (const [key, keywords] of Object.entries(REGION_KEYWORDS) as [keyof typeof REGION_KEYWORDS, string[]][]) {
    if (keywords.some(k => normalized.includes(k))) return key;
  }
  return null;
}

// ===== 企業升級中心：顧問 =====

const CONSULTANT_SEEDS: Array<{ name: string; regionKey: "north" | "central" | "south"; serviceAreas: string[] }> = [
  {
    name: "北部顧問",
    regionKey: "north",
    serviceAreas: ["基隆市", "台北市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
  },
  {
    name: "齊力日川",
    regionKey: "central",
    serviceAreas: ["苗栗縣", "台中市", "臺中市", "彰化縣", "南投縣"],
  },
  {
    name: "南部顧問",
    regionKey: "south",
    serviceAreas: ["雲林縣", "嘉義市", "嘉義縣", "台南市", "臺南市", "高雄市", "屏東縣", "澎湖縣"],
  },
];

export async function ensureConsultantsSeeded(): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  for (const seed of CONSULTANT_SEEDS) {
    const existing = await db_.select({ id: upgradeConsultants.id })
      .from(upgradeConsultants)
      .where(eq(upgradeConsultants.regionKey, seed.regionKey))
      .limit(1);
    if (existing.length === 0) {
      await db_.insert(upgradeConsultants).values({
        name: seed.name,
        regionKey: seed.regionKey,
        serviceAreas: seed.serviceAreas,
        isActive: true,
      });
      console.log(`[upgrade] seeded consultant: ${seed.regionKey}`);
    }
  }
}

export type BoundUserInfo = { id: number; name: string | null; email: string | null; createdAt: Date };
export type ConsultantWithBoundUser = UpgradeConsultant & { boundUser: BoundUserInfo | null };

export async function listAllConsultants(): Promise<ConsultantWithBoundUser[]> {
  const db_ = await getDb();
  if (!db_) return [];

  const consultants = await db_.select().from(upgradeConsultants).orderBy(upgradeConsultants.regionKey);

  const userIds = consultants.map(c => c.userId).filter((id): id is number => id != null);
  const userMap = new Map<number, BoundUserInfo>();

  if (userIds.length > 0) {
    // LINE／Apple 登入的使用者 users.email 可能一直是 null（只有 Google 登入才會
    // 自動寫入），真正可聯絡的信箱是使用者自行驗證過的 primaryEmail。與專案其他
    // 讀信箱邏輯（如 getRecipientsWithEmails）一致，統一 COALESCE(primaryEmail, email)。
    const fetched = await db_
      .select({
        id: users.id,
        name: users.name,
        email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})`,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(inArray(users.id, userIds));
    fetched.forEach(u => userMap.set(u.id, u));
  }

  return consultants.map(c => ({
    ...c,
    boundUser: c.userId != null ? (userMap.get(c.userId) ?? null) : null,
  }));
}

export async function getConsultantByRegion(regionKey: "north" | "central" | "south"): Promise<UpgradeConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(upgradeConsultants)
    .where(and(eq(upgradeConsultants.regionKey, regionKey), eq(upgradeConsultants.isActive, true)))
    .limit(1);
  return row;
}

export async function getConsultantsByUserId(userId: number): Promise<UpgradeConsultant[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(upgradeConsultants)
    .where(eq(upgradeConsultants.userId, userId));
}

export async function bindConsultantUser(consultantId: number, userId: number | null): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeConsultants)
    .set({ userId })
    .where(eq(upgradeConsultants.id, consultantId));
}

export async function getConsultantById(id: number): Promise<UpgradeConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(upgradeConsultants).where(eq(upgradeConsultants.id, id));
  return row;
}

// Backfill existing unassigned cases to a newly-bound consultant.
// Only processes status="unassigned" cases whose location resolves to the consultant's regionKey.
// Each case gets assignedConsultantId, status="new", and statusTimeline.new (only if not already set).
export async function backfillUnassignedCasesToConsultant(
  consultantId: number,
  regionKey: "north" | "central" | "south",
): Promise<{ backfilledIds: number[]; backfilledApps: UpgradeApplication[] }> {
  const db_ = await getDb();
  if (!db_) return { backfilledIds: [], backfilledApps: [] };

  const candidates = await db_.select()
    .from(upgradeApplications)
    .where(and(
      eq(upgradeApplications.status, "unassigned"),
      isNull(upgradeApplications.assignedConsultantId),
    ));

  const matching = candidates.filter(app => resolveRegionKey(app.location) === regionKey);
  if (matching.length === 0) return { backfilledIds: [], backfilledApps: [] };

  const nowIso = new Date().toISOString();
  const backfilledIds: number[] = [];
  const backfilledApps: UpgradeApplication[] = [];

  for (const app of matching) {
    const existingTl = (app.statusTimeline ?? {}) as Record<string, string>;
    const newTl = { ...existingTl };
    if (!newTl.new) newTl.new = nowIso;

    await db_.update(upgradeApplications)
      .set({ assignedConsultantId: consultantId, status: "new", statusTimeline: newTl })
      .where(eq(upgradeApplications.id, app.id));

    backfilledIds.push(app.id);
    backfilledApps.push({ ...app, assignedConsultantId: consultantId, status: "new", statusTimeline: newTl });
  }

  return { backfilledIds, backfilledApps };
}

export async function listApplicationsByConsultantIds(
  consultantIds: number[],
  opts?: { status?: UpgradeApplication["status"]; limit?: number; offset?: number },
): Promise<(UpgradeApplication & { factoryName: string | null })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (consultantIds.length === 0) return [];
  const conditions: ReturnType<typeof eq>[] = [
    inArray(upgradeApplications.assignedConsultantId, consultantIds) as any,
  ];
  if (opts?.status) conditions.push(eq(upgradeApplications.status, opts.status) as any);
  const rows = await db_.select({
    ...getTableColumns(upgradeApplications),
    factoryName: factories.name,
  })
    .from(upgradeApplications)
    .leftJoin(factories, eq(upgradeApplications.factoryId, factories.id))
    .where(and(...conditions))
    .orderBy(desc(upgradeApplications.createdAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
  return rows as (UpgradeApplication & { factoryName: string | null })[];
}

export async function countApplicationsByConsultantIds(
  consultantIds: number[],
  status?: UpgradeApplication["status"],
): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  if (consultantIds.length === 0) return 0;
  const conditions: any[] = [inArray(upgradeApplications.assignedConsultantId, consultantIds)];
  if (status) conditions.push(eq(upgradeApplications.status, status));
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(and(...conditions));
  return Number(row?.n ?? 0);
}

export async function acknowledgeUpgradeApplication(
  id: number,
  consultantId: number,
  userId: number,
): Promise<{ ok: boolean }> {
  const db_ = await getDb();
  if (!db_) return { ok: false };
  // Only allow if the application is assigned to this consultant and still "new"
  const [row] = await db_.select()
    .from(upgradeApplications)
    .where(and(
      eq(upgradeApplications.id, id),
      eq(upgradeApplications.assignedConsultantId, consultantId),
      eq(upgradeApplications.status, "new"),
    ));
  if (!row) return { ok: false };
  const now = new Date();
  const existingTl = (row.statusTimeline ?? {}) as Record<string, string>;
  const newTl = { ...existingTl };
  if (!newTl.evaluating) newTl.evaluating = now.toISOString();
  // Only set viewedAt / viewedByUserId on first acknowledge — never overwrite
  const firstView = row.viewedAt == null;
  await db_.update(upgradeApplications)
    .set({
      status: "evaluating",
      ...(firstView ? { viewedAt: now, viewedByUserId: userId } : {}),
      statusTimeline: newTl,
    })
    .where(eq(upgradeApplications.id, id));
  return { ok: true };
}

export async function adminGetUpgradeStats(): Promise<{
  total: number;
  byRegion: Record<string, {
    consultantName: string;
    total: number;
    unviewed: number;
    inProgress: number;
    submitted: number;
    completed: number;
    ineligible: number;
  }>;
  unviewed: number;
  overdue48h: number;
  unassigned: number;
}> {
  const db_ = await getDb();
  if (!db_) return { total: 0, byRegion: {}, unviewed: 0, overdue48h: 0, unassigned: 0 };

  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Single query: status breakdown per region
  const regionStatusRows = await db_.select({
    regionKey: upgradeConsultants.regionKey,
    consultantName: upgradeConsultants.name,
    status: upgradeApplications.status,
    n: sql<number>`COUNT(*)`,
  })
    .from(upgradeApplications)
    .innerJoin(upgradeConsultants, eq(upgradeApplications.assignedConsultantId, upgradeConsultants.id))
    .groupBy(upgradeConsultants.regionKey, upgradeConsultants.name, upgradeApplications.status);

  const byRegion: Record<string, {
    consultantName: string; total: number; unviewed: number;
    inProgress: number; submitted: number; completed: number; ineligible: number;
  }> = {};
  for (const r of regionStatusRows) {
    if (!byRegion[r.regionKey]) {
      byRegion[r.regionKey] = {
        consultantName: r.consultantName,
        total: 0, unviewed: 0, inProgress: 0, submitted: 0, completed: 0, ineligible: 0,
      };
    }
    const count = Number(r.n);
    byRegion[r.regionKey].total += count;
    if (r.status === "new") byRegion[r.regionKey].unviewed += count;
    // 評估中/已立案（含舊狀態 viewed/contacted/consulting）
    if (["evaluating", "viewed", "contacted", "accepted", "consulting"].includes(r.status))
      byRegion[r.regionKey].inProgress += count;
    // 送件及政府審核流程中
    if (["submitted", "rejected", "approved", "transforming"].includes(r.status))
      byRegion[r.regionKey].submitted += count;
    if (r.status === "completed") byRegion[r.regionKey].completed += count;
    if (r.status === "ineligible") byRegion[r.regionKey].ineligible += count;
  }

  const [{ total }] = await db_.select({ total: sql<number>`COUNT(*)` })
    .from(upgradeApplications);

  const [{ unviewed }] = await db_.select({ unviewed: sql<number>`COUNT(*)` })
    .from(upgradeApplications).where(eq(upgradeApplications.status, "new"));

  const [{ overdue48h }] = await db_.select({ overdue48h: sql<number>`COUNT(*)` })
    .from(upgradeApplications).where(and(
      eq(upgradeApplications.status, "new"),
      sql`${upgradeApplications.createdAt} < ${cutoff48h}`,
    ));

  const [{ unassigned }] = await db_.select({ unassigned: sql<number>`COUNT(*)` })
    .from(upgradeApplications).where(eq(upgradeApplications.status, "unassigned"));

  return {
    total: Number(total),
    byRegion,
    unviewed: Number(unviewed),
    overdue48h: Number(overdue48h),
    unassigned: Number(unassigned),
  };
}

export async function findRecentUpgradeApplication(
  email: string,
  phone: string,
  withinMs = 10 * 60 * 1000,
): Promise<boolean> {
  const db_ = await getDb();
  if (!db_) return false;
  const cutoff = new Date(Date.now() - withinMs);
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(and(
      eq(upgradeApplications.email, email),
      eq(upgradeApplications.phone, phone),
      gt(upgradeApplications.createdAt, cutoff),
    ));
  return Number(row?.n ?? 0) > 0;
}

export async function createUpgradeApplication(
  data: InsertUpgradeApplication,
): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(upgradeApplications).values(data);
  return result.insertId;
}

export async function listUpgradeApplications(opts?: {
  status?: UpgradeApplication["status"];
  limit?: number;
  offset?: number;
}): Promise<(UpgradeApplication & { factoryName: string | null })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(upgradeApplications.status, opts.status)] : [];
  const rows = await db_.select({
    ...getTableColumns(upgradeApplications),
    factoryName: factories.name,
  })
    .from(upgradeApplications)
    .leftJoin(factories, eq(upgradeApplications.factoryId, factories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(upgradeApplications.createdAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
  return rows as (UpgradeApplication & { factoryName: string | null })[];
}

export async function getUpgradeApplicationById(id: number): Promise<UpgradeApplication | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(upgradeApplications).where(eq(upgradeApplications.id, id));
  return row;
}

export async function updateUpgradeApplicationStatus(
  id: number,
  status: UpgradeApplication["status"],
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const [cur] = await db_
    .select({ tl: upgradeApplications.statusTimeline })
    .from(upgradeApplications)
    .where(eq(upgradeApplications.id, id));
  const existing = (cur?.tl ?? {}) as Record<string, string>;
  const newTl = { ...existing };
  // Only record first entry time — never overwrite once a status has been reached
  if (!newTl[status]) newTl[status] = new Date().toISOString();
  await db_.update(upgradeApplications)
    .set({ status, statusTimeline: newTl })
    .where(eq(upgradeApplications.id, id));
}

export async function updateUpgradeCaseNotes(id: number, notes: string | null): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeApplications).set({ notes }).where(eq(upgradeApplications.id, id));
}

export async function updateCaseAmounts(
  id: number,
  data: {
    plannedSubsidyAmount?: number | null;
    approvedSubsidyAmount?: number | null;
    consultantFeeMode?: string | null;
    consultantFeePercentage?: string | null;
    consultantFeeAmount?: number | null;
    oxmCommissionRate?: string | null;
    oxmCommissionAmount?: number | null;
    submittedSubsidyProgram?: string | null;
    submittedSubsidyProgramOther?: string | null;
  },
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const update: Partial<{
    plannedSubsidyAmount: number | null;
    approvedSubsidyAmount: number | null;
    consultantFeeMode: string | null;
    consultantFeePercentage: string | null;
    consultantFeeAmount: number | null;
    oxmCommissionRate: string | null;
    oxmCommissionAmount: number | null;
    submittedSubsidyProgram: string | null;
    submittedSubsidyProgramOther: string | null;
  }> = {};
  if ("plannedSubsidyAmount" in data)         update.plannedSubsidyAmount         = data.plannedSubsidyAmount;
  if ("approvedSubsidyAmount" in data)        update.approvedSubsidyAmount        = data.approvedSubsidyAmount;
  if ("consultantFeeMode" in data)            update.consultantFeeMode            = data.consultantFeeMode;
  if ("consultantFeePercentage" in data)      update.consultantFeePercentage      = data.consultantFeePercentage;
  if ("consultantFeeAmount" in data)          update.consultantFeeAmount          = data.consultantFeeAmount;
  if ("oxmCommissionRate" in data)            update.oxmCommissionRate            = data.oxmCommissionRate;
  if ("oxmCommissionAmount" in data)          update.oxmCommissionAmount          = data.oxmCommissionAmount;
  if ("submittedSubsidyProgram" in data)      update.submittedSubsidyProgram      = data.submittedSubsidyProgram;
  if ("submittedSubsidyProgramOther" in data) update.submittedSubsidyProgramOther = data.submittedSubsidyProgramOther;
  if (Object.keys(update).length === 0) return;
  await db_.update(upgradeApplications).set(update).where(eq(upgradeApplications.id, id));
}

// 政府駁回時清除「實際過案金額」與「顧問服務費/OXM收入」，避免語意矛盾
export async function clearApprovalAndFeeData(id: number): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeApplications).set({
    approvedSubsidyAmount: null,
    consultantFeeMode: null,
    consultantFeePercentage: null,
    consultantFeeAmount: null,
    oxmCommissionAmount: null,
    submittedSubsidyProgram: null,
    submittedSubsidyProgramOther: null,
  }).where(eq(upgradeApplications.id, id));
}

export async function countUpgradeApplications(status?: UpgradeApplication["status"]): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const conditions = status ? [eq(upgradeApplications.status, status)] : [];
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.n ?? 0);
}

// 過件率分母：顧問「已經手評估」的案件 —— 明確列舉真正代表已開始評估或更後續流程的狀態，
// 不用「排除 new/unassigned」的寬鬆寫法，避免 archived 等例外狀態被誤算進去。
//   evaluating/viewed/contacted：顧問評估中（viewed/contacted 為舊資料的同義字）
//   ineligible：顧問評估後判定資格不符（已評估過，但不算立案）
//   accepted/consulting：已立案處理（consulting 為舊資料的同義字）
//   submitted：已送出政府審核
//   rejected：政府駁回（已評估、已立案、已送審，但最終未過件）
//   approved/transforming/completed：政府核准／企業轉型中／案件結案
// 不列入：new（等待查收）、unassigned（等待分派）、archived（管理員可能在任何階段封存，
// 無法確定是否已評估過，不可一律算入）。
const UPGRADE_EVALUATED_STATUSES = [
  "evaluating", "viewed", "contacted",
  "ineligible",
  "accepted", "consulting",
  "submitted",
  "rejected",
  "approved", "transforming", "completed",
] as const;

// 過件率分子：已正式進入立案／服務流程的案件 —— 只計入真正的立案結果，
// 不包含評估後的負向結果（ineligible 資格不符、rejected 政府駁回）與 archived（無法確認是否曾評估）。
const UPGRADE_ACCEPTED_STATUSES = [
  "accepted", "consulting",
  "submitted",
  "approved", "transforming", "completed",
] as const;

export async function getUpgradePublicStats() {
  const db_ = await getDb();
  if (!db_) return { appliedFactories: 0, acceptedCases: 0, evaluatedCases: 0, totalGrantAmountYen: 0, completedCases: 0 };

  // 申請廠商：distinct factoryId（排除未綁定工廠的邊緣案件）
  const [fRow] = await db_
    .select({ n: sql<number>`COUNT(DISTINCT ${upgradeApplications.factoryId})` })
    .from(upgradeApplications)
    .where(isNotNull(upgradeApplications.factoryId));

  // 顧問已經手評估案件數 —— 過件率分母
  const [eRow] = await db_
    .select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(inArray(upgradeApplications.status, UPGRADE_EVALUATED_STATUSES));

  // acceptedCases：已正式立案處理案件數（accepted/consulting/submitted/approved/transforming/completed）——
  // 過件率分子。注意這裡代表「已正式進入立案／服務流程」，不是僅指「政府核准補助」的案件數，
  // 因此命名為 acceptedCases 而非 approvedCases，避免與 approved 這個 status 名稱混淆。
  const [aRow] = await db_
    .select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(inArray(upgradeApplications.status, UPGRADE_ACCEPTED_STATUSES));

  // 累積補助金額：企業轉型中、案件結案（含 legacy approved）且已填入實際過案金額的案件加總（單位：元）
  const [gRow] = await db_
    .select({ n: sql<number>`COALESCE(SUM(${upgradeApplications.approvedSubsidyAmount}), 0)` })
    .from(upgradeApplications)
    .where(inArray(upgradeApplications.status, ["transforming", "completed", "approved"]));

  // 已結案：status = completed
  const [cRow] = await db_
    .select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(eq(upgradeApplications.status, "completed"));

  return {
    appliedFactories: Number(fRow?.n ?? 0),
    acceptedCases: Number(aRow?.n ?? 0),
    evaluatedCases: Number(eRow?.n ?? 0),
    totalGrantAmountYen: Number(gRow?.n ?? 0),
    completedCases: Number(cRow?.n ?? 0),
  };
}

export async function getUpgradeApplicationsByFactoryIds(
  factoryIds: number[],
): Promise<UpgradeApplication[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (factoryIds.length === 0) return [];
  const rows = await db_.select()
    .from(upgradeApplications)
    .where(inArray(upgradeApplications.factoryId, factoryIds))
    .orderBy(desc(upgradeApplications.createdAt));
  return rows;
}

// ── 首次接觸判斷：判斷兩個 userId 之間是否曾有任一方向的訊息紀錄
// 必須在新訊息寫入前呼叫，否則新訊息本身會被誤判為歷史紀錄
export async function hasContactBetweenUsers(userIdA: number, userIdB: number): Promise<boolean> {
  if (userIdA === userIdB) return true;
  const db_ = await getDb();
  if (!db_) return false;

  // Case 1: A sent as factory side, B is the buyer in that conversation
  const [r1] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.senderId, userIdA), eq(conversations.userId, userIdB)))
    .limit(1);
  if (r1) return true;

  // Case 2: B sent as factory side, A is the buyer in that conversation
  const [r2] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.senderId, userIdB), eq(conversations.userId, userIdA)))
    .limit(1);
  if (r2) return true;

  // Case 3: A sent as buyer to a factory owned by B
  const [r3] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(factories, eq(conversations.factoryId, factories.id))
    .where(and(
      eq(messages.senderId, userIdA),
      eq(conversations.userId, userIdA),
      eq(factories.ownerId, userIdB),
    ))
    .limit(1);
  if (r3) return true;

  // Case 4: B sent as buyer to a factory owned by A
  const [r4] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(factories, eq(conversations.factoryId, factories.id))
    .where(and(
      eq(messages.senderId, userIdB),
      eq(conversations.userId, userIdB),
      eq(factories.ownerId, userIdA),
    ))
    .limit(1);
  if (r4) return true;

  // Case 5: A sent as buyer to a factory co-managed by B
  const [r5] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(
      factoryCoManagers,
      and(
        eq(factoryCoManagers.factoryId, conversations.factoryId),
        eq(factoryCoManagers.userId, userIdB),
        isNull(factoryCoManagers.removedAt),
      ),
    )
    .where(and(eq(messages.senderId, userIdA), eq(conversations.userId, userIdA)))
    .limit(1);
  if (r5) return true;

  // Case 6: B sent as buyer to a factory co-managed by A
  const [r6] = await db_.select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(
      factoryCoManagers,
      and(
        eq(factoryCoManagers.factoryId, conversations.factoryId),
        eq(factoryCoManagers.userId, userIdA),
        isNull(factoryCoManagers.removedAt),
      ),
    )
    .where(and(eq(messages.senderId, userIdB), eq(conversations.userId, userIdB)))
    .limit(1);
  if (r6) return true;

  return false;
}
