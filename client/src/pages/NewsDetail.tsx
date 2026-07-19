import { useState, type ReactElement } from "react";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import MarkdownContent from "@/components/MarkdownContent";
import { shareContent } from "@/lib/share";
import { openExternalUrl } from "@/lib/platform";
import { useAuth } from "@/_core/hooks/useAuth";
import LoginDialog from "@/components/LoginDialog";
import { toast } from "sonner";
import { Share2, Newspaper, FileText as FileTextIcon, Download, ExternalLink } from "lucide-react";
import NotFound from "./NotFound";
import { Card, CardContent } from "@/components/ui/card";

const BASE = "https://www.oxmmatch.com";

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type NewsAttachment = {
  id: number;
  displayName: string;
  sizeBytes: number;
  expirationType: "after_publish_30d" | "custom" | "never";
  downloadExpiresAt: string | Date | null;
  isExpired: boolean;
  isStorageDeleted: boolean;
};

/**
 * 未登入：不會先取得 signed URL，點擊只打開既有的 LoginDialog。已登入：呼叫
 * protectedProcedure 現拿現簽的短效下載連結，loading 狀態避免連點造成重複請求。
 * 已過期／實體檔案已被排程清除：卡片保留，按鈕停用，不打開 LoginDialog、
 * 不呼叫下載 API，直接顯示固定文案。
 */
function NewsAttachmentCard({ attachment, isAuthenticated, onRequireLogin }: {
  attachment: NewsAttachment;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const getDownloadUrlMut = trpc.news.getPdfDownloadUrl.useMutation();
  const disabled = attachment.isExpired || attachment.isStorageDeleted;

  const handleClick = async () => {
    if (disabled || downloading) return;
    if (!isAuthenticated) { onRequireLogin(); return; }
    setDownloading(true);
    try {
      const result = await getDownloadUrlMut.mutateAsync({ attachmentId: attachment.id });
      await openExternalUrl(result.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "下載失敗，請稍後再試");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileTextIcon className="w-5 h-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{attachment.displayName}</p>
            <p className="text-xs text-muted-foreground">
              PDF · {formatFileSize(attachment.sizeBytes)}
              {!disabled && attachment.expirationType === "never" && " · 永久有效"}
              {!disabled && attachment.expirationType !== "never" && attachment.downloadExpiresAt &&
                ` · 下載期限 ${formatDateTime(attachment.downloadExpiresAt)}`}
            </p>
          </div>
        </div>
        {disabled ? (
          <Button size="sm" variant="outline" disabled className="shrink-0 text-muted-foreground">
            已超過下載期限
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={handleClick} disabled={downloading} className="shrink-0 gap-1.5">
            <Download className="w-3.5 h-3.5" />
            {downloading ? "處理中..." : isAuthenticated ? "下載 PDF" : "登入後下載"}
          </Button>
        )}
      </div>
      {disabled && (
        <p className="text-xs text-red-500 mt-2">已超過下載期限，如有需要請聯繫管理員。</p>
      )}
    </div>
  );
}

export default function NewsDetail() {
  const [, params] = useRoute("/news/:slug");
  const slug = params?.slug ?? "";
  const { data: item, isLoading, error } = trpc.news.getBySlug.useQuery(
    { slug },
    { enabled: slug.length > 0, retry: false },
  );
  const { isAuthenticated } = useAuth();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

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

            {/* 封面圖片：標題／日期下方，有才顯示，沒有時完全收起不留空白 */}
            {item.coverImageUrl && (
              <div className="w-full aspect-video max-h-[420px] rounded-xl overflow-hidden mb-6">
                <img
                  src={item.coverImageUrl}
                  alt={item.coverImageAlt ?? item.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <MarkdownContent content={item.content} className="text-base text-foreground/90" allowImages />

            {/* 消息來源：只在有 sourceUrl 時顯示（後端已經保證「有名稱必須有
                網址」，不會出現只有名稱、按鈕卻點不了的狀態）。永遠開新分頁，
                不把會員導離 OXM 目前這個 /news/:slug 頁面本身。 */}
            {item.sourceUrl && (
              <div className="mt-8 rounded-lg border bg-muted/20 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground truncate">
                  <span className="text-xs">來源：</span>
                  {item.sourceName || "原始消息來源"}
                </p>
                <Button
                  variant="outline" size="sm" className="gap-1.5 shrink-0"
                  onClick={() => openExternalUrl(item.sourceUrl!)}
                >
                  查看原始消息
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* 相關附件：沒有附件時整個區塊完全不渲染，不留空白 */}
            {item.attachments.length > 0 && (
              <div className="mt-10 pt-6 border-t">
                <h2 className="text-sm font-semibold text-muted-foreground mb-3">相關附件</h2>
                <div className="space-y-2.5">
                  {item.attachments.map(att => (
                    <NewsAttachmentCard
                      key={att.id}
                      attachment={att}
                      isAuthenticated={isAuthenticated}
                      onRequireLogin={() => setLoginDialogOpen(true)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-10 pt-6 border-t">
              <Button variant="outline" size="sm" onClick={handleShare} className="gap-1.5">
                <Share2 className="w-3.5 h-3.5" />
                分享
              </Button>
            </div>
          </article>
        </div>
        <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
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
            <meta property="og:image" content={item.coverImageUrl ?? `${BASE}/og-image.png`} />
          </>
        )}
      </Helmet>
      {body}
    </>
  );
}
