# OXM 平台升級 - 第三階段：前端送審流程與審核歷史

## 任務清單

### 3.1 工廠管理頁面送審驗證
- [ ] 實現 validateFactoryForReview() 後端驗證函式
- [ ] 檢查必填欄位：名稱、產業、地區、簡介、資本額、成立年份、負責人、電話、郵箱、網站
- [ ] 檢查至少 1 個完整產品（名稱、價格、說明、圖片）
- [ ] 前端顯示缺失欄位列表
- [ ] 送審按鈕禁用邏輯
- [ ] 錯誤提示 UI

### 3.2 審核歷史頁面
- [ ] 新增 ReviewHistory.tsx 頁面
- [ ] 顯示所有送審/審核紀錄
- [ ] 顯示時間、狀態、備註、拒絕原因
- [ ] 支援重新送審按鈕（rejected 狀態）

### 3.3 工廠管理頁面升級
- [ ] 顯示當前審核狀態
- [ ] 顯示拒絕原因（if rejected）
- [ ] 顯示最後審核時間
- [ ] 「查看審核歷史」連結

### 3.4 送審後鎖定編輯
- [ ] pending 狀態下禁用編輯
- [ ] 後端 API 也要檢查狀態
- [ ] UI 顯示「審核中，暫時無法修改」

## 預期修改檔案
- server/db.ts - 新增驗證函式
- server/routers.ts - 新增驗證 API
- client/src/pages/FactoryDashboard.tsx - 升級送審流程
- client/src/pages/ReviewHistory.tsx - 新增審核歷史頁
- client/src/App.tsx - 新增路由

## 預期新增表格/欄位
- factory_review_logs（已在第二階段完成）
- factories 表新增欄位（已在第二階段完成）
