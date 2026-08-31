/**
 * GEO Final Cleanup — /upgrade-center 的 build-time 語意殼。
 *
 * 背景：Audit 確認 raw HTML 的 <div id="root"></div> 完全是空的，H1／intro／
 * 六步流程等內容全部要等 client JS 執行才出現，跟 Phase 3A 修正前的
 * /resources、/news、/search 是同一類技術缺口。這裡驗證新增的 prerender
 * 腳本產生正確、且不含任何 runtime/private 資料的靜態片段，且透過
 * injectPrerenderedBody 正確接進 <div id="root">。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderUpgradeCenterContentHtml, validateUpgradeCenterContentHtml } from "../scripts/prerender-upgrade-center";
import { injectPrerenderedBody } from "./_core/prerenderedBody";
import { UPGRADE_CENTER_CONTENT } from "@shared/content/upgradeCenter";

const DIST_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head><title>x</title></head>
  <body><div id="root"></div></body>
</html>
`;

describe("renderUpgradeCenterContentHtml", () => {
  it("含 H1、核心 intro、各區塊標題與說明", () => {
    const html = renderUpgradeCenterContentHtml();
    expect(html).toContain(UPGRADE_CENTER_CONTENT.heroH1);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.heroIntro);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.whyMattersTitle);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.programsTitle);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.processTitle);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.supportTitle);
    expect(html).toContain(UPGRADE_CENTER_CONTENT.ctaTitle);
    for (const step of UPGRADE_CENTER_CONTENT.processSteps) {
      expect(html).toContain(step.title);
      expect(html).toContain(step.description);
    }
  });

  it("不含任何 runtime／private 資料：沒有即時統計數字、沒有實際政府補助方案清單、沒有使用者申請進度或案件資料字樣", () => {
    const html = renderUpgradeCenterContentHtml();
    // Hero 即時統計的固定標籤（若不小心被抓進來會出現這些字）——「送出申請」
    // 不列入這裡的檢查清單，因為它同時也是六步流程第 6 步的合法標題文字，
    // 兩者共用同一個詞語本身不代表洩漏了統計數字。
    expect(html).not.toContain("正式立案");
    expect(html).not.toContain("評估過件率");
    expect(html).not.toContain("累積補助金額");
    expect(html).not.toContain("已結案案件");
    expect(html).not.toContain("平台數據正式啟動後持續更新");
    // 「權限不足」／「申請進度查詢」兩個 Dialog 的文字
    expect(html).not.toContain("此功能僅提供 OXM 工廠會員");
    expect(html).not.toContain("顧問備註");
    expect(html).not.toContain("過案金額");
  });

  it("通過健檢（無 undefined／NaN）", () => {
    expect(validateUpgradeCenterContentHtml(renderUpgradeCenterContentHtml())).toEqual([]);
  });
});

describe("injectPrerenderedBody：/upgrade-center 片段正確接進 <div id=\"root\">（需要先跑過 pnpm build 產生 dist/prerendered/upgrade-center.html）", () => {
  const hasFile = fs.existsSync(path.join(DIST_DIR, "upgrade-center.html"));

  it.runIf(hasFile)("注入 data-oxm-prerendered=\"upgrade-center\"，含真實 H1", () => {
    const out = injectPrerenderedBody(BASE_HTML, "/upgrade-center");
    expect(out).not.toBeNull();
    expect(out).toContain('data-oxm-prerendered="upgrade-center"');
    expect(out).toContain(UPGRADE_CENTER_CONTENT.heroH1);
  });
});
