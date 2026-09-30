/**
 * Batch 3.6：搜尋 intent 的行程內狀態——相同請求合併、有上限的記憶體快取、
 * 記憶體快取到期、provider 故障保護、OpenAI client 重用。DB 以 null 取代（只測
 * 行程內行為）；OpenAI 以 mock 取代，不打外部服務。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  constructed: 0,
  calls: [] as { key: string; signal: AbortSignal; maxRetries: number }[],
  behavior: null as null | ((key: string, signal: AbortSignal) => Promise<unknown>),
}));

vi.mock("openai", () => ({
  default: class {
    constructor() { provider.constructed++; }
    chat = {
      completions: {
        create: (body: { messages: { content: string }[] }, opts: { signal: AbortSignal; maxRetries: number }) => {
          const key = /使用者搜尋了：「(.*)」/.exec(body.messages[0].content)?.[1] ?? "";
          provider.calls.push({ key, signal: opts.signal, maxRetries: opts.maxRetries });
          return provider.behavior!(key, opts.signal);
        },
      },
    };
  },
}));
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getDb: vi.fn(async () => null) };
});
vi.mock("./ai/aiUsageLogging", () => ({ logAiModelCall: vi.fn(async () => {}) }));

import { ENV } from "./_core/env";
import { runWithAiCallContext } from "./ai/aiCallContext";
import {
  FAILURE_SHIELD_THRESHOLD,
  FAILURE_SHIELD_WINDOW_MS,
  SEARCH_INTENT_DEADLINE_MS,
  SEARCH_INTENT_LOW_CONFIDENCE_TTL_MS,
  SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES,
  SEARCH_INTENT_TTL_MS,
  __getSearchIntentStateForTests,
  __resetSearchIntentStateForTests,
  resolveSearchIntent,
} from "./semantic-search";
import { BoundedLruCache } from "./boundedLruCache";

const intentJson = (confidence = 0.85) => JSON.stringify({ mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: ["螺絲"], searchSynonyms: [], confidence });
const ok = (confidence = 0.85) => ({ choices: [{ message: { content: intentJson(confidence) } }] });
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const abortable = (signal: AbortSignal) => new Promise((_, reject) => {
  signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "APIUserAbortError" })));
});
let seq = 0;
const k = (label: string) => `ps-${label}-${Date.now()}-${++seq}`;

beforeEach(() => {
  (ENV as any).aiSearchProvider = "openai";
  (ENV as any).openaiApiKey = "test-key";
  provider.calls.length = 0;
  provider.constructed = 0;
  provider.behavior = async () => ok();
  __resetSearchIntentStateForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("相同請求合併（coalescing）", () => {
  it("同一個 keyword 同時 10 個請求 → provider 只呼叫 1 次，全部拿到同一份 intent", async () => {
    const d = deferred<unknown>();
    provider.behavior = () => d.promise;
    const key = k("same");
    const all = Promise.all(Array.from({ length: 10 }, () => resolveSearchIntent(key)));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    expect(__getSearchIntentStateForTests().inFlight).toBe(1);
    d.resolve(ok());
    const results = await all;
    expect(provider.calls).toHaveLength(1);
    for (const r of results) expect(r).toMatchObject({ outcome: "success", intent: { mainIndustries: ["金屬加工"] } });
    expect(__getSearchIntentStateForTests().inFlight).toBe(0);
    // 完成後同 key 命中記憶體快取
    expect((await resolveSearchIntent(key)).outcome).toBe("memory_cache_hit");
    expect(provider.calls).toHaveLength(1);
  });

  it("大小寫／前後空白正規化相同才合併；不同 keyword 不合併", async () => {
    const d = deferred<unknown>();
    provider.behavior = () => d.promise;
    const base = k("norm");
    const p = Promise.all([resolveSearchIntent(base), resolveSearchIntent(`  ${base.toUpperCase()} `), resolveSearchIntent(`${base}-other`)]);
    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    d.resolve(ok());
    await p;
    expect(new Set(provider.calls.map(c => c.key)).size).toBe(2);
  });

  it("provider 失敗 → 所有等待者都 fallback、in-flight 清除；之後重試會重新呼叫 provider", async () => {
    const d = deferred<unknown>();
    provider.behavior = () => d.promise;
    const key = k("fail");
    const p = Promise.all(Array.from({ length: 5 }, () => resolveSearchIntent(key)));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    d.reject(Object.assign(new Error("bad request"), { status: 400 }));
    for (const r of await p) expect(r).toEqual({ intent: null, outcome: "provider_error" });
    expect(__getSearchIntentStateForTests().inFlight).toBe(0);
    provider.behavior = async () => ok();
    expect((await resolveSearchIntent(key)).outcome).toBe("success");
    expect(provider.calls).toHaveLength(2);
  });

  it("timeout → 所有等待者都 fallback、in-flight 清除（沒有殘留 timer）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    provider.behavior = (_k, signal) => abortable(signal);
    const key = k("timeout");
    const p = Promise.all(Array.from({ length: 4 }, () => resolveSearchIntent(key)));
    await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS);
    for (const r of await p) expect(r).toEqual({ intent: null, outcome: "timeout" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal.aborted).toBe(true);
    expect(provider.calls[0].maxRetries).toBe(0);
    expect(__getSearchIntentStateForTests().inFlight).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("AI 助理（有 usage context）的請求不與公開搜尋合併，各自呼叫 provider", async () => {
    const d = deferred<unknown>();
    provider.behavior = () => d.promise;
    const key = k("ctx");
    const ctx = { turnId: 1, factoryId: null, actorUserId: 1 };
    const p = Promise.all([
      resolveSearchIntent(key),
      resolveSearchIntent(key),
      runWithAiCallContext(ctx, () => resolveSearchIntent(key)),
      runWithAiCallContext({ ...ctx, turnId: 2 }, () => resolveSearchIntent(key)),
    ]);
    await vi.waitFor(() => expect(provider.calls).toHaveLength(3));
    d.resolve(ok());
    await p;
    expect(provider.calls).toHaveLength(3); // 公開 2 個合併成 1 次＋context 2 次
  });
});

describe("有上限的記憶體快取（LRU）", () => {
  it("BoundedLruCache：容量、淘汰最舊、命中會更新順序", () => {
    const c = new BoundedLruCache<string, number>(3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.get("a")).toBe(1); // a 變成最新
    c.set("d", 4);              // 淘汰 b
    expect(c.has("b")).toBe(false);
    expect([c.has("a"), c.has("c"), c.has("d")]).toEqual([true, true, true]);
    expect(c.size).toBe(3);
    expect(() => new BoundedLruCache(0)).toThrow();
  });

  it(`resolveSearchIntent：上限 ${SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES} 筆，第 1001 個不同 key 淘汰最久未使用的`, async () => {
    const keys = Array.from({ length: SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES }, (_, i) => `lru-${seq}-${i}`);
    for (const key of keys) await resolveSearchIntent(key);
    expect(__getSearchIntentStateForTests().memoryCacheSize).toBe(SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES);
    expect((await resolveSearchIntent(keys[1])).outcome).toBe("memory_cache_hit"); // keys[1] 變成最新
    await resolveSearchIntent(`lru-${seq}-extra`);
    expect(__getSearchIntentStateForTests().memoryCacheSize).toBe(SEARCH_INTENT_MEMORY_CACHE_MAX_ENTRIES);
    const callsBefore = provider.calls.length;
    expect((await resolveSearchIntent(keys[1])).outcome).toBe("memory_cache_hit");
    expect((await resolveSearchIntent(keys[0])).outcome).toBe("success"); // 被淘汰 → 重新呼叫
    expect(provider.calls.length).toBe(callsBefore + 1);
  }, 30000);

  it("記憶體快取依信心有不同到期時間：一般 30 天、低信心 7 天", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-10-01T00:00:00Z").getTime();
    vi.setSystemTime(now);
    const high = k("high"), low = k("low");
    provider.behavior = async (key) => ok(key === low ? 0.2 : 0.9);
    await resolveSearchIntent(high);
    await resolveSearchIntent(low);
    vi.setSystemTime(now + SEARCH_INTENT_LOW_CONFIDENCE_TTL_MS + 1000);
    expect((await resolveSearchIntent(high)).outcome).toBe("memory_cache_hit");
    expect((await resolveSearchIntent(low)).outcome).toBe("success"); // 低信心已過期
    vi.setSystemTime(now + SEARCH_INTENT_TTL_MS + 1000);
    expect((await resolveSearchIntent(high)).outcome).toBe("success"); // 一般 intent 也過期
  });
});

describe("provider 故障保護", () => {
  const fail = (err: Error) => async () => { throw err; };

  it(`連續 ${FAILURE_SHIELD_THRESHOLD} 次 5xx／連線失敗 → ${FAILURE_SHIELD_WINDOW_MS / 1000}s 內直接 fallback，不再呼叫 provider；窗口後可重試；成功後重置`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-10-01T00:00:00Z").getTime();
    vi.setSystemTime(now);
    provider.behavior = fail(Object.assign(new Error("5xx"), { status: 503 }));
    await resolveSearchIntent(k("a"));
    provider.behavior = fail(Object.assign(new Error("net"), { name: "APIConnectionError" }));
    await resolveSearchIntent(k("b"));
    expect(__getSearchIntentStateForTests().failureShieldOpen).toBe(false);
    provider.behavior = fail(Object.assign(new Error("5xx"), { status: 500 }));
    await resolveSearchIntent(k("c"));
    expect(__getSearchIntentStateForTests().failureShieldOpen).toBe(true);

    const callsBefore = provider.calls.length;
    expect(await resolveSearchIntent(k("d"))).toEqual({ intent: null, outcome: "provider_unavailable" });
    expect(provider.calls.length).toBe(callsBefore);

    vi.setSystemTime(now + FAILURE_SHIELD_WINDOW_MS + 1);
    provider.behavior = async () => ok();
    expect((await resolveSearchIntent(k("e"))).outcome).toBe("success");
    expect(__getSearchIntentStateForTests()).toMatchObject({ failureShieldOpen: false, consecutiveProviderFailures: 0 });
  });

  it("timeout 也計入：連續 3 次 timeout 後第 4 次不呼叫 provider（fallback 原始 keyword）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    provider.behavior = (_k, signal) => abortable(signal);
    for (let i = 0; i < FAILURE_SHIELD_THRESHOLD; i++) {
      const p = resolveSearchIntent(k(`t${i}`));
      await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS);
      expect((await p).outcome).toBe("timeout");
    }
    const before = provider.calls.length;
    expect((await resolveSearchIntent(k("t-next"))).outcome).toBe("provider_unavailable");
    expect(provider.calls.length).toBe(before);
  });

  it("成功會把失敗計數歸零（中間夾一次成功就不會打開保護）", async () => {
    provider.behavior = fail(Object.assign(new Error("5xx"), { status: 502 }));
    await resolveSearchIntent(k("f1"));
    await resolveSearchIntent(k("f2"));
    provider.behavior = async () => ok();
    await resolveSearchIntent(k("ok"));
    provider.behavior = fail(Object.assign(new Error("5xx"), { status: 502 }));
    await resolveSearchIntent(k("f3"));
    expect(__getSearchIntentStateForTests()).toMatchObject({ failureShieldOpen: false, consecutiveProviderFailures: 1 });
  });

  it("4xx（金鑰／設定錯誤）與格式錯誤不打開保護：每次仍呼叫 provider，錯誤照常出現", async () => {
    provider.behavior = fail(Object.assign(new Error("unauthorized"), { status: 401 }));
    for (let i = 0; i < 5; i++) expect((await resolveSearchIntent(k(`u${i}`))).outcome).toBe("provider_error");
    provider.behavior = async () => ({ choices: [{ message: { content: "not json" } }] });
    for (let i = 0; i < 5; i++) expect((await resolveSearchIntent(k(`j${i}`))).outcome).toBe("invalid_output");
    expect(provider.calls).toHaveLength(10);
    expect(__getSearchIntentStateForTests().failureShieldOpen).toBe(false);
  });
});

describe("OpenAI client 重用", () => {
  it("多次呼叫共用同一個 client；API key 變更才重建；model／retries／signal 不變", async () => {
    for (let i = 0; i < 3; i++) await resolveSearchIntent(k(`c${i}`));
    expect(provider.constructed).toBe(1);
    (ENV as any).openaiApiKey = "rotated-key";
    await resolveSearchIntent(k("c-rotated"));
    expect(provider.constructed).toBe(2);
    for (const c of provider.calls) {
      expect(c.maxRetries).toBe(0);
      expect(c.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
