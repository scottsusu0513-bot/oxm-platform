import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationEllipsis,
} from "@/components/ui/pagination";
import { trpc } from "@/lib/trpc";
import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useRef, useEffect } from "react";
import { INDUSTRY_SLUG_TO_NAMES, INDUSTRY_SLUG_TO_NAME, INDUSTRY_SEO_CONTENT, INDUSTRY_SLUGS, SUB_INDUSTRY_SLUG_TO_NAME, SUB_INDUSTRY_SEO_CONTENT } from "@shared/constants";
import { buildIndustryPageMeta } from "@shared/seo/industryPages";
import { parsePageParam, pageToQueryValue, computeTotalPages, clampPage, getPaginationRange } from "@shared/industryPagination";
import { ChevronLeft, ChevronRight, Factory, Wrench, Star, MapPin } from "lucide-react";

// 正式頁碼式 Pagination（見對話中「Pagination + 產業 slug mapping 稽核」）：
// 每頁固定 15 間，取代原本寫死 pageSize:20、只顯示第一頁再靠「查看全部」
// 導去 /search 的做法——產業頁現在自己就能完整翻頁看到所有工廠。
const PAGE_SIZE = 15;

export default function IndustryPage() {
  const [, baseParams] = useRoute("/industry/:slug");
  const [, subParams]  = useRoute("/industry/:slug/:sub");
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const listTopRef = useRef<HTMLDivElement>(null);

  const slug            = subParams?.slug ?? baseParams?.slug ?? "";
  const subSlug         = subParams?.sub ?? "";
  const fullKey         = subSlug ? `${slug}/${subSlug}` : "";
  const basePath        = subSlug ? `/industry/${slug}/${subSlug}` : `/industry/${slug}`;

  const industryNames   = INDUSTRY_SLUG_TO_NAMES[slug] ?? [];
  const industryName    = INDUSTRY_SLUG_TO_NAME[slug] ?? "";
  const subIndustryName = fullKey ? (SUB_INDUSTRY_SLUG_TO_NAME[fullKey] ?? "") : "";
  const subSeoContent   = fullKey ? (SUB_INDUSTRY_SEO_CONTENT[fullKey] ?? null) : null;
  const seoContent      = subSeoContent ?? (industryName ? INDUSTRY_SEO_CONTENT[industryName] : null);
  const displayName     = subIndustryName || industryName;

  // rawPageParam：URL 上原始的 "page" 字串（可能是 null、"abc"、"0"、"2" 等
  // 任何值）；requestedPage：經過 parsePageParam() 語法正規化後、保證 >=1
  // 的整數，但此時還不知道是否超出實際 totalPages（那要等 tRPC 回傳
  // total 才知道）。
  const rawPageParam   = new URLSearchParams(searchString).get("page");
  const requestedPage  = parsePageParam(rawPageParam);

  const { data, isLoading } = trpc.factory.search.useQuery(
    {
      industry:    industryName ? [industryName] : undefined,
      subIndustry: subIndustryName ? [subIndustryName] : undefined,
      page: requestedPage, pageSize: PAGE_SIZE, sortBy: "rating",
    },
    {
      enabled: !!industryName,
      // 換頁時保留上一頁的資料直到新的一頁載入完成，避免整個 grid 被
      // skeleton 取代造成的畫面跳動／layout shift（沿用 Search.tsx 既有的
      // 同一個 React Query pattern，見該檔案 `placeholderData: (prev) =>
      // prev` 的說明）。
      placeholderData: (prev) => prev,
    }
  );

  // totalPages 需要 data.total 才能算出，第一次載入完成前是 null；
  // isPageOutOfRange：網址寫的頁碼「語法上合法」但超出實際總頁數（例如
  // totalPages=5 卻是 ?page=20）——這種情況下面的 effect 會 normalize 網址
  // 到最後一頁，這裡先擋著不要顯示這一頁（其實也沒有資料）造成的空白清單，
  // 用跟 isLoading 一樣的 skeleton 蓋過去，等 normalize 完成後自然會用正確
  // 頁碼重新查詢、顯示正常內容。
  const totalPages       = data ? computeTotalPages(data.total, PAGE_SIZE) : null;
  const isPageOutOfRange = totalPages !== null && requestedPage > totalPages;

  // 1) 語法正規化：?page=abc / ?page=0 / ?page=-1 / ?page=01 這類不是「乾淨
  //    正整數字串」的網址，一律馬上 replace 成正規化後的網址（第 1 頁不留
  //    ?page=1）。這一步不需要等 tRPC 回應，純粹是字串層級的修正。
  useEffect(() => {
    const canonicalValue = pageToQueryValue(requestedPage);
    if (rawPageParam !== canonicalValue) {
      navigate(canonicalValue ? `${basePath}?page=${canonicalValue}` : basePath, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPageParam, requestedPage, basePath]);

  // 2) 語意正規化：頁碼語法合法，但超出實際 totalPages（例如只有 5 頁卻是
  //    ?page=20）——等 tRPC 回傳 total 後才知道，correction 用 replace（不是
  //    push），避免使用者按上一頁時回到一個「原本就無效」的網址、也避免
  //    重複 correction 造成 redirect loop（normalize 完成後 requestedPage
  //    就會等於 totalPages，條件不再成立，不會再次觸發）。
  useEffect(() => {
    if (totalPages === null || requestedPage <= totalPages) return;
    const clamped = clampPage(requestedPage, totalPages);
    const canonicalValue = pageToQueryValue(clamped);
    navigate(canonicalValue ? `${basePath}?page=${canonicalValue}` : basePath, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages, requestedPage, basePath]);

  // 3) canonical <link> 去重：server/_core/vite.ts 在「JS 執行前」就已經把
  //    <link rel="canonical"> 寫進原始 HTML 的 <head>（見 shared/seo/
  //    industryPages.ts 的說明），但 react-helmet-async 只會管理它自己建立
  //    的節點，不會去異動、也不會移除這個掛載前就存在的靜態標籤——一般情況
  //    下兩者算出來的網址剛好相同，兩個標籤內容一致，看不出問題；但上面第
  //    2 步的「頁碼超出 totalPages」correction 是純 client 端才做得到的事
  //    （server 端不查 DB，不知道真正的 totalPages，只能照字面產生請求當下
  //    那個頁碼的 meta），一旦真的觸發 correction，畫面上就會同時存在
  //    「server 端算的原始請求頁」與「client 端修正後的正確頁」兩個內容
  //    互相衝突的 canonical，違反「原始 HTML 與 client hydration 後必須
  //    完全一致」的要求。Helmet 掛載後永遠只會有它自己「這一個」canonical
  //    節點會持續被之後的 re-render 更新（不會再生出新節點），所以只需要
  //    在掛載後執行一次：如果同時存在多個 canonical，只留最後一個（一定是
  //    Helmet 掛載時新增、之後會持續被它更新的那個），其餘（掛載前就存在的
  //    server 端靜態標籤）移除。刻意不動 server/_core/ogMeta.ts 共用的
  //    injectMetaIntoHtml／既有的 data-oxm-seo-transient 標記機制——那是
  //    factory／news／region-industry／search 頁面共用的機制，這裡只在
  //    IndustryPage.tsx 內部局部處理，不擴大修改範圍。
  useEffect(() => {
    const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
    if (canonicalLinks.length > 1) {
      Array.from(canonicalLinks).slice(0, -1).forEach((el) => el.remove());
    }
  }, []);

  const handlePageChange = (targetPage: number) => {
    if (totalPages === null) return;
    const clamped = clampPage(targetPage, totalPages);
    if (clamped === requestedPage) return;
    const canonicalValue = pageToQueryValue(clamped);
    // push（不是 replace）：讓每一次換頁都是一筆新的瀏覽紀錄，Browser
    // Back / Forward 才能逐頁返回，跟上面兩個「修正非法網址」的 effect
    // （用 replace）刻意不同。
    navigate(canonicalValue ? `${basePath}?page=${canonicalValue}` : basePath);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

  const factories    = data?.items ?? [];
  const total        = data?.total ?? 0;
  const showSkeleton = isLoading || isPageOutOfRange;

  // canonical／title／description 改由 shared/seo/industryPages.ts 的
  // buildIndustryPageMeta() 計算——這是原本就設計成「server（vite.ts 的原始
  // HTML 注入）與 client 共用同一份公式」的函式，但原本這裡是各自獨立寫一份
  // 同樣的公式（等於沒有真的共用）。這次為了確保 Page 2+ 的 canonical／
  // title 在「JS 執行前的原始 HTML」與「JS 執行後的 Helmet」百分之百一致
  // （而不是兩份手動維護的公式湊巧長得一樣），直接呼叫同一個函式，不再各自
  // 維護一份。slug／subSlug 對不到已知產業時已經在上面 return 掉了，這裡
  // industryMeta 必定非 null。
  const industryMeta = buildIndustryPageMeta(slug, subSlug || undefined, requestedPage)!;
  const canonicalUrl = industryMeta.canonical;
  const pageTitle    = industryMeta.title;
  const pageDesc     = industryMeta.description;

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
          ...(!showSkeleton && factories.length > 0 && {
            "mainEntity": {
              "@type": "ItemList",
              "name": `${displayName}工廠列表`,
              // numberOfItems：本頁實際列出的筆數（不是全產業總數 total）
              // ——ItemList 的 numberOfItems 語意上就該等於 itemListElement
              // 的長度，修正前這裡誤填 total，造成兩者對不上。
              "numberOfItems": factories.length,
              "itemListElement": factories.map((f, i) => ({
                "@type": "ListItem",
                // position 用跨頁的真實順位：第 1 頁 1~15、第 2 頁 16~30，
                // 而不是每一頁都重新從 1 開始算。
                "position": (requestedPage - 1) * PAGE_SIZE + i + 1,
                "url": `https://www.oxmmatch.com/factory/${f.id}`,
                "name": f.name,
              }))
            }
          })
        })}</script>
      </Helmet>

      <Navbar />

      <div className="container py-6">
        {/* 產業結果頁上方可直接切換 13 個產業分類，切換會逐次 push 進歷史。
            返回鍵若走 history back，會退回上一個分類而不是離開產業瀏覽。
            因此這顆固定走 deterministic：唯一行為就是導向首頁 /，不看
            history／sessionStorage／referrer。只改本頁 prop，不動共用元件預設。 */}
        <FloatingBackButton fallbackHref="/" label="返回首頁" deterministic />

        {/* 頁首 */}
        {/* scroll-mt-24：換頁時 scrollIntoView 會把這個區塊的頂端對齊到
            viewport 最上方，但 Navbar 是 sticky（實測高度 65px）蓋在最上層，
            沒有這個 scroll margin 會讓 H1 剛好被 Navbar 蓋住——沿用專案裡
            FAQ.tsx 等頁面已經在用的同一個 scroll-mt-24 慣例，不是新發明的
            數值。 */}
        <div ref={listTopRef} className="mb-8 scroll-mt-24">
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
        {showSkeleton ? (
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

        {/* Pagination：正式頁碼式換頁，取代原本的「查看全部」導頁按鈕——
            產業頁現在自己就能完整翻頁看到所有工廠，不需要跳去 /search。 */}
        {!showSkeleton && totalPages !== null && totalPages > 1 && (
          <Pagination className="mb-10">
            <PaginationContent className="flex-wrap justify-center gap-1">
              <PaginationItem>
                <PaginationLink
                  href="#"
                  size="default"
                  aria-label="上一頁"
                  aria-disabled={requestedPage <= 1}
                  className={`gap-1 px-2.5 ${requestedPage <= 1 ? "pointer-events-none opacity-40" : ""}`}
                  onClick={(e) => { e.preventDefault(); if (requestedPage > 1) handlePageChange(requestedPage - 1); }}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">上一頁</span>
                </PaginationLink>
              </PaginationItem>

              {getPaginationRange(requestedPage, totalPages).map((item, idx) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${idx}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={item}>
                    <PaginationLink
                      href="#"
                      isActive={item === requestedPage}
                      aria-current={item === requestedPage ? "page" : undefined}
                      className={item === requestedPage ? "font-bold" : undefined}
                      onClick={(e) => { e.preventDefault(); handlePageChange(item); }}
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}

              <PaginationItem>
                <PaginationLink
                  href="#"
                  size="default"
                  aria-label="下一頁"
                  aria-disabled={requestedPage >= totalPages}
                  className={`gap-1 px-2.5 ${requestedPage >= totalPages ? "pointer-events-none opacity-40" : ""}`}
                  onClick={(e) => { e.preventDefault(); if (requestedPage < totalPages) handlePageChange(requestedPage + 1); }}
                >
                  <span className="hidden sm:inline">下一頁</span>
                  <ChevronRight className="w-4 h-4" />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
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
