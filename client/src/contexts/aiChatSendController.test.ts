import { describe, expect, it, vi } from "vitest";
import { AiChatSendController } from "./aiChatSendController";
import type { AiShellMessage } from "./AiShellContext";

/**
 * Phase 7.2（見對話中「B：Retry 真實端到端驗證」「C：Provider concurrency
 * 真實驗證」）：這裡不是重測 Phase 7.1 的純函式，而是真的用可控制
 * resolve／reject 時機的假 send()，driving 真正的 async 流程，驗證
 * Retry（R1-R6）與 Concurrency（C1-C5）這兩組行為在「真的有一個 request
 * 在飛」的情境下是否正確——這是 AiShellContext.tsx 實際使用的同一個 class
 * （見 aiChatSendController.ts 頂部說明），不是另外重寫一份簡化邏輯。
 */

interface FakeResult {
  reply: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(sendSpy: (content: string, priorMessages: AiShellMessage[]) => Promise<FakeResult>) {
  const onBeforeSendCalls: { content: string; isRetry: boolean }[] = [];
  const onSuccessCalls: FakeResult[] = [];
  const onErrorCalls: string[] = [];
  const messages: AiShellMessage[] = [];

  const controller = new AiChatSendController<FakeResult>({
    send: sendSpy,
    onBeforeSend: (content, _priorMessages, isRetry) => {
      onBeforeSendCalls.push({ content, isRetry });
      if (!isRetry) messages.push({ id: `msg-${messages.length}`, role: "user", content });
    },
    onSuccess: (result) => {
      onSuccessCalls.push(result);
    },
    onError: (safeMessage) => {
      onErrorCalls.push(safeMessage);
    },
    resolveErrorMessage: () => "安全的錯誤訊息",
  });

  return { controller, onBeforeSendCalls, onSuccessCalls, onErrorCalls, messages };
}

describe("AiChatSendController — Concurrency (Phase 7.2 C1-C5)", () => {
  it("C1: 同 tick 呼叫兩次 send()，只有第一個真正呼叫 transport", async () => {
    const gate = deferred<FakeResult>();
    const sendSpy = vi.fn().mockReturnValue(gate.promise);
    const harness = createHarness(sendSpy);

    const p1 = harness.controller.send("A", []);
    const p2 = harness.controller.send("B", []);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith("A", []);

    gate.resolve({ reply: "ok" });
    await Promise.all([p1, p2]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(harness.onSuccessCalls).toHaveLength(1);
  });

  it("C2: 第一個成功完成後，下一次 send() 可以正常送出（guard 正確釋放）", async () => {
    const sendSpy = vi.fn().mockResolvedValueOnce({ reply: "first" }).mockResolvedValueOnce({ reply: "second" });
    const harness = createHarness(sendSpy);

    await harness.controller.send("A", []);
    await harness.controller.send("B", []);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(harness.onSuccessCalls.map(r => r.reply)).toEqual(["first", "second"]);
  });

  it("C3: 第一個失敗後，pending guard 會釋放，下一次 send() 可以正常送出", async () => {
    const sendSpy = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ reply: "recovered" });
    const harness = createHarness(sendSpy);

    await harness.controller.send("A", []);
    expect(harness.onErrorCalls).toHaveLength(1);
    expect(harness.controller.isPending).toBe(false);

    await harness.controller.send("B", []);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(harness.onSuccessCalls).toHaveLength(1);
  });

  it("C4: retry() 遵守同一個 guard——pending 中再次呼叫 retry()／send() 不會產生第二個 request", async () => {
    const gate = deferred<FakeResult>();
    const sendSpy = vi.fn().mockReturnValueOnce(gate.promise);
    const harness = createHarness(sendSpy);

    const p1 = harness.controller.send("A", []);
    // 這時候還沒失敗過（canRetry=false），retry() 理應直接 no-op；
    // 額外驗證 pending 中呼叫 retry() 不會讓 transport 被呼叫第二次。
    await harness.controller.retry();
    expect(sendSpy).toHaveBeenCalledTimes(1);

    gate.resolve({ reply: "ok" });
    await p1;
  });

  it("C5: guard 不會因為任何路徑（成功／失敗）卡死——每次呼叫後 isPending 都正確回到 false", async () => {
    const sendSpy = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const harness = createHarness(sendSpy);

    expect(harness.controller.isPending).toBe(false);
    await harness.controller.send("A", []);
    expect(harness.controller.isPending).toBe(false);
  });
});

describe("AiChatSendController — Retry (Phase 7.2 B / R1-R6)", () => {
  it("R1: 第一次失敗 → onError 被呼叫，canRetry 變 true", async () => {
    const sendSpy = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const harness = createHarness(sendSpy);

    await harness.controller.send("我們公司訂單變少了", []);

    expect(harness.onErrorCalls).toEqual(["安全的錯誤訊息"]);
    expect(harness.controller.canRetry).toBe(true);
  });

  it("R2 + R3: retry 成功 → onSuccess 被呼叫、canRetry 清空，且 onBeforeSend 在 retry 時 isRetry=true（呼叫端不會因此新增使用者 bubble）", async () => {
    const sendSpy = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ reply: "成功了" });
    const harness = createHarness(sendSpy);

    await harness.controller.send("我們公司訂單變少了", []);
    await harness.controller.retry();

    expect(harness.onSuccessCalls).toEqual([{ reply: "成功了" }]);
    expect(harness.controller.canRetry).toBe(false);
    expect(harness.onBeforeSendCalls).toEqual([
      { content: "我們公司訂單變少了", isRetry: false },
      { content: "我們公司訂單變少了", isRetry: true },
    ]);
    // R3：只有第一次（isRetry=false）真的把使用者訊息加進 messages，retry 那次沒有再加一次。
    expect(harness.messages).toHaveLength(1);
    expect(harness.messages[0].content).toBe("我們公司訂單變少了");
  });

  it("R4: retry 進行中時再次呼叫 retry() 不會產生第二個 request", async () => {
    const gate = deferred<FakeResult>();
    const sendSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockReturnValueOnce(gate.promise);
    const harness = createHarness(sendSpy);

    await harness.controller.send("A", []);
    const retry1 = harness.controller.retry();
    const retry2 = harness.controller.retry();

    expect(sendSpy).toHaveBeenCalledTimes(2); // 一次原始送出（失敗）+ 一次 retry（進行中）
    gate.resolve({ reply: "ok" });
    await Promise.all([retry1, retry2]);
    expect(sendSpy).toHaveBeenCalledTimes(2); // 第二次 retry() 沒有再多打一次
  });

  it("R5: retry 再次失敗 → Retry 仍然可用（canRetry 保持 true）", async () => {
    const sendSpy = vi.fn().mockRejectedValueOnce(new Error("boom1")).mockRejectedValueOnce(new Error("boom2"));
    const harness = createHarness(sendSpy);

    await harness.controller.send("A", []);
    await harness.controller.retry();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(harness.onErrorCalls).toHaveLength(2);
    expect(harness.controller.canRetry).toBe(true);
  });

  it("R6: 失敗後使用者不 retry，直接送出新訊息 → 新訊息正常工作，且舊的失敗訊息不會被誤重送", async () => {
    const sendSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ reply: "新問題的回覆" });
    const harness = createHarness(sendSpy);

    await harness.controller.send("舊的失敗訊息", []);
    expect(harness.controller.canRetry).toBe(true);

    await harness.controller.send("全新的問題", []);

    expect(sendSpy).toHaveBeenNthCalledWith(2, "全新的問題", []);
    expect(harness.onSuccessCalls).toEqual([{ reply: "新問題的回覆" }]);
    // 新訊息送出後，舊的失敗素材已經被清空——之後呼叫 retry() 不應該重送「舊的失敗訊息」。
    expect(harness.controller.canRetry).toBe(false);
  });
});
