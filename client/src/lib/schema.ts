// Schema 產生器的實際定義已移至 shared/seo/schema.ts，讓 server 端也能引用
// 同一份定義（初始 HTML head 注入），避免 client／server 產生互相矛盾的
// JSON-LD。這裡保留 re-export，既有的 @/lib/schema import 寫法不需要跟著改。
export {
  ORGANIZATION_ID,
  WEBSITE_ID,
  ABOUT_PAGE_ID,
  getOrganizationSchema,
  getWebsiteSchema,
  getAboutPageSchema,
  getAboutBreadcrumbSchema,
  toSafeJsonLdString,
} from "@shared/seo/schema";
export type { JsonLdObject } from "@shared/seo/schema";
