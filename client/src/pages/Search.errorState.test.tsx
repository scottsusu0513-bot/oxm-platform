// @vitest-environment jsdom
/**
 * Search：API 失敗不可顯示「沒有找到符合條件的結果」（Production Hardening
 * Batch 1）。
 *
 * 修正前 factory.search 失敗時 data 為 undefined，畫面直接落到「共找到 0 筆
 * 結果」＋「沒有找到符合條件的結果」。這裡 render 真正的 Search 頁面（tRPC
 * 以 proxy 替身取代），驗證：錯誤 → 錯誤畫面＋重試、不顯示筆數與無結果；
 * 成功但 0 筆 → 才顯示無結果；成功有資料 → 顯示真正的筆數。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { QueryResultOverrides } from "@/test/trpcProxyMock";
import { buildSearchFingerprint } from "@shared/searchFingerprint";

const queryResults = vi.hoisted(() => ({}) as QueryResultOverrides);

vi.mock("@/lib/trpc", async () => {
  const { createTrpcProxy } = await import("@/test/trpcProxyMock");
  return { trpc: createTrpcProxy(queryResults) };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null, isAuthenticated: false, loading: false }) }));

import Search from "./Search";

const NO_RESULTS_TEXT = "沒有找到符合條件的結果";

function renderSearch() {
  const { hook, searchHook } = memoryLocation({ path: "/search" });
  return render(
    <HelmetProvider>
      <Router hook={hook} searchHook={searchHook}>
        <Search />
      </Router>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

describe("Search 錯誤狀態", () => {
  it("500／網路錯誤：顯示錯誤＋重新嘗試，不顯示「沒有找到」、不顯示筆數、不顯示原始錯誤", () => {
    const refetch = vi.fn(async () => undefined);
    queryResults["factory.search"] = {
      isError: true,
      error: { message: "Failed query: select", data: { httpStatus: 500, code: "INTERNAL_SERVER_ERROR" } },
      refetch,
    };
    renderSearch();
    expect(screen.getByText("載入失敗，請重新嘗試")).toBeTruthy();
    expect(screen.queryByText(NO_RESULTS_TEXT)).toBeNull();
    expect(screen.queryByText(/共找到/)).toBeNull();
    expect(screen.queryByText(/Failed query/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /重新嘗試/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("429：顯示「目前請求較多，請稍後再試」", () => {
    queryResults["factory.search"] = {
      isError: true,
      error: { message: "請求過於頻繁", data: { httpStatus: 429, code: "TOO_MANY_REQUESTS" } },
    };
    renderSearch();
    expect(screen.getByText("目前請求較多，請稍後再試")).toBeTruthy();
    expect(screen.queryByText(NO_RESULTS_TEXT)).toBeNull();
  });

  it("錯誤時仍帶著上一次搜尋的 placeholder 資料：不得把舊資料／舊筆數當成目前結果", () => {
    queryResults["factory.search"] = {
      isError: true,
      isPlaceholderData: true,
      error: { data: { httpStatus: 500 } },
      data: { items: [], total: 44, ads: [], searchFingerprint: "stale-fingerprint" },
    };
    renderSearch();
    expect(screen.getByText("載入失敗，請重新嘗試")).toBeTruthy();
    expect(screen.queryByText(/共找到 44/)).toBeNull();
  });

  it("成功且 0 筆：才顯示「沒有找到符合條件的結果」", () => {
    queryResults["factory.search"] = {
      data: { items: [], total: 0, ads: [], searchFingerprint: buildSearchFingerprint({}) },
    };
    renderSearch();
    expect(screen.getByText(NO_RESULTS_TEXT)).toBeTruthy();
    expect(screen.queryByText("載入失敗，請重新嘗試")).toBeNull();
  });
});
