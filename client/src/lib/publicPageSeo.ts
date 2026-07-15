// 固定公開頁 SEO 設定的實際定義已移至 shared/seo/publicPages.ts，讓 server
// 端也能引用同一份資料（初始 HTML head 注入），避免 client／server 產生
// 互相矛盾的 title／description／canonical。
export { PUBLIC_PAGE_SEO, getPublicPageSeoByPath } from "@shared/seo/publicPages";
export type { PublicPageSeo, PublicPageKey } from "@shared/seo/publicPages";
