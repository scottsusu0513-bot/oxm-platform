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

## 前端／UX 長期規則（使用者指定，長期適用）

### 圖片顯示範圍規則
凡會員或管理員上傳、會顯示於平台的工廠相關圖片（包括但不限於：工廠頭貼／Logo、工廠封面、工廠圖片／相簿、商品圖片），上傳與編輯流程都必須顯示和實際前台一致的呈現範圍，並讓使用者調整位置與縮放。不得只依賴系統預設中央裁切。新增圖片功能應優先重用共用圖片顯示範圍元件（`shared/imageCrop.ts` 的純運算函式、`client/src/components/CroppedImage.tsx` 顯示元件、`client/src/components/ImageCropEditor.tsx` 編輯器），並確認桌機與手機呈現一致。消息封面、社群貼文／競標／投標報價等其他圖片類型尚未納入此規則涵蓋範圍，未來若要擴大適用範圍需另行確認。

**Why:** 2026-08-03 的任務明確要求「所有圖片都能選擇顯示範圍」，並強調「使用者完全沒看過呈現結果時，不得直接使用系統預設中央裁切」；同時發現既有工廠封面裁切採用「前端烘焙成固定像素、捨棄原圖」的架構，導致「已上傳圖片無法再次編輯顯示範圍」——因此改採「保留原圖＋只存位置/縮放中繼資料（zoom/posX/posY），前台用 CSS object-position＋transform 即時套用」的架構，確保編輯器預覽與前台實際顯示永遠一致（同一支 `imageCropToStyle()`），也支援真正的重新編輯。

**How to apply:** 新增任何圖片上傳功能時，先檢查目前是否已有裁切資料欄位／共用元件可以直接沿用，不要重新手刻一套拖曳/縮放邏輯。若該圖片在前台是完整原圖顯示（無裁切），仍須在上傳流程顯示實際呈現預覽。若同一張圖片在不同頁面／裝置使用不同長寬比（例如既有 `FactoryResultCard.tsx` 的自適應版面），需要先盤點是否能統一比例，或改用其他方案，不能讓編輯器選取的範圍跟前台顯示的範圍不一致。

### 動態文字溢位規則
所有會員、管理員或資料庫提供的動態文字，在設計元件時就必須考慮任意長度、無空格字串、網址及手機窄螢幕。任何文字不得橫向超出卡片或頁面。需要完整內容的欄位應讓容器高度自動增加；只有產品需求明確要求摘要時，才可限制字數或使用省略號。商品描述必須完整顯示，不得截斷。

**Why:** 2026-08-03 發現工廠公開頁的商品描述在手機版會橫向溢出頁面，根因是 flex 版面缺少 `min-w-0`（讓 flex item 無法縮小到內容 min-content 寬度以下）加上文字層缺少 `whitespace-pre-wrap break-words`（無空格長字串無法換行）；兩者缺一都無法真正修好，只加 `line-clamp` 或 `overflow-x-hidden` 只是掩蓋問題、不是修正溢位的根因。

**How to apply:** 新增任何顯示動態文字的元件時，檢查完整的 flex／grid 父層鏈是否都有 `min-w-0`（或 grid 對應的寬度限制），文字元素本身是否有 `break-words`／`overflow-wrap`／`word-break` 與（若需保留使用者換行）`whitespace-pre-wrap`。用真正可能出現的極端內容（超長無空格字串、網址）在手機寬度下實測，不是只看正常內容的顯示效果。

## 最高執行原則（使用者指定，長期適用）

### 1. TODO 啟動確認（由 Codex 負責，Claude 配合）
當使用者透過 Codex 交辦「TODO-編號」相關任務時，Codex 會先讀取專案既有／置頂的「建立專案代辦清單」任務、向使用者重述並取得明確確認，才會將任務整理成完整指令交給 Claude Code 執行。Claude Code 收到的指令即代表該 TODO 已經過使用者確認；除非指令本身有明顯歧義或與現有程式碼衝突，否則不需要再向使用者重複確認 TODO 內容本身。

### 2. Token 節省與持續作業（最高原則）
Token 是本專案能否長期持續工作的關鍵限制，視為最高原則之一。Claude Code 收到 Codex 或使用者提供的精確指令後，應盡量在一次執行中完成任務，避免重複的大範圍探索、全專案掃描、冗長輸出、重複測試與不必要的來回；只在真正必要時才進行額外的檔案搜尋。節省 token 不得犧牲正確性、安全性與必要的驗證（例如型別檢查、關鍵路徑測試仍必須執行）。

### 3. 最低詢問原則
當任務已確認且範圍明確時，應採取安全、最小、合理的假設直接完成任務，不需額外詢問使用者。只有遇到下列情況才需要停下來取得使用者核可：重大歧義或範圍擴張、與既有未提交修改有無法隔離的衝突、涉及 commit／push／PR／部署、正式資料庫 migration 或寫入操作、破壞性且不可逆的操作、涉及密碼／OTP／金鑰／付款資訊，或需要額外權限、超出目前授權範圍的重大事項。

### 4. 兩份專案記憶的分工
AGENTS.md 是 Codex 的專案記憶，CLAUDE.md 是 Claude Code 的專案記憶；兩邊維護的規則必須語意一致，不可互相矛盾。

### 5. 記憶檔與代辦清單永遠不得進入 Git
AGENTS.md、CLAUDE.md、任何 TODO／代辦清單，以及其他純本地協作規則檔案（或其修改），永遠不得被 stage、commit 或 push；即使這些檔案在當次任務中被新增或修改，此限制依然適用。Git push 永遠只能包含使用者當次明確要求、且與 OXM 網站／App 實際功能直接相關的程式碼、網站內容或必要資產。若這些本地記憶檔同時有未提交的修改，必須保留在工作樹中並從本次 staging／commit／push 範圍中排除，不得因此清理、還原或刪除。

以上五點為使用者指定的最高執行原則，長期適用，優先於本檔案中其他一般工作指示；除非使用者日後明確撤銷或修改，否則不得刪除或弱化。

## 圖片製作唯一特例（使用者指定，長期適用）
- Codex 原則上仍只做指令整理、監督與唯讀審查。
- 任務涉及圖片製作時，允許 Codex 直接建立、編輯與驗證圖片資產，包括點陣、向量／SVG、徽章、插圖與必要圖片輸出。
- 例外只限圖片資產；元件、HTML/CSS、程式邏輯、DB、路由、測試、部署、圖片整合程式仍由 Claude Code 執行，不得以圖片任務擴張。
- 暫存／輸出操作只能服務圖片資產，不得改動其他內容。
- 記憶檔永不得 stage、commit、push。

## Codex／Claude Code 協作品質協議（使用者指定，長期適用，語意同全域設定）

此協議自 2026-07-24 起適用，除非使用者日後明確撤銷或變更。內容與使用者全域記憶 `~/.codex/AGENTS.md` 語意一致，本專案不重複維護獨立版本的細節規則，只重申摘要並指向中央紀錄。Claude Code 內建敏感目錄保護禁止 agent 自動寫入 `~/.claude/CLAUDE.md`，因此 Claude Code 在本專案是透過本檔案（本專案的 `CLAUDE.md`）載入本協議，而不是透過全域 `~/.claude/CLAUDE.md`；其他沒有專屬 CLAUDE.md 的專案，由 Codex 在每次正式 prompt 中帶入精簡版規則。

### A. 被呼叫前的零模型 token 預檢
Codex 每次正式呼叫 Claude 前只先檢查 CLI 登入狀態（`claude auth status`），不先送測試 prompt；登入失效只修一次。若本機環境已知 sandbox 會讓 Claude 的檔案工具／子程序出現 `spawn EPERM`，應使用已核准的正確執行環境；Claude 遇到此類環境錯誤應立即回報根因，不反覆重試相同失敗環境。任何記憶或 log 都不得寫入 access token、OAuth code、cookie、密碼等秘密。

### B. Prompt 傳輸與完整性
正式 prompt 以 UTF-8 檔案為唯一來源傳入；若懷疑傳輸截斷或編碼異常，主動回報而非默默處理殘缺內容。新任務預設 fresh session，只有確實需要保留上下文才 resume。收到連續編號的驗收清單時，須逐項以相同編號回報「完成／阻塞／未做」；審查補件聚焦單一主題回覆，不用籠統摘要取代逐項清單。

### C. 真實完成與獨立驗證
不得只憑自己的計畫或摘要宣稱完成，須以實際檔案異動、命令輸出、逐項清單回報，讓 Codex／使用者能唯讀驗證；回報的測試數、檔案數、服務狀態需與實際輸出一致。`pnpm dev`／localhost 等背景服務不得只憑啟動指令回報「已啟動」，需附上可供外部獨立確認的依據；依附短命 CLI 行程啟動的服務，行程結束後也會消失，需要持續存在時必須用不依附本次 CLI 行程的方式啟動。一般背景執行／`Start-Process`（含 Claude 內部看到的 port／HTTP 檢查）仍可能隸屬 Claude job／process tree、隨行程結束被回收，不得作為持久成功的依據；需要持續存在的服務必須用獨立於 Claude process tree 的機制啟動（例如目前使用者的受控暫時 Scheduled Task），且必須等 Claude 完全退出後，由 Codex 獨立驗證 port＋HTTP 才能認定為持久成功。收到「漏項」回饋時只需精準補齊差異，不需重跑或重述整個原任務。

### D. 改善紀錄機制（中央 log）
中央改善紀錄固定位於 `C:\Users\scott\.codex\CODEX_CLAUDE_COLLABORATION_LOG.md`（使用者主目錄下的 `.codex` 資料夾，非本專案一部分；`~/.claude` 受 Claude Code 內建敏感目錄保護、agent 無法安全自動寫入，故不放在 `.claude` 之下），永遠不得進入本專案或任何專案的 Git。每次發現新的協作問題或需調整規則，由當次被使用者授權修改記憶的 Claude Code 在該檔追加一筆：日期、任務／情境、症狀、根因、當次處置、永久預防規則、驗證方式；重複問題只更新既有紀錄的復發次數，不複製長文；紀錄不得含使用者資料、秘密、完整 prompt 或大段程式碼；例行成功互動不寫 log。紀錄嚴禁把推論或計畫寫成已完成；每筆必須辨識行為主體是 Codex 或 Claude、使用精確的實際命令名稱，並明確標示完成／未完成狀態，不得為了紀錄完整而補寫未經證據佐證的推論；Codex 在 Claude 完成新紀錄後，須以唯讀方式核對內容與實際狀態一致。
