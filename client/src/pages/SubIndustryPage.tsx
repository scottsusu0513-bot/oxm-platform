import { Helmet } from "react-helmet-async";
import { Fragment } from "react";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import NotFound from "./NotFound";
import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { resolveSubIndustry, buildSubIndustryPageContent, buildSubIndustryBreadcrumbJsonLd } from "@shared/seo/subIndustryPages";
import { toSafeJsonLdString } from "@shared/seo/schema";
import { FactoriesLandingResults } from "@/components/seo/FactoriesLandingResults";
import { NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT } from "@shared/constants";

// /factories/:subIndustrySlug — 全台子產業 SEO Landing Page（不含地區維度）。
//
// 跟 RegionIndustryPage.tsx 是同一種角色分工：只重用既有 factory.search
// tRPC procedure 與抽出來的 FactoriesLandingResults 結果呈現，不複製一份
// 完整篩選器 UI；初始 query 固定為這個路由對應的單一子產業（連同其所屬主
// 產業一起帶進 factory.search，避免只帶 subIndustry 造成語意不完整），
// 不提供使用者在頁面上更改篩選條件。
//
// slug 無效（resolveSubIndustry 回 null）一律走既有 NotFound；真正的 HTTP
// 404 狀態碼由 server/_core/vite.ts 的 buildSubIndustryMeta 決定，這裡的
// <NotFound /> 只是 client-side 對應的畫面。
//
// noindex 邏輯：合法子產業但目前查無 approved 公開工廠時（total === 0，
// 包含資料尚未載入完成的預設狀態）維持 noindex——跟 RegionIndustryPage.tsx
// 的既有 fail-safe 預設值完全一致。
export default function SubIndustryPage() {
  const [, params] = useRoute("/factories/:slug");
  const subIndustrySlug = params?.slug ?? "";

  const resolved = resolveSubIndustry(subIndustrySlug);

  if (!resolved) {
    return <NotFound />;
  }

  return <SubIndustryContent resolved={resolved} />;
}

function SubIndustryContent({ resolved }: { resolved: NonNullable<ReturnType<typeof resolveSubIndustry>> }) {
  const { data, isLoading } = trpc.factory.search.useQuery({
    industry: [resolved.entry.parentIndustry],
    subIndustry: [resolved.entry.label],
    page: 1,
    pageSize: 20,
    sortBy: "rating",
  });

  const content = buildSubIndustryPageContent(resolved);
  const breadcrumbJsonLd = buildSubIndustryBreadcrumbJsonLd(resolved);
  const factories = data?.items ?? [];
  const total = data?.total ?? 0;
  const noindex = total === 0;

  // 舊 /industry/:industry/:subIndustry（Phase 1）頁本來就有的 SEO 長文內容
  // （intro／applications／howToChoose），301 轉址過來後不能讓這些內容消失
  // ——直接 reuse 既有 SUB_INDUSTRY_SEO_CONTENT（透過
  // NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT 這個純推導、不複製文案的
  // 反查表），只有原本就有 Phase 1 內容的 13 個子產業才會查到，其餘子產業
  // 這裡是 undefined，畫面行為維持現狀（見任務定案「若該新子產業沒有舊
  // SUB_INDUSTRY_SEO_CONTENT：維持現在的新頁行為即可」）。title／
  // description／H1／上面的 content.intro 完全不受影響，這段只是在工廠
  // 結果列表之後、作為補充資訊。
  const legacySeoContent = NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT[resolved.subIndustrySlug];

  const parentIndustryHref = `/industry/${resolved.entry.parentIndustrySlug}`;
  const searchHref = `/search?industry=${encodeURIComponent(resolved.entry.parentIndustry)}&subIndustry=${encodeURIComponent(resolved.entry.label)}`;

  const breadcrumbItems = [
    { name: "找工廠", path: "/search" },
    { name: resolved.entry.parentIndustry, path: parentIndustryHref },
    { name: content.h1, path: `/factories/${resolved.subIndustrySlug}` },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{content.title}</title>
        <meta name="description" content={content.description} />
        <link rel="canonical" href={content.canonical} />
        {noindex && <meta name="robots" content="noindex,follow" />}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={content.canonical} />
        <meta property="og:title" content={content.title} />
        <meta property="og:description" content={content.description} />
        <meta property="og:image" content="https://www.oxmmatch.com/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="OXM 台灣傳統產業資源媒合平台" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={content.title} />
        <meta name="twitter:description" content={content.description} />
        <meta name="twitter:image" content="https://www.oxmmatch.com/og-image.png" />
        <meta name="twitter:image:alt" content="OXM 台灣傳統產業資源媒合平台" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": content.title,
          "description": content.description,
          "url": content.canonical,
          "isPartOf": {
            "@type": "WebSite",
            "name": "OXM",
            "url": "https://www.oxmmatch.com",
            "description": "台灣傳統產業資源媒合平台"
          },
          ...(factories.length > 0 && {
            "mainEntity": {
              "@type": "ItemList",
              "name": `${content.h1}列表`,
              "numberOfItems": total,
              "itemListElement": factories.map((f, i) => ({
                "@type": "ListItem",
                "position": i + 1,
                "url": `https://www.oxmmatch.com/factory/${f.id}`,
                "name": f.name,
              }))
            }
          })
        })}</script>
        <script type="application/ld+json">{toSafeJsonLdString(breadcrumbJsonLd)}</script>
      </Helmet>

      <Navbar />

      <div className="container py-6">
        <FloatingBackButton fallbackHref="/search" label="返回搜尋" />

        <Breadcrumb className="mb-4">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href="/">OXM</Link></BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbItems.map((item, i) => (
              <Fragment key={item.path}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {i === breadcrumbItems.length - 1
                    ? <BreadcrumbPage>{item.name}</BreadcrumbPage>
                    : <BreadcrumbLink asChild><Link href={item.path}>{item.name}</Link></BreadcrumbLink>}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-foreground mb-2">{content.h1}</h1>
          <p className="text-muted-foreground">{content.intro}</p>
        </div>

        <FactoriesLandingResults
          isLoading={isLoading}
          factories={factories}
          total={total}
          viewAllHref={searchHref}
          viewAllLabel={`查看全部 ${total} 間${content.h1.replace(/廠$/, "")}工廠`}
          emptyStateExtra={
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href={parentIndustryHref}>
                <span className="text-sm text-orange-600 hover:underline cursor-pointer">
                  查看{resolved.entry.parentIndustry}廠
                </span>
              </Link>
              <span className="text-muted-foreground">・</span>
              <Link href="/search">
                <span className="text-sm text-orange-600 hover:underline cursor-pointer">
                  調整搜尋條件
                </span>
              </Link>
            </div>
          }
        />

        {/* 舊 Phase 1 子產業頁的 SEO 內容區塊，reuse 既有 SUB_INDUSTRY_SEO_CONTENT
            （見上方 legacySeoContent 說明）。樣式沿用 IndustryPage.tsx 既有的
            「關於{industry}代工」區塊，位置在工廠結果列表之後，作為補充資訊，
            不影響上面的 title／description／H1／intro。 */}
        {legacySeoContent && (
          <section className="border-t border-border pt-10 pb-6 space-y-6">
            <h2 className="text-xl font-bold text-foreground">關於{resolved.entry.parentIndustry}代工</h2>
            <div className="grid md:grid-cols-3 gap-6 text-sm text-muted-foreground leading-relaxed">
              <div>
                <h3 className="font-semibold text-foreground mb-2">什麼是{resolved.entry.parentIndustry}代工</h3>
                <p>{legacySeoContent.intro}</p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">常見應用</h3>
                <p>{legacySeoContent.applications}</p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">如何選擇工廠</h3>
                <p>{legacySeoContent.howToChoose}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
