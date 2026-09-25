/**
 * factory.search 的 searchFingerprint 回傳欄位（見對話「Search Analytics
 * resultCount 方案 A」、shared/searchFingerprint.ts）。驗證 server 是用它
 * 實際收到的 input 自己算出 fingerprint（不是原樣 echo 一個 client 傳來的
 * 值——這支 procedure 的 input schema 本來就沒有 searchFingerprint 欄位，
 * client 傳了也會被 zod 忽略/拒絕，這裡驗證的是「server 算出來的值等於用
 * 同一份 canonical builder、對同樣的 input 獨立算一次的結果」）。
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { buildSearchFingerprint } from "../shared/searchFingerprint";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("factory.search — searchFingerprint 欄位（server-side 自行計算，不是 echo）", () => {
  it("一般關鍵字搜尋：回傳的 searchFingerprint 等於用相同 input 獨立算出的 canonical fingerprint", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const input = { keyword: "測試關鍵字", page: 1, pageSize: 10 };
    const result = await caller.factory.search(input);
    const expected = buildSearchFingerprint(input);
    expect(result.searchFingerprint).toBe(expected);
  });

  it("帶完整篩選條件（industry/region/smallBatch/sortBy 等）：fingerprint 同樣等於獨立計算結果", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const input = {
      keyword: "包裝", industry: ["電子"], subIndustry: ["沖壓"], region: ["新竹市"],
      mfgMode: "ODM", businessType: "factory", smallBatch: true, sample: false,
      sortBy: "newest" as const, page: 1, pageSize: 10,
    };
    const result = await caller.factory.search(input);
    const expected = buildSearchFingerprint(input);
    expect(result.searchFingerprint).toBe(expected);
  });

  it("陣列篩選條件用不同順序傳入：fingerprint 仍然相同（集合語意）", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const inputA = { industry: ["電子", "金屬加工"], page: 1, pageSize: 10 };
    const inputB = { industry: ["金屬加工", "電子"], page: 1, pageSize: 10 };
    const resultA = await caller.factory.search(inputA);
    const resultB = await caller.factory.search(inputB);
    expect(resultA.searchFingerprint).toBe(resultB.searchFingerprint);
  });

  it("不同的 page（換頁）：searchFingerprint 不受影響（page 不在涵蓋範圍內）", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const page1 = await caller.factory.search({ keyword: "測試", page: 1, pageSize: 10 });
    const page2 = await caller.factory.search({ keyword: "測試", page: 2, pageSize: 10 });
    expect(page1.searchFingerprint).toBe(page2.searchFingerprint);
  });

  it("不同 keyword：searchFingerprint 不同", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const a = await caller.factory.search({ keyword: "包裝", page: 1, pageSize: 10 });
    const b = await caller.factory.search({ keyword: "精密", page: 1, pageSize: 10 });
    expect(a.searchFingerprint).not.toBe(b.searchFingerprint);
  });

  it("resultCount（total）與 searchFingerprint 來自同一份 response——data.total 就是 fingerprint 所描述的那次查詢的結果", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const input = { keyword: "包裝", page: 1, pageSize: 10 };
    const result = await caller.factory.search(input);
    expect(result.searchFingerprint).toBe(buildSearchFingerprint(input));
    expect(typeof result.total).toBe("number");
  });
});
