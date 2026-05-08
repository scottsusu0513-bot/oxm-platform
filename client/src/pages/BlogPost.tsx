import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { useRoute, useLocation, Link } from "wouter";
import { getPost } from "@/lib/blog";
import ReactMarkdown from "react-markdown";
import { ChevronLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import NotFound from "./NotFound";

const BASE = "https://www.oxmmatch.com";

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug ?? "";
  const post = getPost(slug);

  if (!post) return <NotFound />;

  const canonicalUrl = `${BASE}/blog/${post.slug}`;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{post.title}｜OXM 找代工指南</title>
        <meta name="description" content={post.description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={`${post.title}｜OXM`} />
        <meta property="og:description" content={post.description} />
        <meta property="og:image" content={`${BASE}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${post.title}｜OXM`} />
        <meta name="twitter:description" content={post.description} />
        <meta name="twitter:image" content={`${BASE}/og-image.png`} />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": post.title,
          "description": post.description,
          "datePublished": post.date,
          "url": canonicalUrl,
          "publisher": {
            "@type": "Organization",
            "name": "OXM",
            "url": BASE,
          },
          "isPartOf": {
            "@type": "WebSite",
            "name": "OXM",
            "url": BASE,
          },
        })}</script>
      </Helmet>

      <Navbar />

      <div className="container py-8 max-w-2xl">
        <Button variant="ghost" size="sm" className="mb-6 -ml-2" onClick={() => navigate("/blog")}>
          <ChevronLeft className="w-4 h-4 mr-1" />找代工指南
        </Button>

        <article>
          <p className="text-xs text-muted-foreground mb-2">{post.date}</p>
          <h1 className="text-3xl font-extrabold mb-3 leading-tight">{post.title}</h1>
          <p className="text-muted-foreground mb-8 text-base leading-relaxed border-l-4 border-orange-200 pl-4">{post.description}</p>

          <div className="prose prose-neutral max-w-none
            prose-headings:font-bold prose-headings:text-foreground
            prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-3
            prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2
            prose-p:text-muted-foreground prose-p:leading-relaxed
            prose-strong:text-foreground
            prose-ul:text-muted-foreground prose-ol:text-muted-foreground
            prose-li:my-1
            prose-table:text-sm prose-th:text-foreground prose-th:bg-muted/50
            prose-td:text-muted-foreground
            prose-blockquote:border-orange-300 prose-blockquote:text-muted-foreground
          ">
            <ReactMarkdown>{post.content}</ReactMarkdown>
          </div>
        </article>

        {/* CTA */}
        <div className="mt-12 p-6 rounded-2xl bg-orange-50 border border-orange-100">
          <p className="font-semibold text-foreground mb-1">正在找台灣 OEM / ODM 工廠？</p>
          <p className="text-sm text-muted-foreground mb-4">前往 OXM 搜尋適合的供應商，直接聯繫、即時報價。</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/search">
              <Button className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 gap-2">
                <Search className="w-4 h-4" />搜尋代工廠
              </Button>
            </Link>
            <Link href="/blog">
              <Button variant="outline" className="border-orange-200 text-orange-600 hover:bg-orange-50 gap-1">
                查看更多指南
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
