/**
 * 聊天 PDF 型錄附件（Production Hardening Batch 3.5）。
 *
 * 舊架構把 PDF 以 base64 塞進 tRPC JSON、存到「公開圖片 bucket」，訊息
 * attachmentData 帶永久公開 fileUrl——「7 天期限」與「授權後 5 分鐘下載連結」
 * 都能被那個永久網址直接繞過。新架構：
 *
 *   - 物件只存在私有 bucket（server/privateStorage.ts，與找消息 PDF 同一套獨立
 *     憑證），prefix：chat-attachments/tmp/（暫存）與 chat-attachments/{factoryId}/
 *   - 前端拿 presigned PUT 直傳 S3（PDF bytes 不經過 Express JSON body）
 *   - finalize 由 server 重新 HEAD＋讀前 5 bytes 驗證，搬到正式 key 後才寫訊息
 *   - 訊息只存 metadata（不存任何網址）；client 只拿得到檔名／大小／期限
 *   - 下載一律 messageId → server 授權 → 短效 presigned GET
 *
 * 期限語意（產品決策，Batch 3.5 Phase 2）：
 *   - 一般參與者：上傳後 7 天內可下載
 *   - 管理員：7 天後再多 30 天寬限期仍可下載（客服／糾紛處理）
 *   - 第 37 天由 cleanup job 實體刪除物件，之後所有人都不能下載
 */
import { nanoid } from "nanoid";
import { z } from "zod";

export const CHAT_PDF_MIME_TYPE = "application/pdf";
export const CHAT_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_PDF_ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHAT_PDF_ADMIN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_PDF_UPLOAD_URL_TTL_SECONDS = 600;
export const CHAT_PDF_DOWNLOAD_URL_MAX_TTL_SECONDS = 300;
export const CHAT_PDF_DOWNLOAD_CACHE_CONTROL = "private, no-store";

const TMP_PREFIX = "chat-attachments/tmp/";
// nanoid() 預設 21 字元、字元集 A-Za-z0-9_-：嚴格比對，拒絕 ../、%、?、#、多層路徑
const TMP_KEY_RE = /^chat-attachments\/tmp\/([A-Za-z0-9_-]{21})\.pdf$/;
const FINAL_KEY_RE = /^chat-attachments\/[1-9][0-9]{0,9}\/[A-Za-z0-9_-]{21}\.pdf$/;

export function createChatPdfTmpKey(): string {
  return `${TMP_PREFIX}${nanoid()}.pdf`;
}

/** 只接受 server 產生格式的暫存 key，回傳其中的亂數 id；其他一律 null（不形成任意 S3 copy primitive）。 */
export function parseChatPdfTmpKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const m = TMP_KEY_RE.exec(key);
  return m ? m[1] : null;
}

export function chatPdfFinalKey(factoryId: number, id: string): string {
  if (!Number.isSafeInteger(factoryId) || factoryId <= 0) throw new Error("invalid factoryId");
  const key = `chat-attachments/${factoryId}/${id}.pdf`;
  if (!FINAL_KEY_RE.test(key)) throw new Error("invalid chat attachment key");
  return key;
}

// Unicode 雙向控制字元（可把「exe.pdf」顯示成看似別的副檔名）
const BIDI_CONTROLS_RE = /[؜‎‏‪-‮⁦-⁩]/g;
const MAX_FILE_NAME_CHARS = 100;

/**
 * 檔名清理：只用於顯示與下載檔名，永遠不進 S3 key。回傳 null 代表不是 .pdf。
 * 長檔名截斷時保留 .pdf 副檔名（舊版先截斷再檢查副檔名，超長檔名會被誤判為非 PDF）。
 */
export function sanitizeChatPdfFileName(input: string): string | null {
  let name = input
    .replace(BIDI_CONTROLS_RE, "")
    .replace(/\.\./g, "_")
    .replace(/[/\\<>"'&]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .trim();
  if (!name.toLowerCase().endsWith(".pdf")) return null;
  const chars = Array.from(name);
  if (chars.length > MAX_FILE_NAME_CHARS) {
    name = chars.slice(0, MAX_FILE_NAME_CHARS - 4).join("").trimEnd() + ".pdf";
  }
  if (name.toLowerCase() === ".pdf") return "catalog.pdf";
  return name;
}

export function chatPdfExpiresAt(uploadedAt: Date): string {
  return new Date(uploadedAt.getTime() + CHAT_PDF_ACCESS_TTL_MS).toISOString();
}

// ── attachmentData（messages.type = 'pdf'）──────────────────────────────

const privatePdfAttachmentSchema = z.object({
  storage: z.literal("private"),
  fileKey: z.string().regex(FINAL_KEY_RE).nullable(),
  fileName: z.string().min(1).max(200),
  fileSize: z.number().int().positive().max(CHAT_PDF_MAX_BYTES),
  mimeType: z.literal(CHAT_PDF_MIME_TYPE),
  expiresAt: z.string().datetime(),
  deleted: z.boolean().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PrivateChatPdfAttachment = z.infer<typeof privatePdfAttachmentSchema>;

/** 寫入 DB 的 metadata——刻意沒有任何網址欄位。 */
export function buildPrivateChatPdfAttachment(params: {
  fileKey: string; fileName: string; fileSize: number; expiresAt: string;
}): PrivateChatPdfAttachment {
  return privatePdfAttachmentSchema.parse({
    storage: "private",
    fileKey: params.fileKey,
    fileName: params.fileName,
    fileSize: params.fileSize,
    mimeType: CHAT_PDF_MIME_TYPE,
    expiresAt: params.expiresAt,
  });
}

/**
 * 解析 DB 裡的 PDF attachmentData。舊格式（公開 bucket 的 fileUrl）、缺
 * storage="private"、key 格式不對、未刪除卻沒有 key……一律 null：呼叫端視為
 * 不可下載，不 fallback 到任何網址。
 */
export function parsePrivateChatPdfAttachment(raw: unknown): PrivateChatPdfAttachment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if ("fileUrl" in raw) return null;
  const parsed = privatePdfAttachmentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const isDeleted = a.deleted === true || a.deletedAt != null;
  if (!isDeleted && !a.fileKey) return null;
  return a;
}

export type ChatPdfAttachmentDTO = {
  fileName: string;
  fileSize: number;
  mimeType: typeof CHAT_PDF_MIME_TYPE;
  expiresAt: string;
  deleted: boolean;
};

/** 送給 client 的 PDF 卡片資料：只有顯示需要的 metadata，沒有 key／bucket／網址。 */
export function toChatPdfAttachmentDTO(raw: unknown): ChatPdfAttachmentDTO {
  const a = parsePrivateChatPdfAttachment(raw);
  if (!a) {
    // 無法解析（理論上不存在）：顯示成不可下載的卡片，不帶出原始 JSON 的任何欄位
    return { fileName: "PDF 型錄", fileSize: 0, mimeType: CHAT_PDF_MIME_TYPE, expiresAt: "", deleted: true };
  }
  return {
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: CHAT_PDF_MIME_TYPE,
    expiresAt: a.expiresAt,
    deleted: a.deleted === true || a.deletedAt != null,
  };
}

/** getMessages：只改寫 type='pdf' 的 attachmentData，其他訊息類型原樣回傳。 */
export function toClientChatMessage<T extends { type: string; attachmentData: unknown }>(row: T): T {
  if (row.type !== "pdf") return row;
  return { ...row, attachmentData: toChatPdfAttachmentDTO(row.attachmentData) };
}

// ── 下載授權後的期限判斷 ─────────────────────────────────────────────────

export type ChatPdfDownloadDecision =
  | { ok: true; fileKey: string; fileName: string; ttlSeconds: number }
  | { ok: false; message: string };

export const CHAT_PDF_EXPIRED_MESSAGE = "此型錄已逾期，無法下載";
export const CHAT_PDF_DELETED_MESSAGE = "此型錄已被刪除";
export const CHAT_PDF_UNAVAILABLE_MESSAGE = "此型錄無法下載";

/**
 * 呼叫前必須已經驗證過「此使用者可以讀這個對話」。這裡只處理附件本身的
 * 狀態與期限：一般參與者到 expiresAt 為止；管理員到 expiresAt + 30 天為止；
 * 簽章網址有效秒數不會超過該使用者剩餘的可存取時間。
 */
export function decideChatPdfDownload(
  attachment: PrivateChatPdfAttachment | null,
  opts: { isAdmin: boolean; now: Date },
): ChatPdfDownloadDecision {
  if (!attachment) return { ok: false, message: CHAT_PDF_UNAVAILABLE_MESSAGE };
  if (attachment.deleted === true || attachment.deletedAt != null || !attachment.fileKey) {
    return { ok: false, message: CHAT_PDF_DELETED_MESSAGE };
  }
  const expiresAtMs = Date.parse(attachment.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, message: CHAT_PDF_UNAVAILABLE_MESSAGE };
  const deadlineMs = opts.isAdmin ? expiresAtMs + CHAT_PDF_ADMIN_GRACE_MS : expiresAtMs;
  const remainingSeconds = Math.floor((deadlineMs - opts.now.getTime()) / 1000);
  if (remainingSeconds <= 0) return { ok: false, message: CHAT_PDF_EXPIRED_MESSAGE };
  return {
    ok: true,
    fileKey: attachment.fileKey,
    fileName: attachment.fileName,
    ttlSeconds: Math.min(CHAT_PDF_DOWNLOAD_URL_MAX_TTL_SECONDS, remainingSeconds),
  };
}

/** cleanup：實體刪除時間點（expiresAt + 30 天）是否已到。 */
export function isChatPdfDueForPhysicalDeletion(attachment: PrivateChatPdfAttachment, now: Date): boolean {
  const expiresAtMs = Date.parse(attachment.expiresAt);
  return Number.isFinite(expiresAtMs) && now.getTime() >= expiresAtMs + CHAT_PDF_ADMIN_GRACE_MS;
}

// ── finalize：暫存物件 → 正式物件 ────────────────────────────────────────

export type ChatPdfObjectHead = { exists: boolean; sizeBytes: number; contentType: string | null; etag?: string | null };

export type ChatPdfStorage = {
  head: (key: string) => Promise<ChatPdfObjectHead>;
  readHeadBytes: (key: string, byteCount: number) => Promise<Buffer>;
  copy: (sourceKey: string, destinationKey: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type ChatPdfPromotionFailure =
  | "invalid_upload_key"
  | "upload_missing"
  | "invalid_size"
  | "invalid_content_type"
  | "invalid_pdf"
  | "destination_collision"
  | "copy_failed"
  | "verification_failed";

const PROMOTION_FAILURE_MESSAGES: Record<ChatPdfPromotionFailure, string> = {
  invalid_upload_key: "無效的上傳資料，請重新上傳",
  upload_missing: "找不到已上傳的檔案，請重新上傳",
  invalid_size: "檔案大小不可超過 10MB",
  invalid_content_type: "檔案類型不正確，請上傳 PDF",
  invalid_pdf: "檔案格式不正確，請上傳 PDF",
  destination_collision: "檔案儲存失敗，請重新上傳",
  copy_failed: "檔案儲存失敗，請重新上傳",
  verification_failed: "檔案儲存失敗，請重新上傳",
};

export class ChatPdfPromotionError extends Error {
  constructor(public readonly reason: ChatPdfPromotionFailure) {
    super(PROMOTION_FAILURE_MESSAGES[reason]);
    this.name = "ChatPdfPromotionError";
  }
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

function etagComparable(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && !a.includes("-") && !b.includes("-");
}

/**
 * 驗證暫存物件並搬到正式 key。順序：HEAD 暫存 → 讀前 5 bytes → 檢查目標
 * 是否已存在（不覆蓋）→ CopyObject → HEAD 驗證正式物件 → 刪暫存。驗證失敗時
 * best-effort 刪除暫存物件。呼叫端只能在這裡成功回傳之後才寫 DB 訊息——S3 與
 * DB 不是 atomic，「正式物件已存在、DB 寫入失敗」會留下孤兒物件（可接受）。
 */
export async function promoteChatPdfUpload(
  params: { uploadKey: string; factoryId: number },
  storage: ChatPdfStorage,
): Promise<{ fileKey: string; sizeBytes: number }> {
  const id = parseChatPdfTmpKey(params.uploadKey);
  if (!id) throw new ChatPdfPromotionError("invalid_upload_key");
  const tmpKey = params.uploadKey;
  const discardTmp = async () => {
    await storage.delete(tmpKey).catch(() => { /* tmp prefix 另有 lifecycle 規則兜底 */ });
  };

  const source = await storage.head(tmpKey);
  if (!source.exists) throw new ChatPdfPromotionError("upload_missing");
  if (!(source.sizeBytes > 0) || source.sizeBytes > CHAT_PDF_MAX_BYTES) {
    await discardTmp();
    throw new ChatPdfPromotionError("invalid_size");
  }
  if (source.contentType !== CHAT_PDF_MIME_TYPE) {
    await discardTmp();
    throw new ChatPdfPromotionError("invalid_content_type");
  }
  const head = await storage.readHeadBytes(tmpKey, PDF_MAGIC.length);
  if (head.length < PDF_MAGIC.length || !head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    await discardTmp();
    throw new ChatPdfPromotionError("invalid_pdf");
  }

  const fileKey = chatPdfFinalKey(params.factoryId, id);
  const existing = await storage.head(fileKey);
  if (existing.exists) {
    // 只有能證明是同一份內容（大小相同、ETag 可比較且相同）才沿用，否則 fail closed
    const same = existing.sizeBytes === source.sizeBytes
      && existing.contentType === CHAT_PDF_MIME_TYPE
      && etagComparable(source.etag, existing.etag)
      && source.etag === existing.etag;
    if (!same) throw new ChatPdfPromotionError("destination_collision");
  } else {
    try {
      await storage.copy(tmpKey, fileKey);
    } catch {
      await discardTmp();
      throw new ChatPdfPromotionError("copy_failed");
    }
    const copied = await storage.head(fileKey);
    const etagDiffers = etagComparable(source.etag, copied.etag) && source.etag !== copied.etag;
    if (!copied.exists || copied.sizeBytes !== source.sizeBytes || copied.contentType !== CHAT_PDF_MIME_TYPE || etagDiffers) {
      throw new ChatPdfPromotionError("verification_failed");
    }
  }

  await discardTmp();
  return { fileKey, sizeBytes: source.sizeBytes };
}

/** S3 回報「物件本來就不存在」的錯誤（DeleteObject 通常直接成功，這裡保守處理）。 */
export function isS3NotFoundError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { Code?: unknown } | null)?.Code;
  return name === "NoSuchKey" || name === "NotFound" || code === "NoSuchKey";
}
