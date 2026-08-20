/**
 * Phase 11.2（見對話中「七、統一 Factory Resolver」）：getAiFactoryContext()／
 * resolveApprovedAiFactoryContext() 現在唯一 source of truth 是
 * db.getActiveFactoryAffiliationDetail()（只認 status='approved'），不再各自
 * 呼叫 getFactoryByOwnerId／getCoManagedFactories（那條路徑不篩 status，是
 * Phase 11.1 Audit 認定的 P0 根因之一）。
 *
 * R1-R6（見「三十二、Approved Resolver Tests」）：驗證 approved owner／
 * approved co-manager／pending／rejected／delisted／無 approved 工廠 六種
 * 情境下的解析結果，確保跟 entitlement.ts 用的是同一套判斷標準。
 *
 * 白名單驗證（回傳物件不含 adminNote/contactStatus/... 等內部或個資欄位）
 * 沿用既有測試精神，全部用 vi.mock 隔離 db.ts，不連真實資料庫。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetActiveFactoryAffiliationDetail = vi.fn();
const mockGetFactoryById = vi.fn();

vi.mock("../db", () => ({
  getActiveFactoryAffiliationDetail: (...args: unknown[]) => mockGetActiveFactoryAffiliationDetail(...args),
  getFactoryById: (...args: unknown[]) => mockGetFactoryById(...args),
}));

import { getAiFactoryContext, resolveApprovedAiFactoryContext } from "./factoryContext";

const FULL_FACTORY_ROW = {
  id: 1,
  ownerId: 42,
  name: "測試金屬加工廠",
  industry: ["金屬加工"],
  mfgModes: ["ODM", "OEM"],
  region: "台中市",
  description: "專精五金沖壓與 CNC 加工。",
  capitalLevel: "1000萬-5000萬",
  foundedYear: 2005,
  ownerName: "王小明",
  contactPersonName: "王小明",
  phone: "0912345678",
  website: "https://example.com",
  contactEmail: "owner@example.com",
  address: "台中市西屯區某路 1 號",
  avgRating: "4.5",
  reviewCount: 10,
  status: "approved",
  businessType: "factory",
  operationStatus: "normal",
  certified: true,
  subIndustry: ["沖壓"],
  certificationBadges: ["iso9001"],
  certificationBadgesVisible: ["iso9001"],
  certificationEvidence: [{ key: "secret-evidence-key" }],
  adminNote: "這是內部備註，絕不可外流",
  contactStatus: "follow_up",
  rejectionReason: null,
  deletedAt: null,
};

describe("getAiFactoryContext / resolveApprovedAiFactoryContext（Phase 11.2 統一 approved resolver）", () => {
  beforeEach(() => {
    mockGetActiveFactoryAffiliationDetail.mockReset();
    mockGetFactoryById.mockReset();
  });

  it("R1：approved owner → 正確解析出企業 context", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue({
      factoryId: 1, factoryName: "測試金屬加工廠", factoryStatus: "approved", role: "owner",
    });
    mockGetFactoryById.mockResolvedValue(FULL_FACTORY_ROW);

    const ctx = await getAiFactoryContext(42);

    expect(ctx).toEqual({
      companyName: "測試金屬加工廠",
      industry: ["金屬加工"],
      subIndustry: ["沖壓"],
      region: "台中市",
      businessType: "factory",
      foundedYear: 2005,
      capitalLevel: "1000萬-5000萬",
      mfgModes: ["ODM", "OEM"],
      description: "專精五金沖壓與 CNC 加工。",
    });

    const resolution = await resolveApprovedAiFactoryContext(42);
    expect(resolution).toEqual({ id: 1, context: ctx, role: "owner" });
  });

  it("R2：approved co-manager → 正確解析出企業 context", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue({
      factoryId: 1, factoryName: "測試金屬加工廠", factoryStatus: "approved", role: "co_manager",
    });
    mockGetFactoryById.mockResolvedValue(FULL_FACTORY_ROW);

    const ctx = await getAiFactoryContext(99);
    expect(ctx?.companyName).toBe("測試金屬加工廠");

    const resolution = await resolveApprovedAiFactoryContext(99);
    expect(resolution?.role).toBe("co_manager");
    expect(resolution?.id).toBe(1);
  });

  it("R3：pending owner（尚未核准）→ null（getActiveFactoryAffiliationDetail 只認 approved，直接回傳 null，不會走到這裡）", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue(null);

    const ctx = await getAiFactoryContext(7);
    expect(ctx).toBeNull();
    const resolution = await resolveApprovedAiFactoryContext(7);
    expect(resolution).toBeNull();
    expect(mockGetFactoryById).not.toHaveBeenCalled();
  });

  it("R4：rejected owner → null", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue(null);

    const resolution = await resolveApprovedAiFactoryContext(8);
    expect(resolution).toBeNull();
  });

  it("R5：delisted owner → null", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue(null);

    const resolution = await resolveApprovedAiFactoryContext(9);
    expect(resolution).toBeNull();
  });

  it("R6：admin 沒有任何 approved 工廠 → null，不 fallback 成任何其他狀態的工廠", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue(null);

    const ctx = await getAiFactoryContext(999);
    expect(ctx).toBeNull();
    const resolution = await resolveApprovedAiFactoryContext(999);
    expect(resolution).toBeNull();
  });

  it("既不是 owner 也沒有 approved 共管工廠：回傳 null，不丟錯", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue(null);

    const ctx = await getAiFactoryContext(7);
    expect(ctx).toBeNull();
  });

  it("回傳物件絕對不包含內部/個資欄位", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue({
      factoryId: 1, factoryName: "測試金屬加工廠", factoryStatus: "approved", role: "owner",
    });
    mockGetFactoryById.mockResolvedValue(FULL_FACTORY_ROW);

    const ctx = await getAiFactoryContext(42);
    const keys = Object.keys(ctx as object);

    for (const forbidden of [
      "adminNote",
      "contactStatus",
      "certificationEvidence",
      "rejectionReason",
      "deletedAt",
      "ownerId",
      "phone",
      "contactEmail",
      "address",
      "contactPersonName",
      "ownerName",
      "certificationBadges",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("找不到 affiliation 對應的 factory row（防禦性 edge case，理論上不應發生）→ null，不丟錯", async () => {
    mockGetActiveFactoryAffiliationDetail.mockResolvedValue({
      factoryId: 404, factoryName: "已消失的工廠", factoryStatus: "approved", role: "owner",
    });
    mockGetFactoryById.mockResolvedValue(undefined);

    const resolution = await resolveApprovedAiFactoryContext(42);
    expect(resolution).toBeNull();
  });
});
