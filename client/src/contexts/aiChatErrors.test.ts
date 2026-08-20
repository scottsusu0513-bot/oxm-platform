import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { resolveChatErrorMessage, resolveHandoffErrorMessage } from "./aiChatErrors";

const RAW_INTERNAL_DETAIL = "Failed query: SELECT * FROM ai_conversations WHERE id=42 -- ECONNREFUSED 10.0.4.12:3306";

describe("resolveChatErrorMessage (Phase 7.2 F：Error UX differentiation)", () => {
  it("server 有回應的 TRPCError（data 非空）→ 固定的安全 AI 錯誤文字", () => {
    const error = TRPCClientError.from({
      error: { code: -32603, message: RAW_INTERNAL_DETAIL, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    });
    expect(resolveChatErrorMessage(error)).toBe("OXM AI 暫時無法回應，請再試一次。");
  });

  it("根本沒收到 server 回應（data 是 undefined，例如 fetch 失敗／離線）→ 連線逾時文字", () => {
    const error = TRPCClientError.from(new Error(RAW_INTERNAL_DETAIL));
    expect(resolveChatErrorMessage(error)).toBe("連線逾時，請確認網路後再試一次。");
  });

  it("不是 TRPCClientError 的例外情況（防禦性）→ 仍然 fallback 回安全的 AI 錯誤文字，不是丟出例外", () => {
    expect(resolveChatErrorMessage(new Error(RAW_INTERNAL_DETAIL))).toBe("OXM AI 暫時無法回應，請再試一次。");
    expect(resolveChatErrorMessage("plain string error")).toBe("OXM AI 暫時無法回應，請再試一次。");
    expect(resolveChatErrorMessage(null)).toBe("OXM AI 暫時無法回應，請再試一次。");
  });

  it("無論哪一種分類，回傳的文字都不包含原始 error 的任何內部細節", () => {
    const serverError = TRPCClientError.from({
      error: { code: -32603, message: RAW_INTERNAL_DETAIL, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    });
    const networkError = TRPCClientError.from(new Error(RAW_INTERNAL_DETAIL));
    expect(resolveChatErrorMessage(serverError)).not.toContain("SELECT");
    expect(resolveChatErrorMessage(serverError)).not.toContain("ECONNREFUSED");
    expect(resolveChatErrorMessage(networkError)).not.toContain("SELECT");
    expect(resolveChatErrorMessage(networkError)).not.toContain("ECONNREFUSED");
  });
});

describe("resolveHandoffErrorMessage (Phase 7.2 F)", () => {
  it("固定回傳同一句安全文字，不管 error 內容是什麼", () => {
    const error = TRPCClientError.from({
      error: { code: -32603, message: RAW_INTERNAL_DETAIL, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    });
    expect(resolveHandoffErrorMessage(error)).toBe("目前無法開啟詢問表單，請再試一次。");
    expect(resolveHandoffErrorMessage(new Error(RAW_INTERNAL_DETAIL))).toBe("目前無法開啟詢問表單，請再試一次。");
    expect(resolveHandoffErrorMessage(error)).not.toContain("SELECT");
  });
});
