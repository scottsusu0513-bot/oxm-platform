import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, decimal, json } from "drizzle-orm/mysql-core";

// ===== 使用者表 =====
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
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
  ownerId: int("ownerId").notNull(), // references users.id
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 50 }).notNull(),
  // ODM, OEM 以 JSON 陣列儲存，支援複選
  mfgModes: json("mfgModes").$type<string[]>().notNull(),
  region: varchar("region", { length: 20 }).notNull(),
  description: text("description"),
  capitalLevel: varchar("capitalLevel", { length: 30 }).notNull(),
  foundedYear: int("foundedYear"),
  ownerName: varchar("ownerName", { length: 100 }),
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
});

export type Review = typeof reviews.$inferSelect;

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
