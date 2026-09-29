/**
 * Batch 2.8：使用者可控制的名稱（會員名稱、工廠名稱、負責人、檢舉者…）插入
 * HTML Email 前必須 escape（Batch 2.7 audit 發現的既有問題）。
 *
 * "resend" 套件整個被 mock（比照 server/email.test.ts），寄信判斷暫時模擬為
 * enabled 以取得實際產生的 HTML，不會有任何真實網路呼叫。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn().mockResolvedValue({ data: { id: "mock-id" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

const XSS = "<script>alert(1)</script>";
let email: typeof import("./email");

beforeAll(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
  vi.stubEnv("FROM_EMAIL", "test@example.test");
  vi.stubEnv("VITEST", "");
  vi.stubEnv("ALLOW_DEV_EMAIL", "true");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.resetModules();
  vi.doMock("./_core/env", () => ({ ENV: { isProduction: false } }));
  email = await import("./email");
  expect(email.getEmailDisabledReason()).toBeNull();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./_core/env");
  vi.resetModules();
});
beforeEach(() => { mockSend.mockClear(); });

function lastHtml(): string {
  expect(mockSend).toHaveBeenCalledTimes(1);
  return String(mockSend.mock.calls[0][0].html);
}
function expectEscaped(html: string) {
  expect(html).not.toContain("<script");
  expect(html).not.toContain("</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
}

describe("HTML Email：使用者可控制的名稱不得成為 HTML tag", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["sendAccountLinkVerificationEmail userName", () => email.sendAccountLinkVerificationEmail({ toEmail: "a@example.test", userName: XSS, providerLabel: "LINE", verifyUrl: "https://example.test/v", expiresInMinutes: 15 })],
    ["sendAccountLinkOtpEmail userName", () => email.sendAccountLinkOtpEmail({ toEmail: "a@example.test", userName: XSS, providerLabel: "LINE", code: "012345", expiresInMinutes: 15 })],
    ["sendEmailVerificationEmail userName", () => email.sendEmailVerificationEmail({ toEmail: "a@example.test", userName: XSS, verifyUrl: "https://example.test/v" })],
    ["sendNewInquiryEmail userName", () => email.sendNewInquiryEmail({ factoryName: "工廠", factoryEmail: "f@example.test", userName: XSS, message: "hi" })],
    ["sendNewInquiryEmail factoryName", () => email.sendNewInquiryEmail({ factoryName: XSS, factoryEmail: "f@example.test", userName: "買家", message: "hi" })],
    ["sendNewInquiryEmail productName", () => email.sendNewInquiryEmail({ factoryName: "工廠", factoryEmail: "f@example.test", userName: "買家", productName: XSS, message: "hi" })],
    ["sendFactorySubmittedEmail ownerName", () => email.sendFactorySubmittedEmail({ factoryName: "工廠", factoryId: 1, ownerName: XSS })],
    ["sendReportEmail reporterName", () => email.sendReportEmail({ reporterName: XSS, factoryName: "工廠", factoryId: 1, reason: "r" })],
    ["sendSupportTicketEmail userName", () => email.sendSupportTicketEmail({ userName: XSS, type: "t", subject: "s", description: "d" })],
    ["sendReviewReplyEmail userName", () => email.sendReviewReplyEmail({ userEmail: "u@example.test", userName: XSS, factoryName: "工廠", originalComment: "c", replyContent: "r", factoryId: 1 })],
    ["sendNewMessageNotificationEmail factoryName", () => email.sendNewMessageNotificationEmail({ userEmail: "u@example.test", userName: "買家", factoryName: XSS, messagePreview: "m", conversationId: 1 })],
    ["sendReportStatusUpdateEmail userName", () => email.sendReportStatusUpdateEmail({ userEmail: "u@example.test", userName: XSS, factoryName: "工廠", status: "received" })],
    ["sendTicketStatusUpdateEmail userName", () => email.sendTicketStatusUpdateEmail({ userEmail: "u@example.test", userName: XSS, subject: "s", status: "received" })],
    ["sendMessageReplyNotificationEmail userName", () => email.sendMessageReplyNotificationEmail({ userName: XSS, campaignTitle: "t", replyContent: "r", campaignId: 1 })],
    ["sendAdminBroadcastEmail toName", () => email.sendAdminBroadcastEmail({ toEmail: "u@example.test", toName: XSS, campaignTitle: "t", campaignContent: "c", campaignId: 1 })],
    ["sendFactoryApprovedEmail factoryName", () => email.sendFactoryApprovedEmail({ factoryName: XSS, factoryEmail: "f@example.test" })],
  ];

  for (const [label, send] of cases) {
    it(label, async () => {
      await send();
      expectEscaped(lastHtml());
    });
  }

  it("OTP 信：驗證碼、15 分鐘、單次使用、不要提供給他人", async () => {
    await email.sendAccountLinkOtpEmail({ toEmail: "a@example.test", userName: "王小明", providerLabel: "LINE", code: "012345", expiresInMinutes: 15 });
    const html = lastHtml();
    expect(html).toContain("012345");
    expect(html).toContain("15 分鐘");
    expect(html).toContain("僅能使用一次");
    expect(html).toContain("OXM 不會要求您把驗證碼提供給其他人");
  });

  it("Web 帳號連結信：文案為 15 分鐘", async () => {
    await email.sendAccountLinkVerificationEmail({ toEmail: "a@example.test", userName: "王小明", providerLabel: "LINE", verifyUrl: "https://example.test/v", expiresInMinutes: 15 });
    expect(lastHtml()).toContain("此連結將於 15 分鐘後失效");
  });
});
