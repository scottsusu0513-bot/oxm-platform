/**
 * Batch 3.9：外部服務（Resend、FCM、通知服務）失敗或卡住時的行為。
 * 全部是 mock，沒有任何真實網路呼叫。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();
vi.mock("resend", () => ({
  // 用一般 class（不是 vi.fn），afterEach 的 restoreAllMocks 才不會清掉實作
  Resend: class { emails = { send: mockSend }; },
}));

const mockMulticast = vi.fn();
vi.mock("firebase-admin/app", () => ({ initializeApp: vi.fn(), getApps: () => [], cert: vi.fn(() => ({})) }));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ sendEachForMulticast: mockMulticast }) }));

vi.mock("./db", () => ({
  getEnabledPushTokensByUserId: vi.fn(async () => [{ token: "tok-1", platform: "android" }]),
  disablePushNotificationToken: vi.fn(async () => {}),
}));

let email: typeof import("./email");
let push: typeof import("./push");
let notification: typeof import("./_core/notification");

beforeAll(async () => {
  vi.stubEnv("RESEND_API_KEY", "re_fake_looking_key_1234567890");
  vi.stubEnv("FROM_EMAIL", "test@example.test");
  vi.stubEnv("VITEST", "");
  vi.stubEnv("ALLOW_DEV_EMAIL", "true");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}");
  vi.resetModules();
  vi.doMock("./_core/env", () => ({
    ENV: { isProduction: false, forgeApiUrl: "https://notify.example.test", forgeApiKey: "fake-key" },
  }));
  email = await import("./email");
  push = await import("./push");
  notification = await import("./_core/notification");
  expect(email.getEmailDisabledReason()).toBeNull();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./_core/env");
  vi.resetModules();
});

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mockSend.mockReset();
  mockMulticast.mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const inquiry = (message = "hi") =>
  email.sendNewInquiryEmail({ factoryName: "工廠", factoryEmail: "owner@example.test", userName: "買家", message });
const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(c => c.map(String).join(" ")).join("\n");

describe("Email（Resend）", () => {
  it("Resend 回傳 { error } 時記錄為失敗，不再寫「已寄送」", async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad to", statusCode: 422 } });
    await inquiry();
    expect(logged(logSpy)).not.toContain("已寄送");
    expect(logged(errSpy)).toContain("寄信失敗");
  });

  it("成功時 log 只留遮罩後的 email", async () => {
    mockSend.mockResolvedValue({ data: { id: "m1" }, error: null });
    await inquiry();
    const out = logged(logSpy);
    expect(out).toContain("o***@example.test");
    expect(out).not.toContain("owner@example.test");
  });

  it("provider 卡住時最多等 EMAIL_SEND_TIMEOUT_MS，之後記錄失敗、呼叫端不會永遠等待", async () => {
    vi.useFakeTimers();
    mockSend.mockReturnValue(new Promise(() => {}));
    const p = inquiry();
    await vi.advanceTimersByTimeAsync(email.EMAIL_SEND_TIMEOUT_MS);
    await p;
    expect(mockSend).toHaveBeenCalledTimes(1); // 逾時不重試（避免重複寄信）
    expect(logged(errSpy)).toContain("寄信失敗");
  });

  it("訊息本文插入 HTML 前 escape", async () => {
    mockSend.mockResolvedValue({ data: { id: "m1" }, error: null });
    await inquiry(`<img src=x onerror="alert(1)">`);
    const html = String(mockSend.mock.calls[0][0].html);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("Push（FCM）", () => {
  it("FCM 卡住時在 PUSH_SEND_TIMEOUT_MS 後回傳 error 狀態，不讓呼叫端無限等待", async () => {
    vi.useFakeTimers();
    mockMulticast.mockReturnValue(new Promise(() => {}));
    const p = push.sendPushToUser(1, { title: "t", body: "b" });
    await vi.advanceTimersByTimeAsync(push.PUSH_SEND_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ status: "error", message: expect.stringContaining("OperationTimeoutError") });
  });

  it("FCM 丟錯時回傳 error 狀態而非 reject", async () => {
    mockMulticast.mockRejectedValue(new Error("fcm 503"));
    await expect(push.sendPushToUser(1, { title: "t", body: "b" })).resolves.toMatchObject({ status: "error" });
  });

  it("正常回應維持 sent 結果", async () => {
    mockMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });
    await expect(push.sendPushToUser(1, { title: "t", body: "b" })).resolves.toMatchObject({ status: "sent", successCount: 1 });
  });
});

describe("notifyOwner", () => {
  it("fetch 帶 AbortSignal；逾時／網路錯誤回傳 false 而不是讓呼叫端卡住或崩潰", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(notification.notifyOwner({ title: "t", content: "c" })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
