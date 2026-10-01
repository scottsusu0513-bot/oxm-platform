# OXM 檔案儲存（S3）

最後更新：Batch 3.10（2026-10）。程式碼是唯一依據；本文件說明設定與營運面需要的資訊。

## 兩個 bucket，兩組憑證

| | 公開圖片 | 私有檔案 |
|---|---|---|
| 環境變數 | `AWS_S3_BUCKET`、`AWS_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、（選填）`AWS_S3_PUBLIC_BASE_URL` | `AWS_PRIVATE_FILES_BUCKET`、`AWS_PRIVATE_FILES_REGION`、`AWS_PRIVATE_FILES_ACCESS_KEY_ID`、`AWS_PRIVATE_FILES_SECRET_ACCESS_KEY` |
| 程式 | `server/storage.ts` | `server/privateStorage.ts` |
| 存取方式 | 固定公開網址 | 只有短效 presigned URL（≤10 分鐘），絕不產生公開網址 |
| 互相 fallback | 不會 | 不會（四項缺一即視為未設定） |

### 公開 bucket 的 prefix

| prefix | 用途 | DB 引用 |
|---|---|---|
| `factory-avatars/{factoryId}/` | 工廠頭貼（正式） | `factories.avatarUrl`、`factoryRevisions` |
| `factory-avatars-temp/{factoryId}/` | approved 工廠換頭貼的暫存檔 | `factoryRevisions.proposedData`（核准後保留作歷史） |
| `factory-covers/{factoryId}/` | 工廠封面 | `factories.coverImageUrl` |
| `factory-photos/{factoryId}/` | 工廠相簿 | `factoryPhotos.url` |
| `product-images/{factoryId}/` | 商品圖片 | `products.images` |
| `news-covers/{newsId}/`、`news-content/{newsId}/` | 找消息封面／內文圖 | `news.coverImageKey`、`news.content` |
| `community-posts/{userId}/` | 商案討論區、競標、報價圖片 | `communityPosts`／`communityBids`／`communityBidOffers.images` |

新上傳的公開物件帶 `Cache-Control: public, max-age=31536000, immutable`（key 永不重複使用）。Content-Type 與副檔名一律由伺服器依檔案 signature（JPEG／PNG／WEBP）決定，不信任前端宣稱的 MIME；不接受 SVG／HTML／XML。

### 私有 bucket 的 prefix

| prefix | 用途 |
|---|---|
| `news-attachments/tmp/`、`news-attachments/{newsId}/` | 找消息 PDF（presigned PUT → finalize 驗證 → 正式 key 由暫存 key 決定） |
| `chat-attachments/tmp/`、`chat-attachments/{factoryId}/` | 聊天 PDF 型錄（同上） |
| `certification-evidence/{factoryId}/` | 認證證明圖片（伺服器直接寫入，只有管理員可換發檢視網址） |

presigned PUT 把 `content-type` 與 `content-length` 列為 signed headers：S3 會拒絕 Content-Type 或大小與簽章不一致的上傳，實際寫入的大小必定等於伺服器端驗證過上限的宣告值；finalize 仍會 HEAD＋`%PDF-` magic bytes 二次驗證。

## IAM 權限（最小權限）

| 執行者 | bucket | 需要的動作 |
|---|---|---|
| Web 服務（公開憑證） | 公開 | `s3:PutObject`、`s3:GetObject`（HEAD）、`s3:DeleteObject`、`s3:ListBucket`（對帳用） |
| Web 服務（私有憑證） | 私有 | `s3:PutObject`、`s3:GetObject`、`s3:DeleteObject`，Resource 限定上表三個 prefix |
| Cron：cleanup-expired-news-attachments／cleanup-expired-chat-pdfs | 私有 | `s3:DeleteObject` |
| Cron：reconcile-storage（私有） | 私有 | 另需 `s3:ListBucket`，以 `s3:prefix` 條件限定 `chat-attachments/*`、`news-attachments/*`、`certification-evidence/*`（程式只會帶這三個 Prefix 分別列出，見 `PRIVATE_RECONCILE_LIST_PREFIXES`；不列整個 bucket） |

兩組憑證不可共用；公開憑證不應有私有 bucket 的任何權限，反之亦然。

## Lifecycle（建議）

- 私有 bucket：`chat-attachments/tmp/`、`news-attachments/tmp/` 1 天過期；整個 bucket `AbortIncompleteMultipartUpload` 1 天。
- 公開 bucket：整個 bucket `AbortIncompleteMultipartUpload` 1 天。
- **不要**對 `factory-avatars-temp/` 設過期規則：已核准的修改申請仍以暫存網址作為歷史紀錄，孤兒暫存檔由對帳流程處理（會先確認沒有任何修改申請引用）。

## 孤兒檔對帳（`server/jobs/reconcileStorageObjects.ts`）

刪相簿、刪商品、換封面／頭貼、上傳後沒有儲存、取消徽章、S3 刪除失敗等情況，DB 已不引用但 S3 物件仍在。這些物件由對帳流程統一清除，請求路徑不直接刪除共用物件。

```
pnpm reconcile:storage -- --bucket=public                       # dry-run（預設），只輸出數量與候選指紋
pnpm reconcile:storage -- --bucket=public --apply --approve=<fingerprint> [--max-delete=200]
```

安全規則：

1. 掃描 DB **所有資料表的所有文字／JSON 欄位**（包含修改申請、軟刪除紀錄、備份表）；只要 key 出現在任何地方就保留。
2. 只有 key 格式完全符合已知規則、沒有任何引用、且超過寬限期（多數 7 天、暫存頭貼與認證證明 30 天、私有 tmp 2 天）才是候選。
3. `--apply` 必須帶 dry-run 報告中的指紋；集合有任何變化就整批中止。
4. 刪除前立即重新掃描 DB，任何候選被引用就整批中止。
5. 列不完整、候選超過 `--max-delete` 也會中止。
6. 輸出只有數量、prefix 與指紋，不含 key、檔名、網址或憑證。

正式站第一次 apply 前，必須由 owner 核准 dry-run 的候選數量、大小與指紋。

## 既有公開物件補寫 Cache-Control（`server/jobs/backfillPublicCacheControl.ts`）

2bc7f09 之前上傳的公開物件沒有 Cache-Control。補寫工具只處理「目前被 DB 任何地方引用、key 格式符合公開規則」的物件；工廠 #26（owner 測試工廠）永遠排除。

```
node dist/jobs/backfillPublicCacheControl.js                                   # dry-run（預設）
node dist/jobs/backfillPublicCacheControl.js --apply --approve=<fingerprint> --max-batch=25
```

- 每個物件：HEAD → 同 key `CopyObject`（`MetadataDirective: REPLACE`，帶回原 Content-Type／metadata／加密，`CopySourceIfMatch` 綁定 ETag）→ HEAD 驗證內容 ETag、大小、Content-Type 不變 → 匿名 HEAD 確認公開網址仍可讀。
- 非 jpeg/png/webp、multipart ETag、大小不符的物件一律排除。
- 已是目標值的物件跳過：冪等、可分批續跑；指紋涵蓋所有符合條件物件（含已完成），批次間不變。
- 不寫 DB、不刪物件。versioning 開啟時，每次改寫會產生新版本（報告 `version_ids_returned`）。
