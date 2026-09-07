/**
 * SEO crawlability「Option 1 絕對安全版」— 只驗證「完全不會 paint、只進 <head>
 * 的不可見結構化資料」與「已撤掉的 semantic body 不再出現」。
 *
 * 涵蓋：
 *  - Factory /factory/:id：approved 工廠帶 Organization + BreadcrumbList JSON-LD，
 *    合法 parse、不含 aggregateRating／review／offers／priceRange／私有欄位；
 *    非 approved 不輸出任何 JSON-LD。
 *  - Industry /industry/:slug(/:sub)：BreadcrumbList JSON-LD 層級正確、canonical
 *    URL 正確、合法 parse；未知 slug 回 null。
 *  - 反向確認：News／Factory／Industry 的初始 HTML <div id="root"> 回到 baseline
 *    （空、無 data-oxm-prerendered="*-detail"），server/_core/vite.ts 內不再有
 *    任何 semantic body 注入。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as db from "./db";
import { buildFactoryMeta, buildNewsMeta, injectMetaIntoHtml } from "./_core/ogMeta";
import { buildIndustryBreadcrumbJsonLd, buildIndustryPageMeta } from "@shared/seo/industryPages";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const BASE_HTML = `<!doctype html>
<html lang="zh-TW"><head><meta charset="UTF-8" /><title>x</title><meta name="description" content="d"></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

// ─────────────────────────────────────────────────────────────────────────────
// D3 — Industry BreadcrumbList (pure, no DB)
// ─────────────────────────────────────────────────────────────────────────────
describe("buildIndustryBreadcrumbJsonLd (head-only, invisible)", () => {
  it("主產業頁：首頁 → 找工廠 → 主產業，item 皆為 canonical URL，合法 JSON", () => {
    const obj = buildIndustryBreadcrumbJsonLd("printing");
    expect(obj).not.toBeNull();
    const parsed = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("BreadcrumbList");
    const items = parsed.itemListElement as Array<Record<string, unknown>>;
    expect(items.map(i => i.name)).toEqual(["首頁", "找工廠", "印刷"]);
    expect(items[0].item).toBe("https://www.oxmmatch.com");
    expect(items[1].item).toBe("https://www.oxmmatch.com/search");
    expect(items[2].item).toBe("https://www.oxmmatch.com/industry/printing");
    expect(items.map(i => i.position)).toEqual([1, 2, 3]);
  });

  it("子產業頁：首頁 → 找工廠 → 主產業 → 子產業，最後一層指向子產業 canonical", () => {
    const obj = buildIndustryBreadcrumbJsonLd("electronics", "pcb");
    const parsed = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("BreadcrumbList");
    const items = parsed.itemListElement as Array<Record<string, unknown>>;
    expect(items.map(i => i.name)).toEqual(["首頁", "找工廠", "電子零件", "PCB / 電路板"]);
    expect(items[2].item).toBe("https://www.oxmmatch.com/industry/electronics");
    expect(items[3].item).toBe("https://www.oxmmatch.com/industry/electronics/pcb");
  });

  it("canonical mapping 與 buildIndustryPageMeta 一致（同一組現有 slug 常數）", () => {
    for (const [slug, sub] of [["printing", undefined], ["electronics", "pcb"], ["electronics", "smt-assembly"], ["food", "beverage-oem"]] as const) {
      const meta = buildIndustryPageMeta(slug, sub ?? undefined);
      const bc = buildIndustryBreadcrumbJsonLd(slug, sub ?? undefined) as Record<string, unknown>;
      const items = bc.itemListElement as Array<Record<string, unknown>>;
      expect(items[items.length - 1].item).toBe(meta!.canonical);
    }
  });

  it("未知 slug 回 null；已知主 slug + 未知子 slug 回 null", () => {
    expect(buildIndustryBreadcrumbJsonLd("not-a-real-industry")).toBeNull();
    expect(buildIndustryBreadcrumbJsonLd("electronics", "not-a-real-sub")).toBeNull();
  });

  it("不含 aggregateRating／review／offers／priceRange", () => {
    const s = JSON.stringify(buildIndustryBreadcrumbJsonLd("printing"));
    expect(s).not.toMatch(/aggregateRating|"review"|"offers"|priceRange/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D4 — no semantic body injection anywhere (source contract + behaviour)
// ─────────────────────────────────────────────────────────────────────────────
describe("no semantic body injection (News / Factory / Industry raw #root back to baseline)", () => {
  const viteSrc = fs.readFileSync(path.resolve(import.meta.dirname, "_core", "vite.ts"), "utf-8");

  it("server/_core/vite.ts 不再 import 或呼叫任何 semantic body 注入器", () => {
    expect(viteSrc).not.toContain("injectSemanticBodyHtml");
    expect(viteSrc).not.toContain("./semanticBody");
    expect(viteSrc).not.toContain("getNewsSemanticFragment");
    expect(viteSrc).not.toContain("getFactorySemanticFragment");
    expect(viteSrc).not.toContain("renderIndustrySemanticFragment");
  });

  it("server/_core/vite.ts 不含 news-detail／factory-detail／industry-detail 這些 marker", () => {
    expect(viteSrc).not.toContain('"news-detail"');
    expect(viteSrc).not.toContain('"factory-detail"');
    expect(viteSrc).not.toContain('"industry-detail"');
  });

  it("server/_core/semanticBody.ts 已刪除", () => {
    expect(fs.existsSync(path.resolve(import.meta.dirname, "_core", "semanticBody.ts"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — Factory structured data (+ D4 behaviour for news/factory/industry)
// ─────────────────────────────────────────────────────────────────────────────
const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let approvedOwnerId: number;
let pendingOwnerId: number;
let approvedFactoryId: number;
let pendingFactoryId: number;

beforeAll(async () => {
  approvedOwnerId = await ensureTestUser(`seo-sd-owner-a-${runId}`, "SEO SD Owner A");
  pendingOwnerId = await ensureTestUser(`seo-sd-owner-b-${runId}`, "SEO SD Owner B");
  approvedFactoryId = await createTestFactory(approvedOwnerId, `SEO結構化資料-已審核-${runId}`, "approved");
  pendingFactoryId = await createTestFactory(pendingOwnerId, `SEO結構化資料-待審核-${runId}`, "pending");
}, 30000);

afterAll(async () => {
  await deleteTestFactory(approvedFactoryId).catch(() => {});
  await deleteTestFactory(pendingFactoryId).catch(() => {});
  await deleteTestUser(approvedOwnerId).catch(() => {});
  await deleteTestUser(pendingOwnerId).catch(() => {});
});

describe("buildFactoryMeta structured data (head-only, invisible)", () => {
  it("approved 工廠：jsonLd = [Organization, BreadcrumbList]，合法 JSON", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    expect(meta.status).toBe(200);
    expect(Array.isArray(meta.jsonLd)).toBe(true);
    const arr = JSON.parse(JSON.stringify(meta.jsonLd)) as Array<Record<string, unknown>>;
    expect(arr.map(x => x["@type"])).toEqual(["Organization", "BreadcrumbList"]);
    expect(arr[0].name).toContain(`SEO結構化資料-已審核-${runId}`);
    expect(arr[0].url).toBe(`https://www.oxmmatch.com/factory/${approvedFactoryId}`);
    expect(arr[0]["@id"]).toBe(`https://www.oxmmatch.com/factory/${approvedFactoryId}#organization`);
  });

  it("Organization 只含公開/存在的欄位，不含 aggregateRating／review／offers／priceRange／sameAs", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    const s = JSON.stringify(meta.jsonLd);
    expect(s).not.toMatch(/aggregateRating|"review"|"offers"|priceRange|"sameAs"|"telephone"|"email"|taxId|統一編號|adminNote|ownerId/i);
    const org = (meta.jsonLd as Array<Record<string, unknown>>)[0];
    const allowed = new Set(["@context", "@type", "@id", "name", "url", "description", "image", "areaServed", "knowsAbout"]);
    for (const k of Object.keys(org)) expect(allowed.has(k)).toBe(true);
  });

  it("BreadcrumbList：首頁在第一層，最後一層 = 工廠頁 canonical", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    const bc = (meta.jsonLd as Array<Record<string, unknown>>)[1];
    const items = bc.itemListElement as Array<Record<string, unknown>>;
    expect(items[0].name).toBe("首頁");
    expect(items[items.length - 1].item).toBe(`https://www.oxmmatch.com/factory/${approvedFactoryId}`);
  });

  it("非 approved 工廠：status 404、不帶 jsonLd（維持既有行為）", async () => {
    const meta = await buildFactoryMeta(String(pendingFactoryId), `/factory/${pendingFactoryId}`);
    expect(meta.status).toBe(404);
    expect(meta.jsonLd).toBeUndefined();
  });

  it("無效 id：status 404、不帶 jsonLd", async () => {
    const meta = await buildFactoryMeta("999999999", "/factory/999999999");
    expect(meta.status).toBe(404);
    expect(meta.jsonLd).toBeUndefined();
  });
});

describe("News / Factory / Industry 初始 HTML 的 <div id=\"root\"> 回到 baseline（無 semantic body）", () => {
  it("approved factory：injectMetaIntoHtml 後 #root 仍為空、無 data-oxm-prerendered", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    const out = injectMetaIntoHtml(BASE_HTML, meta);
    expect(out).toContain('<div id="root"></div>');
    expect(out).not.toContain('data-oxm-prerendered="factory-detail"');
    expect(out).not.toContain("data-oxm-prerendered");
    // 但 <head> 有工廠結構化資料
    expect(out).toContain('<script type="application/ld+json">');
    expect(out).toContain('"@type":"Organization"');
  });

  it("published news：injectMetaIntoHtml 後 #root 仍為空、無 data-oxm-prerendered", async () => {
    // 找一筆現有 published 消息（測試 DB 有 batch 匯入資料）；沒有就跳過本斷言
    const rows = await db.listPublicNews({ category: "all", limit: 1, offset: 0 });
    const slug = rows.items[0]?.slug;
    if (!slug) return;
    const meta = await buildNewsMeta(slug, `/news/${slug}`);
    const out = injectMetaIntoHtml(BASE_HTML, meta);
    expect(out).toContain('<div id="root"></div>');
    expect(out).not.toContain('data-oxm-prerendered="news-detail"');
    expect(out).not.toContain("data-oxm-prerendered");
  });

  it("industry meta（含 breadcrumb jsonLd）注入後 #root 仍為空、無 data-oxm-prerendered", () => {
    const meta = buildIndustryPageMeta("printing")!;
    const out = injectMetaIntoHtml(BASE_HTML, {
      title: meta.title,
      description: meta.description,
      image: "https://www.oxmmatch.com/og-image.png",
      url: meta.canonical,
      status: 200,
      noindex: false,
      jsonLd: buildIndustryBreadcrumbJsonLd("printing") ?? undefined,
    });
    expect(out).toContain('<div id="root"></div>');
    expect(out).not.toContain('data-oxm-prerendered="industry-detail"');
    expect(out).not.toContain("data-oxm-prerendered");
    expect(out).toContain('"@type":"BreadcrumbList"');
  });
});
