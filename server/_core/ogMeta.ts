import * as db from "../db";

const SITE_BASE_URL = "https://www.oxmmatch.com";
// exported so other dynamic (non-DB-backed) pages, e.g. /industry/:slug
// meta injection in server/_core/vite.ts, can reuse the same default
// social-preview image instead of hardcoding their own copy of this URL.
export const DEFAULT_OG_IMAGE = `${SITE_BASE_URL}/og-image.png`;
const SITE_NAME = "OXM";

const META_MARKER_START = "<!-- oxm-dynamic-meta:start -->";
const META_MARKER_END = "<!-- oxm-dynamic-meta:end -->";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips tags, collapses whitespace/newlines, trims, and truncates (with an ellipsis) to maxLen. */
export function normalizeText(input: string | null | undefined, maxLen: number): string {
  if (!input) return "";
  const plain = String(input)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * Accepts only absolute https:// URLs, or site-root-relative "/path" URLs
 * (resolved against the site's own https origin). Rejects http:, data:,
 * blob:, javascript: and anything else that isn't a safe public image URL.
 */
export function toSafeAbsoluteImageUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return `${SITE_BASE_URL}${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface FactoryMeta {
  title: string;
  description: string;
  image: string;
  url: string;
  /**
   * HTTP status the response should actually be sent with.
   *
   * - 404＝id 格式無效、查無此工廠，或工廠存在但目前不是 approved
   *   （draft／pending／rejected）。這三種情況一律 404，不是 410：410
   *   在 HTTP 語意上代表「這個資源曾經確實公開存在過，現在確認永久
   *   移除」，但目前的 factories schema 只有單一 status 欄位，沒有任何
   *   欄位能可靠回答「這筆資料是否曾經是 approved」（沒有
   *   approvedAt／狀態變更歷史紀錄）——draft／pending 從來就沒公開過，
   *   rejected 也可能從未通過審核就直接被拒絕。沒有可靠依據時寧可統一
   *   回 404，不要用猜的方式回 410（見任務回報：資料模型目前無法可靠
   *   判斷「曾經公開、現在永久下架」）。
   * - 410 保留在型別裡供未來若真的新增「曾公開後下架」的可靠欄位
   *   （例如 approvedAt 搭配下架時間戳記）時使用，目前 buildFactoryMeta
   *   不會回傳 410。
   * - 200＝有效且已審核通過。
   *
   * 過去這裡永遠只回 200 加上通用 fallback meta，Googlebot 看到的是
   * 「200 但找不到真正內容」的軟式 404——這正是本次要修正的問題，見
   * server/factoryPageStatus.test.ts。
   */
  status: 200 | 404 | 410;
  /** true 時會在注入的 meta 區塊加上 <meta name="robots" content="noindex">。 */
  noindex: boolean;
}

function buildTitle(name: string): string {
  const safeName = normalizeText(name, 60) || "OXM 工廠";
  return normalizeText(`${safeName}｜${SITE_NAME}`, 70);
}

function buildDescription(factory: {
  description: string | null;
  industry: unknown;
  subIndustry: unknown;
  region: string | null;
}): string {
  const fromDescription = normalizeText(factory.description, 155);
  if (fromDescription) return fromDescription;

  const industryArr = Array.isArray(factory.industry) ? (factory.industry as string[]) : [];
  const subIndustryArr = Array.isArray(factory.subIndustry) ? (factory.subIndustry as string[]) : [];
  const parts = [
    industryArr.join("、"),
    subIndustryArr.join("、"),
    factory.region ? `位於${factory.region}` : "",
  ].filter(Boolean);

  if (parts.length > 0) {
    return normalizeText(`${parts.join("・")}的台灣工廠，歡迎在 OXM 查看服務與合作資訊。`, 155);
  }

  return "在 OXM 查看這間台灣工廠的服務與合作資訊。";
}

async function resolveFactoryImage(
  factoryId: number,
  factory: { coverImageUrl: string | null; avatarUrl: string | null }
): Promise<string> {
  const cover = toSafeAbsoluteImageUrl(factory.coverImageUrl);
  if (cover) return cover;

  const avatar = toSafeAbsoluteImageUrl(factory.avatarUrl);
  if (avatar) return avatar;

  try {
    const photos = await db.getPhotosByFactoryId(factoryId);
    const firstPhoto = toSafeAbsoluteImageUrl(photos[0]?.url);
    if (firstPhoto) return firstPhoto;
  } catch {
    // DB hiccup on the photo lookup — fall through to the next candidate.
  }

  try {
    const products = await db.getProductsByFactoryId(factoryId);
    for (const p of products) {
      const images = Array.isArray(p.images) ? (p.images as string[]) : [];
      const firstImg = toSafeAbsoluteImageUrl(images[0]);
      if (firstImg) return firstImg;
    }
  } catch {
    // DB hiccup on the product lookup — fall through to the default image.
  }

  return DEFAULT_OG_IMAGE;
}

const GENERIC_FALLBACK = {
  title: `台灣工廠資源媒合｜${SITE_NAME}`,
  description: "在 OXM 尋找適合您的台灣工廠與工作室資源。",
  image: DEFAULT_OG_IMAGE,
};

/** Strips the query string off a raw URL, e.g. from req.originalUrl. */
export function stripQueryString(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

/** Extracts just the query string (no leading "?") off a raw URL, e.g. from req.originalUrl. Returns "" when there is none. */
export function extractQueryString(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? "" : url.slice(i + 1);
}

/** Extracts the raw id segment out of a request pathname like "/factory/123", or null if the path isn't a factory-detail path. */
export function parseFactoryPath(pathname: string): { rawId: string } | null {
  const m = pathname.match(/^\/factory\/([^/]+)\/?$/);
  return m ? { rawId: m[1] } : null;
}

/**
 * Builds the meta for a /factory/:id request. Never throws — a DB error
 * falls back to generic OXM meta with status 200 (fail-open: a transient
 * outage must never de-index a real, previously-working page). An invalid
 * id, a missing factory, or a factory that exists but isn't currently
 * approved (draft／pending／rejected) is a real content problem, not a
 * transient one, so those get a real 404 + noindex instead of a silent 200,
 * which is what used to cause Google to report a soft 404 (200 status but
 * generic "nothing here" content — see server/factoryPageStatus.test.ts).
 *
 * All three non-approved cases return 404, not 410: the factories table
 * only has a single `status` column with no history of prior status
 * transitions (no approvedAt / delisted-at style timestamp), so there is no
 * reliable way to tell "this was once publicly approved and is now
 * permanently gone" (410) apart from "this has simply never been public"
 * (404). Guessing 410 without that evidence would misrepresent draft/
 * pending factories — which were never indexed in the first place — as
 * something that used to exist. If the data model ever gains a reliable
 * signal for "was previously approved, now permanently removed", that case
 * can return 410 instead.
 */
export async function buildFactoryMeta(rawId: string, pathname: string): Promise<FactoryMeta> {
  const url = `${SITE_BASE_URL}${pathname}`;
  const id = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return { ...GENERIC_FALLBACK, url, status: 404, noindex: true };
  }

  try {
    const factory = await db.getFactoryById(id);
    if (!factory || factory.status !== "approved") {
      return { ...GENERIC_FALLBACK, url, status: 404, noindex: true };
    }

    const title = buildTitle(factory.name);
    const description = buildDescription(factory);
    const image = await resolveFactoryImage(id, factory);

    return { title, description, image, url, status: 200, noindex: false };
  } catch (err) {
    console.error(
      `[ogMeta] buildFactoryMeta failed for factoryId=${rawId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return { ...GENERIC_FALLBACK, url, status: 200, noindex: false };
  }
}

function renderMetaHtml(meta: FactoryMeta): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);

  return [
    META_MARKER_START,
    ...(meta.noindex ? [`<meta name="robots" content="noindex">`] : []),
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    META_MARKER_END,
  ].join("\n    ");
}

/**
 * Replaces the static <title>/<meta description> with factory-specific
 * values, strips any previously-injected OG/Twitter block (so re-processing
 * the same string twice can never accumulate duplicates), and inserts the
 * new meta block right before </head>.
 */
export function injectMetaIntoHtml(html: string, meta: FactoryMeta): string {
  let out = html;

  const markerRe = new RegExp(`${META_MARKER_START}[\\s\\S]*?${META_MARKER_END}\\s*`, "g");
  out = out.replace(markerRe, "");

  const titleTag = `<title>${escapeHtml(meta.title)}</title>`;
  out = /<title>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/i, titleTag)
    : out.replace(/<\/head>/i, `  ${titleTag}\n  </head>`);

  const descTag = `<meta name="description" content="${escapeHtml(meta.description)}">`;
  out = /<meta\s+name=["']description["'][^>]*>/i.test(out)
    ? out.replace(/<meta\s+name=["']description["'][^>]*>/i, descTag)
    : out.replace(/<\/head>/i, `  ${descTag}\n  </head>`);

  const metaBlock = renderMetaHtml(meta);
  out = out.replace(/<\/head>/i, `  ${metaBlock}\n  </head>`);

  return out;
}
