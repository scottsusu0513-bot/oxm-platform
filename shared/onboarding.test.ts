/**
 * 新會員 Spotlight 新手導引 rollout 邏輯的純函式測試（見
 * shared/onboarding.ts）。架構完全比照 shared/consent.test.ts 已驗證過的
 * 測試模式。
 *
 * 涵蓋（對應對話「二十六」的 Case A/B/E）：
 *   Case A：launch 前既有會員，onboardingCompletedAt = NULL → needsOnboarding=false
 *   Case B：launch 後新會員，onboardingCompletedAt = NULL → needsOnboarding=true
 *   Case C：新會員已完成（onboardingCompletedAt 有值）→ needsOnboarding=false
 *   Case E：launchAt 未設定（null/undefined）→ 安全 fallback，所有人 false
 * 另外補測 boundary（createdAt 恰等於 launchAt 視為新會員）與未登入情況。
 */
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_LAUNCH_AT_DISABLED_FALLBACK,
  userNeedsOnboarding,
  type OnboardingCheckableUser,
} from "./onboarding";

const LAUNCH_AT = new Date("2026-08-21T08:00:00Z");
const BEFORE_LAUNCH = new Date(LAUNCH_AT.getTime() - 24 * 60 * 60 * 1000);
const AFTER_LAUNCH = new Date(LAUNCH_AT.getTime() + 24 * 60 * 60 * 1000);

function baseUser(overrides: Partial<OnboardingCheckableUser>): OnboardingCheckableUser {
  return {
    createdAt: AFTER_LAUNCH,
    onboardingCompletedAt: null,
    ...overrides,
  };
}

describe("userNeedsOnboarding", () => {
  it("未登入（null／undefined）→ 不需要導覽", () => {
    expect(userNeedsOnboarding(null, LAUNCH_AT)).toBe(false);
    expect(userNeedsOnboarding(undefined, LAUNCH_AT)).toBe(false);
  });

  it("Case A：launch 前既有會員，onboardingCompletedAt 為 NULL → 不需要導覽", () => {
    const oldMember = baseUser({ createdAt: BEFORE_LAUNCH, onboardingCompletedAt: null });
    expect(userNeedsOnboarding(oldMember, LAUNCH_AT)).toBe(false);
  });

  it("Case B：launch 後新會員，尚未完成／略過 → 需要導覽", () => {
    const newMember = baseUser({ createdAt: AFTER_LAUNCH, onboardingCompletedAt: null });
    expect(userNeedsOnboarding(newMember, LAUNCH_AT)).toBe(true);
  });

  it("Case C：新會員已完成（或略過，共用同一欄位）→ 不再需要導覽", () => {
    const done = baseUser({ createdAt: AFTER_LAUNCH, onboardingCompletedAt: new Date() });
    expect(userNeedsOnboarding(done, LAUNCH_AT)).toBe(false);
  });

  it("boundary：createdAt 恰好等於 launchAt → 視為新會員，需要導覽", () => {
    const atLaunch = baseUser({ createdAt: new Date(LAUNCH_AT), onboardingCompletedAt: null });
    expect(userNeedsOnboarding(atLaunch, LAUNCH_AT)).toBe(true);
  });

  describe("Case E：launchAt 未設定時的安全 fallback", () => {
    it("launchAt 為 undefined：任何人（包含剛建立、createdAt = 現在）都不需要導覽", () => {
      const brandNewUser = baseUser({ createdAt: new Date(), onboardingCompletedAt: null });
      expect(userNeedsOnboarding(brandNewUser, undefined)).toBe(false);
    });

    it("launchAt 為 null：同上，安全 fallback 生效", () => {
      const brandNewUser = baseUser({ createdAt: new Date(), onboardingCompletedAt: null });
      expect(userNeedsOnboarding(brandNewUser, null)).toBe(false);
    });

    it("fallback 常數本身是遙遠未來的時間點（西元 9999 年），不是模糊的「今天」", () => {
      expect(ONBOARDING_LAUNCH_AT_DISABLED_FALLBACK.getUTCFullYear()).toBe(9999);
    });
  });
});
