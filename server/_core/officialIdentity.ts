import {
  OFFICIAL_OXM_DISPLAY_NAME,
  PLATFORM_ADMIN_DISPLAY_NAME,
  type SenderIdentity,
} from "../../shared/officialIdentity";

/**
 * 「OXM 官方負責人」帳號只有一個：OWNER_OPEN_ID（見 server/_core/admin.ts
 * isAdminUser() 的 owner 分支，是既有、唯一的 super-admin 標記）。
 *
 * 其他管理員（ADMIN_WHITELIST_OPEN_IDS / ADMIN_WHITELIST_EMAILS）都不算，
 * 維持自己的名稱。純 server 判斷、以 openId 比對；不看 email / role，也不是
 * 可寫入的 profile 欄位，因此一般會員無法把自己變成官方負責人。
 *
 * 每次呼叫才讀 process.env.OWNER_OPEN_ID（與 ENV.adminWhitelistEmails 的
 * getter 同理，見 server/_core/env.ts 說明）：production 語意不變（開機後
 * env 不再變），但讓測試能可靠覆寫。未設定時一律回傳 false。
 */
export function isOfficialOxmAccount(
  user: { openId?: string | null } | null | undefined,
): boolean {
  const owner = process.env.OWNER_OPEN_ID ?? "";
  if (!owner || !user?.openId) return false;
  return user.openId === owner;
}

/**
 * 解析「一個站內信 admin sender 對其他使用者顯示什麼」。
 *
 * - 官方負責人帳號 → { displayName: "OXM負責人｜小鈞", isOfficialOxmAccount: true }
 * - 其他任何 admin sender → { displayName: "平台管理員", isOfficialOxmAccount: false }
 *
 * 回傳最小必要資料，不含 openId / email / role — client 只依這份結果 render。
 */
export function resolveAdminSenderIdentity(
  user: { openId?: string | null } | null | undefined,
): SenderIdentity {
  if (isOfficialOxmAccount(user)) {
    return { displayName: OFFICIAL_OXM_DISPLAY_NAME, isOfficialOxmAccount: true };
  }
  return { displayName: PLATFORM_ADMIN_DISPLAY_NAME, isOfficialOxmAccount: false };
}
