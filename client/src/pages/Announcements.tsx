import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Megaphone, Wrench, Newspaper, Zap, Pin, ArrowRight, ExternalLink } from "lucide-react";
import MarkdownContent from "@/components/MarkdownContent";
import { isNativeApp, openExternalUrl } from "@/lib/platform";

interface AnnouncementListItem {
  id: number;
  title: string;
  content: string;
  type: "update" | "maintenance" | "news";
  isPinned: boolean;
  createdAt: string | Date;
  actionUrl?: string | null;
}

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

// Accordion 單則公告：收合時只顯示標題＋日期，點擊 header 才展開全文。
// isHighlighted（首頁／登入彈窗導來的目標公告橘框）與 isExpanded（Accordion
// 展開狀態）是兩個獨立的 prop——目標公告會同時是這兩者，但橘框本身不代表
// 展開，展開也不代表有橘框，兩者的判斷來源本來就不同，不能合併成同一個
// state。
function AnnouncementAccordionItem({
  item,
  isExpanded,
  isHighlighted,
  onToggle,
}: {
  item: AnnouncementListItem;
  isExpanded: boolean;
  isHighlighted: boolean;
  onToggle: () => void;
}) {
  const contentId = `announcement-content-${item.id}`;
  return (
    <Card
      id={`announcement-${item.id}`}
      // scroll-mt-24：Navbar 是 sticky top-0（見 Navbar.tsx:596），沒有這個
      // offset，deep-link 捲動會讓公告標題整個貼到 viewport 最上方、甚至被
      // sticky navbar 蓋住。沿用本站其他錨點區塊既有的 scroll-mt-24 慣例
      // （見 AboutOXM.tsx／FAQ.tsx／FactoryDetailView.tsx 的 section 錨點）。
      className={`scroll-mt-24 overflow-hidden ${
        isHighlighted
          ? "border-orange-400 ring-2 ring-orange-300 bg-orange-50/60"
          : item.isPinned ? "border-orange-200 bg-orange-50/50" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={onToggle}
        className="w-full flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-5 text-left"
      >
        <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
          {isExpanded
            ? <ChevronDown className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-muted-foreground" />}
          <span className="font-semibold text-base break-words min-w-0">{item.title}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 pl-6 sm:pl-0">
          {new Date(item.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })}
        </span>
      </button>
      {/* grid-rows 0fr→1fr 是不需要量測實際高度就能做精準展開/收合動畫的
          標準做法；外層 overflow-hidden 的 inner wrapper 負責裁切轉場過程中
          還沒完全展開的內容，opacity 一起淡入淡出，200-300ms、無 bounce。 */}
      <div
        id={contentId}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <CardContent className="px-5 pb-5 pt-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {item.isPinned && (
                <span className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium">
                  <Pin className="w-3 h-3" />置頂
                </span>
              )}
              <TypeBadge type={item.type} />
            </div>
            <MarkdownContent content={item.content} className="text-muted-foreground" />
            {item.type === "news" && item.actionUrl && (
              <div className="mt-4 pt-4 border-t border-border/60">
                <AnnouncementActionButton actionUrl={item.actionUrl} />
              </div>
            )}
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

export default function Announcements() {
  const [, navigate] = useLocation();
  const { data: items = [], isLoading } = trpc.announcement.list.useQuery({ limit: 50 });

  // 登入彈窗／首頁公告卡片「點擊進入完整公告」會導向
  // /announcements?highlight=<id>——這裡沒有獨立的公告詳情頁路由，所以用
  // 錨點捲動＋展開＋橘框醒目提示的方式導向同一則公告，而不是另外做一套第二
  // 份公告內容。
  const highlightId = new URLSearchParams(window.location.search).get("highlight");

  // Accordion 展開狀態：null 代表全部收合，同一時間只展開一則，避免頁面
  // 重新變得過長。
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!highlightId || items.length === 0) return;
    const targetId = Number(highlightId);
    if (!Number.isNaN(targetId)) setExpandedId(targetId);
    // 用 requestAnimationFrame 而不是同步捲動：上面的 setExpandedId 要等下一次
    // render 提交、瀏覽器完成該公告展開後的 layout，才能量到正確位置；同步
    // 呼叫 scrollIntoView 會用到還沒展開（收合狀態）的舊高度來計算，捲動位置
    // 會不準確。不用 behavior: "smooth"：這是「使用者從首頁／登入彈窗點了
    // 特定一則公告」的明確目標定位，必須可靠地落在正確位置——smooth 動畫在
    // 部分瀏覽器情境（例如系統開啟減少動態效果、或動畫途中被其他事件中斷）
    // 可能整個不執行或提前結束。沿用既有的 block: "center"（見 Card 上的
    // scroll-mt-24：Navbar 是 sticky top-0，兩者一起確保標題不會貼齊或被
    // sticky navbar 蓋住 viewport 最上方）。
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`announcement-${highlightId}`);
      el?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
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
              <AnnouncementAccordionItem
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                isHighlighted={String(item.id) === highlightId}
                onToggle={() => setExpandedId(prev => (prev === item.id ? null : item.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
