/**
 * getAiFactoryContext() 白名單驗證：
 * 1. owner 身分可以正確解析出企業 context
 * 2. 沒有擁有工廠、但是 active 共同管理者時也能正確解析（Phase 0 發現的既有
 *    坑：只查 owner 會讓共管者遇到「找不到工廠」，這裡驗證我們沒有重蹈覆轍）
 * 3. 兩者都沒有時回傳 null，而不是丟錯
 * 4. 回傳物件絕對不包含 adminNote / contactStatus / certificationEvidence /
 *    rejectionReason / deletedAt / ownerId / 聯絡方式等內部或個資欄位
 *
 * 全部用 vi.mock 隔離 db.ts，不連真實資料庫、不做任何 DB 讀寫。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetFactoryByOwnerId = vi.fn();
const mockGetCoManagedFactories = vi.fn();
const mockGetFactoryById = vi.fn();

vi.mock("../db", () => ({
  getFactoryByOwnerId: (...args: unknown[]) => mockGetFactoryByOwnerId(...args),
  getCoManagedFactories: (...args: unknown[]) => mockGetCoManagedFactories(...args),
  getFactoryById: (...args: unknown[]) => mockGetFactoryById(...args),
}));

import { getAiFactoryContext } from "./factoryContext";

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

describe("getAiFactoryContext", () => {
  beforeEach(() => {
    mockGetFactoryByOwnerId.mockReset();
    mockGetCoManagedFactories.mockReset();
    mockGetFactoryById.mockReset();
  });

  it("owner 身分：回傳正確的白名單欄位", async () => {
    mockGetFactoryByOwnerId.mockResolvedValue(FULL_FACTORY_ROW);

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
    expect(mockGetCoManagedFactories).not.toHaveBeenCalled();
  });

  it("非 owner，但是 active 共同管理者：仍能正確解析出企業 context", async () => {
    mockGetFactoryByOwnerId.mockResolvedValue(undefined);
    mockGetCoManagedFactories.mockResolvedValue([
      { factoryId: 1, name: "測試金屬加工廠", status: "approved" },
    ]);
    mockGetFactoryById.mockResolvedValue(FULL_FACTORY_ROW);

    const ctx = await getAiFactoryContext(99);

    expect(ctx?.companyName).toBe("測試金屬加工廠");
    expect(mockGetFactoryById).toHaveBeenCalledWith(1);
  });

  it("既不是 owner 也沒有共管工廠：回傳 null，不丟錯", async () => {
    mockGetFactoryByOwnerId.mockResolvedValue(undefined);
    mockGetCoManagedFactories.mockResolvedValue([]);

    const ctx = await getAiFactoryContext(7);

    expect(ctx).toBeNull();
  });

  it("回傳物件絕對不包含內部/個資欄位", async () => {
    mockGetFactoryByOwnerId.mockResolvedValue(FULL_FACTORY_ROW);

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
});
