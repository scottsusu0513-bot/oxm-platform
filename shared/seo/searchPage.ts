// /search 的 SEO meta 產生邏輯，供 server（server/_core/vite.ts 的初始 HTML
// head 注入，讓「未執行 JS 的原始 HTML」就已經是正確結果，不必等 Googlebot
// 執行 client bundle 才看得到 noindex／canonical）與 client
// （client/src/pages/Search.tsx 的 react-helmet-async）共用同一份規則，
// 避免兩邊各自維護一份 title／noindex 公式、日後跑掉。
//
// 規則（見任務回報）：無參數 /search 可索引並自我 canonical；帶任何篩選
// 參數的 /search?... 一律 noindex,follow——篩選組合數量近乎無限，不能全部
// 放行索引，但頁面內部連結（工廠卡片、換頁等）仍要讓爬蟲能繼續走訪，所以
// 是 follow 不是 nofollow。刻意不把篩選網址 canonical 到 /industry/
// {slug}：篩選結果（地區、資本額、關鍵字組合）內容不等於產業頁，強行合併
// 會誤導索引。
import { BRAND } from "./brand";

export interface SearchPageMeta {
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
}

/**
 * queryString：不含開頭的 "?"（例如 "industry=%E9%87%91%E5%B1%AC..."），
 * 空字串代表無參數的 /search。呼叫端各自決定要傳入什麼字串來源——server
 * 端用請求當下 req.originalUrl 的原始 query（一律自我指向實際被請求的
 * 網址）；client 端（Search.tsx）用既有 buildParams() 依目前生效篩選條件
 * 正規化過的版本（不含 page 等純 UI 分頁狀態）。兩者不要求逐字元相同——
 * server 端初始值與 client 端 Helmet 掛載後的最終值本來就允許有這種
 * 「先給合理初始值、React 掛載後由 Helmet 覆蓋成最終正規化版本」的落差，
 * 與這個專案既有的 data-oxm-seo-transient 機制（見
 * server/_core/publicPageMeta.ts）完全一致，兩邊都必須各自自我 canonical
 * （不得导向其他頁面），這一點才是唯一不能妥協的規則。
 */
export function buildSearchPageMeta(queryString: string): SearchPageMeta {
  const params = new URLSearchParams(queryString);
  const industryValues = params.getAll("industry").filter(Boolean);
  const seoIndustry = industryValues.length > 0 ? industryValues[0] : null;

  const title = seoIndustry
    ? `${seoIndustry}｜台灣傳產供應商與工廠資源｜OXM`
    : "搜尋台灣傳產廠商與資源｜OXM";
  const description = seoIndustry
    ? `在 OXM 尋找台灣${seoIndustry}相關廠商與供應鏈資源，包含工廠、OEM/ODM 代工、材料、設備與產業服務，快速比較並送出詢價。`
    : "在 OXM 搜尋全台傳統產業廠商，涵蓋工廠、OEM/ODM 代工、工業設備、材料商、包裝印刷與設計工作室，可依產業、地區篩選，快速找到合適的合作對象。";

  const noindex = queryString.length > 0;
  const canonical = queryString.length > 0
    ? `${BRAND.url}/search?${queryString}`
    : `${BRAND.url}/search`;

  return { title, description, canonical, noindex };
}
