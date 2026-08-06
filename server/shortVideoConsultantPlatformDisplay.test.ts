/**
 * 短影音顧問案件看板「經營平台」顯示 — 測試。
 *
 * 本專案 vitest 設定為 environment: "node"（見 vitest.config.ts），沒有
 * jsdom／@testing-library/react，無法直接渲染 React 元件斷言畫面內容；
 * 因此比照 certificationCenterNoPublicEntry 系列的既有手法，對純函式做
 * 真正的行為測試（shortVideoPlatformLabel），對 React 元件原始碼做靜態
 * 契約檢查（確認正確的條件分支、正確呼叫共用 mapping、沒有直接印出原始
 * 代碼／JSON／null／空陣列、沒有為 admin 與顧問各自準備不同內容、使用
 * 可換行的排版 class）。實際畫面已用 Playwright 對真實執行中的頁面做過
 * 視覺驗證（攔截 tRPC 回應改回傳假資料，全程未寫入任何資料庫）。
 *
 * 資料流已確認：
 * 1. drizzle/schema.ts：shortVideoCases.platforms（json 陣列，預設 []）、
 *    noPlatformYet（boolean，預設 false）——本輪未修改 schema。
 * 2. server/routers.ts：shortVideoConsultant.myCases 呼叫
 *    db.listShortVideoCasesForConsultant／listShortVideoCasesAdmin，兩者
 *    皆為 db_.select().from(shortVideoCases) 的完整 SELECT *，沒有欄位
 *    白名單過濾，platforms／noPlatformYet 兩欄位本來就會回傳給前端——
 *    本輪未修改 router。
 * 3. client/src/pages/ShortVideoConsultantCases.tsx：CaseCard 元件本輪
 *    新增「經營平台」顯示區塊，是本輪唯一改動的顯示邏輯。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("shortVideoPlatformLabel：純函式行為測試（shared/shortVideoMarketing.ts）", () => {
  it("四個既有平台代碼都能對應到申請表原有的品牌名稱", async () => {
    const { shortVideoPlatformLabel } = await import("../shared/shortVideoMarketing");
    expect(shortVideoPlatformLabel("instagram")).toBe("Instagram");
    expect(shortVideoPlatformLabel("facebook")).toBe("Facebook");
    expect(shortVideoPlatformLabel("tiktok")).toBe("TikTok");
    expect(shortVideoPlatformLabel("youtube")).toBe("YouTube");
  });

  it("與 SHORT_VIDEO_PLATFORMS 是同一份資料來源，不是另建的第二套名稱清單", async () => {
    const { shortVideoPlatformLabel, SHORT_VIDEO_PLATFORMS } = await import("../shared/shortVideoMarketing");
    for (const p of SHORT_VIDEO_PLATFORMS) {
      expect(shortVideoPlatformLabel(p.key)).toBe(p.label);
    }
  });

  it("未知代碼時 fallback 回傳原字串本身（不拋錯、不回傳 undefined）", async () => {
    const { shortVideoPlatformLabel } = await import("../shared/shortVideoMarketing");
    expect(shortVideoPlatformLabel("unknown_platform_xyz")).toBe("unknown_platform_xyz");
  });
});

describe("ShortVideoConsultantCases.tsx：CaseCard 經營平台顯示邏輯（靜態原始碼契約檢查）", () => {
  const source = readSource("client", "src", "pages", "ShortVideoConsultantCases.tsx");

  it("有從共用 mapping import shortVideoPlatformLabel，不是自建平台名稱對照表", () => {
    expect(source).toMatch(/import\s*\{[^}]*shortVideoPlatformLabel[^}]*\}\s*from\s*["']@shared\/shortVideoMarketing["']/);
  });

  it("noPlatformYet 為 true 時顯示「尚未經營」", () => {
    expect(source).toMatch(/item\.noPlatformYet[\s\S]{0,80}尚未經營/);
  });

  it("platforms 有資料時，逐一用 shortVideoPlatformLabel 轉換後顯示，不是直接印出原始代碼陣列", () => {
    expect(source).toMatch(/platforms\.map[\s\S]{0,120}shortVideoPlatformLabel/);
  });

  it("兩欄位都沒有資料（舊資料／空陣列）時顯示「未填寫」", () => {
    expect(source).toMatch(/經營平台：<\/span>未填寫/);
  });

  it("platforms 陣列做了防禦性型別檢查（Array.isArray），不會對非陣列值呼叫 .map 而壞掉", () => {
    expect(source).toMatch(/Array\.isArray\(item\.platforms\)/);
  });

  it("沒有任何地方把 platforms 原始陣列直接轉成字串印出（例如 join 原始代碼、JSON.stringify、或直接插值整個陣列）", () => {
    // 允許 shortVideoPlatformLabel(p) 轉換後的 label 拼接，但不允許把 item.platforms
    // 整包原始陣列丟進畫面（JSON.stringify(item.platforms) 或 {item.platforms} 這種寫法）。
    expect(source).not.toMatch(/JSON\.stringify\(\s*item\.platforms\s*\)/);
    expect(source).not.toMatch(/\{item\.platforms\}/);
    expect(source).not.toMatch(/item\.platforms\.join\(/);
  });

  it("經營平台顯示區塊使用 flex-wrap 排版，多個平台標籤可自動換行，手機版不會橫向溢出", () => {
    const block = source.match(/經營平台：[\s\S]{0,400}/);
    expect(block).toBeTruthy();
    // 往前找最近的排版容器 class，確認有 flex-wrap。
    const idx = source.indexOf("platforms.map");
    expect(idx).toBeGreaterThan(-1);
    const precedingSlice = source.slice(Math.max(0, idx - 400), idx);
    expect(precedingSlice).toMatch(/flex-wrap/);
  });

  it("經營平台顯示區塊在 CaseCard 內、不在任何 {isAdmin && ...} 條件式範圍內——管理員與承辦顧問看到的內容必須一致", () => {
    const caseCardMatch = source.match(/function CaseCard[\s\S]*?\n\}/);
    expect(caseCardMatch).toBeTruthy();
    const caseCardBody = caseCardMatch![0];
    const platformIdx = caseCardBody.indexOf("經營平台：");
    expect(platformIdx).toBeGreaterThan(-1);
    const isAdminIdx = caseCardBody.indexOf("{isAdmin &&");
    // isAdmin 區塊（承辦顧問下拉選單）本來就存在，但必須出現在經營平台顯示「之後」，
    // 確認經營平台本身沒有被包在 isAdmin 條件式裡面。
    if (isAdminIdx !== -1) {
      expect(platformIdx).toBeLessThan(isAdminIdx);
    }
  });
});

describe("shortVideoConsultant.myCases 權限與資料流本輪未變動（如實引用既有 router／db 邏輯）", () => {
  it("server/routers.ts 的 shortVideoConsultant.myCases 仍是既有的 isAdmin 分支結構（未修改權限）", () => {
    const source = readSource("server", "routers.ts");
    expect(source).toMatch(/shortVideoConsultant:\s*router\(\{[\s\S]{0,600}myCases:[\s\S]{0,400}ctx\.user\.isAdmin/);
  });

  it("server/db.ts 的 listShortVideoCasesForConsultant／listShortVideoCasesAdmin 都是完整 SELECT *，platforms／noPlatformYet 不會被欄位白名單濾掉", () => {
    const source = readSource("server", "db.ts");
    expect(source).toMatch(/listShortVideoCasesForConsultant[\s\S]{0,500}db_\.select\(\)\.from\(shortVideoCases\)/);
    expect(source).toMatch(/listShortVideoCasesAdmin[\s\S]{0,500}db_\.select\(\)\.from\(shortVideoCases\)/);
  });

  it("drizzle/schema.ts 的 shortVideoCases.platforms／noPlatformYet 欄位定義本輪未變動", () => {
    const source = readSource("drizzle", "schema.ts");
    expect(source).toMatch(/platforms:\s*json\("platforms"\)\.\$type<string\[\]>\(\)\.notNull\(\)\.default\(\[\]\)/);
    expect(source).toMatch(/noPlatformYet:\s*boolean\("noPlatformYet"\)\.notNull\(\)\.default\(false\)/);
  });
});
