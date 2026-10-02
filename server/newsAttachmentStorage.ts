/**
 * 找消息 PDF 附件的 storage key 規則（Batch 3.10）。
 *
 * 正式 key 由暫存 key 的 id 決定：同一份上傳不論重試或併發 finalize，都只會對應到
 * 同一個正式物件，createNewsAttachment 再以 storageKey 去重，避免產生重複附件列，
 * 也不需要在 DB 失敗時刪除「可能已被另一個 finalize 引用」的正式物件。
 */
const NEWS_ATTACHMENT_TMP_KEY_RE = /^news-attachments\/tmp\/([A-Za-z0-9_-]{6,64})\.pdf$/;

export const NEWS_PDF_DOWNLOAD_CACHE_CONTROL = "private, no-store";

/**
 * 下載檔名（Batch 3.10 正式站 smoke 發現）：後台上傳時 displayName 會去掉 .pdf
 * （AdminNews.tsx），Content-Disposition 直接用 displayName，瀏覽器存檔時就沒有副檔名。
 * 下載時補上 .pdf，不改 DB 內的顯示名稱。
 */
export function newsPdfDownloadFileName(displayName: string): string {
  const name = displayName.trim() || "attachment";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

export function newsAttachmentPermanentKey(newsId: number, tmpKey: string): string {
  const m = NEWS_ATTACHMENT_TMP_KEY_RE.exec(tmpKey);
  if (!m || !Number.isInteger(newsId) || newsId <= 0) throw new Error("無效的暫存檔案路徑");
  return `news-attachments/${newsId}/${m[1]}.pdf`;
}
