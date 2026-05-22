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
import { ArrowLeft, Send, Users, Search, Loader2, MessageSquare, ChevronRight, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [retractTarget, setRetractTarget] = useState<{ id: number; title: string } | null>(null);
  const [retractReason, setRetractReason] = useState("");

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
  const retractMut = trpc.admin.retractAdminMessage.useMutation({
    onSuccess: () => {
      toast.success("站內信已撤回，用戶端將不再顯示");
      setRetractTarget(null);
      setRetractReason("");
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
                  <div
                    key={c.id}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                      c.deletedAt
                        ? "opacity-60 bg-muted/20 hover:bg-muted/30"
                        : c.replyCount > 0
                          ? "bg-orange-50 border-orange-200 hover:bg-orange-100/70"
                          : "hover:bg-muted/30"
                    }`}
                    onClick={() => setLocation(`/admin/messages/${c.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm line-clamp-1 flex-1 min-w-0">{c.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {c.replyCount > 0 && !c.deletedAt && (
                          <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-100">新回覆</Badge>
                        )}
                        {c.deletedAt ? (
                          <Badge variant="destructive" className="text-xs">已撤回</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">{TARGET_LABELS[c.targetType] ?? c.targetType}</Badge>
                        )}
                        {!c.deletedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            title="撤回站內信"
                            onClick={(e) => { e.stopPropagation(); setRetractTarget({ id: c.id, title: c.title }); setRetractReason(""); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.recipientCount} 人</span>
                      <span>{new Date(c.createdAt).toLocaleDateString("zh-TW")}</span>
                      {c.latestReplyAt && !c.deletedAt && (
                        <span className="text-orange-600 flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          最後回覆 {new Date(c.latestReplyAt).toLocaleDateString("zh-TW")}
                        </span>
                      )}
                      {c.deletedAt && (
                        <span className="text-destructive">撤回於 {new Date(c.deletedAt).toLocaleDateString("zh-TW")}{c.deleteReason ? `：${c.deleteReason}` : ""}</span>
                      )}
                    </div>
                  </div>
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

      {/* 撤回確認 Dialog */}
      <AlertDialog open={!!retractTarget} onOpenChange={(open) => { if (!open) { setRetractTarget(null); setRetractReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認撤回站內信</AlertDialogTitle>
            <AlertDialogDescription>
              此操作會將這封站內信從所有收件人的站內信列表中隱藏，但後台仍保留紀錄。
              <br /><br />
              <span className="font-medium text-foreground">「{retractTarget?.title}」</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <label className="text-sm font-medium mb-1 block">撤回原因（選填）</label>
            <Input
              placeholder="例：內容有誤，已重新發送"
              value={retractReason}
              onChange={e => setRetractReason(e.target.value)}
              maxLength={200}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => retractTarget && retractMut.mutate({ campaignId: retractTarget.id, reason: retractReason })}
              disabled={retractMut.isPending}
            >
              {retractMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              確認撤回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 管理員查看某封站內信的回覆列表與對話串 ──────────────────────────────────
function CampaignThreadView({ campaignId, setLocation }: { campaignId: number; setLocation: (p: string) => void }) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");
  const utils = trpc.useUtils();

  const campaignQuery = trpc.admin.getMessageCampaignDetail.useQuery({ campaignId });
  const usersQuery = trpc.admin.getCampaignAllRecipients.useQuery({ campaignId }, { refetchInterval: 15000 });
  const campaign = campaignQuery.data;
  const allRecipients = usersQuery.data ?? [];

  const markViewedMut = trpc.admin.markCampaignRecipientViewed.useMutation({
    onSuccess: () => {
      utils.admin.getCampaignAllRecipients.invalidate({ campaignId });
      utils.admin.getMessageCampaigns.invalidate();
      utils.admin.getAdminNotifications.invalidate();
    },
  });

  const handleSelectRecipient = (userId: number, userName: string) => {
    setSelectedUserId(userId);
    setSelectedUserName(userName);
    markViewedMut.mutate({ campaignId, recipientUserId: userId });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="outline" size="sm" onClick={() => setLocation("/admin/messages")} className="gap-1">
            <ArrowLeft className="h-4 w-4" />返回
          </Button>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />站內信對話
          </h1>
        </div>

        {/* 站內信基本資訊 */}
        {campaign && (
          <Card className="mb-4 border-orange-200 bg-orange-50/40">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">標題</p>
                  <p className="font-semibold">{campaign.title}</p>
                </div>
                <div className="flex gap-6 shrink-0 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">發送對象</p>
                    <Badge variant="outline" className="text-xs">{TARGET_LABELS[campaign.targetType] ?? campaign.targetType}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">收件人數</p>
                    <p className="font-semibold flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />{Number(campaign.recipientCount)} 人
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">發送時間</p>
                    <p className="text-sm flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(campaign.createdAt).toLocaleString("zh-TW")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                站內信已成功發送
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 收件人列表 */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-sm">收件人</CardTitle></CardHeader>
            <CardContent className="p-0">
              {usersQuery.isLoading && (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
              {!usersQuery.isLoading && allRecipients.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">尚無收件人資料。</p>
              )}
              <div className="divide-y">
                {allRecipients.map((u: any) => {
                  const hasUnreadReply = !!u.hasUnreadReply;
                  const hasReplied = !!u.latestUserReplyAt;
                  return (
                    <button key={u.userId}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        selectedUserId === u.userId
                          ? "bg-orange-50 border-l-2 border-orange-400"
                          : hasUnreadReply
                            ? "bg-orange-50/70 border-l-2 border-orange-300 hover:bg-orange-100/50"
                            : hasReplied
                              ? "bg-amber-50/40 hover:bg-muted/30"
                              : "hover:bg-muted/30"
                      }`}
                      onClick={() => handleSelectRecipient(u.userId, u.userName ?? u.userEmail ?? "用戶")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{u.userName ?? "未命名"}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.userEmail}</p>
                        </div>
                        {hasUnreadReply && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full shrink-0">新回覆</span>
                        )}
                        {!hasUnreadReply && hasReplied && (
                          <span className="text-xs text-muted-foreground shrink-0">已回覆</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 對話串 */}
          <Card className="lg:col-span-2 flex flex-col">
            {selectedUserId && campaign ? (
              <ThreadPanel campaignId={campaignId} userId={selectedUserId} userName={selectedUserName} campaign={campaign} />
            ) : (
              <CardContent className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground text-sm gap-2">
                <MessageSquare className="h-8 w-8 opacity-20" />
                <p>點選左側收件人查看內容</p>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 對話串面板（管理員用）────────────────────────────────────────────────────
type CampaignInfo = { title: string; content: string; createdAt: string | Date };

function ThreadPanel({ campaignId, userId, userName, campaign }: { campaignId: number; userId: number; userName: string; campaign: CampaignInfo }) {
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
        {/* 原始站內信內容 */}
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-orange-50 border border-orange-200">
            <p className="text-xs font-bold text-orange-500 mb-1">★ 平台管理員（原始站內信）</p>
            <p className="font-medium mb-1">{campaign.title}</p>
            <p className="whitespace-pre-wrap">{campaign.content}</p>
            <p className="text-xs mt-1 text-muted-foreground">
              {new Date(campaign.createdAt).toLocaleString("zh-TW")}
            </p>
          </div>
        </div>

        {threadQuery.isLoading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!threadQuery.isLoading && thread.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-4">目前沒有後續訊息</p>
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
