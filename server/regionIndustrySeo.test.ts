/**
 * 「地區 × 主產業 SEO Landing Page」（/factories/:region/:industry）。
 *
 * 涵蓋任務定案的三種頁面狀態：
 *   A. 合法 region + 合法 industry + 至少 1 家 approved 公開工廠 → 200 + index
 *   B. 合法 region + 合法 industry，但目前 0 家 → 200 + noindex（不是 404）
 *   C. 非法 region 或非法 industry slug → 真 404 + noindex
 *
 * 以及：
 *   - REGION_SLUGS 與 TAIWAN_REGIONS 的 22/22 覆蓋率、0 重複、雙向可逆
 *   - route parser／meta 產生純函式（parseRegionIndustryPath／
 *     resolveRegionIndustry／buildRegionIndustryPageContent）
 *   - sitemap.xml 只收「目前有效」組合、單一查詢不做 N+1
 *   - DB 驅動的 0 → 1 → 0 自動變化（不需要重新 build／deploy）
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import {
  hasApprovedFactoryForRegionIndustry,
  getApprovedRegionIndustryCombosForSitemap,
} from "./db";
import { buildRegionIndustryMeta } from "./_core/ogMeta";
import { injectMetaIntoHtml, DEFAULT_OG_IMAGE } from "./_core/ogMeta";
import { injectDynamicSemanticBody } from "./_core/prerenderedBody";
import {
  parseRegionIndustryPath,
  resolveRegionIndustry,
  buildRegionIndustryPageContent,
} from "@shared/seo/regionIndustryPages";
import { TAIWAN_REGIONS, REGION_SLUGS, REGION_SLUG_TO_NAME, INDUSTRY_SLUGS } from "@shared/constants";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

// ============================================================
// Region slug mapping：22/22 覆蓋率、0 missing、0 extra、0 duplicate、雙向可逆
// ============================================================
describe("REGION_SLUGS：與 TAIWAN_REGIONS 的對照完整性", () => {
  it("REGION_SLUGS 的 key 與 TAIWAN_REGIONS 完全一致（0 missing、0 extra）", () => {
    const regionKeys = new Set(Object.keys(REGION_SLUGS));
    const canonicalNames = new Set(TAIWAN_REGIONS);
    expect(regionKeys.size).toBe(22);
    expect(canonicalNames.size).toBe(22);
    for (const name of TAIWAN_REGIONS) expect(regionKeys.has(name)).toBe(true);
    for (const name of regionKeys) expect(canonicalNames.has(name as any)).toBe(true);
  });

  it("22 個 slug 彼此都不相同（0 duplicate）", () => {
    const slugs = Object.values(REGION_SLUGS);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBe(22);
  });

  it("每個 slug 都能反查回正確的 canonical 縣市值", () => {
    for (const name of TAIWAN_REGIONS) {
      const slug = REGION_SLUGS[name];
      expect(slug).toBeTruthy();
      expect(REGION_SLUG_TO_NAME[slug]).toBe(name);
    }
  });

  it("符合使用者定案的正式 mapping（逐筆比對）", () => {
    expect(REGION_SLUGS).toEqual({
      "台北市": "taipei",
      "新北市": "new-taipei",
      "基隆市": "keelung",
      "桃園市": "taoyuan",
      "新竹市": "hsinchu-city",
      "新竹縣": "hsinchu-county",
      "苗栗縣": "miaoli",
      "台中市": "taichung",
      "彰化縣": "changhua",
      "南投縣": "nantou",
      "雲林縣": "yunlin",
      "嘉義市": "chiayi-city",
      "嘉義縣": "chiayi-county",
      "台南市": "tainan",
      "高雄市": "kaohsiung",
      "屏東縣": "pingtung",
      "宜蘭縣": "yilan",
      "花蓮縣": "hualien",
      "台東縣": "taitung",
      "澎湖縣": "penghu",
      "金門縣": "kinmen",
      "連江縣": "lienchiang",
    });
  });
});

// ============================================================
// Route parser（client／server 共用純函式）
// ============================================================
describe("parseRegionIndustryPath", () => {
  it("解析合法路徑", () => {
    expect(parseRegionIndustryPath("/factories/taichung/metal-processing")).toEqual({
      regionSlug: "taichung",
      industrySlug: "metal-processing",
    });
  });

  it("忽略結尾斜線", () => {
    expect(parseRegionIndustryPath("/factories/taichung/metal-processing/")).toEqual({
      regionSlug: "taichung",
      industrySlug: "metal-processing",
    });
  });

  it("非 /factories/ 路徑回傳 null", () => {
    expect(parseRegionIndustryPath("/search")).toBeNull();
    expect(parseRegionIndustryPath("/factory/1")).toBeNull();
    expect(parseRegionIndustryPath("/industry/metal-processing")).toBeNull();
    expect(parseRegionIndustryPath("/")).toBeNull();
  });

  it("段數不對（只有一段或超過兩段）回傳 null", () => {
    expect(parseRegionIndustryPath("/factories/taichung")).toBeNull();
    expect(parseRegionIndustryPath("/factories/taichung/metal-processing/extra")).toBeNull();
  });
});

describe("resolveRegionIndustry：直接 reuse 既有 INDUSTRY_SLUGS，不建立第二份產業對照表", () => {
  it("合法組合：22 縣市 x 13 主產業全部可解析", () => {
    for (const regionName of TAIWAN_REGIONS) {
      for (const industryName of Object.keys(INDUSTRY_SLUGS)) {
        const regionSlug = REGION_SLUGS[regionName];
        const industrySlug = INDUSTRY_SLUGS[industryName];
        const resolved = resolveRegionIndustry(regionSlug, industrySlug);
        expect(resolved).not.toBeNull();
        expect(resolved!.regionName).toBe(regionName);
        expect(resolved!.industryName).toBe(industryName);
      }
    }
  });

  it("非法 region slug 回傳 null", () => {
    expect(resolveRegionIndustry("banana", "metal-processing")).toBeNull();
  });

  it("非法 industry slug 回傳 null", () => {
    expect(resolveRegionIndustry("taichung", "not-a-real-industry")).toBeNull();
  });

  it("兩者皆非法回傳 null", () => {
    expect(resolveRegionIndustry("banana", "not-a-real-industry")).toBeNull();
  });

  it("displayRegionName 拿掉市／縣尾綴，但 regionName 維持完整 canonical 值", () => {
    const resolved = resolveRegionIndustry("taichung", "metal-processing")!;
    expect(resolved.regionName).toBe("台中市");
    expect(resolved.displayRegionName).toBe("台中");
  });
});

// ============================================================
// SEO 文案 template（台中市 + 金屬加工 的定案範例）
// ============================================================
describe("buildRegionIndustryPageContent：台中市 + 金屬加工 定案範例", () => {
  const resolved = resolveRegionIndustry("taichung", "metal-processing")!;
  const content = buildRegionIndustryPageContent(resolved);

  it("H1", () => {
    expect(content.h1).toBe("台中金屬加工廠");
  });

  it("Title", () => {
    expect(content.title).toBe("台中金屬加工廠｜工廠搜尋與合作媒合｜OXM");
  });

  it("Description", () => {
    expect(content.description).toBe(
      "尋找台中金屬加工廠？透過 OXM 查看台中市金屬加工相關工廠與製造商資訊，快速尋找適合的合作夥伴。"
    );
  });

  it("Intro（server 端動態注入初始 HTML 用的短文案）", () => {
    expect(content.intro).toBe(
      "正在尋找台中市金屬加工工廠？OXM 整理台中地區相關製造商與工廠資訊，可查看工廠服務與基本資料，尋找適合的合作夥伴。"
    );
  });

  it("Canonical 自我指向 /factories/taichung/metal-processing", () => {
    expect(content.canonical).toBe("https://www.oxmmatch.com/factories/taichung/metal-processing");
  });

  it("不同組合的 title 彼此不同（不會被判斷為重複頁面）", () => {
    const other = buildRegionIndustryPageContent(resolveRegionIndustry("changhua", "plastic")!);
    expect(other.title).not.toBe(content.title);
  });
});

// ============================================================
// 初始 HTML 注入（injectMetaIntoHtml + injectDynamicSemanticBody）
// ============================================================
describe("初始 HTML 注入：title／description／canonical／robots／H1／intro", () => {
  const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

  const resolved = resolveRegionIndustry("taichung", "metal-processing")!;
  const content = buildRegionIndustryPageContent(resolved);

  it("index 狀態（noindex:false）：title／canonical 正確，不含 robots noindex", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: content.title,
      description: content.description,
      image: DEFAULT_OG_IMAGE,
      url: content.canonical,
      status: 200,
      noindex: false,
    });
    expect(html).toContain(`<title>${content.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${content.canonical}">`);
    expect(html).not.toContain('name="robots"');
  });

  it("noindex 狀態（0 筆結果，仍是 200）：canonical 仍自我指向，且有 robots noindex", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: content.title,
      description: content.description,
      image: DEFAULT_OG_IMAGE,
      url: content.canonical,
      status: 200,
      noindex: true,
    });
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`<link rel="canonical" href="${content.canonical}">`);
  });

  it("injectDynamicSemanticBody：把 H1／intro 動態注入 <div id=\"root\">（不是 build-time 靜態檔）", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: content.title,
      description: content.description,
      image: DEFAULT_OG_IMAGE,
      url: content.canonical,
      status: 200,
      noindex: false,
    });
    const withBody = injectDynamicSemanticBody(html, content.h1, content.intro, "region-industry");
    expect(withBody).not.toBeNull();
    expect(withBody!).toContain(`<h1>${content.h1}</h1>`);
    expect(withBody!).toContain(content.intro);
    expect(withBody!).toContain('data-oxm-prerendered="region-industry"');
  });

  it("找不到 <div id=\"root\"></div> 時安全回傳 null，不拋錯", () => {
    expect(injectDynamicSemanticBody("<html><body>no root here</body></html>", "H1", "intro", "region-industry")).toBeNull();
  });
});

// ============================================================
// sitemap.xml：只收目前有效組合、單一查詢、不影響既有 entries
// ============================================================
describe("sitemap.xml 產生邏輯（server/_core/index.ts）：地區 x 主產業", () => {
  const source = readSource("server", "_core", "index.ts");
  const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
  const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";

  it("sitemap route 本身仍存在（沒有被誤刪）", () => {
    expect(sitemapSource.length).toBeGreaterThan(0);
  });

  it("既有的固定頁／主產業頁／子產業頁／工廠頁／消息頁 entries 都還在", () => {
    expect(sitemapSource).toContain("${BASE}/`");
    expect(sitemapSource).toContain("getApprovedFactoriesForSitemap");
    expect(sitemapSource).toContain("INDUSTRY_SLUGS");
    expect(sitemapSource).toContain("PHASE1_SUB_INDUSTRY_PAGES");
    expect(sitemapSource).toContain("getPublishedNewsForSitemap");
  });

  it("新增了地區 x 主產業的 DB-driven entries", () => {
    expect(sitemapSource).toContain("getApprovedRegionIndustryCombosForSitemap");
    expect(sitemapSource).toContain("REGION_SLUGS");
    expect(sitemapSource).toMatch(/\$\{BASE\}\/factories\/\$\{regionSlug\}\/\$\{industrySlug\}/);
  });

  it("地區 x 主產業查詢只呼叫一次（不是逐組合各打一次 DB 的 N+1）", () => {
    const occurrences = sitemapSource.match(/getApprovedRegionIndustryCombosForSitemap\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("地區 x 主產業迴圈本身沒有 lastmod（沒有真實逐組合更新時間可查，不得偽造 today）", () => {
    const comboLoopMatch = sitemapSource.match(/for \(const \{ region, industry \} of regionIndustryCombos\)[\s\S]*?\n {6}\}/);
    expect(comboLoopMatch).toBeTruthy();
    expect(comboLoopMatch![0]).not.toContain("today");
  });

  it("DB 暫時不可用時安全跳過（有 try/catch 包住），不會讓整份 sitemap 500", () => {
    expect(sitemapSource).toMatch(/getApprovedRegionIndustryCombosForSitemap[\s\S]{0,400}catch/);
  });

  it("DB 裡對不到任何已知 slug 的 region／industry（歷史髒資料／legacy 值）安全 skip，不是硬塞進 URL", () => {
    const comboLoopMatch = sitemapSource.match(/for \(const \{ region, industry \} of regionIndustryCombos\)[\s\S]*?\n {6}\}/);
    expect(comboLoopMatch).toBeTruthy();
    expect(comboLoopMatch![0]).toMatch(/if\s*\(\s*!regionSlug\s*\|\|\s*!industrySlug\s*\)\s*continue;/);
  });
});

describe("getApprovedRegionIndustryCombosForSitemap：對未知 legacy region／industry 值的安全處理（DB 層不驗證 slug，交給呼叫端 skip）", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let ownerId: number;
  let factoryId: number;

  beforeAll(async () => {
    ownerId = await ensureTestUser(`legacy-region-owner-${runId}`, `legacy地區測試擁有者-${runId}`);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    // 故意寫入一個不在 REGION_SLUGS／TAIWAN_REGIONS 裡的 region 字串，模擬
    // 歷史髒資料或未來欄位異動——factories.region 只是 varchar，沒有 DB 層級
    // 的 enum 限制，這裡驗證的是「即使真的出現這種資料，sitemap 也不會壞」。
    const [result] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${ownerId}, ${`legacy地區測試-${runId}`}, ${JSON.stringify(["金屬加工"])}, ${JSON.stringify(["OEM"])}, "舊資料無效地區XYZ", "<1000萬", ${`legacy地區測試地址-${runId}`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    factoryId = result.insertId;
  });

  afterAll(async () => {
    const conn = await db.getDb();
    if (conn) await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    await deleteTestUser(ownerId);
  });

  it("getApprovedRegionIndustryCombosForSitemap 對這種資料不拋錯，原樣回傳（DB 層不做 slug 驗證）", async () => {
    const combos = await getApprovedRegionIndustryCombosForSitemap();
    expect(combos.some(c => c.region === "舊資料無效地區XYZ" && c.industry === "金屬加工")).toBe(true);
  });

  it("這個 legacy region 對不到任何 REGION_SLUGS（正是 sitemap 迴圈 continue 的判斷依據）", () => {
    expect(REGION_SLUGS["舊資料無效地區XYZ"]).toBeUndefined();
  });
});

describe("getApprovedRegionIndustryCombosForSitemap：單一查詢，不對每個組合各打一次 DB", () => {
  const dbSource = readSource("server", "db.ts");
  const fnMatch = dbSource.match(/export async function getApprovedRegionIndustryCombosForSitemap[\s\S]*?\n\}/);
  const fnSource = fnMatch ? fnMatch[0] : "";

  it("函式存在", () => {
    expect(fnSource.length).toBeGreaterThan(0);
  });

  it("只查 status='approved'，沿用既有 public/approved 規則，不重新定義", () => {
    expect(fnSource).toMatch(/eq\(factories\.status,\s*'approved'\)/);
  });

  it("只有一次 db.select 呼叫（不是在迴圈裡逐一查詢）", () => {
    const selectCalls = fnSource.match(/db\.select\(/g) ?? [];
    expect(selectCalls.length).toBe(1);
  });
});

describe("hasApprovedFactoryForRegionIndustry：輕量 existence 查詢，沿用既有 approved 規則", () => {
  const dbSource = readSource("server", "db.ts");
  const fnMatch = dbSource.match(/export async function hasApprovedFactoryForRegionIndustry[\s\S]*?\n\}/);
  const fnSource = fnMatch ? fnMatch[0] : "";

  it("函式存在，且用 LIMIT 1（不是完整 searchFactories 那種分頁查詢）", () => {
    expect(fnSource.length).toBeGreaterThan(0);
    expect(fnSource).toContain(".limit(1)");
  });

  it("approved 條件與 searchFactories／getApprovedFactoriesForSitemap 完全一致", () => {
    expect(fnSource).toMatch(/eq\(factories\.status,\s*'approved'\)/);
  });
});

// ============================================================
// 三種頁面狀態（C：非法 slug 一律真 404）
// ============================================================
describe("buildRegionIndustryMeta：非法 slug → 真 404 + noindex（不洩漏是哪個 slug 不合法）", () => {
  it("非法 region slug", async () => {
    const meta = await buildRegionIndustryMeta("banana", "metal-processing", "/factories/banana/metal-processing");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("非法 industry slug", async () => {
    const meta = await buildRegionIndustryMeta("taichung", "not-a-real-industry", "/factories/taichung/not-a-real-industry");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("兩者皆非法", async () => {
    const meta = await buildRegionIndustryMeta("banana", "not-a-real-industry", "/factories/banana/not-a-real-industry");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

// ============================================================
// DB 驅動 SEO 狀態：0 → 1 → 0 全自動（不需要 build／deploy／人工修改 sitemap）
// ============================================================
describe("DB 驅動的 0 → 1 → 0 自動切換（合法組合，目前刻意選用極冷門組合避免撞到真實資料）", () => {
  // 連江縣（22 縣市中最冷門）x 永續材料（13 主產業中最新、最冷門）：
  // 用來把「這個組合原本沒有任何 approved 工廠」當作可驗證的前提，而不是
  // 用假設。若這個前提意外不成立（baseline 不是 false），代表測試環境本身
  // 有非預期資料，這裡刻意讓測試失敗以浮現問題，不做靜默容錯。
  const region = "連江縣";
  const industry = "永續材料";
  const regionSlug = REGION_SLUGS[region];
  const industrySlug = INDUSTRY_SLUGS[industry];
  const pathname = `/factories/${regionSlug}/${industrySlug}`;

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let ownerId: number;
  let factoryId: number;

  beforeAll(async () => {
    ownerId = await ensureTestUser(`region-industry-seo-owner-${runId}`, `地區產業SEO測試擁有者-${runId}`);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [result] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${ownerId}, ${`地區產業SEO測試-${runId}`}, ${JSON.stringify([industry])}, ${JSON.stringify(["ODM"])}, ${region}, "<1000萬", ${`地區產業SEO測試地址-${runId}`}, "pending", "normal", FALSE, "[]", NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    factoryId = result.insertId;
  });

  afterAll(async () => {
    const conn = await db.getDb();
    if (conn) await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    await deleteTestUser(ownerId);
  });

  it("前提：建立時是 pending，這個組合目前應該是 0（noindex，不在 sitemap）", async () => {
    const has = await hasApprovedFactoryForRegionIndustry(region, industry);
    expect(has).toBe(false);

    const meta = await buildRegionIndustryMeta(regionSlug, industrySlug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedRegionIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === industry)).toBe(false);
  });

  it("0 → 1：核准後（status 改為 approved），不需要重新 build/deploy，下一次查詢就自動變成 index + 出現在 sitemap", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForRegionIndustry(region, industry);
    expect(has).toBe(true);

    const meta = await buildRegionIndustryMeta(regionSlug, industrySlug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
  });

  it("0 → 1 的正確 title／canonical 是這個地區產業組合專屬的內容（不是 generic fallback）", async () => {
    const meta = await buildRegionIndustryMeta(regionSlug, industrySlug, pathname);
    const expectedContent = buildRegionIndustryPageContent(resolveRegionIndustry(regionSlug, industrySlug)!);
    expect(meta.title).toBe(expectedContent.title);
    expect(meta.url).toBe(expectedContent.canonical);
  });

  it("0 → 1：出現在 sitemap 的 distinct 組合清單中", async () => {
    const combos = await getApprovedRegionIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === industry)).toBe(true);
  });

  it("1 → 0：下架（status 改為 delisted，比照既有下架邏輯 status='delisted'）後，自動變回 noindex 且從 sitemap 消失，URL／HTTP 狀態不變（仍是 200，不是 404，不 redirect）", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'delisted', deletedAt = NOW() WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForRegionIndustry(region, industry);
    expect(has).toBe(false);

    const meta = await buildRegionIndustryMeta(regionSlug, industrySlug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedRegionIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === industry)).toBe(false);
  });
});
