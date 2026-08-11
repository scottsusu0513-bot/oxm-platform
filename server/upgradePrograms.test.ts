import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  UPGRADE_PROGRAM_SEEDS,
  selectVisibleUpgradePrograms,
} from "../shared/upgradePrograms";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("政府補助方案既有內容與公開篩選契約", () => {
  it("保留原本五項方案、名稱、說明、標籤、補助金額與排序", () => {
    expect(UPGRADE_PROGRAM_SEEDS).toHaveLength(5);
    expect(UPGRADE_PROGRAM_SEEDS.map((program) => program.shortTitle)).toEqual([
      "SBIR",
      "CITD",
      "SIIR",
      "研發轉型補助",
      "海外通路計畫",
    ]);
    expect(UPGRADE_PROGRAM_SEEDS.map((program) => program.title)).toEqual([
      "小型企業創新研發計畫",
      "協助傳統產業技術開發",
      "服務業創新研發計畫",
      "企業研發轉型與升級計畫",
      "海外市場拓展與通路布局",
    ]);
    expect(UPGRADE_PROGRAM_SEEDS.map((program) => program.maxFundingLabel)).toEqual([
      "3,000 萬元",
      "1,000 萬元",
      "1,000 萬元",
      "4,000 萬元",
      "2,000 萬元",
    ]);
    for (const program of UPGRADE_PROGRAM_SEEDS) {
      expect(program.description.trim().length).toBeGreaterThan(0);
      expect(program.highlights).toHaveLength(3);
      expect(program.enabled).toBe(true);
      expect(program.ctaLabel).toBe("免費評估資格");
    }
  });

  it("slug 與 displayOrder 唯一，排序穩定", () => {
    const slugs = UPGRADE_PROGRAM_SEEDS.map((program) => program.slug);
    const orders = UPGRADE_PROGRAM_SEEDS.map((program) => program.displayOrder);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("公開選擇只保留 enabled 且未封存方案，並依 displayOrder 排序", () => {
    const programs = [
      { id: 1, enabled: true, archivedAt: null, displayOrder: 30, title: "第三" },
      { id: 2, enabled: false, archivedAt: null, displayOrder: 10, title: "停用" },
      { id: 3, enabled: true, archivedAt: new Date(), displayOrder: 5, title: "封存" },
      { id: 4, enabled: true, archivedAt: null, displayOrder: 20, title: "第二" },
    ];
    expect(selectVisibleUpgradePrograms(programs).map((program) => program.title)).toEqual(["第二", "第三"]);
  });

  it("第六項資料加入後會自然進入公開清單，不需要名稱分支", () => {
    const six = UPGRADE_PROGRAM_SEEDS.map((program, index) => ({
      ...program,
      id: index + 1,
      archivedAt: null,
    })).concat({
      ...UPGRADE_PROGRAM_SEEDS[0],
      id: 6,
      slug: "temporary-sixth",
      shortTitle: "NEW",
      title: "暫時第六項",
      displayOrder: 60,
      archivedAt: null,
    });
    expect(selectVisibleUpgradePrograms(six)).toHaveLength(6);
    expect(selectVisibleUpgradePrograms(six).at(-1)?.title).toBe("暫時第六項");
  });
});

describe("方案資料層與既有案件流程隔離", () => {
  const schemaSource = readSource("drizzle", "schema.ts");
  const schemaBlock = schemaSource.match(/export const upgradePrograms = mysqlTable\("upgradePrograms"([\s\S]*?)export type InsertUpgradeProgram/)?.[1] ?? "";
  const migrationSource = readSource("drizzle", "0076_upgrade_programs.sql");
  const dataSource = readSource("server", "upgradePrograms.ts");

  it("upgradePrograms 是獨立表，沒有案件／顧問外鍵", () => {
    expect(schemaSource).toContain('mysqlTable("upgradePrograms"');
    expect(schemaBlock).not.toContain("upgradeApplications");
    expect(schemaBlock).not.toContain("upgradeConsultants");
    expect(schemaBlock).not.toContain("references(");
    expect(migrationSource).not.toMatch(/FOREIGN KEY/i);
  });

  it("方案刪除採 archivedAt 軟封存，不執行 hard delete", () => {
    expect(dataSource).toContain("adminArchiveUpgradeProgram");
    expect(dataSource).toMatch(/enabled:\s*false,\s*archivedAt:\s*new Date\(\)/);
    expect(dataSource).not.toMatch(/\.delete\(upgradePrograms\)/);
  });
});

describe("tRPC 權限、後台入口與公開頁資料驅動契約", () => {
  const routerSource = readSource("server", "upgradeProgramsRouter.ts");
  const publicPageSource = readSource("client", "src", "pages", "EnterpriseUpgradeCenter.tsx");
  const appSource = readSource("client", "src", "App.tsx");
  const dashboardSource = readSource("client", "src", "pages", "AdminDashboard.tsx");

  it("只有公開列表使用 publicProcedure，所有管理功能都使用 adminProcedure", () => {
    expect(routerSource).toMatch(/listPublic:\s*publicProcedure/);
    for (const procedure of ["adminList", "create", "update", "setEnabled", "move", "archive", "restore"]) {
      expect(routerSource).toMatch(new RegExp(`${procedure}:\\s*adminProcedure`));
    }
    expect(routerSource).not.toContain("protectedProcedure");
  });

  it("公開頁只透過 tRPC 取得方案，沒有再維護 SUBSIDY_PLANS 或五項名稱分支", () => {
    expect(publicPageSource).toContain("trpc.upgradePrograms.listPublic.useQuery");
    expect(publicPageSource).toContain("upgradePrograms.map");
    expect(publicPageSource).not.toContain("SUBSIDY_PLANS");
    expect(publicPageSource).not.toContain("isLastOdd");
    expect(publicPageSource).not.toContain("小型企業創新研發計畫");
  });

  it("卡片 grid 對 1／2／3 欄自然響應，不依賴五項特殊 CSS", () => {
    expect(publicPageSource).toContain("grid-cols-1 items-stretch");
    expect(publicPageSource).toContain("md:grid-cols-2");
    expect(publicPageSource).toContain("xl:grid-cols-3");
  });

  it("保留既有申請 route、登入／工廠權限查詢與進度查詢", () => {
    expect(publicPageSource).toContain('navigate("/upgrade-center/apply")');
    expect(publicPageSource).toContain("trpc.factory.getMine.useQuery");
    expect(publicPageSource).toContain("trpc.factory.getCoManagedFactories.useQuery");
    expect(publicPageSource).toContain("trpc.upgradeCenter.myApplicationProgress.useQuery");
  });

  it("管理 route 與方案／申請兩個入口都存在", () => {
    expect(appSource).toMatch(/<Route path="\/admin\/upgrade-programs" component=\{AdminUpgradePrograms\} \/>/);
    expect(appSource).toMatch(/<Route path="\/admin\/upgrade-applications" component=\{AdminUpgradeApplications\} \/>/);
    expect(dashboardSource).toContain('setLocation("/admin/upgrade-programs")');
    expect(dashboardSource).toContain('setLocation("/admin/upgrade-applications")');
    expect(dashboardSource).toContain("方案管理");
    expect(dashboardSource).toContain("申請管理");
  });
});
