import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, NotFound } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 找消息 PDF 附件專用的「私有」storage 模組——刻意跟 server/storage.ts（既有
// 公開圖片 bucket：工廠大頭貼／封面／產品圖片／找消息封面與內文圖片）完全
// 分開，包含 AWS 憑證本身。既有 storage.ts 的 getPublicUrl() 假設所有物件都
// 公開可讀，PutObject 也從未設定過任何 ACL；沒有任何證據顯示那顆 bucket
// 具備「私有物件」能力。這個模組因此：
//   1. 用完全獨立的四個環境變數（AWS_PRIVATE_FILES_BUCKET／
//      AWS_PRIVATE_FILES_REGION／AWS_PRIVATE_FILES_ACCESS_KEY_ID／
//      AWS_PRIVATE_FILES_SECRET_ACCESS_KEY），不共用公開圖片用的
//      AWS_S3_BUCKET／AWS_ACCESS_KEY_ID／AWS_SECRET_ACCESS_KEY／AWS_REGION，
//      也不對任何一項做 fallback——即使公開圖片的憑證存在，私有附件功能一樣
//      視為未設定。這樣即使公開圖片的 Access Key 外流，也不會連帶暴露私有
//      PDF bucket 的存取權；反之私有憑證外流也不會影響公開圖片。
//   2. 沒有、也不提供任何 getPublicUrl 等價函式——這裡的每一個 helper 都只
//      回傳短效 presigned URL 或純 metadata，物件本身永遠不透過固定公開網址
//      存取。
//   3. 四個環境變數只要缺任何一項，所有函式一律 throw 同一句精簡訊息，不
//      fallback 到公開圖片憑證、不生出假的公開網址、也不在錯誤訊息裡透露
//      「缺的是哪一項」（避免讓探測錯誤訊息的人逐步拼湊出目前的設定狀態）。

interface PrivateStorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getPrivateStorageConfig(): PrivateStorageConfig | null {
  const bucket = process.env.AWS_PRIVATE_FILES_BUCKET;
  const region = process.env.AWS_PRIVATE_FILES_REGION;
  const accessKeyId = process.env.AWS_PRIVATE_FILES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_PRIVATE_FILES_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return { bucket, region, accessKeyId, secretAccessKey };
}

function requirePrivateStorageConfig(): PrivateStorageConfig {
  const config = getPrivateStorageConfig();
  if (!config) {
    throw new Error("私有附件儲存尚未設定，PDF 附件功能目前無法使用。");
  }
  return config;
}

/** 私有儲存（bucket＋region＋獨立憑證四項）是否已完整設定——供 router 層在動作前先做「功能是否可用」的判斷，不觸發例外。 */
export function isPrivateStorageConfigured(): boolean {
  return getPrivateStorageConfig() !== null;
}

function getClient(config: PrivateStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * 產生一次性、限定單一 UUID key 的 presigned PUT 網址，讓前端把 PDF 直接
 * 傳到私有 bucket，不經過我們自己的 server（25MB PDF 若走 base64 + tRPC JSON
 * 會膨脹到約 33MB，超過現有 15MB 圖片上傳的 body limit，也不適合長期占用
 * server 記憶體）。預設 5 分鐘有效，只能寫入呼叫端指定的那一個 key，不能
 * 用來寫入其他任意路徑。
 */
export async function privateStorageCreateUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const config = requirePrivateStorageConfig();
  const command = new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType });
  return getSignedUrl(getClient(config), command, { expiresIn: expiresInSeconds });
}

export interface PrivateObjectMetadata {
  exists: boolean;
  sizeBytes: number;
  contentType: string | null;
}

/** HeadObject——finalize 階段用來重新驗證實際上傳的檔案大小／型別，不信任前端宣稱的值。 */
export async function privateStorageHeadObject(key: string): Promise<PrivateObjectMetadata> {
  const config = requirePrivateStorageConfig();
  try {
    const result = await getClient(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return {
      exists: true,
      sizeBytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
    };
  } catch (err) {
    if (err instanceof NotFound || (err as { name?: string })?.name === "NotFound") {
      return { exists: false, sizeBytes: 0, contentType: null };
    }
    throw err;
  }
}

/**
 * 只讀取物件開頭幾個 byte（Range request），驗證 magic bytes 是不是真正的
 * PDF（`%PDF-`），不需要把整個 25MB 檔案下載回 server 記憶體。
 */
export async function privateStorageReadHeadBytes(key: string, byteCount = 8): Promise<Buffer> {
  const config = requirePrivateStorageConfig();
  const result = await getClient(config).send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Range: `bytes=0-${byteCount - 1}`,
  }));
  const body = result.Body;
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * 刪除單一私有物件。S3 DeleteObject 本身是冪等的——物件已經不存在時 AWS 一樣
 * 回傳成功，呼叫端（cleanup job）可以把這種情況視同刪除成功。刻意只接受
 * 明確的單一 key，不支援 prefix／萬用字元刪除。
 */
export async function privateStorageDeleteObject(key: string): Promise<void> {
  const config = requirePrivateStorageConfig();
  await getClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/**
 * finalize 驗證通過後，把暫存於 tmp 前綴的物件複製到正式附件的永久 key。
 * 只做同一個私有 bucket 內的 CopyObject，呼叫端仍需自行刪除來源 tmp 物件
 * （刪除失敗不影響已經複製好的正式物件，tmp 前綴另有 lifecycle 規則兜底）。
 */
export async function privateStorageCopyObject(sourceKey: string, destKey: string): Promise<void> {
  const config = requirePrivateStorageConfig();
  await getClient(config).send(new CopyObjectCommand({
    Bucket: config.bucket,
    CopySource: `${config.bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
    Key: destKey,
  }));
}

/**
 * RFC 5987 編碼中文/非 ASCII 檔名，避免 Content-Disposition header 出現非法
 * 字元或注入風險；同時提供一個安全的 ASCII fallback 給不支援 filename* 的
 * 舊用戶端。兩者都先過濾掉 CR/LF，防止 header injection。
 */
function sanitizeForHeader(name: string): string {
  return name.replace(/[\r\n]/g, "").slice(0, 200);
}

function buildContentDisposition(displayName: string): string {
  const safe = sanitizeForHeader(displayName);
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, "_") || "attachment.pdf";
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * 產生短效 presigned GET 網址供會員下載。有效秒數是呼叫端算好、傳進來的
 * 值（見 routers.ts 的「300 秒與距離期限剩餘秒數取較短值」邏輯），這個函式
 * 本身不重複做期限判斷，只負責簽章。
 */
export async function privateStorageCreateDownloadUrl(
  key: string,
  displayName: string,
  expiresInSeconds: number,
): Promise<string> {
  const config = requirePrivateStorageConfig();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ResponseContentDisposition: buildContentDisposition(displayName),
    ResponseContentType: "application/pdf",
  });
  return getSignedUrl(getClient(config), command, { expiresIn: Math.max(1, Math.floor(expiresInSeconds)) });
}
