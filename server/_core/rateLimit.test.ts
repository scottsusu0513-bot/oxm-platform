/**
 * server/_core/rateLimit.ts 回歸測試 —— 針對「超過流量限制時純文字回應讓
 * tRPC client 端 JSON.parse 直接丟出 SyntaxError」這個已修正的 bug 做防護。
 * 直接單元測試匯出的 getBatchSize／rateLimitExceededHandler 純函式，不需要
 * 真的把任何一組配額送滿（那樣既慢又會弄髒共用的記憶體內計數狀態）。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getBatchSize, rateLimitExceededHandler } from "./rateLimit";

function createMockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("getBatchSize", () => {
  it("單一（非 batch）請求視為 1 筆", () => {
    expect(getBatchSize({ json: { foo: "bar" } })).toBe(1);
  });

  it("tRPC httpBatchLink 的 batch 物件依數字 key 數量計算筆數", () => {
    expect(getBatchSize({ "0": {}, "1": {}, "2": {} })).toBe(3);
  });

  it("非物件／空物件／null 一律視為 1 筆（安全預設值，不會回傳 0 長度陣列）", () => {
    expect(getBatchSize(null)).toBe(1);
    expect(getBatchSize(undefined)).toBe(1);
    expect(getBatchSize("not-an-object")).toBe(1);
    expect(getBatchSize({})).toBe(1);
  });
});

describe("rateLimitExceededHandler — 超過限制時的回應必須是合法、可被 tRPC 解析的 JSON", () => {
  it("單一請求：回應是長度 1 的陣列，且能被 JSON.parse／JSON.stringify 正確往返（不是純文字）", () => {
    const res = createMockRes();
    const handler = rateLimitExceededHandler("請求過於頻繁，請稍後再試");
    handler({ body: { json: {} } } as any, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];

    // 模擬瀏覽器端實際會做的事：先序列化成字串（Express res.json 內部也是這樣），
    // 再 JSON.parse 回來，證明不會像修正前的純文字訊息一樣丟出
    // "Unexpected token ... is not valid JSON"。
    const roundTripped = JSON.parse(JSON.stringify(body));
    expect(Array.isArray(roundTripped)).toBe(true);
    expect(roundTripped).toHaveLength(1);
    expect(roundTripped[0].error.json.message).toBe("請求過於頻繁，請稍後再試");
    expect(roundTripped[0].error.json.data.code).toBe("TOO_MANY_REQUESTS");
    expect(roundTripped[0].error.json.data.httpStatus).toBe(429);
  });

  it("batch 請求：回應陣列長度與 batch 呼叫數一致", () => {
    const res = createMockRes();
    const handler = rateLimitExceededHandler("請求過於頻繁，請稍後再試");
    handler({ body: { "0": {}, "1": {}, "2": {}, "3": {} } } as any, res);

    const body = JSON.parse(JSON.stringify(res.json.mock.calls[0][0]));
    expect(body).toHaveLength(4);
    for (const item of body) {
      expect(item.error.json.message).toBe("請求過於頻繁，請稍後再試");
    }
  });

  it("每個限流器可以帶自己的訊息文字（目前全部共用同一句，但函式本身支援客製化）", () => {
    const res = createMockRes();
    const handler = rateLimitExceededHandler("自訂訊息");
    handler({ body: {} } as any, res);
    const body = JSON.parse(JSON.stringify(res.json.mock.calls[0][0]));
    expect(body[0].error.json.message).toBe("自訂訊息");
  });
});

/**
 * 靜態原始碼合約測試（沿用 server/badges.test.ts 的 extractBlock 慣例）：
 * 確認本次修正沒有意外調高、調低或取消任何一組既有限流器的配額，也沒有
 * 讓任何一組限流器繞過共用的 rateLimitExceededHandler（避免又有某一組
 * 悄悄退回舊的純文字回應）。
 */
const RATE_LIMIT_SOURCE = readFileSync(path.join(__dirname, "rateLimit.ts"), "utf-8");

describe("server/_core/rateLimit.ts 靜態合約 —— 既有限流配額未被本次修正調整", () => {
  it("login/admin/submitReview/message/upload/search/report/api 八組限流器的 windowMs／max 維持原值", () => {
    const expected: Array<[name: string, windowMs: string, max: number]> = [
      ["loginLimiter", "15 * 60 * 1000", 15],
      ["adminLimiter", "60 * 60 * 1000", 100],
      ["submitReviewLimiter", "60 * 60 * 1000", 5],
      ["messageLimiter", "60 * 60 * 1000", 20],
      ["uploadLimiter", "60 * 60 * 1000", 10],
      ["searchLimiter", "60 * 1000", 30],
      ["reportLimiter", "60 * 60 * 1000", 5],
      ["apiLimiter", "60 * 60 * 1000", 1000],
    ];
    for (const [name, windowMs, max] of expected) {
      const pattern = new RegExp(
        `export const ${name} = createLimiter\\(${windowMs.replace(/\*/g, "\\*")}, ${max}\\)`,
      );
      expect(RATE_LIMIT_SOURCE, `${name} 的 windowMs／max 應維持 ${windowMs} / ${max}，未被本次修正調整`).toMatch(pattern);
    }
  });

  it("createLimiter 一律透過 rateLimitExceededHandler 產生 handler，八組限流器沒有任何一組自行覆寫", () => {
    expect(RATE_LIMIT_SOURCE).toMatch(/handler: rateLimitExceededHandler\(message\),/);
    // 確認檔案裡只有 createLimiter 內部這一處呼叫 rateLimit(...)，
    // 代表八個 export 都是透過同一個 createLimiter 包出來，沒有另外直接呼叫
    // rateLimit(...) 繞過共用的 handler。
    const rateLimitCallCount = (RATE_LIMIT_SOURCE.match(/\brateLimit\(\{/g) ?? []).length;
    expect(rateLimitCallCount).toBe(1);
  });
});
