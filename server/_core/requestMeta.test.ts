import { describe, expect, it } from "vitest";
import { getClientIp, hashIp, anonymizeIpPrefix } from "./requestMeta";

function fakeReq(opts: { headers?: Record<string, string>; ip?: string; remoteAddress?: string }) {
  return {
    headers: opts.headers ?? {},
    ip: opts.ip,
    socket: { remoteAddress: opts.remoteAddress },
  } as any;
}

describe("getClientIp（優先序：req.ip > socket.remoteAddress；Batch 3.11 起不採信任何 client 可自帶的 header）", () => {
  it("CF-Connecting-IP header 不採信：client 可自行偽造；經 Cloudflare 時 req.ip 已由 trust proxy 規則解析成真實 client", () => {
    const req = fakeReq({ headers: { "cf-connecting-ip": "203.0.113.5" }, ip: "10.0.0.1" });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("用 req.ip（server/_core/clientIp.ts 逐跳信任規則解析的結果）", () => {
    const req = fakeReq({ ip: "203.0.113.9" });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("都沒有時 fallback 到 socket.remoteAddress", () => {
    const req = fakeReq({ remoteAddress: "127.0.0.1" });
    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  it("CF-Connecting-IP 是空字串時不採用，繼續往下 fallback", () => {
    const req = fakeReq({ headers: { "cf-connecting-ip": "   " }, ip: "203.0.113.9" });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("完全沒有任何來源時回傳空字串，不拋錯", () => {
    const req = fakeReq({});
    expect(getClientIp(req)).toBe("");
  });
});

describe("hashIp（單向雜湊，加鹽，不可逆推）", () => {
  it("同樣的 IP 每次雜湊結果一致（同一次 process 內）", () => {
    expect(hashIp("203.0.113.5")).toBe(hashIp("203.0.113.5"));
  });
  it("不同 IP 雜湊結果不同", () => {
    expect(hashIp("203.0.113.5")).not.toBe(hashIp("203.0.113.6"));
  });
  it("空字串安全回傳空字串，不拋錯", () => {
    expect(hashIp("")).toBe("");
  });
  it("雜湊結果不是原始 IP 字面值（不可逆推的基本檢查）", () => {
    expect(hashIp("203.0.113.5")).not.toContain("203.0.113.5");
  });
});

describe("anonymizeIpPrefix（只保留粗粒度網段，不保留完整位址）", () => {
  it("IPv4 收斂成 /24", () => {
    expect(anonymizeIpPrefix("203.0.113.42")).toBe("203.0.113.0/24");
  });
  it("IPv6 收斂成前 3 組（/48）", () => {
    expect(anonymizeIpPrefix("2001:db8:1234:5678::1")).toBe("2001:db8:1234::/48");
  });
  it("空字串安全回傳空字串", () => {
    expect(anonymizeIpPrefix("")).toBe("");
  });
});
