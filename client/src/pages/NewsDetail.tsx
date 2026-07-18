import type { ReactElement } from "react";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import MarkdownContent from "@/components/MarkdownContent";
import { shareContent } from "@/lib/share";
import { Share2, Newspaper } from "lucide-react";
import NotFound from "./NotFound";
import { Card, CardContent } from "@/components/ui/card";

const BASE = "https://www.oxmmatch.com";

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function NewsDetail() {
  const [, params] = useRoute("/news/:slug");
  const slug = params?.slug ?? "";
  const { data: item, isLoading, error } = trpc.news.getBySlug.useQuery(
    { slug },
    { enabled: slug.length > 0, retry: false },
  );

  // <title> 一律有非空 fallback，且 Helmet 從第一次 render（loading 階段）就
  // 掛載——不能等資料載入完成才第一次出現在樹裡。這個專案的 React 19 +
  // react-helmet-async 組合，對「延遲才第一次掛載的 <title>」有既有的 head
  // hoisting 問題（/blog/:slug 用同一種延遲掛載寫法，會出現一模一樣的空
  // document.title；本次不動 BlogPost.tsx），改成「一律掛載、title 內容依
  // 狀態切換」就能繞開，不需要額外的 document.title effect。
  const canonicalUrl = item ? `${BASE}/news/${item.slug}` : undefined;
  const headTitle = item
    ? `${item.title}｜OXM 找消息`
    : !isLoading
      ? "找不到消息｜OXM"
      : "消息內容｜OXM 找消息";

  const handleShare = () => {
    if (!item || !canonicalUrl) return;
    void shareContent({
      title: item.title,
      text: item.summary,
      url: canonicalUrl,
    });
  };

  let body: ReactElement;
  if (isLoading) {
    body = (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-8 max-w-3xl">
          <Card><CardContent className="p-8 h-40 animate-pulse bg-muted/40" /></Card>
        </div>
      </div>
    );
  } else if (error || !item) {
    // 找不到／未發布／已下架一律走既有 404，不額外透露原因。
    body = <NotFound />;
  } else {
    body = (
      <div className="min-h-screen bg-background animate-page-enter">
        <Navbar />
        <FloatingBackButton fallbackHref="/news" label="找消息" />

        <div className="container py-8 max-w-3xl">
          <article>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <Newspaper className="w-3.5 h-3.5" />
              {item.publishedAt ? formatDate(item.publishedAt) : ""}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mb-6 leading-tight">{item.title}</h1>

            <MarkdownContent content={item.content} className="text-base text-foreground/90" />

            <div className="flex items-center gap-3 mt-10 pt-6 border-t">
              <Button variant="outline" size="sm" onClick={handleShare} className="gap-1.5">
                <Share2 className="w-3.5 h-3.5" />
                分享
              </Button>
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{headTitle}</title>
        {item && canonicalUrl && (
          <>
            <meta name="description" content={item.summary} />
            <link rel="canonical" href={canonicalUrl} />
            <meta property="og:type" content="article" />
            <meta property="og:site_name" content="OXM" />
            <meta property="og:url" content={canonicalUrl} />
            <meta property="og:title" content={`${item.title}｜OXM`} />
            <meta property="og:description" content={item.summary} />
          </>
        )}
      </Helmet>
      {body}
    </>
  );
}
