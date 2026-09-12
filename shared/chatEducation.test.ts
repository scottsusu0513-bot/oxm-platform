import { describe, expect, it } from "vitest";
import {
  HUMAN_CHAT_MESSAGE_TYPES,
  isHumanChatMessageType,
  isOrderTipMessageThresholdMet,
  hasLifetimeChatEducationQuota,
  MAX_LIFETIME_CHAT_EDUCATION_TIPS,
  ORDER_TIP_MESSAGE_THRESHOLD,
} from "./chatEducation";

describe("isHumanChatMessageType", () => {
  it("text／product／pdf 視為真人聊天訊息", () => {
    for (const t of HUMAN_CHAT_MESSAGE_TYPES) {
      expect(isHumanChatMessageType(t)).toBe(true);
    }
  });

  it("co_manager_invite 不算（系統邀請訊息）", () => {
    expect(isHumanChatMessageType("co_manager_invite")).toBe(false);
  });

  it("collaboration_order 不算（訂單狀態事件，非人工聊天）", () => {
    expect(isHumanChatMessageType("collaboration_order")).toBe(false);
  });
});

describe("isOrderTipMessageThresholdMet — 20 則門檻＋雙方都需至少 1 則", () => {
  it("19 + 0 → 不顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 19, factoryCount: 0 })).toBe(false);
  });

  it("20 + 0 → 不顯示（總數達標但工廠端從未回覆）", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 20, factoryCount: 0 })).toBe(false);
  });

  it("30 + 0 → 不顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 30, factoryCount: 0 })).toBe(false);
  });

  it("0 + 20 → 不顯示（工廠端灌訊息，詢價人從未回覆）", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 0, factoryCount: 20 })).toBe(false);
  });

  it("19 + 1 → 顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 19, factoryCount: 1 })).toBe(true);
  });

  it("1 + 19 → 顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 1, factoryCount: 19 })).toBe(true);
  });

  it("10 + 10 → 顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 10, factoryCount: 10 })).toBe(true);
  });

  it("15 + 8 = 23，雙方皆有訊息 → 顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 15, factoryCount: 8 })).toBe(true);
  });

  it("原本 20 + 0，另一方第一次回覆變成 20 + 1 → 顯示", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 20, factoryCount: 1 })).toBe(true);
  });

  it("總數未達門檻時，即使雙方都有訊息也不顯示（例如 9 + 9 = 18）", () => {
    expect(isOrderTipMessageThresholdMet({ requesterCount: 9, factoryCount: 9 })).toBe(false);
  });

  it("門檻常數為 20", () => {
    expect(ORDER_TIP_MESSAGE_THRESHOLD).toBe(20);
  });
});

describe("hasLifetimeChatEducationQuota — 每帳號 lifetime 最多 5 次", () => {
  it("0～4 次都還有額度", () => {
    for (let i = 0; i < MAX_LIFETIME_CHAT_EDUCATION_TIPS; i++) {
      expect(hasLifetimeChatEducationQuota(i)).toBe(true);
    }
  });

  it("已達 5 次時額度用盡", () => {
    expect(hasLifetimeChatEducationQuota(5)).toBe(false);
  });

  it("超過 5 次（防禦性）仍視為用盡", () => {
    expect(hasLifetimeChatEducationQuota(6)).toBe(false);
  });

  it("上限常數為 5", () => {
    expect(MAX_LIFETIME_CHAT_EDUCATION_TIPS).toBe(5);
  });
});
