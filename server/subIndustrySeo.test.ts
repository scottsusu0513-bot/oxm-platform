/**
 * 子產業 SEO 完整化：全台子產業（/factories/:subIndustrySlug）與地區 × 子產業
 * （/factories/:region/:subIndustrySlug）。
 *
 * 涵蓋任務定案的三種頁面狀態（跟 regionIndustrySeo.test.ts 的地區 × 主產業
 * 完全同一套規則）：
 *   A. 合法 slug + 至少 1 家 approved 公開工廠 → 200 + index
 *   B. 合法 slug，但目前 0 家 → 200 + noindex（不是 404）
 *   C. 非法 slug → 真 404 + noindex
 *
 * 以及：
 *   - route parser／resolver 純函式（parseSubIndustryPath／resolveSubIndustry／
 *     resolveRegionSubIndustry／buildSubIndustryPageContent／
 *     buildRegionSubIndustryPageContent）
 *   - /factories/:region/:second 第二段消歧義（resolveFactoriesTwoSegment／
 *     buildFactoriesTwoSegmentMeta）：主產業 URL 完全不變、子產業 URL 正確解析、
 *     非法 slug 兩者都試不到才 404
 *   - 「塑膠包裝」parent-aware collision：兩個 SEO 頁的 existence 判斷／候選
 *     工廠集合必須各自獨立，不能因為 label 相同就互相污染
 *   - sitemap.xml 只收「目前有效」組合、單一查詢不做 N+1
 *   - DB 驅動的 0 → 1 → 0 自動變化
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import {
  hasApprovedFactoryForSubIndustry, hasApprovedFactoryForRegionSubIndustry,
  getApprovedIndustrySubIndustryCombosForSitemap, getApprovedRegionIndustrySubIndustryCombosForSitemap,
} from "./db";
import { buildRegionIndustryMeta, buildSubIndustryMeta, buildRegionSubIndustryMeta, buildFactoriesTwoSegmentMeta } from "./_core/ogMeta";
import {
  parseSubIndustryPath, resolveSubIndustry, buildSubIndustryPageContent,
  resolveRegionSubIndustry, buildRegionSubIndustryPageContent,
} from "@shared/seo/subIndustryPages";
import { resolveFactoriesTwoSegment } from "@shared/seo/factoriesPathResolver";
import { REGION_SLUGS, SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL } from "@shared/constants";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

const compostable = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL["永續材料|||可堆肥材料"]!;
const plasticPackaging = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL["塑膠|||塑膠包裝"]!;
const packagingPlasticMaterials = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL["包裝|||塑膠包裝"]!;

// ============================================================
// 純函式：parse／resolve／content builder
// ============================================================
describe("parseSubIndustryPath", () => {
  it("解析合法單段路徑", () => {
    expect(parseSubIndustryPath("/factories/cnc-machining")).toEqual({ subIndustrySlug: "cnc-machining" });
  });

  it("忽略結尾斜線", () => {
    expect(parseSubIndustryPath("/factories/cnc-machining/")).toEqual({ subIndustrySlug: "cnc-machining" });
  });

  it("兩段路徑（地區 × 產業）回傳 null，不會被誤判成單段子產業", () => {
    expect(parseSubIndustryPath("/factories/taichung/metal-processing")).toBeNull();
  });

  it("非 /factories/ 路徑回傳 null", () => {
    expect(parseSubIndustryPath("/industry/metal-processing")).toBeNull();
  });
});

describe("resolveSubIndustry", () => {
  it("合法 slug 解析出正確的 entry", () => {
    const resolved = resolveSubIndustry("cnc-machining");
    expect(resolved).not.toBeNull();
    expect(resolved!.entry.label).toBe("CNC加工 / 精密加工");
    expect(resolved!.entry.parentIndustry).toBe("金屬加工");
  });

  it("非法 slug 回傳 null", () => {
    expect(resolveSubIndustry("not-a-real-sub-industry")).toBeNull();
  });
});

describe("resolveRegionSubIndustry", () => {
  it("合法 region + 合法子產業 slug 全部可解析", () => {
    const resolved = resolveRegionSubIndustry("taichung", "cnc-machining");
    expect(resolved).not.toBeNull();
    expect(resolved!.regionName).toBe("台中市");
    expect(resolved!.entry.label).toBe("CNC加工 / 精密加工");
  });

  it("非法 region slug 回傳 null", () => {
    expect(resolveRegionSubIndustry("banana", "cnc-machining")).toBeNull();
  });

  it("非法子產業 slug 回傳 null", () => {
    expect(resolveRegionSubIndustry("taichung", "not-a-real-sub-industry")).toBeNull();
  });

  it("displayRegionName 拿掉市／縣尾綴，regionName 維持完整 canonical 值", () => {
    const resolved = resolveRegionSubIndustry("taichung", "cnc-machining")!;
    expect(resolved.regionName).toBe("台中市");
    expect(resolved.displayRegionName).toBe("台中");
  });
});

describe("buildSubIndustryPageContent：CNC加工 定案範例", () => {
  const resolved = resolveSubIndustry("cnc-machining")!;
  const content = buildSubIndustryPageContent(resolved);

  it("H1", () => expect(content.h1).toBe("CNC加工廠"));
  it("Title 含品牌與 displayName", () => {
    expect(content.title).toContain("CNC加工");
    expect(content.title).toContain("OXM");
  });
  it("Canonical 自我指向 /factories/cnc-machining", () => {
    expect(content.canonical).toBe("https://www.oxmmatch.com/factories/cnc-machining");
  });
  it("不同子產業的 title 彼此不同", () => {
    const other = buildSubIndustryPageContent(resolveSubIndustry("pcb")!);
    expect(other.title).not.toBe(content.title);
  });
  it("intro 不含主觀／不可驗證敘述", () => {
    for (const forbidden of ["最推薦", "最完整", "最便宜", "最專業", "最大"]) {
      expect(content.intro).not.toContain(forbidden);
    }
  });
});

describe("buildRegionSubIndustryPageContent：台中 CNC加工 定案範例", () => {
  const resolved = resolveRegionSubIndustry("taichung", "cnc-machining")!;
  const content = buildRegionSubIndustryPageContent(resolved);

  it("H1", () => expect(content.h1).toBe("台中CNC加工廠"));
  it("Canonical 自我指向 /factories/taichung/cnc-machining", () => {
    expect(content.canonical).toBe("https://www.oxmmatch.com/factories/taichung/cnc-machining");
  });
  it("不同地區的 title 彼此不同", () => {
    const other = buildRegionSubIndustryPageContent(resolveRegionSubIndustry("kaohsiung", "cnc-machining")!);
    expect(other.title).not.toBe(content.title);
  });
});

// ============================================================
// /factories/:region/:second 第二段消歧義
// ============================================================
describe("resolveFactoriesTwoSegment：主產業 URL 完全不變，子產業 URL 正確解析", () => {
  it("第二段是既有主產業 slug → kind 'industry'，resolved 內容跟 resolveRegionIndustry 直接呼叫一致", () => {
    const result = resolveFactoriesTwoSegment("taichung", "metal-processing");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("industry");
    if (result!.kind === "industry") {
      expect(result!.resolved.industryName).toBe("金屬加工");
    }
  });

  it("第二段是新的子產業 slug → kind 'subIndustry'", () => {
    const result = resolveFactoriesTwoSegment("taichung", "cnc-machining");
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("subIndustry");
    if (result!.kind === "subIndustry") {
      expect(result!.resolved.entry.label).toBe("CNC加工 / 精密加工");
    }
  });

  it("第二段兩者都試不到（非法 slug）→ null", () => {
    expect(resolveFactoriesTwoSegment("taichung", "not-a-real-slug")).toBeNull();
  });

  it("region slug 非法 → null（不論第二段是不是合法主產業／子產業 slug）", () => {
    expect(resolveFactoriesTwoSegment("banana", "metal-processing")).toBeNull();
    expect(resolveFactoriesTwoSegment("banana", "cnc-machining")).toBeNull();
  });
});

describe("buildFactoriesTwoSegmentMeta：主產業分支輸出跟直接呼叫 buildRegionIndustryMeta 逐位元組相同（不能改壞既有頁面）", () => {
  it("台中 × 金屬加工", async () => {
    const viaDispatcher = await buildFactoriesTwoSegmentMeta("taichung", "metal-processing", "/factories/taichung/metal-processing");
    const direct = await buildRegionIndustryMeta("taichung", "metal-processing", "/factories/taichung/metal-processing");
    expect(viaDispatcher).toEqual(direct);
  });

  it("子產業分支：台中 × CNC加工，跟直接呼叫 buildRegionSubIndustryMeta 一致", async () => {
    const viaDispatcher = await buildFactoriesTwoSegmentMeta("taichung", "cnc-machining", "/factories/taichung/cnc-machining");
    const direct = await buildRegionSubIndustryMeta("taichung", "cnc-machining", "/factories/taichung/cnc-machining");
    expect(viaDispatcher).toEqual(direct);
  });

  it("非法第二段 slug → 真 404 + noindex", async () => {
    const meta = await buildFactoriesTwoSegmentMeta("taichung", "not-a-real-slug", "/factories/taichung/not-a-real-slug");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

// ============================================================
// 三種頁面狀態（C：非法 slug 一律真 404）
// ============================================================
describe("buildSubIndustryMeta：非法 slug → 真 404 + noindex", () => {
  it("非法子產業 slug", async () => {
    const meta = await buildSubIndustryMeta("not-a-real-slug", "/factories/not-a-real-slug");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildRegionSubIndustryMeta：非法 slug → 真 404 + noindex", () => {
  it("非法 region slug", async () => {
    const meta = await buildRegionSubIndustryMeta("banana", "cnc-machining", "/factories/banana/cnc-machining");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("非法子產業 slug", async () => {
    const meta = await buildRegionSubIndustryMeta("taichung", "not-a-real-slug", "/factories/taichung/not-a-real-slug");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

// ============================================================
// sitemap.xml：只收有效組合、單一查詢、不逐組合各打一次 DB
// ============================================================
describe("sitemap.xml 產生邏輯（server/_core/index.ts）：子產業", () => {
  const source = readSource("server", "_core", "index.ts");
  const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
  const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";

  it("既有的地區 x 主產業 entries 仍在（沒有被本輪改動誤刪）", () => {
    expect(sitemapSource).toContain("getApprovedRegionIndustryCombosForSitemap");
  });

  it("新增了全台子產業與地區 x 子產業的 DB-driven entries", () => {
    expect(sitemapSource).toContain("getApprovedIndustrySubIndustryCombosForSitemap");
    expect(sitemapSource).toContain("getApprovedRegionIndustrySubIndustryCombosForSitemap");
    expect(sitemapSource).toContain("SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL");
    expect(sitemapSource).toMatch(/\$\{BASE\}\/factories\/\$\{slug\}/);
    expect(sitemapSource).toMatch(/\$\{BASE\}\/factories\/\$\{regionSlug\}\/\$\{entry_\.slug\}/);
  });

  it("全台子產業查詢只呼叫一次（不是逐子產業各打一次 DB 的 N+1）", () => {
    const occurrences = sitemapSource.match(/getApprovedIndustrySubIndustryCombosForSitemap\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("地區 x 子產業查詢只呼叫一次", () => {
    const occurrences = sitemapSource.match(/getApprovedRegionIndustrySubIndustryCombosForSitemap\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("DB 暫時不可用時安全跳過（有 try/catch 包住）", () => {
    // 錨定在實際呼叫點（帶括號），不是上面說明用途的註解文字（註解本身也會
    // 提到函式名稱，但離 catch 太遠，用呼叫點才能準確定位程式碼區塊）。
    expect(sitemapSource).toMatch(/getApprovedIndustrySubIndustryCombosForSitemap\(\)[\s\S]{0,700}catch/);
    expect(sitemapSource).toMatch(/getApprovedRegionIndustrySubIndustryCombosForSitemap\(\)[\s\S]{0,700}catch/);
  });
});

describe("getApprovedIndustrySubIndustryCombosForSitemap／getApprovedRegionIndustrySubIndustryCombosForSitemap：單一查詢", () => {
  const dbSource = readSource("server", "db.ts");

  it("getApprovedIndustrySubIndustryCombosForSitemap 只有一次 db.select 呼叫", () => {
    const fnMatch = dbSource.match(/export async function getApprovedIndustrySubIndustryCombosForSitemap[\s\S]*?\n\}/);
    const fnSource = fnMatch ? fnMatch[0] : "";
    expect(fnSource.length).toBeGreaterThan(0);
    const selectCalls = fnSource.match(/db\.select\(/g) ?? [];
    expect(selectCalls.length).toBe(1);
    expect(fnSource).toMatch(/eq\(factories\.status,\s*'approved'\)/);
  });

  it("getApprovedRegionIndustrySubIndustryCombosForSitemap 只有一次 db.select 呼叫", () => {
    const fnMatch = dbSource.match(/export async function getApprovedRegionIndustrySubIndustryCombosForSitemap[\s\S]*?\n\}/);
    const fnSource = fnMatch ? fnMatch[0] : "";
    expect(fnSource.length).toBeGreaterThan(0);
    const selectCalls = fnSource.match(/db\.select\(/g) ?? [];
    expect(selectCalls.length).toBe(1);
    expect(fnSource).toMatch(/eq\(factories\.status,\s*'approved'\)/);
  });

  it("hasApprovedFactoryForSubIndustry／hasApprovedFactoryForRegionSubIndustry 都用 LIMIT 1", () => {
    const subFn = dbSource.match(/export async function hasApprovedFactoryForSubIndustry[\s\S]*?\n\}/)?.[0] ?? "";
    const regionSubFn = dbSource.match(/export async function hasApprovedFactoryForRegionSubIndustry[\s\S]*?\n\}/)?.[0] ?? "";
    expect(subFn).toContain(".limit(1)");
    expect(regionSubFn).toContain(".limit(1)");
  });
});

// ============================================================
// 「塑膠包裝」parent-aware collision：existence／候選工廠集合必須各自獨立
// ============================================================
describe("塑膠包裝 parent-aware collision：兩個 SEO 頁的候選工廠集合互不污染", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let plasticOwnerId: number;
  let packagingOwnerId: number;
  let plasticFactoryId: number;
  let packagingFactoryId: number;

  beforeAll(async () => {
    plasticOwnerId = await ensureTestUser(`pp-plastic-owner-${runId}`, `塑膠包裝collision測試-塑膠-${runId}`);
    packagingOwnerId = await ensureTestUser(`pp-packaging-owner-${runId}`, `塑膠包裝collision測試-包裝-${runId}`);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");

    // 工廠 A：只掛「塑膠」主產業，子產業選「塑膠包裝」——應該只出現在
    // /factories/plastic-packaging，不該出現在 /factories/packaging-plastic-materials。
    const [resultA] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${plasticOwnerId}, ${`塑膠包裝collision-塑膠-${runId}`}, ${JSON.stringify(["塑膠"])}, ${JSON.stringify(["OEM"])}, "澎湖縣", "<1000萬", ${`地址-${runId}`}, "approved", "normal", FALSE, ${JSON.stringify(["塑膠包裝"])}, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    plasticFactoryId = resultA.insertId;

    // 工廠 B：只掛「包裝」主產業，子產業選「塑膠包裝」——應該只出現在
    // /factories/packaging-plastic-materials，不該出現在 /factories/plastic-packaging。
    const [resultB] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${packagingOwnerId}, ${`塑膠包裝collision-包裝-${runId}`}, ${JSON.stringify(["包裝"])}, ${JSON.stringify(["OEM"])}, "澎湖縣", "<1000萬", ${`地址-${runId}`}, "approved", "normal", FALSE, ${JSON.stringify(["塑膠包裝"])}, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    packagingFactoryId = resultB.insertId;
  }, 30000);

  afterAll(async () => {
    const conn = await db.getDb();
    if (conn) {
      await conn.execute(sql`DELETE FROM factories WHERE id IN (${plasticFactoryId}, ${packagingFactoryId})`);
    }
    await deleteTestUser(plasticOwnerId);
    await deleteTestUser(packagingOwnerId);
  }, 30000);

  it("hasApprovedFactoryForSubIndustry('塑膠', '塑膠包裝') 為 true（工廠 A 存在）", async () => {
    expect(await hasApprovedFactoryForSubIndustry("塑膠", "塑膠包裝")).toBe(true);
  });

  it("hasApprovedFactoryForSubIndustry('包裝', '塑膠包裝') 為 true（工廠 B 存在）", async () => {
    expect(await hasApprovedFactoryForSubIndustry("包裝", "塑膠包裝")).toBe(true);
  });

  it("buildSubIndustryMeta('plastic-packaging') 是 index（工廠 A 讓塑膠側符合），buildSubIndustryMeta('packaging-plastic-materials') 也是 index（工廠 B 讓包裝側符合）——兩者互相獨立成立，不是同一個判斷結果", async () => {
    const plasticMeta = await buildSubIndustryMeta(plasticPackaging.slug, `/factories/${plasticPackaging.slug}`);
    const packagingMeta = await buildSubIndustryMeta(packagingPlasticMaterials.slug, `/factories/${packagingPlasticMaterials.slug}`);
    expect(plasticMeta.noindex).toBe(false);
    expect(packagingMeta.noindex).toBe(false);
    // 兩頁 canonical／title 各自獨立，不是同一頁
    expect(plasticMeta.url).not.toBe(packagingMeta.url);
    expect(plasticMeta.title).not.toBe(packagingMeta.title);
  });

  it("sitemap 的 industry×subIndustry 組合清單同時包含 (塑膠, 塑膠包裝) 與 (包裝, 塑膠包裝) 兩筆獨立資料", async () => {
    const combos = await getApprovedIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.industry === "塑膠" && c.subIndustry === "塑膠包裝")).toBe(true);
    expect(combos.some(c => c.industry === "包裝" && c.subIndustry === "塑膠包裝")).toBe(true);
  });
});

// ============================================================
// DB 驅動 SEO 狀態：0 → 1 → 0 全自動（全台子產業 + 地區 × 子產業）
// ============================================================
describe("DB 驅動的 0 → 1 → 0 自動切換：全台子產業（永續材料 / 可堆肥材料，刻意選冷門子產業避免撞到真實資料）", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let ownerId: number;
  let factoryId: number;
  const pathname = `/factories/${compostable.slug}`;

  beforeAll(async () => {
    ownerId = await ensureTestUser(`sub-industry-seo-owner-${runId}`, `子產業SEO測試擁有者-${runId}`);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [result] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${ownerId}, ${`子產業SEO測試-${runId}`}, ${JSON.stringify([compostable.parentIndustry])}, ${JSON.stringify(["ODM"])}, "連江縣", "<1000萬", ${`子產業SEO測試地址-${runId}`}, "pending", "normal", FALSE, ${JSON.stringify([compostable.label])}, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    factoryId = result.insertId;
  }, 30000);

  afterAll(async () => {
    const conn = await db.getDb();
    if (conn) await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    await deleteTestUser(ownerId);
  }, 30000);

  it("前提：建立時是 pending，目前應該是 0（noindex，不在 sitemap）", async () => {
    const has = await hasApprovedFactoryForSubIndustry(compostable.parentIndustry, compostable.label);
    expect(has).toBe(false);

    const meta = await buildSubIndustryMeta(compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(false);
  });

  it("0 → 1：核准後不需要重新 build/deploy，下一次查詢就自動變成 index + 出現在 sitemap", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForSubIndustry(compostable.parentIndustry, compostable.label);
    expect(has).toBe(true);

    const meta = await buildSubIndustryMeta(compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);

    const combos = await getApprovedIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(true);
  });

  it("0 → 1 的 title／canonical 是這個子產業專屬內容（不是 generic fallback）", async () => {
    const meta = await buildSubIndustryMeta(compostable.slug, pathname);
    const expectedContent = buildSubIndustryPageContent(resolveSubIndustry(compostable.slug)!);
    expect(meta.title).toBe(expectedContent.title);
    expect(meta.url).toBe(expectedContent.canonical);
  });

  it("1 → 0：下架後自動變回 noindex 且從 sitemap 消失，仍是 200（不是 404，不 redirect）", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'delisted', deletedAt = NOW() WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForSubIndustry(compostable.parentIndustry, compostable.label);
    expect(has).toBe(false);

    const meta = await buildSubIndustryMeta(compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(false);
  });
});

describe("DB 驅動的 0 → 1 → 0 自動切換：地區 × 子產業（連江縣 / 可堆肥材料）", () => {
  const region = "連江縣";
  const regionSlug = REGION_SLUGS[region];
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let ownerId: number;
  let factoryId: number;
  const pathname = `/factories/${regionSlug}/${compostable.slug}`;

  beforeAll(async () => {
    ownerId = await ensureTestUser(`region-sub-industry-seo-owner-${runId}`, `地區子產業SEO測試擁有者-${runId}`);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [result] = await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${ownerId}, ${`地區子產業SEO測試-${runId}`}, ${JSON.stringify([compostable.parentIndustry])}, ${JSON.stringify(["ODM"])}, ${region}, "<1000萬", ${`地區子產業SEO測試地址-${runId}`}, "pending", "normal", FALSE, ${JSON.stringify([compostable.label])}, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    factoryId = result.insertId;
  }, 30000);

  afterAll(async () => {
    const conn = await db.getDb();
    if (conn) await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    await deleteTestUser(ownerId);
  }, 30000);

  it("前提：0（noindex，不在 sitemap）", async () => {
    const has = await hasApprovedFactoryForRegionSubIndustry(region, compostable.parentIndustry, compostable.label);
    expect(has).toBe(false);

    const meta = await buildRegionSubIndustryMeta(regionSlug, compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedRegionIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(false);
  });

  it("0 → 1：核准後自動變成 index + 出現在 sitemap，也能透過 resolveFactoriesTwoSegment／buildFactoriesTwoSegmentMeta 正確解析", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForRegionSubIndustry(region, compostable.parentIndustry, compostable.label);
    expect(has).toBe(true);

    const meta = await buildRegionSubIndustryMeta(regionSlug, compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);

    const viaDispatcher = await buildFactoriesTwoSegmentMeta(regionSlug, compostable.slug, pathname);
    expect(viaDispatcher).toEqual(meta);

    const combos = await getApprovedRegionIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(true);
  });

  it("1 → 0：下架後自動變回 noindex 且從 sitemap 消失", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'delisted', deletedAt = NOW() WHERE id = ${factoryId}`);

    const has = await hasApprovedFactoryForRegionSubIndustry(region, compostable.parentIndustry, compostable.label);
    expect(has).toBe(false);

    const meta = await buildRegionSubIndustryMeta(regionSlug, compostable.slug, pathname);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);

    const combos = await getApprovedRegionIndustrySubIndustryCombosForSitemap();
    expect(combos.some(c => c.region === region && c.industry === compostable.parentIndustry && c.subIndustry === compostable.label)).toBe(false);
  });
});
