// @vitest-environment jsdom
/**
 * ChatPage：工廠已下架／停止服務的既有對話只供查看（Production Hardening
 * Batch 2.5）。伺服器端 chat.send 等會拒絕寫入；前端依
 * chat.getConversationMeta.canSendMessages 停用輸入區，避免使用者誤以為可以
 * 繼續聊天。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { QueryResultOverrides } from "@/test/trpcProxyMock";

const queryResults = vi.hoisted(() => ({}) as QueryResultOverrides);

vi.mock("@/lib/trpc", async () => {
  const { createTrpcProxy } = await import("@/test/trpcProxyMock");
  return { trpc: createTrpcProxy(queryResults) };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 5, name: "Buyer", role: "user" }, isAuthenticated: true, loading: false }),
}));

import ChatPage from "./ChatPage";

function renderChat() {
  const { hook, searchHook } = memoryLocation({ path: "/chat/99" });
  return render(
    <HelmetProvider>
      <Router hook={hook} searchHook={searchHook}>
        <ChatPage />
      </Router>
    </HelmetProvider>,
  );
}

const META = { factoryName: "某工廠", productName: null, factoryId: 3, productId: null, userId: 5, factoryOwnerId: 9, isCoMgr: false, buyerName: "Buyer", buyerAffiliation: null };

beforeEach(() => {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  queryResults["chat.getMessages"] = { data: [] };
});
afterEach(() => cleanup());

describe("ChatPage：既有對話的讀寫狀態", () => {
  it("canSendMessages=false → 顯示僅供查看提示，沒有輸入框與送出按鈕", () => {
    queryResults["chat.getConversationMeta"] = { data: { ...META, canSendMessages: false } };
    renderChat();
    expect(screen.getByTestId("chat-read-only-notice").textContent).toMatch(/此工廠目前已停止服務，此對話僅供查看歷史紀錄/);
    expect(screen.queryByPlaceholderText("輸入訊息...")).toBeNull();
  });

  it("canSendMessages=true → 正常顯示輸入框", () => {
    queryResults["chat.getConversationMeta"] = { data: { ...META, canSendMessages: true } };
    renderChat();
    expect(screen.queryByTestId("chat-read-only-notice")).toBeNull();
    expect(screen.getByPlaceholderText("輸入訊息...")).toBeTruthy();
  });
});
