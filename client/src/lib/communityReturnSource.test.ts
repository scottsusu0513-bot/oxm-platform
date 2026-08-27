import { describe, expect, it } from "vitest";
import { isSafeCommunityReturnSource } from "./communityReturnSource";

describe("isSafeCommunityReturnSource", () => {
  it("接受 Community 討論區／競標區列表路由本身（含 query string）", () => {
    expect(isSafeCommunityReturnSource("/community/cross-industry/discussions")).toBe(true);
    expect(isSafeCommunityReturnSource("/community/metal-processing/discussions")).toBe(true);
    expect(isSafeCommunityReturnSource("/community/cross-industry/bids")).toBe(true);
    expect(isSafeCommunityReturnSource("/community/cross-industry/discussions?page=2")).toBe(true);
  });

  it("拒絕貼文詳情路由本身（避免 A→B→A 循環）", () => {
    expect(isSafeCommunityReturnSource("/community/cross-industry/discussions/123")).toBe(false);
  });

  it("拒絕 /community 首頁與其他不是列表路由的 Community 路徑", () => {
    expect(isSafeCommunityReturnSource("/community")).toBe(false);
    expect(isSafeCommunityReturnSource("/community/")).toBe(false);
  });

  it("拒絕任意其他站內路徑——只有 Community 列表路由本身是合法來源", () => {
    expect(isSafeCommunityReturnSource("/search")).toBe(false);
    expect(isSafeCommunityReturnSource("/factory/123")).toBe(false);
    expect(isSafeCommunityReturnSource("/")).toBe(false);
  });

  it("拒絕非字串型別", () => {
    expect(isSafeCommunityReturnSource(null)).toBe(false);
    expect(isSafeCommunityReturnSource(undefined)).toBe(false);
    expect(isSafeCommunityReturnSource(123)).toBe(false);
    expect(isSafeCommunityReturnSource({})).toBe(false);
  });

  it("拒絕站外／protocol-relative／絕對網址（不得 open redirect）", () => {
    expect(isSafeCommunityReturnSource("//evil.example.com/community/x/discussions")).toBe(false);
    expect(isSafeCommunityReturnSource("https://evil.example.com/community/x/discussions")).toBe(false);
    expect(isSafeCommunityReturnSource("javascript://alert(1)")).toBe(false);
  });

  it("拒絕不是以 / 開頭的相對路徑", () => {
    expect(isSafeCommunityReturnSource("community/x/discussions")).toBe(false);
    expect(isSafeCommunityReturnSource("")).toBe(false);
  });
});
