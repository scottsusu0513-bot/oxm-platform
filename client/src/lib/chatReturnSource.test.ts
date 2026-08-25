import { describe, expect, it } from "vitest";
import { isSafeChatReturnSource } from "./chatReturnSource";

describe("isSafeChatReturnSource", () => {
  it("接受站內相對路徑（含 query string）", () => {
    expect(isSafeChatReturnSource("/factory/123")).toBe(true);
    expect(isSafeChatReturnSource("/messages")).toBe(true);
    expect(isSafeChatReturnSource("/messages?tab=factory")).toBe(true);
    expect(isSafeChatReturnSource("/dashboard?tab=orders")).toBe(true);
    expect(isSafeChatReturnSource("/orders/456")).toBe(true);
    expect(isSafeChatReturnSource("/member")).toBe(true);
    expect(isSafeChatReturnSource("/upgrade-consultant/cases?caseId=1")).toBe(true);
  });

  it("拒絕 chat 路由本身，避免 Chat A → Chat B → Chat A 循環", () => {
    expect(isSafeChatReturnSource("/chat/new")).toBe(false);
    expect(isSafeChatReturnSource("/chat/456")).toBe(false);
    expect(isSafeChatReturnSource("/chat/new?factoryId=1")).toBe(false);
    expect(isSafeChatReturnSource("/chat")).toBe(false);
  });

  it("不會把只是剛好以 chat 開頭、但不是 /chat 路由的路徑誤判為 chat 路由", () => {
    expect(isSafeChatReturnSource("/chatroom-archive")).toBe(true);
  });

  it("拒絕非字串型別", () => {
    expect(isSafeChatReturnSource(null)).toBe(false);
    expect(isSafeChatReturnSource(undefined)).toBe(false);
    expect(isSafeChatReturnSource(123)).toBe(false);
    expect(isSafeChatReturnSource({})).toBe(false);
  });

  it("拒絕站外／protocol-relative／絕對網址", () => {
    expect(isSafeChatReturnSource("//evil.example.com")).toBe(false);
    expect(isSafeChatReturnSource("https://evil.example.com")).toBe(false);
    expect(isSafeChatReturnSource("http://example.com/factory/123")).toBe(false);
    expect(isSafeChatReturnSource("javascript://alert(1)")).toBe(false);
  });

  it("拒絕不是以 / 開頭的相對路徑", () => {
    expect(isSafeChatReturnSource("factory/123")).toBe(false);
    expect(isSafeChatReturnSource("")).toBe(false);
  });
});
