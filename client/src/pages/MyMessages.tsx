import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { performLogin } from "@/const";
import { useState, useCallback, useEffect } from "react";
import {
  MessageCircle, ArrowLeft, Trash2, ShoppingCart,
  ChevronDown, ChevronRight, Pencil, Check, X, Factory as FactoryIcon,
  Megaphone, MailOpen, Wrench, User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";
import { OFFICIAL_OXM_NAME_CLASSNAME } from "@shared/officialIdentity";

// ── 時間格式（收件匣風格）─────────────────────────────────────────────────
function formatMsgTime(t: Date | string | null | undefined): string {
  if (!t) return "";
  const d = typeof t === "string" ? new Date(t) : t;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (diffDays < 7)
    return ["週日", "週一", "週二", "週三", "週四", "週五", "週六"][d.getDay()];
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ── 未讀數 badge ──────────────────────────────────────────────────────────
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1 rounded-full bg-orange-500 text-white text-[10px] font-semibold leading-none shrink-0">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ── 工廠 / 工作室頭像（含 fallback）──────────────────────────────────────
function FactoryAvatar({
  avatarUrl, businessType, isUnread,
}: {
  avatarUrl?: string | null;
  businessType?: string | null;
  isUnread?: boolean;
}) {
  if (avatarUrl) {
    return (
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-muted border border-border/60">
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
      isUnread ? "bg-orange-100" : "bg-muted"
    }`}>
      {businessType === "studio"
        ? <Wrench className={`w-4 h-4 ${isUnread ? "text-purple-400" : "text-purple-300"}`} />
        : <FactoryIcon className={`w-4 h-4 ${isUnread ? "text-orange-500" : "text-orange-300"}`} />
      }
    </div>
  );
}

// ── 買家（一般用戶）頭像 ──────────────────────────────────────────────────
function BuyerAvatar({ isUnread }: { isUnread?: boolean }) {
  return (
    <div className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
      isUnread ? "bg-orange-100 text-orange-500" : "bg-muted text-muted-foreground"
    }`}>
      <UserIcon className="w-4 h-4" />
    </div>
  );
}

// ── 管理員頭像 ─────────────────────────────────────────────────────────────
function AdminAvatar({ isUnread }: { isUnread?: boolean }) {
  return (
    <div className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
      isUnread ? "bg-orange-100 text-orange-500" : "bg-muted text-muted-foreground"
    }`}>
      <Megaphone className="w-4 h-4" />
    </div>
  );
}

// ── 收件匣卡片（共用視覺元件）────────────────────────────────────────────
interface InboxCardContentProps {
  avatar: React.ReactNode;
  isUnread?: boolean;
  title: React.ReactNode;
  titleSuffix?: React.ReactNode;
  summary?: string | null;
  emptySummary?: string;
  timeStr?: string;
  unreadCount?: number;
}

function InboxCardContent({
  avatar, isUnread = false, title, titleSuffix,
  summary, emptySummary = "（尚無訊息）", timeStr, unreadCount = 0,
}: InboxCardContentProps) {
  const hasUnread = isUnread || unreadCount > 0;
  return (
    <div className={`flex items-stretch rounded-lg border overflow-hidden min-h-[68px] transition-colors ${
      hasUnread
        ? "bg-orange-50/60 border-orange-200/80 hover:bg-orange-50/90"
        : "bg-card border-border hover:bg-muted/30"
    }`}>
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${hasUnread ? "bg-orange-400" : "bg-transparent"}`} />
      {/* Avatar */}
      <div className="flex items-center justify-center px-3 shrink-0">
        {avatar}
      </div>
      {/* Text */}
      <div className="flex-1 min-w-0 py-3 pr-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm leading-snug ${hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
                {title}
              </span>
              {titleSuffix}
            </div>
            {summary
              ? <p className={`text-xs mt-0.5 line-clamp-2 leading-relaxed ${hasUnread ? "text-foreground/75" : "text-muted-foreground"}`}>{summary}</p>
              : <p className="text-xs mt-0.5 text-muted-foreground/50 italic">{emptySummary}</p>
            }
          </div>
          {/* Right: time + unread badge */}
          <div className="flex flex-col items-end shrink-0 gap-1 pt-0.5">
            {timeStr && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeStr}</span>}
            <UnreadBadge count={unreadCount} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 一般訊息列表 ──────────────────────────────────────────────────────────
function UserConversationList({ conversations }: { conversations: any[] }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const deleteMut = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("對話已刪除");
      utils.chat.myConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <MailOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>尚無對話紀錄</p>
          <p className="text-sm mt-1">瀏覽工廠產品後，點擊「詢問產品」即可開始對話</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map(conv => {
        if (conv.isAdminMessage) {
          return (
            <Link key={conv.id} href={`/admin-message/${conv.adminCampaignId}`}>
              <InboxCardContent
                avatar={<AdminAvatar isUnread={conv.unreadCount > 0} />}
                isUnread={conv.unreadCount > 0}
                title={
                  (conv as any).senderIsOfficialOxm
                    ? <span className={OFFICIAL_OXM_NAME_CLASSNAME}>{(conv as any).senderDisplayName}</span>
                    : ((conv as any).senderDisplayName ?? "平台管理員")
                }
                titleSuffix={
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-200 bg-orange-50 text-orange-600 shrink-0">
                    官方公告
                  </span>
                }
                summary={conv.title ? `${conv.title}　${conv.lastMessage ?? ""}`.trim() : conv.lastMessage}
                timeStr={formatMsgTime(conv.lastMessageAt)}
                unreadCount={conv.unreadCount}
              />
            </Link>
          );
        }
        return (
          <div key={conv.id} className="flex items-stretch gap-1.5">
            <div
              className="flex-1 cursor-pointer"
              onClick={() => navigate(`/chat/${conv.id}`, { state: { from: "/messages" } })}
            >
              <InboxCardContent
                avatar={
                  <FactoryAvatar
                    avatarUrl={conv.factoryAvatarUrl}
                    businessType={conv.factoryBusinessType}
                    isUnread={conv.unreadCount > 0}
                  />
                }
                isUnread={conv.unreadCount > 0}
                title={conv.factoryName}
                titleSuffix={
                  conv.productName
                    ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">{conv.productName}</Badge>
                    : undefined
                }
                summary={conv.lastMessage
                  ? `${conv.lastSenderRole === "user" ? "你：" : ""}${conv.lastMessage}`
                  : null
                }
                timeStr={formatMsgTime(conv.lastMessageAt)}
                unreadCount={conv.unreadCount}
              />
            </div>
            <button
              type="button"
              className="flex items-center justify-center w-8 shrink-0 rounded-lg border border-transparent text-muted-foreground hover:text-destructive hover:bg-destructive/5 hover:border-destructive/20 transition-colors"
              aria-label="刪除對話"
              onClick={() => {
                if (confirm("確定要刪除此對話嗎？所有訊息將會消失。")) {
                  deleteMut.mutate({ conversationId: conv.id });
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── 批次標題編輯 ──────────────────────────────────────────────────────────
function BatchTitleEditor({ batchId, initialTitle, onUpdated }: { batchId: number; initialTitle: string; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const utils = trpc.useUtils();

  const updateMut = trpc.inquiryBatch.updateTitle.useMutation({
    onSuccess: () => {
      toast.success("名稱已更新");
      setEditing(false);
      utils.inquiryBatch.listMine.invalidate();
      onUpdated();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!editing) {
    return (
      <button className="flex items-center gap-1 hover:opacity-70" onClick={() => setEditing(true)}>
        <Pencil className="w-3 h-3 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        className="h-7 text-sm w-40"
        maxLength={50}
        autoFocus
      />
      <button onClick={() => updateMut.mutate({ batchId, title: value.trim() || initialTitle })} disabled={updateMut.isPending}>
        <Check className="w-4 h-4 text-green-600" />
      </button>
      <button onClick={() => { setValue(initialTitle); setEditing(false); }}>
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}

// ── 批次詳情（展開）───────────────────────────────────────────────────────
function BatchDetail({ batchId }: { batchId: number }) {
  const { data, isLoading } = trpc.inquiryBatch.getDetail.useQuery({ batchId }, { refetchInterval: 30000 });
  const [, navigate] = useLocation();

  if (isLoading) return <p className="text-xs text-muted-foreground py-3 px-4">載入中…</p>;
  if (!data || data.items.length === 0) return <p className="text-xs text-muted-foreground py-3 px-4">此批次無工廠</p>;

  return (
    <div className="border-t bg-muted/20 px-3 py-2 space-y-1.5">
      {data.items.map((item: any) => (
        <div
          key={item.id}
          className={`flex items-stretch rounded-md border overflow-hidden transition-colors ${
            item.conversationId ? "cursor-pointer" : "opacity-60"
          } ${
            item.unreadCount > 0 ? "bg-orange-50/50 border-orange-100" : "bg-card border-border hover:bg-muted/40"
          }`}
          onClick={() => {
            if (item.conversationId)
              navigate(`/chat/${item.conversationId}`, { state: { from: "/messages" } });
          }}
        >
          <div className={`w-1 shrink-0 ${item.unreadCount > 0 ? "bg-orange-300" : "bg-transparent"}`} />
          <div className="flex items-center px-2.5 py-2.5 gap-2.5 flex-1 min-w-0">
            <div className="shrink-0">
              <FactoryAvatar
                avatarUrl={item.factoryAvatarUrl}
                businessType={item.factoryBusinessType}
                isUnread={(item.unreadCount ?? 0) > 0}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs leading-snug ${item.unreadCount > 0 ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}>
                {item.factoryName}
              </p>
              {item.lastMessage && (
                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{item.lastMessage}</p>
              )}
            </div>
            <div className="flex flex-col items-end shrink-0 gap-0.5">
              {item.lastMessageAt && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatMsgTime(item.lastMessageAt)}
                </span>
              )}
              <UnreadBadge count={item.unreadCount ?? 0} />
            </div>
          </div>
          {item.conversationId && (
            <div className="flex items-center pr-2 shrink-0">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 一鍵詢價批次列表 ──────────────────────────────────────────────────────
function InquiryBatchList({ batches }: { batches: any[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  if (batches.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>尚未建立一鍵詢價</p>
          <p className="text-sm mt-1">在搜尋結果頁加入工廠後一次送出</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {batches.map(batch => (
        <div key={batch.id} className="rounded-lg border overflow-hidden">
          {/* Batch header */}
          <div
            className="flex items-center gap-0 cursor-pointer hover:bg-muted/20 transition-colors"
            onClick={() => setExpandedId(expandedId === batch.id ? null : batch.id)}
          >
            <div className="w-1 shrink-0 self-stretch" />
            <div className="flex items-center gap-3 px-3 py-3.5 flex-1 min-w-0">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-muted-foreground shrink-0">
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm text-foreground/90">{batch.title}</p>
                  <BatchTitleEditor
                    batchId={batch.id}
                    initialTitle={batch.title}
                    onUpdated={() => utils.inquiryBatch.listMine.invalidate()}
                  />
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                    {batch.itemCount} 間工廠
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  建立於 {formatMsgTime(batch.createdAt)}
                  {batch.latestMessageAt && ` · 最後回覆 ${formatMsgTime(batch.latestMessageAt)}`}
                </p>
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 mr-3 ${expandedId === batch.id ? "rotate-180" : ""}`} />
          </div>
          {expandedId === batch.id && <BatchDetail batchId={batch.id} />}
        </div>
      ))}
    </div>
  );
}

// ── 工廠訊息列表 ──────────────────────────────────────────────────────────
function FactoryConversationList({ factoryId }: { factoryId: number }) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const { data: convs, isLoading } = trpc.chat.factoryConversations.useQuery(
    { factoryId },
    { enabled: !!factoryId, refetchInterval: 30000 },
  );
  const deleteMut = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("對話已刪除");
      utils.chat.factoryConversations.invalidate({ factoryId });
      utils.chat.unreadCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">載入中…</div>;

  if (!convs || convs.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <MailOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>尚無工廠訊息</p>
          <p className="text-sm mt-1">客戶從工廠頁面發起詢問後，訊息將顯示於此</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {convs.map((conv: any) => (
        <div key={conv.id} className="flex items-stretch gap-1.5">
          <div
            className="flex-1 cursor-pointer"
            onClick={() => navigate(`/chat/${conv.id}`, { state: { from: "/messages?tab=factory" } })}
          >
            <InboxCardContent
              avatar={<BuyerAvatar isUnread={conv.unreadCount > 0} />}
              isUnread={conv.unreadCount > 0}
              title={conv.userName}
              titleSuffix={
                conv.productName
                  ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">{conv.productName}</Badge>
                  : undefined
              }
              summary={conv.lastMessage
                ? `${conv.lastSenderRole === "factory" ? "你：" : ""}${conv.lastMessage}`
                : null
              }
              timeStr={formatMsgTime(conv.lastMessageAt)}
              unreadCount={conv.unreadCount}
            />
          </div>
          <button
            type="button"
            className="flex items-center justify-center w-8 shrink-0 rounded-lg border border-transparent text-muted-foreground hover:text-destructive hover:bg-destructive/5 hover:border-destructive/20 transition-colors"
            aria-label="刪除對話"
            onClick={() => {
              if (confirm("確定要刪除此對話嗎？所有訊息將會消失。")) {
                deleteMut.mutate({ conversationId: conv.id });
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────
export default function MyMessages() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // ── URL-based tab state (lazy init from search params) ──
  const [mainTab, setMainTab] = useState<"personal" | "factory">(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("tab") === "factory" ? "factory" : "personal";
  });
  const [personalType, setPersonalType] = useState<"normal" | "quote">(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("type") === "quote" ? "quote" : "normal";
  });
  const [hasInteracted, setHasInteracted] = useState(() => {
    return !!new URLSearchParams(window.location.search).get("tab");
  });

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: userConvs } = trpc.chat.myConversations.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  const { data: batches } = trpc.inquiryBatch.listMine.useQuery(undefined, {
    enabled: isAuthenticated && mainTab === "personal" && personalType === "quote",
    refetchInterval: 30000,
  });

  const { data: unreadData } = trpc.chat.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: coManagedList, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const primaryFactoryId = ownedFactory?.id ?? coManagedList?.[0]?.factoryId ?? null;
  const hasFactory = !!ownedFactory || (coManagedList?.length ?? 0) > 0;

  // ── Unread counts from conversation data ─────────────────────────────────
  const myConvsList = userConvs ?? [];
  const normalUnread = myConvsList.filter(c => !c.hasInquiry).reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0);
  const quoteUnread = myConvsList.filter(c => c.hasInquiry).reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0);
  const personalGroupUnread = normalUnread + quoteUnread;
  const factoryUnreadCount = unreadData?.factoryCount ?? 0;

  // ── Auto default tab ──────────────────────────────────────────────────────
  const dataLoaded = userConvs !== undefined && ownedFactory !== undefined && coManagedList !== undefined;

  useEffect(() => {
    if (!dataLoaded || hasInteracted) return;

    let newTab: "personal" | "factory" = "personal";
    let newType: "normal" | "quote" = "normal";
    const anyFactory = !!ownedFactory || (coManagedList?.length ?? 0) > 0;

    if (personalGroupUnread > 0 && factoryUnreadCount === 0) {
      newTab = "personal";
      if (quoteUnread > 0 && normalUnread === 0) newType = "quote";
    } else if (factoryUnreadCount > 0 && personalGroupUnread === 0 && anyFactory) {
      newTab = "factory";
    } else if (factoryUnreadCount > 0 && personalGroupUnread > 0 && anyFactory) {
      newTab = "factory";
    } else {
      newTab = anyFactory ? "factory" : "personal";
    }

    setMainTab(newTab);
    setPersonalType(newType);
    const params = new URLSearchParams();
    params.set("tab", newTab);
    if (newTab === "personal") params.set("type", newType);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }, [dataLoaded]);

  // ── Guard: URL factory tab but no factory ────────────────────────────────
  useEffect(() => {
    if (ownedLoading || coManagedLoading) return;
    if (mainTab === "factory" && !hasFactory) {
      setMainTab("personal");
      setHasInteracted(false);
      window.history.replaceState({}, "", "?tab=personal&type=normal");
    }
  }, [ownedLoading, coManagedLoading, mainTab, hasFactory]);

  // ── Tab handlers ─────────────────────────────────────────────────────────
  const handleMainTabChange = (newTab: "personal" | "factory") => {
    if (newTab === "factory" && !hasFactory) {
      toast("您尚未建立工廠", { description: "工廠訊息功能僅限工廠管理者使用" });
      return;
    }
    setMainTab(newTab);
    setHasInteracted(true);
    const params = new URLSearchParams();
    params.set("tab", newTab);
    if (newTab === "personal") params.set("type", personalType);
    window.history.replaceState({}, "", `?${params.toString()}`);
  };

  const handlePersonalTypeChange = (type: "normal" | "quote") => {
    setPersonalType(type);
    setHasInteracted(true);
    const params = new URLSearchParams();
    params.set("tab", "personal");
    params.set("type", type);
    window.history.replaceState({}, "", `?${params.toString()}`);
  };

  // ── Pull-to-refresh ───────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    const tasks: Promise<unknown>[] = [
      utils.chat.myConversations.invalidate(),
      utils.inquiryBatch.listMine.invalidate(),
      utils.chat.unreadCount.invalidate(),
    ];
    if (primaryFactoryId) {
      tasks.push(utils.chat.factoryConversations.invalidate({ factoryId: primaryFactoryId }));
    }
    await Promise.all(tasks);
  }, [utils, primaryFactoryId]);

  const { contentRef, indicatorRef, iconRef, phase } = usePullToRefresh({ onRefresh: handleRefresh });

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">請先登入</h2>
          <p className="text-muted-foreground mb-4">登入後即可查看您的訊息</p>
          <Button onClick={() => performLogin()}>登入</Button>
        </div>
      </div>
    );
  }

  const normalConvs = myConvsList.filter((c: any) => !c.hasInquiry);

  return (
    <NativePullToRefreshLayout contentRef={contentRef} indicatorRef={indicatorRef} iconRef={iconRef} phase={phase} className="min-h-screen bg-background">
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className="container py-6 max-w-3xl">

        {/* 手機版只顯示「我的訊息」文字本身、用 text-center 讓文字獨立置中——不是
            「圖示+文字」整組置中（那樣文字會被圖示往右推，不是文字本身的正中心），
            避免被左上角浮動返回鍵（FloatingBackButton，fixed left-3）擋住／擠壓；
            不用 pl-*／ml-* 之類的左側留白硬推開文字。桌面版維持原本圖示+文字左對齊
            排版不變（MessageCircle 只在 lg: 以上顯示）。 */}
        <h1 className="mb-4 text-2xl font-bold text-center lg:flex lg:items-center lg:justify-start lg:gap-2 lg:text-left">
          <MessageCircle className="hidden h-6 w-6 lg:block" />
          <span>我的訊息</span>
        </h1>

        {/* ── 主分頁 ── */}
        <div className="flex border-b mb-6">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${mainTab === "personal" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => handleMainTabChange("personal")}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            一般訊息
            {personalGroupUnread > 0 && (
              <span className="inline-block h-2 w-2 rounded-full bg-orange-500 shrink-0" />
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${mainTab === "factory" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => handleMainTabChange("factory")}
          >
            <FactoryIcon className="w-3.5 h-3.5" />
            工廠訊息
            {factoryUnreadCount > 0 && (
              <span className="inline-block h-2 w-2 rounded-full bg-orange-500 shrink-0" />
            )}
          </button>
        </div>

        {/* ── 一般訊息區塊 ── */}
        {mainTab === "personal" && (
          <>
            <div className="flex gap-2 mb-4">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${personalType === "normal" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                onClick={() => handlePersonalTypeChange("normal")}
              >
                一般訊息
                {normalUnread > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-orange-500 text-white text-[10px] leading-none">
                    {normalUnread > 99 ? "99+" : normalUnread}
                  </span>
                )}
              </button>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${personalType === "quote" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                onClick={() => handlePersonalTypeChange("quote")}
              >
                <ShoppingCart className="w-3 h-3" />
                一鍵詢價
                {quoteUnread > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full bg-orange-500 text-white text-[10px] leading-none">
                    {quoteUnread > 99 ? "99+" : quoteUnread}
                  </span>
                )}
              </button>
            </div>

            {personalType === "normal" && <UserConversationList conversations={normalConvs} />}
            {personalType === "quote" && <InquiryBatchList batches={batches ?? []} />}
          </>
        )}

        {/* ── 工廠訊息區塊 ── */}
        {mainTab === "factory" && (
          primaryFactoryId
            ? <FactoryConversationList factoryId={primaryFactoryId} />
            : (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  <FactoryIcon className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>您尚未建立工廠</p>
                  <p className="text-sm mt-1">建立工廠後，來自客戶的詢問訊息將顯示於此</p>
                </CardContent>
              </Card>
            )
        )}
      </div>
    </NativePullToRefreshLayout>
  );
}
