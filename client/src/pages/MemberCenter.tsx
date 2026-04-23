import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  User, Heart, Clock, Star, MessageCircle, Flag, Bell, Shield, HeadphonesIcon,
  ExternalLink, Edit2, Trash2, AlertTriangle, Phone, ArrowLeft, History, FileText, ScrollText,
} from "lucide-react";
import { Link } from "wouter";
import { StatusTimeline } from "@/components/StatusTimeline";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: "已寄出",  color: "bg-gray-100 text-gray-700" },
  received:   { label: "已收到",  color: "bg-blue-100 text-blue-700" },
  reviewing:  { label: "審查中",  color: "bg-yellow-100 text-yellow-700" },
  processing: { label: "處理中",  color: "bg-orange-100 text-orange-700" },
  resolved:   { label: "已處理",  color: "bg-green-100 text-green-700" },
};

const SUPPORT_TYPES = ["帳號問題", "交易糾紛", "檢舉申訴", "功能建議", "其他"];

const DEFAULT_NOTIFICATIONS = {
  reviewReply: true,
  newMessage: true,
  reportUpdate: true,
  ticketUpdate: true,
  announcement: false,
};

const NOTIFICATION_LABELS: Record<string, string> = {
  reviewReply:  "工廠回覆我的評價",
  newMessage:   "詢價有新訊息",
  reportUpdate: "檢舉狀態更新",
  ticketUpdate: "客服投訴狀態更新",
  announcement: "平台公告",
};

export default function MemberCenter() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user) {
    setLocation("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" size="sm" onClick={() => window.history.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" />返回
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">會員中心</h1>
            <p className="text-sm text-muted-foreground">{user.name ?? user.email}</p>
          </div>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="flex flex-wrap h-auto gap-1 mb-6 bg-white/80 p-1">
            <TabsTrigger value="profile" className="gap-1.5"><User className="w-3.5 h-3.5" />我的資料</TabsTrigger>
            <TabsTrigger value="favorites" className="gap-1.5"><Heart className="w-3.5 h-3.5" />我的收藏</TabsTrigger>
            <TabsTrigger value="recent" className="gap-1.5"><Clock className="w-3.5 h-3.5" />近期瀏覽</TabsTrigger>
            <TabsTrigger value="reviews" className="gap-1.5"><Star className="w-3.5 h-3.5" />我的評價</TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5"><MessageCircle className="w-3.5 h-3.5" />詢價紀錄</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5"><Flag className="w-3.5 h-3.5" />我的檢舉</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5"><Bell className="w-3.5 h-3.5" />通知設定</TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5"><Shield className="w-3.5 h-3.5" />帳號安全</TabsTrigger>
            <TabsTrigger value="support" className="gap-1.5"><HeadphonesIcon className="w-3.5 h-3.5" />聯繫客服</TabsTrigger>
          </TabsList>

          <TabsContent value="profile"><ProfileTab user={user} /></TabsContent>
          <TabsContent value="favorites"><RedirectTab icon={<Heart className="w-5 h-5 text-red-500" />} title="我的收藏" description="查看所有收藏的工廠" href="/favorites" /></TabsContent>
          <TabsContent value="recent"><RedirectTab icon={<Clock className="w-5 h-5 text-blue-500" />} title="近期瀏覽" description="查看最近瀏覽過的工廠" href="/favorites" /></TabsContent>
          <TabsContent value="reviews"><ReviewsTab /></TabsContent>
          <TabsContent value="messages"><RedirectTab icon={<MessageCircle className="w-5 h-5 text-green-500" />} title="詢價/對話紀錄" description="查看所有與工廠的對話" href="/messages" /></TabsContent>
          <TabsContent value="reports"><ReportsTab /></TabsContent>
          <TabsContent value="notifications"><NotificationsTab user={user} /></TabsContent>
          <TabsContent value="security"><SecurityTab /></TabsContent>
          <TabsContent value="support"><SupportTab /></TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t border-border/50 flex justify-center gap-6">
          <Link href="/privacy">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <FileText className="w-3.5 h-3.5" />
              隱私權政策
            </button>
          </Link>
          <Link href="/terms">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ScrollText className="w-3.5 h-3.5" />
              服務條款
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── 我的資料 ────────────────────────────────────────────────────────────────
function ProfileTab({ user }: { user: any }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(user.name ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");

  const updateMutation = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("資料已更新");
      utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>我的資料</CardTitle>
        <CardDescription>管理您的個人資訊</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>名稱</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="請輸入名稱" />
          </div>
          <div className="space-y-1.5">
            <Label>Email（Google 綁定）</Label>
            <Input value={user.email ?? ""} disabled className="bg-gray-50" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />手機號碼
              {user.phoneVerified && <span className="text-xs text-green-600 font-medium">已驗證</span>}
              {user.phone && !user.phoneVerified && <span className="text-xs text-yellow-600 font-medium">未驗證</span>}
            </Label>
            <div className="flex gap-2">
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx-xxxxxx" />
              <Button variant="outline" size="sm" disabled className="shrink-0">驗證（即將開放）</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>登入方式</Label>
            <Input value={user.loginMethod ?? "Google"} disabled className="bg-gray-50" />
          </div>
          <div className="space-y-1.5">
            <Label>註冊時間</Label>
            <Input value={user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW") : "—"} disabled className="bg-gray-50" />
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => updateMutation.mutate({ name: name || undefined, phone: phone || undefined })}
            disabled={updateMutation.isPending}
            className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
          >
            儲存變更
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 共用跳轉卡片 ─────────────────────────────────────────────────────────────
function RedirectTab({ icon, title, description, href }: { icon: React.ReactNode; title: string; description: string; href: string }) {
  const [, setLocation] = useLocation();
  return (
    <Card>
      <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
        {icon}
        <div className="text-center">
          <p className="font-semibold text-lg">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={() => setLocation(href)} className="gap-2">
          前往{title} <ExternalLink className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── 我的評價 ─────────────────────────────────────────────────────────────────
function ReviewsTab() {
  const utils = trpc.useUtils();
  const [editId, setEditId] = useState<number | null>(null);
  const [editRating, setEditRating] = useState(5);
  const [editComment, setEditComment] = useState("");

  const { data, isLoading } = trpc.review.myReviews.useQuery({ page: 1, pageSize: 50 });
  const updateMutation = trpc.review.update.useMutation({
    onSuccess: () => { toast.success("評價已更新"); setEditId(null); utils.review.myReviews.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.review.delete.useMutation({
    onSuccess: () => { toast.success("評價已刪除"); utils.review.myReviews.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-center py-8">載入中...</div>;
  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>我的評價</CardTitle>
        <CardDescription>共 {data?.total ?? 0} 則評價</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">尚未留下任何評價</div>
        ) : (
          <div className="space-y-4">
            {items.map((r) => (
              <div key={r.id} className="border rounded-lg p-4">
                {editId === r.id ? (
                  <div className="space-y-3">
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map(s => (
                        <button key={s} onClick={() => setEditRating(s)} className={`text-xl ${s <= editRating ? "text-yellow-400" : "text-gray-300"}`}>★</button>
                      ))}
                    </div>
                    <Textarea value={editComment} onChange={e => setEditComment(e.target.value)} rows={3} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: r.id, rating: editRating, comment: editComment })} disabled={updateMutation.isPending}>儲存</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditId(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-medium text-sm">{r.factoryName ?? "工廠"}</span>
                        <div className="flex gap-0.5 mt-0.5">
                          {[1,2,3,4,5].map(s => (
                            <span key={s} className={`text-sm ${s <= r.rating ? "text-yellow-400" : "text-gray-300"}`}>★</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(r.id); setEditRating(r.rating); setEditComment(r.comment ?? ""); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { if (confirm("確定刪除此評價？")) deleteMutation.mutate({ id: r.id }); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {r.comment && <p className="text-sm text-gray-700 mb-2">{r.comment}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("zh-TW")}</p>
                    {r.reply && (
                      <div className="mt-2 bg-gray-50 rounded p-3 text-sm border-l-2 border-orange-300">
                        <span className="text-xs font-medium text-orange-600 block mb-1">工廠回覆</span>
                        {r.reply}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 我的檢舉 ─────────────────────────────────────────────────────────────────
function ReportHistoryInline({ reportId }: { reportId: number }) {
  const { data, isLoading } = trpc.report.myReportHistory.useQuery({ id: reportId });
  return <StatusTimeline history={data} isLoading={isLoading} />;
}

function ReportsTab() {
  const { data, isLoading } = trpc.report.myReports.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);

  if (isLoading) return <div className="text-center py-8">載入中...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>我的檢舉</CardTitle>
        <CardDescription>查看您提交的所有檢舉紀錄</CardDescription>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">尚未提交任何檢舉</div>
        ) : (
          <div className="space-y-3">
            {data.map((r) => {
              const s = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
              const isOpen = openId === r.id;
              return (
                <div key={r.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{r.factoryName ?? `工廠 #${r.factoryId}`}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.reason}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(r.createdAt).toLocaleDateString("zh-TW")}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${s.color}`}>{s.label}</span>
                  </div>
                  <button
                    className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setOpenId(isOpen ? null : r.id)}
                  >
                    <History className="w-3.5 h-3.5" />
                    {isOpen ? "收起進度" : "查看進度"}
                  </button>
                  {isOpen && <ReportHistoryInline reportId={r.id} />}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 通知設定 ─────────────────────────────────────────────────────────────────
function NotificationsTab({ user }: { user: any }) {
  const utils = trpc.useUtils();
  const saved = (user.notificationSettings as Record<string, boolean> | null) ?? DEFAULT_NOTIFICATIONS;
  const [settings, setSettings] = useState<Record<string, boolean>>({ ...DEFAULT_NOTIFICATIONS, ...saved });

  const mutation = trpc.user.updateNotificationSettings.useMutation({
    onSuccess: () => { toast.success("通知設定已儲存"); utils.auth.me.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>通知設定</CardTitle>
        <CardDescription>選擇您希望接收哪些 Email 通知</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(NOTIFICATION_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between py-2 border-b last:border-0">
            <Label className="text-sm font-normal cursor-pointer">{label}</Label>
            <Switch
              checked={settings[key] ?? false}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, [key]: v }))}
            />
          </div>
        ))}
        <Button
          onClick={() => mutation.mutate({ settings })}
          disabled={mutation.isPending}
          className="mt-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
        >
          儲存設定
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── 帳號安全 ─────────────────────────────────────────────────────────────────
function SecurityTab() {
  const [confirmed, setConfirmed] = useState(false);
  const [, setLocation] = useLocation();

  const deleteMutation = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("帳號已申請刪除");
      setLocation("/");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>帳號安全</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-destructive text-sm">刪除帳號</p>
              <p className="text-sm text-muted-foreground mt-1">
                申請刪除後，您的帳號將無法登入。對話紀錄與評價紀錄會保留但切斷使用者關聯。
                若需恢復請聯繫客服。
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="confirmDelete"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="confirmDelete" className="text-sm cursor-pointer">我了解此操作無法輕易復原</label>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="mt-3"
                disabled={!confirmed || deleteMutation.isPending}
                onClick={() => {
                  if (confirm("確定要申請刪除帳號嗎？此操作會立即登出。")) {
                    deleteMutation.mutate();
                  }
                }}
              >
                申請刪除帳號
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 聯繫客服 ─────────────────────────────────────────────────────────────────
function TicketHistoryInline({ ticketId }: { ticketId: number }) {
  const { data, isLoading } = trpc.support.myTicketHistory.useQuery({ id: ticketId });
  return <StatusTimeline history={data} isLoading={isLoading} />;
}

function SupportTab() {
  const utils = trpc.useUtils();
  const [type, setType] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [tab, setTab] = useState<"form" | "history">("form");
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);

  const { data: tickets } = trpc.support.myTickets.useQuery();
  const createMutation = trpc.support.create.useMutation({
    onSuccess: () => {
      toast.success("已成功送出，我們將儘快回覆");
      setType(""); setSubject(""); setDescription("");
      setTab("history");
      utils.support.myTickets.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>聯繫客服</CardTitle>
            <CardDescription>提交問題回報或功能建議</CardDescription>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={tab === "form" ? "default" : "outline"} onClick={() => setTab("form")}>新增</Button>
            <Button size="sm" variant={tab === "history" ? "default" : "outline"} onClick={() => setTab("history")}>紀錄 {tickets && tickets.length > 0 && `(${tickets.length})`}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {tab === "form" ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-600">
              <AlertTriangle className="w-4 h-4 inline mr-1.5 text-amber-500" />
              請勿惡意投訴或濫用客服資源，若經查證為惡意行為，平台將視情況進行警告、功能限制或永久停權處理。
            </div>
            <div className="space-y-1.5">
              <Label>問題類型</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="請選擇問題類型" /></SelectTrigger>
                <SelectContent>
                  {SUPPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>主旨</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="請簡短描述問題" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>詳細描述</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="請詳細說明您的問題或建議..." />
            </div>
            <Button
              onClick={() => createMutation.mutate({ type, subject, description })}
              disabled={!type || !subject || !description || createMutation.isPending}
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
            >
              送出
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!tickets || tickets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">尚未提交任何客服工單</div>
            ) : (
              tickets.map(t => {
                const s = STATUS_LABELS[t.status] ?? STATUS_LABELS.pending;
                return (
                  <div key={t.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className="text-xs">{t.type}</Badge>
                          <span className="font-medium text-sm truncate">{t.subject}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString("zh-TW")}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${s.color}`}>{s.label}</span>
                    </div>
                    <button
                      className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setOpenTicketId(openTicketId === t.id ? null : t.id)}
                    >
                      <History className="w-3.5 h-3.5" />
                      {openTicketId === t.id ? "收起進度" : "查看進度"}
                    </button>
                    {openTicketId === t.id && <TicketHistoryInline ticketId={t.id} />}
                  </div>
                );
              })
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
