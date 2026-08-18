/**
 * Phase 6C：AI 讀取政府補助方案——server/ai/subsidyProgramsAction.ts 驗證。
 *
 * 完全 deterministic（見對話中「十八：不要新增新的 LLM call」），純函式部分
 * 用合成 fixture 測試，不需要碰 DB；runSubsidyProgramsAction() 本身則直接對
 * 真實（已套用 migration 0076、已冪等 seed 過）本機測試 DB 的
 * upgradePrograms 驗證，因為五項既有方案（SBIR/CITD/SIIR/研發轉型/海外通路）
 * 是穩定、長期存在的種子資料，不需要另外建立/清理測試專用資料列。
 */
import { describe, expect, it } from "vitest";
import {
  extractMatchedProgramSlugs,
  runSubsidyProgramsAction,
} from "./subsidyProgramsAction";
import type { PublicUpgradeProgram } from "../upgradePrograms";
import { listPublicUpgradePrograms } from "../upgradePrograms";

function fixtureProgram(overrides: Partial<PublicUpgradeProgram>): PublicUpgradeProgram {
  return {
    id: 1,
    slug: "test-slug",
    title: "測試方案標題",
    shortTitle: "TEST",
    description: "測試用途說明",
    targetAudience: null,
    highlights: [],
    badge: null,
    statusLabel: null,
    visualKey: "funding",
    maxFundingLabel: null,
    imageUrl: null,
    ctaLabel: "免費評估資格",
    displayOrder: 0,
    enabled: true,
    ...overrides,
  };
}

describe("extractMatchedProgramSlugs：對真實方案的 slug/shortTitle/title 做子字串比對，大小寫不敏感", () => {
  const programs = [
    fixtureProgram({ id: 1, slug: "citd", shortTitle: "CITD", title: "協助傳統產業技術開發" }),
    fixtureProgram({ id: 2, slug: "sbir", shortTitle: "SBIR", title: "小型企業創新研發計畫" }),
  ];

  it("命中 shortTitle（大小寫不敏感）", () => {
    expect(extractMatchedProgramSlugs("citd是什麼？", programs)).toEqual(["citd"]);
  });
  it("命中完整 title", () => {
    expect(extractMatchedProgramSlugs("小型企業創新研發計畫是什麼？", programs)).toEqual(["sbir"]);
  });
  it("同時命中兩個方案（比較情境）", () => {
    expect(extractMatchedProgramSlugs("CITD跟SBIR差在哪？", programs)).toEqual(["citd", "sbir"]);
  });
  it("完全沒提到任何方案 → 空陣列", () => {
    expect(extractMatchedProgramSlugs("最近有什麼展覽？", programs)).toEqual([]);
  });
});

// ===== 真實 DB 區塊：六項既有方案（含 19+1）是穩定種子資料，直接驗證 =====
describe("runSubsidyProgramsAction：真實 DB 整合驗證", () => {
  it("CASE S1：「有哪些政府補助」→ 沒有指名任何方案／關鍵字 → 回傳目前全部啟用方案", async () => {
    const active = await listPublicUpgradePrograms();
    const result = await runSubsidyProgramsAction([{ role: "user", content: "OXM現在有哪些政府補助？" }]);
    expect(result.zeroResult).toBe(false);
    expect(result.compareMode).toBe(false);
    expect(result.totalActiveCount).toBe(active.length);
    expect(result.viewAllUrl).toBe("/upgrade-center");
  });

  it("CASE S2：「CITD是什麼」→ 指名單一方案，只回傳該方案", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "CITD是什麼？" }]);
    expect(result.matchedProgramSlugs).toEqual(["citd"]);
    expect(result.compareMode).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.shortTitle).toBe("CITD");
  });

  it("CASE S3：「CITD跟SBIR差在哪」→ compareMode=true，兩個方案都在候選裡", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "CITD跟SBIR差在哪？" }]);
    expect(result.compareMode).toBe(true);
    const slugs = result.candidates.map(c => c.slug).sort();
    expect(slugs).toEqual(["citd", "sbir"]);
  });

  it("見對話中「政府補助資料一致性問題」：19+1 現在是 upgradePrograms 真實 DB 方案，「19+1是什麼？」直接命中 DB，不再走 registryOnlyMatch fallback", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "19+1是什麼？" }]);
    expect(result.zeroResult).toBe(false);
    expect(result.matchedProgramSlugs).toEqual(["manufacturing-19plus1"]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.slug).toBe("manufacturing-19plus1");
    expect(result.registryOnlyMatch).toBeNull();
  });

  it("CITD 跟 19+1 比較：兩者都來自公開 upgradePrograms，compareMode=true", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "CITD跟19+1差在哪？" }]);
    expect(result.compareMode).toBe(true);
    const slugs = result.candidates.map(c => c.slug).sort();
    expect(slugs).toEqual(["citd", "manufacturing-19plus1"]);
  });

  it("非標準寫法（DB shortTitle 沒有的別名，例如「產業競爭力輔導團」）DB 查無資料時，仍然 fallback 到 registryOnlyMatch 當背景知識", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "產業競爭力輔導團是什麼？" }]);
    expect(result.zeroResult).toBe(true);
    expect(result.registryOnlyMatch).not.toBeNull();
    expect(result.registryOnlyMatch!.name).toContain("19+1");
  });

  it("完全查無資料且不是既有 Registry 知識的方案名 → 誠實 zeroResult，registryOnlyMatch 為 null", async () => {
    const result = await runSubsidyProgramsAction([{ role: "user", content: "有沒有火星移民補助計畫？" }]);
    expect(result.zeroResult).toBe(true);
    expect(result.registryOnlyMatch).toBeNull();
  });

  it("停用／封存的方案不會出現在候選裡（見「七：方案資料必須來自真實 DB」）：只用 listPublicUpgradePrograms 的真實輸出比對", async () => {
    const active = await listPublicUpgradePrograms();
    const activeSlug = new Set(active.map(p => p.slug));
    const result = await runSubsidyProgramsAction([{ role: "user", content: "OXM現在有哪些政府補助？" }]);
    for (const c of result.candidates) {
      expect(activeSlug.has(c.slug)).toBe(true);
    }
  });

  it("多輪換條件要真的重新判斷：Turn1 問 CITD，Turn2 只問 SBIR → Turn2 只回傳 SBIR，不會 union 成兩個", async () => {
    const result = await runSubsidyProgramsAction([
      { role: "user", content: "CITD是什麼？" },
      { role: "assistant", content: "CITD 是..." },
      { role: "user", content: "那SBIR呢？" },
    ]);
    expect(result.matchedProgramSlugs).toEqual(["sbir"]);
    expect(result.compareMode).toBe(false);
  });
});
