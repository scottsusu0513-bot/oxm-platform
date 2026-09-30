/**
 * factory.search 的 AI 失敗 fallback（Production Hardening Batch 3.2 Phase 2）
 * — router 層整合測試，真的走本機測試資料庫；OpenAI SDK 以 mock 取代，永遠
 * 不打外部服務。Batch 3.6 起舊的 Anthropic enhanceSearchKeyword 路徑與
 * @anthropic-ai/sdk dependency 已完全移除（見最後的結構合約）。
 *
 * 修改前（Batch 3.2 Phase 1 本機實測）：OpenAI 卡住 → 2.5s 邏輯 timeout →
 * 依序再呼叫 Anthropic enhanceSearchKeyword（5s 邏輯 timeout）→ 7,566ms 才回應。
 * 修改後：OpenAI 硬期限 3.5s 真正中止 → 直接用原始 keyword 走非 AI 搜尋，
 * 不再呼叫 Anthropic。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const calls = vi.hoisted(() => ({
  openai: [] as { signal: AbortSignal; maxRetries: number }[],
  behavior: null as null | ((signal: AbortSignal) => Promise<unknown>),
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: (_b: unknown, opts: { signal: AbortSignal; maxRetries: number }) => { calls.openai.push(opts); return calls.behavior!(opts.signal); } } };
  },
}));

import * as db from "./db";
import { appRouter } from "./routers";
import { ENV } from "./_core/env";
import type { TrpcContext } from "./_core/context";
import { SEARCH_INTENT_DEADLINE_MS, __resetSearchIntentStateForTests } from "./semantic-search";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const KW = `SAFB${runId}`;
const ownerIds: number[] = [];
const factoryIds: number[] = [];

const ctx = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext);
const hangUntilAbort = (signal: AbortSignal) => new Promise((_, reject) => {
  signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "APIUserAbortError" })));
});

beforeAll(async () => {
  const conn = (await db.getDb())!;
  for (let i = 0; i < 3; i++) {
    const ownerId = await ensureTestUser(`safb-${i}-${runId}`, `fallback 測試 ${i}`);
    ownerIds.push(ownerId);
    const [r] = (await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, address, status, operationStatus, certified, subIndustry, avgRating, reviewCount)
      VALUES (${ownerId}, ${`fallback 工廠 ${i} ${runId}`}, ${JSON.stringify(["金屬加工"])}, '["OEM"]', '新竹市', ${`專做 ${KW} 相關零件 ${i}`}, '<1000萬', '地址', 'approved', 'normal', FALSE, '[]', ${`${4 - i}.00`}, ${i})
    `)) as unknown as [{ insertId: number }, unknown];
    factoryIds.push(r.insertId);
  }
});
afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of factoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    await conn.execute(sql`DELETE FROM aiSearchIntents WHERE normalizedQuery LIKE ${`%${runId.toLowerCase()}%`}`);
  }
  for (const id of ownerIds) await deleteTestUser(id);
});
beforeEach(() => {
  (ENV as any).aiSearchProvider = "openai";
  (ENV as any).openaiApiKey = "test-key";
  calls.openai.length = 0;
  __resetSearchIntentStateForTests();
});

describe("factory.search：AI intent 失敗 → 直接用原始 keyword 走非 AI 搜尋", () => {
  it("D／E＋AC：OpenAI 卡住 → 3.5s 硬期限中止，不呼叫 Anthropic，結果＝非 AI keyword 搜尋", async () => {
    calls.behavior = hangUntilAbort;
    const t0 = Date.now();
    const r = await appRouter.createCaller(ctx()).factory.search({ keyword: KW, page: 1, pageSize: 20 });
    const elapsed = Date.now() - t0;
    console.log(`[Batch 3.2] AFTER cold-timeout factory.search elapsed=${elapsed}ms (before: 7566ms)`);
    expect(calls.openai).toHaveLength(1);
    expect(calls.openai[0].signal.aborted).toBe(true);
    expect(calls.openai[0].maxRetries).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(SEARCH_INTENT_DEADLINE_MS - 50);
    expect(elapsed).toBeLessThan(SEARCH_INTENT_DEADLINE_MS + 2000); // 不再有 +5s 的 Anthropic 等待
    const expected = await db.searchFactories({ keyword: KW, page: 1, pageSize: 20, intent: null, userHasSelectedIndustry: false });
    expect(r.total).toBe(3);
    expect(r.items.map(i => i.id)).toEqual(expected.items.map(i => i.id));
  }, 20000);

  it("F／G／H：provider 立即失敗（429／500／網路）→ 不等 deadline，立即 fallback，不呼叫 Anthropic", async () => {
    for (const err of [Object.assign(new Error("rate"), { status: 429 }), Object.assign(new Error("5xx"), { status: 500 }), new Error("fetch failed")]) {
      calls.behavior = async () => { throw err; };
      const t0 = Date.now();
      const r = await appRouter.createCaller(ctx()).factory.search({ keyword: KW, page: 1, pageSize: 20 });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.total).toBe(3);
    }
  }, 20000);

  it("I：invalid JSON → 非 AI keyword 搜尋、不是 500、不是空結果", async () => {
    calls.behavior = async () => ({ choices: [{ message: { content: "not json" } }] });
    const r = await appRouter.createCaller(ctx()).factory.search({ keyword: KW, page: 1, pageSize: 20 });
    expect(r.total).toBe(3);
  });

  it("冷 AI 成功：結果與「同一份 intent 直接交給 searchFactories」完全相同（AI 成功語意不變）", async () => {
    const intentJson = { mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: [KW], searchSynonyms: [], confidence: 0.9 };
    calls.behavior = async () => ({ choices: [{ message: { content: JSON.stringify(intentJson) } }] });
    const kw = `${KW}成功`;
    const r = await appRouter.createCaller(ctx()).factory.search({ keyword: kw, page: 1, pageSize: 20 });
    expect(calls.openai).toHaveLength(1);
    expect(calls.openai[0].signal.aborted).toBe(false);
    const expected = await db.searchFactories({
      keyword: kw, page: 1, pageSize: 20, userHasSelectedIndustry: false,
      intent: { normalizedQuery: kw.toLowerCase(), ...intentJson },
    });
    expect(r.total).toBe(expected.total);
    expect(r.items.map(i => i.id)).toEqual(expected.items.map(i => i.id));
  });

  it("結構合約：舊的 Anthropic enhanceSearchKeyword／searchCache 路徑與 @anthropic-ai/sdk 已完全移除", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), "utf-8");
    expect(read("routers.ts")).not.toMatch(/enhanceSearchKeyword\s*\(|import\s*\{[^}]*enhanceSearchKeyword/);
    const semantic = read("semantic-search.ts");
    expect(semantic).not.toMatch(/function enhanceSearchKeyword|from ['"]@anthropic-ai\/sdk['"]|\(searchCache\)|new Map<string, string>\(\)/);
    const pkg = JSON.parse(read("../package.json"));
    expect(pkg.dependencies?.["@anthropic-ai/sdk"]).toBeUndefined();
  });
});
