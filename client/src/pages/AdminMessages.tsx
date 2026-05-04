import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Users, Search, Loader2, MessageSquare, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

const TARGET_LABELS: Record<string, string> = {
  all_users: "全部用戶",
  all_factory_managers: "全部廠商",
  single: "指定用戶",
};

export default function AdminMessages() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { campaignId: campaignIdStr } = useParams<{ campaignId?: string }>();
  const campaignId = campaignIdStr ? parseInt(campaignIdStr, 10) : null;

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您沒有權限存取此頁面</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (campaignId) {
    return <CampaignThreadView campaignId={campaignId} setLocation={setLocation} />;
  }
  return <AdminMessagesContent setLocation={setLocation} />;
}

// ── 管理員主頁（發送 + 列表）────────────────────────────────────────────────
function AdminMessagesContent({ setLocation }: { setLocation: (p: string) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState<"all_users" | "all_factory_managers" | "single">("all_users");
  const [receiverId, setReceiverId] = useState<number | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();
  const campaignsQuery = trpc.admin.getMessageCampaigns.useQuery({ page, pageSize: 20 });
  const previewQuery = trpc.admin.previewMessageRecipientCount.useQuery(
    { targetType },
    { enabled: targetType !== "single" }
  );
  const searchQuery_ = trpc.admin.searchMessageReceivers.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.trim().length >= 2 }
  );
  const createMut = trpc.admin.createAdminMessage.useMutation({
    onSuccess: (data) => {
      toast.success(`站內信已發送，共 ${data.recipientCount} 位收件人`);
      setTitle(""); setContent(""); setTargetType("all_users");
      setReceiverId(null); setReceiverName(""); setSearchQuery("");
      utils.admin.getMessageCampaigns.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSend = () => {
    if (!title.trim()) { toast.error("請填寫標題"); return; }
    if (!content.trim()) { toast.error("請填寫內容"); return; }
    if (targetType === "single" && !receiverId) { toast.error("請選擇收件人"); return; }
    createMut.mutate({ title: title.trim(), content: content.trim(), targetType, receiverId: receiverId ?? undefined });
  };

  const campaigns = campaignsQuery.data?.items ?? [];
  const total = campaignsQuery.data?.total ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin")} className="gap-1">
            <ArrowLeft className="h-4 w-4" />返回
          </Button>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Send className="h-6 w-6" />站內信管理
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 發送表單 */}
          <Card>
            <CardHeader><CardTitle className="text-base">發送新站內信</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">標題</label>
                <Input placeholder="請輸入標題（最多 200 字）" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">內容</label>
                <Textarea placeholder="請輸入訊息內容..." value={content} onChange={e => setContent(e.target.value)} rows={5} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">發送對象</label>
                <Select value={targetType} onValueChange={(v: any) => { setTargetType(v); setReceiverId(null); setReceiverName(""); setSearchQuery(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_users">全部用戶</SelectItem>
                    <SelectItem value="all_factory_managers">全部廠商（工廠負責人 + 協管員）</SelectItem>
                    <SelectItem value="single">指定用戶</SelectItem>
                  </SelectContent>
                </Select>
                {targetType !== "single" && previewQuery.data != null && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Users className="h-3 w-3" />預計發送給 <span className="font-semibold text-foreground">{previewQuery.data.count}</span> 位用戶
                  </p>
                )}
              </div>
              {targetType === "single" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">搜尋收件人</label>
                  {receiverId ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-sm px-3 py-1">{receiverName}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => { setReceiverId(null); setReceiverName(""); }}>取消</Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="輸入姓名或 Email（至少 2 字）" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8" />
                      </div>
                      {searchQuery.trim().length >= 2 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {searchQuery_.isLoading && <div className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />搜尋中...</div>}
                          {!searchQuery_.isLoading && (searchQuery_.data ?? []).length === 0 && <div className="p-3 text-sm text-muted-foreground">找不到用戶</div>}
                          {(searchQuery_.data ?? []).map((u: any) => (
                            <button key={u.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex flex-col"
                              onClick={() => { setReceiverId(u.id); setReceiverName(`${u.name ?? "未命名"} (${u.email})`); setSearchQuery(""); }}>
                              <span className="font-medium">{u.name ?? "未命名"}</span>
                              <span className="text-muted-foreground text-xs">{u.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <Button className="w-full gap-2" onClick={handleSend} disabled={createMut.isPending}>
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                發送站內信
              </Button>
            </CardContent>
          </Card>

          {/* 已發送列表 */}
          <Card>
            <CardHeader><CardTitle className="text-base">已發送記錄</CardTitle></CardHeader>
            <CardContent>
              {campaignsQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
              {!campaignsQuery.isLoading && campaigns.length === 0 && <p className="text-center text-muted-foreground py-8 text-sm">尚無發送記錄</p>}
              <div className="space-y-3">
                {campaigns.map((c: any) => (
                  <button key={c.id} className="w-full text-left border rounded-lg p-3 hover:bg-muted/30 transition-colors"
                    onClick={() => setLocation(`/admin/messages/${c.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm line-clamp-1">{c.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-xs">{TARGET_LABELS[c.targetType] ?? c.targetType}</Badge>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.recipientCount} 人</span>
                      <span>{new Date(c.createdAt).toLocaleDateString("zh-TW")}</span>
                    </div>
                  </button>
                ))}
              </div>
              {total > 20 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
                  <span className="text-sm text-muted-foreground self-center">{page} / {Math.ceil(total / 20)}</span>
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>下一頁</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 管理員查看某封站內信的回覆列表與對話串 ──────────────────────────────────
function CampaignThreadView({ campaignId, setLocation }: { campaignId: number; setLocation: (p: string) => void }) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");

  const usersQuery = trpc.admin.getCampaignReplyingUsers.useQuery({ campaignId }, { refetchInterval: 15000 });
  const replyingUsers = usersQuery.data ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin/messages")} className="gap-1">
            <ArrowLeft className="h-4 w-4" />返回
          </Button>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />站內信對話
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 回覆用戶列表 */}
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-sm">已回覆用戶</CardTitle></CardHeader>
            <CardContent className="p-0">
              {usersQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {!usersQuery.isLoading && replyingUsers.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">尚無用戶回覆</p>
              )}
              <div className="divide-y">
                {replyingUsers.map((u: any) => (
                  <button key={u.userId}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors ${selectedUserId === u.userId ? "bg-orange-50 border-l-2 border-orange-400" : ""}`}
                    onClick={() => { setSelectedUserId(u.userId); setSelectedUserName(u.userName ?? u.userEmail ?? "用戶"); }}>
                    <p className="font-medium text-sm truncate">{u.userName ?? "未命名"}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.userEmail}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(u.latestReply).toLocaleDateString("zh-TW")}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 對話串 */}
          <Card className="lg:col-span-2 flex flex-col">
            {selectedUserId ? (
              <ThreadPanel campaignId={campaignId} userId={selectedUserId} userName={selectedUserName} />
            ) : (
              <CardContent className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                點選左側用戶查看對話
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 對話串面板（管理員用）────────────────────────────────────────────────────
function ThreadPanel({ campaignId, userId, userName }: { campaignId: number; userId: number; userName: string }) {
  const [replyText, setReplyText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const threadQuery = trpc.admin.getCampaignThread.useQuery({ campaignId, userId }, { refetchInterval: 10000 });
  const thread = threadQuery.data ?? [];

  const replyMut = trpc.admin.replyToUser.useMutation({
    onSuccess: () => {
      setReplyText("");
      utils.admin.getCampaignThread.invalidate({ campaignId, userId });
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length]);

  return (
    <>
      <CardHeader className="pb-2 border-b">
        <CardTitle className="text-sm font-semibold">{userName} 的對話</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
        {threadQuery.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!threadQuery.isLoading && thread.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-8">尚無訊息</p>
        )}
        {thread.map((msg: any) => {
          const isAdmin = msg.senderRole === "admin";
          return (
            <div key={msg.id} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isAdmin ? "bg-orange-50 border border-orange-200" : "bg-primary text-primary-foreground"}`}>
                {isAdmin && <p className="text-xs font-bold text-orange-500 mb-1">★ 平台管理員</p>}
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p className={`text-xs mt-1 ${isAdmin ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
                  {new Date(msg.createdAt).toLocaleString("zh-TW")}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </CardContent>
      <div className="p-4 border-t flex gap-2">
        <Textarea
          placeholder="輸入回覆..."
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          rows={2}
          className="resize-none"
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (replyText.trim()) replyMut.mutate({ campaignId, userId, content: replyText.trim() }); }
          }}
        />
        <Button className="shrink-0 self-end" disabled={!replyText.trim() || replyMut.isPending}
          onClick={() => { if (replyText.trim()) replyMut.mutate({ campaignId, userId, content: replyText.trim() }); }}>
          {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
