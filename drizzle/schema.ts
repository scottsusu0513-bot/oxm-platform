import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json, uniqueIndex, index, date } from "drizzle-orm/mysql-core";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import type { ImageCropData } from "../shared/imageCrop";

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
  // 註冊條款 Consent Gate（見 shared/consent.ts）：服務條款與隱私權政策各自
  // 獨立記錄同意時間與版本，不是單一欄位。NULL 代表「尚未透過這一版
  // Consent Gate 同意過」——舊會員 migration 套用後這四欄全部是 NULL，但
  // 是否需要被攔下來，由 shared/consent.ts 的 userNeedsConsent()
  // 依 createdAt 是否早於 CONSENT_GATE_LAUNCH_AT 判斷，不是單純看這幾欄
  // 是否為 NULL，因此這裡刻意不補寫任何舊會員的同意紀錄。
  termsAcceptedAt: timestamp("termsAcceptedAt"),
  termsVersion: varchar("termsVersion", { length: 20 }),
  privacyAcceptedAt: timestamp("privacyAcceptedAt"),
  privacyVersion: varchar("privacyVersion", { length: 20 }),
  // 新會員 Spotlight 新手導引（見 shared/onboarding.ts）：NULL 代表「尚未
  // 完成或略過這一版導覽」。同 Consent Gate 的設計，是否顯示導覽由
  // shared/onboarding.ts 的 userNeedsOnboarding() 依 createdAt 是否早於
  // ONBOARDING_LAUNCH_AT 判斷，不是單純看這欄是否為 NULL，因此舊會員即使
  // 這欄是 NULL 也不會被導覽攔住。「完成」與「略過」共用同一欄位——兩者的
  // 持久化效果相同：以後都不再自動顯示導覽。
  onboardingCompletedAt: timestamp("onboardingCompletedAt"),
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
  // 統一編號（8 碼數字）。只有新建立工廠（factory.create）強制必填，既有工廠
  // 一律維持 NULL，不做任何 backfill；factory.update／submitRevision／
  // admin 審核流程都不要求此欄位（見 migration 0092、shared/taxId.ts）。
  taxId: varchar("taxId", { length: 8 }),
  // 平均評分（快取欄位，定期從 reviews 計算更新）
  avgRating: decimal("avgRating", { precision: 3, scale: 2 }).default("0"),
  reviewCount: int("reviewCount").default(0),
  status: mysqlEnum("status", ["draft", "pending", "approved", "rejected", "delisted"]).default("draft").notNull(),
  avatarUrl: text("avatarUrl"), // 工廠頭貼／Logo
  // 工廠頭貼／Logo 的顯示範圍中繼資料（見 shared/imageCrop.ts）。null 表示
  // 既有圖片沒有設定過，前台 fallback 成置中顯示（與目前行為相同）。
  avatarCrop: json("avatarCrop").$type<ImageCropData | null>(),
  coverImageUrl: text("coverImageUrl"), // 工廠封面背景圖 (16:5)
  // 工廠封面的顯示範圍中繼資料。null 表示既有封面沒有設定過（migration 0071
  // 之前上傳的封面已經是前端烘焙好的固定 16:5 圖片，此時 fallback 成置中
  // 顯示等同於目前既有行為，不影響外觀）。
  coverCrop: json("coverCrop").$type<ImageCropData | null>(),
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
  // ===== 管理員內部 CRM 欄位（電話開發追蹤用）=====
  // 絕不可出現在任何公開 API／SSR／owner 視角回應——見 shared/badges.ts
  // 的 stripCertificationEvidence（唯一公開輸出消毒點，一併移除這兩欄）。
  // not_called＝灰色／尚未打過電話（既有工廠一律視為此狀態，見 migration
  // 0078 的 DEFAULT），not_interested＝紅色／沒興趣，follow_up＝藍色／可追蹤。
  contactStatus: mysqlEnum("contactStatus", ["not_called", "not_interested", "follow_up"]).default("not_called").notNull(),
  adminNote: text("adminNote"), // 管理員專用備註，純後台資訊，絕不對外顯示
  // 軟刪除標記：factories 被大量業務表（financeApplications／certificationCases／
  // shortVideoCases／erpCases／collaborationOrders／reviews／favorites 等）
  // FK 參照，見 migration 0078 說明，一律軟刪除避免 orphan data／FK 錯誤。
  // 非 null 時該筆工廠一律視為已刪除：從管理員預設列表與所有公開端隱藏，
  // 但資料庫紀錄本身保留。
  deletedAt: timestamp("deletedAt"),
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
  // 每張商品圖片各自的顯示範圍，陣列順序與長度與 images 對齊（第 i 筆對應
  // images[i]）。重新排序 images 時，呼叫端必須把 imageCrops 用同一個順序
  // 一起搬動，見 server/db.ts 的 reorder 相關函式。null 或長度不足時，對應
  // 圖片 fallback 成置中顯示。
  imageCrops: json("imageCrops").$type<(ImageCropData | null)[]>().default([]),
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
  // 「這則消息是否已經寄送過 Email 通知」的唯一依據：只有 news.create 這個
  // mutation 帶入 sendEmailNotification=true 且剛好是第一次發布（shouldNotify）
  // 時才可能被寫入，寫入時機是 Email 已成功排入既有寄送機制之後（見
  // server/routers.ts 的 dispatchNewsNotifications）。一旦有值就永遠不再改變
  // ——update mutation 完全不接受、也不會觸發這個欄位，避免編輯已發布消息時
  // 不小心補寄。null 代表「這則消息發布當下沒有寄送 Email」，不代表發送失敗。
  emailNotificationSentAt: timestamp("emailNotificationSentAt"),
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
  // 這張相簿照片的顯示範圍中繼資料，null 表示 fallback 成置中顯示。因為每張
  // 照片本來就是自己的一列（不是陣列），不需要像 products.imageCrops 那樣
  // 額外處理陣列對齊，重新排序只影響 sortOrder，這個欄位跟著該筆 row 走。
  crop: json("crop").$type<ImageCropData | null>(),
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

// Phase 6: images used to be plain string[] (URL only, no crop control). Upgraded
// in-place to { url, crop }[] — same JSON column, no migration needed since JSON
// columns don't enforce a fixed shape. Old rows still physically contain bare
// strings; read paths must go through shared/imageCrop.ts's normalizeImageEntry()
// rather than assuming this type at runtime (see server/db.ts getCommunityPostById).
export type CommunityPostImage = { url: string; crop: ImageCropData | null };

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
  images: json("images").$type<CommunityPostImage[]>().default([]),
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
  // 決策者是否共同參與顧問洽談：前端必填單選（owner／manager／unavailable），
  // 讓顧問在聯繫案件前就知道能否直接接觸到有決策權的人，避免透過窗口反覆
  // 轉達、喬時間拖慢案件推進。DB 允許 NULL，理由同 annualRevenue——區分
  // 「舊案件（新增本欄位前建立，從未被問過這題）」與「答案為 unavailable」，
  // 不可用 unavailable 頂替舊資料的沉默，兩者語意不同。存穩定英文 code，不存
  // 完整中文句子，中文顯示文字統一由前端依 code 對應。
  decisionMakerParticipation: varchar("decisionMakerParticipation", { length: 20 }),
  location: varchar("location", { length: 100 }).notNull(),
  capitalAmount: varchar("capitalAmount", { length: 30 }).notNull(),
  // 年營收：前端必填單選（500萬以下／500~1000萬／1000萬以上），DB 允許 NULL
  // 是為了容納既有舊案件（新增本欄位前建立，從未被問過這題）——用 NULL 區分
  // 「未填答」與「填答為某個選項」，不可用某個選項值頂替舊資料的沉默。
  annualRevenue: varchar("annualRevenue", { length: 30 }),
  employeeCount: varchar("employeeCount", { length: 30 }).notNull(),
  factoryType: varchar("factoryType", { length: 30 }).notNull(),
  // 是否為企業社：前端必填單選，僅供顧問初步資格判斷用，畫面不顯示任何結論性文字。
  // 欄位命名為 isEnterpriseFirm（不用 isEnterpriseAssociation）——後者的
  // "Association" 容易被誤讀為「企業協會／公會」，與台灣組織型態「企業社」
  // （個人商號的一種登記類型）語意不同。
  // DB 允許 NULL，理由同 annualRevenue（區分「舊案件未問過」與「答案為否」）。
  isEnterpriseFirm: boolean("isEnterpriseFirm"),
  hasGovernmentProject: boolean("hasGovernmentProject").notNull().default(false),
  governmentProjectName: varchar("governmentProjectName", { length: 200 }),
  hasGovernmentAward: boolean("hasGovernmentAward").notNull().default(false),
  governmentAwardName: varchar("governmentAwardName", { length: 200 }),
  // 是否曾申請過政府補助：與 hasGovernmentAward（是否曾「獲得」政府獎項）語意不同
  // ——「申請過補助」與「得過獎項」是兩個不同問題，即使正式環境目前 hasGovernmentAward
  // 尚無任何案件填值（2026-07-31 查證：4 筆案件皆為 false/NULL），仍新增獨立欄位，
  // 不重用舊欄位改標題，避免舊資料語意被錯誤覆寫。hasGovernmentAward/governmentAwardName
  // 保留不動。DB 允許 NULL，理由同上。
  hasAppliedForGovernmentSubsidy: boolean("hasAppliedForGovernmentSubsidy"),
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

// ===== 政府補助專區：公開方案目錄 =====
// 純粹管理公開頁要展示的補助方案，與 upgradeApplications（企業送件案件）、
// upgradeConsultants（顧問）及其狀態／分派流程完全獨立，刻意不建立任何外鍵。
// 「刪除」採 archivedAt 軟封存，避免未來若新增案件引用時破壞歷史資料。
export const upgradePrograms = mysqlTable("upgradePrograms", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  shortTitle: varchar("shortTitle", { length: 100 }),
  description: text("description").notNull(),
  targetAudience: text("targetAudience"),
  highlights: json("highlights").$type<string[]>().notNull().default([]),
  badge: varchar("badge", { length: 80 }),
  statusLabel: varchar("statusLabel", { length: 100 }),
  visualKey: varchar("visualKey", { length: 50 }).notNull().default("funding"),
  maxFundingLabel: varchar("maxFundingLabel", { length: 100 }),
  imageUrl: text("imageUrl"),
  ctaLabel: varchar("ctaLabel", { length: 80 }).notNull().default("免費評估資格"),
  displayOrder: int("displayOrder").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  publicListIdx: index("up_public_list_idx").on(t.enabled, t.archivedAt, t.displayOrder),
}));

export type UpgradeProgram = typeof upgradePrograms.$inferSelect;
export type InsertUpgradeProgram = typeof upgradePrograms.$inferInsert;

// ===== ISO 與低碳認證專區：動態分類／服務項目目錄 =====
// 與 shared/badges.ts 的 30 種既有徽章系統完全獨立、不共用資料表——這裡只是
// 「認證服務」的行銷／諮詢入口資料（分類、顯示名稱、說明、適用需求／產業、
// 上下架狀態），不是工廠已獲得的徽章擁有權紀錄。badgeCode 只在「該服務項目
// 剛好對應一個既有徽章」時填入既有徽章 id（純字串參照，非 DB 外鍵——徽章清單
// 是程式碼常數而非資料表），可為 NULL（例如 ISO/IEC 27001 目前沒有對應的
// 既有徽章）。絕不透過這裡的資料反向新增、修改或刪除任何工廠已核准的徽章。
export const certificationServiceCategories = mysqlTable("certificationServiceCategories", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: int("sortOrder").notNull().default(0),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const certificationServiceItems = mysqlTable("certificationServiceItems", {
  id: int("id").autoincrement().primaryKey(),
  // 服務項目自己的穩定代碼——下一階段接正式諮詢表單時，CTA 會帶入這個值，
  // 不依賴資料庫自增 id（id 只是內部關聯用，code 才是外部/未來表單引用的
  // 穩定身分）。
  code: varchar("code", { length: 50 }).notNull().unique(),
  badgeCode: varchar("badgeCode", { length: 50 }),
  categoryId: int("categoryId").notNull().references(() => certificationServiceCategories.id),
  name: varchar("name", { length: 200 }).notNull(),
  // 卡片類型標籤（例如「管理系統」「盤查與量化」「政府標籤」），與
  // certificationServiceCategories 的分類是兩個獨立維度：分類決定篩選分組，
  // type 只是卡片上顯示的性質標籤，避免把九項全部誤稱為同一種「ISO 認證」。
  type: varchar("type", { length: 50 }).notNull(),
  shortDescription: text("shortDescription").notNull(),
  applicableNeeds: json("applicableNeeds").$type<string[]>().notNull().default([]),
  applicableIndustries: json("applicableIndustries").$type<string[]>().notNull().default([]),
  versionNote: varchar("versionNote", { length: 300 }),
  iconKey: varchar("iconKey", { length: 100 }),
  serviceEnabled: boolean("serviceEnabled").notNull().default(true),
  consultEnabled: boolean("consultEnabled").notNull().default(true),
  // draft(草稿) → published(上架，公開頁可見) ⇄ unpublished(下架，暫時隱藏，
  // 可再次上架) → archived(封存，不再出現在管理列表的一般檢視，historical)。
  // 只有 draft 狀態且未被任何資料引用時才可以被永久刪除（見 server 端刪除
  // 檢查），published/unpublished/archived 一律只能改狀態，不能刪除，避免
  // 未來案件或紀錄的關聯資料失去對應項目。
  status: mysqlEnum("status", ["draft", "published", "unpublished", "archived"]).notNull().default("draft"),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  categoryIdx: index("csi_category_idx").on(t.categoryId, t.status, t.sortOrder),
  statusIdx: index("csi_status_idx").on(t.status, t.serviceEnabled),
}));

export type CertificationServiceCategory = typeof certificationServiceCategories.$inferSelect;
export type InsertCertificationServiceCategory = typeof certificationServiceCategories.$inferInsert;
export type CertificationServiceItem = typeof certificationServiceItems.$inferSelect;
export type InsertCertificationServiceItem = typeof certificationServiceItems.$inferInsert;

// ===== 短影音與品牌內容行銷專區：顧問設定 =====
// 與 financeConsultants／upgradeConsultants 完全獨立的表，短影音案件不會
// 因為既有顧問資料而意外取得存取權限。serviceAreas 為空陣列時視為「五項
// 服務皆可承接」，非空陣列時只承接陣列內列出的服務——見
// server/db.ts createShortVideoCaseWithAutoAssign 候選人篩選邏輯。
export const shortVideoConsultants = mysqlTable("shortVideoConsultants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  serviceAreas: json("serviceAreas").$type<string[]>().notNull().default([]),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdUq: uniqueIndex("svc_user_id_uq").on(t.userId),
}));

export type ShortVideoConsultant = typeof shortVideoConsultants.$inferSelect;
export type InsertShortVideoConsultant = typeof shortVideoConsultants.$inferInsert;

// ===== 短影音與品牌內容行銷專區：申請案件 =====
// 獨立於 upgradeApplications／financeApplications 的資料模型與狀態機，
// 不得混入政府補助、財務或認證案件的看板或統計。
export const shortVideoCases = mysqlTable("shortVideoCases", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  // 公司名稱／地址由 server 依 factoryId 讀取工廠資料寫入的 snapshot，
  // 不信任前端傳入值，沿用 financeApplications 慣例。
  companyNameSnapshot: varchar("companyNameSnapshot", { length: 200 }).notNull(),
  companyAddressSnapshot: varchar("companyAddressSnapshot", { length: 500 }).notNull(),
  contactName: varchar("contactName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  contactTime: varchar("contactTime", { length: 100 }).notNull(),
  // 想了解的服務：可複選 shared/shortVideoMarketing.ts SHORT_VIDEO_SERVICE_KEYS，
  // 與 isUnsure 互斥（isUnsure=true 時本欄位必須是空陣列，見 server 端 zod refine）。
  servicesWanted: json("servicesWanted").$type<string[]>().notNull().default([]),
  isUnsure: boolean("isUnsure").notNull().default(false),
  // 主要目標：單選，shared/shortVideoMarketing.ts SHORT_VIDEO_GOAL_KEYS 之一。
  primaryGoal: varchar("primaryGoal", { length: 30 }).notNull(),
  // 目前經營平台：可複選，與 noPlatformYet 互斥（同 servicesWanted/isUnsure）。
  platforms: json("platforms").$type<string[]>().notNull().default([]),
  noPlatformYet: boolean("noPlatformYet").notNull().default(false),
  additionalNotes: varchar("additionalNotes", { length: 2000 }),
  consentAgreed: boolean("consentAgreed").notNull().default(true),
  // 短影音／品牌內容專屬流程（見 shared/shortVideoMarketing.ts SHORT_VIDEO_STATUS_TRANSITIONS）：
  // new(新案件／待聯繫) → needs_interview(需求訪談) → proposal(方案確認) →
  // pre_production(前期企劃) → script_review(腳本待確認) → in_progress(拍攝／製作中)
  // → draft_review(初稿審核／修改) → delivered(已交付) → [ongoing_operation(持續代營運)
  // 長期方案分支，可選] → completed(案件完成)。例外：deferred／no_interest／
  // not_applicable(不適合承接)／archived，進入例外狀態一律要求 statusReason。
  // unassigned＝待取件。
  //
  // enum 額外保留 'evaluating' 這個目前程式已不再寫入的舊值：drizzle/0075_service_
  // status_flows.sql 是 additive、向後相容 migration（正式庫已套用 0070/0073/0074，
  // 本表在正式站上線當下就是舊版九態），保留舊值只是為了部署切換期間新舊版本程式碼
  // 都能正常讀寫，不代表新版程式邏輯會使用這個值；正式清理舊值另開後續 migration。
  status: mysqlEnum("status", [
    "new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned",
    "needs_interview", "pre_production", "script_review", "draft_review", "delivered", "ongoing_operation", "not_applicable",
  ]).notNull().default("new"),
  assignedConsultantId: int("assignedConsultantId").references(() => shortVideoConsultants.id, { onDelete: "set null" }),
  notes: text("notes"), // 顧問內部備註，僅授權顧問／管理員可見
  statusTimeline: json("statusTimeline").$type<Record<string, string>>(),
  statusHistory: json("statusHistory").$type<Array<{
    status: string; at: string; byUserId: number; byName: string; reason?: string; forced?: boolean; action?: string;
  }>>(),
  statusReason: varchar("statusReason", { length: 500 }),
  claimedAt: timestamp("claimedAt"),
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  // 未結案狀態時等於 factoryId，否則為 NULL，MySQL UNIQUE INDEX 忽略 NULL——只
  // 限制「同一工廠最多一筆未結案短影音案件」，結案後可重新申請。同時辨識舊九態與
  // 新增細分狀態中的未結案狀態聯集，新舊資料都能正確算出未結案工廠 id。沿用
  // financeApplications.openFactoryId 手法。
  openFactoryId: int("openFactoryId").generatedAlwaysAs(
    sql`CASE WHEN \`status\` IN ('new','evaluating','proposal','in_progress','deferred','unassigned','needs_interview','pre_production','script_review','draft_review','delivered','ongoing_operation') THEN \`factoryId\` ELSE NULL END`
  ),
}, (t) => ({
  openFactoryUq: uniqueIndex("svcase_open_factory_uq").on(t.openFactoryId),
  statusCreatedIdx: index("svcase_status_created_idx").on(t.status, t.createdAt),
  consultantIdx: index("svcase_consultant_idx").on(t.assignedConsultantId, t.status, t.createdAt),
  factoryIdx: index("svcase_factory_idx").on(t.factoryId),
  lastUpdaterIdx: index("svcase_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type ShortVideoCase = typeof shortVideoCases.$inferSelect;
export type InsertShortVideoCase = typeof shortVideoCases.$inferInsert;

// ===== ISO 與低碳認證專區：顧問設定與申請案件 =====
// 與 financeConsultants／shortVideoConsultants 等完全獨立的表，不共用資料或
// 狀態機。servicesWanted 存的是 certificationServiceItems.code（現有認證服務
// 目錄的穩定代碼），不是另建一套固定清單，確保選項永遠與 certificationCenter
// 公開頁實際顯示的服務項目同步——見 server/db.ts
// createCertificationCaseWithAutoAssign／submitApplication 的驗證邏輯。
export const certificationConsultants = mysqlTable("certificationConsultants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  serviceAreas: json("serviceAreas").$type<string[]>().notNull().default([]),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdUq: uniqueIndex("cc_user_id_uq").on(t.userId),
}));

export type CertificationConsultant = typeof certificationConsultants.$inferSelect;
export type InsertCertificationConsultant = typeof certificationConsultants.$inferInsert;

export const certificationCases = mysqlTable("certificationCases", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  companyNameSnapshot: varchar("companyNameSnapshot", { length: 200 }).notNull(),
  companyAddressSnapshot: varchar("companyAddressSnapshot", { length: 500 }).notNull(),
  contactName: varchar("contactName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  contactTime: varchar("contactTime", { length: 100 }).notNull(),
  // 想了解的認證服務：certificationServiceItems.code 陣列，與 isUnsure 互斥。
  servicesWanted: json("servicesWanted").$type<string[]>().notNull().default([]),
  isUnsure: boolean("isUnsure").notNull().default(false),
  additionalNotes: varchar("additionalNotes", { length: 2000 }),
  consentAgreed: boolean("consentAgreed").notNull().default(true),
  // ISO／低碳認證專屬流程（見 shared/certificationCase.ts CERTIFICATION_STATUS_TRANSITIONS
  // 取得合法轉移規則，drizzle/0075_service_status_flows.sql 由通用九態擴充而來）：
  // new(新案件／待聯繫) → needs_interview(需求訪談) → scope_assessment(適用性與範圍評估)
  // → proposal(方案與報價確認) → in_progress(輔導執行中) → pre_review(預審與改善，可視
  // 服務跳過) → verification(驗證／成果確認) → completed(輔導完成)。
  // 例外：deferred(緩追)／no_interest(無意願)／not_applicable(不適用／無法承接)／
  // archived(已封存)，進入例外狀態一律要求 statusReason。unassigned＝待取件。
  //
  // enum 額外保留 'evaluating' 這個目前程式已不再寫入的舊值：0075 是 additive、向後
  // 相容 migration（正式庫已套用 0070/0073/0074，本表上線當下就是舊版九態），保留
  // 舊值只是為了部署切換期間新舊版本程式碼都能正常讀寫，正式清理舊值另開後續 migration。
  status: mysqlEnum("status", [
    "new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned",
    "needs_interview", "scope_assessment", "pre_review", "verification", "not_applicable",
  ]).notNull().default("new"),
  assignedConsultantId: int("assignedConsultantId").references(() => certificationConsultants.id, { onDelete: "set null" }),
  notes: text("notes"),
  // 舊版「每個狀態第一次進入時間」map，保留供既有讀取路徑相容；完整操作歷程
  // （含操作者、備註／原因、是否為管理員強制修正）一律看 statusHistory。
  statusTimeline: json("statusTimeline").$type<Record<string, string>>(),
  // 完整狀態歷程，append-only，每次 updateCaseStatus／claim／adminForceStatus
  // 都會推入一筆，不覆蓋先前紀錄——見 server/db.ts CaseStatusHistoryEntry。
  statusHistory: json("statusHistory").$type<Array<{
    status: string; at: string; byUserId: number; byName: string; reason?: string; forced?: boolean; action?: string;
  }>>(),
  // 進入例外狀態（deferred/no_interest/not_applicable/archived）時的必填原因，
  // 隨狀態更新覆蓋為最新一次例外原因（歷史原因仍完整保留在 statusHistory）。
  statusReason: varchar("statusReason", { length: 500 }),
  // 顧問成功取件（自助取件或管理員指派後第一次進入非 unassigned 狀態）的時間。
  claimedAt: timestamp("claimedAt"),
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  openFactoryId: int("openFactoryId").generatedAlwaysAs(
    sql`CASE WHEN \`status\` IN ('new','evaluating','proposal','in_progress','deferred','unassigned','needs_interview','scope_assessment','pre_review','verification') THEN \`factoryId\` ELSE NULL END`
  ),
}, (t) => ({
  openFactoryUq: uniqueIndex("ccase_open_factory_uq").on(t.openFactoryId),
  statusCreatedIdx: index("ccase_status_created_idx").on(t.status, t.createdAt),
  consultantIdx: index("ccase_consultant_idx").on(t.assignedConsultantId, t.status, t.createdAt),
  factoryIdx: index("ccase_factory_idx").on(t.factoryId),
  lastUpdaterIdx: index("ccase_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type CertificationCase = typeof certificationCases.$inferSelect;
export type InsertCertificationCase = typeof certificationCases.$inferInsert;

// ===== ERP 與產線優化專區：顧問設定與申請案件 =====
// 與其他服務完全獨立的表。needType 是單選（不是陣列），與短影音／ISO 的
// 複選＋isUnsure 互斥模式不同——"unsure" 本身就是列舉值之一，天生只會有一個值成立。
export const erpConsultants = mysqlTable("erpConsultants", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  // 承接的需求類型（對應 erpCases.needType 列舉值），空陣列＝全部需求類型皆可承接。
  serviceAreas: json("serviceAreas").$type<string[]>().notNull().default([]),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdUq: uniqueIndex("ec_user_id_uq").on(t.userId),
}));

export type ErpConsultant = typeof erpConsultants.$inferSelect;
export type InsertErpConsultant = typeof erpConsultants.$inferInsert;

export const erpCases = mysqlTable("erpCases", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  companyNameSnapshot: varchar("companyNameSnapshot", { length: 200 }).notNull(),
  companyAddressSnapshot: varchar("companyAddressSnapshot", { length: 500 }).notNull(),
  contactName: varchar("contactName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  contactTime: varchar("contactTime", { length: 100 }).notNull(),
  // 需求類型：單選，erp_adoption(ERP導入)／line_optimization(產線動線優化)／
  // integrated(整合改善)／unsure(不確定由顧問判斷)。
  needType: mysqlEnum("needType", ["erp_adoption", "line_optimization", "integrated", "unsure"]).notNull(),
  additionalNotes: varchar("additionalNotes", { length: 2000 }),
  consentAgreed: boolean("consentAgreed").notNull().default(true),
  // ERP／產線優化專屬流程（見 shared/erpOptimization.ts ERP_STATUS_TRANSITIONS）：
  // new(新案件／待聯繫) → needs_triage(需求分流：確認屬於ERP/產線/整合改善/待判斷)
  // → diagnosis(現場診斷／流程盤點) → solution_design(改善方案設計) →
  // proposal(範圍與報價確認) → in_progress(導入執行中) → pilot_adjustment(試行與調整)
  // → acceptance(驗收中) → completed(專案完成)。例外：deferred／no_interest／
  // not_applicable／archived，進入例外狀態一律要求 statusReason。unassigned＝待取件。
  //
  // enum 額外保留 'evaluating' 這個目前程式已不再寫入的舊值：0075 是 additive、向後
  // 相容 migration（正式庫已套用 0070/0073/0074，本表上線當下就是舊版九態），保留
  // 舊值只是為了部署切換期間新舊版本程式碼都能正常讀寫，正式清理舊值另開後續 migration。
  status: mysqlEnum("status", [
    "new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned",
    "needs_triage", "diagnosis", "solution_design", "pilot_adjustment", "acceptance", "not_applicable",
  ]).notNull().default("new"),
  assignedConsultantId: int("assignedConsultantId").references(() => erpConsultants.id, { onDelete: "set null" }),
  notes: text("notes"),
  statusTimeline: json("statusTimeline").$type<Record<string, string>>(),
  statusHistory: json("statusHistory").$type<Array<{
    status: string; at: string; byUserId: number; byName: string; reason?: string; forced?: boolean; action?: string;
  }>>(),
  statusReason: varchar("statusReason", { length: 500 }),
  claimedAt: timestamp("claimedAt"),
  lastUpdatedByUserId: int("lastUpdatedByUserId").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByNameSnapshot: varchar("lastUpdatedByNameSnapshot", { length: 100 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  openFactoryId: int("openFactoryId").generatedAlwaysAs(
    sql`CASE WHEN \`status\` IN ('new','evaluating','proposal','in_progress','deferred','unassigned','needs_triage','diagnosis','solution_design','pilot_adjustment','acceptance') THEN \`factoryId\` ELSE NULL END`
  ),
}, (t) => ({
  openFactoryUq: uniqueIndex("ecase_open_factory_uq").on(t.openFactoryId),
  statusCreatedIdx: index("ecase_status_created_idx").on(t.status, t.createdAt),
  consultantIdx: index("ecase_consultant_idx").on(t.assignedConsultantId, t.status, t.createdAt),
  factoryIdx: index("ecase_factory_idx").on(t.factoryId),
  lastUpdaterIdx: index("ecase_last_updater_idx").on(t.lastUpdatedByUserId),
}));

export type ErpCase = typeof erpCases.$inferSelect;
export type InsertErpCase = typeof erpCases.$inferInsert;

// ===== OXM AI（企業需求診斷與資源分流）對話 =====
// 刻意跟上面買家↔工廠的 conversations／messages 完全獨立，不共用：那是人對人
// 詢價聊天，這是使用者跟 AI 的診斷對話。
//
// 生命週期（取代原本「保存 30 天」的規則）：aiConversations／aiMessages 只是
// 「當次互動的暫存工作區」，不是歷史紀錄——同一次使用階段（同頁面內收合/
// 重開）延續同一筆。收尾（收尾＝產生摘要、merge 進 aiEnterpriseMemories，
// 成功才刪除這筆 conversation 與底下所有 aiMessages，見 server/ai/memory.ts
// 的 endConversationAndSummarize()）有兩條觸發路徑：
// 1. 主要：inactivity finalizer（server/jobs/finalizeInactiveAiConversations.ts）
//    —— lastMessageAt 超過 30 分鐘沒有新訊息就視為這次互動已結束。
// 2. 保底：使用者開新的使用階段時（refresh／重新進頁），如果發現上一筆還
//    active，一律先收尾再建立新的 conversation（見
//    server/ai/chatService.ts 的 resolveConversationForTurn()），避免任何
//    漏網的 conversation 永久卡在 active 狀態。
// 跨對話的長期記憶只透過 aiEnterpriseMemories 承接，不會再讀取上一段的逐字
// 內容。
export const aiConversations = mysqlTable("aiConversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Phase 11.2（見對話中「八、Conversation factoryId」）：這個欄位從單純的
  // 「資訊性 snapshot」提升成「enterprise context boundary」——建立當下必須
  // 來自 server/ai/factoryContext.ts::resolveApprovedAiFactoryContext（只認
  // status='approved'），且這段對話收尾時的 Enterprise Memory 一律歸屬到這個
  // factoryId（見 server/ai/memory.ts）。conversation 建立後這個值不得中途
  // 切換；client 帶著既有 conversationId 續聊時，如果目前重新解析出來的
  // approved factoryId 跟這裡不一致，一律視為「工廠 context 已經變了」，不
  // 沿用、改為收尾後建立新的一筆（見 server/ai/chatService.ts::
  // resolveConversationForTurn）。仍然不是「讀取權限」的判斷依據——讀取權限
  // 永遠只看 aiConversations.userId（見 server/ai/conversationService.ts）。
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "set null" }),
  // active：這次使用階段還在進行中，可以繼續 append 訊息。
  // failed：收尾時摘要產生或寫入失敗，原文暫時保留待重試（見
  // server/jobs/retryFailedAiSummaries.ts）。
  // permanently_failed（Phase 11.2，見對話中「二十二、二十三」）：重試已達
  // MAX_RETRY_COUNT 上限，retry job 之後不再自動撿它，但原文依然保留，不會
  // 因為「重試次數用完」就默默丟掉企業資料——只是變成需要人工判斷的
  // governance 案件，見 server/ai/conversationService.ts::
  // getPermanentlyFailedConversationsCount()。
  // 正常收尾成功的對話直接整筆刪除，不會有第四種「已完成」的持久狀態。
  status: mysqlEnum("status", ["active", "failed", "permanently_failed"]).notNull().default("active"),
  // Current Conversation State：短期、結構化、只屬於這一段對話（不是長期
  // Enterprise Memory），格式見 server/ai/conversationState.ts 的 ConversationState。
  currentStateJson: json("currentStateJson").$type<Record<string, unknown>>(),
  // Phase 2 保留欄位，暫不使用；未來 AI handoff 正式送件流程的暫存資料。
  pendingActionJson: json("pendingActionJson").$type<Record<string, unknown>>(),
  // 收尾失敗時的重試次數與最後一次錯誤訊息，只有 status='failed' 時才有意義。
  retryCount: int("retryCount").notNull().default(0),
  lastSummaryError: text("lastSummaryError"),
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // 找「這個使用者目前 active 的對話」的主要查詢路徑；也用來讓收尾重試 job
  // 找出所有 status='failed' 的對話。
  userStatusIdx: index("aic_user_status_idx").on(t.userId, t.status),
}));

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = typeof aiConversations.$inferInsert;

export const aiMessages = mysqlTable("aiMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index("aim_conversation_idx").on(t.conversationId, t.createdAt),
}));

export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = typeof aiMessages.$inferInsert;

// ===== OXM AI Enterprise Memory（跨對話唯一的長期記憶來源）=====
// Phase 11.2（見對話中「一、正式架構決策」）：Enterprise Memory 是
// factory-scoped，不是 user-scoped、也不是 user+factory scoped——OXM AI 記住
// 的是「這間企業」，不是「這個人的企業背景」。同一間 approved 工廠的
// owner／co-manager 共用同一份記憶；user 離開這間工廠、加入另一間工廠之後，
// 只會讀到新工廠自己的記憶，不會繼續讀到舊工廠的記憶（Phase 11.1 Audit
// 認定的 P0：cross-factory memory leakage，見
// server/jobs/reconcileEnterpriseMemoryFactoryScope.ts 的歷史資料遷移策略）。
//
// 每個 conversation 正常收尾時都會產生一筆「這次對話」的摘要，但那份摘要
// 絕對不能直接 blind overwrite 這間工廠的既有長期記憶——summaryText 是
// 「目前最新、最精簡的企業狀態」，由 server/ai/memory.ts 的
// mergeEnterpriseMemory() 把既有 summaryText 與這次對話摘要合併/取代/更新
// 產生，不是單純覆寫也不是逐次 append 成日誌。沒有新資訊時（這次對話沒講
// 出任何企業重點），summaryText 完全不變，只更新 lastInteractionAt／
// lastInteractionHadMeaningfulInfo 這兩個欄位，讓 AI 之後仍能誠實回答「最近
// 一次互動有沒有新資訊」，而不會誤把「最近沒講重點」跟「完全沒有任何長期
// 記憶」混為一談。
export const aiEnterpriseMemories = mysqlTable("aiEnterpriseMemories", {
  id: int("id").autoincrement().primaryKey(),
  // 這張表現在唯一的查詢 key／ownership 依據（見下方 UNIQUE INDEX）。只有
  // status='approved' 的工廠才可能擁有一筆記憶（見
  // server/ai/factoryContext.ts::resolveApprovedAiFactoryContext）；工廠被
  // owner 自助真的物理刪除時，這筆記憶一起 CASCADE 刪除（該工廠已經不存在，
  // 不該變成無主 memory，見「十五、Factory Delete」）；admin 下架／軟刪除
  // 不是真正的 DELETE，不會觸發這個 FK。
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  // 純稽核用途，不是查詢 key——只記錄「最後一次觸發這筆記憶更新的是哪個
  // 登入帳號」（該工廠的 owner 或 co-manager 之一）。絕對不能被拿來當作讀取
  // 權限或 memory scope 的判斷依據：所有 runtime 讀寫一律只認 factoryId（見
  // server/ai/memory.ts）。user 帳號被刪除時這裡只是 set null，不影響這筆
  // 企業記憶本身是否存在——記憶屬於工廠，不屬於任何特定使用者。
  lastActorUserId: int("lastActorUserId").references(() => users.id, { onDelete: "set null" }),
  // 極短摘要，電報式短句，是「目前最新狀態」不是歷史日誌；沒有取得任何有
  // 價值資訊時，固定寫入「本次未提供可形成企業判斷的關鍵資訊。」，不能留
  // 空——區分「聊過但從來沒有取得過有效資訊」跟「從來沒聊過」（memory 這筆
  // row 完全不存在）。
  summaryText: varchar("summaryText", { length: 500 }).notNull(),
  // 這個欄位描述的是「summaryText 本身有沒有實質內容」，一旦曾經合併進任何
  // 真正的企業資訊就會是 true，即使最近一次互動沒有新增內容也不會變回
  // false（那件事由 lastInteractionHadMeaningfulInfo 另外描述）。
  hasMeaningfulBusinessInfo: boolean("hasMeaningfulBusinessInfo").notNull().default(false),
  // 這兩個欄位描述的是「最近一次互動」本身，跟上面 summaryText／
  // hasMeaningfulBusinessInfo（長期累積狀態）是兩件獨立的事：即使最近一次
  // 互動完全沒有新資訊（lastInteractionHadMeaningfulInfo=false），
  // summaryText 仍然保留更早以前真正重要的企業記憶，不會被清空。
  lastInteractionAt: timestamp("lastInteractionAt").defaultNow().notNull(),
  lastInteractionHadMeaningfulInfo: boolean("lastInteractionHadMeaningfulInfo").notNull().default(false),
  // 純資訊性欄位，最後一次更新這筆記憶的 conversation id；那筆 conversation
  // 摘要成功後會被刪除，所以這裡故意不建 FK constraint（一定很快就會變成
  // 指向不存在的 row，只是留個歷史線索，不做參照完整性）。
  sourceConversationId: int("sourceConversationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // 一間工廠一筆——每次收尾都是 upsert（merge 後寫入合併結果），不是新增
  // 一筆新記錄，也不是無條件覆寫。
  factoryIdUq: uniqueIndex("aem_factory_id_uq").on(t.factoryId),
}));

export type AiEnterpriseMemory = typeof aiEnterpriseMemories.$inferSelect;
export type InsertAiEnterpriseMemory = typeof aiEnterpriseMemories.$inferInsert;

// ===== Phase 11.2：Enterprise Memory 歷史資料隔離區 =====
// 從 user-scoped 遷移到 factory-scoped 時，無法安全歸屬的舊資料（factoryId
// 本來就是 null、或該 user 現在已經沒有 approved affiliation、或跟目前
// affiliation 不符——見 server/jobs/reconcileEnterpriseMemoryFactoryScope.ts
// 的分類邏輯）不會被猜測性地掛到任何工廠，而是搬進這張表保存原始內容供稽核
// ／未來人工判斷，不參與任何 runtime 讀寫。這不是最終治理方案的定案型態，
// production 上線前需要正式決定這些資料的最終處置。
export const aiEnterpriseMemoriesLegacyQuarantine = mysqlTable("aiEnterpriseMemoriesLegacyQuarantine", {
  id: int("id").autoincrement().primaryKey(),
  originalId: int("originalId").notNull(),
  userId: int("userId").notNull(),
  factoryId: int("factoryId"),
  summaryText: varchar("summaryText", { length: 500 }).notNull(),
  hasMeaningfulBusinessInfo: boolean("hasMeaningfulBusinessInfo").notNull().default(false),
  lastInteractionAt: timestamp("lastInteractionAt").notNull(),
  lastInteractionHadMeaningfulInfo: boolean("lastInteractionHadMeaningfulInfo").notNull().default(false),
  sourceConversationId: int("sourceConversationId"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  quarantineReason: varchar("quarantineReason", { length: 60 }).notNull(),
  quarantinedAt: timestamp("quarantinedAt").defaultNow().notNull(),
}, (t) => ({
  userIdIdx: index("aemlq_user_id_idx").on(t.userId),
  originalIdIdx: index("aemlq_original_id_idx").on(t.originalId),
}));

export type AiEnterpriseMemoryLegacyQuarantine = typeof aiEnterpriseMemoriesLegacyQuarantine.$inferSelect;

// ===== OXM AI Handoff Context（Phase 4：AI 對話 → 既有真人服務表單）=====
// 使用者在 AI 對話裡點【幫你送出詢問】時，server 才建立這筆短效 snapshot
// （不是 AI 一判斷出服務就自動建立，見 server/routers.ts 的 ai.createHandoff
// 註解）——把「這次對話中使用者明確確認過的資料」凍結成一份獨立快照，交給
// 既有表單（EnterpriseUpgradeApply.tsx 等）在使用者抵達時預填。
//
// 這筆資料必須在建立當下就完整 snapshot 好 prefillData／handoffSummary，不能
// 依賴「表單開啟時再回頭讀 aiMessages」——因為 conversation 隨時可能被
// Phase 3 的 lifecycle 收尾（摘要成功後逐字內容會被刪除），handoff context
// 必須能在原始對話已經不存在之後，仍然獨立支援表單預填。
export const aiHandoffContexts = mysqlTable("aiHandoffContexts", {
  id: int("id").autoincrement().primaryKey(),
  // 外部（URL query string／表單頁）一律用這個不可猜測的隨機字串引用，不直接
  // 曝露自增 id——即使擁有權檢查（userId 比對）已經是主要防線，token 是額外
  // 一層 defense-in-depth，避免自增 id 被列舉嘗試。
  token: varchar("token", { length: 64 }).notNull(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "set null" }),
  // gov_subsidy / erp / certification / short_video / finance（見
  // shared/ai/handoffServices.ts HANDOFF_ELIGIBLE_SERVICE_KEYS）。
  serviceKey: varchar("serviceKey", { length: 50 }).notNull(),
  // 只包含「這次對話中已經存在於 ConversationState.confirmedFacts、且被
  // service-specific field spec 白名單驗證通過」的欄位（見
  // server/ai/handoffPrefill.ts 的 buildHandoffPrefillFromConfirmedFacts），
  // key 對應目標表單的欄位名稱，value 已經是表單期待的型別（enum
  // code／boolean／number），不是自然語言，也絕對不是重新讀對話逐字稿猜出來的。
  prefillDataJson: json("prefillDataJson").$type<Record<string, unknown>>().notNull(),
  // prefillDataJson 裡每個 key 對應的最小 provenance：這個欄位是從哪一個
  // confirmedFacts key 來的（目前的 deterministic mapping 設計下，
  // sourceFact 恆等於欄位本身的 key，因為完全是同名同型別直接比對，沒有
  // 語意轉換這一步）——保留這個結構是為了讓「這個值不是憑空來的」這件事
  // 可以在 server 端被追溯，不是只有一個值卻不知道從哪裡來。
  confirmedFieldsJson: json("confirmedFieldsJson").$type<Record<string, { sourceFact: string }>>().notNull(),
  // 極短、只描述這次 handoff 真正需求的摘要，Phase 4 只先 snapshot，不接
  // 顧問中心顯示、不做正式 AI 初判 UI（那是 Phase 5 的事，見對話中「二十八」）。
  handoffSummary: varchar("handoffSummary", { length: 500 }).notNull(),
  // 純資訊性欄位，來源 conversation 的 id；那筆 conversation 可能在這之後就
  // 被收尾刪除，所以不建 FK constraint（同 aiEnterpriseMemories.sourceConversationId
  // 的理由）。
  sourceConversationId: int("sourceConversationId"),
  // 短效：預設 45 分鐘（30 分鐘～1 小時建議區間的中間值），不是長期 memory；
  // 過期後不得再用來預填，使用者需要從 AI 重新發起一次 handoff。
  expiresAt: timestamp("expiresAt").notNull(),
  // Blocking Modal「好，繼續填寫」按下的時間——用來判斷 refresh 時要不要
  // 重新顯示 Modal：尚未 acknowledge 就 refresh，同一筆有效 handoff 可以再顯示
  // 一次；已經 acknowledge 過就不用每次 refresh 都再煩使用者一次。
  acknowledgedAt: timestamp("acknowledgedAt"),
  // 可靠性修正（Handoff submission linkage）後的語意：consumedAt 代表「這個
  // AI Handoff 已經成功用來提交正式案件」，不是「assessment pending row 建立
  // 成功」——AI 初判是否成功是後續獨立流程，不得反過來影響這裡。標記後不會
  // 被物理刪除（保留供 Phase 5 建 AI 初判參考／recovery 使用），只受
  // expiresAt／本地 cleanup job 影響。
  consumedAt: timestamp("consumedAt"),
  // 正式案件成立當下由 server 寫入，跟 serviceKey 一起構成 polymorphic case
  // reference（五個服務案件表各自獨立，故意不建 FK，同 aiCaseAssessments.caseId
  // 的理由）。這是「這個 handoff 最後產生的是哪一筆正式案件」唯一 durable 記錄
  // ——即使 assessment pending row 建立完全失敗，這裡仍然保留，讓 recovery job
  // 可以之後補建 assessment（見對話中「二、Handoff 必須保存正式案件 linkage」）。
  submittedCaseId: int("submittedCaseId"),
  submittedAt: timestamp("submittedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  tokenUq: uniqueIndex("ahc_token_uq").on(t.token),
  userIdIdx: index("ahc_user_id_idx").on(t.userId),
  submittedCaseIdx: index("ahc_submitted_case_idx").on(t.serviceKey, t.submittedCaseId),
}));

export type AiHandoffContext = typeof aiHandoffContexts.$inferSelect;
export type InsertAiHandoffContext = typeof aiHandoffContexts.$inferInsert;

// ===== OXM AI Phase 5：AI 導件案件的 AI 初判（Case Assessment）=====
// 五個服務案件表（upgradeApplications／erpCases／certificationCases／
// shortVideoCases／financeApplications）各自獨立、狀態機不同，刻意不在每張
// 表各自加一包 AI assessment 欄位——改用單一共用表，serviceKey + caseId 做
// polymorphic reference（沿用 aiHandoffContexts.sourceConversationId 同一種
// 「跨表引用故意不建 FK」慣例，因為 caseId 對應的實際表在五個服務間不同，
// 建一個指向錯誤表的 FK 比不建 FK 更危險）。見對話中「六、建議共用 AI Case
// Assessment table」。
export const aiCaseAssessments = mysqlTable("aiCaseAssessments", {
  id: int("id").autoincrement().primaryKey(),
  // 送出正式申請表單的使用者，純稽核用途，不是權限判斷依據（權限一律沿用
  // 原案件本身的顧問／admin 權限查詢，見對話中「二十二、權限」）。
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "set null" }),
  // gov_subsidy / erp / certification / short_video / finance（見
  // shared/ai/handoffServices.ts HandoffEligibleServiceKey）。finance 本輪
  // 不會實際產生任何 row（表單無業務欄位，見對話中「三十一」呼應 Phase 4
  // 的既有結論），欄位型別仍涵蓋五個值以求完整。
  serviceKey: varchar("serviceKey", { length: 50 }).notNull(),
  // 對應服務自己案件表的主鍵（upgradeApplications.id／erpCases.id／...），
  // 不同服務各自獨立編號，因此永遠要跟 serviceKey 一起解讀，單獨看
  // caseId 沒有意義。
  caseId: int("caseId").notNull(),
  // 來源 handoff context 的 id，供追溯；那筆 context 可能之後被 cleanup job
  // 清除，因此 nullable + onDelete set null，不建立會被清除的強依賴。
  handoffContextId: int("handoffContextId").references(() => aiHandoffContexts.id, { onDelete: "set null" }),
  status: mysqlEnum("status", ["pending", "completed", "failed"]).notNull().default("pending"),
  // 服務專屬結構：gov_subsidy 是固定 8 欄物件，其餘四個服務是 { summary: string }
  // （見 server/ai/caseAssessment.ts 的服務別 type），刻意不用同一套 universal
  // template（見對話中「七、不要做一套 Universal Assessment Template」）。
  assessmentJson: json("assessmentJson").$type<Record<string, unknown>>(),
  // assessmentJson 的純文字攤平版本（deterministic 組出來，不是第二次 LLM
  // 輸出），方便顧問中心或未來通知類功能不需要各自知道五種 JSON 形狀。
  assessmentText: text("assessmentText"),
  retryCount: int("retryCount").notNull().default(0),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  // 同一 service + case 最多只有一份正式 assessment（見對話中「二十六、不要
  // 因重試造成重複 assessment」）：retry 一律 UPDATE 既有這筆，不會 INSERT
  // 新 row。
  serviceCaseUq: uniqueIndex("aica_service_case_uq").on(t.serviceKey, t.caseId),
  statusIdx: index("aica_status_idx").on(t.status),
  handoffContextIdx: index("aica_handoff_context_idx").on(t.handoffContextId),
}));

export type AiCaseAssessment = typeof aiCaseAssessments.$inferSelect;
export type InsertAiCaseAssessment = typeof aiCaseAssessments.$inferInsert;

// ===== OXM AI Phase 6A.1：Factory Search 人工協尋（不是顧問 Handoff）=====
// 找工廠是 Hard Filter（region/mainIndustry）決定候選集合、AI Ranking
// Signals 只決定排序（見 server/ai/factorySearchAction.ts）——本表記錄的是
// 「科技搜尋沒有真正找到使用者要的東西」時，OXM 承接的人工協尋需求快照。
// 刻意獨立於 aiHandoffContexts／aiCaseAssessments 之外：不是顧問流程，不經
// 過任何服務表單，只是「使用者找工廠 → 系統誠實承認搜尋能力有極限 → 交給
// 人工」。狀態機沿用 aiHandoffContexts.consumedAt 那種「nullable timestamp
// 當 CAS 鎖」的既有慣例（見 server/ai/handoffContextService.ts
// claimHandoffForSubmission）：notificationClaimedAt 是 notify 的原子鎖，
// cancelledAt／notifiedAt 是終止狀態的時間戳，兩者互斥。
export const aiFactorySearchRequests = mysqlTable("aiFactorySearchRequests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "set null" }),
  // 同一 conversation 最多一筆 active（pending）request（見對話中「十」）：
  // 查詢路徑用 conversationId，不建 partial unique index（MySQL 不支援條件式
  // unique），改由 server/ai/factorySearchRequestService.ts 的應用層邏輯保證
  // 「找到既有 pending 就更新，沒有才新增」。故意不建 FK：這筆 request 快照
  // 完成後要能獨立於 conversation 存在（conversation 收尾成功後逐字內容會被
  // 刪除，見 aiConversations 的既有慣例，跟 sourceConversationId 同一種
  // 「跨表引用故意不建 FK」設計）。
  conversationId: int("conversationId"),
  status: mysqlEnum("status", ["pending", "cancelled", "notifying", "notified", "notification_failed"])
    .notNull().default("pending"),
  // Hard Filters（region/mainIndustry）快照，只用來讓 Admin 看得懂需求範圍，
  // 不是給程式重新查詢用。
  hardFiltersJson: json("hardFiltersJson").$type<{ mainIndustries: string[]; regions: string[] }>().notNull(),
  // Ranking Signals 全量快照（供 Admin 參考）。
  rankingSignalsJson: json("rankingSignalsJson").$type<string[]>().notNull(),
  // Core Capabilities：本輪 V1 直接等於 rankingSignals（見 server/ai/
  // factorySearchRequestService.ts 的說明，不新增第二次 LLM 抽取），獨立成
  // 一個欄位是為了未來如果要跟 rankingSignals 分開演化時不必再改 schema。
  coreCapabilitiesJson: json("coreCapabilitiesJson").$type<string[]>().notNull(),
  // Deterministic 組出的人類可讀摘要（不是 raw conversation），例如「尋找
  // 台中金屬加工廠，核心需求為 CNC／五軸加工；平台目前可明確確認 1 家，
  // 使用者希望至少 3 家。」
  requestSummary: varchar("requestSummary", { length: 500 }).notNull(),
  // Hard Filter 候選集合筆數（不是「AI 覺得相關」的數量）。
  candidateCount: int("candidateCount").notNull().default(0),
  // 候選集合中，公開資料明確符合「全部」coreCapabilities 的工廠數——用來判斷
  // Trigger B（核心能力 direct evidence 缺口）與 Trigger C（使用者指定數量
  // 不足），見 factorySearchRequestService.ts。
  directCapabilityMatchCount: int("directCapabilityMatchCount").notNull().default(0),
  // 使用者「主動」明確提出的需求家數（見 Phase 6A.1 補充規格「一」：AI 不得
  // 主動詢問），null 代表使用者從未指定過。
  requestedMatchCount: int("requestedMatchCount"),
  notifiedAt: timestamp("notifiedAt"),
  cancelledAt: timestamp("cancelledAt"),
  // notify 的原子鎖（CAS：UPDATE ... WHERE status='pending'/'notification_failed'），
  // 沿用 aiHandoffContexts.consumedAt 的「nullable timestamp 當鎖」設計。
  notificationClaimedAt: timestamp("notificationClaimedAt"),
  notificationRetryCount: int("notificationRetryCount").notNull().default(0),
  lastNotificationError: text("lastNotificationError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdIdx: index("afsr_user_id_idx").on(t.userId),
  conversationIdIdx: index("afsr_conversation_id_idx").on(t.conversationId),
  statusIdx: index("afsr_status_idx").on(t.status),
}));

export type AiFactorySearchRequest = typeof aiFactorySearchRequests.$inferSelect;
export type InsertAiFactorySearchRequest = typeof aiFactorySearchRequests.$inferInsert;

// ===== Phase 8.1：OXM AI Entitlement / 每日額度 / Usage Logging =====
//
// Quota 主體是 factory（同一間工廠的 owner／co-manager 共用同一份每日
// 額度），不是 user——見 server/ai/entitlement.ts／server/ai/aiQuota.ts 的
// 說明。三張表分工：
// - factoryAiDailyUsage：quota enforcement 唯一權威（atomic counter）。
// - aiUsageTurns：使用者可見的「一次 turn」audit log，同時是 retry 去重的
//   依據（factoryId + clientTurnId 唯一）。
// - aiModelCalls：turn 內部實際發生的每一次 LLM provider 呼叫，供成本／
//   用量分析，跟「這一輪扣不扣使用者額度」完全無關。
// 三張表都刻意不存完整 prompt／回覆內容或任何 PII snapshot。

/** Server-authoritative 每日額度上限，唯一來源見 shared/ai/aiQuotaConfig.ts；這裡不重複硬寫數字。 */
export const factoryAiDailyUsage = mysqlTable("factoryAiDailyUsage", {
  id: int("id").autoincrement().primaryKey(),
  factoryId: int("factoryId").notNull().references(() => factories.id, { onDelete: "cascade" }),
  // Asia/Taipei 的 YYYY-MM-DD，見 server/ai/taipeiTime.ts::getTaipeiQuotaDate()——
  // 刻意不用 server UTC date 或 DB TIMESTAMP，避免額度重置時間跟台灣午夜對不上。
  quotaDate: varchar("quotaDate", { length: 10 }).notNull(),
  usedTurns: int("usedTurns").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  factoryDateUq: uniqueIndex("fadu_factory_date_uq").on(t.factoryId, t.quotaDate),
}));

export type FactoryAiDailyUsage = typeof factoryAiDailyUsage.$inferSelect;
export type InsertFactoryAiDailyUsage = typeof factoryAiDailyUsage.$inferInsert;

export const aiUsageTurns = mysqlTable("aiUsageTurns", {
  id: int("id").autoincrement().primaryKey(),
  // Quota owner——這一輪算誰的每日額度。Nullable：admin 完全跳過 entitlement
  // 門檻，即使本身不是任何工廠的 owner／co-manager 也能使用 AI（見對話中
  // 使用者對「Admin 無工廠語境」的最終決議＋server/ai/entitlement.ts），此時
  // 沒有工廠可歸屬，quotaCharged 恆為 false。注意：MySQL 的 unique index 對
  // NULL 值不視為互斥，所以 factoryId 為 null 時，(factoryId, clientTurnId)
  // 唯一索引不會擋下同一 admin 的重複 clientTurnId——這種情況下 retry 去重
  // 完全依賴前端 clientTurnId 本身的唯一性，不影響任何工廠的 quota 正確性
  // （唯一有風險的只有 admin 自己的診斷用 audit row 可能重複，不是 P0 顧慮）。
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "cascade" }),
  // 真正操作這一輪的登入帳號（owner 或 co-manager 之一，或 admin）。
  actorUserId: int("actorUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: int("conversationId").references(() => aiConversations.id, { onDelete: "set null" }),
  // Retry 去重鍵：同一個 user-visible turn 的第一次送出與後續 retry 共用同一個
  // clientTurnId（見 client/src/contexts/aiChatSendController.ts）。
  // (factoryId, clientTurnId) 唯一——server-authoritative，不依賴前端按鈕行為。
  clientTurnId: varchar("clientTurnId", { length: 64 }).notNull(),
  // Asia/Taipei 的 YYYY-MM-DD，跟 factoryAiDailyUsage.quotaDate 同一份定義。
  quotaDate: varchar("quotaDate", { length: 10 }).notNull(),
  // 這一輪最終判斷出的 primaryService／resourceTarget，只在 turn 完成後才會
  // 填入（server 端已知的分類結果，不是完整逐字內容）。
  intent: varchar("intent", { length: 40 }),
  resourceTarget: varchar("resourceTarget", { length: 40 }),
  status: mysqlEnum("status", ["started", "completed", "failed"]).notNull().default("started"),
  // 這一輪是否真的扣了 factoryAiDailyUsage 的每日額度——admin bypass 或
  // 尚未進入任何 model call 前就被擋下的情況都是 false（見對話中「九」）。
  quotaCharged: boolean("quotaCharged").notNull().default(false),
  // 同一個 clientTurnId 被 retry 的次數（含第一次），只影響這個欄位，不影響
  // quotaCharged／usedTurns（見對話中「十：Retry 不重複扣quota，但usage仍記」）。
  attemptCount: int("attemptCount").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => ({
  // Retry 去重＋quota enforcement 的唯一權威索引：同一間工廠、同一個
  // clientTurnId 只會有一筆 row。
  factoryClientTurnUq: uniqueIndex("aiut_factory_client_turn_uq").on(t.factoryId, t.clientTurnId),
  factoryQuotaDateIdx: index("aiut_factory_quota_date_idx").on(t.factoryId, t.quotaDate),
  actorIdx: index("aiut_actor_idx").on(t.actorUserId),
}));

export type AiUsageTurn = typeof aiUsageTurns.$inferSelect;
export type InsertAiUsageTurn = typeof aiUsageTurns.$inferInsert;

export const aiModelCalls = mysqlTable("aiModelCalls", {
  id: int("id").autoincrement().primaryKey(),
  // Case Assessment／Memory finalize／merge 這類背景流程不屬於任何使用者可見
  // turn，此時為 null（見對話中「三十五、三十六」：這些流程仍記 model usage，
  // 但不扣每日額度、也不對應一筆 aiUsageTurns）。
  turnId: int("turnId").references(() => aiUsageTurns.id, { onDelete: "set null" }),
  // 冗餘欄位，方便不 join aiUsageTurns 就能依工廠做用量分析；背景流程有已知
  // factoryId 時填入，完全未知時為 null。
  factoryId: int("factoryId").references(() => factories.id, { onDelete: "set null" }),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  // diagnosis／routing／factory_semantic／planner／composer／case_assessment／
  // memory_summary／memory_merge／casual_pause_gate／other，見
  // server/ai/aiCallContext.ts 的 AiModelCallLayer。
  layer: varchar("layer", { length: 40 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  inputTokens: int("inputTokens"),
  outputTokens: int("outputTokens"),
  totalTokens: int("totalTokens"),
  cachedInputTokens: int("cachedInputTokens"),
  reasoningTokens: int("reasoningTokens"),
  latencyMs: int("latencyMs").notNull(),
  success: boolean("success").notNull(),
  errorCategory: varchar("errorCategory", { length: 60 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  turnIdx: index("aimc_turn_idx").on(t.turnId),
  factoryIdx: index("aimc_factory_idx").on(t.factoryId),
  createdAtIdx: index("aimc_created_at_idx").on(t.createdAt),
}));

export type AiModelCall = typeof aiModelCalls.$inferSelect;
export type InsertAiModelCall = typeof aiModelCalls.$inferInsert;
