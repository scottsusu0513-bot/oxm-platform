import { eq, and, like, desc, asc, sql, inArray, or, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser, users, factories, products, productCategories,
  conversations, conversations as conversationsTable,
  messages, messages as messagesTable,
  reviews, reviews as reviewsTable,
  advertisements, advertisements as advertisementsTable,
  favorites, factoryPhotos, reports, supportTickets, reportStatusHistory, ticketStatusHistory,
  announcements, pageViews,
  factoryCoManagerInvitations, factoryCoManagers,
  type Factory, type InsertFactory, type Product, type InsertProduct, type Favorite, type InsertFavorite
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { ADJACENT_REGIONS } from "../shared/constants";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: mysql.Pool | null = null;

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
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const { industry, subIndustry, region, capitalLevel, mfgMode, keyword, businessType, page = 1, pageSize = 20, sortBy } = params;

  const conditions = [eq(factories.status, 'approved')];
  if (industry && industry.length > 0) {
    conditions.push(sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify(industry)})`);
  }
  if (subIndustry && subIndustry.length > 0) {
    const subConditions = subIndustry.map(s => sql`JSON_CONTAINS(${factories.subIndustry}, ${JSON.stringify([s])})`);
    conditions.push(or(...subConditions)!);
  }
  if (businessType) conditions.push(eq(factories.businessType, businessType as "factory" | "studio"));
  if (region && region.length > 0) conditions.push(inArray(factories.region, region));
  if (capitalLevel && capitalLevel.length > 0) conditions.push(inArray(factories.capitalLevel, capitalLevel));
  if (mfgMode) conditions.push(sql`JSON_CONTAINS(${factories.mfgModes}, ${JSON.stringify([mfgMode])})`);

  if (keyword) {
    const keywordConditions = [
      like(factories.name, `%${keyword}%`),
      like(factories.description, `%${keyword}%`),
      sql`JSON_SEARCH(${factories.industry}, 'one', ${`%${keyword}%`}) IS NOT NULL`,
    ];
    conditions.push(or(...keywordConditions)!);
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
  }).from(reviews).leftJoin(users, eq(reviews.userId, users.id))
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
        like(users.email, `%${search}%`)
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
  return { items, total, page, pageSize };
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
export async function saveMessage(conversationId: number, senderId: number, senderRole: "user" | "factory", content: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(messages).values({ conversationId, senderId, senderRole, content });
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
  const existing = await db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.factoryId, factoryId));
  if (existing.length >= 20) throw new Error("分類最多 20 個");
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
  await db.update(users).set({ notificationSettings: settings }).where(eq(users.id, userId));
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

    // 檢查是否已為 active co-manager
    const [existing]: any = await conn.execute(
      "SELECT id FROM factoryCoManagers WHERE factoryId = ? AND userId = ? AND removedAt IS NULL",
      [inv.factoryId, inviteeUserId]
    );
    if (existing && existing.length > 0) {
      throw new Error("您已是此工廠的次管理者");
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
