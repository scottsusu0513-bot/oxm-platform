import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { ChevronLeft, Megaphone, Wrench, Newspaper, Zap, Pin, ArrowRight, ExternalLink } from "lucide-react";
import MarkdownContent from "@/components/MarkdownContent";
import { isNativeApp, openExternalUrl } from "@/lib/platform";

const TYPE_CONFIG = {
  update:      { label: "版本更新", icon: Zap,       className: "bg-blue-100 text-blue-700 border-blue-200" },
  maintenance: { label: "停機維護", icon: Wrench,    className: "bg-red-100 text-red-700 border-red-200" },
  news:        { label: "平台消息", icon: Newspaper,  className: "bg-green-100 text-green-700 border-green-200" },
};

function TypeBadge({ type }: { type: "update" | "maintenance" | "news" }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.news;
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.className} border text-xs font-medium`}>
      <Icon className="w-3 h-3 mr-1" />{cfg.label}
    </Badge>
  );
}

// 公告完整內容下方的「了解更多」按鈕——唯一允許出現這顆按鈕的地方（見本檔案
// 下方的渲染條件：type === "news" && actionUrl）。站內路徑走 wouter 既有的
// SPA 導頁；站外網址在 Web 用真正的 <a target="_blank" rel="noopener
// noreferrer">（保留瀏覽器原生「開新分頁」行為），在 Capacitor APP 改用
// @capacitor/browser 開系統瀏覽器，避免站外網域被 WebView 直接劫持。
function AnnouncementActionButton({ actionUrl }: { actionUrl: string }) {
  const isInternal = actionUrl.startsWith("/") && !actionUrl.startsWith("//");

  if (isInternal) {
    return (
      <Link href={actionUrl}>
        <Button variant="outline" size="sm" className="w-full sm:w-auto gap-1.5">
          了解更多
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </Link>
    );
  }

  if (isNativeApp()) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full sm:w-auto gap-1.5"
        onClick={() => { void openExternalUrl(actionUrl); }}
      >
        了解更多
        <ExternalLink className="w-3.5 h-3.5" />
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" className="w-full sm:w-auto gap-1.5" asChild>
      <a href={actionUrl} target="_blank" rel="noopener noreferrer">
        了解更多
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </Button>
  );
}

export default function Announcements() {
  const [, navigate] = useLocation();
  const { data: items = [], isLoading } = trpc.announcement.list.useQuery({ limit: 50 });

  // 登入彈窗「點擊進入完整公告」會導向 /announcements?highlight=<id>——這裡沒有
  // 獨立的公告詳情頁路由，所以用錨點捲動＋短暫醒目提示的方式導向同一則公告，
  // 而不是另外做一套第二份公告內容。
  const highlightId = new URLSearchParams(window.location.search).get("highlight");

  useEffect(() => {
    if (!highlightId || items.length === 0) return;
    const el = document.getElementById(`announcement-${highlightId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, items.length]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className="container py-8 max-w-3xl">

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center shadow">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">平台公告</h1>
            <p className="text-sm text-muted-foreground">OXM 平台最新消息與維護通知</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i}><CardContent className="p-5 h-24 animate-pulse bg-muted/40" /></Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>目前沒有公告</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {items.map(item => (
              <Card
                key={item.id}
                id={`announcement-${item.id}`}
                className={
                  String(item.id) === highlightId
                    ? "border-orange-400 ring-2 ring-orange-300 bg-orange-50/60"
                    : item.isPinned ? "border-orange-200 bg-orange-50/50" : ""
                }
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.isPinned && (
                        <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
                          <Pin className="w-3 h-3" />置頂
                        </span>
                      )}
                      <TypeBadge type={item.type} />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(item.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })}
                    </span>
                  </div>
                  <h2 className="font-semibold text-base mb-2">{item.title}</h2>
                  <MarkdownContent content={item.content} className="text-muted-foreground" />
                  {item.type === "news" && item.actionUrl && (
                    <div className="mt-4 pt-4 border-t border-border/60">
                      <AnnouncementActionButton actionUrl={item.actionUrl} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
