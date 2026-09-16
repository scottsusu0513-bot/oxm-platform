import { Helmet } from "react-helmet-async";
import { Fragment } from "react";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import NotFound from "./NotFound";
import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { buildRegionIndustryPageContent, type ResolvedRegionIndustry } from "@shared/seo/regionIndustryPages";
import { buildRegionSubIndustryPageContent, buildRegionSubIndustryBreadcrumbJsonLd, type ResolvedRegionSubIndustry } from "@shared/seo/subIndustryPages";
import { resolveFactoriesTwoSegment } from "@shared/seo/factoriesPathResolver";
import { toSafeJsonLdString } from "@shared/seo/schema";
import { FactoriesLandingResults } from "@/components/seo/FactoriesLandingResults";

// /factories/:region/:second — 縣市 × (主產業｜子產業) SEO Landing Page。
//
// 第二段 slug 可能是既有的主產業 slug，也可能是新增的子產業 slug——網址
// 結構完全相同，不能靠 path shape 判斷，統一交給 resolveFactoriesTwoSegment
// 決定性判斷（見 shared/seo/factoriesPathResolver.ts）。兩種 kind 共用同一支
// factory.search tRPC procedure 與同一份 FactoriesLandingResults 結果呈現，
// 但 Helmet meta／H1／intro／breadcrumb 各自獨立算。
//
// 刻意維持「主產業（kind === 'industry'）」分支的畫面輸出跟這輪修改前逐
// 像素相同（不加 breadcrumb UI、Helmet 內容公式不變）——這輪任務明確要求
// 「不能改壞地區 × 主產業既有頁面」，只有新增的「子產業（kind ===
// 'subIndustry'）」分支才顯示 breadcrumb（見任務定案「子產業頁至少需要
// breadcrumb」，沒有同樣要求既有主產業頁一定要加）。
//
// slug 無效（resolveFactoriesTwoSegment 回 null）一律走既有 NotFound（與
// NewsDetail.tsx／BlogPost.tsx 對無效 slug 的既有處理方式一致）；真正的
// HTTP 404 狀態碼由 server/_core/vite.ts 的 buildFactoriesTwoSegmentMeta 決定，
// 這裡的 <NotFound /> 只是 client-side 對應的畫面。
export default function RegionIndustryPage() {
  const [, params] = useRoute("/factories/:region/:industry");
  const regionSlug = params?.region ?? "";
  const secondSlug = params?.industry ?? "";

  const twoSegment = resolveFactoriesTwoSegment(regionSlug, secondSlug);

  if (!twoSegment) {
    return <NotFound />;
  }

  if (twoSegment.kind === "industry") {
    return <RegionIndustryContent resolved={twoSegment.resolved} />;
  }
  return <RegionSubIndustryContent resolved={twoSegment.resolved} />;
}

// ===== 地區 × 主產業（既有頁面，畫面輸出不變）=====

function RegionIndustryContent({ resolved }: { resolved: ResolvedRegionIndustry }) {
  const { data, isLoading } = trpc.factory.search.useQuery({
    industry: [resolved.industryName],
    region: [resolved.regionName],
    page: 1,
    pageSize: 20,
    sortBy: "rating",
  });

  const content = buildRegionIndustryPageContent(resolved);
  const factories = data?.items ?? [];
  const total = data?.total ?? 0;
  const noindex = total === 0;

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
      </Helmet>

      <Navbar />

      <div className="container py-6">
        <FloatingBackButton fallbackHref="/search" label="返回搜尋" />

        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-foreground mb-2">{content.h1}</h1>
          <p className="text-muted-foreground">{content.intro}</p>
        </div>

        <FactoriesLandingResults
          isLoading={isLoading}
          factories={factories}
          total={total}
          viewAllHref={`/search?industry=${encodeURIComponent(resolved.industryName)}&region=${encodeURIComponent(resolved.regionName)}`}
          viewAllLabel={`查看全部 ${total} 間${content.h1.replace(/廠$/, "")}工廠`}
        />
      </div>
    </div>
  );
}

// ===== 地區 × 子產業（新增）=====

function RegionSubIndustryContent({ resolved }: { resolved: ResolvedRegionSubIndustry }) {
  const { data, isLoading } = trpc.factory.search.useQuery({
    industry: [resolved.entry.parentIndustry],
    subIndustry: [resolved.entry.label],
    region: [resolved.regionName],
    page: 1,
    pageSize: 20,
    sortBy: "rating",
  });

  const content = buildRegionSubIndustryPageContent(resolved);
  const breadcrumbJsonLd = buildRegionSubIndustryBreadcrumbJsonLd(resolved);
  const factories = data?.items ?? [];
  const total = data?.total ?? 0;
  const noindex = total === 0;

  const parentIndustryHref = `/factories/${resolved.regionSlug}/${resolved.entry.parentIndustrySlug}`;
  const allTaiwanSubIndustryHref = `/factories/${resolved.subIndustrySlug}`;
  const searchHref = `/search?industry=${encodeURIComponent(resolved.entry.parentIndustry)}&subIndustry=${encodeURIComponent(resolved.entry.label)}&region=${encodeURIComponent(resolved.regionName)}`;

  const breadcrumbItems = [
    { name: "找工廠", path: "/search" },
    { name: `${resolved.displayRegionName}${resolved.entry.parentIndustry}廠`, path: parentIndustryHref },
    { name: content.h1, path: `/factories/${resolved.regionSlug}/${resolved.subIndustrySlug}` },
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
                  查看{resolved.displayRegionName}{resolved.entry.parentIndustry}廠
                </span>
              </Link>
              <span className="text-muted-foreground">・</span>
              <Link href={allTaiwanSubIndustryHref}>
                <span className="text-sm text-orange-600 hover:underline cursor-pointer">
                  查看全台{resolved.entry.displayName}廠
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
      </div>
    </div>
  );
}
