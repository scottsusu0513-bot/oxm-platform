/**
 * 工廠正式圖片欄位（factories.avatarUrl／coverImageUrl）的持久化規則
 * （Production Hardening Batch 3.1.1）。
 *
 * 正常上傳一律經 server 的 S3 upload pipeline（uploadAvatar／uploadCoverImage
 * 回傳永久 S3 URL，含 approved 工廠的 factory-avatars-temp/ ＋ 修改申請流程），
 * 前端不會、也不應該產生 data: URL。早期少數工廠的頭貼曾以 Base64 data URL
 * 直接存進資料庫（已搬到 S3）；歷史修改申請快照（factoryRevisions）與開著舊
 * 頁面的瀏覽器狀態仍可能帶著這種值，因此：
 *   - 修改申請送出時：data: URL 視為「過期的舊狀態」直接略過（不算這次要改）
 *   - 修改申請核准套用時：再次略過，保留目前正式值
 *   - 直接寫入工廠（updateFactory）：拒絕
 * 不改變其他既有 URL 規則（http/https、null／空值語意維持原本各自的驗證）。
 */
export function isLegacyDataUrl(value: unknown): boolean {
  return typeof value === "string" && /^\s*data:/i.test(value);
}

/** 會被當作工廠正式圖片寫入的欄位。 */
export const PERSISTENT_FACTORY_IMAGE_FIELDS = ["avatarUrl", "coverImageUrl"] as const;
