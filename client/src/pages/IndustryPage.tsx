import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useRoute, useLocation, Link } from "wouter";
import { INDUSTRY_SLUG_TO_NAMES, INDUSTRY_SLUG_TO_NAME, INDUSTRY_SEO_CONTENT, INDUSTRY_SLUGS, SUB_INDUSTRY_SLUG_TO_NAME, SUB_INDUSTRY_SEO_CONTENT } from "@shared/constants";
import { ChevronLeft, Factory, Wrench, Star, MapPin, Search } from "lucide-react";

export default function IndustryPage() {
  const [, baseParams] = useRoute("/industry/:slug");
  const [, subParams]  = useRoute("/industry/:slug/:sub");
  const [, navigate] = useLocation();

  const slug            = subParams?.slug ?? baseParams?.slug ?? "";
  const subSlug         = subParams?.sub ?? "";
  const fullKey         = subSlug ? `${slug}/${subSlug}` : "";

  const industryNames   = INDUSTRY_SLUG_TO_NAMES[slug] ?? [];
  const industryName    = INDUSTRY_SLUG_TO_NAME[slug] ?? "";
  const subIndustryName = fullKey ? (SUB_INDUSTRY_SLUG_TO_NAME[fullKey] ?? "") : "";
  const subSeoContent   = fullKey ? (SUB_INDUSTRY_SEO_CONTENT[fullKey] ?? null) : null;
  const seoContent      = subSeoContent ?? (industryName ? INDUSTRY_SEO_CONTENT[industryName] : null);
  const displayName     = subIndustryName || industryName;

  const { data, isLoading } = trpc.factory.search.useQuery(
    {
      industry:    industryName ? [industryName] : undefined,
      subIndustry: subIndustryName ? [subIndustryName] : undefined,
      page: 1, pageSize: 20, sortBy: "rating",
    },
    { enabled: !!industryName }
  );

  if (industryNames.length === 0 || (subSlug && !subIndustryName)) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground">找不到此產業頁面</p>
          <Button variant="link" onClick={() => navigate("/search")}>返回搜尋</Button>
        </div>
      </div>
    );
  }

  const factories = data?.items ?? [];
  const total     = data?.total ?? 0;

  const canonicalUrl = subSlug
    ? `https://www.oxmmatch.com/industry/${slug}/${subSlug}`
    : `https://www.oxmmatch.com/industry/${slug}`;
  const pageTitle = subSeoContent?.title
    ?? `${industryName}｜台灣傳產供應商與工廠資源｜OXM`;
  const pageDesc  = subSeoContent?.description
    ?? `在 OXM 尋找台灣${industryName}相關廠商與供應鏈資源，包含工廠、OEM/ODM 代工、材料、設備、加工與產業服務，協助品牌、企業與採購者快速比較並送出詢價。`;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:image" content="https://www.oxmmatch.com/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="OXM 台灣傳統產業資源媒合平台" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
        <meta name="twitter:image" content="https://www.oxmmatch.com/og-image.png" />
        <meta name="twitter:image:alt" content="OXM 台灣傳統產業資源媒合平台" />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": pageTitle,
          "description": pageDesc,
          "url": canonicalUrl,
          "isPartOf": {
            "@type": "WebSite",
            "name": "OXM",
            "url": "https://www.oxmmatch.com",
            "description": "台灣傳統產業資源媒合平台"
          },
          ...(factories.length > 0 && {
            "mainEntity": {
              "@type": "ItemList",
              "name": `${displayName}工廠列表`,
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

        {/* 頁首 */}
        <div className="mb-8">
          {subSlug && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
              <Link href={`/industry/${slug}`} className="hover:text-foreground transition-colors">
                {industryName}
              </Link>
              <span>/</span>
              <span className="text-foreground font-medium">{subIndustryName}</span>
            </div>
          )}
          <h1 className="text-3xl font-extrabold text-foreground mb-2">{displayName}工廠</h1>
          <p className="text-muted-foreground">
            台灣{displayName}工廠列表，共 {total} 間，支援 OEM / ODM 服務
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(INDUSTRY_SLUGS).map(([name, s]) => (
              <Link key={s} href={`/industry/${s}`}>
                <Badge
                  variant={name === industryName ? "default" : "outline"}
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {name}
                </Badge>
              </Link>
            ))}
          </div>
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
              <p>目前尚無{industryName}工廠資料</p>
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

        {/* 查看更多 */}
        {total > 20 && (
          <div className="text-center mb-10">
            <Link href={`/search?industry=${encodeURIComponent(industryName)}`}>
              <Button variant="outline" className="gap-2">
                <Search className="w-4 h-4" />查看全部 {total} 間{industryName}工廠
              </Button>
            </Link>
          </div>
        )}

        {/* SEO 內容區塊 */}
        {seoContent && (
          <section className="border-t border-border pt-10 pb-6 space-y-6">
            <h2 className="text-xl font-bold text-foreground">關於{industryName}代工</h2>
            <div className="grid md:grid-cols-3 gap-6 text-sm text-muted-foreground leading-relaxed">
              <div>
                <h3 className="font-semibold text-foreground mb-2">什麼是{industryName}代工</h3>
                <p>{seoContent.intro}</p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">常見應用</h3>
                <p>{seoContent.applications}</p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">如何選擇工廠</h3>
                <p>{seoContent.howToChoose}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
