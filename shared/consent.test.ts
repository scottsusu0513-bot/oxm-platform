/**
 * Consent Gate rollout／版本比對邏輯的純函式測試（見 shared/consent.ts）。
 *
 * Hotfix（見對話「OXM Consent Gate — Hotfix：修正 rollout 時間判斷」）：
 * launchAt 不再是 shared/consent.ts 裡的寫死常數，改成呼叫端傳入的參數
 * （server/routers.ts 傳入 ENV.consentGateLaunchAt，即環境變數
 * CONSENT_GATE_LAUNCH_AT 解析後的結果）。這裡直接針對函式參數化之後的行為
 * 測試，不再依賴任何寫死的日期常數。
 *
 * 涵蓋範圍：
 *   (1) 未登入 → 不需要 Gate
 *   (2) 舊會員（createdAt 早於 launchAt）→ 不需要 Gate，即使四個新欄位皆為
 *       NULL（這正是「不得用 termsAcceptedAt IS NULL 判斷所有 user」這個
 *       修正要求的核心）
 *   (3) 上線後新會員、尚未同意 → 需要 Gate
 *   (4) 完成同意（版本吻合）→ 不再需要 Gate
 *   Hotfix 明確要求的 boundary case 1/2/3（launchAt = 2026-08-21T08:00:00Z）
 *   launchAt 未設定（null／undefined）→ 安全 fallback，任何人都不需要 Gate
 * 另外補測第十六節要求的版本能力：條款或政策其中一份版本比對不吻合時，仍然
 * 視為需要 Gate（未來要強制重新同意時，只需要調整 CURRENT_TERMS_VERSION／
 * CURRENT_PRIVACY_VERSION 常數即可，不需要改這支函式）。
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  userNeedsConsent,
  type ConsentCheckableUser,
} from "./consent";

const LAUNCH_AT = new Date("2026-08-21T08:00:00Z");
const BEFORE_LAUNCH = new Date(LAUNCH_AT.getTime() - 24 * 60 * 60 * 1000);
const AFTER_LAUNCH = new Date(LAUNCH_AT.getTime() + 24 * 60 * 60 * 1000);

function baseUser(overrides: Partial<ConsentCheckableUser>): ConsentCheckableUser {
  return {
    createdAt: AFTER_LAUNCH,
    termsAcceptedAt: null,
    termsVersion: null,
    privacyAcceptedAt: null,
    privacyVersion: null,
    ...overrides,
  };
}

describe("userNeedsConsent", () => {
  it("(1) 未登入（null／undefined）→ 不需要 Gate", () => {
    expect(userNeedsConsent(null, LAUNCH_AT)).toBe(false);
    expect(userNeedsConsent(undefined, LAUNCH_AT)).toBe(false);
  });

  it("(2) 舊會員：createdAt 早於 launchAt，四個新欄位皆為 NULL → 不需要 Gate", () => {
    const oldMember = baseUser({ createdAt: BEFORE_LAUNCH });
    expect(userNeedsConsent(oldMember, LAUNCH_AT)).toBe(false);
  });

  it("(3) 上線後新會員、尚未同意 → 需要 Gate", () => {
    const newMember = baseUser({ createdAt: AFTER_LAUNCH });
    expect(userNeedsConsent(newMember, LAUNCH_AT)).toBe(true);
  });

  it("(4) 上線後新會員、已完成同意且版本吻合 → 不再需要 Gate", () => {
    const consented = baseUser({
      createdAt: AFTER_LAUNCH,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
      privacyAcceptedAt: new Date(),
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
    expect(userNeedsConsent(consented, LAUNCH_AT)).toBe(false);
  });

  it("只同意了服務條款、隱私權政策尚未同意 → 仍需要 Gate", () => {
    const partial = baseUser({
      createdAt: AFTER_LAUNCH,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    });
    expect(userNeedsConsent(partial, LAUNCH_AT)).toBe(true);
  });

  it("只同意了隱私權政策、服務條款尚未同意 → 仍需要 Gate", () => {
    const partial = baseUser({
      createdAt: AFTER_LAUNCH,
      privacyAcceptedAt: new Date(),
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
    expect(userNeedsConsent(partial, LAUNCH_AT)).toBe(true);
  });

  it("版本能力：已同意但 termsVersion 是舊版字串（非目前版本）→ 視為需要重新 Gate", () => {
    const staleTerms = baseUser({
      createdAt: AFTER_LAUNCH,
      termsAcceptedAt: new Date(),
      termsVersion: "2020-01-01",
      privacyAcceptedAt: new Date(),
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
    expect(userNeedsConsent(staleTerms, LAUNCH_AT)).toBe(true);
  });

  it("版本能力：已同意但 privacyVersion 是舊版字串（非目前版本）→ 視為需要重新 Gate", () => {
    const stalePrivacy = baseUser({
      createdAt: AFTER_LAUNCH,
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
      privacyAcceptedAt: new Date(),
      privacyVersion: "2020-01-01",
    });
    expect(userNeedsConsent(stalePrivacy, LAUNCH_AT)).toBe(true);
  });

  describe("Hotfix boundary cases（launchAt = 2026-08-21T08:00:00Z）", () => {
    it("Case 1: createdAt = 2026-08-21T07:59:59Z（早於 launchAt 1 秒）→ 不需要 Gate", () => {
      const user = baseUser({ createdAt: new Date("2026-08-21T07:59:59Z") });
      expect(userNeedsConsent(user, LAUNCH_AT)).toBe(false);
    });

    it("Case 2: createdAt = 2026-08-21T08:00:00Z（恰好等於 launchAt）→ 需要 Gate（createdAt >= launchAt 視為新會員）", () => {
      const user = baseUser({ createdAt: new Date("2026-08-21T08:00:00Z") });
      expect(userNeedsConsent(user, LAUNCH_AT)).toBe(true);
    });

    it("Case 3: createdAt = 2026-08-21T08:00:01Z（晚於 launchAt 1 秒）→ 需要 Gate", () => {
      const user = baseUser({ createdAt: new Date("2026-08-21T08:00:01Z") });
      expect(userNeedsConsent(user, LAUNCH_AT)).toBe(true);
    });
  });

  describe("launchAt 未設定時的安全 fallback（尚未部署／忘記設定環境變數）", () => {
    it("launchAt 為 undefined：任何人（包含剛建立、createdAt = 現在）都不需要 Gate", () => {
      const brandNewUser = baseUser({ createdAt: new Date() });
      expect(userNeedsConsent(brandNewUser, undefined)).toBe(false);
    });

    it("launchAt 為 null：同上，安全 fallback 生效", () => {
      const brandNewUser = baseUser({ createdAt: new Date() });
      expect(userNeedsConsent(brandNewUser, null)).toBe(false);
    });

    it("fallback 常數本身是遙遠未來的時間點（西元 9999 年），不是模糊的「今天」", () => {
      expect(CONSENT_GATE_LAUNCH_AT_DISABLED_FALLBACK.getUTCFullYear()).toBe(9999);
    });
  });
});
