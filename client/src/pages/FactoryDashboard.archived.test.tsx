// @vitest-environment jsdom
/**
 * 工廠主封存（owner soft-delete）後的後台畫面（Production Hardening Batch 2.5）。
 *
 * 修正前 factory.getMine 仍回傳封存工廠、後台照常顯示完整可編輯的頁面（沒有
 * 任何狀態提示）。修正後顯示封存狀態：說明資料與歷史紀錄仍保留、提供「申請
 * 重新上架」，不顯示編輯後台，也不導向建立全新工廠。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { QueryResultOverrides } from "@/test/trpcProxyMock";

const queryResults = vi.hoisted(() => ({}) as QueryResultOverrides);
const submitForReviewMutate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", async () => {
  const { createTrpcProxy } = await import("@/test/trpcProxyMock");
  const base = createTrpcProxy(queryResults);
  return {
    trpc: new Proxy(base, {
      get(target, prop: string) {
        if (prop !== "factory") return target[prop];
        return new Proxy(target.factory, {
          get(ft, fprop: string) {
            if (fprop === "submitForReview") {
              return { useMutation: () => ({ mutate: submitForReviewMutate, isPending: false }) };
            }
            return ft[fprop];
          },
        });
      },
    }),
  };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, name: "Owner", role: "user" }, isAuthenticated: true, loading: false }),
}));

import FactoryDashboard from "./FactoryDashboard";

function renderDashboard() {
  const memory = memoryLocation({ path: "/dashboard", record: true });
  const utils = render(
    <HelmetProvider>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <FactoryDashboard />
      </Router>
    </HelmetProvider>,
  );
  return { ...utils, history: memory.history };
}

beforeEach(() => {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  submitForReviewMutate.mockReset();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => cleanup());

describe("FactoryDashboard：封存工廠", () => {
  it("owner 的工廠已封存 → 顯示封存狀態與「申請重新上架」，不顯示編輯後台，也不導向建立新工廠", () => {
    queryResults["factory.getMine"] = { data: { id: 42, name: "封存測試工廠", status: "delisted", isArchived: true } };
    queryResults["factory.getCoManagedFactories"] = { data: [] };
    const { history } = renderDashboard();

    expect(screen.getByTestId("archived-factory-view")).toBeTruthy();
    expect(screen.getByText(/此工廠目前已下架/)).toBeTruthy();
    expect(screen.getByText(/工廠資料與歷史紀錄/)).toBeTruthy();
    expect(screen.queryByText("基本資料")).toBeNull();      // 沒有可編輯的後台分頁
    expect(screen.queryByText("刪除工廠")).toBeNull();
    expect(history).not.toContain("/register-factory");   // 沒有被導向建立新工廠

    fireEvent.click(screen.getByRole("button", { name: "申請重新上架" }));
    expect(submitForReviewMutate).toHaveBeenCalledTimes(1);
  });

  it("次管理者所屬的工廠被封存 → 只顯示封存狀態，不提供申請重新上架", () => {
    queryResults["factory.getMine"] = { data: null };
    queryResults["factory.getCoManagedFactories"] = { data: [{ factoryId: 7 }] };
    queryResults["factory.getById"] = { data: { id: 7, name: "他廠", status: "delisted", isArchived: true } };
    renderDashboard();
    expect(screen.getByTestId("archived-factory-view")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "申請重新上架" })).toBeNull();
    expect(screen.getByText(/次管理者僅能查看歷史紀錄/)).toBeTruthy();
  });
});
