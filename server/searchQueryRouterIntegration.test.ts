/**
 * Integration + ambiguity tests for the Phase 3 Query Router (in-memory
 * factory name index，見 server/search-query-router.ts、
 * server/factory-name-index.ts、server/routers.ts factory.search)。
 *
 * 涵蓋：
 *   1. Ambiguity tests：unique prefix → DIRECT；ambiguous prefix（多筆同
 *      prefix）→ HYBRID；完全沒有 factory name match（產品詞）→ HYBRID；
 *      看起來像完整公司全名、但 DB 沒有這間工廠 → HYBRID（不可以 DIRECT 回 0）。
 *   2. factory.search 整合：DIRECT 完全不呼叫 getSearchIntent；HYBRID／
 *      SEMANTIC 恰好呼叫一次，行為不變。
 *   3. warm-cache 下的 DB query count 驗證（見「最重要的 DB query count
 *      驗證」）：cache 已經 warm 之後，路由階段（memoryFactoryNameMatch）
 *      不應該再對 DB 發出任何 query。
 *
 * 每個 describe block 建完 fixture 後都會呼叫
 * __resetFactoryNameIndexForTests()，確保 in-memory index 重新從 DB 載入、
 * 一定包含這個 block 剛建立的 fixture（不會被前一個 block 遺留的舊 cache
 * 擋住），藉此模擬「cache 過期後 reload」的真實情境。
 *
 * 不呼叫真正的 OpenAI：getSearchIntent 被 mock 成可計數的 vi.fn()。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import { classifySearchQuery } from "./search-query-router";
import { __resetFactoryNameIndexForTests, memoryFactoryNameMatch } from "./factory-name-index";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import * as semanticSearch from "./semantic-search";

vi.mock("./semantic-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./semantic-search")>();
  return {
    ...actual,
    getSearchIntent: vi.fn().mockResolvedValue(null),
  };
});

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const ownerIds: number[] = [];
const factoryIds: number[] = [];

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function createFactory(label: string, name: string, industry: string, description = "") {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const ownerId = await ensureTestUser(`sqri3-owner-${label}-${runId}`, `Router整合測試擁有者-${label}`);
  ownerIds.push(ownerId);
  const [result] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, description, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify([industry])}, ${description}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`Router整合測試地址 ${label}`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(result.insertId);
  return result.insertId;
}

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of factoryIds) {
      await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    }
  }
  for (const ownerId of ownerIds) {
    await deleteTestUser(ownerId);
  }
  __resetFactoryNameIndexForTests();
}, 30000);

afterEach(() => {
  vi.mocked(semanticSearch.getSearchIntent).mockClear();
});

describe("Ambiguity tests — memoryFactoryNameMatch / classifySearchQuery（真實 DB fixture，透過 in-memory index）", () => {
  const UNIQUE_PREFIX = `創普SQRI${runId}`;
  const AMBIGUOUS_PREFIX = `大成SQRI${runId}`;
  let uniqueFactoryId: number;

  beforeAll(async () => {
    uniqueFactoryId = await createFactory("Unique", `${UNIQUE_PREFIX}科技股份有限公司`, `SQRI3_${runId}`);
    await createFactory("AmbiguousA", `${AMBIGUOUS_PREFIX}工業有限公司`, `SQRI3_${runId}`);
    await createFactory("AmbiguousB", `${AMBIGUOUS_PREFIX}精密有限公司`, `SQRI3_${runId}`);
    __resetFactoryNameIndexForTests(); // 強制下一次 memoryFactoryNameMatch 重新從 DB 載入，確保拿到上面剛建的 fixture
  }, 30000);

  it("unique prefix（唯一命中）→ DIRECT", async () => {
    const result = await classifySearchQuery(UNIQUE_PREFIX);
    expect(result.route).toBe("DIRECT");
    expect(result.reason).toBe("strong_factory_name_match:prefix");
    const match = await memoryFactoryNameMatch(UNIQUE_PREFIX);
    expect(match?.factoryId).toBe(uniqueFactoryId);
  });

  it("完整公司全名 exact match → DIRECT", async () => {
    const result = await classifySearchQuery(`${UNIQUE_PREFIX}科技股份有限公司`);
    expect(result.route).toBe("DIRECT");
    expect(result.reason).toBe("strong_factory_name_match:exact");
  });

  it("ambiguous prefix（多筆同 prefix：大成工業／大成精密）→ HYBRID，不猜是哪一間", async () => {
    const result = await classifySearchQuery(AMBIGUOUS_PREFIX);
    expect(result.route).toBe("HYBRID");
    expect(result.reason).toBe("no_strong_name_match");
    const match = await memoryFactoryNameMatch(AMBIGUOUS_PREFIX);
    expect(match).toBeNull();
  });

  it("完全沒有 factory name match 的產品詞（油封）→ HYBRID", async () => {
    const result = await classifySearchQuery("油封");
    expect(result.route).toBe("HYBRID");
    expect(result.reason).toBe("no_strong_name_match");
  });

  it("看起來像完整公司全名、但 DB 沒有這間工廠 → HYBRID（不可以 DIRECT 回 0）", async () => {
    const result = await classifySearchQuery(`不存在的公司名稱_${runId}_科技股份有限公司`);
    expect(result.route).toBe("HYBRID");
    expect(result.reason).toBe("no_strong_name_match");
  });
});

describe("factory.search Query Router 整合 — DIRECT（strong unique name match）", () => {
  const INDUSTRY = `SQRI3_DIRECT_${runId}`;
  let chuangPuId: number;

  beforeAll(async () => {
    chuangPuId = await createFactory("ChuangPu", `創普SQRI3整合-${runId}`, INDUSTRY);
    __resetFactoryNameIndexForTests();
  }, 30000);

  it("「創普SQRI3整合」→ route=DIRECT，getSearchIntent 完全不被呼叫，正常返回結果", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.factory.search({ industry: [INDUSTRY], keyword: `創普SQRI3整合-${runId}`, page: 1, pageSize: 50 });
    expect(semanticSearch.getSearchIntent).not.toHaveBeenCalled();
    const ids = result.items.map((f: any) => f.id);
    expect(ids).toContain(chuangPuId);
  }, 15000);
});

describe("factory.search Query Router 整合 — HYBRID（產品／製程／taxonomy 詞，恢復 AI-assisted）", () => {
  it.each(["油封", "CNC", "金屬加工", "線束", "食品級矽膠密封件"])(
    "「%s」→ route=HYBRID，getSearchIntent 恰好呼叫一次，現有 AI behavior 不變",
    async (keyword) => {
      const caller = appRouter.createCaller(createPublicContext());
      await caller.factory.search({ keyword, page: 1, pageSize: 10 });
      expect(semanticSearch.getSearchIntent).toHaveBeenCalledTimes(1);
      expect(semanticSearch.getSearchIntent).toHaveBeenCalledWith(keyword);
    },
    15000,
  );
});

describe("factory.search Query Router 整合 — SEMANTIC", () => {
  it("「我要找可以做少量不鏽鋼零件的工廠」→ route=SEMANTIC，getSearchIntent 恰好呼叫一次", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await caller.factory.search({ keyword: "我要找可以做少量不鏽鋼零件的工廠", page: 1, pageSize: 10 });
    expect(semanticSearch.getSearchIntent).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe("最重要的 DB query count 驗證 — warm cache 下 routing 階段零額外 DB query", () => {
  const INDUSTRY = `SQRI3_WARM_${runId}`;
  let chuangPuId: number;

  beforeAll(async () => {
    chuangPuId = await createFactory("WarmChuangPu", `創普SQRI3warm-${runId}`, INDUSTRY);
    __resetFactoryNameIndexForTests();
    await memoryFactoryNameMatch("warm-up"); // 觸發一次真正的 DB load，讓 cache 進入 warm 狀態
  }, 30000);

  it("cache warm 後，對『油封』『CNC』『金屬加工』『創普』分類，routing 階段完全不再打 DB（用 spy 監控 listApprovedFactoryNamesForIndex）", async () => {
    const spy = vi.spyOn(db, "listApprovedFactoryNamesForIndex");
    spy.mockClear();

    await classifySearchQuery("油封");
    await classifySearchQuery("CNC");
    await classifySearchQuery("金屬加工");
    const chuangPuResult = await classifySearchQuery(`創普SQRI3warm-${runId}`);

    expect(spy).not.toHaveBeenCalled(); // warm cache 下 routing 完全是記憶體操作
    expect(chuangPuResult.route).toBe("DIRECT");
    // 這裡查詢字串跟 fixture 工廠名稱完全相同，所以是 exact match（不是
    // prefix）——這剛好也額外驗證了 exact-match 分支同樣不需要額外 DB query。
    expect(chuangPuResult.reason).toBe("strong_factory_name_match:exact");

    spy.mockRestore();
  });

  it("（對照組）確認上面用的『創普』fixture 真的存在、id 正確", async () => {
    const match = await memoryFactoryNameMatch(`創普SQRI3warm-${runId}`);
    expect(match?.factoryId).toBe(chuangPuId);
  });
});
