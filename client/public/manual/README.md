# OXM 使用手冊圖片資料夾

本目錄用於存放「使用手冊」（`/manual`）頁面所有教學步驟的操作截圖。

---

## 目錄層級

```
client/public/manual/
  <categoryId>/          ← 分類（對應 manual.ts 的 categoryId）
    <articleId>/         ← 教學文章（對應 manual.ts 的 article id）
      step-01/           ← 第 1 步驟
        original.png     ← 原始截圖
        annotated.png    ← 標註後截圖（加箭頭、框線、步驟圓圈）
      step-02/
      step-03/
      step-04/
```

---

## 分類資料夾（categoryId）

| 資料夾名稱 | 對應分類 |
|-----------|---------|
| `getting-started` | 新手開始 |
| `find-factory` | 我要找工廠 |
| `list-factory` | 我要刊登工廠／工作室 |
| `manage-store` | 整理我的商場 |
| `messaging` | 訊息、詢價與 PDF |
| `collaboration` | 合作確認單 |

---

## 文章資料夾（articleId）

### getting-started
- `register` — 如何註冊帳號
- `login` — 如何登入 OXM
- `no-verification-email` — 收不到驗證信怎麼辦

### find-factory
- `search-factory` — 如何搜尋工廠
- `use-filters` — 如何使用篩選條件
- `save-favorite` — 如何收藏工廠
- `bulk-inquiry` — 如何一次詢問多間工廠

### list-factory
- `register-factory` — 如何免費刊登工廠／工作室
- `fill-basic-info` — 如何填寫基本資料
- `select-industry` — 如何選擇產業分類
- `edit-after-approval` — 審核後如何修改資料

### manage-store
- `upload-photos` — 如何上傳工廠圖片
- `add-product` — 如何新增產品或服務
- `edit-product` — 如何修改產品資料
- `improve-profile` — 如何完善工廠頁

### messaging
- `send-message` — 如何傳送訊息
- `reply-buyer` — 如何回覆買家
- `send-pdf` — 如何傳送 PDF
- `no-message-notification` — 收不到訊息通知怎麼辦

### collaboration
- `create-order` — 如何建立合作確認單
- `confirm-order` — 如何確認合作內容
- `update-order-progress` — 如何更新合作進度
- `complete-order` — 如何完成合作
- `cancel-order` — 如何申請取消合作

---

## 圖片命名規則

| 檔名 | 用途 |
|------|------|
| `original.png` | 原始操作截圖，未加任何標註 |
| `annotated.png` | 標註後圖片：可包含箭頭、紅框、圓圈、步驟編號 |

- 兩個版本都提供最佳，只有一個也可以
- 建議格式：**PNG** 或 **WebP**（不使用 JPG，避免截圖文字模糊）
- 不要使用中文、空白或特殊符號作為資料夾或檔案名稱

---

## manual.ts 路徑寫法範例

**實體檔案位置：**
```
client/public/manual/getting-started/register/step-01/annotated.png
```

**manual.ts 中 image 欄位的寫法：**
```ts
{
  id: 'step-1',
  title: '點擊登入按鈕',
  description: '在頁面右上角找到「登入」按鈕並點擊。',
  image: '/manual/getting-started/register/step-01/annotated.png',
  imageAlt: '右上角登入按鈕',
  imageCaption: '登入按鈕位於導覽列右側',
}
```

路徑以 `/manual/` 開頭（對應 `client/public/manual/`），**不可使用本機絕對路徑**。

---

## 新增步驟時的操作方式

1. 在對應 `articleId/` 資料夾下建立新的 `step-05/`（依序遞增）
2. 資料夾內放 `.gitkeep`（保持 Git 可追蹤）
3. 截圖備妥後放入 `original.png` 或 `annotated.png`
4. 更新 `client/src/lib/manual.ts` 的對應 article 的 `steps` 陣列，新增一筆 `ManualStep`

---

## 更新圖片的注意事項

- 更新截圖時，**請覆蓋原有檔案，不要修改路徑**
- 若路徑改變，manual.ts 內的 `image` 欄位也必須同步更新，否則教學頁面會顯示「圖片暫時無法顯示」
- 若某篇教學重新設計步驟，建議先在新路徑測試確認，再刪除舊路徑

---

## 步驟數量說明

目前每篇文章預設建立 4 個步驟資料夾（step-01 ~ step-04）。

- 若實際步驟少於 4 步：多餘的資料夾可保留（留空即可），不影響頁面顯示
- 若實際步驟超過 4 步：手動新增 `step-05/`、`step-06/` 等資料夾
- manual.ts 的 `steps` 陣列才是頁面實際顯示的依據，資料夾僅供存放圖片用
