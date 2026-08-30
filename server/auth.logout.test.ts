import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/**
 * Test fixture 缺口修正（Full Vitest baseline 修復）：`auth.logout` procedure
 * 本身（server/routers.ts）已經改成直接呼叫 `ctx.res.setHeader("Set-Cookie",
 * ...)` 手動組出「清空 cookie」的標頭字串（含依 hostname 決定是否加
 * `; Secure`），不是舊版靠 `ctx.res.clearCookie(name, options)` 這種
 * express-cookie-parser 風格的高階 API。這裡的 mock res 原本只實作
 * `clearCookie`，production code 早就不呼叫它了，所以呼叫
 * `ctx.res.setHeader(...)` 時整個測試會直接炸掉——不是 production 行為壞了，
 * 是這個 test fixture 沒有跟著 production 一起換掉 mock 介面。
 */
function createAuthContext(hostname = "www.oxmmatch.com"): { ctx: TrpcContext; setHeaderCalls: [string, string][] } {
  const setHeaderCalls: [string, string][] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      hostname,
      headers: {},
    } as TrpcContext["req"],
    res: {
      setHeader: (name: string, value: string) => {
        setHeaderCalls.push([name, value]);
      },
    } as unknown as TrpcContext["res"],
  };

  return { ctx, setHeaderCalls };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, setHeaderCalls } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    const setCookieCall = setHeaderCalls.find(([name]) => name === "Set-Cookie");
    expect(setCookieCall).toBeDefined();
    const cookieValue = setCookieCall![1];
    expect(cookieValue).toContain(`${COOKIE_NAME}=;`);
    expect(cookieValue).toContain("Path=/");
    expect(cookieValue).toContain("HttpOnly");
    expect(cookieValue).toContain("SameSite=Lax");
    expect(cookieValue).toContain("Max-Age=0");
    expect(cookieValue).toContain("Secure");

    const cacheControlCall = setHeaderCalls.find(([name]) => name === "Cache-Control");
    expect(cacheControlCall?.[1]).toBe("no-store");
  });

  it("本機 hostname（localhost/127.0.0.1/::1）不加 Secure 旗標，避免本機開發用非 HTTPS 時清不掉 cookie", () => {
    const { ctx, setHeaderCalls } = createAuthContext("localhost");
    const caller = appRouter.createCaller(ctx);

    return caller.auth.logout().then(() => {
      const setCookieCall = setHeaderCalls.find(([name]) => name === "Set-Cookie");
      expect(setCookieCall?.[1]).not.toContain("Secure");
    });
  });
});
