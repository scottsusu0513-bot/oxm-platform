/**
 * ISO 與低碳認證專區：認證服務目錄 — 行為測試。
 *
 * 涵蓋：
 * 1. 冪等種子（ensureCertificationServiceCatalogSeeded）產生精確的 9 項第一批
 *    資料，BNI 與其他既有徽章（HACCP、CE、UL 等）不會出現。
 * 2. 公開查詢（db.listPublicCertificationServices／
 *    trpc.certificationCenter.listServices）只回傳 published + serviceEnabled
 *    且分類 isActive 的項目，draft／unpublished／archived 或已停用一律排除。
 * 3. 狀態轉換規則（只能依表定路徑轉換，非法轉換拋出錯誤）。
 * 4. 只有 draft 狀態可以永久刪除。
 * 5. 管理員 API 需要 adminProcedure，一般使用者呼叫會被拒絕。
 *
 * 本檔案自建、自刪一筆獨立測試分類與服務項目（code 帶入唯一 runId），完全
 * 不觸碰種子資料本身（種子資料只讀，不刪除、不修改），也不觸碰既有徽章
 * 系統任何資料表。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { getDb } from "./db";
import { CERTIFICATION_SERVICE_ITEM_SEEDS, CERTIFICATION_SERVICE_CATEGORY_SEEDS } from "../shared/certificationServices";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  const user: AuthenticatedUser = {
    id: 1,
    openId: isAdmin ? "test-csc-admin" : "test-csc-user",
    email: isAdmin ? "scottsusu0513@gmail.com" : "test@example.com",
    name: "Test User",
    loginMethod: isAdmin ? "google" : "manus",
    role: "user",
    isAdmin,
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function unauthenticatedContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const adminCtx = () => createAuthContext({ role: "admin" });
const userCtx = () => createAuthContext({ role: "user" });

// 借用既有種子分類的 id 來建立測試項目（categoryId 只是 FK 參照，不會修改
// 該分類本身），不建立、不刪除任何分類，避免誤刪種子分類。
let seededCategoryId: number | undefined;
let testItemId: number | undefined;

beforeAll(async () => {
  // 種子函式冪等，重複呼叫不會產生重複資料，安全在測試中直接呼叫。
  await db.ensureCertificationServiceCatalogSeeded();
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  if (testItemId) {
    const { sql } = await import("drizzle-orm");
    await conn.execute(sql`DELETE FROM certificationServiceItems WHERE id = ${testItemId}`);
  }
});

describe("冪等種子：第一批固定 9 項", () => {
  it("shared/certificationServices.ts 的種子資料剛好是 9 項、3 個分類", () => {
    expect(CERTIFICATION_SERVICE_ITEM_SEEDS.length).toBe(9);
    expect(CERTIFICATION_SERVICE_CATEGORY_SEEDS.length).toBe(3);
  });

  it("種子資料的 code 清單精確等於指定的 9 項，不多不少", () => {
    const codes = CERTIFICATION_SERVICE_ITEM_SEEDS.map(s => s.code).sort();
    expect(codes).toEqual([
      "iso-14001", "iso-14064-1", "iso-14067", "iso-27001", "iso-45001",
      "iso-50001", "iso-9001", "product-carbon-footprint-label", "product-carbon-reduction-label",
    ].sort());
  });

  it("種子資料完全沒有 bni 或其他既有產業／產品認證（haccp／ce／ul／rohs／halal／oeko-tex／gots／grs／fsc／fssc-22000）", () => {
    const badgeCodes = CERTIFICATION_SERVICE_ITEM_SEEDS.map(s => s.badgeCode).filter(Boolean);
    const forbidden = ["bni", "haccp", "ce", "ul", "rohs", "halal", "oeko-tex", "gots", "grs", "fsc", "fssc-22000"];
    for (const f of forbidden) expect(badgeCodes).not.toContain(f);
  });

  it("ISO/IEC 27001 沒有對應的既有徽章代碼（badgeCode 為 null），其餘 8 項皆有對應既有徽章代碼", () => {
    const iso27001 = CERTIFICATION_SERVICE_ITEM_SEEDS.find(s => s.code === "iso-27001");
    expect(iso27001?.badgeCode).toBeNull();
    const others = CERTIFICATION_SERVICE_ITEM_SEEDS.filter(s => s.code !== "iso-27001");
    for (const o of others) expect(o.badgeCode).toBeTruthy();
  });

  it("呼叫 ensureCertificationServiceCatalogSeeded() 第二次不會產生重複資料（冪等）", async () => {
    const before = await db.adminListCertificationServiceItems();
    await db.ensureCertificationServiceCatalogSeeded();
    const after = await db.adminListCertificationServiceItems();
    expect(after.length).toBe(before.length);
  });
});

describe("公開查詢只回傳 published + serviceEnabled 的項目", () => {
  it("listPublicCertificationServices() 回傳的 9 項種子資料全部是 published 狀態", async () => {
    const publicItems = await db.listPublicCertificationServices();
    const seedCodes = new Set(CERTIFICATION_SERVICE_ITEM_SEEDS.map(s => s.code));
    const matched = publicItems.filter(i => seedCodes.has(i.code));
    expect(matched.length).toBe(9);
    for (const item of matched) {
      expect(item.status).toBe("published");
      expect(item.serviceEnabled).toBe(true);
    }
  });

  it("新建一筆 draft 測試項目：不會出現在公開查詢結果中", async () => {
    const categories = await db.adminListCertificationCategories();
    const category = categories[0];
    seededCategoryId = category.id;
    testItemId = await db.adminCreateCertificationServiceItem({
      code: `csc-test-draft-${runId}`,
      badgeCode: null,
      categoryId: category.id,
      name: "測試草稿項目",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      iconKey: null,
      serviceEnabled: true,
      consultEnabled: true,
    });
    const publicItems = await db.listPublicCertificationServices();
    expect(publicItems.some(i => i.id === testItemId)).toBe(false);
  });

  it("同一筆項目上架（published）後會出現在公開查詢結果；serviceEnabled=false 後即使 published 也不會出現", async () => {
    if (!testItemId) throw new Error("test item not created");
    await db.adminSetCertificationServiceItemStatus(testItemId, "published");
    let publicItems = await db.listPublicCertificationServices();
    expect(publicItems.some(i => i.id === testItemId)).toBe(true);

    await db.adminUpdateCertificationServiceItem(testItemId, { serviceEnabled: false });
    publicItems = await db.listPublicCertificationServices();
    expect(publicItems.some(i => i.id === testItemId)).toBe(false);
  });
});

describe("狀態轉換規則", () => {
  it("draft → published → unpublished → archived → unpublished 皆合法", async () => {
    if (!testItemId) throw new Error("test item not created");
    await db.adminUpdateCertificationServiceItem(testItemId, { serviceEnabled: true });
    await db.adminSetCertificationServiceItemStatus(testItemId, "unpublished");
    await db.adminSetCertificationServiceItemStatus(testItemId, "archived");
    await db.adminSetCertificationServiceItemStatus(testItemId, "unpublished");
    const item = await db.getCertificationServiceItemById(testItemId);
    expect(item?.status).toBe("unpublished");
  });

  it("archived 不能直接轉回 published（必須先經過 unpublished 復原）", async () => {
    if (!testItemId) throw new Error("test item not created");
    await db.adminSetCertificationServiceItemStatus(testItemId, "archived");
    await expect(db.adminSetCertificationServiceItemStatus(testItemId, "published")).rejects.toThrow();
    // 還原成 unpublished，讓後續測試（若有）狀態可預期。
    await db.adminSetCertificationServiceItemStatus(testItemId, "unpublished");
  });
});

describe("刪除限制：只有 draft 狀態可以永久刪除", () => {
  it("非 draft 狀態（unpublished）呼叫刪除會被拒絕", async () => {
    if (!testItemId) throw new Error("test item not created");
    const item = await db.getCertificationServiceItemById(testItemId);
    expect(item?.status).not.toBe("draft");
    await expect(db.adminDeleteCertificationServiceItem(testItemId)).rejects.toThrow();
  });

  it("draft 狀態可以成功永久刪除", async () => {
    const categories = await db.adminListCertificationCategories();
    const draftId = await db.adminCreateCertificationServiceItem({
      code: `csc-test-draft2-${runId}`,
      badgeCode: null,
      categoryId: categories[0].id,
      name: "測試可刪除草稿",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      iconKey: null,
      serviceEnabled: true,
      consultEnabled: true,
    });
    await db.adminDeleteCertificationServiceItem(draftId);
    const item = await db.getCertificationServiceItemById(draftId);
    expect(item).toBeUndefined();
  });
});

describe("管理員 API 權限：非管理員一律拒絕", () => {
  it("一般使用者呼叫 admin.certificationServices.listItems 會被拒絕", async () => {
    const caller = appRouter.createCaller(userCtx());
    await expect(caller.admin.certificationServices.listItems()).rejects.toThrow();
  });

  it("未登入呼叫 admin.certificationServices.listItems 會被拒絕", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());
    await expect(caller.admin.certificationServices.listItems()).rejects.toThrow();
  });

  it("管理員呼叫 admin.certificationServices.listItems 成功", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const items = await caller.admin.certificationServices.listItems();
    expect(Array.isArray(items)).toBe(true);
  });

  it("一般使用者呼叫 admin.certificationServices.createItem（mutation）也會被拒絕", async () => {
    const caller = appRouter.createCaller(userCtx());
    await expect(caller.admin.certificationServices.createItem({
      code: `csc-test-forbidden-${runId}`,
      badgeCode: null,
      categoryId: seededCategoryId ?? 1,
      name: "不應該被建立",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      serviceEnabled: true,
      consultEnabled: true,
    })).rejects.toThrow();
  });

  it("公開路由 certificationCenter.listServices／listCategories 不需要登入即可呼叫成功", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());
    const categories = await caller.certificationCenter.listCategories();
    const services = await caller.certificationCenter.listServices();
    expect(Array.isArray(categories)).toBe(true);
    expect(Array.isArray(services)).toBe(true);
  });
});

describe("動態分類管理：新增／改名／排序／啟用／停用，且停用會連帶排除該分類的服務項目", () => {
  let categoryAId: number | undefined;
  let categoryBId: number | undefined;
  let categoryItemId: number | undefined;

  afterAll(async () => {
    // categoryItemId 這筆測試 fixture 在測試過程中會被 published（驗證「上架
    // 項目在分類停用時也會被排除」），而 adminDeleteCertificationServiceItem
    // 刻意拒絕刪除任何非 draft 狀態的項目（見「刪除限制」describe 區塊、
    // server/db.ts 的設計說明：已上架／下架／封存的項目只能改狀態，不能刪除，
    // 避免未來案件遺失對應項目）——這是設計上刻意的保護，不是 bug。因此這裡
    // 的測試 fixture 清理直接用原生 SQL 繞過這層保護（僅限測試自己建立、
    // 已驗證過的 fixture，不影響任何真實資料或種子資料），FK 要求刪除分類前
    // 該分類底下不能有任何服務項目，所以先刪項目再刪分類。
    const conn = await getDb();
    if (!conn) return;
    const { sql } = await import("drizzle-orm");
    if (categoryItemId) await conn.execute(sql`DELETE FROM certificationServiceItems WHERE id = ${categoryItemId}`);
    if (categoryAId) await conn.execute(sql`DELETE FROM certificationServiceCategories WHERE id = ${categoryAId}`);
    if (categoryBId) await conn.execute(sql`DELETE FROM certificationServiceCategories WHERE id = ${categoryBId}`);
  });

  it("管理員可以新增分類", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const resA = await caller.admin.certificationServices.createCategory({
      code: `csc-test-cat-a-${runId}`, name: "測試分類 A",
    });
    const resB = await caller.admin.certificationServices.createCategory({
      code: `csc-test-cat-b-${runId}`, name: "測試分類 B",
    });
    categoryAId = resA.id;
    categoryBId = resB.id;
    expect(categoryAId).toBeTypeOf("number");
    expect(categoryBId).toBeTypeOf("number");
  });

  it("管理員可以將分類改名", async () => {
    if (!categoryAId) throw new Error("category A not created");
    const caller = appRouter.createCaller(adminCtx());
    await caller.admin.certificationServices.updateCategory({ id: categoryAId, name: "測試分類 A（已改名）" });
    const categories = await db.adminListCertificationCategories();
    const updated = categories.find(c => c.id === categoryAId);
    expect(updated?.name).toBe("測試分類 A（已改名）");
  });

  it("管理員可以交換兩個分類的排序（只操作本測試自建的兩筆分類，不觸碰種子分類的 sortOrder）", async () => {
    if (!categoryAId || !categoryBId) throw new Error("test categories not created");
    const before = await db.adminListCertificationCategories();
    const a0 = before.find(c => c.id === categoryAId)!;
    const b0 = before.find(c => c.id === categoryBId)!;
    const caller = appRouter.createCaller(adminCtx());
    await caller.admin.certificationServices.moveCategory({ idA: categoryAId, idB: categoryBId });
    const after = await db.adminListCertificationCategories();
    const a1 = after.find(c => c.id === categoryAId)!;
    const b1 = after.find(c => c.id === categoryBId)!;
    expect(a1.sortOrder).toBe(b0.sortOrder);
    expect(b1.sortOrder).toBe(a0.sortOrder);

    // 確認種子分類（iso-management／carbon-assessment／government-carbon-label）
    // 的 sortOrder 完全沒有被這次操作影響。
    const seedCodes = CERTIFICATION_SERVICE_CATEGORY_SEEDS.map(s => s.code);
    for (const seed of CERTIFICATION_SERVICE_CATEGORY_SEEDS) {
      const current = after.find(c => c.code === seed.code);
      expect(current?.sortOrder).toBe(seed.sortOrder);
    }
    expect(seedCodes.length).toBe(3);
  });

  it("新增分類預設為啟用（isActive=true），管理員可以停用；停用後該分類不出現在公開 listCategories", async () => {
    if (!categoryAId) throw new Error("category A not created");
    const before = await db.adminListCertificationCategories();
    expect(before.find(c => c.id === categoryAId)?.isActive).toBe(true);

    const caller = appRouter.createCaller(adminCtx());
    await caller.admin.certificationServices.updateCategory({ id: categoryAId, isActive: false });

    const publicCategories = await db.listPublicCertificationCategories();
    expect(publicCategories.some(c => c.id === categoryAId)).toBe(false);
  });

  it("停用分類後，該分類底下即使 published+serviceEnabled 的服務項目也不會出現在公開查詢／公開 API 中；重新啟用分類後會恢復出現", async () => {
    if (!categoryAId) throw new Error("category A not created");
    categoryItemId = await db.adminCreateCertificationServiceItem({
      code: `csc-test-cat-item-${runId}`,
      badgeCode: null,
      categoryId: categoryAId,
      name: "停用分類測試項目",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      iconKey: null,
      serviceEnabled: true,
      consultEnabled: true,
    });
    await db.adminSetCertificationServiceItemStatus(categoryItemId, "published");

    // 此時 categoryA 仍是停用狀態（上一個測試已停用），項目雖 published+enabled
    // 仍不應出現在公開查詢，因為所屬分類未啟用。
    let publicItems = await db.listPublicCertificationServices();
    expect(publicItems.some(i => i.id === categoryItemId)).toBe(false);

    const caller = appRouter.createCaller(adminCtx());
    await caller.admin.certificationServices.updateCategory({ id: categoryAId, isActive: true });

    publicItems = await db.listPublicCertificationServices();
    expect(publicItems.some(i => i.id === categoryItemId)).toBe(true);

    const publicCategoriesAfter = await db.listPublicCertificationCategories();
    expect(publicCategoriesAfter.some(c => c.id === categoryAId)).toBe(true);
  });

  it("分類 code 有唯一性約束：重複 code 會被拒絕", async () => {
    if (!categoryAId) throw new Error("category A not created");
    const categories = await db.adminListCertificationCategories();
    const existingCode = categories.find(c => c.id === categoryAId)!.code;
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.certificationServices.createCategory({
      code: existingCode, name: "重複代碼測試",
    })).rejects.toThrow();
  });
});

describe("徽章代碼關聯與穩定 code 保護", () => {
  it("九項種子資料的 badgeCode（非 null 者）在 shared/badges.ts 的 CERTIFICATION_BADGE_ID_SET 中都真實存在", async () => {
    const { CERTIFICATION_BADGE_ID_SET } = await import("../shared/badges");
    for (const seed of CERTIFICATION_SERVICE_ITEM_SEEDS) {
      if (seed.badgeCode === null) continue;
      expect(CERTIFICATION_BADGE_ID_SET.has(seed.badgeCode), `badgeCode "${seed.badgeCode}"（服務項目 ${seed.code}）必須存在於既有徽章清單`).toBe(true);
    }
  });

  it("服務項目的穩定 code 建立後無法透過 updateItem 修改（zod 輸入本身不接受 code 欄位）", async () => {
    if (!testItemId) throw new Error("test item not created");
    const before = await db.getCertificationServiceItemById(testItemId);
    const caller = appRouter.createCaller(adminCtx());
    // updateItem 的 zod input 沒有 code 欄位，即使呼叫端在物件字面量夾帶
    // code，tRPC 的 zod parse 也會直接剔除這個未知欄位（strip，非 passthrough），
    // 不會被寫入資料庫。
    await caller.admin.certificationServices.updateItem({
      id: testItemId,
      name: "改名測試（不應影響 code）",
      // @ts-expect-error 刻意測試：即使故意夾帶 code，也必須被 zod 忽略
      code: "should-not-be-applied",
    });
    const after = await db.getCertificationServiceItemById(testItemId);
    expect(after?.code).toBe(before?.code);
    expect(after?.name).toBe("改名測試（不應影響 code）");
  });

  it("服務項目 code 有唯一性約束：重複 code 會被拒絕", async () => {
    if (!testItemId || !seededCategoryId) throw new Error("fixtures not ready");
    const existing = await db.getCertificationServiceItemById(testItemId);
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.certificationServices.createItem({
      code: existing!.code,
      badgeCode: null,
      categoryId: seededCategoryId,
      name: "重複代碼測試項目",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      serviceEnabled: true,
      consultEnabled: true,
    })).rejects.toThrow();
  });
});

describe("badgeCode 伺服器端驗證：createItem／updateItem 皆拒絕無效代碼", () => {
  it("新增項目時，無效 badgeCode 被拒絕且沒有新增任何資料", async () => {
    if (!seededCategoryId) throw new Error("fixtures not ready");
    const before = await db.adminListCertificationServiceItems();
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.certificationServices.createItem({
      code: `csc-test-badcode-${runId}`,
      // @ts-expect-error 刻意測試不存在的徽章代碼
      badgeCode: "not-a-real-badge-code",
      categoryId: seededCategoryId,
      name: "無效徽章代碼測試",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      serviceEnabled: true,
      consultEnabled: true,
    })).rejects.toThrow();

    const after = await db.adminListCertificationServiceItems();
    expect(after.length).toBe(before.length);
    expect(after.some(i => i.code === `csc-test-badcode-${runId}`)).toBe(false);
  });

  it("編輯項目時，無效 badgeCode 被拒絕且原資料完全不變", async () => {
    if (!testItemId) throw new Error("test item not created");
    const before = await db.getCertificationServiceItemById(testItemId);
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.admin.certificationServices.updateItem({
      id: testItemId,
      // @ts-expect-error 刻意測試不存在的徽章代碼
      badgeCode: "also-not-real",
    })).rejects.toThrow();

    const after = await db.getCertificationServiceItemById(testItemId);
    expect(after?.badgeCode).toBe(before?.badgeCode);
    expect(after?.name).toBe(before?.name);
  });

  it("badgeCode 為 null 可以正常建立及更新", async () => {
    if (!seededCategoryId) throw new Error("fixtures not ready");
    const caller = appRouter.createCaller(adminCtx());
    const created = await caller.admin.certificationServices.createItem({
      code: `csc-test-nullbadge-${runId}`,
      badgeCode: null,
      categoryId: seededCategoryId,
      name: "null 徽章代碼測試",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      serviceEnabled: true,
      consultEnabled: true,
    });
    const item = await db.getCertificationServiceItemById(created.id);
    expect(item?.badgeCode).toBeNull();

    await caller.admin.certificationServices.updateItem({ id: created.id, badgeCode: null });
    const afterUpdate = await db.getCertificationServiceItemById(created.id);
    expect(afterUpdate?.badgeCode).toBeNull();

    // 空白字串也應等同 null（前端 Select 的「無對應徽章」轉換路徑）。
    await caller.admin.certificationServices.updateItem({ id: created.id, badgeCode: "  " });
    const afterBlank = await db.getCertificationServiceItemById(created.id);
    expect(afterBlank?.badgeCode).toBeNull();

    // 清理：這是本測試自建的草稿，draft 狀態允許永久刪除。
    await db.adminDeleteCertificationServiceItem(created.id);
  });

  it("有效的既有徽章代碼可以正常建立與更新", async () => {
    if (!seededCategoryId) throw new Error("fixtures not ready");
    const caller = appRouter.createCaller(adminCtx());
    const created = await caller.admin.certificationServices.createItem({
      code: `csc-test-validbadge-${runId}`,
      badgeCode: "iso-9001",
      categoryId: seededCategoryId,
      name: "有效徽章代碼測試",
      type: "管理系統",
      shortDescription: "測試用",
      applicableNeeds: [],
      applicableIndustries: [],
      versionNote: null,
      serviceEnabled: true,
      consultEnabled: true,
    });
    let item = await db.getCertificationServiceItemById(created.id);
    expect(item?.badgeCode).toBe("iso-9001");

    await caller.admin.certificationServices.updateItem({ id: created.id, badgeCode: "iso-14001" });
    item = await db.getCertificationServiceItemById(created.id);
    expect(item?.badgeCode).toBe("iso-14001");

    await db.adminDeleteCertificationServiceItem(created.id);
  });
});
