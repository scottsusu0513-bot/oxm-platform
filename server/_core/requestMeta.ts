/**
 * Analytics 2.0 — 從 request 安全取出 client IP，並做隱私友善的雜湊/匿名化
 * （見對話中「IP 與隱私」）。
 *
 * 優先序（見對話中「十三、IP 與隱私」建議）：
 *   1. CF-Connecting-IP（Cloudflare Proxied 後才會有這個 header；目前
 *      oxmmatch.com 是 DNS only，不會有這個 header，先做相容，不代表現在
 *      就在用）
 *   2. 可信 proxy 後的 req.ip（Express `trust proxy` 已設為 1，見
 *      server/_core/index.ts `app.set("trust proxy", 1)`——代表只信任
 *      X-Forwarded-For 最右邊一段，也就是 Render 自己這一層 proxy 回報的
 *      真實 client IP，不會被使用者自己偽造的 X-Forwarded-For 頭覆蓋）
 *   3. req.socket.remoteAddress（理論上的最後 fallback，正常部署環境不會
 *      走到這裡）
 *
 * 刻意不直接信任任意 X-Forwarded-For 段——那個 header 可以被使用者端偽造
 * 任意內容，只有 Express 在 `trust proxy` 設定下解析出來的 `req.ip`
 * （只採信「離我們自己這台伺服器最近的那一個受信任 proxy 回報」的值）才
 * 可靠。
 */
import { createHash, createHmac } from "crypto";
import type { Request } from "express";

/**
 * Batch 3.11：雜湊鹽不再直接重用 JWT_SECRET（也不再有寫死的 fallback）——
 * 沒有設定 ANALYTICS_IP_SALT 時，從 JWT_SECRET 以 HMAC 衍生出專用的鹽，
 * 不同用途不共用同一把原始密鑰。
 */
function ipHashSalt(): string {
  if (process.env.ANALYTICS_IP_SALT) return process.env.ANALYTICS_IP_SALT;
  return createHmac("sha256", process.env.JWT_SECRET ?? "").update("oxm:analytics-ip-salt:v1").digest("hex");
}
const IP_HASH_SALT = ipHashSalt();

/**
 * Batch 3.11：只使用 Express 依 `trust proxy`（server/_core/clientIp.ts 的逐跳規則）
 * 解析出的 req.ip。原本優先採用 CF-Connecting-IP header——任何 client 都能自己帶，
 * 不經過 Cloudflare 的請求就能偽造。經過 Cloudflare 時 req.ip 本來就等於 Cloudflare
 * 看到的 client（正式站實測），不需要另外讀 header。
 */
export function getClientIp(req: Request): string {
  if (req.ip) return req.ip;
  return req.socket?.remoteAddress ?? "";
}

/** 單向雜湊（加鹽），永久保存也不會反推出原始 IP，只用來判斷「這是不是
 * 短時間內同一個來源」，不是為了識別使用者身分。 */
export function hashIp(ip: string): string {
  if (!ip) return "";
  return createHash("sha256").update(`${IP_HASH_SALT}:${ip}`).digest("hex");
}

/** IPv4 /24、IPv6 /48 的匿名化前綴——只保留到足以做「同網段」聚合分析的
 * 粗粒度，不保留完整位址（見對話中「ipPrefix / anonymized IP」建議）。 */
export function anonymizeIpPrefix(ip: string): string {
  if (!ip) return "";
  if (ip.includes(":")) {
    // IPv6：取前 3 組（/48 等級）
    const parts = ip.split(":").filter(Boolean);
    return parts.slice(0, 3).join(":") + "::/48";
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  return ip;
}
