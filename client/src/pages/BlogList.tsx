import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { Link } from "wouter";
import { allPosts } from "@/lib/blog";
import { BookOpen, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const BASE = "https://www.oxmmatch.com";
const canonicalUrl = `${BASE}/blog`;
const pageTitle = "找代工指南｜OEM ODM 新手教學｜OXM";
const pageDesc = "第一次找台灣代工廠？從 OEM vs ODM 差異、MOQ 談判到詢價流程，OXM 幫你從零開始了解代工。";

export default function BlogList() {
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
        <meta property="og:image" content={`${BASE}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
        <meta name="twitter:image" content={`${BASE}/og-image.png`} />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": "找代工指南",
          "description": pageDesc,
          "url": canonicalUrl,
          "isPartOf": {
            "@type": "WebSite",
            "name": "OXM",
            "url": BASE,
            "description": "台灣 OEM / ODM 工廠媒合平台",
          },
          "mainEntity": {
            "@type": "ItemList",
            "itemListElement": allPosts.map((p, i) => ({
              "@type": "ListItem",
              "position": i + 1,
              "url": `${BASE}/blog/${p.slug}`,
              "name": p.title,
            })),
          },
        })}</script>
      </Helmet>

      <Navbar />

      <div className="container py-10 max-w-3xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-orange-500" />
          </div>
          <h1 className="text-3xl font-extrabold">找代工指南</h1>
        </div>
        <p className="text-muted-foreground mb-10">第一次找 OEM / ODM 工廠？從這裡開始</p>

        <div className="space-y-4">
          {allPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <p className="text-xs text-muted-foreground mb-1">{post.date}</p>
                  <h2 className="text-lg font-bold mb-1 hover:text-orange-500 transition-colors">{post.title}</h2>
                  <p className="text-sm text-muted-foreground line-clamp-2">{post.description}</p>
                  <div className="flex items-center gap-1 mt-3 text-sm text-orange-500 font-medium">
                    閱讀全文 <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-12 p-6 rounded-2xl bg-orange-50 border border-orange-100 text-center">
          <p className="font-semibold text-foreground mb-1">正在找台灣 OEM / ODM 工廠？</p>
          <p className="text-sm text-muted-foreground mb-4">前往 OXM 搜尋適合的供應商，直接聯繫、即時報價。</p>
          <Link href="/search">
            <Button className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 gap-2">
              <Search className="w-4 h-4" />搜尋代工廠
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
