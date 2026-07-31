import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json, uniqueIndex, index, date } from "drizzle-orm/mysql-core";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ===== 使用者表 =====
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  primaryEmail: varchar("primaryEmail", { length: 320 }),
  primaryEmailVerifiedAt: timestamp("primaryEmailVerifiedAt"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // factory_owner 表示此帳號是工廠業主
  isFactoryOwner: boolean("isFactoryOwner").default(false).notNull(),
  phone: varchar("phone", { length: 30 }),
  phoneVerified: boolean("phoneVerified").default(false).notNull(),
  notificationSettings: json("notificationSettings").$type<Record<string, boolean>>(),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ===== 工廠表 =====
export const factories = mysqlTable("factories", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().unique(), // references users.id — uniqueIndex enforced by uq_factory_owner_id
  name: varchar("name", { length: 200 }).notNull(),
  industry: json("industry").$type<string[]>().notNull(),
  // ODM, OEM 以 JSON 陣列儲存，支援複選
  mfgModes: json("mfgModes").$type<string[]>().notNull(),
  region: varchar("region", { length: 20 }).notNull(),
  description: text("description"),
  capitalLevel: varchar("capitalLevel", { length: 30 }).notNull(),
  foundedYear: int("foundedYear"),
  ownerName: varchar("ownerName", { length: 100 }),
  contactPersonName: varchar("contactPersonName", { length: 100 }), // 洽詢窗口／聯絡人
  phone: varchar("phone", { length: 30 }),
  website: varchar("website", { length: 500 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  address: varchar("address", { length: 500 }).notNull().default(""), // 公廠地址
  // 平均評分（快取欄位，定期從 reviews 計算更新）
  avgRating: decimal("avgRating", { precision: 3, scale: 2 }).default("0"),
  reviewCount: int("reviewCount").default(0),
  status: mysqlEnum("status", ["draft", "pending", "approved", "rejected"]).default("draft").notNull(),
  avatarUrl: text("avatarUrl"), // 工廠大頭貼
  coverImageUrl: text("coverImageUrl"), // 工廠封面背景圖 (16:5)
  businessType: mysqlEnum("businessType", ["factory", "studio"]).default("factory").notNull(), // 代工廠或工作室
  operationStatus: mysqlEnum("operationStatus", ["normal", "busy", "full"]).default("normal").notNull(),
  certified: boolean("certified").default(false).notNull(),
  subIndustry: json("subIndustry").$type<string[]>().default([]),
  // 徽章系統：「已獲得」的徽章 id 清單（BNI 永遠第一，其餘依 shared/badges.ts 排序）。
  // 只能透過 approveFactory／approveRevisionAtomic 新增，一般 update／修改申請審核
  // 不得移除既有項目（見 server/routers.ts）——這是「擁有權」，不是「是否公開顯示」。
  certificationBadges: json("certificationBadges").$type<string[]>().default([]),
  // 徽章系統：certificationBadges 的子集合，工廠自行決定要不要顯示於公開頁面／
  // 搜尋卡片，不需任何審核即可切換（見 server/routers.ts 的 updateVisibleBadges）。
  // 伺服器端寫入時一律驗證為 certificationBadges 的子集合，見 migration 0066。
  certificationBadgesVisible: json("certificationBadgesVisible").$type<string[]>().default([]),
  // 徽章系統：私密證明資料（工廠說明文字＋私有 object key，見 server/privateStorage.ts），
  // 只供 owner／共管者／admin 透過短效 presigned URL 審核使用，
  // 公開頁面與搜尋結果絕不可回傳此欄位，資料庫內也絕不儲存永久網址或 presigned URL
  certificationEvidence: json("certificationEvidence").$type<Array<{ badgeId: string; description: string; imageKeys: string[] }>>().default([]),
  avgResponseHours: decimal("avgResponseHours", { precision: 8, scale: 2 }),
  weekdayHours: varchar("weekdayHours", { length: 50 }),
  weekendHours: varchar("weekendHours", { length: 50 }),
  businessNote: text("businessNote"),
  submittedAt: timestamp("submittedAt"), // 送出審核的時間
  rejectionReason: text("rejectionReason"), // 駁回理由
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Factory = typeof factories.$inferSelect;
export type InsertFactory = typeof factories.$inferInsert;

// ===== 產品分類表 =====
export const productCategories = mysqlTable("productCategories", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProductCategory = typeof productCategories.$inferSelect;

// ===== 產品表 =====
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  categoryId: int("categoryId").references(() => productCategories.id, { onDelete: "set null" }),
  name: varchar("name", { length: 200 }).notNull(),
  priceMin: decimal("priceMin", { precision: 12, scale: 2 }),
  priceMax: decimal("priceMax", { precision: 12, scale: 2 }),
  acceptSmallOrder: boolean("acceptSmallOrder").default(false).notNull(),
  provideSample: boolean("provideSample").default(false).notNull(),
  description: text("description"),
  priceType: mysqlEnum("priceType", ["range", "fixed", "market"]).default("range").notNull(),
  images: json("images").$type<string[]>().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ===== 聊天對話表 =====
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),       // 詢問者
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }), // 被詢問的工廠
  productId: int("productId").references(() => products.id, { onDelete: "set null" }),           // 可選，針對特定產品的詢問
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // 同一 userId 對同一 factoryId 永遠只有一筆 conversation（忽略 productId，
  // 同買家詢問同工廠不同商品仍沿用同一筆）。尚未執行對應 migration
  // 0064_conversations_unique_user_factory.sql，schema 先反映目標狀態，
  // 供之後 db:push/generate 比對；db:push 執行前需先跑 migration 檔內附的
  // 重複資料預檢。
  uqUserFactory: uniqueIndex("uq_conversation_user_factory").on(table.userId, table.factoryId),
}));

export type Conversation = typeof conversations.$inferSelect;

// ===== 聊天訊息表 =====
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: int("senderId").notNull().references(() => users.id, { onDelete: "cascade" }),   // references users.id
  senderRole: mysqlEnum("senderRole", ["user", "factory"]).notNull(),
  content: text("content").notNull(),
  isRead: boolean("isRead").default(false).notNull(),
  type: mysqlEnum("type", ["text", "co_manager_invite", "product", "pdf", "collaboration_order"]).default("text").notNull(),
  invitationId: int("invitationId"),
  attachmentData: json("attachmentData").$type<Record<string, any>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;

// ===== 評價表 =====
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  rating: int("rating").notNull(), // 1~5
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  reply: text("reply"),
  repliedAt: timestamp("repliedAt"),
  collaborationOrderId: int("collaborationOrderId"),
  reviewType: mysqlEnum("reviewType", ["general", "verified_order"]).default("general").notNull(),
});

export type Review = typeof reviews.$inferSelect;

// ===== 合作確認單表 =====
export const collaborationOrders = mysqlTable("collaborationOrders", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  buyerUserId: int("buyerUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdByUserId: int("createdByUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: int("productId").references(() => products.id, { onDelete: "set null" }),
  projectName: varchar("projectName", { length: 200 }).notNull(),
  description: text("description").notNull(),
  depositDueDate: varchar("depositDueDate", { length: 10 }),
  productionStartDate: varchar("productionStartDate", { length: 10 }),
  expectedCompletionDate: varchar("expectedCompletionDate", { length: 10 }),
  expectedShipmentDate: varchar("expectedShipmentDate", { length: 10 }),
  finalPaymentDueDate: varchar("finalPaymentDueDate", { length: 10 }),
  note: text("note"),
  status: mysqlEnum("status", ["pending", "accepted", "rejected", "in_progress", "shipped", "completed", "cancelled", "cancel_requested"]).default("pending").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  rejectedAt: timestamp("rejectedAt"),
  completedAt: timestamp("completedAt"),
  completedByUserId: int("completedByUserId"),
  completionNote: text("completionNote"),
  cancelledAt: timestamp("cancelledAt"),
  cancelRequestedByUserId: int("cancelRequestedByUserId"),
  cancelRequestedAt: timestamp("cancelRequestedAt"),
  cancelRequestReason: text("cancelRequestReason"),
  cancelRequestedFromStatus: varchar("cancelRequestedFromStatus", { length: 30 }),
  // 接受方身分（Phase 3B）：NULL 視同 'user'
  acceptedAsType: mysqlEnum("acceptedAsType", ["user", "factory"]),
  acceptedAsFactoryId: int("acceptedAsFactoryId"),
  acceptedByUserId: int("acceptedByUserId"),
  // 提早推進
  earlyCompletedAt: timestamp("earlyCompletedAt"),
  earlyCompletedByUserId: int("earlyCompletedByUserId"),
  earlyShippedAt: timestamp("earlyShippedAt"),
  earlyShippedByUserId: int("earlyShippedByUserId"),
  // 訂單製作階段：nullable，只有訂單被接受（accepted）時才初始化為 'awaiting_deposit'，
  // pending/rejected/cancelled/cancel_requested 一律為 NULL（從未進入或已中止製作流程，
  // 不應帶有誤導性的階段值）；status 進入 completed 時一併寫入 'completed'。
  // 只能由「進入下一階段」手動操作推進，不會因日期抵達自動改變。
  currentStage: mysqlEnum("currentStage", [
    "awaiting_deposit", "in_production", "awaiting_shipment", "awaiting_final_payment", "completed",
  ]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollaborationOrder = typeof collaborationOrders.$inferSelect;

// ===== 合作確認單：階段推進歷史（Immutable audit trail）=====
// actorUserId: nullable FK with ON DELETE SET NULL — record survives account deletion.
// actorNameSnapshot / actorFactoryNameSnapshot: captured at time of action, guarantees
// auditability even after the account or factory membership changes later.
// isEarly + expectedDateAtTransition: snapshot of whether this transition happened before
// the stage's own expected date node (and what that date was at the time).
export const collaborationOrderStageHistory = mysqlTable("collaborationOrderStageHistory", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull().references(() => collaborationOrders.id, { onDelete: "cascade" }),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  actorNameSnapshot: varchar("actorNameSnapshot", { length: 100 }).notNull().default(""),
  actorFactoryNameSnapshot: varchar("actorFactoryNameSnapshot", { length: 200 }).notNull().default(""),
  // nullable：舊訂單（currentStage 從未被初始化）直接完成時，沒有真實的前一階段可回填，
  // 一律寫 NULL，不偽造它曾經進入 awaiting_final_payment 或任何其他階段。
  fromStage: varchar("fromStage", { length: 30 }),
  toStage: varchar("toStage", { length: 30 }).notNull().default(""),
  note: varchar("note", { length: 1000 }),
  isEarly: boolean("isEarly").notNull().default(false),
  expectedDateAtTransition: varchar("expectedDateAtTransition", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("cosh_order_idx").on(t.orderId, t.createdAt),
}));

export type CollaborationOrderStageHistory = typeof collaborationOrderStageHistory.$inferSelect;

// ===== 重複下訂申請表 =====
export const collaborationOrderRepeatRequests = mysqlTable("collaborationOrderRepeatRequests", {
  id: int("id").autoincrement().primaryKey(),
  originalOrderId: int("originalOrderId").notNull().references(() => collaborationOrders.id, { onDelete: "cascade" }),
  conversationId: int("conversationId").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  requestedByUserId: int("requestedByUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedAsFactoryId: int("requestedAsFactoryId"),
  status: mysqlEnum("status", ["pending", "accepted", "rejected"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CollaborationOrderRepeatRequest = typeof collaborationOrderRepeatRequests.$inferSelect;

// ===== 訂單日期修改申請 =====
export const collaborationOrderChangeRequests = mysqlTable("collaborationOrderChangeRequests", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull().references(() => collaborationOrders.id, { onDelete: "cascade" }),
  requestedByUserId: int("requestedByUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "accepted", "rejected"]).default("pending").notNull(),
  reason: text("reason"),
  oldValuesJson: json("oldValuesJson").$type<Record<string, string | null>>().notNull(),
  newValuesJson: json("newValuesJson").$type<Record<string, string | null>>().notNull(),
  acceptedAt: timestamp("acceptedAt"),
  rejectedAt: timestamp("rejectedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type CollaborationOrderChangeRequest = typeof collaborationOrderChangeRequests.$inferSelect;

// ===== 訂單日期逾期通知紀錄（防重複寄信）=====
export const collaborationOrderOverdueNotifications = mysqlTable("collaborationOrderOverdueNotifications", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull().references(() => collaborationOrders.id, { onDelete: "cascade" }),
  dateField: varchar("dateField", { length: 50 }).notNull(),
  dueDate: varchar("dueDate", { length: 10 }).notNull(),
  notifiedAt: timestamp("notifiedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  uniqueOrderField: uniqueIndex("orderId_dateField_unique").on(t.orderId, t.dateField),
}));
export type CollaborationOrderOverdueNotification = typeof collaborationOrderOverdueNotifications.$inferSelect;

// ===== 廣告置頂表 =====
export const advertisements = mysqlTable("advertisements", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  industry: varchar("industry", { length: 50 }).notNull(),
  capitalLevel: varchar("capitalLevel", { length: 30 }).notNull(),
  region: varchar("region", { length: 20 }).notNull(),
  // 跨縣市覆蓋的額外地區（JSON 陣列）
  extraRegions: json("extraRegions").$type<string[]>().default([]),
  isActive: boolean("isActive").default(true).notNull(),
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Advertisement = typeof advertisements.$inferSelect;

// ===== 工廠收藏表 =====
export const favorites = mysqlTable("favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }), // references users.id
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }), // references factories.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = typeof favorites.$inferInsert;

// ===== 檢舉表 =====
export const reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull(),
  userId: int("userId").notNull(),
  reason: varchar("reason", { length: 1000 }).notNull(),
  status: mysqlEnum("status", ["pending", "received", "reviewing", "processing", "resolved"]).default("pending").notNull(),
  adminNote: text("adminNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Report = typeof reports.$inferSelect;

// ===== 客服工單表 =====
export const supportTickets = mysqlTable("supportTickets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  subject: varchar("subject", { length: 200 }).notNull(),
  description: text("description").notNull(),
  status: mysqlEnum("status", ["pending", "received", "reviewing", "processing", "resolved"]).default("pending").notNull(),
  adminNote: text("adminNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SupportTicket = typeof supportTickets.$inferSelect;

// ===== 檢舉狀態歷程 =====
export const reportStatusHistory = mysqlTable("reportStatusHistory", {
  id: int("id").autoincrement().primaryKey(),
  reportId: int("reportId").notNull(),
  status: mysqlEnum("status", ["pending", "received", "reviewing", "processing", "resolved"]).notNull(),
  adminNote: text("adminNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ===== 客服工單狀態歷程 =====
export const ticketStatusHistory = mysqlTable("ticketStatusHistory", {
  id: int("id").autoincrement().primaryKey(),
  ticketId: int("ticketId").notNull(),
  status: mysqlEnum("status", ["pending", "received", "reviewing", "processing", "resolved"]).notNull(),
  adminNote: text("adminNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ===== 語意搜尋快取 =====
export const searchCache = mysqlTable("searchCache", {
  keyword: varchar("keyword", { length: 200 }).primaryKey(),
  enhanced: varchar("enhanced", { length: 200 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ===== AI 搜尋意圖快取 =====
export const aiSearchIntents = mysqlTable("aiSearchIntents", {
  id:              int("id").autoincrement().primaryKey(),
  normalizedQuery: varchar("normalizedQuery", { length: 200 }).notNull().unique(),
  mainIndustries:  json("mainIndustries").$type<string[]>().notNull(),
  subIndustries:   json("subIndustries").$type<string[]>().notNull(),
  productKeywords: json("productKeywords").$type<string[]>().notNull(),
  searchSynonyms:  json("searchSynonyms").$type<string[]>().notNull(),
  confidence:      decimal("confidence", { precision: 4, scale: 3 }).notNull(),
  aiProvider:      varchar("aiProvider", { length: 50 }).notNull().default('openai'),
  aiModel:         varchar("aiModel", { length: 100 }).notNull().default('gpt-4o-mini'),
  hitCount:        int("hitCount").notNull().default(0),
  lastUsedAt:      timestamp("lastUsedAt").defaultNow().notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AiSearchIntent = typeof aiSearchIntents.$inferSelect;

// ===== 平台公告 =====
export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  type: mysqlEnum("type", ["update", "maintenance", "news"]).default("news").notNull(),
  isPinned: boolean("isPinned").default(false).notNull(),
  // 「相關內容連結」——只有 type="news"（平台消息）可以設定，其他類型一律
  // NULL，由 server/db.ts 的 normalizeAnnouncementActionUrl() 在資料層強制
  // 保證（create/update 都會走同一個函式），不只依賴前端或 router。
  actionUrl: varchar("actionUrl", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Announcement = typeof announcements.$inferSelect;

// ===== 找消息（產業情報／News）=====
// 刻意獨立於 announcements／loginPopups，不混用同一張表：公告走「送出即公開、
// 無草稿」，找消息需要草稿／發布／下架狀態機與分眾通知，兩者的生命週期規則不同，
// 混在同一張表會讓公告既有的查詢與通知邏輯被迫遷就找消息的新規則。
export const news = mysqlTable("news", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["draft", "published", "withdrawn"]).default("draft").notNull(),
  isImportant: boolean("isImportant").default(false).notNull(),
  isCompetition: boolean("isCompetition").default(false).notNull(),
  isExhibition: boolean("isExhibition").default(false).notNull(),
  // 跨產業資訊：適用所有工廠、但不屬於特定產業的消息（例如政府補助、跨產業
  // 課程）。刻意用獨立布林欄位，不是塞進 newsIndustries——newsIndustries 的
  // industryName 一律要通過 shared/constants.ts 的 INDUSTRY_OPTIONS 白名單
  // 驗證（真實工廠產業），「跨產業資訊」不是真實產業，寫進那張表會讓
  // validateNewsIndustryNames 與 gatherNewsRecipients 的 JSON_OVERLAPS
  // 產業比對邏輯出現語意錯誤（沒有任何工廠會把它列為 factories.industry）。
  // 看板訂閱／收件人聚合把它當成跟 isCompetition／isExhibition 同一層級的
  // 固定看板（boardKey="cross-industry"，不是 "industry:跨產業資訊"），
  // 天生就不會有任何人「因為屬於某產業」而被視為預設訂閱。
  isCrossIndustry: boolean("isCrossIndustry").default(false).notNull(),
  // 「目前對外顯示」的發布時間——每次 draft/withdrawn -> published 都會更新，
  // 驅動列表排序與 72 小時 NEW 徽章。
  publishedAt: timestamp("publishedAt"),
  // 「第一次」從草稿轉為已發布的時間，之後永遠不再變動；分眾通知只在這個欄位
  // 從 NULL 變成有值的那一次觸發，下架重新發布不會再次寫入、也就不會再通知。
  firstPublishedAt: timestamp("firstPublishedAt"),
  createdBy: int("createdBy").references(() => users.id),
  // 封面圖片：選填，公開消息內容的一部分（訪客可見）。coverImageKey 保留供
  // 後端在移除／更換封面時精準刪除對應的 S3 object，避免只清 URL 留下孤兒
  // 檔案；coverImageUrl 是實際顯示用的公開網址（沿用 storagePut 的既有慣例
  // ——這個 helper 目前所有呼叫端都只回傳公開 URL，沒有私有物件的概念）。
  coverImageKey: varchar("coverImageKey", { length: 300 }),
  coverImageUrl: varchar("coverImageUrl", { length: 1000 }),
  coverImageAlt: varchar("coverImageAlt", { length: 200 }),
  // 原始消息來源：選填，標示這則消息轉載/整理自哪個外部單位。sourceUrl 只
  // 允許完整 http(s) 網址（見 server/db.ts 的 isValidNewsSourceUrl），
  // sourceName 有值但 sourceUrl 沒填會被後端拒絕（不允許「有名稱點不了」）。
  // 公開頁只在 sourceUrl 存在時才顯示「查看原始消息」按鈕，一律開新分頁、
  // 不影響 OXM 自己的 Email/Push/列表連結（那些永遠連到 /news/:slug）。
  sourceName: varchar("sourceName", { length: 200 }),
  sourceUrl: varchar("sourceUrl", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  statusPublishedIdx: index("news_status_published_idx").on(t.status, t.publishedAt),
}));

export type News = typeof news.$inferSelect;
export type InsertNews = typeof news.$inferInsert;

// 找消息 PDF 附件。storageKey 是內部管理用（後端刪除/簽發下載連結時使用），
// 公開 API 一律不得回傳這個欄位——見 server/db.ts 的 getNewsAttachmentsPublic
// 只挑選白名單欄位（id/displayName/sizeBytes/sortOrder）。sortOrder 決定同一
// 篇消息內的顯示順序，用整數而不是塞進 JSON／逗號字串，才能穩定排序、
// 個別更新單一附件。
export const newsAttachments = mysqlTable("newsAttachments", {
  id: int("id").autoincrement().primaryKey(),
  newsId: int("newsId").notNull().references(() => news.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 200 }).notNull(),
  originalFileName: varchar("originalFileName", { length: 200 }).notNull(),
  storageKey: varchar("storageKey", { length: 300 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  uploadedBy: int("uploadedBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // 下載期限：
  //   after_publish_30d — 這篇消息第一次正式發布時，downloadExpiresAt 才會
  //     設成 firstPublishedAt + 30 天（見 server/db.ts 的 updateNews 首次發布
  //     transaction）；如果附件是在消息已發布之後才上傳，finalize 當下就直接
  //     設成「上傳完成時間 + 30 天」，不用等一個不會再發生的「第一次發布」。
  //   custom — downloadExpiresAt 必填，後端驗證必須晚於當下時間。
  //   never — downloadExpiresAt 永遠是 NULL，不會被自動清理排程處理。
  // 一旦 downloadExpiresAt 被設定過，編輯/下架/重新發布/改 publishedAt 都不
  // 得再次覆寫；要延長或改期限只能透過管理員明確的「修改附件期限」操作。
  expirationType: mysqlEnum("expirationType", ["after_publish_30d", "custom", "never"]).default("after_publish_30d").notNull(),
  downloadExpiresAt: timestamp("downloadExpiresAt"),
  // 自動清理排程（server/jobs/cleanupExpiredNewsAttachments.ts）寫入的欄位。
  // storageDeletedAt 非 NULL 代表 S3 物件已經被刪除——這是「檔案是否還在」的
  // 唯一真相來源，之後不能只靠改 downloadExpiresAt 讓檔案「復活」，必須重新
  // 上傳。deleteAttempts／lastDeleteAttemptAt／deleteFailureReason 讓刪除失敗
  // 時排程可以安全重試，且不會讓單筆失敗擋住其他附件。
  storageDeletedAt: timestamp("storageDeletedAt"),
  deleteAttempts: int("deleteAttempts").default(0).notNull(),
  lastDeleteAttemptAt: timestamp("lastDeleteAttemptAt"),
  deleteFailureReason: varchar("deleteFailureReason", { length: 300 }),
}, (t) => ({
  newsIdIdx: index("news_attachments_news_id_idx").on(t.newsId, t.sortOrder),
  cleanupIdx: index("news_attachments_cleanup_idx").on(t.downloadExpiresAt, t.expirationType, t.storageDeletedAt),
}));

export type NewsAttachment = typeof newsAttachments.$inferSelect;
export type InsertNewsAttachment = typeof newsAttachments.$inferInsert;

// 找消息 x 產業：多對多。產業用 shared/constants.ts 的 INDUSTRIES 名稱字串當
// 識別碼（沿用 factories.industry 既有的「名稱即識別碼」慣例，見該常數檔案的
// 註解——OXM 目前完全沒有一張「產業」資料表，新增/刪除/更名產業本來就只改
// 這個常數檔案，不動 DB），後端在寫入前一律驗證是否存在於 INDUSTRY_OPTIONS。
export const newsIndustries = mysqlTable("newsIndustries", {
  id: int("id").autoincrement().primaryKey(),
  newsId: int("newsId").notNull().references(() => news.id, { onDelete: "cascade" }),
  industryName: varchar("industryName", { length: 50 }).notNull(),
}, (t) => ({
  newsIndustryUq: uniqueIndex("news_industry_uq").on(t.newsId, t.industryName),
  industryLookupIdx: index("news_industry_lookup_idx").on(t.industryName),
}));

export type NewsIndustry = typeof newsIndustries.$inferSelect;

// 找消息通知紀錄：強制防重複的唯一保證來源。(newsId, userId, channel) 唯一索引
// 確保就算發布流程重跑、或同一使用者同時符合重要消息＋多個產業，同一則消息、
// 同一個管道，每個使用者最多只會有一筆紀錄——寄送與否看這張表，不是看記憶體
// 裡的 Set。
export const newsNotifications = mysqlTable("newsNotifications", {
  id: int("id").autoincrement().primaryKey(),
  newsId: int("newsId").notNull().references(() => news.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: mysqlEnum("channel", ["email", "push"]).notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  error: varchar("error", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
}, (t) => ({
  newsUserChannelUq: uniqueIndex("news_notif_uq").on(t.newsId, t.userId, t.channel),
  statusIdx: index("news_notif_status_idx").on(t.status),
}));

export type NewsNotification = typeof newsNotifications.$inferSelect;

// 找消息已讀紀錄：只給登入會員用（訪客的已讀狀態存在瀏覽器 localStorage，見
// client/src/lib/newsReadTracking.ts，不寫進這張表）。一篇消息可能同時出現在
// 重要消息／競賽消息／多個產業分類，讀一次、寫入一筆 (newsId, userId)，所有
// 出現位置的 NEW 自然一起消失，不需要為每個看板各自記錄。
//
// 兩個索引各對應不同查詢，不是重複：
//   news_read_uq (newsId, userId) UNIQUE
//     結構性防重複——保證同一使用者對同一篇消息最多只有一筆紀錄，
//     markNewsAsRead 靠這個唯一鍵做「insert 失敗就當作已讀過」的冪等寫入，
//     不需要先查再插；newsId 排在最前面，同時滿足 newsId 這個外鍵的索引要求。
//   news_read_user_lookup_idx (userId, newsId)
//     實際查詢方向是「WHERE userId = ? AND newsId IN (...)」（getNewCategorySummary
//     依登入者 id 過濾已讀、listPublicNews 幫每則消息算 isRead），userId 在前
//     才能讓 MySQL 用索引直接鎖定該使用者的已讀範圍再比對 newsId 清單；同時
//     滿足 userId 這個外鍵的索引要求。目前沒有任何查詢會用到 readAt 做排序
//     或清理，所以不建立 (userId, readAt) 這個目前用不到的索引。
export const newsReads = mysqlTable("newsReads", {
  id: int("id").autoincrement().primaryKey(),
  newsId: int("newsId").notNull().references(() => news.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("readAt").defaultNow().notNull(),
}, (t) => ({
  newsReadUq: uniqueIndex("news_read_uq").on(t.newsId, t.userId),
  userLookupIdx: index("news_read_user_lookup_idx").on(t.userId, t.newsId),
}));

export type NewsRead = typeof newsReads.$inferSelect;

// 找消息看板訂閱：只存使用者「明確覆寫」的選擇，不存動態預設值——沒有這篇
// 消息的紀錄就代表「沿用系統預設」（重要消息／自己所屬產業預設 true，其餘
// 預設 false），由 server/db.ts 的 computeEffectiveBoardSubscription 統一計算，
// 這張表本身完全不做預設值判斷，避免前端/API/通知聚合三處各自硬寫一份預設
// 邏輯而彼此不同步。boardKey 是穩定識別碼（all／important／competition／
// exhibition／industry:<產業名稱>），不是前端顯示文字，產業名稱一律驗證於
// shared/constants.ts 的 INDUSTRY_OPTIONS 白名單，見 validateNewsBoardKey。
export const newsBoardSubscriptions = mysqlTable("newsBoardSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  boardKey: varchar("boardKey", { length: 100 }).notNull(),
  isSubscribed: boolean("isSubscribed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // upsert（setBoardSubscription）與收件人聚合都靠這個唯一鍵做「一個使用者對
  // 同一個看板最多一筆覆寫紀錄」的冪等寫入，userId 排在最前面同時滿足外鍵索引。
  userBoardUq: uniqueIndex("news_board_sub_user_board_uq").on(t.userId, t.boardKey),
  // 收件人聚合查「這個使用者對這些 boardKey 的明確覆寫」、後台預估也是同樣
  // 查詢方向，userId 在前才能讓 MySQL 直接鎖定該使用者的覆寫範圍。
  userSubIdx: index("news_board_sub_user_idx").on(t.userId, t.isSubscribed),
}));

export type NewsBoardSubscription = typeof newsBoardSubscriptions.$inferSelect;

// ===== 登入彈窗（綁定既有「平台消息」公告的登入曝光入口，不是獨立公告系統）=====
export const loginPopups = mysqlTable("loginPopups", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  // 綁定的平台公告；nullable 是為了在公告被刪除時只把這欄設成 NULL（見下方
  // FK onDelete），而不是連帶把整筆登入彈窗紀錄一起刪掉——後台需要保留紀錄
  // 並顯示「綁定公告已失效」。
  announcementId: int("announcementId").references(() => announcements.id, { onDelete: "set null" }),
  // 顯示控制只有啟用/停用——isActive=true 立即生效、isActive=false 立即停止顯示，
  // 沒有額外的時間區間判斷。
  isActive: boolean("isActive").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LoginPopup = typeof loginPopups.$inferSelect;

// ===== 登入彈窗每日觀看紀錄 =====
// 判定「今天是否已顯示過」的唯一依據是 userId + 台灣時間日期，故意不記錄裝置
// ／瀏覽器／IP，確保跨裝置、跨瀏覽器、清快取、登出再登入都視為同一天只算一次。
export const loginPopupViews = mysqlTable("loginPopupViews", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD（台灣時間 Asia/Taipei）
  loginPopupId: int("loginPopupId").references(() => loginPopups.id, { onDelete: "set null" }), // 稽核用：當天實際看到的是哪一則
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userDateIdx: uniqueIndex("login_popup_view_user_date_idx").on(table.userId, table.date),
}));
export type LoginPopupView = typeof loginPopupViews.$inferSelect;

// ===== 工廠照片集 =====
export const factoryPhotos = mysqlTable("factoryPhotos", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  caption: varchar("caption", { length: 200 }),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FactoryPhoto = typeof factoryPhotos.$inferSelect;

// ===== 全站瀏覽統計 =====
export const pageViews = mysqlTable("pageViews", {
  id: int("id").autoincrement().primaryKey(),
  visitorId: varchar("visitorId", { length: 64 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD (台灣時間)
  hour: int("hour").notNull(), // 0-23 (台灣時間)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  visitorDateHourIdx: uniqueIndex("visitor_date_hour_idx").on(table.visitorId, table.date, table.hour),
}));

// ===== 工廠共同管理者邀請表 =====
export const factoryCoManagerInvitations = mysqlTable("factoryCoManagerInvitations", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  inviterUserId: int("inviterUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteeUserId: int("inviteeUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "accepted", "declined"]).default("pending").notNull(),
  conversationId: int("conversationId").references(() => conversations.id, { onDelete: "set null" }),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  respondedAt: timestamp("respondedAt"),
}, (table) => ({
  invitationLookupIdx: index("idx_invitation_lookup").on(table.factoryId, table.inviteeUserId, table.status),
}));

export type FactoryCoManagerInvitation = typeof factoryCoManagerInvitations.$inferSelect;

// ===== 工廠共同管理者表 =====
export const factoryCoManagers = mysqlTable("factoryCoManagers", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  invitedBy: int("invitedBy").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  removedAt: timestamp("removedAt"),
  // Virtual generated column: userId when row is active (removedAt IS NULL), NULL when removed.
  // MySQL unique index ignores NULLs, so removed history rows are not constrained.
  // Enforced by migration 0036_factory_uniqueness.sql.
  activeUserId: int("activeUserId").generatedAlwaysAs(
    sql`CASE WHEN \`removedAt\` IS NULL THEN \`userId\` ELSE NULL END`
  ),
}, (table) => ({
  coManagerLookupIdx: index("idx_co_manager_lookup").on(table.factoryId, table.userId),
  activeUserUq: uniqueIndex("uq_active_co_manager_user").on(table.activeUserId),
}));

export type FactoryCoManager = typeof factoryCoManagers.$inferSelect;

// ===== 一鍵詢價批次 =====
export const inquiryBatches = mysqlTable("inquiryBatches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 50 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InquiryBatch = typeof inquiryBatches.$inferSelect;

// ===== 一鍵詢價批次項目 =====
export const inquiryBatchItems = mysqlTable("inquiryBatchItems", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batchId").notNull().references(() => inquiryBatches.id, { onDelete: "cascade" }),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  conversationId: int("conversationId").references(() => conversations.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InquiryBatchItem = typeof inquiryBatchItems.$inferSelect;

// ===== 站內信活動表 =====
export const messageCampaigns = mysqlTable("messageCampaigns", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  senderId: int("senderId").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: mysqlEnum("targetType", ["all_users", "all_factory_managers", "single"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedById: int("deletedById").references(() => users.id, { onDelete: "set null" }),
  deleteReason: text("deleteReason"),
});

export type MessageCampaign = typeof messageCampaigns.$inferSelect;

// ===== 站內信收件人表 =====
export const messageRecipients = mysqlTable("messageRecipients", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull().references(() => messageCampaigns.id, { onDelete: "cascade" }),
  receiverId: int("receiverId").notNull().references(() => users.id, { onDelete: "cascade" }),
  isRead: boolean("isRead").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  adminViewedAt: timestamp("adminViewedAt"),
}, (table) => ({
  campaignReceiverUq: uniqueIndex("mc_campaign_receiver_uq").on(table.campaignId, table.receiverId),
}));

export type MessageRecipient = typeof messageRecipients.$inferSelect;

export const messageReplies = mysqlTable("messageReplies", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull().references(() => messageCampaigns.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  senderRole: mysqlEnum("senderRole", ["user", "admin"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  threadIdx: index("idx_message_replies_thread").on(table.campaignId, table.userId),
}));
export type MessageReply = typeof messageReplies.$inferSelect;

// ===== OAuth State 表（DB-based CSRF 防護，取代 cookie 方案）=====
export const oauthStates = mysqlTable("oauthStates", {
  id: int("id").autoincrement().primaryKey(),
  state: varchar("state", { length: 128 }).notNull().unique(),
  redirectTo: varchar("redirectTo", { length: 512 }),
  source: varchar("source", { length: 32 }), // "app" | "web" | null
  provider: varchar("provider", { length: 30 }).default("google").notNull(), // 'google' | 'apple' | 'line'
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  userAgent: text("userAgent"),
  ip: varchar("ip", { length: 64 }),
}, (table) => ({
  stateIdx: uniqueIndex("oauth_state_uq").on(table.state),
}));

export type OauthState = typeof oauthStates.$inferSelect;

// ===== App Login Ticket 表（mobile OAuth 一次性登入票，2 分鐘有效）=====
export const appLoginTickets = mysqlTable("appLoginTickets", {
  id: int("id").autoincrement().primaryKey(),
  ticket: varchar("ticket", { length: 128 }).notNull().unique(),
  userId: int("userId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  userAgent: text("userAgent"),
  ip: varchar("ip", { length: 64 }),
}, (table) => ({
  ticketIdx: uniqueIndex("app_login_ticket_uq").on(table.ticket),
}));

export type AppLoginTicket = typeof appLoginTickets.$inferSelect;

// ===== 多 Provider OAuth 帳號關聯表 =====
export const userAuthAccounts = mysqlTable("userAuthAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 30 }).notNull(), // 'google' | 'apple' | 'line'
  providerAccountId: varchar("providerAccountId", { length: 256 }).notNull(),
  providerEmail: varchar("providerEmail", { length: 320 }),
  providerEmailVerified: boolean("providerEmailVerified").default(false).notNull(),
  displayName: varchar("displayName", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  providerAccountUq: uniqueIndex("uq_provider_account").on(table.provider, table.providerAccountId),
}));

export type UserAuthAccount = typeof userAuthAccounts.$inferSelect;

// ===== Email 驗證 Token 表（DB 只存 SHA-256 hash）=====
export const emailVerificationTokens = mysqlTable("emailVerificationTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;

// ===== 工廠基本資料修改申請表 =====
export const factoryRevisions = mysqlTable("factoryRevisions", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  submittedBy: int("submittedBy").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalData: json("originalData").$type<Record<string, any>>().notNull(),
  proposedData: json("proposedData").$type<Record<string, any>>().notNull(),
  revisionReason: text("revisionReason"),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
  rejectionReason: text("rejectionReason"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt").notNull().defaultNow(),
  // Virtual generated column: factoryId when pending, NULL otherwise.
  // MySQL UNIQUE INDEX ignores NULLs → only one pending revision per factory enforced.
  pendingFactoryId: int("pendingFactoryId").generatedAlwaysAs(
    sql`CASE WHEN \`status\` = 'pending' THEN \`factoryId\` ELSE NULL END`
  ),
}, (table) => ({
  pendingFactoryUq: uniqueIndex("uq_factory_one_pending_revision").on(table.pendingFactoryId),
}));

export type FactoryRevision = typeof factoryRevisions.$inferSelect;

// ===== Push Notification Tokens =====
export const pushNotificationTokens = mysqlTable("pushNotificationTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  // SHA-256(token) hex digest — 64 chars，用於 unique index，規避 varchar(512) 的 index 長度限制
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  deviceId: varchar("deviceId", { length: 100 }),
  appVersion: varchar("appVersion", { length: 50 }),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt"),
}, (t) => ({
  userTokenHashUnique: uniqueIndex("pnt_user_token_hash_unique").on(t.userId, t.tokenHash),
  userIdIdx: index("pnt_user_id_idx").on(t.userId),
  enabledIdx: index("pnt_enabled_idx").on(t.enabled),
}));

export type PushNotificationToken = typeof pushNotificationTokens.$inferSelect;

// ===== 商案討論區：貼文表 =====
// authorUserId nullable + ON DELETE SET NULL：帳號刪除後貼文保留。
// 快照欄位保存發布當下的作者名稱，避免帳號刪除後顯示空白。
export const communityPosts = mysqlTable("communityPosts", {
  id: int("id").autoincrement().primaryKey(),
  spaceCode: varchar("spaceCode", { length: 50 }).notNull(),
  authorUserId: int("authorUserId").references(() => users.id, { onDelete: "set null" }),
  authorFactoryId: int("authorFactoryId").references(() => factories.id, { onDelete: "set null" }),
  authorNameSnapshot: varchar("authorNameSnapshot", { length: 100 }).notNull().default(""),
  authorFactoryNameSnapshot: varchar("authorFactoryNameSnapshot", { length: 200 }),
  authorRoleSnapshot: varchar("authorRoleSnapshot", { length: 50 }),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  images: json("images").$type<string[]>().default([]),
  pinnedProductIds: json("pinnedProductIds").$type<number[]>().default([]),
  commentsEnabled: boolean("commentsEnabled").notNull().default(true),
  isPinned: boolean("isPinned").notNull().default(false),
  isLocked: boolean("isLocked").notNull().default(false),
  isHidden: boolean("isHidden").notNull().default(false),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  spaceIdx: index("cp_space_idx").on(t.spaceCode, t.createdAt),
  authorUserIdx: index("cp_author_user_idx").on(t.authorUserId),
}));

export type CommunityPost = typeof communityPosts.$inferSelect;

// ===== 商案討論區：留言表 =====
// 同 communityPosts，authorUserId nullable，帳號刪除後留言保留。
export const communityComments = mysqlTable("communityComments", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  authorUserId: int("authorUserId").references(() => users.id, { onDelete: "set null" }),
  authorFactoryId: int("authorFactoryId").references(() => factories.id, { onDelete: "set null" }),
  authorNameSnapshot: varchar("authorNameSnapshot", { length: 100 }).notNull().default(""),
  authorFactoryNameSnapshot: varchar("authorFactoryNameSnapshot", { length: 200 }),
  authorRoleSnapshot: varchar("authorRoleSnapshot", { length: 50 }),
  content: text("content").notNull(),
  parentCommentId: int("parentCommentId").references((): AnyMySqlColumn => communityComments.id, { onDelete: "set null" }),
  replyToUserId: int("replyToUserId").references(() => users.id, { onDelete: "set null" }),
  isHidden: boolean("isHidden").notNull().default(false),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  postIdx: index("cc_post_idx").on(t.postId, t.createdAt),
  parentIdx: index("cc_parent_idx").on(t.parentCommentId),
}));

export type CommunityComment = typeof communityComments.$inferSelect;

// ===== 商案討論區：看板追蹤 =====
export const communityBoardFollows = mysqlTable("communityBoardFollows", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  spaceCode: varchar("spaceCode", { length: 50 }).notNull(),
  notifyNewDiscussions: boolean("notifyNewDiscussions").notNull().default(true),
  notifyNewBids: boolean("notifyNewBids").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userSpaceUq: uniqueIndex("cbf_user_space_uq").on(t.userId, t.spaceCode),
  spaceIdx: index("cbf_space_idx").on(t.spaceCode),
  userIdx: index("cbf_user_idx").on(t.userId),
}));

export type CommunityBoardFollow = typeof communityBoardFollows.$inferSelect;

// ===== 工廠追蹤 =====
export const factoryFollows = mysqlTable("factoryFollows", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  notifyNewDiscussions: boolean("notifyNewDiscussions").notNull().default(true),
  notifyNewBids: boolean("notifyNewBids").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userFactoryUq: uniqueIndex("ff_user_factory_uq").on(t.userId, t.factoryId),
  factoryIdx: index("ff_factory_idx").on(t.factoryId),
  userIdx: index("ff_user_idx").on(t.userId),
}));

export type FactoryFollow = typeof factoryFollows.$inferSelect;

// ===== 商案討論區：內容追蹤 =====
export const communityContentFollows = mysqlTable("communityContentFollows", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  contentType: varchar("contentType", { length: 20 }).notNull().default("discussion"),
  contentId: int("contentId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userContentUq: uniqueIndex("ccf_user_content_uq").on(t.userId, t.contentType, t.contentId),
  contentIdx: index("ccf_content_idx").on(t.contentType, t.contentId),
  userIdx: index("ccf_user_idx").on(t.userId),
}));

export type CommunityContentFollow = typeof communityContentFollows.$inferSelect;

// ===== 商案討論區：反應（Reaction） =====
export const communityReactions = mysqlTable("communityReactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: varchar("targetType", { length: 20 }).notNull(),
  targetId: int("targetId").notNull(),
  reactionType: varchar("reactionType", { length: 20 }).notNull().default("helpful"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  userTargetUq: uniqueIndex("cr_user_target_uq").on(t.userId, t.targetType, t.targetId, t.reactionType),
  targetIdx: index("cr_target_idx").on(t.targetType, t.targetId),
  userIdx: index("cr_user_idx").on(t.userId),
}));

export type CommunityReaction = typeof communityReactions.$inferSelect;

// ===== 商案討論區：提及 =====
export const communityMentions = mysqlTable("communityMentions", {
  id: int("id").autoincrement().primaryKey(),
  sourceType: varchar("sourceType", { length: 20 }).notNull(),
  sourceId: int("sourceId").notNull(),
  mentionedUserId: int("mentionedUserId").references(() => users.id, { onDelete: "cascade" }),
  mentionedFactoryId: int("mentionedFactoryId").references(() => factories.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  sourceIdx: index("cm_source_idx").on(t.sourceType, t.sourceId),
  userIdx: index("cm_user_idx").on(t.mentionedUserId),
  factoryIdx: index("cm_factory_idx").on(t.mentionedFactoryId),
  // MySQL allows multiple NULLs in unique indexes
  sourceUserUq: uniqueIndex("cm_source_user_uq").on(t.sourceType, t.sourceId, t.mentionedUserId),
  sourceFactoryUq: uniqueIndex("cm_source_factory_uq").on(t.sourceType, t.sourceId, t.mentionedFactoryId),
}));

export type CommunityMention = typeof communityMentions.$inferSelect;

// ===== 商案討論區：通知 =====
export const communityNotifications = mysqlTable("communityNotifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientUserId: int("recipientUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  // actorUserId / actorFactoryId: no FK — actor may be deleted, notification kept
  actorUserId: int("actorUserId"),
  actorFactoryId: int("actorFactoryId"),
  eventType: varchar("eventType", { length: 50 }).notNull(),
  eventGroup: varchar("eventGroup", { length: 50 }).notNull(),
  // postId / commentId: no FK — post may be hard deleted
  postId: int("postId"),
  commentId: int("commentId"),
  spaceCode: varchar("spaceCode", { length: 50 }),
  titleSnapshot: varchar("titleSnapshot", { length: 200 }),
  actorNameSnapshot: varchar("actorNameSnapshot", { length: 100 }).notNull().default(""),
  actorFactoryNameSnapshot: varchar("actorFactoryNameSnapshot", { length: 200 }),
  message: text("message").notNull(),
  actionUrl: varchar("actionUrl", { length: 500 }),
  dedupeKey: varchar("dedupeKey", { length: 200 }).notNull(),
  isRead: boolean("isRead").notNull().default(false),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, (t) => ({
  dedupeUq: uniqueIndex("cn_dedupe_uq").on(t.dedupeKey),
  recipientUnreadIdx: index("cn_recipient_unread_idx").on(t.recipientUserId, t.isRead, t.createdAt),
  recipientCreatedIdx: index("cn_recipient_created_idx").on(t.recipientUserId, t.createdAt),
  postIdx: index("cn_post_idx").on(t.postId),
  commentIdx: index("cn_comment_idx").on(t.commentId),
}));

export type CommunityNotification = typeof communityNotifications.$inferSelect;

// ===== 商案討論區：競標 =====
// status machine: draft → pending_review → active (approved) | rejected → (edit) → pending_review
//                 active → cancelled | ended
export const communityBids = mysqlTable("communityBids", {
  id: int("id").autoincrement().primaryKey(),
  spaceCode: varchar("spaceCode", { length: 50 }).notNull(),
  authorUserId: int("authorUserId").references(() => users.id, { onDelete: "set null" }),
  authorFactoryId: int("authorFactoryId").references(() => factories.id, { onDelete: "set null" }),
  authorNameSnapshot: varchar("authorNameSnapshot", { length: 100 }).notNull().default(""),
  authorFactoryNameSnapshot: varchar("authorFactoryNameSnapshot", { length: 200 }),
  authorRoleSnapshot: varchar("authorRoleSnapshot", { length: 50 }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  quantity: varchar("quantity", { length: 200 }),
  material: varchar("material", { length: 200 }),
  specifications: text("specifications"),
  sampleRequired: boolean("sampleRequired").notNull().default(false),
  desiredDeliveryDate: varchar("desiredDeliveryDate", { length: 100 }),
  deliveryLocation: varchar("deliveryLocation", { length: 200 }),
  budgetMin: int("budgetMin"),
  budgetMax: int("budgetMax"),
  images: json("images").$type<string[]>().notNull().default([]),
  pinnedProductIds: json("pinnedProductIds").$type<number[]>().notNull().default([]),
  durationHours: int("durationHours").notNull(),
  status: mysqlEnum("status", ["draft", "pending_review", "rejected", "active", "cancelled", "ended"]).notNull().default("draft"),
  publishedAt: timestamp("publishedAt"),
  // deadline = publishedAt + durationHours; stored denormalized for efficient deadline queries
  deadline: timestamp("deadline"),
  // Latest rejection reason (full history in communityBidReviewHistory)
  rejectionReason: varchar("rejectionReason", { length: 1000 }),
  // No FK: stored for audit even if the admin account is later deleted
  reviewedByUserId: int("reviewedByUserId"),
  reviewedAt: timestamp("reviewedAt"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  spaceStatusIdx: index("cb_space_status_idx").on(t.spaceCode, t.status, t.createdAt),
  authorUserIdx: index("cb_author_user_idx").on(t.authorUserId),
  statusIdx: index("cb_status_idx").on(t.status, t.publishedAt),
  deadlineIdx: index("cb_deadline_idx").on(t.deadline),
}));

export type CommunityBid = typeof communityBids.$inferSelect;

// ===== 商案討論區：競標跨產業關聯 =====
// Cross-industry bids (spaceCode = "cross-industry") list target industries here.
// Regular bids leave this table empty — spaceCode already implies the industry.
export const communityBidIndustries = mysqlTable("communityBidIndustries", {
  id: int("id").autoincrement().primaryKey(),
  bidId: int("bidId").notNull().references(() => communityBids.id, { onDelete: "cascade" }),
  spaceCode: varchar("spaceCode", { length: 50 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  bidSpaceUq: uniqueIndex("cbi_bid_space_uq").on(t.bidId, t.spaceCode),
  spaceIdx: index("cbi_space_idx").on(t.spaceCode),
}));

export type CommunityBidIndustry = typeof communityBidIndustries.$inferSelect;

// ===== 商案討論區：競標審核歷史 =====
// Immutable audit trail.
// actorUserId: nullable FK with ON DELETE SET NULL — record survives admin account deletion.
// actorNameSnapshot: name captured at the time of action; guarantees auditability even after account deletion.
// bidStatusBefore / bidStatusAfter: full state transition for compliance traceability.
export const communityBidReviewHistory = mysqlTable("communityBidReviewHistory", {
  id: int("id").autoincrement().primaryKey(),
  bidId: int("bidId").notNull().references(() => communityBids.id, { onDelete: "cascade" }),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  actorNameSnapshot: varchar("actorNameSnapshot", { length: 100 }).notNull().default(""),
  action: mysqlEnum("action", ["submitted", "approved", "rejected", "withdrawn"]).notNull(),
  reason: varchar("reason", { length: 1000 }),
  bidStatusBefore: varchar("bidStatusBefore", { length: 30 }).notNull().default(""),
  bidStatusAfter: varchar("bidStatusAfter", { length: 30 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  bidIdx: index("cbrh_bid_idx").on(t.bidId),
}));

export type CommunityBidReviewHistory = typeof communityBidReviewHistory.$inferSelect;

// ===== 商案討論區：廠商投標報價 =====
// One offer per factory per bid: UNIQUE(bidId, bidderFactoryId).
// MySQL allows multiple NULLs in a UNIQUE index, so SET NULL on FK delete doesn't cause conflicts.
// Bid author cannot offer on their own bid (enforced at router layer, not schema).
export const communityBidOffers = mysqlTable("communityBidOffers", {
  id: int("id").autoincrement().primaryKey(),
  bidId: int("bidId").notNull().references(() => communityBids.id, { onDelete: "cascade" }),
  bidderUserId: int("bidderUserId").references(() => users.id, { onDelete: "set null" }),
  bidderFactoryId: int("bidderFactoryId").references(() => factories.id, { onDelete: "set null" }),
  bidderNameSnapshot: varchar("bidderNameSnapshot", { length: 100 }).notNull().default(""),
  bidderFactoryNameSnapshot: varchar("bidderFactoryNameSnapshot", { length: 200 }).notNull().default(""),
  bidderRoleSnapshot: varchar("bidderRoleSnapshot", { length: 50 }).notNull().default("owner"),
  amount: decimal("amount", { precision: 12, scale: 0 }),
  currency: varchar("currency", { length: 10 }).notNull().default("TWD"),
  deliveryDays: int("deliveryDays"),
  moq: int("moq"),
  sampleAvailable: boolean("sampleAvailable").notNull().default(false),
  proposal: text("proposal").notNull(),
  commercialTerms: text("commercialTerms"),
  images: json("images").$type<string[]>().notNull().default([]),
  pinnedProductIds: json("pinnedProductIds").$type<number[]>().notNull().default([]),
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  status: mysqlEnum("status", ["active", "withdrawn", "disqualified"]).notNull().default("active"),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
  withdrawnAt: timestamp("withdrawnAt"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  bidFactoryUq: uniqueIndex("cbo_bid_factory_uq").on(t.bidId, t.bidderFactoryId),
  bidStatusIdx: index("cbo_bid_status_idx").on(t.bidId, t.status),
  bidderUserIdx: index("cbo_bidder_user_idx").on(t.bidderUserId),
  bidderFactoryIdx: index("cbo_bidder_factory_idx").on(t.bidderFactoryId),
  lastUpdaterIdx: index("cbo_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type CommunityBidOffer = typeof communityBidOffers.$inferSelect;

// ===== 企業升級中心：顧問設定 =====
// 三個固定地區（north/central/south），每筆綁定一個 userId（可 null）
// userId 可重複：測試期間三個地區都可綁到同一帳號
export const upgradeConsultants = mysqlTable("upgradeConsultants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  regionKey: mysqlEnum("regionKey", ["north", "central", "south"]).notNull(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  serviceAreas: json("serviceAreas").$type<string[]>().notNull(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  regionKeyUq: uniqueIndex("uc_region_key_uq").on(t.regionKey),
  userIdIdx: index("uc_user_id_idx").on(t.userId),
}));

export type UpgradeConsultant = typeof upgradeConsultants.$inferSelect;
export type InsertUpgradeConsultant = typeof upgradeConsultants.$inferInsert;

// ===== 企業升級中心：申請案件 =====
export const upgradeApplications = mysqlTable("upgradeApplications", {
  id: int("id").autoincrement().primaryKey(),
  companyName: varchar("companyName", { length: 200 }).notNull(),
  contactName: varchar("contactName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  location: varchar("location", { length: 100 }).notNull(),
  capitalAmount: varchar("capitalAmount", { length: 30 }).notNull(),
  employeeCount: varchar("employeeCount", { length: 30 }).notNull(),
  factoryType: varchar("factoryType", { length: 30 }).notNull(),
  hasGovernmentProject: boolean("hasGovernmentProject").notNull().default(false),
  governmentProjectName: varchar("governmentProjectName", { length: 200 }),
  hasGovernmentAward: boolean("hasGovernmentAward").notNull().default(false),
  governmentAwardName: varchar("governmentAwardName", { length: 200 }),
  hasPatent: boolean("hasPatent").notNull().default(false),
  patentCount: int("patentCount"),
  exportStatus: varchar("exportStatus", { length: 30 }).notNull(),
  notes: text("notes"),
  factoryId: int("factoryId"), // nullable — OXM factory that submitted this application
  consentAgreed: boolean("consentAgreed").notNull().default(true),
  // status flow: new → evaluating → ineligible/deferred/accepted → submitted → rejected/approved → transforming → completed
  // ineligible / deferred / unassigned / archived are exception states
  //   deferred（緩追區）：工廠體質符合但目前沒有適合的補助方案，暫緩追蹤；
  //   可與 evaluating 互轉（移至緩追區 / 重新評估），也可直接轉 accepted 或 ineligible。
  //   不算「已完成資格判定」，因此不列入過件率分子分母（見 server/db.ts
  //   UPGRADE_ACCEPTED_STATUSES / UPGRADE_ELIGIBILITY_DECIDED_STATUSES 的說明）。
  // legacy: viewed/contacted/consulting kept for backward compat until data migration
  status: mysqlEnum("status", [
    "new", "evaluating", "ineligible", "deferred", "accepted", "submitted",
    "rejected", "approved", "transforming", "completed",
    "unassigned", "archived",
    "viewed", "contacted", "consulting",
  ]).notNull().default("new"),
  assignedConsultantId: int("assignedConsultantId").references(() => upgradeConsultants.id, { onDelete: "set null" }),
  viewedAt: timestamp("viewedAt"),
  viewedByUserId: int("viewedByUserId"), // no FK — audit trail even if user deleted
  plannedSubsidyAmount: int("plannedSubsidyAmount"),
  approvedSubsidyAmount: int("approvedSubsidyAmount"),
  // 顧問服務費與 OXM 抽成
  consultantFeeMode: varchar("consultantFeeMode", { length: 20 }),          // "percentage" | "fixed" | null
  consultantFeePercentage: decimal("consultantFeePercentage", { precision: 5, scale: 2 }), // e.g. "10.00"
  consultantFeeAmount: int("consultantFeeAmount"),                           // 顧問服務費金額（元）
  oxmCommissionRate: decimal("oxmCommissionRate", { precision: 5, scale: 2 }), // OXM 抽成比例，預設 10
  oxmCommissionAmount: int("oxmCommissionAmount"),                           // OXM 收入（元）
  // 送審補助方案
  submittedSubsidyProgram: varchar("submittedSubsidyProgram", { length: 50 }), // SBIR / CITD / SIIR / 研發轉型補助 / 海外通路計畫 / 其他
  submittedSubsidyProgramOther: varchar("submittedSubsidyProgramOther", { length: 100 }), // 選「其他」時手寫
  statusTimeline: json("statusTimeline").$type<Record<string, string>>(),
  // 最後一次修改案件的使用者（管理員或顧問）：FK 對應真實 userId（使用者被
  // 刪除時 SET NULL，不影響歷史紀錄），name snapshot 另外保存當下顯示名稱，
  // 沿用 communityBidOffers.lastUpdatedByUserId/lastUpdatedByNameSnapshot 的
  // 慣例，避免使用者之後改名或被刪除時舊紀錄的顯示名稱跟著消失或需要額外 join。
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  statusCreatedIdx: index("ua_status_created_idx").on(t.status, t.createdAt),
  consultantIdx: index("ua_consultant_idx").on(t.assignedConsultantId, t.status, t.createdAt),
  factoryIdx: index("ua_factory_idx").on(t.factoryId),
  lastUpdaterIdx: index("ua_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type UpgradeApplication = typeof upgradeApplications.$inferSelect;
export type InsertUpgradeApplication = typeof upgradeApplications.$inferInsert;

// ===== 企業財務優化：顧問設定 =====
// 目前只有一位合作顧問，未來可擴充多位；不綁定固定 email／userId，
// 授權完全由「是否在此表中有一筆有效（isActive）紀錄」決定（見
// server/db.ts getFinanceConsultantsByUserId）。與 upgradeConsultants
// 是各自獨立的表，因此既有補助顧問資料不會因為這次新增而意外取得
// 財務案件權限。
export const financeConsultants = mysqlTable("financeConsultants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // UNIQUE 而非一般 index：避免同一 userId 被重複綁定到多筆顧問紀錄，確保
  // 「系統只有一位啟用中顧問時自動指派」的判斷不會被同一人重複掛號影響。
  // MySQL UNIQUE INDEX 允許多筆 NULL（尚未綁定的顧問列可以同時存在）。
  userIdUq: uniqueIndex("fc_user_id_uq").on(t.userId),
}));

export type FinanceConsultant = typeof financeConsultants.$inferSelect;
export type InsertFinanceConsultant = typeof financeConsultants.$inferInsert;

// ===== 企業財務優化：申請案件 =====
// 獨立於 upgradeApplications 的資料模型（不同顧問流程、不同狀態機），
// 依使用者需求刻意不含統一編號／經營概況／稅務融資勾選／下次追蹤日期。
export const financeApplications = mysqlTable("financeApplications", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  // 公司名稱／地址由 server 依 factoryId 讀取工廠資料寫入的 snapshot，
  // 不信任前端傳入值；即使工廠之後改名，案件仍保留申請當下的內容。
  companyNameSnapshot: varchar("companyNameSnapshot", { length: 200 }).notNull(),
  companyAddressSnapshot: varchar("companyAddressSnapshot", { length: 500 }).notNull(),
  contactName: varchar("contactName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  contactTime: varchar("contactTime", { length: 100 }).notNull(),
  consentAgreed: boolean("consentAgreed").notNull().default(true),
  // 五個看板：new(新案件) → evaluating(評估中) → deferred(緩追區)／
  // not_interested(無意願)／won(成交區)；deferred 可回到 evaluating。
  // not_interested／won 為結案狀態，結案後可對同一工廠重新建立新案件。
  status: mysqlEnum("status", ["new", "evaluating", "deferred", "not_interested", "won"]).notNull().default("new"),
  assignedConsultantId: int("assignedConsultantId").references(() => financeConsultants.id, { onDelete: "set null" }),
  notes: text("notes"), // 顧問內部備註，僅授權顧問／管理員可見，不回傳給申請人
  statusTimeline: json("statusTimeline").$type<Record<string, string>>(),
  // 沿用 upgradeApplications.lastUpdatedByUserId/lastUpdatedByNameSnapshot 慣例
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  // Virtual generated column：狀態為 new/evaluating/deferred（未結案）時等於
  // factoryId，否則為 NULL。MySQL UNIQUE INDEX 忽略 NULL，因此只會限制「同一
  // 工廠最多一筆未結案案件」，結案（not_interested／won）後的歷史案件不受限，
  // 可重新申請。與 factoryRevisions.pendingFactoryId 相同手法，可靠地在
  // DB 層防止重複申請（不只是前端擋按鈕）。
  openFactoryId: int("openFactoryId").generatedAlwaysAs(
    sql`CASE WHEN \`status\` IN ('new','evaluating','deferred') THEN \`factoryId\` ELSE NULL END`
  ),
}, (t) => ({
  openFactoryUq: uniqueIndex("fa_open_factory_uq").on(t.openFactoryId),
  statusCreatedIdx: index("fa_status_created_idx").on(t.status, t.createdAt),
  consultantIdx: index("fa_consultant_idx").on(t.assignedConsultantId, t.status, t.createdAt),
  factoryIdx: index("fa_factory_idx").on(t.factoryId),
  lastUpdaterIdx: index("fa_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type FinanceApplication = typeof financeApplications.$inferSelect;
export type InsertFinanceApplication = typeof financeApplications.$inferInsert;
