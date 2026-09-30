/**
 * 工廠頭貼的公開圖片網址規則（Batch 3.3.1）——純函式，不碰 S3／DB。
 *
 * approved 工廠換頭貼時，uploadAvatar 會把檔案放在
 * `factory-avatars-temp/{factoryId}/{nanoid}.{ext}`，網址經修改申請送審。核准時
 * 必須先把這個暫存檔「搬到」`factory-avatars/{factoryId}/{同一個檔名}`，正式
 * 工廠資料只能寫正式網址（見 server/factoryAvatarPromotion.ts）。
 *
 * 這裡的 parser 刻意嚴格：它決定 CopyObject 的來源 key，不能變成「任意 S3
 * 物件複製」的入口。
 */

/** 與 storage.ts getPublicUrl 同一套規則：公開圖片 bucket 的網址前綴（含結尾 /）。 */
export function publicImageBaseUrl(): string {
  const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (base) return `${base}/`;
  const bucket = process.env.AWS_S3_BUCKET ?? "";
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/`;
}

export function publicImageUrl(key: string): string {
  return `${publicImageBaseUrl()}${key}`;
}

export const TEMP_FACTORY_AVATAR_PREFIX = "factory-avatars-temp/";
export const PERSISTENT_FACTORY_AVATAR_PREFIX = "factory-avatars/";

/** uploadAvatar 產生的檔名：nanoid()（21 碼 A-Za-z0-9_-）＋ jpg／png／webp。 */
const TEMP_AVATAR_FILENAME = /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/;

/**
 * 寬鬆偵測：網址「看起來」指向暫存頭貼（任何 host、任何寫法）。核准流程用它來
 * fail closed——只要看起來像暫存頭貼，就一定要經過嚴格 parser＋搬移，不能
 * 因為 host 或格式怪異而被當成一般網址直接寫進正式資料。
 */
export function looksLikeTemporaryFactoryAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* 保留原字串 */ }
  return /factory-avatars-temp/i.test(value) || /factory-avatars-temp/i.test(decoded);
}

export type ParsedTemporaryFactoryAvatar = { sourceKey: string; filename: string };

/**
 * 嚴格解析：只接受本系統公開圖片 bucket 的
 * `factory-avatars-temp/{expectedFactoryId}/{filename}`。
 * 拒絕：其他 host／bucket、http、query／fragment、任何 % 編碼、..、多層路徑、
 * 不同 factoryId、空檔名、非預期副檔名。
 */
export function parseTemporaryFactoryAvatarUrl(value: unknown, expectedFactoryId: number): ParsedTemporaryFactoryAvatar | null {
  if (typeof value !== "string" || !Number.isInteger(expectedFactoryId) || expectedFactoryId <= 0) return null;
  const base = publicImageBaseUrl();
  if (!value.startsWith(base)) return null;
  let url: URL;
  let baseUrl: URL;
  try { url = new URL(value); baseUrl = new URL(base); } catch { return null; }
  if (url.protocol !== "https:" || url.host !== baseUrl.host) return null;
  if (url.search || url.hash || value.includes("?") || value.includes("#")) return null;
  if (url.username || url.password) return null;
  const key = value.slice(base.length);
  if (!key || key.includes("%") || key.includes("\\") || key.includes("..")) return null;
  const parts = key.split("/");
  if (parts.length !== 3) return null;
  const [prefix, factoryIdPart, filename] = parts;
  if (`${prefix}/` !== TEMP_FACTORY_AVATAR_PREFIX) return null;
  if (factoryIdPart !== String(expectedFactoryId)) return null;
  if (!TEMP_AVATAR_FILENAME.test(filename)) return null;
  return { sourceKey: key, filename };
}

/** 暫存 key → 對應的正式 key（同一個檔名，決定性，重試會得到同一個 key）。 */
export function persistentFactoryAvatarKey(factoryId: number, filename: string): string {
  return `${PERSISTENT_FACTORY_AVATAR_PREFIX}${factoryId}/${filename}`;
}
