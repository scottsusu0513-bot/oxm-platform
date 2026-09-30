/**
 * 已上線工廠的頭貼修改申請核准時：暫存頭貼 → 正式頭貼（Batch 3.3.1）。
 *
 * 背景：approved 工廠換頭貼時檔案放在 factory-avatars-temp/，網址經修改申請
 * 送審；原本核准只複製「網址字串」，正式工廠資料就一直指向暫存物件——暫存
 * prefix 只要被清理或設過期，公開頭貼就會壞掉。
 *
 * 順序（S3 與 MySQL 無法同一個 transaction）：
 *   1. 嚴格解析來源（只接受本 bucket 的 factory-avatars-temp/{factoryId}/{檔名}）
 *   2. HEAD 來源：存在、大小 > 0、Content-Type 是 image/*
 *   3. HEAD 目標 factory-avatars/{factoryId}/{同一個檔名}
 *        - 不存在 → CopyObject
 *        - 已存在且大小／ETag 與來源一致 → 視為先前已搬移成功，直接沿用（不覆蓋）
 *        - 已存在但不一致 → 失敗（fail closed，絕不覆蓋）
 *   4. HEAD 目標驗證：大小、Content-Type 與來源一致（ETag 可比較時也要一致）
 *   5. 回傳正式網址 → 呼叫端才進入 DB 核准 transaction
 * 任何一步失敗都拋出 FactoryAvatarPromotionError，DB 完全不動；若 DB 核准本身
 * 失敗，多出來的正式物件只是安全的孤兒檔，重試時第 3 步會直接沿用。
 * 暫存來源檔一律保留（歷史修改申請仍引用它），這裡不做任何刪除。
 */
import {
  parseTemporaryFactoryAvatarUrl,
  persistentFactoryAvatarKey,
  publicImageUrl,
} from "./factoryAvatarUrl";
import { storageCopy, storageHead, type StorageObjectHead } from "./storage";

export type FactoryAvatarPromotionFailure =
  | "invalid_source_url"
  | "source_missing"
  | "invalid_source_object"
  | "invalid_content_type"
  | "destination_collision"
  | "copy_failed"
  | "verification_failed";

export class FactoryAvatarPromotionError extends Error {
  constructor(public readonly reason: FactoryAvatarPromotionFailure, message?: string) {
    super(message ?? reason);
    this.name = "FactoryAvatarPromotionError";
  }
}

export type FactoryAvatarStorage = {
  head: (key: string) => Promise<StorageObjectHead | null>;
  copy: (sourceKey: string, destinationKey: string) => Promise<void>;
};

const defaultStorage: FactoryAvatarStorage = { head: storageHead, copy: storageCopy };

/**
 * ETag 只有在「單次 PutObject／CopyObject、非 multipart」時才等於內容 MD5，才能拿來
 * 判斷兩個物件內容相同。multipart 上傳的 ETag 形如 "…-N"，不代表內容雜湊，這時
 * 不能用 ETag 判定相同或不同——一律視為「無法比較」，只用大小，並且在「目標已
 * 存在」時 fail closed（無法確認內容相同就不沿用）。uploadAvatar 目前只用單次
 * PutObject，SSE-S3（AES256）不影響 ETag；SSE-KMS 的 ETag 也不是 MD5，同樣視為
 * 無法比較。
 */
function etagComparable(a: string | null, b: string | null): boolean {
  return !!a && !!b && !a.includes("-") && !b.includes("-");
}

function sameContent(source: StorageObjectHead, target: StorageObjectHead): "same" | "different" | "unknown" {
  if (source.contentLength !== target.contentLength) return "different";
  if (!etagComparable(source.etag, target.etag)) return "unknown";
  return source.etag === target.etag ? "same" : "different";
}

export async function promoteTemporaryFactoryAvatar(
  params: { factoryId: number; temporaryAvatarUrl: string },
  storage: FactoryAvatarStorage = defaultStorage,
): Promise<string> {
  const parsed = parseTemporaryFactoryAvatarUrl(params.temporaryAvatarUrl, params.factoryId);
  if (!parsed) throw new FactoryAvatarPromotionError("invalid_source_url");

  const source = await storage.head(parsed.sourceKey);
  if (!source) throw new FactoryAvatarPromotionError("source_missing");
  if (!(source.contentLength > 0)) throw new FactoryAvatarPromotionError("invalid_source_object");
  if (!source.contentType || !source.contentType.startsWith("image/")) {
    throw new FactoryAvatarPromotionError("invalid_content_type");
  }

  const destinationKey = persistentFactoryAvatarKey(params.factoryId, parsed.filename);
  const existing = await storage.head(destinationKey);
  if (existing) {
    if (sameContent(source, existing) !== "same" || existing.contentType !== source.contentType) {
      throw new FactoryAvatarPromotionError("destination_collision");
    }
    return publicImageUrl(destinationKey);
  }

  try {
    await storage.copy(parsed.sourceKey, destinationKey);
  } catch (err) {
    throw new FactoryAvatarPromotionError("copy_failed", (err as Error)?.name ?? "copy_failed");
  }

  const copied = await storage.head(destinationKey);
  if (!copied || copied.contentType !== source.contentType || sameContent(source, copied) === "different") {
    throw new FactoryAvatarPromotionError("verification_failed");
  }
  return publicImageUrl(destinationKey);
}
