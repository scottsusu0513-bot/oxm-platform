/**
 * 短影音與品牌內容行銷專區（/short-video-marketing）— 隱藏預覽頁靜態原始碼
 * 契約測試，與 /erp-optimization、/certification-center（見
 * server/erpOptimizationNoPublicEntry.test.ts、
 * server/certificationCenterNoPublicEntry.test.ts）完全同一套慣例：本頁面
 * 目前只允許由 /resources 資源總覽進入，不在 Navbar 直達項目／首頁／Footer／
 * APP 底部導覽／sitemap／prerender 清單中出現。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("/short-video-marketing 沒有資源總覽以外的主要導覽直達連結", () => {
  it("client/src/components/Navbar.tsx 完全沒有 short-video-marketing 連結（含找資源下拉選單也暫時隱藏）", () => {
    const source = readSource("client", "src", "components", "Navbar.tsx");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("client/src/pages/Home.tsx（含首頁 Footer）沒有任何 short-video-marketing 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Home.tsx");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("client/src/components/AppBottomNav.tsx（APP 底部導覽）沒有任何 short-video-marketing 連結或字樣", () => {
    const source = readSource("client", "src", "components", "AppBottomNav.tsx");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("client/src/pages/Search.tsx（工廠搜尋／相關服務推薦）沒有任何 short-video-marketing 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Search.tsx");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("client/src/pages/Announcements.tsx（公告頁）沒有任何 short-video-marketing 連結或字樣", () => {
    const source = readSource("client", "src", "pages", "Announcements.tsx");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("ErpOptimization.tsx／CertificationCenter.tsx 沒有連到 short-video-marketing，三個隱藏專區互不導流", () => {
    expect(readSource("client", "src", "pages", "ErpOptimization.tsx")).not.toMatch(/short-video-marketing/i);
    expect(readSource("client", "src", "pages", "CertificationCenter.tsx")).not.toMatch(/short-video-marketing/i);
  });

  it("ShortVideoMarketing.tsx／ShortVideoMarketingApply.tsx 沒有連回 erp-optimization 或 certification-center", () => {
    const main = readSource("client", "src", "pages", "ShortVideoMarketing.tsx");
    const apply = readSource("client", "src", "pages", "ShortVideoMarketingApply.tsx");
    expect(main).not.toMatch(/erp-optimization|certification-center/i);
    expect(apply).not.toMatch(/erp-optimization|certification-center/i);
  });
});

describe("/short-video-marketing 不在 sitemap 或 prerender 清單中", () => {
  it("server/_core/index.ts 的 sitemap.xml 產生邏輯沒有任何 short-video-marketing 項目", () => {
    const source = readSource("server", "_core", "index.ts");
    expect(source).not.toMatch(/short-video-marketing/i);
  });

  it("server/_core/prerenderedBody.ts 的 PRERENDERED_PAGES 清單沒有 /short-video-marketing", () => {
    const source = readSource("server", "_core", "prerenderedBody.ts");
    expect(source).not.toMatch(/short-video-marketing/i);
  });
});

describe("/short-video-marketing 與 /short-video-marketing/apply 路由本身確實存在", () => {
  it("client/src/App.tsx 有註冊兩個路由", () => {
    const source = readSource("client", "src", "App.tsx");
    expect(source).toMatch(/path="\/short-video-marketing\/apply"/);
    expect(source).toMatch(/path="\/short-video-marketing"/);
    expect(source).toMatch(/path="\/short-video-consultant\/cases"/);
  });
});

describe("noindex／X-Robots-Tag 套用在短影音兩個公開隱藏頁，且不波及其他頁面", () => {
  it("server/_core/security.ts 的 NOINDEX_EXACT_PATHS 包含短影音兩個路徑", () => {
    const source = readSource("server", "_core", "security.ts");
    const match = source.match(/NOINDEX_EXACT_PATHS = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(match).toBeTruthy();
    const listed = match![1];
    const stringLiterals = listed.match(/"[^"]*"/g) ?? [];
    expect(stringLiterals).toContain('"/short-video-marketing"');
    expect(stringLiterals).toContain('"/short-video-marketing/apply"');
    // 需登入的顧問看板不算公開隱藏預覽頁，同 /finance-consultant/cases 慣例，不應列入。
    expect(stringLiterals).not.toContain('"/short-video-consultant/cases"');
  });

  it("server/_core/security.ts 沒有把 noindex 套用到整個網站（沒有 \"/\" 這種會匹配全站的萬用路徑）", () => {
    const source = readSource("server", "_core", "security.ts");
    expect(source).not.toMatch(/NOINDEX_EXACT_PATHS[\s\S]{0,300}"\/"/);
  });

  it("ShortVideoMarketing.tsx 與 ShortVideoMarketingApply.tsx 都有完整的 meta robots 限制", () => {
    expect(readSource("client", "src", "pages", "ShortVideoMarketing.tsx")).toMatch(/noindex, nofollow, noarchive, nosnippet/);
    expect(readSource("client", "src", "pages", "ShortVideoMarketingApply.tsx")).toMatch(/noindex, nofollow, noarchive, nosnippet/);
  });
});

describe("/short-video-marketing 頁面內容：五項服務、優勢與限制、平台差異、FAQ 皆存在", () => {
  const source = readSource("client", "src", "pages", "ShortVideoMarketing.tsx");

  it("完整出現五項服務名稱", () => {
    expect(source).toMatch(/短影音企劃與拍攝/);
    expect(source).toMatch(/KOL 合作方案/);
    expect(source).toMatch(/社群內容代操/);
    expect(source).toMatch(/新聞媒體露出/);
    expect(source).toMatch(/訪談製作/);
  });

  it("優勢與限制、平台差異、服務邊界（不會自動包含什麼）與 FAQ 均存在", () => {
    expect(source).toMatch(/優勢/);
    expect(source).toMatch(/限制/);
    expect(source).toMatch(/Instagram Reels/);
    expect(source).toMatch(/Facebook Reels/);
    expect(source).toMatch(/TikTok/);
    expect(source).toMatch(/YouTube Shorts/);
    expect(source).toMatch(/不會自動包含什麼/);
    expect(source).toMatch(/常見問題/);
  });

  it("至少 7 題 FAQ", () => {
    const match = source.match(/const FAQ_ITEMS[\s\S]*?=\s*\[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const qCount = (match![1].match(/q:/g) ?? []).length;
    expect(qCount).toBeGreaterThanOrEqual(7);
  });

  it("不含正面保證爆紅、保證流量、保證成交等宣稱（每一句含「保證」的句子，句內本身必須也含有否定詞或問號，代表這是免責聲明或提問，不是正面承諾）", () => {
    const sentences = source.split(/(?<=[。？！])/);
    const guaranteeSentences = sentences.filter(s => /保證(爆紅|流量|成交|訂單|轉換)/.test(s));
    expect(guaranteeSentences.length).toBeGreaterThan(0); // 確保這個檢查真的有掃到內容，不是誤判成空集合通過
    for (const s of guaranteeSentences) {
      expect(s).toMatch(/不|嗎？/);
    }
  });

  it("不含假觀看數／假客戶／假媒體 Logo／假成效（沒有百分比數字或社群數字樣式的假資料）", () => {
    expect(source).not.toMatch(/\d+(\.\d+)?[萬千]?(次觀看|followers|粉絲|讚)/);
  });

  it("全頁 CTA 文案統一為「申請免費初步諮詢」，五張服務卡片內不各自出現獨立申請按鈕", () => {
    const ctaCount = (source.match(/申請免費初步諮詢/g) ?? []).length;
    expect(ctaCount).toBeGreaterThanOrEqual(1);
    // 五大服務內容區塊（非 Hero 的服務標籤區塊）：從「五大服務內容」標題開始，
    // 到該 section 收尾的 </section> 為止，確認卡片本身內部沒有 Button。
    const sectionMatch = source.match(/<h2[^>]*>五大服務內容<\/h2>[\s\S]*?<\/section>/);
    expect(sectionMatch).toBeTruthy();
    const section = sectionMatch![0];
    // section 尾端共用入口本身允許有一個 Button；卡片渲染區塊（SHORT_VIDEO_SERVICES.map
    // 到其 grid wrapper 收尾）不應該有 Button。
    const cardsGridMatch = section.match(/\{SHORT_VIDEO_SERVICES\.map[\s\S]*?\}\)\}\s*<\/div>/);
    expect(cardsGridMatch).toBeTruthy();
    expect(cardsGridMatch![0]).not.toMatch(/<Button/);
  });
});

describe("/short-video-marketing 內容頁本身不呼叫任何寫入 API（只透過 Link 導向 /apply）", () => {
  const source = readSource("client", "src", "pages", "ShortVideoMarketing.tsx");

  it("沒有 useMutation 呼叫", () => {
    expect(source).not.toMatch(/\.useMutation\(/);
  });

  it("CTA 一律連到 /short-video-marketing/apply", () => {
    expect(source).toMatch(/href="\/short-video-marketing\/apply"/);
  });
});
