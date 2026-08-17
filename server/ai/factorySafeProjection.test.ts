/**
 * Phase 6A：AI 找工廠——Factory Safe Projection 驗證（見對話中「三、AI 找
 * 工廠不能直接把 DB row 丟給 LLM」「CASE 6」）。用一筆包含所有 internal/
 * admin-only 欄位的假 Factory row，逐一斷言 toAiFactorySearchResultItem 的
 * 輸出完全不含這些欄位（不是只檢查值是否為空，而是整個 JSON 序列化結果
 * 都不能出現這些欄位名稱或內容，避免用巧合的欄位命名逃過檢查）。
 */
import { describe, expect, it } from "vitest";
import type { Factory } from "../../drizzle/schema";
import { toAiFactorySearchResultItem } from "./factorySafeProjection";

const SENSITIVE_MARKER_PREFIX = "SENSITIVE_MARKER__";

function fakeFactory(overrides: Partial<Factory> = {}): Factory {
  return {
    id: 42,
    ownerId: 999,
    name: "測試工廠",
    industry: ["金屬加工"],
    mfgModes: ["ODM", "OEM"],
    region: "台中市",
    description: "測試描述",
    capitalLevel: "1000萬以下",
    foundedYear: 2010,
    ownerName: SENSITIVE_MARKER_PREFIX + "ownerName",
    contactPersonName: SENSITIVE_MARKER_PREFIX + "contactPersonName",
    phone: SENSITIVE_MARKER_PREFIX + "phone",
    website: SENSITIVE_MARKER_PREFIX + "website",
    contactEmail: SENSITIVE_MARKER_PREFIX + "contactEmail",
    address: SENSITIVE_MARKER_PREFIX + "address",
    avgRating: "4.50",
    reviewCount: 12,
    status: "approved",
    avatarUrl: "https://example.test/avatar.png",
    avatarCrop: null,
    coverImageUrl: SENSITIVE_MARKER_PREFIX + "coverImageUrl",
    coverCrop: null,
    businessType: "factory",
    operationStatus: "normal",
    certified: true,
    subIndustry: ["CNC加工"],
    certificationBadges: [SENSITIVE_MARKER_PREFIX + "certificationBadges"],
    certificationBadgesVisible: ["iso-9001"],
    certificationEvidence: [{ badgeId: SENSITIVE_MARKER_PREFIX + "evidence", description: SENSITIVE_MARKER_PREFIX + "desc", imageKeys: [SENSITIVE_MARKER_PREFIX + "key"] }],
    avgResponseHours: "3.50",
    weekdayHours: SENSITIVE_MARKER_PREFIX + "weekdayHours",
    weekendHours: SENSITIVE_MARKER_PREFIX + "weekendHours",
    businessNote: SENSITIVE_MARKER_PREFIX + "businessNote",
    submittedAt: new Date("2020-01-01"),
    rejectionReason: SENSITIVE_MARKER_PREFIX + "rejectionReason",
    contactStatus: "follow_up",
    adminNote: SENSITIVE_MARKER_PREFIX + "adminNote",
    deletedAt: null,
    createdAt: new Date("2019-01-01"),
    updatedAt: new Date("2021-01-01"),
    ...overrides,
  } as Factory;
}

describe("toAiFactorySearchResultItem：安全白名單投影", () => {
  it("輸出完全不含任何 internal/admin-only/PII 欄位或其標記值", () => {
    const factory = fakeFactory();
    const result = toAiFactorySearchResultItem(factory);
    const serialized = JSON.stringify(result);

    // 正面：安全欄位確實存在。
    expect(result.id).toBe(42);
    expect(result.companyName).toBe("測試工廠");
    expect(result.region).toBe("台中市");

    // 負面：整個序列化結果不得出現任何標記值（涵蓋所有 internal 欄位的內容）。
    expect(serialized).not.toContain(SENSITIVE_MARKER_PREFIX);

    // 負面：明確列出的每個 internal/admin-only key 名稱都不是輸出物件自身的 key。
    const forbiddenKeys = [
      "ownerId", "ownerName", "contactPersonName", "phone", "website", "contactEmail",
      "address", "certificationBadges", "certificationEvidence", "contactStatus",
      "adminNote", "rejectionReason", "submittedAt", "deletedAt", "avgResponseHours",
      "weekdayHours", "weekendHours", "businessNote", "avatarCrop", "coverCrop",
      "coverImageUrl", "createdAt", "updatedAt", "status",
    ];
    for (const key of forbiddenKeys) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
    }
  });

  it("certificationBadgesVisible 只帶出公開子集，不是完整 certificationBadges", () => {
    const factory = fakeFactory({
      certificationBadges: ["iso-9001", "iso-14001", "secret-internal-badge"],
      certificationBadgesVisible: ["iso-9001"],
    });
    const result = toAiFactorySearchResultItem(factory);
    expect(result.certificationBadgesVisible).toEqual(["iso-9001"]);
    expect(JSON.stringify(result)).not.toContain("secret-internal-badge");
    expect(JSON.stringify(result)).not.toContain("iso-14001");
  });

  it("null/undefined 欄位安全處理，不拋錯", () => {
    const factory = fakeFactory({
      foundedYear: null, description: null, subIndustry: null as unknown as string[],
      avatarUrl: null, avgRating: null,
    });
    const result = toAiFactorySearchResultItem(factory);
    expect(result.foundedYear).toBeNull();
    expect(result.description).toBe("");
    expect(result.subIndustry).toEqual([]);
    expect(result.avatarUrl).toBeNull();
    expect(result.avgRating).toBe(0);
  });
});
