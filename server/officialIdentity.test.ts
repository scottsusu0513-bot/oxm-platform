/**
 * 官方 OXM 負責人身份 resolver（server/_core/officialIdentity.ts）的單元測試。
 *
 * 規則：
 *  - 只有 openId === process.env.OWNER_OPEN_ID 的帳號 → 官方負責人，
 *    displayName 固定為「OXM負責人｜小鈞」、isOfficialOxmAccount = true。
 *  - 其他任何帳號（包含一般管理員、一般會員、未登入）→
 *    displayName「平台管理員」、isOfficialOxmAccount = false。
 *  - OWNER_OPEN_ID 未設定時，沒有人會被判為官方。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOfficialOxmAccount, resolveAdminSenderIdentity } from "./_core/officialIdentity";
import { OFFICIAL_OXM_DISPLAY_NAME, PLATFORM_ADMIN_DISPLAY_NAME } from "../shared/officialIdentity";

const OWNER = "test-owner-open-id-xyz";
let savedOwner: string | undefined;

beforeEach(() => {
  savedOwner = process.env.OWNER_OPEN_ID;
  process.env.OWNER_OPEN_ID = OWNER;
});
afterEach(() => {
  if (savedOwner === undefined) delete process.env.OWNER_OPEN_ID;
  else process.env.OWNER_OPEN_ID = savedOwner;
});

describe("isOfficialOxmAccount", () => {
  it("openId 等於 OWNER_OPEN_ID → true", () => {
    expect(isOfficialOxmAccount({ openId: OWNER })).toBe(true);
  });

  it("其他 openId（一般 admin / 一般會員）→ false", () => {
    expect(isOfficialOxmAccount({ openId: "some-other-admin" })).toBe(false);
    expect(isOfficialOxmAccount({ openId: "regular-member-123" })).toBe(false);
  });

  it("null / undefined / 無 openId → false", () => {
    expect(isOfficialOxmAccount(null)).toBe(false);
    expect(isOfficialOxmAccount(undefined)).toBe(false);
    expect(isOfficialOxmAccount({ openId: null })).toBe(false);
    expect(isOfficialOxmAccount({})).toBe(false);
  });

  it("OWNER_OPEN_ID 未設定 → 沒有人是官方（即使 openId 為空字串也不匹配）", () => {
    delete process.env.OWNER_OPEN_ID;
    expect(isOfficialOxmAccount({ openId: OWNER })).toBe(false);
    expect(isOfficialOxmAccount({ openId: "" })).toBe(false);
  });
});

describe("resolveAdminSenderIdentity", () => {
  it("官方負責人 → OXM負責人｜小鈞 + isOfficialOxmAccount:true", () => {
    expect(resolveAdminSenderIdentity({ openId: OWNER })).toEqual({
      displayName: OFFICIAL_OXM_DISPLAY_NAME,
      isOfficialOxmAccount: true,
    });
    expect(OFFICIAL_OXM_DISPLAY_NAME).toBe("OXM負責人｜小鈞");
  });

  it("一般管理員 sender → 平台管理員 + isOfficialOxmAccount:false（不會變成小鈞）", () => {
    expect(resolveAdminSenderIdentity({ openId: "another-whitelisted-admin" })).toEqual({
      displayName: PLATFORM_ADMIN_DISPLAY_NAME,
      isOfficialOxmAccount: false,
    });
    expect(PLATFORM_ADMIN_DISPLAY_NAME).toBe("平台管理員");
  });

  it("null sender → 平台管理員 + false", () => {
    expect(resolveAdminSenderIdentity(null)).toEqual({
      displayName: PLATFORM_ADMIN_DISPLAY_NAME,
      isOfficialOxmAccount: false,
    });
  });
});
