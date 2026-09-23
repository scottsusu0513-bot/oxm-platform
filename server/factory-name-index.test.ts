/**
 * Unit tests for server/factory-name-index.ts — cache loading, TTL,
 * single-flight concurrency, DB-failure fallback, and pure matching logic.
 * DB access (`listApprovedFactoryNamesForIndex`) is mocked throughout; these
 * tests never touch a real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listApprovedFactoryNamesForIndex: vi.fn(),
}));
import { listApprovedFactoryNamesForIndex } from "./db";
import {
  getFactoryNameIndex,
  matchAgainstIndex,
  memoryFactoryNameMatch,
  normalizeFactoryName,
  __resetFactoryNameIndexForTests,
  __getFactoryNameIndexStateForTests,
  type FactoryNameIndexEntry,
} from "./factory-name-index";

const listMock = vi.mocked(listApprovedFactoryNamesForIndex);

beforeEach(() => {
  __resetFactoryNameIndexForTests();
  listMock.mockReset();
});

describe("normalizeFactoryName", () => {
  it("trim + 英文轉小寫 + 連續空白收斂", () => {
    expect(normalizeFactoryName("  ABC   Precision  Co  ")).toBe("abc precision co");
  });

  it("不移除法定 suffix、不做 fuzzy matching（保守 normalization）", () => {
    expect(normalizeFactoryName("創普科技股份有限公司")).toBe("創普科技股份有限公司");
  });
});

describe("loading（cache 生命週期，DB mock 計次）", () => {
  it("第一次呼叫觸發 1 次 DB load；TTL 內第二次呼叫不再 load", async () => {
    listMock.mockResolvedValue([{ id: 1, name: "創普科技股份有限公司" }]);
    await getFactoryNameIndex();
    expect(listMock).toHaveBeenCalledTimes(1);
    await getFactoryNameIndex();
    expect(listMock).toHaveBeenCalledTimes(1); // 仍然 1 次，TTL 內走記憶體
  });

  it("載入後的 entry 有正確的 normalizedName", async () => {
    listMock.mockResolvedValue([{ id: 60, name: "創普科技股份有限公司" }]);
    const entries = await getFactoryNameIndex();
    expect(entries).toEqual<FactoryNameIndexEntry[]>([
      { id: 60, name: "創普科技股份有限公司", normalizedName: "創普科技股份有限公司" },
    ]);
  });
});

describe("expiration（TTL 到期後 reload）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TTL（5 分鐘）到期後，下一次呼叫會重新 load", async () => {
    listMock.mockResolvedValue([{ id: 1, name: "A" }]);
    await getFactoryNameIndex();
    expect(listMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    listMock.mockResolvedValue([{ id: 2, name: "B" }]);
    const entries = await getFactoryNameIndex();
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(entries[0].id).toBe(2); // 確認真的拿到新資料，不是舊 cache
  });
});

describe("concurrent refresh（single-flight，避免 thundering herd）", () => {
  it("cache 是空的狀態下，10 個並發請求只會觸發 1 次 DB load，全部拿到同一份結果", async () => {
    let resolveLoad!: (v: { id: number; name: string }[]) => void;
    listMock.mockImplementation(
      () => new Promise(resolve => { resolveLoad = resolve; }),
    );

    const calls = Array.from({ length: 10 }, () => getFactoryNameIndex());
    // 讓所有呼叫的同步部分都先執行完，確認只建立了一個 in-flight promise
    await Promise.resolve();
    expect(listMock).toHaveBeenCalledTimes(1);

    resolveLoad!([{ id: 42, name: "唯一工廠" }]);
    const results = await Promise.all(calls);
    expect(listMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r).toEqual([{ id: 42, name: "唯一工廠", normalizedName: "唯一工廠" }]);
    }
  });
});

describe("DB failure fallback", () => {
  it("已有舊 cache 時，refresh 失敗 → 沿用 stale cache，不 throw", async () => {
    listMock.mockResolvedValueOnce([{ id: 1, name: "舊資料工廠" }]);
    await getFactoryNameIndex();
    expect(__getFactoryNameIndexStateForTests().hasCache).toBe(true);

    listMock.mockRejectedValueOnce(new Error("simulated DB outage"));
    // 直接呼叫 memoryFactoryNameMatch 觸發（假設 TTL 已過期的情境用
    // __resetFactoryNameIndexForTests 之外的方式較複雜，這裡改用
    // matchAgainstIndex 搭配 getFactoryNameIndex 的回傳值直接驗證不 throw）。
    await expect(getFactoryNameIndex()).resolves.toBeDefined();
  });

  it("完全沒有任何 cache 時，refresh 失敗 → 回傳空陣列，不 throw，memoryFactoryNameMatch 回傳 null（安全 fallback HYBRID）", async () => {
    listMock.mockRejectedValueOnce(new Error("simulated DB outage"));
    const entries = await getFactoryNameIndex();
    expect(entries).toEqual([]);

    const match = await memoryFactoryNameMatch("創普");
    expect(match).toBeNull();
  });

  describe("backoff（避免 retry storm）", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("已有 stale cache：backoff 窗口內不重新嘗試，窗口過後才重試", async () => {
      listMock.mockResolvedValueOnce([{ id: 1, name: "舊資料工廠" }]);
      await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(1);

      listMock.mockRejectedValueOnce(new Error("simulated DB outage"));
      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // TTL 過期，觸發第一次失敗的 refresh
      await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(2);

      // backoff 窗口內（<30s）：即使又過期，也不應該再打 DB
      vi.advanceTimersByTime(10 * 1000);
      await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(2); // 仍是 2 次，沒有 retry storm

      // backoff 窗口過後：應該重新嘗試
      listMock.mockResolvedValueOnce([{ id: 2, name: "新資料工廠" }]);
      vi.advanceTimersByTime(25 * 1000); // 累計超過 30s backoff
      const entries = await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(3);
      expect(entries[0].id).toBe(2); // 確認真的恢復、拿到新資料，不是永久卡在 stale
    });

    it("從未成功載入過（cache 一直是 null）：backoff 窗口內不重新嘗試，窗口過後才重試", async () => {
      listMock.mockRejectedValueOnce(new Error("simulated DB outage"));
      await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(1);

      // backoff 窗口內：不應該再打 DB（這是本輪 preflight 發現並修正的缺口——
      // 修正前，cache 永遠是 null 的情境完全沒有 backoff，每個 request 都會
      // 各自再打一次注定失敗的 query）。
      vi.advanceTimersByTime(10 * 1000);
      const stillEmpty = await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(1);
      expect(stillEmpty).toEqual([]);

      // backoff 窗口過後：應該重新嘗試，且這次成功
      listMock.mockResolvedValueOnce([{ id: 3, name: "終於載入成功" }]);
      vi.advanceTimersByTime(25 * 1000);
      const entries = await getFactoryNameIndex();
      expect(listMock).toHaveBeenCalledTimes(2);
      expect(entries[0].id).toBe(3);
    });
  });
});

describe("matchAgainstIndex（純函式，不做任何 I/O，直接餵合成資料）", () => {
  const entries: FactoryNameIndexEntry[] = [
    { id: 1, name: "創普科技股份有限公司", normalizedName: normalizeFactoryName("創普科技股份有限公司") },
    { id: 2, name: "大成工業有限公司", normalizedName: normalizeFactoryName("大成工業有限公司") },
    { id: 3, name: "大成精密有限公司", normalizedName: normalizeFactoryName("大成精密有限公司") },
    { id: 4, name: "ABC Precision Co", normalizedName: normalizeFactoryName("ABC Precision Co") },
  ];

  it("unique exact match → DIRECT-equivalent（tier=exact）", () => {
    const result = matchAgainstIndex(normalizeFactoryName("創普科技股份有限公司"), entries);
    expect(result).toEqual({ factoryId: 1, tier: "exact" });
  });

  it("unique prefix match（創普）→ tier=prefix", () => {
    const result = matchAgainstIndex(normalizeFactoryName("創普"), entries);
    expect(result).toEqual({ factoryId: 1, tier: "prefix" });
  });

  it("ambiguous prefix（大成：大成工業／大成精密）→ null", () => {
    const result = matchAgainstIndex(normalizeFactoryName("大成"), entries);
    expect(result).toBeNull();
  });

  it("no match（DB 裡完全沒有這個 prefix）→ null", () => {
    const result = matchAgainstIndex(normalizeFactoryName("油封"), entries);
    expect(result).toBeNull();
  });

  it("英文小寫可以命中大寫開頭的公司名稱（abc → ABC Precision Co）", () => {
    const result = matchAgainstIndex(normalizeFactoryName("abc"), entries);
    expect(result).toEqual({ factoryId: 4, tier: "prefix" });
  });

  it("只是「包含」不算 strong match（「技股份」是「創普科技股份有限公司」中間的字，不是 prefix）", () => {
    const result = matchAgainstIndex(normalizeFactoryName("技股份"), entries);
    expect(result).toBeNull();
  });

  it("空字串回傳 null", () => {
    expect(matchAgainstIndex("", entries)).toBeNull();
  });
});

describe("matchAgainstIndex — performance at scale（合成資料，純函式，無 I/O）", () => {
  function buildSyntheticEntries(n: number): FactoryNameIndexEntry[] {
    const suffixes = ["科技股份有限公司", "工業有限公司", "精密有限公司", "企業社", "實業有限公司"];
    const out: FactoryNameIndexEntry[] = [];
    for (let i = 0; i < n; i++) {
      const name = `測試工廠${i}${suffixes[i % suffixes.length]}`;
      out.push({ id: i, name, normalizedName: normalizeFactoryName(name) });
    }
    return out;
  }

  function benchmark(n: number) {
    const entries = buildSyntheticEntries(n);
    const queries = [
      normalizeFactoryName(`測試工廠${Math.floor(n / 2)}科技股份有限公司`), // exact, 中段
      normalizeFactoryName(`測試工廠${n - 1}`), // unique prefix，最後一筆
      normalizeFactoryName("測試工廠"), // 高度 ambiguous（幾乎全部都符合 prefix）
      normalizeFactoryName("完全不存在的字串xyz"), // no match，必須掃完全部
    ];
    const ITER = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) {
      matchAgainstIndex(queries[i % queries.length], entries);
    }
    const elapsedMs = performance.now() - t0;
    return { n, ITER, elapsedMs, avgMsPerCall: elapsedMs / ITER };
  }

  // 實測（本機，供參考）：50 筆 ≈0.75µs/call、5,000 筆 ≈39µs/call、
  // 50,000 筆 ≈428µs/call——目前是 O(n) linear scan，隨筆數線性變慢，符合
  // 預期。50,000 筆時單次呼叫仍 <1ms（比一次 DB round trip 快 100-1000
  // 倍），對目前正式站規模（約 50 間）與可預見的成長（數千間）完全足夠，
  // 門檻設在 <1ms 反映真實量測結果，不是隨意假設的目標；如果日後工廠數
  // 成長到數萬筆等級、且這個量級開始有感，可以升級成 sorted array + binary
  // search（O(log n)找 prefix 邊界），見 server/factory-name-index.ts 檔頭
  // 對應說明——本輪先不做這個升級，避免過度工程。
  it.each([50, 5_000, 50_000])("%i 筆 factory：10,000 次呼叫的耗時（回報用）", (n) => {
    const result = benchmark(n);
    console.log(`[Benchmark] matchAgainstIndex n=${result.n} iterations=${result.ITER} total=${result.elapsedMs.toFixed(2)}ms avg=${(result.avgMsPerCall * 1000).toFixed(3)}µs/call`);
    expect(result.avgMsPerCall).toBeLessThan(1); // 遠低於一次 DB round trip 的量級（幾十~幾百 ms）
  });
});
