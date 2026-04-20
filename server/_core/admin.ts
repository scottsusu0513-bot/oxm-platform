import { ENV } from "./env";
import type { User } from "../../drizzle/schema";

/**
 * 判斷使用者是否為管理員（基於白名單）
 * 支援：
 * - OWNER_OPEN_ID（單一 owner）
 * - ADMIN_WHITELIST_OPEN_IDS（逗號分隔的 open ids）
 * - ADMIN_WHITELIST_EMAILS（逗號分隔的 emails）
 */
export function isAdminUser(user: User | null): boolean {
  if (!user) return false;

  // 檢查 owner open id
  if (ENV.ownerOpenId && user.openId === ENV.ownerOpenId) {
    return true;
  }

  // 檢查白名單 open ids
  if (ENV.adminWhitelistOpenIds.length > 0 && ENV.adminWhitelistOpenIds.includes(user.openId)) {
    return true;
  }

  // 檢查白名單 emails
  if (ENV.adminWhitelistEmails.length > 0 && user.email && ENV.adminWhitelistEmails.includes(user.email)) {
    return true;
  }

  return false;
}
