# OXM 平台升級 - 第一階段：核心基礎設施

## A. 管理員白名單機制
- [ ] 新增環境變數：ADMIN_WHITELIST_OPEN_IDS, ADMIN_WHITELIST_EMAILS
- [ ] 在 env.ts 中新增白名單配置讀取
- [ ] 建立 isAdminUser() 函式判斷白名單
- [ ] 修改 adminProcedure 使用白名單檢查
- [ ] 修改 context.ts 計算 user.isAdmin
- [ ] 修改 User type 新增 isAdmin 欄位
- [ ] 修改 OAuth callback 邏輯（可選）

## B. 資料庫 Schema 升級
- [ ] 修改 factories.status enum 支持 draft
- [ ] 新增 factories 欄位：submittedAt, reviewedAt, reviewedBy, reviewNote, rejectReason, submitCount
- [ ] 建立 factory_review_logs 表
- [ ] 生成 migration SQL
- [ ] 執行 migration

## C. 工廠送審驗證 API
- [ ] 建立 validateFactoryReadyForReview() 函式
- [ ] 新增 factory.submitForReview API（完整版本）
- [ ] 新增 factory.rejectReview API
- [ ] 新增 factory.approveReview API
- [ ] 新增 factory.getReviewLogs API

## D. 管理員後台升級
- [ ] 新增 admin.getPendingFactories API
- [ ] 新增 admin.getApprovedFactories API
- [ ] 新增 admin.getRejectedFactories API
- [ ] 新增 admin.getFactoryDetail API（含 review logs）
- [ ] 升級 AdminDashboard UI（三個分頁）
- [ ] 新增審核備註和拒絕原因輸入框

## E. 前端權限隱藏
- [ ] 修改 Navbar 隱藏非管理員的 admin 按鈕
- [ ] 修改 App.tsx 路由守衛 /admin
- [ ] 修改 AdminDashboard 權限檢查

## F. 測試與驗收
- [ ] 單元測試：白名單判斷
- [ ] 單元測試：工廠送審驗證
- [ ] 集成測試：審核流程
- [ ] 手動測試：管理員白名單
- [ ] 手動測試：工廠送審流程
