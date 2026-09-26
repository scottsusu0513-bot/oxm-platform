import { describe, expect, it } from "vitest";
import { normalizeWebsiteUrl } from "./websiteUrl";

describe("normalizeWebsiteUrl", () => {
  it("returns null for missing / blank values", () => {
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
    expect(normalizeWebsiteUrl("")).toBeNull();
    expect(normalizeWebsiteUrl("   ")).toBeNull();
    expect(normalizeWebsiteUrl(123)).toBeNull();
  });

  it("returns null for the placeholders already used in the codebase/data", () => {
    for (const v of ["無", " 無 ", "N/A", "n/a", "-"]) expect(normalizeWebsiteUrl(v)).toBeNull();
  });

  it("never turns a placeholder or bare word into https://<word>", () => {
    expect(normalizeWebsiteUrl("無網站")).toBeNull();
    expect(normalizeWebsiteUrl("NA")).toBeNull();
    expect(normalizeWebsiteUrl("https://無")).toBeNull();
    expect(normalizeWebsiteUrl("localhost")).toBeNull();
    expect(normalizeWebsiteUrl("官方網站 example.com")).toBeNull();
  });

  it("adds https:// to scheme-less domains", () => {
    expect(normalizeWebsiteUrl("example.com")).toBe("https://example.com");
    expect(normalizeWebsiteUrl(" www.example.com ")).toBe("https://www.example.com");
    expect(normalizeWebsiteUrl("example.com:8080/path")).toBe("https://example.com:8080/path");
  });

  it("keeps http:// and https:// URLs", () => {
    expect(normalizeWebsiteUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeWebsiteUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeWebsiteUrl("HTTPS://Example.com")).toBe("HTTPS://Example.com");
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsiteUrl("JavaScript:alert(document.domain)//example.com")).toBeNull();
    expect(normalizeWebsiteUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normalizeWebsiteUrl("mailto:a@example.com")).toBeNull();
    expect(normalizeWebsiteUrl("ftp://example.com")).toBeNull();
    expect(normalizeWebsiteUrl("//example.com")).toBeNull();
  });
});
