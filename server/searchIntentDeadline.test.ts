/**
 * 搜尋 intent 的硬期限與真正中止（Production Hardening Batch 3.2 Phase 2）。
 *
 * Phase 1：getSearchIntent 用 Promise.race 做 2.5s「邏輯」timeout，沒有把
 * AbortSignal 傳給 OpenAI SDK——timeout 後底層 HTTP 請求仍在背景跑（SDK 預設
 * 10 分鐘 timeout＋2 次自動重試），晚到的結果也不會被快取；timer 從不清除。
 *
 * 這裡用 mock 的 OpenAI（不打真服務）＋fake timers，決定性驗證：
 *   - deadline 到期時傳給 SDK 的 AbortSignal 真的 aborted
 *   - maxRetries: 0 只套用在這個請求
 *   - timeout／429／5xx／網路錯誤／invalid JSON／invalid schema → intent=null
 *   - 失敗不寫快取；成功寫快取；快取命中不呼叫 provider
 *   - 每種結果之後都沒有殘留的 timer
 * DB 在這個檔案裡固定回傳 null（純記憶體路徑）；DB 快取行為見
 * server/searchIntentCacheDb.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Behavior = (signal: AbortSignal) => Promise<unknown>;
const provider = vi.hoisted(() => ({
  behavior: null as null | ((signal: AbortSignal) => Promise<unknown>),
  calls: [] as { body: any; opts: any }[],
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: (body: unknown, opts: { signal: AbortSignal }) => {
          provider.calls.push({ body, opts });
          return provider.behavior!(opts?.signal);
        },
      },
    };
  },
}));
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, getDb: vi.fn(async () => null) };
});

import { ENV } from "./_core/env";
import { resolveSearchIntent, getSearchIntent, SEARCH_INTENT_DEADLINE_MS } from "./semantic-search";

const okResponse = (content: string | null) => ({ choices: [{ message: { content } }], usage: undefined });
const VALID = JSON.stringify({ mainIndustries: ["金屬加工"], subIndustries: [], productKeywords: ["螺絲"], searchSynonyms: [], confidence: 0.85 });
/** 不會自己完成，只在 signal abort 時以 SDK 同樣的方式 reject。 */
const hangUntilAbort: Behavior = (signal) => new Promise((_, reject) => {
  signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })));
});
const after = (ms: number, value: () => unknown): Behavior => (signal) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(value()), ms);
  signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })); });
});
const rejectWith = (err: Error): Behavior => async () => { throw err; };

let seq = 0;
const freshKey = () => `deadline-test-${Date.now()}-${++seq}`;

beforeEach(() => {
  (ENV as any).aiSearchProvider = "openai";
  (ENV as any).openaiApiKey = "test-key";
  provider.calls.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("硬期限與真正中止", () => {
  it("deadline 是 3.5s（Batch 3.2 選定值，不超過 3.5s）", () => {
    expect(SEARCH_INTENT_DEADLINE_MS).toBe(3500);
  });

  it("A：AI 立即成功 → 使用 AI intent，signal 未 abort，沒有殘留 timer", async () => {
    provider.behavior = async () => okResponse(VALID);
    const r = await resolveSearchIntent(freshKey());
    expect(r.outcome).toBe("success");
    expect(r.intent?.mainIndustries).toEqual(["金屬加工"]);
    expect(provider.calls[0].opts.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("B：deadline − 100ms 成功 → 使用 AI intent（邊界不誤判 timeout）", async () => {
    provider.behavior = after(SEARCH_INTENT_DEADLINE_MS - 100, () => okResponse(VALID));
    const p = resolveSearchIntent(freshKey());
    await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS - 100);
    const r = await p;
    expect(r.outcome).toBe("success");
    expect(provider.calls[0].opts.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("C：deadline + 100ms 才會回應 → deadline 到期時 AbortSignal 真的 aborted，回傳 null（timeout）", async () => {
    provider.behavior = after(SEARCH_INTENT_DEADLINE_MS + 100, () => okResponse(VALID));
    const p = resolveSearchIntent(freshKey());
    await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS - 1);
    expect(provider.calls[0].opts.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(provider.calls[0].opts.signal.aborted).toBe(true);
    expect(r).toEqual({ intent: null, outcome: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("C：provider 永遠不回應 → 恰好在 deadline 中止並 fallback", async () => {
    provider.behavior = hangUntilAbort;
    const p = resolveSearchIntent(freshKey());
    await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS);
    expect(await p).toEqual({ intent: null, outcome: "timeout" });
    expect(provider.calls[0].opts.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("H（retry）：search intent 請求明確設定 maxRetries: 0，並帶 signal", async () => {
    provider.behavior = async () => okResponse(VALID);
    await resolveSearchIntent(freshKey());
    expect(provider.calls[0].opts.maxRetries).toBe(0);
    expect(provider.calls[0].opts.signal).toBeInstanceOf(AbortSignal);
    expect(provider.calls[0].body.model).toBe(ENV.aiSearchModel);
  });
});

describe("provider 失敗 → 立即 fallback（不等完整 deadline）", () => {
  const cases: [string, Error][] = [
    ["F：429", Object.assign(new Error("Rate limit"), { status: 429 })],
    ["G：500", Object.assign(new Error("Internal error"), { status: 500 })],
    ["H：network error", Object.assign(new Error("fetch failed"), { name: "APIConnectionError" })],
  ];
  for (const [label, err] of cases) {
    it(`${label} → intent=null（provider_error），沒有推進任何時間，沒有殘留 timer`, async () => {
      provider.behavior = rejectWith(err);
      const r = await resolveSearchIntent(freshKey());
      expect(r).toEqual({ intent: null, outcome: "provider_error" });
      expect(provider.calls[0].opts.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("I：invalid JSON → intent=null（invalid_output）", async () => {
    provider.behavior = async () => okResponse("not json {");
    expect(await resolveSearchIntent(freshKey())).toEqual({ intent: null, outcome: "invalid_output" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("J：invalid schema（JSON 陣列／欄位型別錯誤）→ intent=null（invalid_output）", async () => {
    provider.behavior = async () => okResponse("[1,2,3]");
    expect((await resolveSearchIntent(freshKey())).outcome).toBe("invalid_output");
    provider.behavior = async () => okResponse(JSON.stringify({ mainIndustries: "金屬加工", confidence: 0.9 }));
    expect((await resolveSearchIntent(freshKey())).outcome).toBe("invalid_output");
  });

  it("K：搜尋 intent 關閉／空白 keyword → null，不呼叫 provider", async () => {
    expect(await getSearchIntent("   ")).toBeNull();
    (ENV as any).aiSearchProvider = "disabled";
    expect(await resolveSearchIntent(freshKey())).toEqual({ intent: null, outcome: "disabled" });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("快取", () => {
  it("L：timeout 不寫快取——同一個 key 下次仍會重新呼叫 provider", async () => {
    const key = freshKey();
    provider.behavior = hangUntilAbort;
    const p = resolveSearchIntent(key);
    await vi.advanceTimersByTimeAsync(SEARCH_INTENT_DEADLINE_MS);
    await p;
    provider.behavior = async () => okResponse(VALID);
    expect((await resolveSearchIntent(key)).outcome).toBe("success");
    expect(provider.calls).toHaveLength(2);
  });

  it("M：provider error 不寫快取", async () => {
    const key = freshKey();
    provider.behavior = rejectWith(new Error("boom"));
    await resolveSearchIntent(key);
    provider.behavior = async () => okResponse(VALID);
    expect((await resolveSearchIntent(key)).outcome).toBe("success");
    expect(provider.calls).toHaveLength(2);
  });

  it("N／O：成功寫入記憶體快取；之後同一個 key 命中快取、不再呼叫 provider（大小寫／空白正規化同原本）", async () => {
    const key = freshKey();
    provider.behavior = async () => okResponse(VALID);
    expect((await resolveSearchIntent(key)).outcome).toBe("success");
    const again = await resolveSearchIntent(`  ${key.toUpperCase()}  `);
    expect(again.outcome).toBe("memory_cache_hit");
    expect(again.intent?.productKeywords).toEqual(["螺絲"]);
    expect(provider.calls).toHaveLength(1);
  });
});
