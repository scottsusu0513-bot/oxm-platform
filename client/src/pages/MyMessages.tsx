import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useState } from "react";
import { MessageCircle, ArrowLeft, Trash2, Inbox, ShoppingCart, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

// ── 一般訊息列表 ──────────────────────────────────────────────────────────
function UserConversationList({ conversations }: { conversations: any[] }) {
  const utils = trpc.useUtils();
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
      {conversations.map(conv => (
        <div key={conv.id} className="flex items-center gap-2">
          <Link href={`/chat/${conv.id}`} className="flex-1">
            <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer min-h-[72px]">
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
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </Link>
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

  if (isLoading) return <p className="text-xs text-muted-foreground py-2 px-4">載入中…</p>;
  if (!data || data.items.length === 0) return <p className="text-xs text-muted-foreground py-2 px-4">此批次無工廠</p>;

  return (
    <div className="border-t divide-y">
      {data.items.map((item: any) => (
        <Link key={item.id} href={item.conversationId ? `/chat/${item.conversationId}` : "#"}>
          <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 cursor-pointer">
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
                <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                  {item.unreadCount}
                </span>
              )}
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            </div>
          </div>
        </Link>
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

// ── 主元件 ────────────────────────────────────────────────────────────────
export default function MyMessages() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"general" | "inquiry">("general");

  const { data: userConvs } = trpc.chat.myConversations.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30000,
  });

  const { data: batches } = trpc.inquiryBatch.listMine.useQuery(undefined, {
    enabled: isAuthenticated && tab === "inquiry",
    refetchInterval: 30000,
  });

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <MessageCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">請先登入</h2>
          <p className="text-muted-foreground mb-4">登入後即可查看您的訊息</p>
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-6 max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回首頁
        </Button>

        <h1 className="text-2xl font-bold flex items-center gap-2 mb-4">
          <MessageCircle className="w-6 h-6" />
          我的訊息
        </h1>

        {/* Tabs */}
        <div className="flex border-b mb-6">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "general" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("general")}
          >
            一般訊息
            {(userConvs?.reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0) ?? 0) > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5">
                {userConvs!.reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0)}
              </span>
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === "inquiry" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("inquiry")}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            一鍵詢價
          </button>
        </div>

        {tab === "general" && <UserConversationList conversations={userConvs ?? []} />}
        {tab === "inquiry" && <InquiryBatchList batches={batches ?? []} />}
      </div>
    </div>
  );
}
