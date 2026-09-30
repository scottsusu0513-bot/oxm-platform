/**
 * Batch 3.6：aiSearchIntents DB 快取的版本與新鮮度——真的走本機測試資料庫；
 * OpenAI 以 mock 取代。
 *   - 快取身分帶 SEARCH_INTENT_CACHE_VERSION 前綴：舊版本 rows 不再命中（不刪、不 migration）
 *   - 以 updatedAt（最後一次真正解析的時間）判斷新鮮度：一般 30 天、低信心 7 天
 *   - 命中時更新 hitCount 但保留 updatedAt（該欄有 ON UPDATE CURRENT_TIMESTAMP）
 *   - 過期後重新解析成功會刷新同一筆 row
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const provider = vi.hoisted(() => ({ calls: 0, confidence: 0.85, fail: false }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async () => {
          provider.calls++;
          if (provider.fail) throw Object.assign(new Error("5xx"), { status: 503 });
          return { choices: [{ message: { content: JSON.stringify({ mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: ["新結果"], searchSynonyms: [], confidence: provider.confidence }) } }] };
        },
      },
    };
  },
}));

import * as db from "./db";
import { ENV } from "./_core/env";
import {
  SEARCH_INTENT_CACHE_VERSION,
  __resetSearchIntentStateForTests,
  isSearchIntentFresh,
  resolveSearchIntent,
  searchIntentCacheIdentity,
  searchIntentTtlMs,
} from "./semantic-search";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const key = (label: string) => `sicv-${label}-${runId}`;
const DAY = 24 * 60 * 60 * 1000;

async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q); }
async function seedRow(normalizedQuery: string, confidence: number, ageDays: number) {
  await exec(sql`INSERT INTO aiSearchIntents (normalizedQuery, mainIndustries, subIndustries, productKeywords, searchSynonyms, confidence, updatedAt)
    VALUES (${normalizedQuery}, ${JSON.stringify(["塑膠"])}, '[]', ${JSON.stringify(["舊結果"])}, '[]', ${confidence}, NOW() - INTERVAL ${ageDays * 24} HOUR)`);
}
async function row(normalizedQuery: string) {
  const [rows] = (await exec(sql`SELECT hitCount, updatedAt, productKeywords FROM aiSearchIntents WHERE normalizedQuery = ${normalizedQuery}`)) as unknown as [{ hitCount: number; updatedAt: Date; productKeywords: string[] | string }[]];
  return rows[0] ?? null;
}
async function waitFor(fn: () => Promise<boolean>, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return false;
}

beforeEach(() => {
  (ENV as any).aiSearchProvider = "openai";
  (ENV as any).openaiApiKey = "test-key";
  provider.calls = 0;
  provider.confidence = 0.85;
  provider.fail = false;
  __resetSearchIntentStateForTests();
});
afterAll(async () => {
  await exec(sql`DELETE FROM aiSearchIntents WHERE normalizedQuery LIKE ${`%sicv-%-${runId}`}`);
});

describe("快取版本", () => {
  it("快取身分是明確的版本前綴（不是部署 hash）", () => {
    expect(SEARCH_INTENT_CACHE_VERSION).toMatch(/^v\d+$/);
    expect(searchIntentCacheIdentity("螺絲")).toBe(`${SEARCH_INTENT_CACHE_VERSION}:螺絲`);
  });

  it("版本不符：舊格式（無前綴）的新鮮 row 不會命中 → 重新呼叫 provider，舊 row 不被刪除", async () => {
    const k = key("legacy");
    await seedRow(k, 0.9, 0);
    const r = await resolveSearchIntent(k);
    expect(r.outcome).toBe("success");
    expect(provider.calls).toBe(1);
    expect(await row(k)).not.toBeNull();
    expect(await waitFor(async () => (await row(searchIntentCacheIdentity(k))) !== null)).toBe(true);
  });
});

describe("新鮮度（TTL）", () => {
  it("TTL：信心 ≥ 0.5 為 30 天，低信心 7 天", () => {
    expect(searchIntentTtlMs(0.9)).toBe(30 * DAY);
    expect(searchIntentTtlMs(0.5)).toBe(30 * DAY);
    expect(searchIntentTtlMs(0.49)).toBe(7 * DAY);
    const now = Date.now();
    expect(isSearchIntentFresh(new Date(now - 29 * DAY), 0.9, now)).toBe(true);
    expect(isSearchIntentFresh(new Date(now - 31 * DAY), 0.9, now)).toBe(false);
    expect(isSearchIntentFresh(new Date(now - 6 * DAY), 0.2, now)).toBe(true);
    expect(isSearchIntentFresh(new Date(now - 8 * DAY), 0.2, now)).toBe(false);
  });

  it("新鮮命中：不呼叫 provider；hitCount +1 但 updatedAt 不被刷新", async () => {
    const k = key("fresh");
    await seedRow(searchIntentCacheIdentity(k), 0.9, 10);
    const before = (await row(searchIntentCacheIdentity(k)))!;
    const r = await resolveSearchIntent(k);
    expect(r).toMatchObject({ outcome: "db_cache_hit", intent: { normalizedQuery: k, mainIndustries: ["塑膠"] } });
    expect(provider.calls).toBe(0);
    expect(await waitFor(async () => (await row(searchIntentCacheIdentity(k)))!.hitCount === before.hitCount + 1)).toBe(true);
    const after = (await row(searchIntentCacheIdentity(k)))!;
    expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
  });

  it("一般 intent 超過 30 天：視為 miss → 重新解析，成功後同一筆 row 被刷新（updatedAt 更新、內容更新）", async () => {
    const k = key("stale");
    await seedRow(searchIntentCacheIdentity(k), 0.9, 31);
    const r = await resolveSearchIntent(k);
    expect(r.outcome).toBe("success");
    expect(provider.calls).toBe(1);
    expect(await waitFor(async () => {
      const x = await row(searchIntentCacheIdentity(k));
      const kws = typeof x!.productKeywords === "string" ? JSON.parse(x!.productKeywords) : x!.productKeywords;
      return kws[0] === "新結果" && Date.now() - new Date(x!.updatedAt).getTime() < DAY;
    })).toBe(true);
  });

  it("低信心：8 天前 → 過期重新解析；6 天前 → 仍命中", async () => {
    const expired = key("low-expired"), fresh = key("low-fresh");
    await seedRow(searchIntentCacheIdentity(expired), 0.2, 8);
    await seedRow(searchIntentCacheIdentity(fresh), 0.2, 6);
    expect((await resolveSearchIntent(expired)).outcome).toBe("success");
    expect((await resolveSearchIntent(fresh)).outcome).toBe("db_cache_hit");
    expect(provider.calls).toBe(1);
  });

  it("過期 row＋provider 失敗 → fallback（intent=null），不寫 DB、舊 row 維持原樣", async () => {
    const k = key("fail");
    await seedRow(searchIntentCacheIdentity(k), 0.9, 40);
    const before = (await row(searchIntentCacheIdentity(k)))!;
    provider.fail = true;
    expect(await resolveSearchIntent(k)).toEqual({ intent: null, outcome: "provider_error" });
    await new Promise(r => setTimeout(r, 300));
    const after = (await row(searchIntentCacheIdentity(k)))!;
    expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
    expect(after.hitCount).toBe(before.hitCount);
  });
});
