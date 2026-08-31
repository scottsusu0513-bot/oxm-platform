/**
 * GEO Phase 3A — client/index.html 全站 fallback metadata 校準。
 *
 * 背景：任何沒有專屬 server 端 SEO 注入分支的路由（例如修正前的
 * /news/:slug）一律直接吐出這份靜態 HTML 的 <title>/<meta description>，
 * 修正前是 Phase 2 校準前的舊 OXM 定位（「全台最齊全工廠與工作室媒合平台」
 * 「找代工不再浪費時間」），會讓不執行 JS 的爬蟲／AI 看到跟 Homepage/About
 * 已校準過的 Entity 互相矛盾的敘述。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readIndexHtml(): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", "client", "index.html"), "utf-8");
}

describe("client/index.html：全站 fallback 不再是 Phase 2 校準前的舊 OXM 定位", () => {
  it("不含舊版「全台最齊全工廠與工作室媒合平台」", () => {
    expect(readIndexHtml()).not.toContain("全台最齊全工廠與工作室");
  });

  it("不含舊版「找代工不再浪費時間」", () => {
    expect(readIndexHtml()).not.toContain("找代工不再浪費時間");
  });

  it("title 使用保守、通用的品牌定位", () => {
    expect(readIndexHtml()).toMatch(/<title>OXM｜台灣傳統產業數位資源平台<\/title>/);
  });

  it("description 只提已經真正公開的能力（工廠媒合／企業升級／產業資訊），不逐字複製 BRAND.description（那句話包含尚未完全正式公開的「產業人才」「品牌形象」，不適合當成沒有專屬設定時的通用 fallback）", () => {
    const html = readIndexHtml();
    expect(html).toContain("OXM 是台灣傳統產業的數位資源平台，以工廠媒合為核心，串聯企業升級、產業資訊與合作所需資源。");
    expect(html).not.toContain("產業人才");
    expect(html).not.toContain("品牌形象");
  });
});
