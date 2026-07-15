// 品牌常數的實際定義已移至 shared/seo/brand.ts，讓 server 端也能引用同一份
// 資料（初始 HTML head 注入）。這裡保留 re-export，既有的 @/lib/brand
// import 寫法不需要跟著改。
export { BRAND } from "@shared/seo/brand";
export type { Brand } from "@shared/seo/brand";
