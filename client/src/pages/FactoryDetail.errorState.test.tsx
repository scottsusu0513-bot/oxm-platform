// @vitest-environment jsdom
/**
 * FactoryDetail：查詢失敗 ≠ 工廠不存在（Production Hardening Batch 1）。
 *
 * 修正前只判斷 `if (!factory)`，429／500／網路中斷（包含 Googlebot 渲染時
 * API 被 robots.txt 擋下）全部顯示「找不到此工廠」。這裡 render 真正的
 * FactoryDetail 頁面（tRPC 以 proxy 替身取代），驗證四種狀態各自的畫面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null, isAuthenticated: false, loading: false }) }));

import FactoryDetail from "./FactoryDetail";

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <HelmetProvider>
      <Router hook={hook}>
        <FactoryDetail />
      </Router>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => cleanup());

describe("FactoryDetail 錯誤狀態與「找不到」分開", () => {
  it("500／網路錯誤：顯示「載入失敗，請重新嘗試」＋重新嘗試，不顯示「找不到此工廠」，也不顯示原始錯誤訊息", () => {
    const refetch = vi.fn(async () => undefined);
    queryResults["factory.getById"] = {
      isError: true,
      error: { message: "Failed query: select * from factories", data: { httpStatus: 500, code: "INTERNAL_SERVER_ERROR" } },
      refetch,
    };
    renderAt("/factory/26");
    expect(screen.getByText("載入失敗，請重新嘗試")).toBeTruthy();
    expect(screen.queryByText("找不到此工廠")).toBeNull();
    expect(screen.queryByText(/Failed query/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /重新嘗試/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("429：顯示「目前請求較多，請稍後再試」", () => {
    queryResults["factory.getById"] = {
      isError: true,
      error: { message: "請求過於頻繁", data: { httpStatus: 429, code: "TOO_MANY_REQUESTS" } },
    };
    renderAt("/factory/26");
    expect(screen.getByText("目前請求較多，請稍後再試")).toBeTruthy();
    expect(screen.queryByText("找不到此工廠")).toBeNull();
  });

  it("成功回應且 factory === null：才顯示「找不到此工廠」", () => {
    queryResults["factory.getById"] = { data: null };
    renderAt("/factory/999999");
    expect(screen.getByText("找不到此工廠")).toBeTruthy();
    expect(screen.queryByText("載入失敗，請重新嘗試")).toBeNull();
  });

  it("載入中：顯示 skeleton，不顯示找不到或錯誤", () => {
    queryResults["factory.getById"] = { isLoading: true, isFetching: true };
    renderAt("/factory/26");
    expect(screen.queryByText("找不到此工廠")).toBeNull();
    expect(screen.queryByText("載入失敗，請重新嘗試")).toBeNull();
  });
});
