/**
 * server/_core/cookies.ts 的 getSessionCookieOptions() regression test。
 *
 * 背景：手機透過 LAN IP（例如 http://192.168.1.103:3000）走 dev-login 時，
 * session cookie 一直沒有被瀏覽器存下來——追查後發現舊版邏輯是用
 * hostname 白名單（只認得 localhost／127.0.0.1／::1）判斷要不要下
 * secure，LAN IP 不在白名單裡就被判定成「非 local」，於是在純 HTTP
 * 連線下也被下了 Secure 屬性；瀏覽器規範下 Secure cookie 在非 HTTPS
 * 連線一律不會被存，導致手機端從頭到尾沒有真正登入。
 *
 * 修正後改用專案既有、原本沒接上的 isSecureRequest(req)（依實際連線協定
 * ——req.protocol 或 x-forwarded-proto header——判斷），secure 完全由
 * 「這個請求是不是真的走 HTTPS」決定，不再維護任何 hostname／IP 清單。
 */
import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

function mockRequest(overrides: {
  protocol?: string;
  hostname?: string;
  forwardedProto?: string | string[];
}): Request {
  const headers: Record<string, string | string[] | undefined> = {};
  if (overrides.forwardedProto !== undefined) {
    headers["x-forwarded-proto"] = overrides.forwardedProto;
  }
  return {
    protocol: overrides.protocol ?? "http",
    hostname: overrides.hostname ?? "localhost",
    headers,
  } as unknown as Request;
}

describe("getSessionCookieOptions — secure 由實際連線協定決定，不再由 hostname 清單決定", () => {
  it("其餘屬性維持既有設定：httpOnly / path / sameSite", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "localhost" }));
    expect(opts.httpOnly).toBe(true);
    expect(opts.path).toBe("/");
    expect(opts.sameSite).toBe("lax");
  });

  it("(1) localhost + HTTP → secure=false", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "localhost" }));
    expect(opts.secure).toBe(false);
  });

  it("(2) 127.0.0.1 + HTTP → secure=false", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "127.0.0.1" }));
    expect(opts.secure).toBe(false);
  });

  it("(3) LAN IP 192.168.1.103 + HTTP → secure=false（這是本次要修的案例）", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "192.168.1.103" }));
    expect(opts.secure).toBe(false);
  });

  it("(4) 任意私有網段 IP（10.x／172.16-31.x）+ HTTP → secure=false，不靠 IP 清單也能正確判斷", () => {
    for (const hostname of ["10.0.0.5", "172.16.4.20", "192.168.0.1"]) {
      const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname }));
      expect(opts.secure, `hostname=${hostname}`).toBe(false);
    }
  });

  it("(5) 真正的 HTTPS 連線（req.protocol === \"https\"）→ secure=true，不管 hostname 是什麼", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "https", hostname: "192.168.1.103" }));
    expect(opts.secure).toBe(true);
  });

  it("(6) x-forwarded-proto: https（反向代理終止 TLS 的情境）→ secure=true", () => {
    const opts = getSessionCookieOptions(
      mockRequest({ protocol: "http", hostname: "app.internal", forwardedProto: "https" })
    );
    expect(opts.secure).toBe(true);
  });

  it("x-forwarded-proto 為陣列或逗號分隔、其中包含 https 時一樣視為 secure=true", () => {
    const opts1 = getSessionCookieOptions(
      mockRequest({ protocol: "http", hostname: "app.internal", forwardedProto: ["http", "https"] })
    );
    expect(opts1.secure).toBe(true);
    const opts2 = getSessionCookieOptions(
      mockRequest({ protocol: "http", hostname: "app.internal", forwardedProto: "http, https" })
    );
    expect(opts2.secure).toBe(true);
  });

  it("(7) 非 localhost 的一般 HTTP hostname（例如區網主機名稱）→ 只要不是 HTTPS 一樣 secure=false", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "my-office-pc.local" }));
    expect(opts.secure).toBe(false);
  });

  it("production 情境：Host www.oxmmatch.com 但 x-forwarded-proto: https（正式站在 HTTPS 反向代理後面）→ secure=true，這次 LAN 修正不會降低正式站安全性", () => {
    const opts = getSessionCookieOptions(
      mockRequest({ protocol: "http", hostname: "www.oxmmatch.com", forwardedProto: "https" })
    );
    expect(opts.secure).toBe(true);
  });

  it("production 情境：Node 進程本身直接看到 HTTPS（req.protocol === \"https\"）→ secure=true", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "https", hostname: "www.oxmmatch.com" }));
    expect(opts.secure).toBe(true);
  });

  it("沒有 x-forwarded-proto 且非 HTTPS 時預設 secure=false（不會因為缺標頭就誤判成安全）", () => {
    const opts = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "www.oxmmatch.com" }));
    expect(opts.secure).toBe(false);
  });
});
