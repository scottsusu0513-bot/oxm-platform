// /news（找消息列表）正文的單一資料來源：只抽出需要被 build-time 預渲染
// 腳本（scripts/prerender-news.ts）共用的固定文字——H1 與固定分類標籤。
// title/description 已經有 shared/seo/publicPages.ts 的 PUBLIC_PAGE_SEO.news
// 可以共用，這裡不重複定義。
//
// 不放實際消息列表——找消息本身是資料庫驅動的動態內容，prerender 只做
// 「沒有消息資料時仍可讀到的固定語意殼」，不把任何一篇消息寫死進 build
// 產物，也不在 build time 連線 production DB。
//
// 分類標籤（重要/競賽/展覽/跨產業）與各產業名稱在畫面上是「切換分類」的
// 互動按鈕（client state，不是可各自導覽的 <a href>），這裡只收錄純文字
// 標籤本身，不假造這些分類各自的網址。
//
// GEO Phase 4 Audit 註記（已知、低風險的內容複本，故意不 refactor）：
// heroH1 已經是 News.tsx 唯一的來源（News.tsx 直接 import 這個常數）。但
// fixedCategories 目前沒有反向被 News.tsx import——News.tsx 桌面版
// FIXED_CATEGORIES 與手機版 MOBILE_TABS 各自有一份標籤（且兩邊文字長度不同，
// 例如桌面「重要消息」、手機「重要」），這裡的陣列只是取桌面版那份純文字
// 抄一份給 prerender 用。之所以沒有進一步 refactor 成三邊共用同一份，是
// 因為 FIXED_CATEGORIES／MOBILE_TABS 還各自帶著 icon／value／聚合邏輯，
// 硬要合併需要調整 News.tsx 既有的兩組陣列結構，風險與效益不成比例（這五個
// 中文標籤字面上基本不會變動）。如果之後 News.tsx 的分類標籤文字有實質異動，
// 記得回來同步更新這裡。
export const NEWS_CONTENT = {
  heroH1: "OXM，給你傳產需要的第一手消息",
  fixedCategories: ["全部最新", "重要消息", "競賽消息", "展覽消息", "跨產業資訊"],
};
