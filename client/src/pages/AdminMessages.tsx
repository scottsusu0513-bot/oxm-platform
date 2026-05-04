import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Send, Users, Search, Loader2 } from "lucide-react";
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

  return <AdminMessagesContent setLocation={setLocation} />;
}

function AdminMessagesContent({ setLocation }: { setLocation: (path: string) => void }) {
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
      setTitle("");
      setContent("");
      setTargetType("all_users");
      setReceiverId(null);
      setReceiverName("");
      setSearchQuery("");
      utils.admin.getMessageCampaigns.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSend = () => {
    if (!title.trim()) { toast.error("請填寫標題"); return; }
    if (!content.trim()) { toast.error("請填寫內容"); return; }
    if (targetType === "single" && !receiverId) { toast.error("請選擇收件人"); return; }
    createMut.mutate({
      title: title.trim(),
      content: content.trim(),
      targetType,
      receiverId: receiverId ?? undefined,
    });
  };

  const campaigns = campaignsQuery.data?.items ?? [];
  const total = campaignsQuery.data?.total ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setLocation("/admin")} className="gap-1">
              <ArrowLeft className="h-4 w-4" />返回
            </Button>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Send className="h-6 w-6" />站內信管理
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 發送表單 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">發送新站內信</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">標題</label>
                <Input
                  placeholder="請輸入標題（最多 200 字）"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">內容</label>
                <Textarea
                  placeholder="請輸入訊息內容..."
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  rows={5}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">發送對象</label>
                <Select value={targetType} onValueChange={(v: any) => { setTargetType(v); setReceiverId(null); setReceiverName(""); setSearchQuery(""); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_users">全部用戶</SelectItem>
                    <SelectItem value="all_factory_managers">全部廠商（工廠負責人 + 協管員）</SelectItem>
                    <SelectItem value="single">指定用戶</SelectItem>
                  </SelectContent>
                </Select>

                {targetType !== "single" && previewQuery.data != null && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    預計發送給 <span className="font-semibold text-foreground">{previewQuery.data.count}</span> 位用戶
                  </p>
                )}
              </div>

              {targetType === "single" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">搜尋收件人</label>
                  {receiverId ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-sm px-3 py-1">{receiverName}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => { setReceiverId(null); setReceiverName(""); }}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="輸入姓名或 Email（至少 2 字）"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      {searchQuery.trim().length >= 2 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {searchQuery_.isLoading && (
                            <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" />搜尋中...
                            </div>
                          )}
                          {!searchQuery_.isLoading && (searchQuery_.data ?? []).length === 0 && (
                            <div className="p-3 text-sm text-muted-foreground">找不到用戶</div>
                          )}
                          {(searchQuery_.data ?? []).map((u: any) => (
                            <button
                              key={u.id}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex flex-col"
                              onClick={() => { setReceiverId(u.id); setReceiverName(`${u.name ?? "未命名"} (${u.email})`); setSearchQuery(""); }}
                            >
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

              <Button
                className="w-full gap-2"
                onClick={handleSend}
                disabled={createMut.isPending}
              >
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                發送站內信
              </Button>
            </CardContent>
          </Card>

          {/* 已發送列表 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">已發送記錄</CardTitle>
            </CardHeader>
            <CardContent>
              {campaignsQuery.isLoading && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!campaignsQuery.isLoading && campaigns.length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">尚無發送記錄</p>
              )}
              <div className="space-y-3">
                {campaigns.map((c: any) => (
                  <div key={c.id} className="border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm line-clamp-1">{c.title}</p>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {TARGET_LABELS[c.targetType] ?? c.targetType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />{c.recipientCount} 人
                      </span>
                      <span>{new Date(c.createdAt).toLocaleDateString("zh-TW")}</span>
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
    </div>
  );
}
