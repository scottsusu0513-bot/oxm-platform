/**
 * /search 的伺服器端初始 HTML metadata（原始 HTML，未執行 JS）。
 *
 * 背景：修正前 noindex／canonical 只透過 react-helmet-async 在 client 端
 * 掛載後才寫進 DOM，原始 HTML（Googlebot 第一次抓取、未執行 JS 拿到的
 * 內容）完全沒有這些標記，用 curl 直接請求本機 server 驗證過：
 * `/search`、`/search?industry=金屬加工` 的原始 <title> 都是全站通用預設值，
 * 完全沒有 <link rel="canonical"> 或 <meta name="robots">。這裡驗證修正後
 * 的行為：buildSearchPageMeta（純字串查表，供 server/_core/vite.ts 使用，
 * 供 client 端 Search.tsx 共用同一份公式）與 injectMetaIntoHtml 共同運作
 * 產生的「原始 HTML 字串」本身，而不是只驗證 client 原始碼有沒有寫這段
 * 邏輯（那只能證明 client 端行為，不能證明 Googlebot 第一次抓取就看得到）。
 */
import { describe, expect, it } from "vitest";
import { buildSearchPageMeta } from "@shared/seo/searchPage";
import { injectMetaIntoHtml, DEFAULT_OG_IMAGE } from "./_core/ogMeta";

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

function renderSearchHtml(queryString: string): string {
  const meta = buildSearchPageMeta(queryString);
  return injectMetaIntoHtml(BASE_HTML, {
    title: meta.title,
    description: meta.description,
    image: DEFAULT_OG_IMAGE,
    url: meta.canonical,
    status: 200,
    noindex: meta.noindex,
  });
}

describe("buildSearchPageMeta：純函式規則", () => {
  it("無參數：可索引（noindex=false），自我 canonical 到 /search（無問號）", () => {
    const meta = buildSearchPageMeta("");
    expect(meta.noindex).toBe(false);
    expect(meta.canonical).toBe("https://www.oxmmatch.com/search");
  });

  it("帶任何篩選參數：noindex=true，canonical 帶回原始 query", () => {
    expect(buildSearchPageMeta("industry=%E9%87%91%E5%B1%AC%E5%8A%A0%E5%B7%A5").noindex).toBe(true);
    expect(buildSearchPageMeta("region=%E5%8F%B0%E4%B8%AD").noindex).toBe(true);
    expect(buildSearchPageMeta("industry=%E9%A3%9F%E5%93%81&region=%E5%8F%B0%E4%B8%AD").noindex).toBe(true);
  });

  it("canonical 自我指向請求的完整網址（含 query），不會導向 /industry/ 或首頁", () => {
    const meta = buildSearchPageMeta("industry=%E9%87%91%E5%B1%AC%E5%8A%A0%E5%B7%A5");
    expect(meta.canonical).toBe("https://www.oxmmatch.com/search?industry=%E9%87%91%E5%B1%AC%E5%8A%A0%E5%B7%A5");
  });

  it("有 industry 參數時 title/description 是產業專屬文案（跟無參數版本不同）", () => {
    const bare = buildSearchPageMeta("");
    const filtered = buildSearchPageMeta("industry=%E9%87%91%E5%B1%AC%E5%8A%A0%E5%B7%A5");
    expect(filtered.title).not.toBe(bare.title);
    expect(filtered.title).toContain("金屬加工");
  });
});

describe("原始 HTML 字串（injectMetaIntoHtml + buildSearchPageMeta，等同 Googlebot 未執行 JS 拿到的內容）", () => {
  it("bare /search：原始 HTML 有 self-canonical，且不含 noindex", () => {
    const html = renderSearchHtml("");
    expect(html).toContain('<link rel="canonical" href="https://www.oxmmatch.com/search">');
    expect(html).not.toContain('name="robots"');
  });

  it("/search?industry=金屬加工：原始 HTML 直接包含 noindex,follow", () => {
    const html = renderSearchHtml("industry=%E9%87%91%E5%B1%AC%E5%8A%A0%E5%B7%A5");
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("/search?region=台中：原始 HTML 直接包含 noindex", () => {
    const html = renderSearchHtml("region=%E5%8F%B0%E4%B8%AD");
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("/search?industry=食品&region=台中：原始 HTML 直接包含 noindex，canonical 帶完整 query", () => {
    const html = renderSearchHtml("industry=%E9%A3%9F%E5%93%81&region=%E5%8F%B0%E4%B8%AD");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<link rel="canonical" href="https://www.oxmmatch.com/search?industry=%E9%A3%9F%E5%93%81&amp;region=%E5%8F%B0%E4%B8%AD">');
  });

  it("bare /search 的原始 HTML 不再是全站通用 title", () => {
    const html = renderSearchHtml("");
    expect(html).not.toContain("<title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>");
    expect(html).toContain("<title>搜尋台灣傳產廠商與資源｜OXM</title>");
  });
});
