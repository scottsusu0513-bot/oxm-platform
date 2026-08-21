import { eq, and, like, desc, asc, sql, inArray, or, isNull, gt, gte, isNotNull, lte, ne, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { createHash, randomUUID } from "crypto";
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
  financeApplications, financeConsultants,
  news, newsIndustries, newsNotifications, newsAttachments, newsReads, newsBoardSubscriptions,
  certificationServiceCategories, certificationServiceItems,
  shortVideoCases, shortVideoConsultants,
  certificationCases, certificationConsultants,
  erpCases, erpConsultants,
  type Factory, type InsertFactory, type Product, type InsertProduct, type Favorite, type InsertFavorite,
  type Conversation,
  type CommunityPost, type CommunityComment,
  type CommunityBoardFollow, type FactoryFollow, type CommunityContentFollow,
  type CommunityReaction, type CommunityMention, type CommunityNotification,
  type CommunityBid, type CommunityBidReviewHistory, type CommunityBidOffer,
  type UpgradeApplication, type InsertUpgradeApplication,
  type UpgradeConsultant,
  type FinanceApplication, type InsertFinanceApplication,
  type FinanceConsultant,
  type Announcement,
  type News, type InsertNews, type NewsAttachment,
  type CertificationServiceCategory, type CertificationServiceItem,
  type ShortVideoCase, type InsertShortVideoCase,
  type ShortVideoConsultant,
  type CertificationCase, type InsertCertificationCase,
  type CertificationConsultant,
  type ErpCase, type InsertErpCase,
  type ErpConsultant,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import type { ImageCropData } from "../shared/imageCrop";
import { ADJACENT_REGIONS, INDUSTRY_SLUGS, INDUSTRY_OPTIONS } from "../shared/constants";
import { COMMUNITY_FEATURE_STATUS, COMMUNITY_CROSS_INDUSTRY_SLUG, NEWS_NEW_WINDOW_MS, ADVISOR_DISPLAY_NAME } from "../shared/const";
import { sortBadgeIds, sanitizeBadgeAssignment, appendCertificationEvidenceImage } from "../shared/badges";
import { CERTIFICATION_SERVICE_CATEGORY_SEEDS, CERTIFICATION_SERVICE_ITEM_SEEDS } from "../shared/certificationServices";
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

  // 徽章系統：badges/evidence 一律成對送出（呼叫端固定同時帶兩個欄位），
  // evidence 依「目前這次要儲存的 badges」做白名單清洗，避免殘留已移除徽章的證明資料。
  if ("certificationBadges" in data || "certificationEvidence" in data) {
    const { certificationBadges, certificationEvidence } = sanitizeBadgeAssignment(
      (data as any).certificationBadges,
      (data as any).certificationEvidence,
    );
    (normalized as any).certificationBadges = certificationBadges;
    (normalized as any).certificationEvidence = certificationEvidence;
  }

  if (ownerId === -1) {
    await db.update(factories).set(normalized).where(eq(factories.id, id));
  } else {
    await db.update(factories).set(normalized).where(and(eq(factories.id, id), eq(factories.ownerId, ownerId)));
  }
}

/**
 * 工廠審核通過（首次上線）：若先前不是 approved，目前 certificationBadges
 * 全部視為這次一併新獲得的徽章，預設全部公開顯示（見任務規則「審核通過後
 * 才加入已獲得徽章，並預設公開顯示」）。若工廠先前就已是 approved（理論上
 * 不會從 approved 被改回其他狀態，這裡僅防禦性處理），不重置既有顯示設定。
 */
export async function approveFactoryWithBadgeSync(factoryId: number): Promise<void> {
  const beforeApproval = await getFactoryById(factoryId);
  const updateData: Record<string, any> = { status: 'approved' };
  if (beforeApproval && beforeApproval.status !== 'approved') {
    updateData.certificationBadgesVisible = Array.isArray(beforeApproval.certificationBadges) ? beforeApproval.certificationBadges : [];
  }
  await updateFactory(factoryId, -1, updateData);
}

/**
 * 徽章「公開顯示」切換：certificationBadgesVisible 一律強制交集
 * certificationBadges（已獲得徽章），伺服器端自己重新驗證，不相信呼叫端
 * 傳入的陣列已經是合法子集合（防止繞過前端限制直接偽造顯示未獲得的徽章）。
 * 不透過 updateFactory()——那支函式只在 data 帶有 certificationBadges／
 * certificationEvidence 任一欄位時才處理徽章相關欄位，這裡只想單純切換
 * 顯示設定，不應該、也不需要一併帶入 certificationBadges。
 */
export async function updateVisibleBadges(factoryId: number, requestedVisibleIds: string[]): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const factory = await getFactoryById(factoryId);
  if (!factory) throw new Error("找不到工廠");
  const owned = new Set(Array.isArray(factory.certificationBadges) ? (factory.certificationBadges as string[]) : []);
  const sanitizedVisible = sortBadgeIds(requestedVisibleIds.filter(id => owned.has(id)));
  await db.update(factories).set({ certificationBadgesVisible: sanitizedVisible }).where(eq(factories.id, factoryId));
  return sanitizedVisible;
}

/**
 * 徽章證明圖片上傳成功「當下」直接把 object key 綁進 certificationEvidence，
 * 不經過工廠端（見 server/routers.ts 的 uploadBadgeEvidence）。用
 * SELECT ... FOR UPDATE 鎖住該筆工廠列再讀取目前的 certificationEvidence，
 * 確保同一工廠短時間內連續／併發上傳多張圖片時，每次附加都是基於「最新」
 * 的陣列內容做 read-modify-write，不會因為兩個請求都讀到同一份舊資料，
 * 其中一次寫入把另一次剛附加的 key 覆蓋掉（lost update）。
 * 刻意不透過 updateFactory()——那支函式在 data 帶有 certificationBadges／
 * certificationEvidence 任一欄位時，會用「目前要儲存的 badges 清單」重新
 * 白名單過濁 evidence（sanitizeBadgeAssignment），這裡只想單純附加一張
 * 圖片到既有陣列，不應該、也不需要一併帶入 certificationBadges。
 */
export async function appendFactoryCertificationEvidenceImage(
  factoryId: number,
  badgeId: string,
  newKey: string,
): Promise<import("../shared/badges").AppendEvidenceImageResult | { ok: false; reason: "NOT_FOUND" }> {
  await getDb();
  const pool = _pool;
  if (!pool) throw new Error("DB not available");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]: any = await conn.execute(
      "SELECT certificationEvidence FROM factories WHERE id = ? FOR UPDATE",
      [factoryId],
    );
    if (!rows || rows.length === 0) {
      await conn.rollback();
      return { ok: false, reason: "NOT_FOUND" };
    }
    const raw = rows[0].certificationEvidence;
    const existing = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = appendCertificationEvidenceImage(existing, badgeId, newKey);
    if (!result.ok) {
      await conn.rollback();
      return result;
    }
    await conn.execute(
      "UPDATE factories SET certificationEvidence = ?, updatedAt = NOW() WHERE id = ?",
      [JSON.stringify(result.evidence), factoryId],
    );
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
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

/**
 * Hard Filter / Ranking Signal 責任分離（見對話中「Phase 6A 搜尋邏輯修正：
 * Hard Filters + AI Ranking」）：rankingSignals（例如「CNC」「五軸加工」這類
 * 能力／技術詞）只用來排序，絕對不能拿來排除候選——candidates 已經是通過
 * SQL 層 hard filters（industry/subIndustry/region/businessType/...）篩過的
 * 集合，這裡只是決定「誰排前面」，不是「誰能不能出現」。
 *
 * 3 層：
 * 2（高度相關）：rankingSignal 明確出現在工廠 description 或任一商品文字。
 * 1（可能相關）：沒有明確文字命中，但工廠的 subIndustry 落在
 *    relatedSubIndustries（通常是聊天端既有 intent.subIndustries，帶著「這個
 *    能力詞語意上屬於哪個子產業」的關聯性，非使用者明講、不能當 hard filter，
 *    但可以當排序的次要訊號）。
 * 0（其他符合條件）：只符合 hard filters，公開資料無法確認能力相關性——仍然
 *    保留在結果內，不得被刪除（見「不要顯示不適合，只是資料不足以判斷」）。
 */
function computeRankingTier(
  factory: Factory,
  productTexts: string[],
  rankingSignals: string[],
  relatedSubIndustries: string[],
): 0 | 1 | 2 {
  if (rankingSignals.length === 0) return 1;
  const lowerSignals = rankingSignals.map(s => s.toLowerCase()).filter(Boolean);
  if (lowerSignals.length === 0) return 1;
  const haystack = `${factory.description ?? ''} ${productTexts.join(' ')}`.toLowerCase();
  const explicitMatch = lowerSignals.some(sig => haystack.includes(sig));
  if (explicitMatch) return 2;
  const relatedMatch = relatedSubIndustries.length > 0 &&
    ((factory.subIndustry ?? []) as string[]).some(s => relatedSubIndustries.includes(s));
  if (relatedMatch) return 1;
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
  /**
   * 能力／技術詞（例如「CNC」「五軸加工」），只用來在 hard-filter 候選集合內
   * 排序，絕對不會出現在 SQL WHERE 排除條件裡——跟 keyword 語意不同：keyword
   * 是既有 /search 手動關鍵字框「沒有其他 hard filter 時，關鍵字本身就是唯一
   * 篩選依據」的既有行為，維持不變；rankingSignals 是 Phase 6A「Hard Filter
   * 決定候選集合、AI Ranking 決定排序」新增的、絕不排除候選的排序訊號。呼叫端
   * 不應該同時傳 keyword 又傳 rankingSignals（見 server/ai/factorySearchAction.ts
   * 與 routers.ts 的 factory.search 的 q 參數）。
   */
  rankingSignals?: string[];
}): Promise<{
  items: Factory[];
  total: number;
  tiers?: (0 | 1 | 2)[];
  /** 候選集合（未分頁前，最多 AI_CANDIDATE_LIMIT 筆）中，公開資料明確符合
   * 「全部」rankingSignals 的工廠數——Phase 6A.1 判斷是否需要人工協尋的依據。 */
  directCapabilityMatchCount?: number;
  /** rankingSignals 裡，全部候選都找不到任何明確文字證據的能力詞。 */
  missingCapabilities?: string[];
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const {
    industry, subIndustry, region, capitalLevel, mfgMode, keyword,
    businessType, page = 1, pageSize = 20, sortBy,
    intent, userHasSelectedIndustry = false, rankingSignals,
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

  // === Hard Filter + AI Ranking（不排除候選，只排序）===
  // rankingSignals 存在時，候選集合完全由上面已經組好的 hard filter
  // conditions 決定（status/industry/subIndustry/region/businessType/
  // capitalLevel/mfgMode），不額外加任何 OR 內容比對條件去縮小 WHERE——避免
  // 重蹈「能力詞被當成硬性篩選，符合地區+產業但商品文字沒提到關鍵字的工廠被
  // 整個排除」的舊問題（見對話中「不要用 AI 過度篩掉候選」）。
  if (rankingSignals && rankingSignals.length > 0) {
    const whereClause = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(factories).where(whereClause);
    const total = Number(countResult?.count ?? 0);

    const candidates = await db.select().from(factories).where(whereClause)
      .orderBy(desc(factories.avgRating), desc(factories.reviewCount))
      .limit(AI_CANDIDATE_LIMIT);

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

    // relatedSubIndustries：只有聊天端（已經有完整 intent）才帶得出這個「能力詞
    // 語意上屬於哪個子產業」的次要排序訊號；/search 頁純靠 q 參數重建
    // rankingSignals 時沒有 intent，退化成只看「明確文字命中」兩層，仍然正確、
    // 不需要為此另外呼叫一次 LLM（見「不要新增 LLM call」）。
    const relatedSubIndustries = intent?.subIndustries ?? [];
    const lowerSignals = rankingSignals.map(s => s.toLowerCase()).filter(Boolean);
    const scored = candidates.map(f => {
      const haystack = `${f.description ?? ''} ${(productMap.get(f.id) ?? []).join(' ')}`.toLowerCase();
      // 每個 candidate 對「每一個」ranking signal 各自獨立判斷是否有明確文字
      // 命中（Phase 6A.1「Direct Capability Evidence」）——CNC 跟五軸各自分開
      // 判斷，不是「命中任何一個就算全部命中」，見 factorySearchRequestService.ts
      // 的 Trigger B/C 說明。
      const matchedSignals = new Set(lowerSignals.filter(sig => haystack.includes(sig)));
      return {
        factory: f,
        tier: computeRankingTier(f, productMap.get(f.id) ?? [], rankingSignals, relatedSubIndustries),
        matchesAllSignals: lowerSignals.length > 0 && matchedSignals.size === lowerSignals.length,
        matchedSignals,
      };
    });

    scored.sort((a, b) => {
      if (b.tier !== a.tier)                                   return b.tier - a.tier;
      const rDiff = Number(b.factory.avgRating ?? 0) - Number(a.factory.avgRating ?? 0);
      if (rDiff !== 0)                                         return rDiff;
      const rcDiff = (b.factory.reviewCount ?? 0) - (a.factory.reviewCount ?? 0);
      if (rcDiff !== 0)                                        return rcDiff;
      return new Date(b.factory.updatedAt).getTime() - new Date(a.factory.updatedAt).getTime();
    });

    // Phase 6A.1：這兩個欄位一定要算在「全部」已抓到的候選（scored，最多
    // AI_CANDIDATE_LIMIT 筆）上，不能只算分頁後的 pageSlice——不然使用者翻到
    // 第 2 頁時，directCapabilityMatchCount 會離奇地看起來變少。
    const directCapabilityMatchCount = scored.filter(s => s.matchesAllSignals).length;
    const missingCapabilities = rankingSignals.filter(
      sig => !scored.some(s => s.matchedSignals.has(sig.toLowerCase()))
    );

    const offset = (page - 1) * pageSize;
    const pageSlice = scored.slice(offset, offset + pageSize);
    return {
      items: pageSlice.map(s => s.factory),
      total,
      tiers: pageSlice.map(s => s.tier),
      directCapabilityMatchCount,
      missingCapabilities,
    };
  }

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
export async function createProduct(data: { factoryId: number; name: string; categoryId?: number | null; priceMin?: string; priceMax?: string; priceType?: "range" | "fixed" | "market"; acceptSmallOrder?: boolean; provideSample?: boolean; description?: string; images?: string[]; imageCrops?: (ImageCropData | null)[] }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(products).values(data);
  return result[0].insertId;
}

export async function updateProduct(id: number, factoryId: number, data: Partial<{ name: string; categoryId: number | null; priceMin: string; priceMax: string; priceType: "range" | "fixed" | "market"; acceptSmallOrder: boolean; provideSample: boolean; description: string; images: string[]; imageCrops: (ImageCropData | null)[] }>) {
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

// ── 首次送出原子化 helpers ───────────────────────────────────────────────
//
// 「建立/取得 conversation + 存第一則 message + 更新 lastMessageAt」在下面
// 三個函式裡都包在同一個 db.transaction 中，任一步失敗就整體 rollback，
// 不會留下 messages=0 的新 conversation（正式站既有的兩筆歷史零訊息對話不受
// 影響，也不會被這裡的邏輯刪除或回填）。
//
// Race 防護：transaction 內先對 (userId, factoryId) 做 SELECT ... FOR UPDATE，
// InnoDB 在可重複讀（預設）隔離層級下，即使查無資料也會對該索引範圍上
// gap lock，讓併發的第二個請求等到第一個 commit 後才能繼續，因而只會看到
// 第一個請求剛建立的那筆 conversation、不會插入重複列。這是不需要新增
// migration 就能達成的最小方案；真正的資料庫層保證仍建議加上
// UNIQUE(userId, factoryId)，已於 drizzle/0064_conversations_unique_user_factory.sql
// 準備好對應 migration（尚未執行，依指示不可執行 migration/db:push）。

export async function createConversationAndSendFirstMessage(
  userId: number,
  factoryId: number,
  content: string,
  productId?: number,
): Promise<{ conversation: Conversation; messageId: number; isNewConversation: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.factoryId, factoryId)))
      .limit(1)
      .for("update");

    let conversation: Conversation;
    let isNewConversation: boolean;
    if (existing.length > 0) {
      conversation = existing[0];
      isNewConversation = false;
    } else {
      const inserted = await tx.insert(conversations).values({ userId, factoryId, productId: productId ?? null });
      const [created] = await tx.select().from(conversations).where(eq(conversations.id, inserted[0].insertId)).limit(1);
      conversation = created;
      isNewConversation = true;
    }

    const msgResult = await tx.insert(messages).values({
      conversationId: conversation.id,
      senderId: userId,
      senderRole: "user",
      content,
    });
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));

    return { conversation, messageId: msgResult[0].insertId as number, isNewConversation };
  });
}

export async function createCoManagerInvitationWithMessage(data: {
  factoryId: number;
  inviterUserId: number;
  inviteeUserId: number;
  expiresAt: Date;
  messageContent: string;
}): Promise<{ conversation: Conversation; invitationId: number; messageId: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(conversations)
      .where(and(eq(conversations.userId, data.inviteeUserId), eq(conversations.factoryId, data.factoryId)))
      .limit(1)
      .for("update");

    let conversation: Conversation;
    if (existing.length > 0) {
      conversation = existing[0];
    } else {
      const inserted = await tx.insert(conversations).values({ userId: data.inviteeUserId, factoryId: data.factoryId });
      const [created] = await tx.select().from(conversations).where(eq(conversations.id, inserted[0].insertId)).limit(1);
      conversation = created;
    }

    const invResult = await tx.insert(factoryCoManagerInvitations).values({
      factoryId: data.factoryId,
      inviterUserId: data.inviterUserId,
      inviteeUserId: data.inviteeUserId,
      conversationId: conversation.id,
      expiresAt: data.expiresAt,
      status: "pending",
    });
    const invitationId = invResult[0].insertId as number;

    const msgResult = await tx.insert(messages).values({
      conversationId: conversation.id,
      senderId: data.inviterUserId,
      senderRole: "factory",
      content: data.messageContent,
      type: "co_manager_invite",
      isRead: false,
      invitationId,
    });
    const messageId = msgResult[0].insertId as number;

    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));

    return { conversation, invitationId, messageId };
  });
}

export async function createConversationSendMessageAndBatchItem(
  userId: number,
  factoryId: number,
  content: string,
  batchId: number,
): Promise<{ conversation: Conversation; messageId: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.factoryId, factoryId)))
      .limit(1)
      .for("update");

    let conversation: Conversation;
    if (existing.length > 0) {
      conversation = existing[0];
    } else {
      const inserted = await tx.insert(conversations).values({ userId, factoryId });
      const [created] = await tx.select().from(conversations).where(eq(conversations.id, inserted[0].insertId)).limit(1);
      conversation = created;
    }

    const msgResult = await tx.insert(messages).values({
      conversationId: conversation.id,
      senderId: userId,
      senderRole: "user",
      content,
    });
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));
    await tx.insert(inquiryBatchItems).values({ batchId, factoryId, conversationId: conversation.id });

    return { conversation, messageId: msgResult[0].insertId as number };
  });
}

// ===== 政府補助顧問對話：判定 =====
// 一段對話屬於「政府補助顧問案件對話」，若且唯若：conversations.userId 對應到一位
// 顧問帳號（upgradeConsultants.userId），且該顧問名下存在一筆 upgradeApplications
// 指派給同一間 conversations.factoryId。純粹用既有欄位運算，不需額外欄位／migration，
// 對既有（migration 之前建立）的對話也立即生效。
export async function isAdvisorConversation(userId: number, factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: upgradeApplications.id })
    .from(upgradeApplications)
    .innerJoin(upgradeConsultants, eq(upgradeApplications.assignedConsultantId, upgradeConsultants.id))
    .where(and(
      eq(upgradeConsultants.userId, userId),
      eq(upgradeApplications.factoryId, factoryId),
    ))
    .limit(1);
  return !!row;
}

// 批次版本，供對話列表使用（避免每筆對話各查一次）：
// 回傳 userIds 之中，符合「該 factoryId 的政府補助顧問」條件的 userId 集合。
export async function getAdvisorUserIdsForFactory(factoryId: number, userIds: number[]): Promise<Set<number>> {
  const db = await getDb();
  if (!db || userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: upgradeConsultants.userId })
    .from(upgradeApplications)
    .innerJoin(upgradeConsultants, eq(upgradeApplications.assignedConsultantId, upgradeConsultants.id))
    .where(and(
      eq(upgradeApplications.factoryId, factoryId),
      inArray(upgradeConsultants.userId, userIds),
    ));
  return new Set(rows.map(r => r.userId).filter((id): id is number => id != null));
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

export async function getAdminFactories(page = 1, pageSize = 20, search?: string, status?: 'approved' | 'pending' | 'rejected' | 'delisted', region?: string, industry?: string, contactStatus?: 'not_called' | 'not_interested' | 'follow_up') {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // 軟刪除的工廠一律從管理員工廠資料庫隱藏（資料保留在 DB，只是不再出現在
  // 一般管理員瀏覽／篩選結果），不論其他篩選條件為何。
  const conditions: any[] = [isNull(factories.deletedAt)];
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
  if (region) {
    conditions.push(eq(factories.region, region));
  }
  if (industry) {
    conditions.push(sql`JSON_CONTAINS(${factories.industry}, ${JSON.stringify([industry])})`);
  }
  if (contactStatus) {
    conditions.push(eq(factories.contactStatus, contactStatus));
  }

  const whereClause = and(...conditions);

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

/**
 * 下架：只允許 approved → delisted（防禦性地限定 WHERE status='approved'，
 * 就算呼叫端沒先檢查也不會把 draft/pending/rejected 工廠誤下架）。重新上架
 * 沿用既有 approveFactoryWithBadgeSync（delisted → approved 在語意上就是
 * 「讓這間工廠重新公開」，跟首次審核通過共用同一套「設為 approved」邏輯）。
 * 回傳是否真的有更新到列（0 代表工廠當下不是 approved 狀態）。
 */
export async function delistFactory(factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result]: any = await db.update(factories)
    .set({ status: 'delisted' })
    .where(and(eq(factories.id, factoryId), eq(factories.status, 'approved')));
  return (result?.affectedRows ?? 0) > 0;
}

/**
 * 管理員刪除工廠（軟刪除）：factories 被 financeApplications／
 * certificationCases／shortVideoCases／erpCases（政府補助／認證／短影音／
 * ERP 顧問案件）、collaborationOrders（買賣雙方交易紀錄）、reviews、
 * favorites、factoryRevisions、factoryCoManagers 等大量業務表 FK 參照，
 * 真正 DELETE FROM factories 會製造 orphan data 或撞上正式庫的 FK
 * constraint，因此一律軟刪除：只標記 deletedAt／status，不動任何關聯資料，
 * 也不清空 owner 的 isFactoryOwner（跟工廠主自行刪除的 factory.delete 語意
 * 不同——那支是真正刪除自己僅有的一間工廠）。
 * WHERE deletedAt IS NULL 確保重複呼叫不會覆蓋掉第一次刪除的時間戳記。
 */
export async function adminSoftDeleteFactory(factoryId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result]: any = await db.update(factories)
    .set({ status: 'delisted', deletedAt: new Date() })
    .where(and(eq(factories.id, factoryId), isNull(factories.deletedAt)));
  return (result?.affectedRows ?? 0) > 0;
}

/**
 * 管理員內部 CRM 欄位更新（聯絡狀態／備註）。兩者一律成對送出（呼叫端的
 * Popover 編輯介面同時有這兩個欄位），undefined 代表「這次不更動這個欄位」，
 * null 用於清空備註。不經過 updateFactory()——那支函式是給工廠基本資料用的
 * （owner-scoped where 條件、徽章白名單清洗等都跟這裡無關），這裡只是單純
 * 更新兩個管理員專用欄位。
 */
export async function updateFactoryContactInfo(
  factoryId: number,
  data: { contactStatus?: 'not_called' | 'not_interested' | 'follow_up'; adminNote?: string | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const setData: Record<string, any> = {};
  if (data.contactStatus !== undefined) setData.contactStatus = data.contactStatus;
  if (data.adminNote !== undefined) setData.adminNote = data.adminNote;
  if (Object.keys(setData).length === 0) return;
  await db.update(factories).set(setData).where(eq(factories.id, factoryId));
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
  const conditions: any[] = [
    // 只顯示至少有一則 message 的對話：歷史上曾因「先建 conversation 再存
    // message」流程於中途失敗而留下的零訊息 conversation，不應出現在管理員
    // 列表。不刪除／回填這些既有資料，只在讀取時排除，total 與 items 套用
    // 完全相同的條件，兩者保持一致。
    sql`EXISTS (SELECT 1 FROM messages m WHERE m.conversationId = ${conversations.id})`,
  ];

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

  const whereClause = and(...conditions);

  // 計算總數
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(conversations).where(whereClause);
  const total = Number(countResult?.count ?? 0);

  // 獲取分頁數據（帶上工廠和使用者資訊）—— 與計算總數套用完全相同的 where 條件
  let items: any[] = [];
  try {
    items = await db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        factoryId: conversations.factoryId,
        createdAt: conversations.createdAt,
        lastMessageAt: conversations.lastMessageAt,
        userName: users.name,
        factoryName: factories.name,
      })
      .from(conversations)
      .leftJoin(users, eq(conversations.userId, users.id))
      .leftJoin(factories, eq(conversations.factoryId, factories.id))
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
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

  // 只顯示至少有一則 message 的對話：零訊息的舊 conversation（含歷史上因流程
  // 中途失敗留下的紀錄）不在會員／顧問端列表出現，但一旦送出訊息會自然重新
  // 出現（因為屆時 lastMsgMap 就會有紀錄）。不刪除任何既有資料，只在讀取時過濾。
  return convs
    .filter(conv => lastMsgMap.has(conv.id))
    .map(conv => {
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

  // 批次查出哪些 userId 是「此工廠」的政府補助顧問案件承辦人 —— 這些對話在工廠端
  // （案件申請人）看到的對方名稱一律匿名化為 OXM政府補助顧問，不顯示顧問真實姓名。
  const advisorUserIds = await getAdvisorUserIdsForFactory(factoryId, userIds);

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

  // 只顯示至少有一則 message 的對話（理由同 getConversationsByUserWithDetails）。
  return convs
    .filter(conv => lastMsgMap.has(conv.id))
    .map(conv => {
      const lastMsg = lastMsgMap.get(conv.id);
      const isAdvisor = advisorUserIds.has(conv.userId);
      return {
        ...conv,
        userName: isAdvisor ? ADVISOR_DISPLAY_NAME : (userMap.get(conv.userId)?.name ?? '匿名使用者'),
        productName: conv.productId ? (productMap.get(conv.productId)?.name ?? null) : null,
        unreadCount: unreadMap.get(conv.id) ?? 0,
        lastMessage: lastMsg ? lastMsg.content.substring(0, 60) : null,
        lastSenderRole: lastMsg?.senderRole ?? null,
        buyerAffiliation: isAdvisor ? null : (affiliationMap.get(conv.userId) ?? null),
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

export async function addFactoryPhoto(factoryId: number, url: string, caption?: string, crop?: ImageCropData | null) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select({ id: factoryPhotos.id }).from(factoryPhotos).where(eq(factoryPhotos.factoryId, factoryId));
  if (existing.length >= 20) throw new Error("照片集最多 20 張");
  const sortOrder = existing.length;
  const result = await db.insert(factoryPhotos).values({ factoryId, url, caption, sortOrder, crop: crop ?? null });
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

// 只更新這張相簿照片的顯示範圍中繼資料，不動 url／caption／sortOrder，滿足
// 「已上傳的圖片可以再次編輯顯示範圍」且不需要重新上傳圖片本體。
export async function updateFactoryPhotoCrop(id: number, factoryId: number, crop: ImageCropData | null) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(factoryPhotos).set({ crop }).where(and(eq(factoryPhotos.id, id), eq(factoryPhotos.factoryId, factoryId)));
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

/** 註冊條款 Consent Gate（見 shared/consent.ts）：一次寫入服務條款與隱私權
 * 政策的同意時間／版本。version 由呼叫端（server/routers.ts 的
 * auth.acceptConsent）傳入 server 端目前定義的固定版本常數，不接受
 * client 自行提供的版本字串。 */
export async function acceptUserConsent(
  userId: number,
  data: { termsVersion: string; privacyVersion: string }
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  await db.update(users).set({
    termsAcceptedAt: now,
    termsVersion: data.termsVersion,
    privacyAcceptedAt: now,
    privacyVersion: data.privacyVersion,
  }).where(eq(users.id, userId));
}

/** 新會員 Spotlight 新手導引（見 shared/onboarding.ts）：標記這個 user 已
 * 完成或略過導覽。「完成」與「略過」共用這一支函式——兩者的持久化效果相
 * 同（以後都不再自動顯示導覽），呼叫端（server/routers.ts 的
 * auth.completeOnboarding）不需要區分。只更新 onboardingCompletedAt 這一
 * 個欄位，不動其他 user 資料。 */
export async function completeUserOnboarding(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, userId));
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

export type NewsCategory = "all" | "important" | "competition" | "exhibition" | "cross-industry" | "industry";

/** slug 格式：小寫英數字，可用 "-" 分段，避免任何需要額外編碼的字元進到網址。 */
export function isValidNewsSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 200 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/**
 * 自動產生 slug 候選值：news-YYYYMMDD-xxxxxxxx，後綴取
 * crypto.randomUUID() 拿掉連字號後的前 8 碼（小寫十六進位），不只用時間戳
 * （同一天建立多筆消息也不會碰撞）。日期用伺服器當地時間，純粹是網址裡的
 * 可讀片段，不影響任何到期/發布時間邏輯。
 */
function generateNewsSlugCandidate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `news-${y}${m}${d}-${suffix}`;
}

/**
 * 用 UUID 衍生後綴，同一天內撞號的機率極低（8 碼十六進位＝1/42 億），但
 * 這裡仍然先做存在性檢查、最多重試 5 次；真正的最後防線是 news.slug 的
 * UNIQUE 索引——createNews 在真的 INSERT 撞到唯一鍵時還會再重試一次，
 * 這裡的檢查只是提早攔截、減少無謂的 INSERT 失敗。
 */
async function generateUniqueNewsSlug(db: Awaited<ReturnType<typeof getDb>>): Promise<string> {
  if (!db) throw new Error("DB not available");
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateNewsSlugCandidate();
    const existing = await db.select({ id: news.id }).from(news).where(eq(news.slug, candidate)).limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new Error("無法產生唯一的網址代稱，請稍後再試");
}

/** 原始消息來源網址：只接受完整的 http(s) 網址，拒絕 javascript:/data:/相對路徑/控制字元與 CRLF。 */
export function isValidNewsSourceUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 來源單位／來源網址的交叉驗證：網址格式不對就拒絕；只填了單位、沒填網址
 * 會變成「有名稱但點不了」，前後端都要擋。回傳 trim 過、空字串正規化成
 * null 的乾淨值，呼叫端直接拿去寫入 DB。
 */
export function validateNewsSource(
  sourceName: string | null | undefined,
  sourceUrl: string | null | undefined,
): { sourceName: string | null; sourceUrl: string | null } {
  const name = sourceName?.trim() || null;
  const url = sourceUrl?.trim() || null;
  if (url && !isValidNewsSourceUrl(url)) {
    throw new Error("原始消息網址格式不正確，僅接受 http(s) 開頭的完整網址");
  }
  if (name && !url) {
    throw new Error("請填寫原始消息網址");
  }
  return { sourceName: name, sourceUrl: url };
}

/** 後端一律用 shared/constants.ts 的 INDUSTRY_OPTIONS 驗證，不信任前端傳來的產業名稱字串。 */
export function validateNewsIndustryNames(names: string[]): void {
  const invalid = names.filter(n => !(INDUSTRY_OPTIONS as readonly string[]).includes(n));
  if (invalid.length > 0) {
    throw new Error(`無效的產業分類：${invalid.join("、")}`);
  }
}

// ===== 找消息看板訂閱：boardKey 白名單 =====
// boardKey 是穩定識別碼，不是前端顯示文字：固定看板（all/important/
// competition/exhibition）用字面量比對；產業看板一律要求精準比對
// shared/constants.ts 的 INDUSTRY_OPTIONS（跟 validateNewsIndustryNames 同一份
// 白名單），任意字串／控制字元／超長值／不存在的產業一律在這裡被拒絕，不需要
// 額外寫 regex 過濾——不在白名單裡本來就不會通過 includes() 比對。
export const NEWS_BOARD_FIXED_KEYS = ["all", "important", "competition", "exhibition", "cross-industry"] as const;
export type NewsBoardFixedKey = typeof NEWS_BOARD_FIXED_KEYS[number];

export function isValidNewsBoardKey(boardKey: string): boolean {
  if ((NEWS_BOARD_FIXED_KEYS as readonly string[]).includes(boardKey)) return true;
  if (boardKey.startsWith("industry:")) {
    return (INDUSTRY_OPTIONS as readonly string[]).includes(boardKey.slice("industry:".length));
  }
  return false;
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
  /** 有登入才傳；用來在回傳的每一則消息上附加 isRead，訪客的已讀狀態存在
   * localStorage，前端自己比對，不需要（也無法）由後端代勞。 */
  userId?: number;
}

/** industryNames 用途：目前只有「全部最新消息」（category === "all"）列表卡片需要顯示產業標籤，
 * 但這裡固定回傳、不依 category 條件省略——單一分類本身已經隱含產業（industry:X）或不需要
 * （important／competition／exhibition／cross-industry 各自的分類頁本來就不渲染這個欄位），
 * 多回傳這個欄位不會造成誤用，換來的是不用為了單一 category 分支特別繞路，query 邏輯更簡單。 */
export type PublicNewsItem = News & { isRead: boolean; industryNames: string[] };

/** 只有 status === "published" 會出現；依 publishedAt DESC、id DESC 排序，避免同秒發布時排序不穩定。 */
export async function listPublicNews(params: ListPublicNewsParams): Promise<{ items: PublicNewsItem[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const limit = Math.min(params.limit ?? 20, 50);
  const offset = params.offset ?? 0;

  const conditions = [eq(news.status, "published")];
  if (params.category === "important") conditions.push(eq(news.isImportant, true));
  else if (params.category === "competition") conditions.push(eq(news.isCompetition, true));
  else if (params.category === "exhibition") conditions.push(eq(news.isExhibition, true));
  else if (params.category === "cross-industry") conditions.push(eq(news.isCrossIndustry, true));
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

  let readIds = new Set<number>();
  if (params.userId != null && items.length > 0) {
    const readRows = await db.select({ newsId: newsReads.newsId }).from(newsReads)
      .where(and(eq(newsReads.userId, params.userId), inArray(newsReads.newsId, items.map(i => i.id))));
    readIds = new Set(readRows.map(r => r.newsId));
  }

  const industryMap = items.length > 0 ? await getNewsIndustryNamesBatch(items.map(i => i.id)) : new Map<number, string[]>();

  return {
    items: items.map(item => ({ ...item, isRead: readIds.has(item.id), industryNames: industryMap.get(item.id) ?? [] })),
    total: Number(countResult?.count ?? 0),
  };
}

/**
 * Phase 6B：OXM AI 找消息——獨立於 listPublicNews 之外的新函式（見對話中
 * 「不要破壞正常 /news」：一般 /news 頁面繼續呼叫既有 listPublicNews，完全不
 * 受這支函式影響，兩者互不耦合）。
 *
 * Hard Filter／Ranking 責任分離，沿用 Factory Search 的既有原則（見
 * server/ai/factorySearchAction.ts 檔頭）：
 * - Hard Filter（SQL WHERE，決定「誰能出現」）：消息類型（重要／競賽／展覽／
 *   跨產業，任一被偵測到就以 OR 條件納入候選）、產業（newsIndustries 命中任一
 *   偵測到的產業名稱）、以及在「完全沒有類型也沒有產業」時，keyword 本身
 *   （對 title/summary/content 做 LIKE，避免在沒有任何結構化條件時把全站消息
 *   當候選集合，那樣排序無意義、也容易誤導使用者）。
 * - Ranking（JS 端排序，決定「誰排前面」，不影響候選集合本身）：keyword
 *   命中 title 記 tier 2，命中 summary／content 記 tier 1，都沒命中（純粹只
 *   靠類型／產業篩出來的）記 tier 0——都不會被排除，只影響排序，跟
 *   computeRankingTier 同一種設計哲學。
 */
export interface NewsSearchForAiParams {
  categoryFilters: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean };
  industryNames: string[];
  /** 排序／（在沒有類型與產業時）篩選用的關鍵字，deterministic 抽取自使用者原話，不是 AI 自由生成。 */
  keywords: string[];
  limit?: number;
}

export interface NewsSearchForAiItem {
  id: number;
  slug: string;
  title: string;
  summary: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
  publishedAt: Date | null;
  industryNames: string[];
  tier: 0 | 1 | 2;
}

const NEWS_SEARCH_CANDIDATE_LIMIT = 30;

export async function searchNewsForAi(params: NewsSearchForAiParams): Promise<{ items: NewsSearchForAiItem[]; total: number }> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const { categoryFilters, industryNames, keywords } = params;
  const limit = Math.min(params.limit ?? 3, 10);

  const conditions = [eq(news.status, "published")];

  const typeConditions = [
    categoryFilters.isImportant ? eq(news.isImportant, true) : null,
    categoryFilters.isCompetition ? eq(news.isCompetition, true) : null,
    categoryFilters.isExhibition ? eq(news.isExhibition, true) : null,
    categoryFilters.isCrossIndustry ? eq(news.isCrossIndustry, true) : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  if (typeConditions.length > 0) conditions.push(or(...typeConditions)!);

  let industryNewsIds: number[] | null = null;
  if (industryNames.length > 0) {
    const idRows = await db.selectDistinct({ newsId: newsIndustries.newsId })
      .from(newsIndustries).where(inArray(newsIndustries.industryName, industryNames));
    industryNewsIds = idRows.map(r => r.newsId);
    if (industryNewsIds.length === 0) return { items: [], total: 0 };
    conditions.push(inArray(news.id, industryNewsIds));
  }

  const hasStructuralFilter = typeConditions.length > 0 || industryNames.length > 0;

  // 完全沒有類型也沒有產業時，keyword 本身要當 hard filter（見檔頭說明），
  // 避免候選集合是「全站已發布消息」這種沒有邊界的查詢。
  if (!hasStructuralFilter && keywords.length > 0) {
    const keywordConditions = keywords.flatMap(k => [
      like(news.title, `%${k}%`),
      like(news.summary, `%${k}%`),
      like(news.content, `%${k}%`),
    ]);
    conditions.push(or(...keywordConditions)!);
  }

  const where = and(...conditions);
  const [countResult] = await db.select({ count: sql<number>`COUNT(*)` }).from(news).where(where);
  const total = Number(countResult?.count ?? 0);
  if (total === 0) return { items: [], total: 0 };

  const candidates = await db.select().from(news).where(where)
    .orderBy(desc(news.publishedAt), desc(news.id))
    .limit(NEWS_SEARCH_CANDIDATE_LIMIT);

  const industryMap = await getNewsIndustryNamesBatch(candidates.map(c => c.id));

  const lowerKeywords = keywords.map(k => k.toLowerCase()).filter(Boolean);
  function computeTier(item: News): 0 | 1 | 2 {
    if (lowerKeywords.length === 0) return 0;
    const title = item.title.toLowerCase();
    if (lowerKeywords.some(k => title.includes(k))) return 2;
    const body = `${item.summary} ${item.content}`.toLowerCase();
    if (lowerKeywords.some(k => body.includes(k))) return 1;
    return 0;
  }

  const scored = candidates
    .map(item => ({ item, tier: computeTier(item) }))
    .sort((a, b) => {
      if (b.tier !== a.tier) return b.tier - a.tier;
      const aTime = a.item.publishedAt ? a.item.publishedAt.getTime() : 0;
      const bTime = b.item.publishedAt ? b.item.publishedAt.getTime() : 0;
      return bTime - aTime;
    });

  const items: NewsSearchForAiItem[] = scored.slice(0, limit).map(({ item, tier }) => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    isImportant: item.isImportant,
    isCompetition: item.isCompetition,
    isExhibition: item.isExhibition,
    isCrossIndustry: item.isCrossIndustry,
    publishedAt: item.publishedAt,
    industryNames: industryMap.get(item.id) ?? [],
    tier,
  }));

  return { items, total };
}

/** sitemap.xml 專用：只回傳 status === "published" 的消息 slug／updatedAt，不分頁（消息數量遠小於工廠）。 */
export async function getPublishedNewsForSitemap(): Promise<{ slug: string; updatedAt: Date }[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ slug: news.slug, updatedAt: news.updatedAt })
    .from(news)
    .where(eq(news.status, "published"));
}

export async function getAdminNewsList(limit = 100): Promise<News[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(news).orderBy(desc(news.updatedAt)).limit(limit);
}

export interface NewCategorySummary {
  all: boolean;
  important: boolean;
  competition: boolean;
  exhibition: boolean;
  crossIndustry: boolean;
  industry: boolean;
  industries: Record<string, boolean>;
}

export interface GetNewCategorySummaryParams {
  /** 有登入才傳；已讀判斷改查 newsReads 表，excludeIds 會被忽略。 */
  userId?: number;
  /** 訪客專用：前端從 localStorage 讀出的已讀 newsId 清單，後端無法得知訪客身份，
   * 只能相信前端傳進來的排除清單；有 userId 時這個參數不會被使用。 */
  excludeIds?: number[];
}

/**
 * 各分類「NEW」徽章判斷：firstPublishedAt 未滿 NEWS_NEW_WINDOW_HOURS（見
 * shared/const.ts，唯一真相來源）AND 目前使用者尚未讀過，兩個條件同時成立才算
 * NEW；只要已讀或已經超過時限，NEW 立刻消失（OR 消失邏輯）。firstPublishedAt
 * 是第一次正式發布的時間，永久不變，不看 publishedAt／updatedAt——下架重發不會
 * 再次寫入 firstPublishedAt，單純編輯標題/內文也不會動到它，都不會誤判成新
 * 消息。固定用最多三次查詢（近期已發布消息本身、該使用者對這些消息的已讀紀錄、
 * 未讀消息對應的產業標籤）算出所有分類的 NEW 狀態，不是每個分類各發一次查詢，
 * 也不是靠前端目前載入的第一頁資料判斷。一篇消息同時掛在多個看板／產業時，
 * 只要被讀過一次（同一個 newsId），所有位置的 NEW 會一起消失，不需要為每個
 * 看板分別記錄已讀狀態。
 */
export async function getNewCategorySummary(params: GetNewCategorySummaryParams = {}): Promise<NewCategorySummary> {
  const db = await getDb();
  const empty: NewCategorySummary = { all: false, important: false, competition: false, exhibition: false, crossIndustry: false, industry: false, industries: {} };
  if (!db) return empty;

  const cutoff = new Date(Date.now() - NEWS_NEW_WINDOW_MS);
  const recent = await db.select({
    id: news.id,
    isImportant: news.isImportant,
    isCompetition: news.isCompetition,
    isExhibition: news.isExhibition,
    isCrossIndustry: news.isCrossIndustry,
  }).from(news).where(and(eq(news.status, "published"), gte(news.firstPublishedAt, cutoff)));

  if (recent.length === 0) return empty;

  let readIds = new Set<number>();
  if (params.userId != null) {
    const readRows = await db.select({ newsId: newsReads.newsId }).from(newsReads)
      .where(and(eq(newsReads.userId, params.userId), inArray(newsReads.newsId, recent.map(r => r.id))));
    readIds = new Set(readRows.map(r => r.newsId));
  } else if (params.excludeIds && params.excludeIds.length > 0) {
    readIds = new Set(params.excludeIds);
  }

  const unread = recent.filter(r => !readIds.has(r.id));
  if (unread.length === 0) return empty;

  const industryRows = await db.selectDistinct({ industryName: newsIndustries.industryName })
    .from(newsIndustries)
    .where(inArray(newsIndustries.newsId, unread.map(r => r.id)));

  const industries: Record<string, boolean> = {};
  for (const row of industryRows) industries[row.industryName] = true;

  const crossIndustry = unread.some(r => r.isCrossIndustry);

  return {
    all: true,
    important: unread.some(r => r.isImportant),
    competition: unread.some(r => r.isCompetition),
    exhibition: unread.some(r => r.isExhibition),
    crossIndustry,
    // 桌面「產業消息」父層／手機「產業」分頁的 NEW：任一子看板（跨產業資訊
    // 或任一真實產業）有未讀 NEW 就顯示，兩個來源用 OR 合併，不是各自獨立
    // 判斷——跨產業資訊雖然不是 newsIndustries 裡的一筆，但使用者體驗上仍
    // 隸屬「產業消息」這個父層區塊，見 client/src/pages/News.tsx 的桌面側欄。
    industry: industryRows.length > 0 || crossIndustry,
    industries,
  };
}

/**
 * 標記一篇消息為「已讀」（登入會員專用）。只有在消息真的存在、已發布、
 * firstPublishedAt 有值、且現在仍未滿 NEWS_NEW_WINDOW_MS 視窗時才寫入——草稿、
 * 已下架、找不到、firstPublishedAt 為 null、或早就超過 168 小時的消息，讀了
 * 也不建立紀錄（反正這些狀態下 NEW 本來就不會顯示，寫入只是浪費一列）。這裡
 * 是先 SELECT 判斷「這篇消息現在符不符合資格」，不是「這筆 (userId, newsId)
 * 讀過了沒」——真正防止同一個 (userId, newsId) 重複寫入的，是下面 INSERT 撞到
 * (newsId, userId) 唯一索引時被吞掉，這段沒有查了再插的競態問題。
 */
export async function markNewsAsRead(userId: number, newsId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [row] = await db.select({
    status: news.status,
    firstPublishedAt: news.firstPublishedAt,
  }).from(news).where(eq(news.id, newsId)).limit(1);

  if (!row) return; // 消息不存在
  if (row.status !== "published") return; // 草稿／已下架
  if (row.firstPublishedAt == null) return; // 理論上 published 一定有值，這裡是防禦性檢查
  if (Date.now() >= row.firstPublishedAt.getTime() + NEWS_NEW_WINDOW_MS) return; // 已超過 168 小時視窗

  try {
    await db.insert(newsReads).values({ userId, newsId });
  } catch (err: any) {
    const isDup = err?.errno === 1062 || err?.code === "ER_DUP_ENTRY"
      || err?.cause?.errno === 1062 || err?.cause?.code === "ER_DUP_ENTRY";
    if (!isDup) throw err;
  }
}

export interface CreateNewsInput {
  /** 不填或空字串 → 後端自動產生 news-YYYYMMDD-xxxxxxxx 格式的 slug。 */
  slug?: string;
  title: string;
  summary: string;
  content: string;
  status: "draft" | "published";
  isImportant?: boolean;
  isCompetition?: boolean;
  isExhibition?: boolean;
  isCrossIndustry?: boolean;
  industryNames?: string[];
  sourceName?: string | null;
  sourceUrl?: string | null;
  createdBy: number;
}

export async function createNews(data: CreateNewsInput): Promise<{ id: number; shouldNotify: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const autoSlug = !data.slug;
  if (!autoSlug) {
    if (!isValidNewsSlug(data.slug!)) throw new Error(`無效的網址代稱：${data.slug}`);
    const existing = await db.select({ id: news.id }).from(news).where(eq(news.slug, data.slug!)).limit(1);
    if (existing.length > 0) throw new Error(`此網址代稱已被使用：${data.slug}`);
  }

  const industryNames = Array.from(new Set(data.industryNames ?? []));
  validateNewsIndustryNames(industryNames);
  const { sourceName, sourceUrl } = validateNewsSource(data.sourceName, data.sourceUrl);

  const publishNow = data.status === "published";
  const now = new Date();

  let id: number | undefined;
  let lastErr: unknown;
  const maxAttempts = autoSlug ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = autoSlug ? generateNewsSlugCandidate() : data.slug!;
    try {
      const result = await db.insert(news).values({
        slug,
        title: data.title,
        summary: data.summary,
        content: data.content,
        status: data.status,
        isImportant: data.isImportant ?? false,
        isCompetition: data.isCompetition ?? false,
        isExhibition: data.isExhibition ?? false,
        isCrossIndustry: data.isCrossIndustry ?? false,
        sourceName,
        sourceUrl,
        publishedAt: publishNow ? now : null,
        firstPublishedAt: publishNow ? now : null,
        createdBy: data.createdBy,
      });
      id = result[0].insertId;
      break;
    } catch (err) {
      lastErr = err;
      // 自動產生的 slug 真的撞到唯一鍵（機率極低）才重試；手動填的 slug
      // 撞到就直接視為錯誤丟出去，不擅自幫使用者改掉他填的值。
      const isDup = (err as { code?: string })?.code === "ER_DUP_ENTRY";
      if (!autoSlug || !isDup) throw err;
    }
  }
  if (id === undefined) throw lastErr instanceof Error ? lastErr : new Error("建立消息失敗，請稍後再試");

  if (industryNames.length > 0) {
    await db.insert(newsIndustries).values(industryNames.map(industryName => ({ newsId: id!, industryName })));
  }
  // 建立當下就是 published，等同「第一次從草稿轉為已發布」，需要觸發分眾通知。
  return { id, shouldNotify: publishNow };
}

export interface UpdateNewsInput {
  /** 一旦這則消息 firstPublishedAt 已經有值，後端一律拒絕修改 slug（不管前端有沒有 disable）。 */
  slug?: string;
  title?: string;
  summary?: string;
  content?: string;
  status?: "draft" | "published" | "withdrawn";
  isImportant?: boolean;
  isCompetition?: boolean;
  isExhibition?: boolean;
  isCrossIndustry?: boolean;
  industryNames?: string[];
  /** 來源單位／來源網址要嘛都不傳、要嘛一起傳，方便做「有名稱必須有網址」的交叉驗證。 */
  sourceName?: string | null;
  sourceUrl?: string | null;
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

  if (data.slug !== undefined && !isValidNewsSlug(data.slug)) {
    throw new Error(`無效的網址代稱：${data.slug}`);
  }
  const sourceProvided = data.sourceName !== undefined || data.sourceUrl !== undefined;
  const validatedSource = sourceProvided ? validateNewsSource(data.sourceName, data.sourceUrl) : null;

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
    if (data.slug !== undefined && data.slug !== current.slug) {
      // 一旦發布過（不論現在是 published 還是被下架的 withdrawn），slug 就
      // 已經可能流通出去（分享連結、SEO 收錄、Email/Push 裡的網址），後端
      // 一律拒絕修改，不能只靠前端把輸入框 disable 掉。
      if (current.firstPublishedAt != null) {
        throw new Error("已發布過的消息無法修改網址代稱");
      }
      const existing = await tx.select({ id: news.id }).from(news).where(eq(news.slug, data.slug)).limit(1);
      if (existing.length > 0 && existing[0].id !== id) throw new Error(`此網址代稱已被使用：${data.slug}`);
      setData.slug = data.slug;
    }
    if (data.title !== undefined) setData.title = data.title;
    if (data.summary !== undefined) setData.summary = data.summary;
    if (data.content !== undefined) setData.content = data.content;
    if (data.isImportant !== undefined) setData.isImportant = data.isImportant;
    if (data.isCompetition !== undefined) setData.isCompetition = data.isCompetition;
    if (data.isExhibition !== undefined) setData.isExhibition = data.isExhibition;
    if (data.isCrossIndustry !== undefined) setData.isCrossIndustry = data.isCrossIndustry;
    if (validatedSource) {
      // 編輯來源資料（不管消息是否已發布）不影響 status／publishedAt，因此
      // 不會觸發下面的 shouldNotify——修改來源資訊不寄送 Email／Push。
      setData.sourceName = validatedSource.sourceName;
      setData.sourceUrl = validatedSource.sourceUrl;
    }

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

/**
 * 使用者「預設訂閱」的產業清單：來自審核通過(approved)工廠的 owner／有效
 * 共同管理者身份，取 factories.industry 陣列裡的所有產業（同一使用者可能
 * 因多間工廠而屬於多個產業，一律合併）。這是看板訂閱「自己所屬產業」預設
 * true 的唯一資料來源，跟 gatherNewsRecipients 判斷「這篇消息該通知誰」是
 * 同一套資格規則，只是方向相反（那邊是「產業→使用者」，這裡是「使用者→
 * 產業」），不另外維護第二份會員產業清單。
 */
export async function getUserIndustries(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const owned = await db.select({ industry: factories.industry })
    .from(factories)
    .where(and(eq(factories.status, "approved"), eq(factories.ownerId, userId)));

  const coManaged = await db.select({ factoryId: factoryCoManagers.factoryId })
    .from(factoryCoManagers)
    .where(and(eq(factoryCoManagers.userId, userId), isNull(factoryCoManagers.removedAt)));

  let coManagedFactories: { industry: string[] }[] = [];
  if (coManaged.length > 0) {
    coManagedFactories = await db.select({ industry: factories.industry })
      .from(factories)
      .where(and(eq(factories.status, "approved"), inArray(factories.id, coManaged.map(r => r.factoryId))));
  }

  const industries = new Set<string>();
  for (const f of [...owned, ...coManagedFactories]) {
    for (const name of (f.industry ?? [])) industries.add(name);
  }
  return Array.from(industries);
}

/** 動態計算單一 boardKey 的系統預設訂閱狀態（沒有明確覆寫紀錄時使用）。 */
export function computeDefaultBoardSubscription(boardKey: string, userIndustries: string[]): boolean {
  if (boardKey === "important") return true;
  if (boardKey.startsWith("industry:")) return userIndustries.includes(boardKey.slice("industry:".length));
  // all／competition／exhibition／cross-industry／其他產業預設一律未訂閱。
  // "cross-industry" 刻意不比對 userIndustries——它不是真實產業，任何會員
  // （不論屬於幾個產業）都不會因為這個判斷式而被視為預設訂閱，一律要主動按
  // 訂閱才會變 true，見 server/db.ts 的 news.isCrossIndustry 欄位註解。
  return false;
}

/** 使用者對所有看板「明確覆寫」的原始紀錄（true=明確訂閱、false=明確取消），沒有紀錄的看板不會出現在這個 Map 裡。 */
export async function getBoardSubscriptionOverrides(userId: number): Promise<Map<string, boolean>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db.select({ boardKey: newsBoardSubscriptions.boardKey, isSubscribed: newsBoardSubscriptions.isSubscribed })
    .from(newsBoardSubscriptions)
    .where(eq(newsBoardSubscriptions.userId, userId));
  return new Map(rows.map(r => [r.boardKey, r.isSubscribed]));
}

/**
 * 單一 boardKey 的「有效訂閱狀態」：明確覆寫優先於動態預設，這是全站唯一的
 * 判斷入口——news.getBoardSubscriptionState（給前端按鈕顯示）與收件人聚合
 * （getBoardEligibleUserIds）都必須共用同一套規則，不得各自實作一份，否則
 * 按鈕顯示的狀態可能跟實際會不會收到通知不一致。
 */
export async function getEffectiveBoardSubscription(userId: number, boardKey: string): Promise<boolean> {
  const overrides = await getBoardSubscriptionOverrides(userId);
  if (overrides.has(boardKey)) return overrides.get(boardKey)!;
  const userIndustries = await getUserIndustries(userId);
  return computeDefaultBoardSubscription(boardKey, userIndustries);
}

/**
 * 寫入使用者對某個看板的明確選擇（upsert，靠 (userId, boardKey) 唯一索引
 * 抗併發——同一使用者對同一看板連續兩次請求，不會產生兩筆紀錄或競態）。
 * 呼叫端負責先用 isValidNewsBoardKey 驗證 boardKey，這裡不重複驗證。
 */
export async function setNewsBoardSubscription(userId: number, boardKey: string, isSubscribed: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(newsBoardSubscriptions)
    .values({ userId, boardKey, isSubscribed })
    .onDuplicateKeyUpdate({ set: { isSubscribed, updatedAt: new Date() } });
}

/**
 * 找消息分眾收件資格聚合的核心：回傳「有資格收到這篇消息」的去重 userId
 * 集合（尚未套用 news／pushNews 這類外部通知管道開關——那是 gatherNewsRecipients
 * 的事，這裡只回答「這個人有沒有看板訂閱資格」，站內通知三層判斷會直接用
 * 這個結果）。適用看板固定包含 "all"，依消息分類加上
 * important／competition／exhibition／cross-industry／industry:<name>。
 *
 * 三種來源合併去重：
 *   1) 對任一適用看板明確訂閱（isSubscribed=true）的使用者——不論預設值。
 *   2) isImportant 時：所有有效會員，扣掉對 "important" 明確取消的人。
 *   3) industryNames 非空時：per-user 比對「這篇消息的產業」∩「使用者自己
 *      所屬產業」，只要其中至少一個產業沒有被明確取消，就符合資格（不要求
 *      使用者所有所屬產業都保留訂閱）。
 *
 * isCrossIndustry 刻意跟 isCompetition／isExhibition 走同一條路——只靠來源 1）
 * 的「明確訂閱」名單，沒有對應的「自動視為符合資格」邏輯（不像 isImportant
 * 有『所有有效會員』、industryNames 有『使用者自己所屬產業』這種自動納入）。
 * 這是「cross-industry 任何人都不會預設訂閱，只有主動按過訂閱才收得到」這條
 * 規則在收件人聚合這一層唯一需要的保證：不多寫一段自動納入的程式碼，天生
 * 就不會有人被誤判為預設訂閱。
 */
async function getBoardEligibleUserIds(opts: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean; industryNames: string[] }): Promise<Set<number>> {
  const db = await getDb();
  if (!db) return new Set();

  const boardKeys: string[] = [
    "all",
    ...(opts.isImportant ? ["important"] : []),
    ...(opts.isCompetition ? ["competition"] : []),
    ...(opts.isExhibition ? ["exhibition"] : []),
    ...(opts.isCrossIndustry ? ["cross-industry"] : []),
    ...opts.industryNames.map(n => `industry:${n}`),
  ];

  const explicitTrueRows = await db.selectDistinct({ userId: newsBoardSubscriptions.userId })
    .from(newsBoardSubscriptions)
    .where(and(inArray(newsBoardSubscriptions.boardKey, boardKeys), eq(newsBoardSubscriptions.isSubscribed, true)));
  const eligible = new Set<number>(explicitTrueRows.map(r => r.userId));

  if (opts.isImportant) {
    const [activeUsers, explicitFalseImportant] = await Promise.all([
      getActiveUsersForAnnouncement(),
      db.select({ userId: newsBoardSubscriptions.userId }).from(newsBoardSubscriptions)
        .where(and(eq(newsBoardSubscriptions.boardKey, "important"), eq(newsBoardSubscriptions.isSubscribed, false))),
    ]);
    const excluded = new Set(explicitFalseImportant.map(r => r.userId));
    for (const u of activeUsers) if (!excluded.has(u.id)) eligible.add(u.id);
  }

  if (opts.industryNames.length > 0) {
    const matchedFactories = await db.select({ id: factories.id, ownerId: factories.ownerId, industry: factories.industry })
      .from(factories)
      .where(and(
        eq(factories.status, "approved"),
        sql`JSON_OVERLAPS(${factories.industry}, ${JSON.stringify(opts.industryNames)})`,
      ));

    if (matchedFactories.length > 0) {
      const factoryIds = matchedFactories.map(f => f.id);
      const coMgrRows = await db.select({ userId: factoryCoManagers.userId, factoryId: factoryCoManagers.factoryId })
        .from(factoryCoManagers)
        .where(and(inArray(factoryCoManagers.factoryId, factoryIds), isNull(factoryCoManagers.removedAt)));

      const factoryById = new Map(matchedFactories.map(f => [f.id, f]));
      const userMatchedIndustries = new Map<number, Set<string>>();
      const addMatch = (userId: number, factoryIndustry: string[]) => {
        const intersect = (factoryIndustry ?? []).filter(name => opts.industryNames.includes(name));
        if (intersect.length === 0) return;
        const set = userMatchedIndustries.get(userId) ?? new Set<string>();
        for (const name of intersect) set.add(name);
        userMatchedIndustries.set(userId, set);
      };
      for (const f of matchedFactories) addMatch(f.ownerId, f.industry);
      for (const r of coMgrRows) {
        const f = factoryById.get(r.factoryId);
        if (f) addMatch(r.userId, f.industry);
      }

      const candidateUserIds = Array.from(userMatchedIndustries.keys());
      if (candidateUserIds.length > 0) {
        const industryBoardKeys = opts.industryNames.map(n => `industry:${n}`);
        const overrideRows = await db.select({ userId: newsBoardSubscriptions.userId, boardKey: newsBoardSubscriptions.boardKey, isSubscribed: newsBoardSubscriptions.isSubscribed })
          .from(newsBoardSubscriptions)
          .where(and(inArray(newsBoardSubscriptions.userId, candidateUserIds), inArray(newsBoardSubscriptions.boardKey, industryBoardKeys)));
        const falseOverrides = new Map<number, Set<string>>();
        for (const r of overrideRows) {
          if (r.isSubscribed) continue; // true 已經在 explicitTrueRows 涵蓋
          const set = falseOverrides.get(r.userId) ?? new Set<string>();
          set.add(r.boardKey.slice("industry:".length));
          falseOverrides.set(r.userId, set);
        }
        for (const [userId, matchedIndustries] of Array.from(userMatchedIndustries.entries())) {
          const excludedIndustries = falseOverrides.get(userId);
          const hasAnyDefaultTrue = Array.from(matchedIndustries).some(name => !excludedIndustries?.has(name));
          if (hasAnyDefaultTrue) eligible.add(userId);
        }
      }
    }
  }

  return eligible;
}

export interface NewsRecipientInfo {
  id: number;
  email: string | null; // 已套用「news」opt-out 規則；opt-out 或無 email 時為 null
  name: string | null;
  pushEnabled: boolean; // 已套用「pushNews」opt-out 規則
}

/**
 * 「news」／「pushNews」只控制 Email／Push 這兩個外部管道要不要送達，語意
 * 是「預設允許，只有明確 false 才排除」；不得用來決定站內通知要不要建立
 * ——那是看板訂閱（getBoardEligibleUserIds）的職責，兩者不得互相影響。
 */
function isNewsEmailAllowed(settings: Record<string, boolean> | null | undefined): boolean {
  return (settings ?? {})['news'] !== false;
}
function isNewsPushAllowed(settings: Record<string, boolean> | null | undefined): boolean {
  return (settings ?? {})['pushNews'] !== false;
}

/**
 * 找消息分眾通知的唯一收件人聚合入口：看板訂閱資格聚合（getBoardEligibleUserIds）
 * → 撈使用者資料 → 套用 news／pushNews 開關算出每個人的 email／pushEnabled。
 * 回傳陣列本身就是「有看板訂閱資格」的去重名單（不論 email／pushEnabled 欄位
 * 結果為何都會出現一筆），呼叫端可以直接拿這個陣列的長度當作站內通知／預估
 * 人數，不需要另外查一次資格。
 */
export async function gatherNewsRecipients(opts: { isImportant: boolean; isCompetition: boolean; isExhibition: boolean; isCrossIndustry: boolean; industryNames: string[] }): Promise<NewsRecipientInfo[]> {
  const db = await getDb();
  if (!db) return [];

  const eligibleIds = await getBoardEligibleUserIds(opts);
  if (eligibleIds.size === 0) return [];

  const rows = await db.select({
    id: users.id,
    email: sql<string | null>`COALESCE(${users.primaryEmail}, ${users.email})`,
    name: users.name,
    notificationSettings: users.notificationSettings,
  }).from(users).where(and(inArray(users.id, Array.from(eligibleIds)), isNull(users.deletedAt)));

  return rows.map(u => {
    const s = (u.notificationSettings as Record<string, boolean> | null) ?? {};
    return {
      id: u.id,
      email: (u.email && isNewsEmailAllowed(s)) ? u.email : null,
      name: u.name,
      pushEnabled: isNewsPushAllowed(s),
    };
  });
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
 * 標記這則消息「Email 通知已成功排入既有寄送機制」，只在 dispatchNewsNotifications
 * 的 Email 分支確定 createPendingNewsNotifications 建立出至少一筆待寄紀錄之後
 * 才會被呼叫一次（見 server/routers.ts）。用 WHERE emailNotificationSentAt IS
 * NULL 讓這支函式本身也具備冪等性：就算未來被重複呼叫，也不會覆寫掉第一次
 * 寫入的時間，維持「只會被設定一次」的不變量，跟 news.create 才能觸發、
 * news.update 完全不接受這個欄位的路由層限制形成雙重保險。
 */
export async function markNewsEmailNotificationSent(newsId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(news).set({ emailNotificationSentAt: new Date() })
    .where(and(eq(news.id, newsId), isNull(news.emailNotificationSentAt)));
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

// ===== 登入彈窗（綁定既有「平台消息／版本更新」公告的登入曝光入口）=====
//
// 這個表的資料結構刻意不做「草稿／已發布／封存」狀態機——announcements 這張表
// 本身就沒有這個概念（一筆存在即代表已發布，delete 是直接硬刪除，沒有軟刪除
// 欄位）。因此這裡「公告是否有效可綁定」的唯一判斷依據簡化為：
//   1. announcementId 對應的公告仍然存在（沒被刪除）
//   2. 該公告的 type 屬於登入彈窗可綁定的白名單（見 LOGIN_POPUP_BINDABLE_ANNOUNCEMENT_TYPES）
// 這與需求文件假設的「草稿/已發布/已封存」狀態機不同，是依實際 schema 現況
// 做的最小合理調整。

// 「一天一次」判定沿用上方 pageViews 已經驗證過的 twDateStr()（台灣時間
// YYYY-MM-DD），確保每天重新計算的基準是 Asia/Taipei 00:00，而不是每隔 24 小時。

// 登入彈窗可綁定的公告類型：正向白名單，而非「只要不是 maintenance 就放行」
// 的反向判斷——未來新增公告類型時，預設不可綁定，需要明確加進這個清單才會
// 開放，避免被意外放行。
export const LOGIN_POPUP_BINDABLE_ANNOUNCEMENT_TYPES: readonly AnnouncementType[] = ["news", "update"];

function isLoginPopupBindableAnnouncementType(type: AnnouncementType): boolean {
  return (LOGIN_POPUP_BINDABLE_ANNOUNCEMENT_TYPES as readonly string[]).includes(type);
}

async function getBindableLoginPopupAnnouncementById(announcementId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);
  if (!row) return null;
  if (!isLoginPopupBindableAnnouncementType(row.type)) return null;
  return row;
}

/** 管理員後台專用：登入彈窗可綁定的公告清單（平台消息／版本更新，不含停機
 * 維護）。給下拉／可搜尋選擇器用，不含草稿/其他類型；每筆回傳 type 供前端
 * 標示「平台消息／版本更新」。 */
export async function getBindableAnnouncementsForLoginPopupPicker(keyword?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [inArray(announcements.type, LOGIN_POPUP_BINDABLE_ANNOUNCEMENT_TYPES as AnnouncementType[])];
  if (keyword && keyword.trim()) {
    conditions.push(like(announcements.title, `%${keyword.trim()}%`));
  }
  return db.select({ id: announcements.id, title: announcements.title, type: announcements.type, createdAt: announcements.createdAt })
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
  boundAnnouncementType: AnnouncementType | null;
  boundAnnouncementValid: boolean;
  // 啟用中彈窗依 updatedAt DESC、id DESC 排序後的順位（1~5）；未啟用則為 null。
  activeRank: number | null;
};

/** 管理員後台列表：帶出綁定公告的標題/類型/發布日期、即時判斷綁定是否仍然
 * 有效、以及啟用中彈窗目前的排序順位（1~5，對應前台會顯示的順序）。 */
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
      boundAnnouncementType: r.boundAnnouncementType,
      // 公告已刪除（announcementId 被 FK 設成 NULL 或找不到 join 結果）或類型已被
      // 改成登入彈窗白名單以外的類型（例如被改成停機維護），都視為「綁定公告
      // 已失效」。
      boundAnnouncementValid: r.announcementId != null && r.boundAnnouncementTitle != null
        && r.boundAnnouncementType != null && isLoginPopupBindableAnnouncementType(r.boundAnnouncementType),
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

  const announcement = await getBindableLoginPopupAnnouncementById(data.announcementId);
  if (!announcement) {
    throw new Error("綁定的公告不存在，或不是可用的平台消息／版本更新公告");
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
    const announcement = await getBindableLoginPopupAnnouncementById(data.announcementId);
    if (!announcement) {
      throw new Error("綁定的公告不存在，或不是可用的平台消息／版本更新公告");
    }
  }

  // 停用中的彈窗要重新啟用前，必須確認目前綁定（可能是本次更新前就已存在的
  // 綁定，未必是這次一起更新的 announcementId）仍然有效，不能只信任前端。
  if (data.isActive === true) {
    const [current] = await db.select().from(loginPopups).where(eq(loginPopups.id, id)).limit(1);
    if (!current) throw new Error("找不到該登入彈窗");
    const effectiveAnnouncementId = data.announcementId ?? current.announcementId;
    if (!effectiveAnnouncementId) {
      throw new Error("綁定公告已失效，請重新綁定有效的平台消息或版本更新公告後才能啟用");
    }
    const announcement = await getBindableLoginPopupAnnouncementById(effectiveAnnouncementId);
    if (!announcement) {
      throw new Error("綁定公告已失效，請重新綁定有效的平台消息或版本更新公告後才能啟用");
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
 * 顯示條件只有：isActive=true、綁定公告存在且類型屬於登入彈窗可綁定白名單
 * （平台消息／版本更新，不含停機維護）；沒有時間區間判斷——啟用立即生效、
 * 停用立即停止顯示。不論訪客或會員都是同一份資料，差別只在於「今天是否已
 * 看過」這一層要不要檢查（見下方兩個呼叫端函式），避免維護兩份幾乎一樣的 SQL。
 *
 * 前台顯示順序：最舊在最上方、最新在最下方（updatedAt asc、id asc）。
 * 這跟「選出哪 5 則」是兩件事——管理員後台列表（getLoginPopupsForAdmin）與
 * 淘汰邏輯（enforceMaxFiveActiveLoginPopups）維持原本的 updatedAt desc、
 * id desc，不受這裡影響。
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
      inArray(announcements.type, LOGIN_POPUP_BINDABLE_ANNOUNCEMENT_TYPES as AnnouncementType[]),
    ))
    // 這裡刻意維持 desc + limit（而不是直接改成 asc 再 limit）：desc 排序後
    // LIMIT 選出的一定是「目前啟用中最新的 MAX_ACTIVE_LOGIN_POPUPS 則」，跟
    // 前台最終顯示順序無關——這一步只負責選出正確的候選集合。若在這裡就
    // 改成 asc + limit，選到的會是「最舊的 5 則」，只有剛好啟用數 ≤5 則時
    // 結果才會剛好相同，一旦超過 5 則就會選錯集合（把不該顯示的舊資料
    // 顯示出來、擠掉真正該顯示的最新幾則）。
    .orderBy(desc(loginPopups.updatedAt), desc(loginPopups.id))
    .limit(MAX_ACTIVE_LOGIN_POPUPS);

  // 選出「最新 MAX_ACTIVE_LOGIN_POPUPS 則」這個候選集合之後，才在應用層把
  // 陣列反轉成前台要求的顯示順序：最舊在最上方、最新在最下方
  // （等同 updatedAt asc、id asc）。只調整這個集合內部的顯示順序，不影響
  // 上面 SQL 選中的是哪幾筆。
  return rows
    .filter((r): r is typeof r & { announcementId: number } => r.announcementId != null) // 理論上 inner join 已保證非 null，這裡再防一層
    .map(r => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      announcementId: r.announcementId,
      announcementTitle: r.announcementTitle,
      updatedAt: r.updatedAt,
    }))
    .reverse();
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
    address: factories.address,
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

// 21 個基本資料欄位白名單（不含 businessType，申請後無法更改）
export const BASIC_DATA_FIELDS = [
  "name", "industry", "subIndustry", "mfgModes", "region", "description",
  "capitalLevel", "foundedYear", "ownerName", "contactPersonName", "phone",
  "website", "contactEmail", "address", "operationStatus",
  "weekdayHours", "weekendHours", "businessNote", "avatarUrl", "avatarCrop",
  "certificationBadges", "certificationEvidence",
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
    avatarCrop: (factory as any).avatarCrop ?? null,
    certificationBadges: (factory as any).certificationBadges ?? [],
    certificationEvidence: (factory as any).certificationEvidence ?? [],
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
    // 徽章系統：badges/evidence 一律成對清洗（evidence 只保留仍在 badges 清單中的項目），
    // 與 updateFactory() 共用同一個 sanitizeBadgeAssignment()，避免 revision 套用時繞過白名單檢查。
    const sanitizedBadgeAssignment = ("certificationBadges" in proposed || "certificationEvidence" in proposed)
      ? sanitizeBadgeAssignment(proposed.certificationBadges, proposed.certificationEvidence)
      : null;
    // 這次修改申請若新增了「先前沒擁有」的徽章，該徽章核准通過的那一刻起
    // 就是「新獲得」，預設公開顯示；先前已擁有的徽章維持工廠自己原本設定的
    // 顯示/隱藏狀態，不因這次審核跟著被重置。需要在套用新的 certificationBadges
    // 之前，先讀出目前實際存的 certificationBadges／certificationBadgesVisible
    // 當基準。
    if (sanitizedBadgeAssignment) {
      const [beforeRows]: any = await conn.execute(
        "SELECT certificationBadges, certificationBadgesVisible FROM factories WHERE id = ?",
        [rev.factoryId],
      );
      const beforeRow = beforeRows?.[0] ?? {};
      const parseArr = (v: unknown): string[] => {
        const parsed = typeof v === "string" ? JSON.parse(v) : v;
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
      };
      const previouslyOwned = new Set(parseArr(beforeRow.certificationBadges));
      const previouslyVisible = parseArr(beforeRow.certificationBadgesVisible);
      const newlyOwned = sanitizedBadgeAssignment.certificationBadges.filter(id => !previouslyOwned.has(id));
      const mergedVisible = sortBadgeIds([...previouslyVisible, ...newlyOwned]);
      setClauses.push("`certificationBadgesVisible` = ?");
      setValues.push(JSON.stringify(mergedVisible));
    }
    for (const field of allowedFields) {
      if (field in proposed) {
        const val = proposed[field];
        // JSON fields
        if (field === "certificationBadges") {
          setClauses.push(`\`${field}\` = ?`);
          setValues.push(JSON.stringify(sanitizedBadgeAssignment?.certificationBadges ?? []));
        } else if (field === "certificationEvidence") {
          setClauses.push(`\`${field}\` = ?`);
          setValues.push(JSON.stringify(sanitizedBadgeAssignment?.certificationEvidence ?? []));
        } else if (field === "industry" || field === "subIndustry" || field === "mfgModes") {
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

/**
 * 管理員「檢視詳情」用：單筆修改申請＋工廠名稱／提交者名稱，供
 * FactoryReviewDetail.tsx 用 revisionId 導航直接進入單筆詳情頁（不需要
 * 先載入整份待審清單），與 getAdminPendingRevisions 回傳相同形狀。
 */
export async function getAdminRevisionDetail(revisionId: number) {
  const db = await getDb();
  if (!db) return null;
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
// Phase 8.1（server/ai/aiQuota.ts）也重用同一顆 pool 做 FOR UPDATE transaction，
// 跟 createFactoryAtomic／acceptInvitation 同一種鎖序模式，不重新開一顆 pool。
export async function getRawPool(): Promise<mysql.Pool> {
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

/**
 * 案件的實際存取權限判斷：以「案件所在地解析出的區域」比對「使用者目前擁有的
 * 有效（isActive）顧問身分」，而不是只看 upgradeApplications.assignedConsultantId。
 * 這樣即使案件尚未分派、或 assignedConsultantId 因故與案件實際地區不一致，
 * 只要顧問的區域身分與案件地區相符，權限判斷依然正確；反過來說，即使
 * assignedConsultantId 剛好等於某顧問的 id，只要地區對不上，也不會放行。
 *
 * location 無法解析出任何已知區域時，回傳 undefined——這類案件預設只有管理員
 * 能查看，任何顧問身分都不放行，避免地址格式異常的案件意外外洩給顧問。
 */
export function findConsultantForApplicationRegion(
  consultants: UpgradeConsultant[],
  app: { location: string },
): UpgradeConsultant | undefined {
  const region = resolveRegionKey(app.location);
  if (!region) return undefined;
  return consultants.find(c => c.isActive && c.regionKey === region);
}

/**
 * 綁定顧問帳號：同一使用者現在可以同時綁定多個地區的顧問列（例如同一人
 * 同時負責北部與南部）——移除了先前「一個帳號只能擔任一個地區顧問」的限制。
 * findConsultantForApplicationRegion／getConsultantsByUserId 本來就是以
 * 「這個使用者名下所有 isActive 顧問列」去比對案件地區，天生就支援一人
 * 綁定多個地區，不需要額外改動權限判斷邏輯。
 */
// 注意：這裡刻意不像 financeConsultant／certificationConsultant 等其他四種
// 顧問一樣擋「同一使用者已綁定其他席位」——upgradeConsultants 是唯一沒有
// userId UNIQUE 索引的顧問表，見 server/upgradeConsultantRegion.test.ts
// 「同一帳號可以同時綁定多個地區」：現實中存在北、南都有服務據點的顧問，
// 這是刻意保留、已有回歸測試覆蓋的既有業務規則，不是遺漏，不要加驗證擋下。
export async function bindConsultantUser(consultantId: number, userId: number | null): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeConsultants)
    .set({ userId })
    .where(eq(upgradeConsultants.id, consultantId));
}

// 政府補助顧問啟停用：與 financeConsultant／certificationConsultant／
// erpConsultant／shortVideoConsultant 的 adminSetXConsultantActive 不同，
// 這裡刻意不做「停用時把 open 案件 cascade 改回 unassigned」——政府補助的
// 顧問可視權限（myCases／acknowledge／updateCaseStatus）本來就是用
// findConsultantForApplicationRegion 依「案件地區」比對「顧問目前有效的
// active 區域身分」，不是看 upgradeApplications.assignedConsultantId；
// 停用後該地區立刻沒有 active 顧問能操作案件，等同已經達到 cascade 的效果，
// 不需要額外改寫案件列，也避免搬動 assignedConsultantId 這個歷史紀錄欄位。
export async function adminSetConsultantActive(id: number, isActive: boolean): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeConsultants).set({ isActive }).where(eq(upgradeConsultants.id, id));
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

// 顧問查看自己案件的權限判斷一律以「案件地區」為準（見 findConsultantForApplicationRegion
// 的說明），不只依 assignedConsultantId 過濾——否則同區尚未分派、或因資料不一致
// 而 assignedConsultantId 對不上的案件會被漏掉。resolveRegionKey 是字串比對邏輯
// （正規化＋關鍵字 includes），無法單純轉成一組 SQL WHERE 條件又不重複維護一份
// 一樣的規則，因此這裡採用「SQL 先依狀態縮小範圍＋應用層用 resolveRegionKey 判斷
// 地區」的做法，與 backfillUnassignedCasesToConsultant 既有的做法一致。
function filterApplicationsByRegions<T extends { location: string }>(
  rows: T[],
  regionKeys: Array<"north" | "central" | "south">,
): T[] {
  return rows.filter(r => {
    const region = resolveRegionKey(r.location);
    return region != null && regionKeys.includes(region);
  });
}

// 承辦顧問顯示名稱：一路沿著真實關聯取得（assignedConsultantId → upgradeConsultants
// → 綁定的 userId → users 顯示名稱），不是用案件地區字串（如「北部」）代替；
// 這裡用 alias 對 users 表做第二次 join，一次查詢就帶回，不需要每張卡片再各自
// 查一次顧問資料（避免 N+1）。未指派或該地區尚未綁定使用者時為 null，前端顯示
// 「尚未指派」。
const assignedConsultantUsers = alias(users, "assignedConsultantUsers");

function selectUpgradeApplicationWithRelations() {
  return {
    ...getTableColumns(upgradeApplications),
    factoryName: factories.name,
    assignedConsultantUserName: sql<string | null>`COALESCE(${assignedConsultantUsers.name}, ${assignedConsultantUsers.primaryEmail}, ${assignedConsultantUsers.email})`,
  };
}

export async function listUpgradeApplicationsByRegions(
  regionKeys: Array<"north" | "central" | "south">,
  opts?: { status?: UpgradeApplication["status"]; limit?: number; offset?: number },
): Promise<(UpgradeApplication & { factoryName: string | null; assignedConsultantUserName: string | null })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (regionKeys.length === 0) return [];
  const conditions = opts?.status ? [eq(upgradeApplications.status, opts.status)] : [];
  const rows = await db_.select(selectUpgradeApplicationWithRelations())
    .from(upgradeApplications)
    .leftJoin(factories, eq(upgradeApplications.factoryId, factories.id))
    .leftJoin(upgradeConsultants, eq(upgradeApplications.assignedConsultantId, upgradeConsultants.id))
    .leftJoin(assignedConsultantUsers, eq(upgradeConsultants.userId, assignedConsultantUsers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(upgradeApplications.createdAt));
  const filtered = filterApplicationsByRegions(rows, regionKeys) as (UpgradeApplication & { factoryName: string | null; assignedConsultantUserName: string | null })[];
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? 100;
  return filtered.slice(offset, offset + limit);
}

export async function countUpgradeApplicationsByRegions(
  regionKeys: Array<"north" | "central" | "south">,
  status?: UpgradeApplication["status"],
): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  if (regionKeys.length === 0) return 0;
  const conditions = status ? [eq(upgradeApplications.status, status)] : [];
  const rows = await db_.select({ location: upgradeApplications.location })
    .from(upgradeApplications)
    .where(conditions.length ? and(...conditions) : undefined);
  return filterApplicationsByRegions(rows, regionKeys).length;
}

// 案件的「最後更新者」快照：userId 供之後查關聯用，name 是當下的顯示名稱快照，
// 沿用 communityBidOffers.lastUpdatedByNameSnapshot 的慣例——即使使用者之後改名
// 或帳號被刪除，歷史紀錄顯示的名稱仍維持當時的樣子，不需要額外 join 也不會消失。
export type CaseUpdatedBy = { userId: number; name: string };

/** 顯示名稱 fallback 順序：暱稱 → 已驗證信箱 → 帳號信箱 → 「使用者 #id」，
 * 避免顧問／管理員帳號沒有填寫暱稱時，最後更新者快照顯示空白。 */
export function resolveActorNameSnapshot(user: { id: number; name: string | null; primaryEmail: string | null; email: string | null }): string {
  return user.name ?? user.primaryEmail ?? user.email ?? `使用者 #${user.id}`;
}

/**
 * ISO／ERP／短影音三個新服務共用的 append-only 狀態歷程項目——每次
 * claimXCase／updateXCaseStatus／adminForceXCaseStatus 都會推入一筆，不覆蓋
 * 先前紀錄。action 區分「一般狀態轉移」與「取件」，forced 標記管理員略過
 * 轉移規則的強制修正（一律連同 reason 一起記錄，供事後稽核）。
 */
export type CaseStatusHistoryEntry = {
  status: string;
  at: string;
  byUserId: number;
  byName: string;
  reason?: string;
  forced?: boolean;
  action?: "claim" | "status_update" | "admin_force";
};

function appendCaseStatusHistory(
  existing: CaseStatusHistoryEntry[] | null | undefined,
  entry: CaseStatusHistoryEntry,
): CaseStatusHistoryEntry[] {
  return [...(existing ?? []), entry];
}

/**
 * 顧問嘗試自助取件（或系統重新查詢後）發現案件已被其他顧問搶先取件／
 * 已被管理員指派時拋出。server/routers.ts 對應 mutation 會轉成 TRPCError
 * CONFLICT，前端據此顯示「案件已由其他顧問承接」並重新整理列表。
 */
export class CaseAlreadyClaimedError extends Error {
  constructor() {
    super("案件已由其他顧問承接，請重新整理");
    this.name = "CaseAlreadyClaimedError";
  }
}

export async function acknowledgeUpgradeApplication(
  id: number,
  consultantId: number,
  userId: number,
  updatedBy?: CaseUpdatedBy,
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
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
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
    deferred: number;
    submitted: number;
    completed: number;
    ineligible: number;
  }>;
  unviewed: number;
  overdue48h: number;
  unassigned: number;
  deferred: number;
}> {
  const db_ = await getDb();
  if (!db_) return { total: 0, byRegion: {}, unviewed: 0, overdue48h: 0, unassigned: 0, deferred: 0 };

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
    inProgress: number; deferred: number; submitted: number; completed: number; ineligible: number;
  }> = {};
  for (const r of regionStatusRows) {
    if (!byRegion[r.regionKey]) {
      byRegion[r.regionKey] = {
        consultantName: r.consultantName,
        total: 0, unviewed: 0, inProgress: 0, deferred: 0, submitted: 0, completed: 0, ineligible: 0,
      };
    }
    const count = Number(r.n);
    byRegion[r.regionKey].total += count;
    if (r.status === "new") byRegion[r.regionKey].unviewed += count;
    // 評估中/已立案（含舊狀態 viewed/contacted/consulting）
    if (["evaluating", "viewed", "contacted", "accepted", "consulting"].includes(r.status))
      byRegion[r.regionKey].inProgress += count;
    // 緩追區：暫緩處理，等待後續合適補助方案
    if (r.status === "deferred") byRegion[r.regionKey].deferred += count;
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

  const [{ deferred }] = await db_.select({ deferred: sql<number>`COUNT(*)` })
    .from(upgradeApplications).where(eq(upgradeApplications.status, "deferred"));

  return {
    total: Number(total),
    byRegion,
    unviewed: Number(unviewed),
    overdue48h: Number(overdue48h),
    unassigned: Number(unassigned),
    deferred: Number(deferred),
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
}): Promise<(UpgradeApplication & { factoryName: string | null; assignedConsultantUserName: string | null })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(upgradeApplications.status, opts.status)] : [];
  const rows = await db_.select(selectUpgradeApplicationWithRelations())
    .from(upgradeApplications)
    .leftJoin(factories, eq(upgradeApplications.factoryId, factories.id))
    .leftJoin(upgradeConsultants, eq(upgradeApplications.assignedConsultantId, upgradeConsultants.id))
    .leftJoin(assignedConsultantUsers, eq(upgradeConsultants.userId, assignedConsultantUsers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(upgradeApplications.createdAt))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
  return rows as (UpgradeApplication & { factoryName: string | null; assignedConsultantUserName: string | null })[];
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
  updatedBy?: CaseUpdatedBy,
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
    .set({
      status, statusTimeline: newTl,
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
    })
    .where(eq(upgradeApplications.id, id));
}

export async function updateUpgradeCaseNotes(id: number, notes: string | null, updatedBy?: CaseUpdatedBy): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(upgradeApplications).set({
    notes,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(upgradeApplications.id, id));
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
  updatedBy?: CaseUpdatedBy,
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
    lastUpdatedByUserId: number;
    lastUpdatedByNameSnapshot: string;
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
  if (updatedBy) {
    update.lastUpdatedByUserId = updatedBy.userId;
    update.lastUpdatedByNameSnapshot = updatedBy.name;
  }
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

// 過件率分子：已通過 OXM 資格審核的案件 —— 只要案件曾經通過資格審核進入
// accepted 或更後段流程（submitted/rejected/approved/transforming/completed，
// 含 legacy consulting），一律算「通過」。rejected 也算通過：rejected 是「已
// 通過 OXM 資格審核、送件後遭政府駁回」，駁回的是政府審核結果，不是 OXM 資格
// 審核結果，因此仍計入分子，不可當成未通過。
const UPGRADE_ACCEPTED_STATUSES = [
  "accepted", "consulting",
  "submitted",
  "rejected",
  "approved", "transforming", "completed",
] as const;

// 過件率分母：已完成「資格判定」的案件（通過 + 未通過）——
//   ineligible：資格不符＝未通過
//   UPGRADE_ACCEPTED_STATUSES 全部（accepted/consulting/submitted/rejected/
//     approved/transforming/completed）：資格審核通過（見上方分子說明）
// 明確排除，不列入分子也不列入分母：
//   evaluating/viewed/contacted：仍在評估中，資格判定尚未定案
//   new／unassigned：案件尚未查收／尚未分派，更談不上資格判定
//   deferred（緩追區）：工廠體質符合但目前無適合方案而暫緩，刻意保留判定、
//     等待後續合適補助出現，因此不算「已完成資格判定」
//   archived：管理員可能在任何階段封存，無法確定是否已完成資格判定，不可一律算入
const UPGRADE_ELIGIBILITY_DECIDED_STATUSES = [
  "ineligible",
  ...UPGRADE_ACCEPTED_STATUSES,
] as const;

export async function getUpgradePublicStats() {
  const db_ = await getDb();
  if (!db_) return { appliedFactories: 0, acceptedCases: 0, evaluatedCases: 0, totalGrantAmountYen: 0, completedCases: 0 };

  // 申請廠商：distinct factoryId（排除未綁定工廠的邊緣案件）
  const [fRow] = await db_
    .select({ n: sql<number>`COUNT(DISTINCT ${upgradeApplications.factoryId})` })
    .from(upgradeApplications)
    .where(isNotNull(upgradeApplications.factoryId));

  // 已完成資格判定的案件數（通過 + 未通過）—— 過件率分母。刻意不包含仍在
  // evaluating／緩追區（deferred）等尚未定案的案件，避免短時間湧入的新案件、
  // 或暫緩處理的案件拉低過件率（欄位名稱 evaluatedCases 為既有前端契約，
  // 語意已更新為「已完成資格判定」，見 UPGRADE_ELIGIBILITY_DECIDED_STATUSES 說明）。
  const [eRow] = await db_
    .select({ n: sql<number>`COUNT(*)` })
    .from(upgradeApplications)
    .where(inArray(upgradeApplications.status, UPGRADE_ELIGIBILITY_DECIDED_STATUSES));

  // acceptedCases：已通過 OXM 資格審核的案件數（accepted/consulting/submitted/
  // rejected/approved/transforming/completed）—— 過件率分子。注意這裡代表
  // 「已通過 OXM 資格審核」，不是僅指「政府核准補助」的案件數（rejected 是政府
  // 審核駁回，OXM 資格審核仍算通過，因此也計入），因此命名為 acceptedCases 而非
  // approvedCases，避免與 approved 這個 status 名稱混淆。
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

// ===== 企業財務優化 =====
// 與企業升級中心（upgradeApplications／upgradeConsultants）完全獨立的資料模型與
// 顧問權限：授權只看「financeConsultants 是否有一筆該 userId 的有效（isActive）
// 紀錄」，不是固定 email／userId／前端判斷。目前只有單一顧問，因此不像政府補助
// 顧問區分北中南地區——任何一位有效財務顧問可查看／處理全部財務案件；
// 未來若擴充多位顧問，可在此加上分派規則，不影響既有呼叫端。

export async function getFinanceConsultantsByUserId(userId: number): Promise<FinanceConsultant[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(financeConsultants).where(eq(financeConsultants.userId, userId));
}

export async function getFinanceConsultantById(id: number): Promise<FinanceConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(financeConsultants).where(eq(financeConsultants.id, id));
  return row;
}

export type FinanceConsultantWithBoundUser = FinanceConsultant & { boundUser: BoundUserInfo | null };

export async function listAllFinanceConsultants(): Promise<FinanceConsultantWithBoundUser[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const consultants = await db_.select().from(financeConsultants).orderBy(financeConsultants.id);
  const userIds = consultants.map(c => c.userId).filter((id): id is number => id != null);
  const userMap = new Map<number, BoundUserInfo>();
  if (userIds.length > 0) {
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
  return consultants.map(c => ({ ...c, boundUser: c.userId != null ? (userMap.get(c.userId) ?? null) : null }));
}

export async function adminCreateFinanceConsultant(name: string): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(financeConsultants).values({ name, isActive: true });
  return result.insertId;
}

/**
 * 財務顧問指派／停用／解除綁定這幾個 transaction 都會對 financeConsultants
 * 加 row lock（FOR UPDATE），但取得鎖的路徑不完全相同：自動指派的候選人查詢
 * 是 `WHERE isActive=true AND userId IS NOT NULL` 條件掃描，可能經由 userId
 * 的 UNIQUE INDEX；停用／解除綁定則是先用主鍵精確查詢再更新。兩種路徑在
 * InnoDB 底層取得 index lock 的順序不保證完全一致，高併發下仍可能出現真正
 * 的 MySQL deadlock（ER_LOCK_DEADLOCK）——這是 MySQL 保證會偵測並讓其中一個
 * transaction 完整 rollback 的正常機制（不會留下部分寫入的中間狀態），標準
 * 作法是讓呼叫端重試整個 transaction。這裡提供一個小的重試包裝，讓這四個
 * financeConsultants 相關 transaction 在遇到 deadlock 時自動重試，避免把
 * 這種瞬時、可安全重試的情況以錯誤回傳給使用者。
 */
async function withDeadlockRetry<T>(run: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err: unknown) {
      const code = (err as { code?: string; cause?: { code?: string } })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "ER_LOCK_DEADLOCK" && attempt < maxAttempts) continue;
      throw err;
    }
  }
}

/**
 * 顧問名下未結案（new／evaluating／deferred）案件安全改為未指派：在同一筆
 * transaction 內完成「解除承辦顧問」與「記錄最後更新者」，避免出現「案件顯示
 * 已指派給某顧問，但該顧問已停用／解除綁定、實際無人能經過權限檢查讀取」的
 * 中間狀態。結案狀態（not_interested／won）不受影響，保留歷史資料。
 * 呼叫端（adminSetFinanceConsultantActive／adminBindFinanceConsultantUser）
 * 都已經在各自的 transaction 內呼叫這支函式，此處直接吃 tx。
 */
async function reassignOpenFinanceCasesAwayFromConsultant(
  tx: any, // drizzle transaction handle — only called from within db_.transaction(async (tx) => ...) below
  consultantId: number,
  updatedBy?: CaseUpdatedBy,
): Promise<FinanceApplication[]> {
  const openRows: FinanceApplication[] = await tx.select().from(financeApplications)
    .where(and(
      eq(financeApplications.assignedConsultantId, consultantId),
      inArray(financeApplications.status, FINANCE_OPEN_STATUSES),
    ));
  if (openRows.length === 0) return [];
  await tx.update(financeApplications).set({
    assignedConsultantId: null,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(and(
    eq(financeApplications.assignedConsultantId, consultantId),
    inArray(financeApplications.status, FINANCE_OPEN_STATUSES),
  ));
  return openRows;
}

/** 停用顧問：isActive=false 時，名下未結案案件在同一 transaction 內安全改為
 *  未指派（見 reassignOpenFinanceCasesAwayFromConsultant）。重新啟用
 *  （isActive=true）不需要級聯，案件本來就沒有因為停用而被動過。 */
export async function adminSetFinanceConsultantActive(
  id: number,
  isActive: boolean,
  updatedBy?: CaseUpdatedBy,
): Promise<{ reassignedCases: FinanceApplication[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    // 與 createFinanceApplicationWithAutoAssign 使用相同的鎖定順序：先對
    // financeConsultants 目標列取得 row lock（FOR UPDATE），確保跟自動指派的
    // transaction 之間不會出現交錯的中間狀態——不論哪個 transaction 先取得鎖，
    // 兩邊都會等對方 commit 後才看到彼此的變更，結果永遠一致。
    await tx.select().from(financeConsultants).where(eq(financeConsultants.id, id)).for("update");
    await tx.update(financeConsultants).set({ isActive }).where(eq(financeConsultants.id, id));
    if (isActive) return { reassignedCases: [] };
    const reassignedCases = await reassignOpenFinanceCasesAwayFromConsultant(tx, id, updatedBy);
    return { reassignedCases };
  }));
}

/**
 * 綁定顧問帳號前的唯一性檢查：同一 userId 不能同時綁定兩筆顧問紀錄，否則會
 * 讓「系統只有一位啟用中顧問時自動指派」的判斷失準（例如同一人被重複綁定
 * 兩筆啟用中紀錄時，autoAssignFinanceConsultant 會誤判為「有兩位顧問」而
 * 放棄自動指派）。這是綁定前的語意清楚預檢查，讓管理端拿到人類可讀的錯誤
 * 訊息；真正的高併發競態保護是 DB 層 fc_user_id_uq UNIQUE INDEX——即使兩個
 * 請求同時通過這裡的預檢查，實際 UPDATE 時仍會被 UNIQUE INDEX 擋下一筆，
 * 呼叫端（routers.ts adminBindUser）另外攔截 ER_DUP_ENTRY 轉換成固定的
 * BAD_REQUEST 訊息，不會外洩原始 SQL 錯誤。解除綁定（userId=null）不受此限制。
 */
export async function assertFinanceConsultantUserNotBoundElsewhere(consultantId: number, userId: number): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const existing = await db_.select({ id: financeConsultants.id, name: financeConsultants.name })
    .from(financeConsultants)
    .where(and(eq(financeConsultants.userId, userId), ne(financeConsultants.id, consultantId)));
  if (existing.length > 0) {
    throw new Error(`此使用者已綁定顧問「${existing[0].name}」，一個帳號同時只能擔任一位財務優化顧問`);
  }
}

/** 解除綁定（userId=null）時，名下未結案案件在同一 transaction 內安全改為
 *  未指派，理由同 adminSetFinanceConsultantActive。綁定新使用者（userId 非
 *  null）不需要級聯。 */
export async function adminBindFinanceConsultantUser(
  id: number,
  userId: number | null,
  updatedBy?: CaseUpdatedBy,
): Promise<{ reassignedCases: FinanceApplication[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  if (userId != null) {
    await assertFinanceConsultantUserNotBoundElsewhere(id, userId);
  }
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    // 同上：先鎖定 financeConsultants 目標列，與自動指派 transaction 使用
    // 相同的鎖定順序，避免「解除綁定與自動指派交錯，案件被指派給已解除綁定
    // 顧問」的中間狀態。
    await tx.select().from(financeConsultants).where(eq(financeConsultants.id, id)).for("update");
    await tx.update(financeConsultants).set({ userId }).where(eq(financeConsultants.id, id));
    if (userId != null) return { reassignedCases: [] };
    const reassignedCases = await reassignOpenFinanceCasesAwayFromConsultant(tx, id, updatedBy);
    return { reassignedCases };
  }));
}

/** 自動指派：候選人必須同時符合 isActive=true 且 userId 已綁定
 *  （userId IS NOT NULL）——啟用中但尚未綁定使用者帳號的顧問無法實際登入
 *  查看案件，指派給這種顧問等同於指派給沒有人能存取的黑洞。只有「剛好一位」
 *  同時符合兩個條件的顧問時才自動指派，避免未來多顧問情境下猜錯分派對象；
 *  沒有或有多位符合條件的顧問時回傳 null，案件仍會建立，由管理員在後台看見
 *  「未指派」再手動處理。 */
export async function autoAssignFinanceConsultant(): Promise<FinanceConsultant | null> {
  const db_ = await getDb();
  if (!db_) return null;
  const candidates = await db_.select().from(financeConsultants)
    .where(and(eq(financeConsultants.isActive, true), isNotNull(financeConsultants.userId)));
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * 自動指派＋建立案件：候選人查詢與案件寫入必須在同一個 transaction、對候選
 * 顧問列加上真正的 row lock（SELECT ... FOR UPDATE）內完成——否則會出現
 * 「查詢候選人時還有一位啟用中顧問 → 顧問被停用、名下案件已改為未指派 →
 * 新案件才寫入，卻指派給這個剛被停用的顧問」的競態窗口（候選人查詢與案件
 * 寫入之間存在時間差，足以讓另一個停用/解除綁定的 transaction 插進來）。
 *
 * FOR UPDATE 鎖定候選列後，任何同時想停用／解除綁定同一顧問的 transaction
 * （adminSetFinanceConsultantActive／adminBindFinanceConsultantUser，同樣
 * 會鎖定 financeConsultants 列）都必須等這個 transaction commit 之後才能
 * 繼續——不論哪個 transaction 先取得鎖，最終結果都是一致的：
 *   - 如果停用/解除綁定先 commit：這裡的候選人查詢會看到最新狀態（該顧問
 *     已不符合條件），新案件正確地維持未指派或指派給其他仍有效的候選人。
 *   - 如果這裡先 commit：新案件已指派給（當下仍有效的）顧問；隨後停用/解除
 *     綁定 transaction 執行時，reassignOpenFinanceCasesAwayFromConsultant
 *     會重新查詢當下資料（此時已包含剛 commit 的新案件），照常把它一併
 *     級聯改為未指派——不會停留在「指派給已停用顧問」的中間狀態。
 */
export async function createFinanceApplicationWithAutoAssign(
  data: Omit<InsertFinanceApplication, "assignedConsultantId">,
): Promise<{ id: number; assignedConsultant: FinanceConsultant | null }> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    // 強制用 PRIMARY（主鍵）掃描，不要用 userId 的 UNIQUE INDEX（fc_user_id_uq）
    // ——financeConsultants 只有個位數列，強制全表掃描沒有效能疑慮；換來的是
    // 跟 adminSetFinanceConsultantActive／adminBindFinanceConsultantUser／
    // adminAssignFinanceConsultant 完全一致的鎖定順序（一律先鎖主鍵列）。如果
    // 讓查詢最佳化器自行選擇，很容易選到 userId 的 UNIQUE INDEX 做 range scan，
    // 這樣一來這裡取得鎖的順序（先鎖 index entry、才鎖主鍵列）會跟「先用主鍵
    // 查到列、才更新 userId 這個有 UNIQUE INDEX 的欄位」的解除綁定 transaction
    // 相反，兩者同時發生時就會形成真正的 MySQL deadlock（ER_LOCK_DEADLOCK）。
    const candidates = await tx.select().from(financeConsultants, { useIndex: "PRIMARY" })
      .where(and(eq(financeConsultants.isActive, true), isNotNull(financeConsultants.userId)))
      .for("update");
    const assignedConsultant = candidates.length === 1 ? candidates[0] : null;
    const [result] = await tx.insert(financeApplications).values({
      ...data,
      assignedConsultantId: assignedConsultant?.id ?? null,
    });
    return { id: result.insertId, assignedConsultant };
  }));
}

export async function hasOpenFinanceApplication(factoryId: number): Promise<boolean> {
  const db_ = await getDb();
  if (!db_) return false;
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(financeApplications)
    .where(and(
      eq(financeApplications.factoryId, factoryId),
      inArray(financeApplications.status, FINANCE_OPEN_STATUSES),
    ));
  return Number(row?.n ?? 0) > 0;
}

const FINANCE_OPEN_STATUSES = ["new", "evaluating", "deferred"] as const;

export async function createFinanceApplication(data: InsertFinanceApplication): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(financeApplications).values(data);
  return result.insertId;
}

export async function getFinanceApplicationById(id: number): Promise<FinanceApplication | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(financeApplications).where(eq(financeApplications.id, id));
  return row;
}

export async function getFinanceApplicationsByFactoryIds(factoryIds: number[]): Promise<FinanceApplication[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (factoryIds.length === 0) return [];
  return db_.select().from(financeApplications)
    .where(inArray(financeApplications.factoryId, factoryIds))
    .orderBy(desc(financeApplications.createdAt));
}

// 承辦顧問顯示名稱：一路沿真實關聯取得（assignedConsultantId → financeConsultants
// → 綁定的 userId → users 顯示名稱），與 selectUpgradeApplicationWithRelations 相同手法。
const assignedFinanceConsultantUsers = alias(users, "assignedFinanceConsultantUsers");

function selectFinanceApplicationWithRelations() {
  return {
    ...getTableColumns(financeApplications),
    assignedConsultantUserName: sql<string | null>`COALESCE(${assignedFinanceConsultantUsers.name}, ${assignedFinanceConsultantUsers.primaryEmail}, ${assignedFinanceConsultantUsers.email})`,
  };
}

export async function listFinanceApplications(opts?: {
  status?: FinanceApplication["status"];
  limit?: number;
  offset?: number;
}): Promise<(FinanceApplication & { assignedConsultantUserName: string | null })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(financeApplications.status, opts.status)] : [];
  const rows = await db_.select(selectFinanceApplicationWithRelations())
    .from(financeApplications)
    .leftJoin(financeConsultants, eq(financeApplications.assignedConsultantId, financeConsultants.id))
    .leftJoin(assignedFinanceConsultantUsers, eq(financeConsultants.userId, assignedFinanceConsultantUsers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    // createdAt DESC 加上 id DESC 當唯一 tie-breaker：createdAt 精度是秒級，
    // 同一秒內建立多筆案件時，光靠 createdAt 排序在分頁下（limit/offset）不
    // 保證穩定順序，可能導致同一筆案件在不同頁之間重複出現或被跳過；id 是
    // primary key，加進來當第二排序鍵可以讓每次查詢的順序完全確定。
    .orderBy(desc(financeApplications.createdAt), desc(financeApplications.id))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
  return rows as (FinanceApplication & { assignedConsultantUserName: string | null })[];
}

export async function countFinanceApplications(status?: FinanceApplication["status"]): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const conditions = status ? [eq(financeApplications.status, status)] : [];
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(financeApplications)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.n ?? 0);
}

export async function updateFinanceApplicationStatus(
  id: number,
  status: FinanceApplication["status"],
  updatedBy?: CaseUpdatedBy,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const [cur] = await db_.select({ tl: financeApplications.statusTimeline })
    .from(financeApplications).where(eq(financeApplications.id, id));
  const existing = (cur?.tl ?? {}) as Record<string, string>;
  const newTl = { ...existing };
  if (!newTl[status]) newTl[status] = new Date().toISOString();
  await db_.update(financeApplications).set({
    status, statusTimeline: newTl,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(financeApplications.id, id));
}

export async function updateFinanceCaseNotes(id: number, notes: string | null, updatedBy?: CaseUpdatedBy): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(financeApplications).set({
    notes,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(financeApplications.id, id));
}

/**
 * 手動指派／改派承辦顧問：Server 端一律拒絕指派給停用中、尚未綁定使用者帳號
 * 或不存在的顧問——這三種顧問要嘛已無法登入查看案件、要嘛根本不存在，指派
 * 給它們等同於把案件送進沒有人能存取的黑洞。router 層（financeConsultant.
 * adminAssignConsultant）已有相同前置檢查，這裡是 defense-in-depth，避免
 * 未來新增其他呼叫路徑時繞過驗證。
 */
export async function adminAssignFinanceConsultant(
  id: number,
  consultantId: number | null,
  updatedBy?: CaseUpdatedBy,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await withDeadlockRetry(() => db_.transaction(async (tx) => {
    // 手動指派也必須在 transaction 內、鎖定顧問列之後重新驗證一次，否則
    // router 層先前的預檢查（db.getFinanceConsultantById）可能在檢查通過之後、
    // 這裡真正寫入之前，被另一個停用／解除綁定的 transaction 搶先 commit，
    // 造成案件仍然被指派給一個已經停用/解除綁定的顧問。與
    // createFinanceApplicationWithAutoAssign／adminSetFinanceConsultantActive／
    // adminBindFinanceConsultantUser 使用相同的鎖定順序（先鎖 financeConsultants）。
    if (consultantId != null) {
      const [consultant] = await tx.select().from(financeConsultants)
        .where(eq(financeConsultants.id, consultantId))
        .for("update");
      if (!consultant) throw new Error("找不到顧問，無法指派承辦");
      if (!consultant.isActive) throw new Error("此顧問目前已停用，無法指派承辦");
      if (consultant.userId == null) throw new Error("此顧問尚未綁定使用者帳號，無法指派承辦");
    }
    await tx.update(financeApplications).set({
      assignedConsultantId: consultantId,
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
    }).where(eq(financeApplications.id, id));
  }));
}

// ===== 短影音與品牌內容行銷專區：顧問設定與申請案件 =====
// 與企業升級中心／企業財務優化完全獨立的資料模型與權限：顧問授權只看
// shortVideoConsultants 是否有一筆該 userId 的有效（isActive）紀錄。

export async function getShortVideoConsultantsByUserId(userId: number): Promise<ShortVideoConsultant[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(shortVideoConsultants).where(eq(shortVideoConsultants.userId, userId));
}

export async function getShortVideoConsultantById(id: number): Promise<ShortVideoConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(shortVideoConsultants).where(eq(shortVideoConsultants.id, id));
  return row;
}

export type ShortVideoConsultantWithBoundUser = ShortVideoConsultant & { boundUser: BoundUserInfo | null };

export async function listAllShortVideoConsultants(): Promise<ShortVideoConsultantWithBoundUser[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const consultants = await db_.select().from(shortVideoConsultants).orderBy(shortVideoConsultants.id);
  const userIds = consultants.map(c => c.userId).filter((id): id is number => id != null);
  const userMap = new Map<number, BoundUserInfo>();
  if (userIds.length > 0) {
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
  return consultants.map(c => ({ ...c, boundUser: c.userId != null ? (userMap.get(c.userId) ?? null) : null }));
}

export async function adminCreateShortVideoConsultant(name: string, serviceAreas: string[] = []): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(shortVideoConsultants).values({ name, serviceAreas, isActive: true });
  return result.insertId;
}

/**
 * 顧問啟用／解除綁定／改派這幾個 transaction 都會對 shortVideoConsultants
 * 目標列加上 row lock（FOR UPDATE），鎖定順序與 createShortVideoCaseWithAutoAssign
 * 一致（一律先鎖 shortVideoConsultants），避免自動指派與這裡的異動同時發生時
 * 產生 MySQL deadlock。與 financeConsultants 對應函式手法完全相同。
 */
export async function adminSetShortVideoConsultantActive(id: number, isActive: boolean, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: ShortVideoCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(shortVideoConsultants).where(eq(shortVideoConsultants.id, id)).for("update");
    await tx.update(shortVideoConsultants).set({ isActive }).where(eq(shortVideoConsultants.id, id));
    if (isActive) return { reassignedCases: [] };
    return reassignOpenShortVideoCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

async function reassignOpenShortVideoCasesAwayFromConsultant(
  tx: any, // drizzle transaction handle — only called from within db_.transaction(async (tx) => ...) above
  consultantId: number,
  updatedBy?: CaseUpdatedBy,
): Promise<{ reassignedCases: ShortVideoCase[] }> {
  const openRows: ShortVideoCase[] = await tx.select().from(shortVideoCases)
    .where(and(
      eq(shortVideoCases.assignedConsultantId, consultantId),
      inArray(shortVideoCases.status, SHORT_VIDEO_OPEN_STATUSES_DB),
    ));
  if (openRows.length === 0) return { reassignedCases: [] };
  await tx.update(shortVideoCases).set({
    assignedConsultantId: null,
    status: "unassigned",
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(and(
    eq(shortVideoCases.assignedConsultantId, consultantId),
    inArray(shortVideoCases.status, SHORT_VIDEO_OPEN_STATUSES_DB),
  ));
  return { reassignedCases: openRows };
}

export async function adminBindShortVideoConsultantUser(id: number, userId: number | null, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: ShortVideoCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  if (userId != null) {
    const existing = await db_.select({ id: shortVideoConsultants.id })
      .from(shortVideoConsultants)
      .where(and(eq(shortVideoConsultants.userId, userId), ne(shortVideoConsultants.id, id)));
    if (existing.length > 0) throw new Error("此使用者已綁定其他短影音顧問身份");
  }
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(shortVideoConsultants).where(eq(shortVideoConsultants.id, id)).for("update");
    await tx.update(shortVideoConsultants).set({ userId }).where(eq(shortVideoConsultants.id, id));
    if (userId != null) return { reassignedCases: [] };
    return reassignOpenShortVideoCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

// 含 'evaluating' 這個舊值：0075 是向後相容 additive migration，enum 仍保留舊九態，
// 部署切換期間任何殘留舊值的資料列都必須繼續被視為未結案。
const SHORT_VIDEO_OPEN_STATUSES_DB = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
  "needs_interview", "pre_production", "script_review", "draft_review", "delivered", "ongoing_operation",
] as const;

/**
 * 自動指派候選人：必須同時符合 isActive=true、userId 已綁定，且
 * serviceAreas 為空陣列（承接全部服務）或與本次 servicesWanted 有交集
 * （isUnsure=true 時視為與任何 serviceAreas 都相符，因為此時案件本身還沒
 * 決定要哪個服務，任何顧問都能先接手判斷）。只有「剛好一位」符合的顧問
 * 才自動指派，避免多顧問情境下猜錯分派對象；沒有或有多位符合時回傳
 * null，案件仍會建立為 unassigned，由管理員在後台手動指派。
 */
function matchesShortVideoConsultant(
  consultant: ShortVideoConsultant,
  servicesWanted: string[],
  isUnsure: boolean,
): boolean {
  if (!consultant.isActive || consultant.userId == null) return false;
  const areas = consultant.serviceAreas ?? [];
  if (areas.length === 0) return true;
  if (isUnsure) return true;
  return servicesWanted.some(s => areas.includes(s));
}

export async function createShortVideoCaseWithAutoAssign(
  data: Omit<InsertShortVideoCase, "assignedConsultantId" | "status"> & { servicesWanted: string[]; isUnsure: boolean },
): Promise<{ id: number; assignedConsultant: ShortVideoConsultant | null }> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const allConsultants = await tx.select().from(shortVideoConsultants, { useIndex: "PRIMARY" })
      .where(eq(shortVideoConsultants.isActive, true))
      .for("update");
    const candidates = allConsultants.filter(c => matchesShortVideoConsultant(c, data.servicesWanted, data.isUnsure));
    const assignedConsultant = candidates.length === 1 ? candidates[0] : null;
    const [result] = await tx.insert(shortVideoCases).values({
      ...data,
      assignedConsultantId: assignedConsultant?.id ?? null,
      status: assignedConsultant ? "new" : "unassigned",
    });
    return { id: result.insertId, assignedConsultant };
  }));
}

export async function hasOpenShortVideoCase(factoryId: number): Promise<boolean> {
  const db_ = await getDb();
  if (!db_) return false;
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(shortVideoCases)
    .where(and(
      eq(shortVideoCases.factoryId, factoryId),
      inArray(shortVideoCases.status, SHORT_VIDEO_OPEN_STATUSES_DB),
    ));
  return Number(row?.n ?? 0) > 0;
}

export async function getShortVideoCaseById(id: number): Promise<ShortVideoCase | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(shortVideoCases).where(eq(shortVideoCases.id, id));
  return row;
}

export async function getShortVideoCasesByFactoryIds(factoryIds: number[]): Promise<ShortVideoCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (factoryIds.length === 0) return [];
  return db_.select().from(shortVideoCases)
    .where(inArray(shortVideoCases.factoryId, factoryIds))
    .orderBy(desc(shortVideoCases.createdAt));
}

// 顧問只能看見指派給自己（consultantIds 為其名下所有 shortVideoConsultants
// id）的案件——與 financeApplications「單一顧問池、任一顧問看全部」不同，
// 短影音顧問依服務資格分派，彼此不應互相看到對方負責的案件；管理員另外
// 呼叫 listShortVideoCasesAdmin 取得全部案件。
export async function listShortVideoCasesForConsultant(consultantIds: number[], status?: ShortVideoCase["status"]): Promise<ShortVideoCase[]> {
  const db_ = await getDb();
  if (!db_ || consultantIds.length === 0) return [];
  const conditions = [inArray(shortVideoCases.assignedConsultantId, consultantIds)];
  if (status) conditions.push(eq(shortVideoCases.status, status));
  return db_.select().from(shortVideoCases)
    .where(and(...conditions))
    .orderBy(desc(shortVideoCases.createdAt), desc(shortVideoCases.id));
}

export async function listShortVideoCasesAdmin(opts?: {
  status?: ShortVideoCase["status"];
  limit?: number;
  offset?: number;
}): Promise<ShortVideoCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(shortVideoCases.status, opts.status)] : [];
  return db_.select().from(shortVideoCases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(shortVideoCases.createdAt), desc(shortVideoCases.id))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
}

export async function countShortVideoCases(status?: ShortVideoCase["status"]): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const conditions = status ? [eq(shortVideoCases.status, status)] : [];
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(shortVideoCases)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.n ?? 0);
}

export async function updateShortVideoCaseStatus(
  id: number,
  status: ShortVideoCase["status"],
  updatedBy?: CaseUpdatedBy,
  opts?: { reason?: string; forced?: boolean },
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const [cur] = await db_.select({ tl: shortVideoCases.statusTimeline, history: shortVideoCases.statusHistory })
    .from(shortVideoCases).where(eq(shortVideoCases.id, id));
  const existing = (cur?.tl ?? {}) as Record<string, string>;
  const newTl = { ...existing };
  const nowIso = new Date().toISOString();
  if (!newTl[status]) newTl[status] = nowIso;
  const newHistory = appendCaseStatusHistory(cur?.history as CaseStatusHistoryEntry[] | null, {
    status, at: nowIso,
    byUserId: updatedBy?.userId ?? 0, byName: updatedBy?.name ?? "",
    reason: opts?.reason, forced: opts?.forced,
    action: opts?.forced ? "admin_force" : "status_update",
  });
  await db_.update(shortVideoCases).set({
    status, statusTimeline: newTl, statusHistory: newHistory,
    ...(opts?.reason ? { statusReason: opts.reason } : {}),
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(shortVideoCases.id, id));
}

/** 短影音版自助取件，邏輯與 claimCertificationCase 完全對稱，見該處註解。 */
export async function claimShortVideoCase(caseId: number, consultantId: number, updatedBy: CaseUpdatedBy): Promise<ShortVideoCase> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const [item] = await tx.select().from(shortVideoCases).where(eq(shortVideoCases.id, caseId)).for("update");
    if (!item) throw new Error("找不到案件");
    if (item.status !== "unassigned" || item.assignedConsultantId != null) {
      throw new CaseAlreadyClaimedError();
    }
    const nowIso = new Date().toISOString();
    const existingTl = (item.statusTimeline ?? {}) as Record<string, string>;
    const newTl = { ...existingTl };
    if (!newTl.new) newTl.new = nowIso;
    const newHistory = appendCaseStatusHistory(item.statusHistory as CaseStatusHistoryEntry[] | null, {
      status: "new", at: nowIso, byUserId: updatedBy.userId, byName: updatedBy.name, action: "claim",
    });
    await tx.update(shortVideoCases).set({
      assignedConsultantId: consultantId,
      status: "new",
      claimedAt: new Date(),
      statusTimeline: newTl,
      statusHistory: newHistory,
      lastUpdatedByUserId: updatedBy.userId,
      lastUpdatedByNameSnapshot: updatedBy.name,
    }).where(eq(shortVideoCases.id, caseId));
    return { ...item, assignedConsultantId: consultantId, status: "new" as const, statusTimeline: newTl, statusHistory: newHistory };
  }));
}

export async function updateShortVideoCaseNotes(id: number, notes: string | null, updatedBy?: CaseUpdatedBy): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(shortVideoCases).set({
    notes,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(shortVideoCases.id, id));
}

export async function adminAssignShortVideoConsultant(
  id: number,
  consultantId: number | null,
  updatedBy?: CaseUpdatedBy,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await withDeadlockRetry(() => db_.transaction(async (tx) => {
    if (consultantId != null) {
      const [consultant] = await tx.select().from(shortVideoConsultants)
        .where(eq(shortVideoConsultants.id, consultantId))
        .for("update");
      if (!consultant) throw new Error("找不到顧問，無法指派承辦");
      if (!consultant.isActive) throw new Error("此顧問目前已停用，無法指派承辦");
      if (consultant.userId == null) throw new Error("此顧問尚未綁定使用者帳號，無法指派承辦");
    }
    await tx.update(shortVideoCases).set({
      assignedConsultantId: consultantId,
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
    }).where(eq(shortVideoCases.id, id));
  }));
}

// ===== ISO 與低碳認證專區：顧問設定與申請案件 =====
// 與其他服務完全獨立的資料模型與權限。servicesWanted 存的是
// certificationServiceItems.code，寫入前必須先驗證是既有目錄裡「已上架
// （published + serviceEnabled）」的服務代碼，見 submitApplication 呼叫端
// （server/routers.ts）搭配 listPublicCertificationServices 做的白名單檢查。

export async function getCertificationConsultantsByUserId(userId: number): Promise<CertificationConsultant[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(certificationConsultants).where(eq(certificationConsultants.userId, userId));
}

export async function getCertificationConsultantById(id: number): Promise<CertificationConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(certificationConsultants).where(eq(certificationConsultants.id, id));
  return row;
}

export type CertificationConsultantWithBoundUser = CertificationConsultant & { boundUser: BoundUserInfo | null };

export async function listAllCertificationConsultants(): Promise<CertificationConsultantWithBoundUser[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const consultants = await db_.select().from(certificationConsultants).orderBy(certificationConsultants.id);
  const userIds = consultants.map(c => c.userId).filter((id): id is number => id != null);
  const userMap = new Map<number, BoundUserInfo>();
  if (userIds.length > 0) {
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
  return consultants.map(c => ({ ...c, boundUser: c.userId != null ? (userMap.get(c.userId) ?? null) : null }));
}

export async function adminCreateCertificationConsultant(name: string, serviceAreas: string[] = []): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(certificationConsultants).values({ name, serviceAreas, isActive: true });
  return result.insertId;
}

// 含 'evaluating' 這個舊值：0075 是向後相容 additive migration，enum 仍保留舊九態，
// 部署切換期間任何殘留舊值的資料列都必須繼續被視為未結案。
const CERTIFICATION_OPEN_STATUSES_DB = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
  "needs_interview", "scope_assessment", "pre_review", "verification",
] as const;

async function reassignOpenCertificationCasesAwayFromConsultant(
  tx: any, // drizzle transaction handle — only called from within db_.transaction(async (tx) => ...) below
  consultantId: number,
  updatedBy?: CaseUpdatedBy,
): Promise<{ reassignedCases: CertificationCase[] }> {
  const openRows: CertificationCase[] = await tx.select().from(certificationCases)
    .where(and(
      eq(certificationCases.assignedConsultantId, consultantId),
      inArray(certificationCases.status, CERTIFICATION_OPEN_STATUSES_DB),
    ));
  if (openRows.length === 0) return { reassignedCases: [] };
  await tx.update(certificationCases).set({
    assignedConsultantId: null,
    status: "unassigned",
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(and(
    eq(certificationCases.assignedConsultantId, consultantId),
    inArray(certificationCases.status, CERTIFICATION_OPEN_STATUSES_DB),
  ));
  return { reassignedCases: openRows };
}

export async function adminSetCertificationConsultantActive(id: number, isActive: boolean, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: CertificationCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(certificationConsultants).where(eq(certificationConsultants.id, id)).for("update");
    await tx.update(certificationConsultants).set({ isActive }).where(eq(certificationConsultants.id, id));
    if (isActive) return { reassignedCases: [] };
    return reassignOpenCertificationCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

export async function adminBindCertificationConsultantUser(id: number, userId: number | null, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: CertificationCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  if (userId != null) {
    const existing = await db_.select({ id: certificationConsultants.id })
      .from(certificationConsultants)
      .where(and(eq(certificationConsultants.userId, userId), ne(certificationConsultants.id, id)));
    if (existing.length > 0) throw new Error("此使用者已綁定其他 ISO 認證顧問身份");
  }
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(certificationConsultants).where(eq(certificationConsultants.id, id)).for("update");
    await tx.update(certificationConsultants).set({ userId }).where(eq(certificationConsultants.id, id));
    if (userId != null) return { reassignedCases: [] };
    return reassignOpenCertificationCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

function matchesCertificationConsultant(
  consultant: CertificationConsultant,
  servicesWanted: string[],
  isUnsure: boolean,
): boolean {
  if (!consultant.isActive || consultant.userId == null) return false;
  const areas = consultant.serviceAreas ?? [];
  if (areas.length === 0) return true;
  if (isUnsure) return true;
  return servicesWanted.some(s => areas.includes(s));
}

export async function createCertificationCaseWithAutoAssign(
  data: Omit<InsertCertificationCase, "assignedConsultantId" | "status"> & { servicesWanted: string[]; isUnsure: boolean },
): Promise<{ id: number; assignedConsultant: CertificationConsultant | null }> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const allConsultants = await tx.select().from(certificationConsultants, { useIndex: "PRIMARY" })
      .where(eq(certificationConsultants.isActive, true))
      .for("update");
    const candidates = allConsultants.filter(c => matchesCertificationConsultant(c, data.servicesWanted, data.isUnsure));
    const assignedConsultant = candidates.length === 1 ? candidates[0] : null;
    const [result] = await tx.insert(certificationCases).values({
      ...data,
      assignedConsultantId: assignedConsultant?.id ?? null,
      status: assignedConsultant ? "new" : "unassigned",
    });
    return { id: result.insertId, assignedConsultant };
  }));
}

export async function hasOpenCertificationCase(factoryId: number): Promise<boolean> {
  const db_ = await getDb();
  if (!db_) return false;
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(certificationCases)
    .where(and(
      eq(certificationCases.factoryId, factoryId),
      inArray(certificationCases.status, CERTIFICATION_OPEN_STATUSES_DB),
    ));
  return Number(row?.n ?? 0) > 0;
}

export async function getCertificationCaseById(id: number): Promise<CertificationCase | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(certificationCases).where(eq(certificationCases.id, id));
  return row;
}

export async function getCertificationCasesByFactoryIds(factoryIds: number[]): Promise<CertificationCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (factoryIds.length === 0) return [];
  return db_.select().from(certificationCases)
    .where(inArray(certificationCases.factoryId, factoryIds))
    .orderBy(desc(certificationCases.createdAt));
}

export async function listCertificationCasesForConsultant(consultantIds: number[], status?: CertificationCase["status"]): Promise<CertificationCase[]> {
  const db_ = await getDb();
  if (!db_ || consultantIds.length === 0) return [];
  const conditions = [inArray(certificationCases.assignedConsultantId, consultantIds)];
  if (status) conditions.push(eq(certificationCases.status, status));
  return db_.select().from(certificationCases)
    .where(and(...conditions))
    .orderBy(desc(certificationCases.createdAt), desc(certificationCases.id));
}

export async function listCertificationCasesAdmin(opts?: {
  status?: CertificationCase["status"];
  limit?: number;
  offset?: number;
}): Promise<CertificationCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(certificationCases.status, opts.status)] : [];
  return db_.select().from(certificationCases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(certificationCases.createdAt), desc(certificationCases.id))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
}

export async function countCertificationCases(status?: CertificationCase["status"]): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const conditions = status ? [eq(certificationCases.status, status)] : [];
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(certificationCases)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.n ?? 0);
}

export async function updateCertificationCaseStatus(
  id: number,
  status: CertificationCase["status"],
  updatedBy?: CaseUpdatedBy,
  opts?: { reason?: string; forced?: boolean },
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const [cur] = await db_.select({ tl: certificationCases.statusTimeline, history: certificationCases.statusHistory })
    .from(certificationCases).where(eq(certificationCases.id, id));
  const existing = (cur?.tl ?? {}) as Record<string, string>;
  const newTl = { ...existing };
  const nowIso = new Date().toISOString();
  if (!newTl[status]) newTl[status] = nowIso;
  const newHistory = appendCaseStatusHistory(cur?.history as CaseStatusHistoryEntry[] | null, {
    status, at: nowIso,
    byUserId: updatedBy?.userId ?? 0, byName: updatedBy?.name ?? "",
    reason: opts?.reason, forced: opts?.forced,
    action: opts?.forced ? "admin_force" : "status_update",
  });
  await db_.update(certificationCases).set({
    status, statusTimeline: newTl, statusHistory: newHistory,
    ...(opts?.reason ? { statusReason: opts.reason } : {}),
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(certificationCases.id, id));
}

/**
 * 顧問自助取件：以 transaction + `.for("update")` 鎖定該筆案件所在資料列，
 * 重新確認鎖定當下仍是 status='unassigned' 且 assignedConsultantId 為
 * NULL——只有第一個成功鎖定並通過這個再次檢查的請求會成功，第二位（不論
 * 是另一位顧問或同一位重複點擊）一律拋出 CaseAlreadyClaimedError，不會
 * 產生「兩位顧問同時取件都成功」的競態。成功後寫入 assignedConsultantId、
 * status（'unassigned'→'new'）、claimedAt、statusTimeline／statusHistory
 * 與最後更新者快照。
 */
export async function claimCertificationCase(caseId: number, consultantId: number, updatedBy: CaseUpdatedBy): Promise<CertificationCase> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const [item] = await tx.select().from(certificationCases).where(eq(certificationCases.id, caseId)).for("update");
    if (!item) throw new Error("找不到案件");
    if (item.status !== "unassigned" || item.assignedConsultantId != null) {
      throw new CaseAlreadyClaimedError();
    }
    const nowIso = new Date().toISOString();
    const existingTl = (item.statusTimeline ?? {}) as Record<string, string>;
    const newTl = { ...existingTl };
    if (!newTl.new) newTl.new = nowIso;
    const newHistory = appendCaseStatusHistory(item.statusHistory as CaseStatusHistoryEntry[] | null, {
      status: "new", at: nowIso, byUserId: updatedBy.userId, byName: updatedBy.name, action: "claim",
    });
    await tx.update(certificationCases).set({
      assignedConsultantId: consultantId,
      status: "new",
      claimedAt: new Date(),
      statusTimeline: newTl,
      statusHistory: newHistory,
      lastUpdatedByUserId: updatedBy.userId,
      lastUpdatedByNameSnapshot: updatedBy.name,
    }).where(eq(certificationCases.id, caseId));
    return { ...item, assignedConsultantId: consultantId, status: "new" as const, statusTimeline: newTl, statusHistory: newHistory };
  }));
}

export async function updateCertificationCaseNotes(id: number, notes: string | null, updatedBy?: CaseUpdatedBy): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(certificationCases).set({
    notes,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(certificationCases.id, id));
}

export async function adminAssignCertificationConsultant(
  id: number,
  consultantId: number | null,
  updatedBy?: CaseUpdatedBy,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await withDeadlockRetry(() => db_.transaction(async (tx) => {
    if (consultantId != null) {
      const [consultant] = await tx.select().from(certificationConsultants)
        .where(eq(certificationConsultants.id, consultantId))
        .for("update");
      if (!consultant) throw new Error("找不到顧問，無法指派承辦");
      if (!consultant.isActive) throw new Error("此顧問目前已停用，無法指派承辦");
      if (consultant.userId == null) throw new Error("此顧問尚未綁定使用者帳號，無法指派承辦");
    }
    await tx.update(certificationCases).set({
      assignedConsultantId: consultantId,
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
    }).where(eq(certificationCases.id, id));
  }));
}

// ===== ERP 與產線優化專區：顧問設定與申請案件 =====
// 與其他服務完全獨立的資料模型與權限。needType 是單選列舉值（不是陣列），
// 見 drizzle/schema.ts erpCases 註解。

export async function getErpConsultantsByUserId(userId: number): Promise<ErpConsultant[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(erpConsultants).where(eq(erpConsultants.userId, userId));
}

export async function getErpConsultantById(id: number): Promise<ErpConsultant | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(erpConsultants).where(eq(erpConsultants.id, id));
  return row;
}

export type ErpConsultantWithBoundUser = ErpConsultant & { boundUser: BoundUserInfo | null };

export async function listAllErpConsultants(): Promise<ErpConsultantWithBoundUser[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const consultants = await db_.select().from(erpConsultants).orderBy(erpConsultants.id);
  const userIds = consultants.map(c => c.userId).filter((id): id is number => id != null);
  const userMap = new Map<number, BoundUserInfo>();
  if (userIds.length > 0) {
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
  return consultants.map(c => ({ ...c, boundUser: c.userId != null ? (userMap.get(c.userId) ?? null) : null }));
}

export async function adminCreateErpConsultant(name: string, serviceAreas: string[] = []): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [result] = await db_.insert(erpConsultants).values({ name, serviceAreas, isActive: true });
  return result.insertId;
}

// 含 'evaluating' 這個舊值：0075 是向後相容 additive migration，enum 仍保留舊九態，
// 部署切換期間任何殘留舊值的資料列都必須繼續被視為未結案。
const ERP_OPEN_STATUSES_DB = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
  "needs_triage", "diagnosis", "solution_design", "pilot_adjustment", "acceptance",
] as const;

async function reassignOpenErpCasesAwayFromConsultant(
  tx: any, // drizzle transaction handle — only called from within db_.transaction(async (tx) => ...) below
  consultantId: number,
  updatedBy?: CaseUpdatedBy,
): Promise<{ reassignedCases: ErpCase[] }> {
  const openRows: ErpCase[] = await tx.select().from(erpCases)
    .where(and(
      eq(erpCases.assignedConsultantId, consultantId),
      inArray(erpCases.status, ERP_OPEN_STATUSES_DB),
    ));
  if (openRows.length === 0) return { reassignedCases: [] };
  await tx.update(erpCases).set({
    assignedConsultantId: null,
    status: "unassigned",
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(and(
    eq(erpCases.assignedConsultantId, consultantId),
    inArray(erpCases.status, ERP_OPEN_STATUSES_DB),
  ));
  return { reassignedCases: openRows };
}

export async function adminSetErpConsultantActive(id: number, isActive: boolean, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: ErpCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(erpConsultants).where(eq(erpConsultants.id, id)).for("update");
    await tx.update(erpConsultants).set({ isActive }).where(eq(erpConsultants.id, id));
    if (isActive) return { reassignedCases: [] };
    return reassignOpenErpCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

export async function adminBindErpConsultantUser(id: number, userId: number | null, updatedBy?: CaseUpdatedBy): Promise<{ reassignedCases: ErpCase[] }> {
  const db_ = await getDb();
  if (!db_) return { reassignedCases: [] };
  if (userId != null) {
    const existing = await db_.select({ id: erpConsultants.id })
      .from(erpConsultants)
      .where(and(eq(erpConsultants.userId, userId), ne(erpConsultants.id, id)));
    if (existing.length > 0) throw new Error("此使用者已綁定其他 ERP 顧問身份");
  }
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    await tx.select().from(erpConsultants).where(eq(erpConsultants.id, id)).for("update");
    await tx.update(erpConsultants).set({ userId }).where(eq(erpConsultants.id, id));
    if (userId != null) return { reassignedCases: [] };
    return reassignOpenErpCasesAwayFromConsultant(tx, id, updatedBy);
  }));
}

function matchesErpConsultant(consultant: ErpConsultant, needType: string): boolean {
  if (!consultant.isActive || consultant.userId == null) return false;
  const areas = consultant.serviceAreas ?? [];
  if (areas.length === 0) return true;
  if (needType === "unsure") return true;
  return areas.includes(needType);
}

export async function createErpCaseWithAutoAssign(
  data: Omit<InsertErpCase, "assignedConsultantId" | "status"> & { needType: string },
): Promise<{ id: number; assignedConsultant: ErpConsultant | null }> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const allConsultants = await tx.select().from(erpConsultants, { useIndex: "PRIMARY" })
      .where(eq(erpConsultants.isActive, true))
      .for("update");
    const candidates = allConsultants.filter(c => matchesErpConsultant(c, data.needType));
    const assignedConsultant = candidates.length === 1 ? candidates[0] : null;
    const [result] = await tx.insert(erpCases).values({
      ...data,
      assignedConsultantId: assignedConsultant?.id ?? null,
      status: assignedConsultant ? "new" : "unassigned",
    } as InsertErpCase);
    return { id: result.insertId, assignedConsultant };
  }));
}

export async function hasOpenErpCase(factoryId: number): Promise<boolean> {
  const db_ = await getDb();
  if (!db_) return false;
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(erpCases)
    .where(and(
      eq(erpCases.factoryId, factoryId),
      inArray(erpCases.status, ERP_OPEN_STATUSES_DB),
    ));
  return Number(row?.n ?? 0) > 0;
}

export async function getErpCaseById(id: number): Promise<ErpCase | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(erpCases).where(eq(erpCases.id, id));
  return row;
}

export async function getErpCasesByFactoryIds(factoryIds: number[]): Promise<ErpCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  if (factoryIds.length === 0) return [];
  return db_.select().from(erpCases)
    .where(inArray(erpCases.factoryId, factoryIds))
    .orderBy(desc(erpCases.createdAt));
}

export async function listErpCasesForConsultant(consultantIds: number[], status?: ErpCase["status"]): Promise<ErpCase[]> {
  const db_ = await getDb();
  if (!db_ || consultantIds.length === 0) return [];
  const conditions = [inArray(erpCases.assignedConsultantId, consultantIds)];
  if (status) conditions.push(eq(erpCases.status, status));
  return db_.select().from(erpCases)
    .where(and(...conditions))
    .orderBy(desc(erpCases.createdAt), desc(erpCases.id));
}

export async function listErpCasesAdmin(opts?: {
  status?: ErpCase["status"];
  limit?: number;
  offset?: number;
}): Promise<ErpCase[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const conditions = opts?.status ? [eq(erpCases.status, opts.status)] : [];
  return db_.select().from(erpCases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(erpCases.createdAt), desc(erpCases.id))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
}

export async function countErpCases(status?: ErpCase["status"]): Promise<number> {
  const db_ = await getDb();
  if (!db_) return 0;
  const conditions = status ? [eq(erpCases.status, status)] : [];
  const [row] = await db_.select({ n: sql<number>`COUNT(*)` })
    .from(erpCases)
    .where(conditions.length ? and(...conditions) : undefined);
  return Number(row?.n ?? 0);
}

export async function updateErpCaseStatus(
  id: number,
  status: ErpCase["status"],
  updatedBy?: CaseUpdatedBy,
  opts?: { reason?: string; forced?: boolean },
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const [cur] = await db_.select({ tl: erpCases.statusTimeline, history: erpCases.statusHistory })
    .from(erpCases).where(eq(erpCases.id, id));
  const existing = (cur?.tl ?? {}) as Record<string, string>;
  const newTl = { ...existing };
  const nowIso = new Date().toISOString();
  if (!newTl[status]) newTl[status] = nowIso;
  const newHistory = appendCaseStatusHistory(cur?.history as CaseStatusHistoryEntry[] | null, {
    status, at: nowIso,
    byUserId: updatedBy?.userId ?? 0, byName: updatedBy?.name ?? "",
    reason: opts?.reason, forced: opts?.forced,
    action: opts?.forced ? "admin_force" : "status_update",
  });
  await db_.update(erpCases).set({
    status, statusTimeline: newTl, statusHistory: newHistory,
    ...(opts?.reason ? { statusReason: opts.reason } : {}),
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(erpCases.id, id));
}

/** ERP 版自助取件，邏輯與 claimCertificationCase 完全對稱，見該處註解。 */
export async function claimErpCase(caseId: number, consultantId: number, updatedBy: CaseUpdatedBy): Promise<ErpCase> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  return withDeadlockRetry(() => db_.transaction(async (tx) => {
    const [item] = await tx.select().from(erpCases).where(eq(erpCases.id, caseId)).for("update");
    if (!item) throw new Error("找不到案件");
    if (item.status !== "unassigned" || item.assignedConsultantId != null) {
      throw new CaseAlreadyClaimedError();
    }
    const nowIso = new Date().toISOString();
    const existingTl = (item.statusTimeline ?? {}) as Record<string, string>;
    const newTl = { ...existingTl };
    if (!newTl.new) newTl.new = nowIso;
    const newHistory = appendCaseStatusHistory(item.statusHistory as CaseStatusHistoryEntry[] | null, {
      status: "new", at: nowIso, byUserId: updatedBy.userId, byName: updatedBy.name, action: "claim",
    });
    await tx.update(erpCases).set({
      assignedConsultantId: consultantId,
      status: "new",
      claimedAt: new Date(),
      statusTimeline: newTl,
      statusHistory: newHistory,
      lastUpdatedByUserId: updatedBy.userId,
      lastUpdatedByNameSnapshot: updatedBy.name,
    }).where(eq(erpCases.id, caseId));
    return { ...item, assignedConsultantId: consultantId, status: "new" as const, statusTimeline: newTl, statusHistory: newHistory };
  }));
}

export async function updateErpCaseNotes(id: number, notes: string | null, updatedBy?: CaseUpdatedBy): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await db_.update(erpCases).set({
    notes,
    ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
  }).where(eq(erpCases.id, id));
}

export async function adminAssignErpConsultant(
  id: number,
  consultantId: number | null,
  updatedBy?: CaseUpdatedBy,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  await withDeadlockRetry(() => db_.transaction(async (tx) => {
    if (consultantId != null) {
      const [consultant] = await tx.select().from(erpConsultants)
        .where(eq(erpConsultants.id, consultantId))
        .for("update");
      if (!consultant) throw new Error("找不到顧問，無法指派承辦");
      if (!consultant.isActive) throw new Error("此顧問目前已停用，無法指派承辦");
      if (consultant.userId == null) throw new Error("此顧問尚未綁定使用者帳號，無法指派承辦");
    }
    await tx.update(erpCases).set({
      assignedConsultantId: consultantId,
      ...(updatedBy ? { lastUpdatedByUserId: updatedBy.userId, lastUpdatedByNameSnapshot: updatedBy.name } : {}),
    }).where(eq(erpCases.id, id));
  }));
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

// ===== ISO 與低碳認證專區：分類／服務項目目錄 =====
// 與既有徽章系統（shared/badges.ts、factories.certificationBadges 等）完全
// 獨立，一律不讀取、不寫入、不刪除任何既有徽章相關資料表或欄位。

/** 冪等種子：先查詢 code 是否存在，不存在才插入，可安全重複呼叫（server 啟動時呼叫）。 */
export async function ensureCertificationServiceCatalogSeeded(): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;

  const categoryIdByCode = new Map<string, number>();
  for (const seed of CERTIFICATION_SERVICE_CATEGORY_SEEDS) {
    const [existing] = await db_.select({ id: certificationServiceCategories.id })
      .from(certificationServiceCategories)
      .where(eq(certificationServiceCategories.code, seed.code))
      .limit(1);
    if (existing) {
      categoryIdByCode.set(seed.code, existing.id);
      continue;
    }
    const [result] = await db_.insert(certificationServiceCategories).values({
      code: seed.code,
      name: seed.name,
      sortOrder: seed.sortOrder,
      isActive: true,
    });
    categoryIdByCode.set(seed.code, result.insertId);
    console.log(`[certification-services] seeded category: ${seed.code}`);
  }

  for (const seed of CERTIFICATION_SERVICE_ITEM_SEEDS) {
    const [existing] = await db_.select({ id: certificationServiceItems.id })
      .from(certificationServiceItems)
      .where(eq(certificationServiceItems.code, seed.code))
      .limit(1);
    if (existing) continue;
    const categoryId = categoryIdByCode.get(seed.categoryCode);
    if (!categoryId) {
      console.error(`[certification-services] seed skipped, unknown category: ${seed.categoryCode} (item ${seed.code})`);
      continue;
    }
    await db_.insert(certificationServiceItems).values({
      code: seed.code,
      badgeCode: seed.badgeCode,
      categoryId,
      name: seed.name,
      type: seed.type,
      shortDescription: seed.shortDescription,
      applicableNeeds: [...seed.applicableNeeds],
      applicableIndustries: [...seed.applicableIndustries],
      versionNote: seed.versionNote,
      status: "published",
      serviceEnabled: true,
      consultEnabled: true,
      sortOrder: seed.sortOrder,
    });
    console.log(`[certification-services] seeded item: ${seed.code}`);
  }
}

export type PublicCertificationCategory = { id: number; code: string; name: string; sortOrder: number };
export type PublicCertificationServiceItem = Omit<CertificationServiceItem, "createdAt" | "updatedAt"> & {
  categoryCode: string;
  categoryName: string;
};

/** 公開頁：只回傳已啟用的分類。 */
export async function listPublicCertificationCategories(): Promise<PublicCertificationCategory[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select({
    id: certificationServiceCategories.id,
    code: certificationServiceCategories.code,
    name: certificationServiceCategories.name,
    sortOrder: certificationServiceCategories.sortOrder,
  })
    .from(certificationServiceCategories)
    .where(eq(certificationServiceCategories.isActive, true))
    .orderBy(asc(certificationServiceCategories.sortOrder));
}

/**
 * 公開頁／公開 API：只回傳「分類已啟用」且「項目狀態為 published 且
 * serviceEnabled=true」的服務項目，任何 draft／unpublished／archived 或
 * serviceEnabled=false 的項目一律不會出現在這個查詢結果。
 */
export async function listPublicCertificationServices(): Promise<PublicCertificationServiceItem[]> {
  const db_ = await getDb();
  if (!db_) return [];
  const rows = await db_.select({
    ...getTableColumns(certificationServiceItems),
    categoryCode: certificationServiceCategories.code,
    categoryName: certificationServiceCategories.name,
  })
    .from(certificationServiceItems)
    .innerJoin(certificationServiceCategories, eq(certificationServiceItems.categoryId, certificationServiceCategories.id))
    .where(and(
      eq(certificationServiceItems.status, "published"),
      eq(certificationServiceItems.serviceEnabled, true),
      eq(certificationServiceCategories.isActive, true),
    ))
    .orderBy(asc(certificationServiceCategories.sortOrder), asc(certificationServiceItems.sortOrder));
  return rows.map(({ createdAt, updatedAt, ...rest }) => rest);
}

/** 管理後台：全部分類（含停用），依排序。 */
export async function adminListCertificationCategories(): Promise<CertificationServiceCategory[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select().from(certificationServiceCategories).orderBy(asc(certificationServiceCategories.sortOrder));
}

export async function adminCreateCertificationCategory(data: { code: string; name: string }): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [[maxRow]] = await Promise.all([
    db_.select({ max: sql<number>`COALESCE(MAX(${certificationServiceCategories.sortOrder}), -1)` }).from(certificationServiceCategories),
  ]);
  const [result] = await db_.insert(certificationServiceCategories).values({
    code: data.code,
    name: data.name,
    sortOrder: (maxRow?.max ?? -1) + 1,
    isActive: true,
  });
  return result.insertId;
}

export async function adminUpdateCertificationCategory(
  id: number,
  data: { name?: string; isActive?: boolean },
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const update: Partial<typeof certificationServiceCategories.$inferInsert> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.isActive !== undefined) update.isActive = data.isActive;
  if (Object.keys(update).length === 0) return;
  await db_.update(certificationServiceCategories).set(update).where(eq(certificationServiceCategories.id, id));
}

/** 交換兩個分類的 sortOrder，用於「上移／下移」排序操作。 */
export async function adminSwapCertificationCategoryOrder(idA: number, idB: number): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const rows = await db_.select({ id: certificationServiceCategories.id, sortOrder: certificationServiceCategories.sortOrder })
    .from(certificationServiceCategories)
    .where(inArray(certificationServiceCategories.id, [idA, idB]));
  if (rows.length !== 2) return;
  const [a, b] = rows;
  await db_.update(certificationServiceCategories).set({ sortOrder: b.sortOrder }).where(eq(certificationServiceCategories.id, a.id));
  await db_.update(certificationServiceCategories).set({ sortOrder: a.sortOrder }).where(eq(certificationServiceCategories.id, b.id));
}

/** 管理後台：全部服務項目（任何狀態），含分類資訊。 */
export async function adminListCertificationServiceItems(): Promise<(CertificationServiceItem & { categoryCode: string; categoryName: string })[]> {
  const db_ = await getDb();
  if (!db_) return [];
  return db_.select({
    ...getTableColumns(certificationServiceItems),
    categoryCode: certificationServiceCategories.code,
    categoryName: certificationServiceCategories.name,
  })
    .from(certificationServiceItems)
    .innerJoin(certificationServiceCategories, eq(certificationServiceItems.categoryId, certificationServiceCategories.id))
    .orderBy(asc(certificationServiceCategories.sortOrder), asc(certificationServiceItems.sortOrder));
}

export async function getCertificationServiceItemById(id: number): Promise<CertificationServiceItem | undefined> {
  const db_ = await getDb();
  if (!db_) return undefined;
  const [row] = await db_.select().from(certificationServiceItems).where(eq(certificationServiceItems.id, id));
  return row;
}

export type CertificationServiceItemInput = {
  code: string;
  badgeCode: string | null;
  categoryId: number;
  name: string;
  type: string;
  shortDescription: string;
  applicableNeeds: string[];
  applicableIndustries: string[];
  versionNote: string | null;
  iconKey: string | null;
  serviceEnabled: boolean;
  consultEnabled: boolean;
};

export async function adminCreateCertificationServiceItem(data: CertificationServiceItemInput): Promise<number> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [[maxRow]] = await Promise.all([
    db_.select({ max: sql<number>`COALESCE(MAX(${certificationServiceItems.sortOrder}), -1)` })
      .from(certificationServiceItems)
      .where(eq(certificationServiceItems.categoryId, data.categoryId)),
  ]);
  const [result] = await db_.insert(certificationServiceItems).values({
    ...data,
    status: "draft",
    sortOrder: (maxRow?.max ?? -1) + 1,
  });
  return result.insertId;
}

export async function adminUpdateCertificationServiceItem(
  id: number,
  data: Partial<CertificationServiceItemInput>,
): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  if (Object.keys(data).length === 0) return;
  await db_.update(certificationServiceItems).set(data).where(eq(certificationServiceItems.id, id));
}

const CERTIFICATION_SERVICE_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["published", "archived"],
  published: ["unpublished", "archived"],
  unpublished: ["published", "archived"],
  // 復原（restore）固定回到 unpublished（下架但可再上架），需要管理員再次
  // 明確按下「上架」才會公開，避免封存項目復原後未經檢視就直接曝光。
  archived: ["unpublished"],
};

/** 依允許的狀態轉換表更新狀態；不允許的轉換直接拋出錯誤，不靜默忽略。 */
export async function adminSetCertificationServiceItemStatus(
  id: number,
  nextStatus: "draft" | "published" | "unpublished" | "archived",
): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [row] = await db_.select({ status: certificationServiceItems.status }).from(certificationServiceItems).where(eq(certificationServiceItems.id, id));
  if (!row) throw new Error("找不到此服務項目");
  const allowed = CERTIFICATION_SERVICE_STATUS_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`不允許從「${row.status}」轉換到「${nextStatus}」`);
  }
  await db_.update(certificationServiceItems).set({ status: nextStatus }).where(eq(certificationServiceItems.id, id));
}

/** 交換兩個服務項目的 sortOrder，用於「上移／下移」排序操作。 */
export async function adminSwapCertificationServiceItemOrder(idA: number, idB: number): Promise<void> {
  const db_ = await getDb();
  if (!db_) return;
  const rows = await db_.select({ id: certificationServiceItems.id, sortOrder: certificationServiceItems.sortOrder })
    .from(certificationServiceItems)
    .where(inArray(certificationServiceItems.id, [idA, idB]));
  if (rows.length !== 2) return;
  const [a, b] = rows;
  await db_.update(certificationServiceItems).set({ sortOrder: b.sortOrder }).where(eq(certificationServiceItems.id, a.id));
  await db_.update(certificationServiceItems).set({ sortOrder: a.sortOrder }).where(eq(certificationServiceItems.id, b.id));
}

/**
 * 只有 draft 狀態才允許永久刪除；published／unpublished／archived 一律拒絕，
 * 避免未來案件或紀錄的關聯資料（例如下一階段串接的諮詢表單）失去對應項目。
 */
export async function adminDeleteCertificationServiceItem(id: number): Promise<void> {
  const db_ = await getDb();
  if (!db_) throw new Error("DB not available");
  const [row] = await db_.select({ status: certificationServiceItems.status }).from(certificationServiceItems).where(eq(certificationServiceItems.id, id));
  if (!row) return;
  if (row.status !== "draft") {
    throw new Error("只有草稿狀態的項目可以永久刪除，已上架／下架／封存的項目請改用下架或封存");
  }
  await db_.delete(certificationServiceItems).where(eq(certificationServiceItems.id, id));
}
