/**
 * Phase 10.2 P1（見「九～十二」）：provider.ts 集中式逾時機制驗證。
 *
 * 用假的 openai 模組取代真實 SDK：
 * - 驗證每次 create() 呼叫都真的帶上 { timeout: 60000 }（不是只停止等待，
 *   而是真的把 timeout 傳給 SDK 讓底層 fetch 被 AbortController 中止）。
 * - 驗證 SDK 逾時丟出的 APIConnectionTimeoutError 會被決定性地分類成
 *   errorCategory="timeout"（不是靠字串比對訊息猜的），且會如實往外拋出
 *   （不會被吞掉變成假的成功回覆）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, FakeAPIConnectionTimeoutError } = vi.hoisted(() => {
  class FakeAPIConnectionTimeoutError extends Error {
    constructor() {
      super("Request timed out.");
      this.name = "APIConnectionTimeoutError";
    }
  }
  return { mockCreate: vi.fn(), FakeAPIConnectionTimeoutError };
});

vi.mock("openai", () => {
  class FakeOpenAI {
    static APIConnectionTimeoutError = FakeAPIConnectionTimeoutError;
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {
      void _opts;
    }
  }
  return { default: FakeOpenAI };
});

const mockLogAiModelCall = vi.fn();
vi.mock("./aiUsageLogging", () => ({
  logAiModelCall: (...args: unknown[]) => mockLogAiModelCall(...args),
}));

import { getAiChatProvider } from "./provider";

beforeEach(() => {
  mockCreate.mockReset();
  mockLogAiModelCall.mockReset();
});

describe("provider.ts：集中式 provider 逾時（Phase 10.2 P1）", () => {
  it("R5：complete() 逾時 → 丟出的錯誤被記錄成 errorCategory='timeout'（不是 unknown_error／provider_error）", async () => {
    mockCreate.mockRejectedValueOnce(new FakeAPIConnectionTimeoutError());
    const provider = getAiChatProvider("diagnosis");

    await expect(provider.complete([{ role: "user", content: "hi" }])).rejects.toThrow("Request timed out.");

    expect(mockLogAiModelCall).toHaveBeenCalledTimes(1);
    const loggedCall = mockLogAiModelCall.mock.calls[0][0];
    expect(loggedCall.success).toBe(false);
    expect(loggedCall.errorCategory).toBe("timeout");
  });

  it("R5b：completeJson() 逾時同樣分類成 errorCategory='timeout'", async () => {
    mockCreate.mockRejectedValueOnce(new FakeAPIConnectionTimeoutError());
    const provider = getAiChatProvider("routing");

    await expect(provider.completeJson([{ role: "user", content: "hi" }])).rejects.toThrow("Request timed out.");

    const loggedCall = mockLogAiModelCall.mock.calls[0][0];
    expect(loggedCall.errorCategory).toBe("timeout");
  });

  it("R6：provider 逾時不會被吞掉、不會產生假成功回覆——呼叫端一定看得到例外", async () => {
    mockCreate.mockRejectedValueOnce(new FakeAPIConnectionTimeoutError());
    const provider = getAiChatProvider("diagnosis");

    let threw = false;
    try {
      await provider.complete([{ role: "user", content: "hi" }]);
    } catch {
      threw = true;
    }
    expect(threw, "逾時必須讓呼叫端看到例外，不能悄悄回傳字串").toBe(true);
  });

  it("每次 create() 呼叫都帶上集中式逾時設定（60 秒），且真的是 SDK 的 timeout option（可觸發真正 abort，不是只有 caller 端 Promise.race）", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: undefined,
    });
    const provider = getAiChatProvider("diagnosis");
    await provider.complete([{ role: "user", content: "hi" }]);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, options] = mockCreate.mock.calls[0];
    expect(options).toEqual({ timeout: 60_000 });
  });

  it("成功回應不受逾時機制影響，正常回傳文字並記錄 success=true", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "  正常回覆  " } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const provider = getAiChatProvider("diagnosis");
    const text = await provider.complete([{ role: "user", content: "hi" }]);
    expect(text).toBe("正常回覆");
    expect(mockLogAiModelCall.mock.calls[0][0].success).toBe(true);
  });
});
