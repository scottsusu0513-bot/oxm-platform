/**
 * 電子零件「線束 / 連接器」拆分為三個獨立子分類（見任務定案「線束 / 連接器
 * 拆分為三類」）：
 *   - 線材／電纜（wire-cable）
 *   - 線束／線組加工（wire-harness-assembly）
 *   - 連接器／端子（connector-terminal）
 *
 * 涵蓋：
 *   1. INDUSTRIES 電子零件底下包含三個新子分類，不再包含舊的「線束 / 連接器」，
 *      其他既有子分類不受影響
 *   2. 三個新 slug 都能正確解析出 SubIndustrySearchEntry，SEO landing page
 *      文案彼此不同（不是三頁共用高度相似內容）
 *   3. 舊 slug wire-harness-connectors 不再是 SUB_INDUSTRY_SEARCH_ENTRIES 的
 *      可選 entry（不會出現在任何子產業選單／搜尋篩選裡）
 *   4. 舊 slug /factories/wire-harness-connectors 透過 buildSubIndustryMeta
 *      仍是 200（不是 404），但 noindex（避免跟新分類頁重複內容）
 *   5. 舊 slug 過渡頁（resolveSplitSubIndustryNotice）正確引導到兩個新分類
 *      （不含 wire-cable——舊「線束 / 連接器」語意上從未涵蓋原料線材本體）
 *   6. 舊 DB value「線束 / 連接器」不會讓既有查詢／建立/讀取工廠 crash，也
 *      不會被靜默清掉（round-trip 驗證，真實本機測試資料庫）
 */
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { buildSubIndustryMeta } from "./_core/ogMeta";
import {
  INDUSTRIES, SUB_INDUSTRY_SEARCH_ENTRIES, SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY,
} from "@shared/constants";
import {
  resolveSubIndustry, buildSubIndustryPageContent,
  resolveSplitSubIndustryNotice, buildSplitSubIndustryNoticeContent,
} from "@shared/seo/subIndustryPages";

const NEW_SLUGS = ["wire-cable", "wire-harness-assembly", "connector-terminal"];

describe("1. INDUSTRIES：電子零件底下的子分類拆分", () => {
  const electronics = INDUSTRIES.find(i => i.name === "電子零件")!;

  it("包含三個新子分類", () => {
    expect(electronics.sub).toContain("線材 / 電纜");
    expect(electronics.sub).toContain("線束 / 線組加工");
    expect(electronics.sub).toContain("連接器 / 端子");
  });

  it("不再包含舊的「線束 / 連接器」", () => {
    expect(electronics.sub).not.toContain("線束 / 連接器");
  });

  it("其他既有子分類不受影響（只新增，沒有調整既有內容）", () => {
    expect(electronics.sub).toContain("PCB / 電路板");
    expect(electronics.sub).toContain("電子組裝 / SMT");
    expect(electronics.sub).toContain("感測器 / 模組");
    expect(electronics.sub).toContain("半導體封裝");
    expect(electronics.sub).toContain("照明模組 / 工業照明");
    expect(electronics.sub).toContain("其他");
  });
});

describe("2 + 3. SUB_INDUSTRY_SEARCH_ENTRIES：新 slug 可解析，舊 slug 不再是可選 entry", () => {
  it("舊 slug wire-harness-connectors 已不在 SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY／resolveSubIndustry 裡", () => {
    expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY["wire-harness-connectors"]).toBeUndefined();
    expect(resolveSubIndustry("wire-harness-connectors")).toBeNull();
  });

  it.each(NEW_SLUGS)("新 slug %s 能正確解析出 entry，parentIndustry 為電子零件", (slug) => {
    const resolved = resolveSubIndustry(slug);
    expect(resolved).not.toBeNull();
    expect(resolved!.entry.parentIndustry).toBe("電子零件");
    expect(resolved!.entry.parentIndustrySlug).toBe("electronics");
  });

  it("三個新 entry 都補齊 primarySeoKeyword／secondaryKeywords／SEO title/description/intro override", () => {
    for (const slug of NEW_SLUGS) {
      const entry = SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug];
      expect(entry).toBeTruthy();
      expect(entry.primarySeoKeyword).toBeTruthy();
      expect(entry.secondaryKeywords?.length ?? 0).toBeGreaterThan(0);
      expect(entry.seoTitleOverride).toBeTruthy();
      expect(entry.metaDescriptionOverride).toBeTruthy();
      expect(entry.seoIntroOverride).toBeTruthy();
    }
  });

  it("三個新分類的 SEO landing page 文案彼此不同（title／description／intro 各自獨立撰寫）", () => {
    const contents = NEW_SLUGS.map(slug => buildSubIndustryPageContent(resolveSubIndustry(slug)!));
    expect(new Set(contents.map(c => c.title)).size).toBe(3);
    expect(new Set(contents.map(c => c.description)).size).toBe(3);
    expect(new Set(contents.map(c => c.intro)).size).toBe(3);
  });

  it("SubIndustrySearchEntry 陣列淨增 2 筆（移除舊 1 筆＋新增 3 筆）", () => {
    expect(SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.parentIndustry === "電子零件").map(e => e.slug).sort()).toEqual(
      ["connector-terminal", "lighting-modules", "pcb", "semiconductor-packaging", "sensors-modules", "smt-assembly", "wire-cable", "wire-harness-assembly"].sort(),
    );
  });
});

describe("4 + 5. 舊 slug /factories/wire-harness-connectors 過渡頁", () => {
  it("resolveSplitSubIndustryNotice 能解析出舊分類與繼承的新分類（只有 wire-harness-assembly／connector-terminal，不含 wire-cable）", () => {
    const notice = resolveSplitSubIndustryNotice("wire-harness-connectors");
    expect(notice).not.toBeNull();
    expect(notice!.label).toBe("線束 / 連接器");
    expect(notice!.parentIndustry).toBe("電子零件");
    expect(notice!.successors.map(s => s.slug).sort()).toEqual(["connector-terminal", "wire-harness-assembly"]);
  });

  it("非拆分過渡 slug 回傳 null", () => {
    expect(resolveSplitSubIndustryNotice("wire-cable")).toBeNull();
    expect(resolveSplitSubIndustryNotice("not-a-real-slug")).toBeNull();
  });

  it("buildSplitSubIndustryNoticeContent 自我 canonical，內容提及舊分類與新分類", () => {
    const notice = resolveSplitSubIndustryNotice("wire-harness-connectors")!;
    const content = buildSplitSubIndustryNoticeContent(notice);
    expect(content.canonical).toBe("https://www.oxmmatch.com/factories/wire-harness-connectors");
    expect(content.h1).toContain("線束 / 連接器");
    expect(content.description).toContain("線束加工");
    expect(content.description).toContain("連接器端子");
  });

  it("buildSubIndustryMeta：舊 slug 仍是 200（不是 404），且 noindex 避免與新分類頁重複內容", async () => {
    const meta = await buildSubIndustryMeta("wire-harness-connectors", "/factories/wire-harness-connectors");
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(true);
  });

  it.each(NEW_SLUGS)("buildSubIndustryMeta：新 slug %s 是合法 200 頁面（不是 404）", async (slug) => {
    const meta = await buildSubIndustryMeta(slug, `/factories/${slug}`);
    expect(meta.status).toBe(200);
  });
});

describe("6. 舊 DB value「線束 / 連接器」相容性：不會 crash，不會被靜默清掉", () => {
  const runId = `whcsplit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  afterEach(async () => {
    const conn = await getDb();
    if (!conn) return;
    await conn.execute(sql`DELETE FROM factories WHERE name LIKE ${`${runId}%`}`);
    await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`test-${runId}%`}`);
  });

  let userSeq = 0;
  async function createVerifiedTestUser(): Promise<number> {
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    userSeq += 1;
    const openId = `test-${runId}-${userSeq}`;
    const email = `${runId}-${userSeq}@example.test`;
    await conn.execute(sql`
      INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, createdAt, isFactoryOwner)
      VALUES (${openId}, ${`WHC Split ${runId}`}, ${email}, ${email}, NOW(), NOW(), FALSE)
    `);
    const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [
      { id: number }[],
      unknown,
    ];
    const id = rows[0]?.id;
    if (!id) throw new Error("failed to create test user");
    return id;
  }

  it("createFactoryAtomic 接受舊 subIndustry 值「線束 / 連接器」不 throw，讀回時原樣保留（不會被靜默清掉或替換成新分類）", async () => {
    const ownerId = await createVerifiedTestUser();
    const factoryId = await db.createFactoryAtomic(ownerId, {
      name: `${runId} Legacy Factory`,
      industry: ["電子零件"],
      subIndustry: ["線束 / 連接器", "PCB / 電路板"],
      mfgModes: ["OEM"],
      region: "新竹市",
      capitalLevel: "<1000萬",
      address: "新竹市",
      businessType: "factory",
    } as any);

    const factory = await db.getFactoryById(factoryId);
    expect(factory).toBeTruthy();
    expect(factory!.subIndustry).toEqual(["線束 / 連接器", "PCB / 電路板"]);
  });

  it("searchFactories 依新分類篩選時，舊值工廠不會出現（不自動歸類），也不會讓查詢 crash", async () => {
    const ownerId = await createVerifiedTestUser();
    await db.createFactoryAtomic(ownerId, {
      name: `${runId} Legacy Factory 2`,
      industry: ["電子零件"],
      subIndustry: ["線束 / 連接器"],
      mfgModes: ["OEM"],
      region: "新竹市",
      capitalLevel: "<1000萬",
      address: "新竹市",
      businessType: "factory",
    } as any);
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE name = ${`${runId} Legacy Factory 2`}`);

    const result = await db.searchFactories({
      industry: ["電子零件"],
      subIndustry: ["線束 / 線組加工"],
      page: 1,
      pageSize: 20,
    });
    expect(result.items.some(f => f.name === `${runId} Legacy Factory 2`)).toBe(false);
  });
});
