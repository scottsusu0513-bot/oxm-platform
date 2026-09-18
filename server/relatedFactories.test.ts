/**
 * 工廠詳情頁「相關工廠」推薦（見任務定案「工廠詳情頁底部同類型工廠推薦」）。
 * 架構比照 server/factoryTaxId.test.ts 已驗證過的模式：真實本機測試資料庫、
 * db.getSimilarFactories() 直接呼叫、appRouter.createCaller(ctx) 呼叫
 * factory.getSimilar 驗證 router 層。avgRating／reviewCount／status／taxId
 * 這幾個 createFactoryAtomic() 建立時不支援直接帶入的欄位，一律用 raw SQL
 * UPDATE 補上（同 factoryTaxId.test.ts 既有寫法）。
 *
 * 涵蓋（見任務定案「二十、Tests」1–12）：
 *   1. current factory excluded
 *   2. approved only
 *   3. same subIndustry priority
 *   4. same industry fallback
 *   5. subIndustry ANY-overlap semantics（["cnc","turning"] vs ["cnc"]）
 *   6. taxId current-company exclusion
 *   7. taxId candidate dedupe
 *   8. null taxId 不誤去重
 *   9. deterministic ordering（id ASC tie-breaker）
 *   10. limit <= 12
 *   11. publicProcedure 正常（匿名呼叫）
 *   12. invalid/non-public current factory 安全處理
 */
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runId = `relfac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createVerifiedTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const email = `${runId}-${userSeq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, createdAt, isFactoryOwner)
    VALUES (${openId}, ${`RelFac ${runId}-${userSeq}`}, ${email}, ${email}, NOW(), NOW(), FALSE)
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [
    { id: number }[],
    unknown,
  ];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

type FactoryOverrides = {
  industry?: string[];
  subIndustry?: string[];
  status?: "draft" | "pending" | "approved" | "rejected" | "delisted";
  avgRating?: number;
  reviewCount?: number;
  taxId?: string | null;
};

async function createFactory(name: string, overrides: FactoryOverrides = {}): Promise<number> {
  const ownerId = await createVerifiedTestUser();
  const factoryId = await db.createFactoryAtomic(ownerId, {
    name: `${runId} ${name}`,
    industry: overrides.industry ?? ["金屬加工"],
    subIndustry: overrides.subIndustry ?? [],
    mfgModes: ["OEM"],
    region: "新竹市",
    capitalLevel: "<1000萬",
    address: "新竹市",
    businessType: "factory",
    taxId: overrides.taxId ?? undefined,
  } as any);
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    UPDATE factories
    SET status = ${overrides.status ?? "approved"},
        avgRating = ${overrides.avgRating ?? 0},
        reviewCount = ${overrides.reviewCount ?? 0}
    WHERE id = ${factoryId}
  `);
  return factoryId;
}

async function cleanup() {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE name LIKE ${`${runId}%`}`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`test-${runId}-%`}`);
}

function ctxAnon(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("相關工廠推薦 — db.getSimilarFactories", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("1. 排除目前正在看的工廠本身", async () => {
    const currentId = await createFactory("Self1", { industry: ["電子"], subIndustry: ["SMT"] });
    await createFactory("Other1", { industry: ["電子"], subIndustry: ["SMT"] });
    const result = await db.getSimilarFactories(currentId);
    expect(result.some(f => f.id === currentId)).toBe(false);
  });

  it("2. 只回傳 status='approved' 的候選，pending/draft/rejected/delisted 都不出現", async () => {
    const currentId = await createFactory("Self2", { industry: ["電子"], subIndustry: ["SMT"] });
    const approved = await createFactory("Approved2", { industry: ["電子"], subIndustry: ["SMT"], status: "approved" });
    await createFactory("Pending2", { industry: ["電子"], subIndustry: ["SMT"], status: "pending" });
    await createFactory("Draft2", { industry: ["電子"], subIndustry: ["SMT"], status: "draft" });
    await createFactory("Rejected2", { industry: ["電子"], subIndustry: ["SMT"], status: "rejected" });
    await createFactory("Delisted2", { industry: ["電子"], subIndustry: ["SMT"], status: "delisted" });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids).toContain(approved);
    expect(ids).toHaveLength(1);
  });

  it("3. 同子產業 overlap 排序優先於只同主產業", async () => {
    const currentId = await createFactory("Self3", { industry: ["電子"], subIndustry: ["SMT"] });
    const sameSub = await createFactory("SameSub3", { industry: ["電子"], subIndustry: ["SMT"], avgRating: 3 });
    const sameIndustryOnly = await createFactory("SameIndustryOnly3", { industry: ["電子"], subIndustry: ["連接器"], avgRating: 5 });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids.indexOf(sameSub)).toBeLessThan(ids.indexOf(sameIndustryOnly));
  });

  it("4. 同子產業不足時，同主產業（非同子產業）的工廠會補進結果", async () => {
    const currentId = await createFactory("Self4", { industry: ["電子"], subIndustry: ["SMT"] });
    const sameIndustryOnly = await createFactory("SameIndustryOnly4", { industry: ["電子"], subIndustry: ["連接器"] });
    const result = await db.getSimilarFactories(currentId);
    expect(result.map(f => f.id)).toContain(sameIndustryOnly);
  });

  it("5. subIndustry ANY-overlap 語意：目前工廠 [\"cnc\",\"turning\"]，候選只有 [\"cnc\"] 仍算同子產業（不要求候選包含全部）", async () => {
    const currentId = await createFactory("Self5", { industry: ["製造"], subIndustry: ["cnc", "turning"] });
    const partialOverlap = await createFactory("PartialOverlap5", { industry: ["製造"], subIndustry: ["cnc"], avgRating: 1 });
    const noOverlapSameIndustry = await createFactory("NoOverlapSameIndustry5", { industry: ["製造"], subIndustry: ["milling"], avgRating: 5 });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids).toContain(partialOverlap);
    // 就算評分更低，"cnc" 部分重疊仍應排在完全不重疊的同主產業候選之前。
    expect(ids.indexOf(partialOverlap)).toBeLessThan(ids.indexOf(noOverlapSameIndustry));
  });

  it("6. taxId 與目前工廠相同的候選被排除（同企業去重）", async () => {
    const currentId = await createFactory("Self6", { industry: ["電子"], subIndustry: ["SMT"], taxId: "00000016" });
    const sameCompany = await createFactory("SameCompany6", { industry: ["電子"], subIndustry: ["SMT"], taxId: "00000016" });
    const otherCompany = await createFactory("OtherCompany6", { industry: ["電子"], subIndustry: ["SMT"], taxId: "00000024" });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids).not.toContain(sameCompany);
    expect(ids).toContain(otherCompany);
  });

  it("7. 候選之間彼此 taxId 相同時，只保留排序較前的一家", async () => {
    const currentId = await createFactory("Self7", { industry: ["電子"], subIndustry: ["SMT"] });
    const better = await createFactory("Better7", { industry: ["電子"], subIndustry: ["SMT"], taxId: "00000032", avgRating: 5 });
    const worse = await createFactory("Worse7", { industry: ["電子"], subIndustry: ["SMT"], taxId: "00000032", avgRating: 1 });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids).toContain(better);
    expect(ids).not.toContain(worse);
  });

  it("8. taxId 為 null 的候選彼此之間不會被誤判成同企業去重", async () => {
    const currentId = await createFactory("Self8", { industry: ["電子"], subIndustry: ["SMT"] });
    const nullA = await createFactory("NullA8", { industry: ["電子"], subIndustry: ["SMT"], taxId: null });
    const nullB = await createFactory("NullB8", { industry: ["電子"], subIndustry: ["SMT"], taxId: null });
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids).toContain(nullA);
    expect(ids).toContain(nullB);
  });

  it("9. avgRating／reviewCount 都相同時，用 id ASC 當 deterministic tie-breaker", async () => {
    const currentId = await createFactory("Self9", { industry: ["電子"], subIndustry: ["SMT"] });
    const first = await createFactory("Tie9A", { industry: ["電子"], subIndustry: ["SMT"], avgRating: 4, reviewCount: 10 });
    const second = await createFactory("Tie9B", { industry: ["電子"], subIndustry: ["SMT"], avgRating: 4, reviewCount: 10 });
    expect(first).toBeLessThan(second);
    const result = await db.getSimilarFactories(currentId);
    const ids = result.map(f => f.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });

  it("10. 最終回傳數量不超過 limit（預設 12），即使候選更多", async () => {
    const currentId = await createFactory("Self10", { industry: ["電子"], subIndustry: ["SMT"] });
    for (let i = 0; i < 15; i++) {
      await createFactory(`Cand10-${i}`, { industry: ["電子"], subIndustry: ["SMT"] });
    }
    const result = await db.getSimilarFactories(currentId);
    expect(result.length).toBeLessThanOrEqual(12);
    const resultCustomLimit = await db.getSimilarFactories(currentId, 5);
    expect(resultCustomLimit.length).toBeLessThanOrEqual(5);
  });
});

describe("相關工廠推薦 — factory.getSimilar router", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("11. publicProcedure：匿名（未登入）呼叫也能正常取得結果", async () => {
    const currentId = await createFactory("SelfR11", { industry: ["電子"], subIndustry: ["SMT"] });
    await createFactory("CandR11", { industry: ["電子"], subIndustry: ["SMT"] });
    const caller = appRouter.createCaller(ctxAnon());
    const result = await caller.factory.getSimilar({ factoryId: currentId });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("12. 目前工廠不存在／非 approved 時安全回傳空陣列，不 crash", async () => {
    const caller = appRouter.createCaller(ctxAnon());
    await expect(caller.factory.getSimilar({ factoryId: 999999999 })).resolves.toEqual([]);

    const pendingId = await createFactory("PendingSelfR12", { industry: ["電子"], subIndustry: ["SMT"], status: "pending" });
    await expect(caller.factory.getSimilar({ factoryId: pendingId })).resolves.toEqual([]);

    const delistedId = await createFactory("DelistedSelfR12", { industry: ["電子"], subIndustry: ["SMT"], status: "delisted" });
    await expect(caller.factory.getSimilar({ factoryId: delistedId })).resolves.toEqual([]);
  });
});
