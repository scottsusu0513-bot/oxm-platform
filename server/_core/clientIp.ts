/**
 * Client IP trust boundary（Batch 3.11）。
 *
 * 正式站拓樸：client → Cloudflare（proxied）→ Render proxy → Express。
 * Render 的 *.onrender.com 原始網址也可以被直接存取（不經 Cloudflare）。
 *
 * X-Forwarded-For／CF-Connecting-IP 等 header 任何 client 都能自己帶，不能因為
 * header 存在就相信。只有「由我們信任的那一跳 proxy 附加上去」的值才可信：
 *   - 第 0 跳（socket 的對端）是 Render 內部 proxy（私有／loopback 位址）→ 可信
 *   - 下一跳若是 Cloudflare 官方位址段（且不是 Cloudflare Workers 的子請求）→ 可信
 *   - 遇到第一個不可信的位址就停，那就是 client IP（req.ip）
 * 因此經過 Cloudflare 時 req.ip 是 Cloudflare 看到的真實 client，直接打 Render
 * 原始網址時 req.ip 是 Render 看到的連線來源；兩種情況 client 都無法偽造。
 */
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

/** https://www.cloudflare.com/ips-v4 、 https://www.cloudflare.com/ips-v6（2026-10 取得） */
export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
] as const;
export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
] as const;

const PRIVATE_IPV4 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10"];
const PRIVATE_IPV6 = ["::1/128", "fc00::/7", "fe80::/10"];

function buildList(v4: readonly string[], v6: readonly string[]): BlockList {
  const list = new BlockList();
  for (const r of v4) { const [a, p] = r.split("/"); list.addSubnet(a, Number(p), "ipv4"); }
  for (const r of v6) { const [a, p] = r.split("/"); list.addSubnet(a, Number(p), "ipv6"); }
  return list;
}
const cloudflareList = buildList(CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES);
const privateList = buildList(PRIVATE_IPV4, PRIVATE_IPV6);

/** 去掉 IPv4-mapped IPv6 前綴（::ffff:1.2.3.4）與空白；不是合法 IP 回傳 null。 */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (/^::ffff:/i.test(ip) && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

function check(list: BlockList, raw: string | undefined | null): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

export const isCloudflareIp = (ip: string | undefined | null) => check(cloudflareList, ip);
export const isPrivateIp = (ip: string | undefined | null) => check(privateList, ip);

export type IpKind = "private" | "cloudflare" | "public" | "invalid";
export function classifyIp(ip: string | undefined | null): IpKind {
  if (!normalizeIp(ip)) return "invalid";
  if (isPrivateIp(ip)) return "private";
  if (isCloudflareIp(ip)) return "cloudflare";
  return "public";
}

/**
 * Express `trust proxy` 函式：proxy-addr 由近到遠逐跳詢問（i=0 是 socket 對端，
 * 之後是 X-Forwarded-For 由右往左），回傳 false 的第一個位址即為 req.ip。
 */
export function trustProxyHop(addr: string, i: number): boolean {
  if (i === 0) return isPrivateIp(addr);
  return isCloudflareIp(addr);
}

/**
 * 給 Express 用的 trust 函式外加一個 request 層的條件：Cloudflare Workers 對外的
 * 子請求同樣來自 Cloudflare 位址段，但 header 由 Worker 程式任意設定（帶有
 * CF-Worker header）——這種情況只信任 Render 那一跳。Express 的 trust 函式拿不到
 * request，所以由 middleware 在每個 request 開頭決定要用哪一個。
 */
export function isCloudflareWorkerSubrequest(req: IncomingMessage): boolean {
  return typeof req.headers["cf-worker"] === "string";
}

/** 依 trustProxyHop 規則，從 socket 位址＋X-Forwarded-For 解出 client IP（diagnostic／測試用）。 */
export function resolveClientIp(socketAddr: string | undefined, xff: string | undefined, opts: { allowCloudflareHop?: boolean } = {}): string | null {
  const allowCf = opts.allowCloudflareHop ?? true;
  const chain = [socketAddr ?? "", ...(xff ? xff.split(",").map(s => s.trim()).filter(Boolean).reverse() : [])];
  for (let i = 0; i < chain.length; i++) {
    const trusted = i === 0 ? isPrivateIp(chain[i]) : allowCf && isCloudflareIp(chain[i]);
    if (!trusted) return normalizeIp(chain[i]) ?? chain[i];
  }
  return normalizeIp(chain[chain.length - 1]) ?? null;
}
