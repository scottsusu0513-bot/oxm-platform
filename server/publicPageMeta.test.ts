import { describe, expect, it } from "vitest";
import { escapeHtml } from "./_core/ogMeta";
import { injectPublicPageSeo } from "./_core/publicPageMeta";
import { getPublicPageSeoByPath, PUBLIC_PAGE_SEO } from "@shared/seo/publicPages";
import { toSafeJsonLdString, ORGANIZATION_ID, WEBSITE_ID, ABOUT_PAGE_ID } from "@shared/seo/schema";
import { escapeXmlText } from "@shared/seo/xml";

// title／description／canonical／OG 是 Helmet 也會重新宣告的節點，所以要能被
// 前端清理 hook 安全移除，一律標記這個屬性。
const TRANSIENT_ATTR = 'data-oxm-seo-transient="true"';
// JSON-LD 完全交給 server，React 掛載後永遠保留、不會被清理 hook 移除，因此
// 不套用 TRANSIENT_ATTR，只用這個屬性標示來源。
const SERVER_SOURCE_ATTR = 'data-oxm-seo-source="server"';

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
    <link rel="icon" type="image/png" href="/favicon.png" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

function count(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

describe("getPublicPageSeoByPath (route SEO mapping)", () => {
  it("maps \"/\" to the home config", () => {
    expect(getPublicPageSeoByPath("/")).toBe(PUBLIC_PAGE_SEO.home);
  });

  it("maps \"/about\" to the about config", () => {
    expect(getPublicPageSeoByPath("/about")).toBe(PUBLIC_PAGE_SEO.about);
  });

  it("treats a trailing slash on /about the same as no trailing slash", () => {
    expect(getPublicPageSeoByPath("/about/")).toBe(PUBLIC_PAGE_SEO.about);
  });

  it("returns null for routes with no dedicated SEO config", () => {
    expect(getPublicPageSeoByPath("/search")).toBeNull();
    expect(getPublicPageSeoByPath("/dashboard")).toBeNull();
    expect(getPublicPageSeoByPath("/factory/123")).toBeNull();
  });
});

describe("escapeHtml (HTML escape)", () => {
  it("escapes the five reserved HTML characters", () => {
    expect(escapeHtml(`<script>alert("x")&'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;"
    );
  });
});

describe("escapeXmlText (sitemap XML escape)", () => {
  it("escapes &, < and > for safe XML text content", () => {
    expect(escapeXmlText("A & B <C> D")).toBe("A &amp; B &lt;C&gt; D");
  });
});

describe("toSafeJsonLdString (JSON-LD escape)", () => {
  it("replaces every '<' with the \\u003c escape sequence", () => {
    const json = toSafeJsonLdString({ name: "a</script><script>alert(1)</script>" });
    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c");
    // Still valid, parseable JSON once unescaped back through JSON.parse
    // (JSON.parse understands < as a normal unicode escape).
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("a</script><script>alert(1)</script>");
  });

  it("accepts an array of objects", () => {
    const json = toSafeJsonLdString([{ a: 1 }, { b: 2 }]);
    expect(JSON.parse(json)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("injectPublicPageSeo (SEO head render)", () => {
  it("returns null for a path with no dedicated SEO config, leaving the caller to keep the default HTML", () => {
    expect(injectPublicPageSeo(BASE_HTML, "/search")).toBeNull();
  });

  it("injects the home title, description, canonical, and Organization + WebSite JSON-LD", () => {
    const out = injectPublicPageSeo(BASE_HTML, "/");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain(`<title ${TRANSIENT_ATTR}>OXM｜台灣工廠媒合與傳統產業數位資源平台</title>`);
    expect(html).toContain(PUBLIC_PAGE_SEO.home.description);
    expect(html).toContain(`<link ${TRANSIENT_ATTR} rel="canonical" href="https://www.oxmmatch.com/">`);
    expect(html).toContain(`"@type":"Organization"`);
    expect(html).toContain(`"@type":"WebSite"`);
    expect(html).toContain(ORGANIZATION_ID);
    expect(html).toContain(WEBSITE_ID);
  });

  it("injects the About title, description, canonical, and AboutPage + BreadcrumbList JSON-LD", () => {
    const out = injectPublicPageSeo(BASE_HTML, "/about");
    expect(out).not.toBeNull();
    const html = out as string;

    expect(html).toContain(`<title ${TRANSIENT_ATTR}>關於 OXM｜台灣傳統產業數位資源平台</title>`);
    expect(html).toContain(PUBLIC_PAGE_SEO.about.description);
    expect(html).toContain(`<link ${TRANSIENT_ATTR} rel="canonical" href="https://www.oxmmatch.com/about">`);
    expect(html).toContain(`"@type":"AboutPage"`);
    expect(html).toContain(`"@type":"BreadcrumbList"`);
    expect(html).toContain(ABOUT_PAGE_ID);
  });

  describe("title/description/canonical/OG all carry data-oxm-seo-transient=\"true\" (both pages)", () => {
    it.each(["/", "/about"] as const)("home/about: %s", (pathname) => {
      const html = injectPublicPageSeo(BASE_HTML, pathname) as string;

      expect(html).toMatch(new RegExp(`<title ${TRANSIENT_ATTR}>`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} name="description"`));
      expect(html).toMatch(new RegExp(`<link ${TRANSIENT_ATTR} rel="canonical"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:type"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:site_name"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:title"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:description"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:image"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:url"`));
      expect(html).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} property="og:locale"`));
    });
  });

  describe("JSON-LD does NOT carry the transient marker, but keeps data-oxm-seo-source=\"server\" (both pages)", () => {
    it.each(["/", "/about"] as const)("home/about: %s", (pathname) => {
      const html = injectPublicPageSeo(BASE_HTML, pathname) as string;

      const jsonLdScripts = html.match(/<script type="application\/ld\+json"[^>]*>/g) ?? [];
      expect(jsonLdScripts.length).toBeGreaterThan(0);
      for (const scriptTag of jsonLdScripts) {
        expect(scriptTag).toContain(SERVER_SOURCE_ATTR);
        expect(scriptTag).not.toContain(TRANSIENT_ATTR);
      }
    });
  });

  it("initial HTML has exactly 2 JSON-LD scripts on the home page (Organization + WebSite)", () => {
    const html = injectPublicPageSeo(BASE_HTML, "/") as string;
    expect(count(html, /<script type="application\/ld\+json"/g)).toBe(2);
    expect(count(html, /"@type":"Organization"/g)).toBe(1);
    expect(count(html, /"@type":"WebSite"/g)).toBe(1);
  });

  it("initial HTML has exactly 2 JSON-LD scripts on the About page (AboutPage + BreadcrumbList)", () => {
    const html = injectPublicPageSeo(BASE_HTML, "/about") as string;
    expect(count(html, /<script type="application\/ld\+json"/g)).toBe(2);
    expect(count(html, /"@type":"AboutPage"/g)).toBe(1);
    expect(count(html, /"@type":"BreadcrumbList"/g)).toBe(1);
  });

  it("leaves no unmarked (old) <title> tag on the home page", () => {
    const html = injectPublicPageSeo(BASE_HTML, "/") as string;
    const allTitles = html.match(/<title[^>]*>/g) ?? [];
    expect(allTitles).toHaveLength(1);
    expect(allTitles[0]).toContain(TRANSIENT_ATTR);
    expect(html).not.toContain("OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）");
  });

  it("leaves no unmarked (old) <title> tag on the About page", () => {
    const html = injectPublicPageSeo(BASE_HTML, "/about") as string;
    const allTitles = html.match(/<title[^>]*>/g) ?? [];
    expect(allTitles).toHaveLength(1);
    expect(allTitles[0]).toContain(TRANSIENT_ATTR);
    expect(html).not.toContain("OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）");
  });

  it.each(["/", "/about"] as const)("each page has exactly one canonical link (%s)", (pathname) => {
    const html = injectPublicPageSeo(BASE_HTML, pathname) as string;
    expect(count(html, /rel="canonical"/g)).toBe(1);
  });

  it.each(["/", "/about"] as const)("each page's main OG properties appear exactly once in the initial HTML (%s)", (pathname) => {
    const html = injectPublicPageSeo(BASE_HTML, pathname) as string;
    expect(count(html, /property="og:title"/g)).toBe(1);
    expect(count(html, /property="og:description"/g)).toBe(1);
    expect(count(html, /property="og:image"/g)).toBe(1);
    expect(count(html, /property="og:url"/g)).toBe(1);
  });

  it("never leaves two <title> tags, two canonical links, two of any OG property, or a duplicated/extra JSON-LD block when reprocessing the same HTML twice (duplicate-tag check)", () => {
    const once = injectPublicPageSeo(BASE_HTML, "/about") as string;
    const twice = injectPublicPageSeo(once, "/about") as string;

    expect(count(twice, /<title[^>]*>/g)).toBe(1);
    expect(count(twice, /rel="canonical"/g)).toBe(1);
    expect(count(twice, /property="og:title"/g)).toBe(1);
    expect(count(twice, /property="og:description"/g)).toBe(1);
    expect(count(twice, /property="og:image"/g)).toBe(1);
    expect(count(twice, /property="og:url"/g)).toBe(1);
    expect(count(twice, /<script type="application\/ld\+json"/g)).toBe(2);
    expect(count(twice, /"@type":"AboutPage"/g)).toBe(1);
    expect(count(twice, /"@type":"BreadcrumbList"/g)).toBe(1);
    expect(count(twice, /oxm-public-seo:start/g)).toBe(1);
  });

  it("does not break the description meta tag's HTML-escaping of quotes/ampersands", () => {
    const out = injectPublicPageSeo(BASE_HTML, "/") as string;
    // description content must be inside a well-formed double-quoted attribute
    expect(out).toMatch(new RegExp(`<meta ${TRANSIENT_ATTR} name="description" content="[^"]*">`));
  });
});
