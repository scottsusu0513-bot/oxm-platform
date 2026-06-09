import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json, uniqueIndex, index, date } from "drizzle-orm/mysql-core";
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
  businessType: mysqlEnum("businessType", ["factory", "studio"]).default("factory").notNull(), // 代工廠或工作室
  operationStatus: mysqlEnum("operationStatus", ["normal", "busy", "full"]).default("normal").notNull(),
  certified: boolean("certified").default(false).notNull(),
  subIndustry: json("subIndustry").$type<string[]>().default([]),
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
});

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
  cancelledAt: timestamp("cancelledAt"),
  cancelRequestedByUserId: int("cancelRequestedByUserId"),
  cancelRequestedAt: timestamp("cancelRequestedAt"),
  cancelRequestReason: text("cancelRequestReason"),
  cancelRequestedFromStatus: varchar("cancelRequestedFromStatus", { length: 30 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollaborationOrder = typeof collaborationOrders.$inferSelect;

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Announcement = typeof announcements.$inferSelect;

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
