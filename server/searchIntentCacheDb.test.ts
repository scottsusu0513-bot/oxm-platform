/**
 * 搜尋 intent 的 DB 快取行為（Production Hardening Batch 3.2 Phase 2）— 真的走
 * 本機測試資料庫的 aiSearchIntents；OpenAI 以 mock 取代。
 *   P. DB 快取命中 → 不呼叫 provider
 *   N. 成功 → 寫入 aiSearchIntents
 *   L／M. timeout／provider error → 不寫 aiSearchIntents（也沒有晚到的成功去寫）
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const provider = vi.hoisted(() => ({
  behavior: null as null | ((signal: AbortSignal) => Promise<unknown>),
  calls: 0,
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: (_b: unknown, opts: { signal: AbortSignal }) => { provider.calls++; return provider.behavior!(opts.signal); } } };
  },
}));

import * as db from "./db";
import { ENV } from "./_core/env";
import { resolveSearchIntent, SEARCH_INTENT_DEADLINE_MS, searchIntentCacheIdentity, __resetSearchIntentStateForTests } from "./semantic-search";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const key = (label: string) => `sicdb-${label}-${runId}`;
const VALID = JSON.stringify({ mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: ["螺絲"], searchSynonyms: [], confidence: 0.85 });

async function intentRow(k: string) {
  const conn = (await db.getDb())!;
  // Batch 3.6：DB 快取身分帶版本前綴（見 searchIntentCacheIdentity）
  const [rows] = (await conn.execute(sql`SELECT normalizedQuery, hitCount FROM aiSearchIntents WHERE normalizedQuery = ${searchIntentCacheIdentity(k)}`)) as unknown as [{ normalizedQuery: string; hitCount: number }[], unknown];
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
  __resetSearchIntentStateForTests();
});
afterAll(async () => {
  const conn = await db.getDb();
  if (conn) await conn.execute(sql`DELETE FROM aiSearchIntents WHERE normalizedQuery LIKE ${`%sicdb-%-${runId}`}`);
});

describe("aiSearchIntents DB 快取", () => {
  it("P：DB 快取命中 → 使用快取 intent，不呼叫 provider", async () => {
    const k = key("p");
    const conn = (await db.getDb())!;
    await conn.execute(sql`INSERT INTO aiSearchIntents (normalizedQuery, mainIndustries, subIndustries, productKeywords, searchSynonyms, confidence)
      VALUES (${searchIntentCacheIdentity(k)}, ${JSON.stringify(["塑膠"])}, '[]', ${JSON.stringify(["射出"])}, '[]', 0.9)`);
    provider.behavior = async () => { throw new Error("must not be called"); };
    const r = await resolveSearchIntent(k);
    expect(r.outcome).toBe("db_cache_hit");
    expect(r.intent?.mainIndustries).toEqual(["塑膠"]);
    expect(provider.calls).toBe(0);
  });

  it("N：provider 成功 → 寫入 aiSearchIntents", async () => {
    const k = key("n");
    provider.behavior = async () => ({ choices: [{ message: { content: VALID } }] });
    expect((await resolveSearchIntent(k)).outcome).toBe("success");
    expect(await waitFor(async () => (await intentRow(k)) !== null)).toBe(true);
  });

  it("M：provider error → 不寫 aiSearchIntents", async () => {
    const k = key("m");
    provider.behavior = async () => { throw Object.assign(new Error("server error"), { status: 500 }); };
    expect((await resolveSearchIntent(k)).outcome).toBe("provider_error");
    await new Promise(r => setTimeout(r, 300));
    expect(await intentRow(k)).toBeNull();
  });

  it("L：timeout（真實 deadline）→ 請求被中止、不寫 aiSearchIntents，之後也沒有晚到的寫入", async () => {
    const k = key("l");
    let aborted = false;
    provider.behavior = (signal) => new Promise((resolve, reject) => {
      // 若沒有被中止，會在 deadline 之後「晚到成功」——正確實作下這條路徑不可能發生
      const late = setTimeout(() => resolve({ choices: [{ message: { content: VALID } }] }), SEARCH_INTENT_DEADLINE_MS + 500);
      signal.addEventListener("abort", () => { aborted = true; clearTimeout(late); reject(Object.assign(new Error("aborted"), { name: "APIUserAbortError" })); });
    });
    const t0 = Date.now();
    const r = await resolveSearchIntent(k);
    const elapsed = Date.now() - t0;
    expect(r).toEqual({ intent: null, outcome: "timeout" });
    expect(aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(SEARCH_INTENT_DEADLINE_MS - 50);
    expect(elapsed).toBeLessThan(SEARCH_INTENT_DEADLINE_MS + 1000);
    await new Promise(r => setTimeout(r, 800));
    expect(await intentRow(k)).toBeNull();
  }, 15000);
});
