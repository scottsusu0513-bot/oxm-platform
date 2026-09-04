/**
 * ERP 與產線優化專區（/erp-optimization）— 靜態原始碼契約測試。
 *
 * 與 /certification-center（見 server/certificationCenterNoPublicEntry.test.ts）
 * 完全同一套慣例：Final Public Index Release 已從「隱藏預覽頁」正式轉為
 * 公開索引的服務 Landing Page，加入 sitemap，移除 X-Robots-Tag noindex。
 * OXM Navbar Dropdown — Public Service Entries Fix（本輪）：Navbar 的
 * 「找資源」下拉選單已同步補上這個服務的直達連結（見
 * server/navbarPublicServiceDropdown.test.ts 的完整覆蓋），首頁／Footer／
 * APP 底部導覽的主要導覽仍維持不變，本輪只動 Navbar。這裡一樣用純靜態原始
 * 碼字串比對（readFileSync + 字串比對）。
 *
 * 同時確認：路由本身確實存在（能被直接輸入網址開啟）、頁面內容把 ERP／MES／
 * 產線改善分開描述（不是同一套服務）、清楚區分免費與正式付費範圍、不含固定
 * 成效百分比或保證性承諾、不顯示競爭者名稱或產品名稱、CTA 只開啟預覽提示
 * （不建立案件、不呼叫任何寫入 API）、noindex 只精準套用在
 * /erp-optimization/apply 申請表單。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("/erp-optimization：Navbar 找資源下拉已有直達連結，其餘主要導覽仍維持 hub-and-spoke", () => {
  it("client/src/components/Navbar.tsx 找資源下拉選單有 erp-optimization 的直達連結（OXM Navbar Dropdown — Public Service Entries Fix）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    const resourceBlock = source.match(/key: "resource"[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(resourceBlock).toMatch(/href: "\/erp-optimization"/);
  });

  it("client/src/pages/Home.tsx（含首頁 Footer）沒有任何 erp-optimization 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Home.tsx");
    expect(source).not.toMatch(/erp-optimization/i);
  });

  it("client/src/components/AppBottomNav.tsx（APP 底部導覽）沒有任何 erp-optimization 連結或字樣", () => {
    const source = readSource("client", "src", "components", "AppBottomNav.tsx");
    expect(source).not.toMatch(/erp-optimization/i);
  });

  it("client/src/pages/Search.tsx（工廠搜尋／相關服務推薦）沒有任何 erp-optimization 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Search.tsx");
    expect(source).not.toMatch(/erp-optimization/i);
  });

  it("client/src/pages/Announcements.tsx（公告頁）沒有任何 erp-optimization 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Announcements.tsx");
    expect(source).not.toMatch(/erp-optimization/i);
  });

  it("client/src/pages/CertificationCenter.tsx（另一個隱藏預覽專區）沒有任何 erp-optimization 連結或字樣，兩個專區互不導流", () => {
    const source = readSource("client", "src", "pages", "CertificationCenter.tsx");
    expect(source).not.toMatch(/erp-optimization/i);
  });

  it("client/src/pages/ErpOptimization.tsx 沒有連回 /certification-center，兩個專區互不導流", () => {
    const source = readSource("client", "src", "pages", "ErpOptimization.tsx");
    expect(source).not.toMatch(/certification-center/i);
  });
});

describe("/erp-optimization 正式加入 sitemap（Final Public Index Release），但仍不在 prerender 清單中", () => {
  it("server/_core/index.ts 的 sitemap.xml 產生邏輯含 /erp-optimization，但不含 /erp-optimization/apply", () => {
    const source = readSource("server", "_core", "index.ts");
    const sitemapMatch = source.match(/app\.get\("\/sitemap\.xml"[\s\S]*?\n {2}\}\);/);
    const sitemapSource = sitemapMatch ? sitemapMatch[0] : "";
    expect(sitemapSource).toMatch(/\$\{BASE\}\/erp-optimization/);
    expect(sitemapSource).not.toMatch(/erp-optimization\/apply/);
  });

  it("server/_core/prerenderedBody.ts 的 PRERENDERED_PAGES 清單沒有 /erp-optimization（本輪未新增 build-time prerender）", () => {
    const source = readSource("server", "_core", "prerenderedBody.ts");
    expect(source).not.toMatch(/erp-optimization/i);
  });
});

describe("/erp-optimization 與 /erp-optimization/apply 路由本身確實存在（可直接輸入網址開啟）", () => {
  it("client/src/App.tsx 有註冊兩個路由", () => {
    const source = readSource("client", "src", "App.tsx");
    expect(source).toMatch(/path="\/erp-optimization\/apply"/);
    expect(source).toMatch(/path="\/erp-optimization"/);
    expect(source).toMatch(/path="\/erp-consultant\/cases"/);
  });
});

describe("noindex／X-Robots-Tag 只套用在 /erp-optimization/apply 申請表單，不影響 Landing Page 或其他頁面", () => {
  it("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 包含 /erp-optimization/apply 與 /certification-center/apply，但不含 Landing Page 本身", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match).toBeTruthy();
    const listed = match![1];
    const stringLiterals = listed.match(/"[^"]*"/g) ?? [];
    expect(stringLiterals).toContain('"/certification-center/apply"');
    expect(stringLiterals).toContain('"/erp-optimization/apply"');
    expect(stringLiterals).not.toContain('"/certification-center"');
    expect(stringLiterals).not.toContain('"/erp-optimization"');
    // 需登入的顧問看板不算公開隱藏預覽頁，同 /finance-consultant/cases 慣例，不應列入。
    expect(stringLiterals).not.toContain('"/erp-consultant/cases"');
  });

  it("server/_core/security.ts 沒有把 noindex 套用到整個網站（沒有 \"/\" 這種會匹配全站的萬用路徑）", () => {
    const source = readSource("server", "_core", "security.ts");
    expect(source).not.toMatch(/NOINDEX_EXACT_PATHS[\s\S]{0,200}"\/"/);
  });

  it("client/src/pages/ErpOptimizationApply.tsx 有完整的 meta robots 限制", () => {
    const source = readSource("client", "src", "pages", "ErpOptimizationApply.tsx");
    expect(source).toMatch(/noindex, nofollow, noarchive, nosnippet/);
  });

  it("client/src/pages/ErpOptimization.tsx（Landing Page 本身）已不再有 meta robots noindex 限制", () => {
    const source = readSource("client", "src", "pages", "ErpOptimization.tsx");
    expect(source).not.toMatch(/<meta name="robots"/);
  });
});

describe("/erp-optimization 頁面內容定位：先診斷、再選方案，三路分流", () => {
  const source = readSource("client", "src", "pages", "ErpOptimization.tsx");

  it("包含 ERP 導入、產線與動線優化、整合改善三條需求路徑", () => {
    expect(source).toMatch(/ERP 導入/);
    expect(source).toMatch(/產線與動線優化/);
    expect(source).toMatch(/整合改善/);
  });

  it("清楚分開 ERP、MES 與產線改善為不同服務描述（比較區塊分別列出三者）", () => {
    expect(source).toMatch(/MES／現場報工/);
    expect(source).toMatch(/企業資源與跨部門資訊/);
    expect(source).toMatch(/生產執行與現場資訊/);
    expect(source).toMatch(/實體製程、動線與作業方法/);
    // 明確聲明三者可整合但不是同一套服務，避免暗示成單一套裝
    expect(source).toMatch(/不是同一套服務/);
  });

  it("仍保留「初步諮詢免費」，但不再公開列出免費範圍說明區塊的詳細項目", () => {
    expect(source).toMatch(/初步諮詢免費/);
    // 免費範圍說明整個區塊（標題與兩張明細卡片）已依需求完整移除，不得把
    // 明細搬到其他區塊或另建免費／付費比較區。
    expect(source).not.toMatch(/免費範圍說明/);
    expect(source).not.toMatch(/免費包含/);
    expect(source).not.toMatch(/需另行確認方案與報價/);
  });

  it("不含固定成效百分比或保證性承諾", () => {
    // 不應出現百分比數字（避免固定成效宣稱）
    expect(source).not.toMatch(/\d+%/);
    // 排除「不保證…」這種必要的免責聲明本身，只擋沒有「不」開頭的正面保證宣稱。
    expect(source).not.toMatch(/(?<!不)保證(提升|降低|節省|取得|通過)/);
    expect(source).not.toMatch(/(?<!不)一定(提升|降低|節省|取得|通過)/);
  });

  it("不再出現「OXM 不保證取得政府補助」或意思完全相同的文字", () => {
    expect(source).not.toMatch(/不保證取得政府補助/);
  });

  it("正式服務流程不再使用左右拉開的長橫線版面（沒有 flex-1 加 h-px 的橫線元素）", () => {
    expect(source).not.toMatch(/flex-1 h-px bg-border/);
  });

  it("不顯示競爭者名稱、產品名稱或 Logo", () => {
    expect(source).not.toMatch(/鼎新|資通電腦|鼎華智能|台塑網|Oracle|SAP|ciMes|用友|鼎捷/i);
  });

  it("包含至少 10 題 FAQ", () => {
    const match = source.match(/const FAQ_ITEMS[\s\S]*?=\s*\[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const qCount = (match![1].match(/q:/g) ?? []).length;
    expect(qCount).toBeGreaterThanOrEqual(10);
  });
});

describe("/erp-optimization CTA 導向正式申請表單 /erp-optimization/apply（本輪已補齊申請流程，內容頁本身仍不直接呼叫寫入 API）", () => {
  const source = readSource("client", "src", "pages", "ErpOptimization.tsx");

  it("內容頁本身沒有呼叫任何 trpc mutation（不建立案件、不寫入資料庫；申請動作交給 /apply 頁）", () => {
    expect(source).not.toMatch(/\.useMutation\(/);
    expect(source).not.toMatch(/trpc\./);
  });

  it("CTA 一律呼叫 openConsultPreview，內部導向 /erp-optimization/apply", () => {
    expect(source).toMatch(/openConsultPreview\s*=\s*\(\)\s*=>\s*navigate\("\/erp-optimization\/apply"\)/);
    // 首屏、三條路徑下方共同入口、最終 CTA，剛好 3 個（三張需求卡片本身
    // 沒有各自的按鈕，不應再重新出現第 4、第 5 個 CTA）。
    const ctaCallCount = (source.match(/onClick=\{openConsultPreview\}/g) ?? []).length;
    expect(ctaCallCount).toBe(3);
  });

  it("三張需求路徑卡片內不再各自出現諮詢按鈕（NEED_PATHS 卡片區塊沒有 Button）", () => {
    // Card／CardContent 是元件標籤（非原生 <div>），所以從 NEED_PATHS.map 開始
    // 找到第一個原生 </div>，就剛好是卡片外層 grid wrapper 的收尾，涵蓋整個
    // 卡片渲染區塊但不會不小心吃到後面共同 CTA 區塊的內容。
    const cardsBlockMatch = source.match(/\{NEED_PATHS\.map[\s\S]*?<\/div>/);
    expect(cardsBlockMatch).toBeTruthy();
    expect(cardsBlockMatch![0]).not.toMatch(/<Button/);
    expect(cardsBlockMatch![0]).not.toMatch(/免費初步諮詢/);
  });

  it("三張卡片下方只有一個共同諮詢入口，說明文字與按鈕都存在", () => {
    expect(source).toMatch(/不確定適合哪一種改善方向？也可以直接提出需求，由顧問協助判斷。/);
  });

  it("內容頁本身不要求登入（登入與工廠資格檢查在 /erp-optimization/apply 頁進行）", () => {
    expect(source).not.toMatch(/useAuth|requireAuth|redirectToLogin/i);
  });
});

describe("/erp-optimization/apply 申請表單：需登入、需合格工廠資格、需求類型單選、公司資料不可修改", () => {
  const source = readSource("client", "src", "pages", "ErpOptimizationApply.tsx");

  it("要求登入（有 useAuth 與登入 gate）", () => {
    expect(source).toMatch(/useAuth/);
    expect(source).toMatch(/請先登入/);
  });

  it("要求工廠通過審核（approved）才能申請", () => {
    expect(source).toMatch(/status === "approved"/);
  });

  it("公司名稱與地址欄位為 readOnly，不可修改", () => {
    const fieldsetMatch = source.match(/公司資料（由 OXM 工廠資料帶入，不可修改）[\s\S]*?<\/fieldset>/);
    expect(fieldsetMatch).toBeTruthy();
    const readOnlyCount = (fieldsetMatch![0].match(/readOnly/g) ?? []).length;
    expect(readOnlyCount).toBe(2);
  });

  it("需求類型為單選 RadioGroup，四個選項（ERP 導入／產線動線優化／整合改善／不確定）", () => {
    expect(source).toMatch(/<RadioGroup/);
    expect(source).toMatch(/ERP_NEED_TYPES\.map/);
  });

  it("呼叫 trpc.erpOptimization.submitApplication 送出申請", () => {
    expect(source).toMatch(/trpc\.erpOptimization\.submitApplication\.useMutation/);
  });
});
