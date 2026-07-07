import Navbar from "@/components/Navbar";
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
  MessageCircle, ArrowLeft, Trash2, Inbox, ShoppingCart,
  ChevronDown, ChevronRight, Pencil, Check, X, Factory,
} from "lucide-react";
import { toast } from "sonner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";

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
          <Inbox className="w-12 h-12 mx-auto mb-4 opacity-30" />
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
              <div className="flex items-center justify-between p-4 rounded-lg border border-orange-200 bg-orange-50/40 hover:bg-orange-50/70 transition-colors cursor-pointer min-h-[72px]">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-orange-500 text-sm">★ 平台管理員</p>
                  <p className="font-medium truncate">{conv.title}</p>
                  <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{conv.lastMessage}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(conv.lastMessageAt).toLocaleDateString("zh-TW")}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
                  )}
                </div>
              </div>
            </Link>
          );
        }
        return (
          <div key={conv.id} className="flex items-center gap-2">
            <div className="flex-1 cursor-pointer" onClick={() => navigate(`/chat/${conv.id}`, { state: { from: "/messages" } })}>
              <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors min-h-[72px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{conv.factoryName}</p>
                    {conv.productName && <Badge variant="outline" className="text-xs">{conv.productName}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                    {conv.lastMessage
                      ? `${conv.lastSenderRole === "user" ? "你：" : ""}${conv.lastMessage}`
                      : "（尚無訊息）"
                    }
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(conv.lastMessageAt).toLocaleDateString("zh-TW")}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => {
                if (confirm("確定要刪除此對話嗎？所有訊息將會消失。")) {
                  deleteMut.mutate({ conversationId: conv.id });
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
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

// ── 批次詳情（展開） ──────────────────────────────────────────────────────
function BatchDetail({ batchId }: { batchId: number }) {
  const { data, isLoading } = trpc.inquiryBatch.getDetail.useQuery({ batchId }, { refetchInterval: 30000 });
  const [, navigate] = useLocation();

  if (isLoading) return <p className="text-xs text-muted-foreground py-2 px-4">載入中…</p>;
  if (!data || data.items.length === 0) return <p className="text-xs text-muted-foreground py-2 px-4">此批次無工廠</p>;

  return (
    <div className="border-t divide-y">
      {data.items.map((item: any) => (
        <div key={item.id} className={item.conversationId ? "cursor-pointer" : ""} onClick={() => { if (item.conversationId) navigate(`/chat/${item.conversationId}`, { state: { from: "/messages" } }); }}>
          <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{item.factoryName}</p>
              {item.lastMessage && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.lastMessage}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {item.lastMessageAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(item.lastMessageAt).toLocaleDateString("zh-TW")}
                </span>
              )}
              {item.unreadCount > 0 && (
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
              )}
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            </div>
          </div>
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
        <Card key={batch.id} className="overflow-hidden">
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/20"
            onClick={() => setExpandedId(expandedId === batch.id ? null : batch.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm">{batch.title}</p>
                <BatchTitleEditor batchId={batch.id} initialTitle={batch.title} onUpdated={() => utils.inquiryBatch.listMine.invalidate()} />
                <Badge variant="outline" className="text-xs">{batch.itemCount} 間工廠</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                建立於 {new Date(batch.createdAt).toLocaleDateString("zh-TW")}
                {batch.latestMessageAt && ` · 最後訊息 ${new Date(batch.latestMessageAt).toLocaleDateString("zh-TW")}`}
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ml-2 ${expandedId === batch.id ? "rotate-180" : ""}`} />
          </div>
          {expandedId === batch.id && <BatchDetail batchId={batch.id} />}
        </Card>
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
          <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>尚無工廠訊息</p>
          <p className="text-sm mt-1">客戶從工廠頁面發起詢問後，訊息將顯示於此</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {convs.map((conv: any) => (
        <div key={conv.id} className="flex items-center gap-2">
          <div
            className="flex-1 cursor-pointer"
            onClick={() => navigate(`/chat/${conv.id}`, { state: { from: "/messages?tab=factory" } })}
          >
            <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors min-h-[72px]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{conv.userName}</p>
                  {conv.productName && <Badge variant="outline" className="text-xs">{conv.productName}</Badge>}
                </div>
                {conv.lastMessage ? (
                  <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                    {conv.lastSenderRole === "factory" ? "你：" : ""}{conv.lastMessage}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">（尚無訊息）</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {new Date(conv.lastMessageAt).toLocaleDateString("zh-TW")}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => {
              if (confirm("確定要刪除此對話嗎？所有訊息將會消失。")) {
                deleteMut.mutate({ conversationId: conv.id });
              }
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
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
  // Skip auto-default logic if the user arrived with an explicit tab param
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

  // ── Auto default tab (runs once when all data is loaded) ─────────────────
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

  // ── Guard: if URL said factory but user has none, fall back ──────────────
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
      <div className="container py-6 max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => {
          const from = (window.history.state as Record<string, string> | null)?.from;
          navigate(from ?? "/");
        }}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回
        </Button>

        <h1 className="text-2xl font-bold flex items-center gap-2 mb-4">
          <MessageCircle className="w-6 h-6" />
          我的訊息
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
            <Factory className="w-3.5 h-3.5" />
            工廠訊息
            {factoryUnreadCount > 0 && (
              <span className="inline-block h-2 w-2 rounded-full bg-orange-500 shrink-0" />
            )}
          </button>
        </div>

        {/* ── 一般訊息區塊 ── */}
        {mainTab === "personal" && (
          <>
            {/* 一般訊息 / 一鍵詢價 子切換 */}
            <div className="flex gap-2 mb-4">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${personalType === "normal" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                onClick={() => handlePersonalTypeChange("normal")}
              >
                一般訊息
                {normalUnread > 0 && (
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-orange-500 text-white text-[10px] leading-none">
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
                  <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-orange-500 text-white text-[10px] leading-none">
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
                  <Factory className="w-12 h-12 mx-auto mb-4 opacity-30" />
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
