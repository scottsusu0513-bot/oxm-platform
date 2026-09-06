// OXM 官方負責人帳號對「其他使用者」顯示的固定 sender 身份。
//
// 只有一個帳號會被視為官方負責人：server 端以 ENV.ownerOpenId 判斷
// （見 server/_core/officialIdentity.ts、server/_core/admin.ts 的 owner 分支）。
// 其他管理員（ADMIN_WHITELIST_*）一律維持既有的「平台管理員」身份，不套用
// 這個名稱。client 端只根據 API 回傳的 SenderIdentity render，永遠不知道
// OWNER_OPEN_ID，也不自行用 email / openId / role 判斷。
//
// 官方身份不是可寫入的 profile 欄位——一般會員無法把自己設定成這個名稱。

/** 官方負責人帳號對外顯示名稱（固定字串）。 */
export const OFFICIAL_OXM_DISPLAY_NAME = "OXM負責人｜小鈞";

/** 非官方負責人的管理員 sender 對外顯示名稱（維持既有）。 */
export const PLATFORM_ADMIN_DISPLAY_NAME = "平台管理員";

/**
 * 官方 sender 名稱樣式：只強調 sender identity 本身，OXM 橘色 + 半粗。
 * 不得用來改整則訊息 bubble、卡片或一般通知的樣式。
 */
export const OFFICIAL_OXM_NAME_CLASSNAME = "text-orange-500 font-semibold";

export interface SenderIdentity {
  /** 對其他使用者顯示的名稱。 */
  displayName: string;
  /** true = 官方負責人帳號（displayName 固定為 OFFICIAL_OXM_DISPLAY_NAME）。 */
  isOfficialOxmAccount: boolean;
}
