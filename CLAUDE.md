# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server on port 3000 (frontend + backend)
pnpm build        # Build client (Vite) + server (ESBuild)
pnpm start        # Run production build
pnpm check        # TypeScript type checking
pnpm format       # Format code with Prettier
pnpm test         # Run tests (Vitest)
pnpm db:push      # Generate & run database migrations
```

Run a single test file:
```bash
pnpm vitest run server/factory.test.ts
```

## Architecture

This is a full-stack B2B manufacturing marketplace (OXM) — connecting businesses with Taiwanese factories for ODM/OEM sourcing.

**Stack:** React 19 + TypeScript frontend, Express + tRPC 11 backend, MySQL via Drizzle ORM, Google OAuth, AWS S3, Anthropic Claude for semantic search, Resend for email.

### Directory Layout

```
client/src/         React frontend
  pages/            Route-level page components
  components/       Shared UI components (ui/ = Radix UI wrappers)
  hooks/            Custom hooks (useAuth, useComposition, etc.)
  lib/              tRPC client setup, utilities
  _core/            Auth context and app bootstrap

server/             Express + tRPC backend
  _core/            Infrastructure: server entry, tRPC context, OAuth routes,
                    security middleware, rate limiting, S3, email, Claude LLM
  routers.ts        Main tRPC app router (aggregates all sub-routers)
  db.ts             All database query functions (Drizzle ORM)
  semantic-search.ts Claude API integration for keyword enhancement

shared/             Types and constants shared between client and server
  types.ts          Re-exports Drizzle inferred types
  constants.ts      Industry categories, regions, capital level options
  const.ts          Cookie names, shared error messages

drizzle/
  schema.ts         All table definitions (source of truth for types)
```

### Request Flow

1. React component calls tRPC procedure via `trpc` client (`client/src/lib/trpc.ts`)
2. tRPC router in `server/routers.ts` handles the call, using middleware from `server/_core/trpc.ts`
3. Business logic queries the DB through `server/db.ts` using Drizzle ORM
4. Auth context (`server/_core/context.ts`) injects the current user from JWT cookie into every request

### Key Domain Concepts

- **Factory** — core entity with a status workflow: `draft → pending → approved / rejected`
- **Products** — factory offerings with pricing tiers and sample options
- **Conversations + Messages** — real-time chat between buyers and factory owners
- **Reviews** — 1–5 star ratings; factories can post one reply per review
- **Advertisements** — paid placements with regional targeting
- **Admin** — whitelist-based admin role; manages factories, users, reviews, and analytics

### Path Aliases

```
@/*        → client/src/*
@shared/*  → shared/*
```

### Environment Variables

Required in `.env`:
```
DATABASE_URL=mysql://root:password@localhost:3306/oxm
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ADMIN_WHITELIST_EMAILS=["email@example.com"]
ANTHROPIC_API_KEY=
RESEND_API_KEY=
FROM_EMAIL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=
```

## 專案交接文件

### 技術棧
- Frontend: React + TypeScript + Vite + Tailwind + shadcn/ui
- Backend: Node.js + Express + tRPC
- DB: MySQL 8.0 + Drizzle ORM
- Auth: Google OAuth
- 啟動：pnpm run dev / http://localhost:3000

### 已完成的 Bug 修復
- B1 管理員產品/對話列表空白
- B2 一般用戶看到工廠詢問Tab
- B3 搜尋結果沒有工廠照片
- B4 地址沒顯示 + 網址驗證
- B5 檢舉工廠功能
- 訊息傳送功能修復
- 同工廠只建一個對話
- 詢問產品預設文字
- 管理員對話紀錄可查看
- 搜尋條件從首頁繼承到搜尋頁

### 已完成的功能
- 功能1：工廠回覆評價
- 產業小分類系統：10 大產業各含 5-7 個小分類，工廠建檔/後台可複選，搜尋頁可篩選，工廠卡片/詳情頁顯示

### 今天完成的修改
- Home.tsx：頂部三個大按鈕改為「工廠/工作室/我都要」(state: businessType, value: "factory"/"studio"/"")
- Home.tsx：ODM/OEM 改為下拉選單，加入篩選區塊，與產業/地區/資本額並排（四欄grid）
- Home.tsx：地區、資本額、產業下拉加「不限」選項（value: ""）
- server/db.ts：searchFactories 加入 businessType 過濾
- server/routers.ts：factory.search 加入 businessType 參數；factory.update 加入 operationStatus 參數
- drizzle/schema.ts：factories 表加入 operationStatus（enum: normal/busy/full）和 certified（boolean）欄位
- drizzle/0016_operation_status_certified.sql：新建 migration，尚未執行

### 待完成功能（依優先序）

#### 🔴 高優先

**功能：地區、資本額複選篩選**
- Home.tsx：地區、資本額下拉改為複選 UI（Popover + Checkbox 列表），可同時選多個
- Search.tsx：同上，地區、資本額改為複選，state 從 string 改為 string[]
- URL params：改為陣列格式（例如 ?region=新竹市&region=新竹縣）
- server/db.ts：searchFactories 的 region、capitalLevel 條件從 eq 改為 inArray，支援陣列查詢
- server/routers.ts：factory.search 的 region、capitalLevel 參數改為 z.array(z.string())

**功能2：近期瀏覽**
- FactoryDetail.tsx：工廠頁載入後寫入 localStorage（key: oxm_recent_viewed）
- 資料結構：[{ id, name, industry, region, businessType, avatarUrl, avgRating, reviewCount, viewedAt }]
- 最多存 20 筆，同一工廠重複瀏覽移到最前面
- MyFavorites.tsx：加第二個分頁「最近瀏覽」，從 localStorage 讀取顯示，支援單筆移除和清空全部

**功能3：工廠營業狀態**
- 先執行 migration：drizzle/0016_operation_status_certified.sql
- FactoryDashboard.tsx：加 operationStatus state，handleSave 帶入，UI 加三個按鈕（🟢接單中/🟡產線繁忙/🔴產線滿載）
- Search.tsx：工廠卡片名稱旁顯示狀態色點
- FactoryDetail.tsx：工廠名稱附近顯示狀態文字

#### 🟡 中優先

**功能4：廣告管理員 UI**
- 管理員後台可新增/編輯/啟停廣告，綁定工廠
- 設定開始/結束時間、曝光位置
- 兩種廣告形式：搜尋精選跑馬燈、相似工廠推薦優先

**功能5：工廠認證標章**
- DB 欄位已預留（certified boolean），migration 尚未執行
- 執行 migration 後，搜尋卡片和工廠詳情頁加條件顯示「✓ 認證工廠」badge

**功能：會員中心**

頁面路由：`/member`

Navbar 已登入時，點擊右上角會員名稱彈出下拉選單，包含「會員中心」入口連結。

包含以下分頁：

1. **我的資料**
   - 顯示：頭像、名稱、Email（Google 綁定顯示）、手機、註冊時間
   - 可編輯：名稱、手機
   - 手機驗證：UI 和欄位先做好（users 表加 `phone` varchar、`phoneVerified` boolean）
   - 驗證邏輯預留介面，上線前串接簡訊 API

2. **我的收藏**
   - 已完成，直接整合導向現有 `/favorites` 頁面

3. **近期瀏覽**
   - 已完成，直接整合導向現有近期瀏覽頁面（localStorage）

4. **我的評價**
   - 查看自己留過的所有評價
   - 可編輯、可刪除
   - 顯示欄位：工廠名稱、評分、評價內容、留言日期、工廠回覆、編輯/刪除按鈕
   - 需新增 tRPC `review.myReviews`、`review.update`、`review.delete` 端點

5. **我的詢價/對話紀錄**
   - 已完成，直接整合導向現有 `/messages` 頁面

6. **我的檢舉**
   - 顯示自己送出的所有檢舉列表
   - 欄位：檢舉對象（工廠名稱）、檢舉原因、提交時間、處理狀態
   - 狀態流程：`已寄出 → 已收到 → 審查中 → 處理中 → 已處理`
   - 管理員後台可手動更新狀態，更新後自動寄 Email 通知使用者

7. **通知設定**
   - 使用者自行控制哪些事件寄 Email 通知
   - 通知選項：工廠回覆我的評價、詢價有新訊息、檢舉狀態更新、客服投訴狀態更新、平台公告
   - 設定存在 users 表的 `notificationSettings` JSON 欄位

8. **帳號安全**
   - 刪除帳號申請（軟刪除）
   - users 表加 `deletedAt` 欄位
   - 刪除後同 Google 帳號再登入顯示「此帳號已申請刪除，如需恢復請聯繫客服」
   - 保留對話和評價紀錄但切斷使用者關聯

9. **聯繫客服**
   - 表單欄位：問題類型（下拉）、主旨、詳細描述、附件（選填）
   - 問題類型選項：帳號問題、交易糾紛、檢舉申訴、功能建議、其他
   - 表單輸入區塊灰底顯示警告：「請勿惡意投訴或濫用客服資源，若經查證為惡意行為，平台將視情況進行警告、功能限制或永久停權處理。」
   - 送出後寄信給管理員客服信箱，並回覆使用者確認信
   - 後端新增 `supportTickets` 表：userId、type、subject、description、status、createdAt

**管理員後台新增「客服中心」頁面**
- 整合「使用者客服投訴」和「工廠檢舉」在同一頁面，分頁切換
- 客服投訴欄位：提交者、問題類型、主旨、內容、提交時間、處理狀態
- 工廠檢舉欄位：檢舉者、被檢舉工廠、原因、提交時間、處理狀態
- 管理員可手動更新狀態，更新後自動寄 Email 通知使用者
- 每筆案件可留處理備註（僅內部可見）

#### 🟢 低優先

**功能7：工廠活躍度（平均回覆時間）**
- 簡版三段式：< 2hr / < 24hr / unknown
- 顯示在工廠詳情頁和搜尋結果卡片

**功能8：相似工廠推薦**
- 工廠詳情頁底部顯示
- 排序：廣告優先 > 認證標章 > 評分
- 同產業 + 同地區的 approved 工廠

**功能10：工廠營業時間**
- 簡版：平日時段 + 假日時段 + 備註
- 加在 factories 表，詳情頁顯示

### 上線前還需要
- Cloudinary 圖片上傳（目前用 base64 暫代）
- Email 驗證（Resend API Key）
- Anthropic API Key（AI 語意搜尋，沒有 key 會 fallback 用原始關鍵字）
- WebSocket/SSE（選做，目前 polling）

### 上線後待辦
1. 工廠認證標章門檻制度
2. 通知中心
3. 誰來看過我（匿名統計版）
4. 首頁兩側廣告版位

### 注意事項
- Search.tsx 的 businessType 過濾已移到後端，前端不需要再 filter
- SelectItem 的 value 不能是空字串，「不限」選項要在 handleSearch 判斷過濾
- 管理員白名單用 ADMIN_WHITELIST_EMAILS 環境變數控制
- drizzle/0016_operation_status_certified.sql 尚未執行，上線前需要跑
- 產業小分類儲存在 factories.subIndustry（JSON 陣列），新增產業或小分類只需修改 shared/constants.ts 的 INDUSTRIES 陣列，DB、搜尋、前端三端無需額外改動
