# OXM 使用手冊圖片資料夾

本目錄用於存放「使用手冊」（`/manual`）頁面所有教學步驟的操作截圖。

---

## 目錄層級

```
client/public/manual/
  <categoryId>/          ← 分類（對應 manual.ts 的 categoryId）
    <articleId>/         ← 教學文章（對應 manual.ts 的 article id）
      step-01/           ← 第 1 步驟圖片資料夾
        <filename>.png   ← 正式圖片（由使用者人工處理後放入）
      step-02/
      step-03/
      ...
```

**原則：實際需要幾步，就只建立幾個 step 資料夾。不預先建立固定數量的空資料夾。**

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

## 現行文章架構（對應 manual.ts）

每個分類目前只保留一篇主文章。以下為 manual.ts 的實際內容：

| 分類 | articleId | 標題 | 步驟數 | status |
|------|-----------|------|--------|--------|
| `getting-started` | `register` | 如何註冊帳號 | 3 | **ready** |
| `find-factory` | `search-factory` | 如何搜尋並聯絡工廠 | 6 | **ready** |
| `list-factory` | `register-factory` | 如何刊登工廠／工作室 | 8 | draft |
| `manage-store` | `upload-photos` | 如何完善工廠後台 | 5 | draft |
| `messaging` | `send-message` | 如何使用訊息與 PDF 型錄 | 5 | draft |
| `collaboration` | `create-order` | 如何建立與完成合作確認單 | 7 | draft |

**status 說明：**
- `ready`：文章與圖片均已完成，正式對外顯示
- `draft`：步驟文字已規劃，圖片尚未就緒；頁面顯示「製作中」提示
- `coming-soon`：尚未規劃

---

## 已完成文章圖片路徑（search-factory）

`search-factory` 目前共 6 步，圖片已由使用者人工處理完畢：

```
find-factory/search-factory/step-01/4.png   ← 步驟 ①
find-factory/search-factory/step-02/5.png   ← 步驟 ②
find-factory/search-factory/step-04/6.png   ← 步驟 ③
find-factory/search-factory/step-05/7.png   ← 步驟 ④
find-factory/search-factory/step-06/8.png   ← 步驟 ⑤
find-factory/search-factory/step-07/9.png   ← 步驟 ⑥
```

> 注意：資料夾編號不連續（step-03 不存在）。圖片內已人工嵌入正確的步驟圓圈編號 ①～⑥。
> 為避免破壞圖片內容，保留既有路徑，不應為了路徑連續而重新命名或移動正式圖片。

---

## 圖片處理分工

### 使用者負責

每張圖片均由使用者完成以下處理後才放入本目錄：

- 操作截圖
- 裁切構圖
- 遮蔽個資（姓名、電話、信箱等）
- 加入標示：橘色框線、箭頭、步驟圓圈編號

### Claude 負責

Claude 在教學製作中只處理：

- 讀取圖片確認操作內容
- 撰寫教學步驟文字（title、description、imageAlt、imageCaption）
- 更新 `client/src/lib/manual.ts`
- 整合或刪減步驟
- 清理冗餘的空資料夾與占位檔案

**Claude 不得修改、裁切、壓縮、重新生成或移動任何圖片。**

---

## 圖片放置規則

### 正式圖片

- 已由使用者人工處理完畢的圖片才可放入 `client/public/`
- 路徑以 `/manual/` 開頭（對應 `client/public/manual/`），不可使用本機絕對路徑
- 建議格式：**PNG** 或 **WebP**（不使用 JPG，避免截圖文字模糊）
- 不要使用中文、空白或特殊符號作為資料夾或檔案名稱
- **未遮蔽個資的原圖不得放入 `client/public/`**

### 私有原圖

- 尚未處理的原始截圖請放入專案根目錄的 `manual-source/`
- `manual-source/` 已在 `.gitignore` 中排除，不會被 Git 追蹤
- 正式圖片製作完成後再放入 `client/public/manual/` 對應資料夾

---

## .gitkeep 規則

- **空資料夾**才需要 `.gitkeep`（讓 Git 可追蹤空目錄）
- **已有正式圖片的資料夾不需要 `.gitkeep`**，應刪除
- step 資料夾內不重複放說明用 README

---

## manual.ts 路徑寫法範例

**實體檔案位置：**
```
client/public/manual/getting-started/register/step-01/1.png
```

**manual.ts 中 image 欄位的寫法：**
```ts
{
  id: 'step-1',
  title: '點擊登入',
  description: '在 OXM 首頁右上角，點擊橘色「登入」按鈕，開啟登入畫面。',
  image: '/manual/getting-started/register/step-01/1.png',
  imageAlt: 'OXM 首頁右上角導覽列，橘色虛線框標示登入按鈕，步驟編號 ①',
  imageCaption: '點擊右上角的「登入」按鈕',
}
```

路徑以 `/manual/` 開頭，不可使用本機絕對路徑。

---

## 新增步驟流程

1. 使用者完成截圖、標示、個資遮蔽
2. 將正式圖片放入 `<articleId>/step-0X/<filename>.png`
3. 更新 `client/src/lib/manual.ts` 對應 article 的 `steps` 陣列
4. 若 article 步驟已全部就緒，將 `status` 改為 `'ready'`

---

## 更新圖片的注意事項

- 更新截圖時，**請覆蓋原有檔案，不要修改路徑**
- 若路徑改變，manual.ts 內的 `image` 欄位也必須同步更新，否則教學頁面會顯示「圖片暫時無法顯示」
- 若某篇教學重新設計步驟，先在新路徑測試確認，再刪除舊路徑
- **不得保留已移除文章的資料夾、舊圖片或空 step 資料夾**
