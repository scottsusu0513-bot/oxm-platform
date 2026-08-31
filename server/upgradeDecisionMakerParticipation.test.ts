/**
 * 政府補助專區「決策者是否共同參與」欄位 — 整合測試。走真實本機測試資料庫
 * （受 server/test-db-guard.ts 全域 setupFiles 保護，不可能連到正式/遠端
 * 資料庫），用 appRouter.createCaller(ctx) 直接呼叫 tRPC procedure，手法沿用
 * server/erpOptimizationApplication.test.ts。
 *
 * 涵蓋：
 * 1. owner／manager／unavailable 三個選項皆可成功送出並正確寫入 DB。
 * 2. 缺少或不合法的 decisionMakerParticipation 被 zod 拒絕，不得送出。
 * 3. 顧問（upgradeConsultant.myCases）與管理員（upgradeCenter.adminList／
 *    adminGet）皆讀得到這個欄位。
 * 4. legacy 案件（欄位新增前建立、DB 值為 NULL）讀取不報錯，回傳 null，
 *    不會被自動判定成 "unavailable"。
 * 5. 既有案件 status／建立流程不受影響（沿用既有 submitApplication 行為）。
 *
 * 前端「未選擇不得送出」與「藍色／紅色／灰色徽章顯示」是 UI 行為；vitest 只跑
 * node 環境（見 vitest.config.ts），不 render React 元件，因此本檔案結尾另外
 * 沿用專案既有慣例（例如 server/faqAiEntry.test.ts）以讀原始碼字串比對的方式
 * 驗證對應程式碼確實存在。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const runId = `updm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const TEST_ADMIN_EMAIL = `updm-test-admin-${runId}@example.test`;
// Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：覆寫搬到
// beforeAll，理由同 certificationCaseFallback.test.ts 開頭註解。
const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
const { ensureTestUser, deleteTestUser, createTestFactory, deleteTestFactory } = await import("./_core/financeTestFixtures");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function userCtx(id: number, name: string, isAdmin = false): TrpcContext {
  const user: AuthenticatedUser = {
    id, openId: `${runId}-${id}`, email: `${runId}-${id}@example.test`,
    name, loginMethod: "manus", role: isAdmin ? "admin" : "user", isFactoryOwner: false,
    isAdmin,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function adminCtx(id: number): TrpcContext {
  const ctx = userCtx(id, "決策者參與測試管理員", true);
  (ctx.user as AuthenticatedUser).email = TEST_ADMIN_EMAIL;
  return ctx;
}

async function deleteUpgradeApp(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM upgradeApplications WHERE id = ${id}`);
}

const baseInput = {
  companyName: "決策者參與測試公司",
  contactName: "測試聯絡人",
  phone: "0912345678",
  location: "台北市",
  capitalAmount: "100~500萬",
  annualRevenue: "under_5m",
  employeeCount: "6_30",
  factoryType: "general",
  isEnterpriseFirm: false,
  hasGovernmentProject: false,
  hasAppliedForGovernmentSubsidy: false,
  hasPatent: false,
  exportStatus: "no_export",
  consentAgreed: true as const,
};

let ownerOwnerId: number, ownerManagerId: number, ownerUnavailableId: number, ownerInvalidId: number, adminUserId: number;
let factoryOwnerId: number, factoryManagerId: number, factoryUnavailableId: number, factoryInvalidId: number;
const cleanupAppIds: number[] = [];
let ownerAppId: number;

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([TEST_ADMIN_EMAIL]);
  ownerOwnerId = await ensureTestUser(`${runId}-owner-owner`, "測試申請人-owner");
  ownerManagerId = await ensureTestUser(`${runId}-owner-manager`, "測試申請人-manager");
  ownerUnavailableId = await ensureTestUser(`${runId}-owner-unavailable`, "測試申請人-unavailable");
  ownerInvalidId = await ensureTestUser(`${runId}-owner-invalid`, "測試申請人-invalid");
  adminUserId = await ensureTestUser(`${runId}-admin`, "決策者參與測試管理員", TEST_ADMIN_EMAIL);

  factoryOwnerId = await createTestFactory(ownerOwnerId, `${runId} 工廠-owner`, "approved");
  factoryManagerId = await createTestFactory(ownerManagerId, `${runId} 工廠-manager`, "approved");
  factoryUnavailableId = await createTestFactory(ownerUnavailableId, `${runId} 工廠-unavailable`, "approved");
  factoryInvalidId = await createTestFactory(ownerInvalidId, `${runId} 工廠-invalid`, "approved");
});

afterAll(async () => {
  for (const id of cleanupAppIds) await deleteUpgradeApp(id);
  await deleteTestFactory(factoryOwnerId);
  await deleteTestFactory(factoryManagerId);
  await deleteTestFactory(factoryUnavailableId);
  await deleteTestFactory(factoryInvalidId);
  await deleteTestUser(ownerOwnerId);
  await deleteTestUser(ownerManagerId);
  await deleteTestUser(ownerUnavailableId);
  await deleteTestUser(ownerInvalidId);
  await deleteTestUser(adminUserId);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

describe("upgradeCenter.submitApplication：decisionMakerParticipation 三個合法選項皆可成功送出並正確寫入 DB", () => {
  it("owner 可以成功提交，DB 存的是 'owner'", async () => {
    const caller = appRouter.createCaller(userCtx(ownerOwnerId, "測試-owner"));
    const { id } = await caller.upgradeCenter.submitApplication({
      ...baseInput,
      email: `${runId}-owner@example.test`,
      decisionMakerParticipation: "owner",
      factoryId: factoryOwnerId,
    });
    cleanupAppIds.push(id);
    ownerAppId = id;
    const item = await db.getUpgradeApplicationById(id);
    expect(item?.decisionMakerParticipation).toBe("owner");
  });

  it("manager 可以成功提交，DB 存的是 'manager'", async () => {
    const caller = appRouter.createCaller(userCtx(ownerManagerId, "測試-manager"));
    const { id } = await caller.upgradeCenter.submitApplication({
      ...baseInput,
      email: `${runId}-manager@example.test`,
      decisionMakerParticipation: "manager",
      factoryId: factoryManagerId,
    });
    cleanupAppIds.push(id);
    const item = await db.getUpgradeApplicationById(id);
    expect(item?.decisionMakerParticipation).toBe("manager");
  });

  it("unavailable 可以成功提交，DB 存的是 'unavailable'", async () => {
    const caller = appRouter.createCaller(userCtx(ownerUnavailableId, "測試-unavailable"));
    const { id } = await caller.upgradeCenter.submitApplication({
      ...baseInput,
      email: `${runId}-unavailable@example.test`,
      decisionMakerParticipation: "unavailable",
      factoryId: factoryUnavailableId,
    });
    cleanupAppIds.push(id);
    const item = await db.getUpgradeApplicationById(id);
    expect(item?.decisionMakerParticipation).toBe("unavailable");
  });
});

describe("upgradeCenter.submitApplication：未選擇/不合法 decisionMakerParticipation 不得送出", () => {
  it("缺少 decisionMakerParticipation 欄位 → zod 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerInvalidId, "測試-invalid"));
    const { decisionMakerParticipation: _omit, ...withoutField } = {
      ...baseInput,
      email: `${runId}-invalid1@example.test`,
      decisionMakerParticipation: "owner" as const,
      factoryId: factoryInvalidId,
    };
    await expect(caller.upgradeCenter.submitApplication(withoutField as any)).rejects.toThrow();
  });

  it("decisionMakerParticipation 不是合法列舉值 → zod 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerInvalidId, "測試-invalid"));
    await expect(caller.upgradeCenter.submitApplication({
      ...baseInput,
      email: `${runId}-invalid2@example.test`,
      decisionMakerParticipation: "ceo" as any,
      factoryId: factoryInvalidId,
    })).rejects.toThrow();
  });
});

describe("顧問／管理員讀取案件皆可取得 decisionMakerParticipation", () => {
  it("upgradeConsultant.myCases（管理員視角，見全部案件）讀得到欄位", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const { items } = await caller.upgradeConsultant.myCases({});
    const created = items.find(i => i.id === ownerAppId);
    expect(created).toBeTruthy();
    expect(created!.decisionMakerParticipation).toBe("owner");
  });

  it("upgradeCenter.adminList 讀得到欄位", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const { items } = await caller.upgradeCenter.adminList({ limit: 200, offset: 0 });
    const created = items.filter(i => cleanupAppIds.includes(i.id));
    expect(created.length).toBeGreaterThan(0);
    for (const item of created) {
      expect(["owner", "manager", "unavailable"]).toContain(item.decisionMakerParticipation);
    }
  });

  it("upgradeCenter.adminGet 讀得到單筆案件的欄位", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const item = await caller.upgradeCenter.adminGet({ id: ownerAppId });
    expect(item.decisionMakerParticipation).toBe("owner");
  });
});

describe("legacy 案件（欄位新增前建立，DB 值為 NULL）相容性", () => {
  let legacyAppId: number;

  beforeAll(async () => {
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    // 直接繞過 submitApplication，模擬「欄位新增前」就存在的舊案件：
    // decisionMakerParticipation 完全不寫值（NULL），其餘欄位給最低限度合法值。
    const [result] = await conn.execute(sql`
      INSERT INTO upgradeApplications
        (companyName, contactName, phone, email, location, capitalAmount, employeeCount, factoryType, exportStatus, status, createdAt, updatedAt)
      VALUES
        (${`${runId} legacy公司`}, '舊聯絡人', '0900000000', ${`${runId}-legacy@example.test`}, '台北市', '100~500萬', '6_30', 'general', 'no_export', 'unassigned', NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    legacyAppId = result.insertId;
    cleanupAppIds.push(legacyAppId);
  });

  it("legacy null 案件讀取不會報錯", async () => {
    const item = await db.getUpgradeApplicationById(legacyAppId);
    expect(item).toBeTruthy();
  });

  it("legacy null 案件的 decisionMakerParticipation 為 null（不是自動判定成 unavailable）", async () => {
    const item = await db.getUpgradeApplicationById(legacyAppId);
    expect(item?.decisionMakerParticipation).toBeNull();
    expect(item?.decisionMakerParticipation).not.toBe("unavailable");
  });

  it("管理員 adminGet 讀取 legacy 案件不報錯，欄位為 null", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const item = await caller.upgradeCenter.adminGet({ id: legacyAppId });
    expect(item.decisionMakerParticipation).toBeNull();
  });
});

describe("既有政府補助案件建立流程不受影響", () => {
  it("新申請仍正確建立，status 仍是既有合法值之一", async () => {
    const item = await db.getUpgradeApplicationById(ownerAppId);
    expect(item).toBeTruthy();
    expect(["new", "unassigned"]).toContain(item?.status);
    expect(item?.companyName).toBe(baseInput.companyName);
  });
});

// ── client 端顯示邏輯：原始碼靜態檢查 ──────────────────────────────────────
// vitest 只跑 node 環境（見 vitest.config.ts），不 render React 元件；沿用
// 專案既有慣例（例如 server/faqAiEntry.test.ts）以讀原始碼字串比對的方式，
// 驗證顏色/文字對應與必填驗證確實寫在對應檔案中。

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("client/src/pages/EnterpriseUpgradeApply.tsx — 新欄位為必填單選 radio，三個選項文字未被改寫，沒有第四個選項", () => {
  const source = readSource("client", "src", "pages", "EnterpriseUpgradeApply.tsx");

  it("三個選項 code 與文字對應存在，且剛好三個", () => {
    expect(source).toContain(`{ value: "owner", label: "可以，負責人將共同參與" }`);
    expect(source).toContain(`{ value: "manager", label: "可以，由具決策權主管共同參與" }`);
    expect(source).toContain(`{ value: "unavailable", label: "目前無法安排決策者參與" }`);
    const optionsBlock = source.match(/const DECISION_MAKER_OPTIONS[\s\S]*?=\s*\[([\s\S]*?)\];/);
    expect(optionsBlock).toBeTruthy();
    const valueCount = (optionsBlock![1].match(/value:/g) ?? []).length;
    expect(valueCount).toBe(3);
  });

  it("使用 RadioGroup（不是 Checkbox），且用 hidden input + react-hook-form required 驗證，未選擇不得送出", () => {
    expect(source).toMatch(/decisionMakerParticipationValue[\s\S]{0,400}<RadioGroup/);
    expect(source).toMatch(/register\("decisionMakerParticipation",\s*\{\s*required:/);
  });

  it("送出時把 decisionMakerParticipation 帶入 mutation payload", () => {
    expect(source).toMatch(/decisionMakerParticipation:\s*data\.decisionMakerParticipation/);
  });
});

describe("client 顧問／管理員案件頁 — 決策者參與徽章顏色與文字符合規格", () => {
  it.each([
    ["ConsultantCases.tsx", ["client", "src", "pages", "ConsultantCases.tsx"]],
    ["AdminUpgradeApplications.tsx", ["client", "src", "pages", "AdminUpgradeApplications.tsx"]],
  ])("%s", (_label, segments) => {
    const source = readSource(...(segments as string[]));
    expect(source).toContain(`owner:       { label: "負責人可共同參與",   cls: "bg-blue-100 text-blue-700 border-blue-200" }`);
    expect(source).toContain(`manager:     { label: "決策主管可共同參與", cls: "bg-blue-100 text-blue-700 border-blue-200" }`);
    expect(source).toContain(`unavailable: { label: "無法安排決策者參與", cls: "bg-red-100 text-red-700 border-red-200" }`);
    expect(source).toContain(`const DECISION_MAKER_LEGACY_BADGE = { label: "未填寫", cls: "bg-gray-100 text-gray-500 border-gray-200" };`);
    // 必須出現在標題／基本資訊列附近，且不在「展開/收起」區塊內才會被判定為
    // 一眼可見；這裡至少確認徽章渲染呼叫存在且緊跟著「決策者參與」標籤文字。
    expect(source).toMatch(/決策者參與<\/span>\s*<span className=\{`inline-flex[\s\S]{0,120}decisionMakerBadge|dmBadge/);
  });
});

describe("client/src/pages/EnterpriseUpgradeCenter.tsx — 頁首紅色提醒文字", () => {
  it("提醒文字存在、使用紅色系、字級比說明文字小，且沒有動到右側「XX 項方案」區塊", () => {
    const source = readSource("client", "src", "pages", "EnterpriseUpgradeCenter.tsx");
    expect(source).toContain("補助申請涉及公司投資、預算及執行決策，安排顧問洽談時，請盡量由公司負責人或具決策權之管理階層一同參與，以避免因資訊轉達造成申請進度延誤。");
    expect(source).toMatch(/text-xs leading-relaxed text-red-600/);
    // 說明文字是 text-sm，提醒文字是 text-xs，字級確實較小。GEO Final
    // Cleanup：說明文字改引用 shared/content/upgradeCenter.ts 的
    // UPGRADE_CENTER_CONTENT.programsIntro（同一句話，供 prerender 共用），
    // className／結構本身沒有變動。
    expect(source).toContain(`<p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">{UPGRADE_CENTER_CONTENT.programsIntro}</p>`);
    // 右側「XX 項方案」區塊未被改動
    expect(source).toContain(`{String(upgradePrograms.length).padStart(2, "0")}`);
    expect(source).toContain(`<span className="text-xs font-semibold tracking-wider text-slate-400">項方案</span>`);
  });
});

describe("drizzle/schema.ts — decisionMakerParticipation 欄位可為 NULL（相容舊案件），非 mysqlEnum 硬列舉", () => {
  it("欄位定義存在且為 nullable varchar", () => {
    const source = readSource("drizzle", "schema.ts");
    expect(source).toMatch(/decisionMakerParticipation:\s*varchar\("decisionMakerParticipation",\s*\{\s*length:\s*20\s*\}\),/);
  });
});

describe("drizzle/0077_upgrade_decision_maker_participation.sql — additive migration，不動既有資料", () => {
  it("只新增欄位，沒有 DROP／TRUNCATE／DELETE／UPDATE 既有資料，沒有改動 status", () => {
    const source = readSource("drizzle", "0077_upgrade_decision_maker_participation.sql");
    expect(source).toMatch(/ALTER TABLE `upgradeApplications`/);
    expect(source).toMatch(/ADD COLUMN `decisionMakerParticipation` varchar\(20\) NULL/);
    expect(source).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
    expect(source).not.toMatch(/TRUNCATE/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toMatch(/\bUPDATE\s+`?upgradeApplications`?\s+SET\b/i);
  });
});
