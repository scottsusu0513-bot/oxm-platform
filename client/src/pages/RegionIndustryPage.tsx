import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "./NotFound";
import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { resolveRegionIndustry, buildRegionIndustryPageContent } from "@shared/seo/regionIndustryPages";
import { Factory, Wrench, Star, MapPin, Search } from "lucide-react";

// /factories/:region/:industry — 縣市 × 主產業 SEO Landing Page。
//
// 刻意只重用既有 factory.search（與 Search.tsx／IndustryPage.tsx 同一支
// tRPC procedure），不複製 Search.tsx 的完整篩選器 UI；初始 query 固定為
// 這個路由對應的單一 region + 單一 industry，不提供使用者在頁面上更改
// 篩選條件（那是 /search 的職責，這裡是單一意圖的 SEO landing page）。
//
// slug 無效（resolveRegionIndustry 回 null）一律走既有 NotFound（與
// NewsDetail.tsx／BlogPost.tsx 對無效 slug 的既有處理方式一致）；真正的
// HTTP 404 狀態碼由 server/_core/vite.ts 的 buildRegionIndustryMeta 決定，
// 這裡的 <NotFound /> 只是 client-side 對應的畫面。
//
// noindex 邏輯：合法 region+industry 但目前查無 approved 公開工廠時
// （total === 0，包含資料尚未載入完成的預設狀態）維持 noindex——這是刻意
// 的 fail-safe 預設值，跟 server 端 buildRegionIndustryMeta 的邏輯一致，
// 避免在資料真正載入完成前，短暫地把 noindex 判斷錯誤地打開。
export default function RegionIndustryPage() {
  const [, params] = useRoute("/factories/:region/:industry");
  const regionSlug = params?.region ?? "";
  const industrySlug = params?.industry ?? "";

  const resolved = resolveRegionIndustry(regionSlug, industrySlug);

  const { data, isLoading } = trpc.factory.search.useQuery(
    {
      industry: resolved ? [resolved.industryName] : undefined,
      region: resolved ? [resolved.regionName] : undefined,
      page: 1,
      pageSize: 20,
      sortBy: "rating",
    },
    { enabled: !!resolved }
  );

  if (!resolved) {
    return <NotFound />;
  }

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

        {/* 頁首：可見 H1 + 短 intro（與 server 端動態注入初始 HTML 的
            <div id="root"> 語意殼文字完全一致，避免爬蟲／使用者語意不一致） */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-foreground mb-2">{content.h1}</h1>
          <p className="text-muted-foreground">{content.intro}</p>
        </div>

        {/* 工廠列表 */}
        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-32" /></CardContent></Card>
            ))}
          </div>
        ) : factories.length === 0 ? (
          <Card className="mb-8">
            <CardContent className="p-12 text-center text-muted-foreground">
              <Factory className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>目前尚無符合條件的公開工廠</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {factories.map((factory) => (
              <Link key={factory.id} href={`/factory/${factory.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full overflow-hidden">
                  <div className="relative h-32 bg-gradient-to-br from-orange-100 to-amber-50 overflow-hidden">
                    {(factory as any).avatarUrl ? (
                      <img
                        src={(factory as any).avatarUrl}
                        alt={factory.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {(factory as any).businessType === "studio"
                          ? <Wrench className="w-12 h-12 text-purple-200" />
                          : <Factory className="w-12 h-12 text-orange-200" />}
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <h2 className="font-semibold text-base mb-1 line-clamp-1">{factory.name}</h2>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {((factory as any).industry as string[] | null)?.map(ind => (
                        <Badge key={ind} variant="outline" className="text-xs">{ind}</Badge>
                      ))}
                      {(factory.mfgModes as string[]).map(m => (
                        <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{factory.region}</span>
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-500" />
                        {Number(factory.avgRating).toFixed(1)}（{factory.reviewCount}）
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* 查看更多：超過單頁 20 筆時導去既有 Search（不在這個 SEO 頁面上
            自建分頁控制項，維持這頁只做「單一意圖 landing page」的最小範圍）。 */}
        {total > 20 && (
          <div className="text-center mb-10">
            <Link href={`/search?industry=${encodeURIComponent(resolved.industryName)}&region=${encodeURIComponent(resolved.regionName)}`}>
              <Button variant="outline" className="gap-2">
                <Search className="w-4 h-4" />查看全部 {total} 間{content.h1.replace(/廠$/, "")}工廠
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
