// /search 的可抓取語意殼單一資料來源：只有 H1（純文字版），供
// scripts/prerender-search.ts 產生 build-time 靜態片段使用。
//
// GEO Phase 3A 安全校準：原本這裡還有一句 intro，但那句話只會出現在
// build-time 預渲染片段、不存在於真正的 Search React DOM——正常使用者
// 頁面載入完成後（createRoot 整個換掉 #root）根本看不到這句話，等於只給
// 爬蟲／AI 看的額外文案，OXM 不採用這種「爬蟲看到的內容跟真人看到的內容
// 不一致」的 GEO 策略，因此直接移除，不留下 crawler-only 文案。如果之後
// 要在 /search 加入真人看得到的 intro，需要調整 Codex 既有版面/樣式，屬於
// 「Search visible GEO intro」，交給後續 Codex 階段評估、不在這裡自行加。
//
// 保留的 H1 則沒有這個問題：Search.tsx 畫面上本來就有同一句文字（sr-only，
// 螢幕閱讀器使用者讀得到，只是視覺上隱藏）——GEO Phase 4 把 Search.tsx 的
// 無篩選版 H1 也改成直接引用這裡的常數（原本是各自獨立維護的兩份字面量，
// 有可能日後改一邊漏改另一邊），現在是同一份資料，不是另外捏造的內容。
// 「{產業}工廠」這個有篩選時的動態版本則留在 Search.tsx 自己算（build-time
// 靜態片段無法得知請求時的 query string，固定用無篩選版本，不影響 <head>
// 內仍會依請求動態產生正確的 title／description——見 shared/seo/searchPage.ts）。
export const SEARCH_CONTENT = {
  heroH1: "台灣工廠搜尋",
};
