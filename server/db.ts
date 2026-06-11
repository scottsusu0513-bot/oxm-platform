import { eq, and, like, desc, asc, sql, inArray, or, isNull, gt, isNotNull } from "drizzle-orm";
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
  announcements, pageViews,
  factoryCoManagerInvitations, factoryCoManagers,
  inquiryBatches, inquiryBatchItems,
  messageCampaigns, messageRecipients, messageReplies,
  oauthStates, appLoginTickets, collaborationOrders,
  userAuthAccounts, emailVerificationTokens,
  pushNotificationTokens,
  factoryRevisions,
  communityPosts, communityComments,
  type Factory, type InsertFactory, type Product, type InsertProduct, type Favorite, type InsertFavorite,
  type CommunityPost, type CommunityComment,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { ADJACENT_REGIONS } from "../shared/constants";
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
function twDateStr(offsetDays = 0): string {
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

  const items = rows.map(r => ({ ...r.factory, ownerAccountName: r.ownerAccountName, ownerAccountEmail: r.ownerAccountEmail }));
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

  const enriched = items.map(u => ({
    ...u,
    hasVerifiedPrimaryEmail: !!u.primaryEmailVerifiedAt,
    hasGoogleLinked: googleSet.has(u.id),
    hasLineLinked: lineSet.has(u.id),
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
    .select({ id: factories.id, name: factories.name })
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

export async function createAnnouncement(data: { title: string; content: string; type: "update" | "maintenance" | "news"; isPinned?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(announcements).values(data);
  return result[0].insertId;
}

export async function updateAnnouncement(id: number, data: Partial<{ title: string; content: string; type: "update" | "maintenance" | "news"; isPinned: boolean }>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(announcements).set(data).where(eq(announcements.id, id));
}

export async function deleteAnnouncement(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(announcements).where(eq(announcements.id, id));
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

  const factoryList = await db.select({ id: factories.id, name: factories.name })
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
    .select({ userId: users.id, email: users.email, name: users.name, notificationSettings: users.notificationSettings })
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
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(isNull(users.deletedAt), or(like(users.name, pattern), like(users.email, pattern))))
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
  return (result as any).insertId as number;
}

export async function getCollaborationOrderById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(collaborationOrders).where(eq(collaborationOrders.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function respondCollaborationOrder(id: number, action: "accepted" | "rejected"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  if (action === "accepted") {
    await db.update(collaborationOrders).set({ status: "accepted", acceptedAt: now }).where(eq(collaborationOrders.id, id));
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
    acceptedAt: collaborationOrders.acceptedAt,
    rejectedAt: collaborationOrders.rejectedAt,
    completedAt: collaborationOrders.completedAt,
    cancelledAt: collaborationOrders.cancelledAt,
    cancelRequestedByUserId: collaborationOrders.cancelRequestedByUserId,
    cancelRequestedAt: collaborationOrders.cancelRequestedAt,
    cancelRequestReason: collaborationOrders.cancelRequestReason,
    cancelRequestedFromStatus: collaborationOrders.cancelRequestedFromStatus,
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
