/**
 * 見對話中「Email Safety Regression」：server/email.ts 的三層寄信安全規則
 * （test/production/development）本身沒有專屬單元測試，這是這次事故（本機
 * 操作意外讓 email.ts 的未提交修正暫時從工作目錄消失，期間跑到會觸發真實
 * 寄信路徑的測試）沒有在單元測試層被攔下來的一個真實缺口——這裡補上。
 *
 * getEmailDisabledReason() 是純函式，直接單元測試它的三個條件即可涵蓋所有
 * sendXxxEmail 呼叫端共用的同一套判斷（isEmailEnabled 只是包一層布林），
 * 不需要真的呼叫任何 sendXxxEmail 或連到 Resend。CASE E4/E5 額外呼叫一次真正
 * 的 sendXxxEmail，驗證即使 email 判斷為 enabled，這裡的 resend 套件也是
 * mock 過的，不會真的打外部 API。
 *
 * RESEND_API_KEY／FROM_EMAIL／ADMIN_EMAIL／ENV.isProduction 都是模組載入時
 * 讀一次的常數，所以每個案例都要 vi.resetModules() 後動態 re-import，確保
 * 讀到的是這次 stub 過的環境變數，不是被前一個案例快取住的舊值。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue({ data: { id: "mock-id" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

beforeEach(() => {
  mockSend.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./_core/env");
  vi.resetModules();
});

async function importEmailModule(isProduction: boolean) {
  vi.resetModules();
  vi.doMock("./_core/env", () => ({ ENV: { isProduction } }));
  return import("./email");
}

describe("server/email.ts — 三層寄信安全規則（見「Email Safety Regression」）", () => {
  it("CASE E1：VITEST + 看起來像真的 RESEND_API_KEY → 不建立真實 external send，suppression reason 正確", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
    vi.stubEnv("VITEST", "true");
    const { getEmailDisabledReason } = await importEmailModule(false);
    expect(getEmailDisabledReason()).toBe("自動化測試（Vitest）環境已停用外部寄信");
  });

  it("CASE E2：development + RESEND_API_KEY + ALLOW_DEV_EMAIL undefined（VITEST 暫時模擬未設定，才能測到第二層）→ 不寄", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
    vi.stubEnv("VITEST", ""); // 模擬「不是 Vitest 判斷」的情境，才能單獨測到 dev/prod 這一層
    vi.stubEnv("ALLOW_DEV_EMAIL", undefined as unknown as string);
    const { getEmailDisabledReason } = await importEmailModule(false);
    expect(getEmailDisabledReason()).toBe(
      "開發環境預設停用外部寄信（如需在本機測試真實寄信，請在 .env 設定 ALLOW_DEV_EMAIL=true）"
    );
  });

  it("CASE E3：development + RESEND_API_KEY + ALLOW_DEV_EMAIL=false → 不寄", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("ALLOW_DEV_EMAIL", "false");
    const { getEmailDisabledReason } = await importEmailModule(false);
    expect(getEmailDisabledReason()).toBe(
      "開發環境預設停用外部寄信（如需在本機測試真實寄信，請在 .env 設定 ALLOW_DEV_EMAIL=true）"
    );
  });

  it("CASE E4：development + RESEND_API_KEY + ALLOW_DEV_EMAIL=true → email path 判斷為 enabled，但實際呼叫走的是 mock transport，不是真的 Resend API", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
    vi.stubEnv("FROM_EMAIL", "test@example.test");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("ALLOW_DEV_EMAIL", "true");
    const emailModule = await importEmailModule(false);
    expect(emailModule.getEmailDisabledReason()).toBeNull();

    await emailModule.sendNewInquiryEmail({
      factoryName: "測試工廠",
      factoryEmail: "factory@example.test",
      userName: "測試買家",
      message: "測試訊息",
    });
    // enabled 時真的會呼叫 send，但這裡的 "resend" 套件整個被 vi.mock 掉
    // （見檔頭 vi.mock("resend", ...)），mockSend 是唯一會被打到的實作，
    // 不存在任何真實網路呼叫。
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("CASE E5：production + RESEND_API_KEY → enabled 判斷正確，但單元測試本身仍不會真的寄外部 Email（同樣走 mock transport）", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
    vi.stubEnv("FROM_EMAIL", "test@example.test");
    vi.stubEnv("VITEST", "");
    const emailModule = await importEmailModule(true);
    expect(emailModule.getEmailDisabledReason()).toBeNull();

    await emailModule.sendNewInquiryEmail({
      factoryName: "測試工廠",
      factoryEmail: "factory@example.test",
      userName: "測試買家",
      message: "測試訊息",
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("沒有 RESEND_API_KEY → 不管其他條件為何，一律停用", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("ALLOW_DEV_EMAIL", "true");
    const { getEmailDisabledReason } = await importEmailModule(true);
    expect(getEmailDisabledReason()).toBe("未設定 RESEND_API_KEY");
  });
});
