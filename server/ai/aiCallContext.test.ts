/**
 * Phase 8.1 U 系列（AsyncLocalStorage 隔離性）：驗證 runWithAiCallContext／
 * getCurrentAiCallContext 在「多個並發呼叫鏈同時進行」時不會互相污染——這是
 * provider 層 usage logging 正確歸屬到對的 turn／factory／actor 的地基，
 * 不需要真實 DB，純粹測 AsyncLocalStorage 本身的傳遞行為。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runWithAiCallContext, getCurrentAiCallContext, formatAiLogContext, logAiError } from "./aiCallContext";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("aiCallContext（Phase 8.1 U 系列）", () => {
  it("U1：沒有包在 runWithAiCallContext 內時，getCurrentAiCallContext 回傳 undefined", () => {
    expect(getCurrentAiCallContext()).toBeUndefined();
  });

  it("U2：context 內可以正確讀到剛剛傳入的 turnId／factoryId／actorUserId", async () => {
    await runWithAiCallContext({ turnId: 1, factoryId: 2, actorUserId: 3 }, async () => {
      expect(getCurrentAiCallContext()).toEqual({ turnId: 1, factoryId: 2, actorUserId: 3 });
    });
  });

  it("U3：兩個並發的呼叫鏈（模擬兩個使用者同時各自送出一輪 AI turn）不會互相污染 context", async () => {
    const seenInA: Array<typeof undefined | ReturnType<typeof getCurrentAiCallContext>> = [];
    const seenInB: Array<typeof undefined | ReturnType<typeof getCurrentAiCallContext>> = [];

    async function simulateTurn(turnId: number, factoryId: number, sink: typeof seenInA) {
      await runWithAiCallContext({ turnId, factoryId, actorUserId: turnId * 100 }, async () => {
        sink.push(getCurrentAiCallContext());
        await delay(turnId === 10 ? 20 : 5); // 故意讓 A 比 B 晚完成，交錯執行
        sink.push(getCurrentAiCallContext());
      });
    }

    await Promise.all([
      simulateTurn(10, 100, seenInA),
      simulateTurn(20, 200, seenInB),
    ]);

    for (const snapshot of seenInA) {
      expect(snapshot).toEqual({ turnId: 10, factoryId: 100, actorUserId: 1000 });
    }
    for (const snapshot of seenInB) {
      expect(snapshot).toEqual({ turnId: 20, factoryId: 200, actorUserId: 2000 });
    }
  });

  it("U4：巢狀 async 呼叫（模擬 diagnosis → routing → provider 多層 await）仍能讀到最外層設定的 context", async () => {
    async function innerMost() {
      return getCurrentAiCallContext();
    }
    async function middle() {
      await delay(1);
      return innerMost();
    }
    const result = await runWithAiCallContext({ turnId: 5, factoryId: 6, actorUserId: 7 }, () => middle());
    expect(result).toEqual({ turnId: 5, factoryId: 6, actorUserId: 7 });
  });

  it("U5：離開 runWithAiCallContext 之後，外部呼叫 getCurrentAiCallContext 不會殘留內層的值", async () => {
    await runWithAiCallContext({ turnId: 1, factoryId: 1, actorUserId: 1 }, async () => {});
    expect(getCurrentAiCallContext()).toBeUndefined();
  });
});

describe("formatAiLogContext／logAiError（Phase 10.2 P1「十五、十六」：統一 AI log prefix，R13）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有 ambient turnId 時，格式是 [OXM-AI][turn:<turnId>][layer:<layer>]", async () => {
    await runWithAiCallContext({ turnId: 42, factoryId: 1, actorUserId: 1 }, async () => {
      expect(formatAiLogContext("diagnosis")).toBe("[OXM-AI][turn:42][layer:diagnosis]");
    });
  });

  it("沒有 ambient context（背景流程）時，格式是 [OXM-AI][background][layer:<layer>]", () => {
    expect(getCurrentAiCallContext()).toBeUndefined();
    expect(formatAiLogContext("memorySummary")).toBe("[OXM-AI][background][layer:memorySummary]");
  });

  it("turnIdOverride 明確傳入時優先於 ambient context（routers.ts 離開 runWithAiCallContext 之後的情境）", async () => {
    await runWithAiCallContext({ turnId: 1, factoryId: 1, actorUserId: 1 }, async () => {});
    // 離開 runWithAiCallContext 之後，ambient context 已經是 undefined（見 U5），
    // 但呼叫端手上仍有明確已知的 turnId（例如 reservation.turnId），這裡驗證
    // override 有被正確採用，不會退化成 [background]。
    expect(formatAiLogContext("aiChat", 999)).toBe("[OXM-AI][turn:999][layer:aiChat]");
  });

  it("turnIdOverride 傳 null 時明確代表背景流程，即使 ambient context 有值也不會誤用", async () => {
    await runWithAiCallContext({ turnId: 42, factoryId: 1, actorUserId: 1 }, async () => {
      expect(formatAiLogContext("memorySummary", null)).toBe("[OXM-AI][background][layer:memorySummary]");
    });
  });

  it("R13：logAiError 輸出只含 turnId／layer／訊息與 error.message，不含 prompt／assistant 回覆等內容欄位", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("simulated failure detail");
    logAiError("routing", "Layer 2 routing failed", err, 7);
    expect(spy).toHaveBeenCalledTimes(1);
    const [prefixAndMessage, loggedDetail] = spy.mock.calls[0];
    expect(prefixAndMessage).toBe("[OXM-AI][turn:7][layer:routing] Layer 2 routing failed");
    expect(loggedDetail).toBe("simulated failure detail");
    // 只允許 message 本身，不能整包 Error 物件（可能含更多欄位）或額外的
    // conversation content 被序列化進去。
    expect(typeof loggedDetail).toBe("string");
  });
});
