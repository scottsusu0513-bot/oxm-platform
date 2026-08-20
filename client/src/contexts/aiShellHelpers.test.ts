import { describe, expect, it } from "vitest";
import {
  shouldAllowSendMessage,
  isScrollNearBottom,
  computeTextareaHeightPx,
  findMostRecentFactorySearchMessageId,
  appendUserMessageIfNeeded,
  shouldTrapFocusForViewport,
  resolveFocusTrapTarget,
} from "./aiShellHelpers";
import type { AiShellMessage } from "./AiShellContext";

describe("shouldAllowSendMessage (P1-5 Provider-level concurrency guard)", () => {
  it("G: 已有一個請求在飛時（isSendPending=true）不允許再送出", () => {
    expect(shouldAllowSendMessage(true)).toBe(false);
  });

  it("沒有請求在飛時允許送出", () => {
    expect(shouldAllowSendMessage(false)).toBe(true);
  });
});

describe("appendUserMessageIfNeeded (P1-3 Retry 不 duplicate user bubble)", () => {
  const existing: AiShellMessage[] = [{ id: "ai-msg-1", role: "user", content: "我們公司訂單掉很多" }];
  const newUserMessage: AiShellMessage = { id: "ai-msg-2", role: "user", content: "還在嗎？" };

  it("appendUserMessage=true（一般新訊息）：附加一則新的使用者 bubble", () => {
    const result = appendUserMessageIfNeeded(existing, newUserMessage, true);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(newUserMessage);
  });

  it("H: appendUserMessage=false（retry 失敗訊息）：不新增，回傳原陣列（同一個 reference，不是新複製也不是被清空）", () => {
    const result = appendUserMessageIfNeeded(existing, newUserMessage, false);
    expect(result).toBe(existing);
    expect(result).toHaveLength(1);
    expect(result.filter(m => m.content === newUserMessage.content)).toHaveLength(0);
  });
});

describe("isScrollNearBottom (P1-2 Smart Scroll)", () => {
  it("完全捲到底（scrollTop+clientHeight===scrollHeight）視為 near bottom", () => {
    expect(isScrollNearBottom(880, 1000, 120)).toBe(true);
  });

  it("在門檻內（<=120px）仍視為 near bottom", () => {
    expect(isScrollNearBottom(800, 1000, 120)).toBe(true); // 1000-800-120=80 <= 120
  });

  it("往上捲超過門檻時不是 near bottom，不該被強制拉回底部", () => {
    expect(isScrollNearBottom(300, 1000, 120)).toBe(false); // 1000-300-120=580 > 120
  });
});

describe("computeTextareaHeightPx (P1-4 Textarea Auto-grow)", () => {
  it("內容比 min 還短時，夾在 min", () => {
    expect(computeTextareaHeightPx(10, 128, 36)).toBe(36);
  });

  it("內容在 min/max 之間時，直接用實際 scrollHeight", () => {
    expect(computeTextareaHeightPx(70, 128, 36)).toBe(70);
  });

  it("內容超過 max 時，夾在 max（超出部分交給內部捲動）", () => {
    expect(computeTextareaHeightPx(300, 128, 36)).toBe(128);
  });
});

describe("findMostRecentFactorySearchMessageId (P1-6 Factory Boundary scroll CTA)", () => {
  it("J: 對話中確實存在較早的 factory_search_results 附件時，回傳那則訊息的 id", () => {
    const messages: AiShellMessage[] = [
      { id: "ai-msg-1", role: "user", content: "找台中的金屬加工廠" },
      {
        id: "ai-msg-2",
        role: "assistant",
        content: "幫你找到幾家",
        attachments: [{ type: "factory_search_results", candidates: [], total: 3, viewAllUrl: "/search" }],
      },
      { id: "ai-msg-3", role: "user", content: "第一家評價怎麼樣？" },
      { id: "ai-msg-4", role: "assistant", content: "建議你直接進工廠頁確認評價明細。" },
    ];
    expect(findMostRecentFactorySearchMessageId(messages)).toBe("ai-msg-2");
  });

  it("J: 有多筆 factory_search_results 附件時，回傳「最近一筆」而不是第一筆", () => {
    const messages: AiShellMessage[] = [
      {
        id: "ai-msg-1",
        role: "assistant",
        content: "第一次搜尋結果",
        attachments: [{ type: "factory_search_results", candidates: [], total: 3, viewAllUrl: "/search" }],
      },
      { id: "ai-msg-2", role: "user", content: "換個地區找" },
      {
        id: "ai-msg-3",
        role: "assistant",
        content: "第二次搜尋結果",
        attachments: [{ type: "factory_search_results", candidates: [], total: 2, viewAllUrl: "/search" }],
      },
    ];
    expect(findMostRecentFactorySearchMessageId(messages)).toBe("ai-msg-3");
  });

  it("J: 對話中不存在任何 factory_search_results 附件時，回傳 null（呼叫端不該顯示 CTA）", () => {
    const messages: AiShellMessage[] = [
      { id: "ai-msg-1", role: "user", content: "你們有哪些政府補助？" },
      {
        id: "ai-msg-2",
        role: "assistant",
        content: "目前有幾個方案",
        attachments: [{ type: "subsidy_programs_results", candidates: [], totalActiveCount: 2, viewAllUrl: "/upgrade-center" }],
      },
    ];
    expect(findMostRecentFactorySearchMessageId(messages)).toBeNull();
  });

  it("空對話回傳 null", () => {
    expect(findMostRecentFactorySearchMessageId([])).toBeNull();
  });
});

describe("shouldTrapFocusForViewport (Phase 7.2 E：Focus trap 只在 mobile)", () => {
  it("390px（mobile fullscreen sheet）需要 focus trap", () => {
    expect(shouldTrapFocusForViewport(390)).toBe(true);
  });

  it("1366px（desktop floating panel）不需要 focus trap", () => {
    expect(shouldTrapFocusForViewport(1366)).toBe(false);
  });

  it("剛好等於斷點時視為桌機（不 trap）", () => {
    expect(shouldTrapFocusForViewport(640)).toBe(false);
  });
});

describe("resolveFocusTrapTarget (Phase 7.2 E：Escape / Tab 鍵盤 hardening)", () => {
  const [a, b, c] = ["first", "middle", "last"];
  const focusable = [a, b, c];

  it("Shift+Tab 停在第一個元素時，wrap 回最後一個", () => {
    expect(resolveFocusTrapTarget(focusable, a, true)).toBe(c);
  });

  it("Tab 停在最後一個元素時，wrap 回第一個", () => {
    expect(resolveFocusTrapTarget(focusable, c, false)).toBe(a);
  });

  it("焦點在中間元素時不需要攔截（回傳 null，走瀏覽器預設行為）", () => {
    expect(resolveFocusTrapTarget(focusable, b, false)).toBeNull();
    expect(resolveFocusTrapTarget(focusable, b, true)).toBeNull();
  });

  it("沒有任何可 focus 元素時回傳 null", () => {
    expect(resolveFocusTrapTarget([], null, false)).toBeNull();
  });
});
