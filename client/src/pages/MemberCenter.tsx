import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
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
  Smartphone, Mail, ClipboardList,
} from "lucide-react";
import { Link } from "wouter";
import { StatusTimeline } from "@/components/StatusTimeline";
import { OrderTimelineBar } from "@/components/OrderTimelineBar";
import { initPushNotifications } from "@/lib/pushNotifications";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { NativePullToRefreshLayout } from "@/components/NativePullToRefreshLayout";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: "已寄出",  color: "bg-gray-100 text-gray-700" },
  received:   { label: "已收到",  color: "bg-blue-100 text-blue-700" },
  reviewing:  { label: "審查中",  color: "bg-yellow-100 text-yellow-700" },
  processing: { label: "處理中",  color: "bg-orange-100 text-orange-700" },
  resolved:   { label: "已處理",  color: "bg-green-100 text-green-700" },
};

const SUPPORT_TYPES = ["帳號問題", "交易糾紛", "檢舉申訴", "功能建議", "其他"];

const DEFAULT_NOTIFICATIONS: Record<string, boolean> = {
  // Email 設定（沿用既有 key，不改動後端寄信邏輯）
  reviewReply: true,
  newMessage: true,
  reportUpdate: true,
  ticketUpdate: true,
  announcement: false,
  // Push 設定（新增，本階段只存 DB，下階段才接推播）
  pushEnabled: false,
  pushNewMessage: true,
  pushReviewReply: true,
  pushReportUpdate: true,
  pushTicketUpdate: true,
  pushAnnouncement: false,
};

const NOTIFICATION_ROWS = [
  {
    label: "工廠回覆我的評價",
    description: "當工廠回覆你的評價時通知你",
    emailKey: "reviewReply",
    pushKey: "pushReviewReply",
  },
  {
    label: "詢價有新訊息",
    description: "包含新訊息、商品詢問、一鍵詢價與工廠回覆",
    emailKey: "newMessage",
    pushKey: "pushNewMessage",
  },
  {
    label: "檢舉狀態更新",
    description: "當你的檢舉案件有狀態更新時通知你",
    emailKey: "reportUpdate",
    pushKey: "pushReportUpdate",
  },
  {
    label: "客服投訴狀態更新",
    description: "當你的客服工單有回覆或狀態更新時通知你",
    emailKey: "ticketUpdate",
    pushKey: "pushTicketUpdate",
  },
  {
    label: "平台公告",
    description: "包含系統維護、功能更新與重要平台訊息",
    emailKey: "announcement",
    pushKey: "pushAnnouncement",
  },
];

export default function MemberCenter() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.review.myReviews.invalidate(),
      utils.report.myReports.invalidate(),
    ]);
  }, [utils]);
  const { contentRef, indicatorRef, iconRef, phase } = usePullToRefresh({ onRefresh: handleRefresh });

  if (authLoading) return <AppLoading />;
  if (!user) {
    setLocation("/");
    return null;
  }

  return (
    <NativePullToRefreshLayout contentRef={contentRef} indicatorRef={indicatorRef} iconRef={iconRef} phase={phase} className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
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
            <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="w-3.5 h-3.5" />個人訂單</TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5"><MessageCircle className="w-3.5 h-3.5" />詢價紀錄</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5"><Flag className="w-3.5 h-3.5" />我的檢舉</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5"><Bell className="w-3.5 h-3.5" />通知設定</TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5"><Shield className="w-3.5 h-3.5" />帳號安全</TabsTrigger>
            <TabsTrigger value="support" className="gap-1.5"><HeadphonesIcon className="w-3.5 h-3.5" />聯繫客服</TabsTrigger>
          </TabsList>

          <TabsContent value="profile"><ProfileTab user={user} /></TabsContent>
          <TabsContent value="favorites"><RedirectTab icon={<Heart className="w-5 h-5 text-red-500" />} title="我的收藏" description="查看所有收藏的工廠" href="/favorites" /></TabsContent>
          <TabsContent value="recent"><RedirectTab icon={<Clock className="w-5 h-5 text-blue-500" />} title="近期瀏覽" description="查看最近瀏覽過的工廠" href="/favorites" /></TabsContent>
          <TabsContent value="orders"><PersonalOrdersTab /></TabsContent>
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
    </NativePullToRefreshLayout>
  );
}

// ─── 登入方式 ─────────────────────────────────────────────────────────────────
const KNOWN_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "line",   label: "LINE" },
  { id: "apple",  label: "Apple" },
] as const;

function LinkedProvidersSection() {
  const { data, isLoading } = trpc.auth.myLinkedProviders.useQuery();
  return (
    <div className="sm:col-span-2 space-y-2 pt-1">
      <p className="text-sm font-medium leading-none">登入方式</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">載入中…</p>
      ) : (
        <div className="divide-y rounded-md border">
          {KNOWN_PROVIDERS.map(p => {
            const bound = data?.some(a => a.provider === p.id);
            return (
              <div key={p.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{p.label}</span>
                {bound
                  ? <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">已綁定</Badge>
                  : <Badge className="bg-gray-100 text-gray-400 border-gray-200 text-xs">尚未綁定</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 我的資料 ────────────────────────────────────────────────────────────────
function PrimaryEmailSection({ user }: { user: any }) {
  const utils = trpc.useUtils();
  const [emailInput, setEmailInput] = useState(user.primaryEmail ?? "");
  const [sending, setSending] = useState(false);

  const isVerified = !!user.primaryEmailVerifiedAt;
  const hasPrimary = !!user.primaryEmail;

  const setEmailMut = trpc.auth.setPrimaryEmail.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const sendVerifMut = trpc.auth.sendVerificationEmail.useMutation({
    onSuccess: (res) => {
      if (res.alreadyVerified) {
        toast.success("此信箱已驗證完成");
      } else {
        toast.success("驗證信已寄出，請前往信箱完成驗證。");
      }
      setSending(false);
    },
    onError: (e) => { toast.error(e.message); setSending(false); },
  });

  async function handleSend() {
    setSending(true);
    const trimmed = emailInput.trim();
    if (!hasPrimary || trimmed !== user.primaryEmail) {
      await setEmailMut.mutateAsync({ email: trimmed });
    }
    sendVerifMut.mutate();
  }

  return (
    <div className="space-y-1.5 sm:col-span-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Label>主要信箱</Label>
        {isVerified && (
          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-2">已驗證</Badge>
        )}
        {!isVerified && hasPrimary && (
          <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs px-2">待驗證</Badge>
        )}
        {!isVerified && !hasPrimary && (
          <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs px-2">尚未設定</Badge>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          placeholder="請輸入可接收通知的主要信箱"
          readOnly={isVerified}
          className={isVerified ? "bg-gray-50" : ""}
        />
        {!isVerified && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={!emailInput.trim() || sending || setEmailMut.isPending || sendVerifMut.isPending}
            onClick={handleSend}
          >
            {sending || setEmailMut.isPending || sendVerifMut.isPending
              ? "寄送中…"
              : hasPrimary ? "重新寄送驗證信" : "寄送驗證信"}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        主要信箱用於接收詢價、合作確認、系統通知與客服回覆。完成驗證後，即可使用完整會員功能。
      </p>
    </div>
  );
}

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
            <Label>註冊時間</Label>
            <Input value={user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW") : "—"} disabled className="bg-gray-50" />
          </div>
          <PrimaryEmailSection user={user} />
          <LinkedProvidersSection />
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
    onSuccess: (_, vars) => {
      toast.success("評價已更新");
      setEditId(null);
      utils.review.myReviews.invalidate();
      const factoryId = data?.items?.find((r: any) => r.id === vars.id)?.factoryId;
      if (factoryId) utils.review.getByFactory.invalidate({ factoryId });
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.review.delete.useMutation({
    onSuccess: (_, vars) => {
      toast.success("評價已刪除");
      const factoryId = data?.items?.find((r: any) => r.id === vars.id)?.factoryId;
      utils.review.myReviews.invalidate();
      if (factoryId) utils.review.getByFactory.invalidate({ factoryId });
    },
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
  const saved = (user.notificationSettings as Record<string, boolean> | null) ?? {};
  // settings：顯示用，合併預設值與已存設定
  const [settings, setSettings] = useState<Record<string, boolean>>({ ...DEFAULT_NOTIFICATIONS, ...saved });
  // dirtySettings：只記錄本次有變更的 key，按儲存時只送這份
  const [dirtySettings, setDirtySettings] = useState<Record<string, boolean>>({});
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    import("@capacitor/core").then(({ Capacitor }) => {
      setIsNativeApp(Capacitor.isNativePlatform());
    }).catch(() => {});
  }, []);

  const registerPushToken = trpc.notification.registerPushToken.useMutation();
  const pendingPushInitRef = useRef(false);
  const silentInitAttemptedRef = useRef(false); // 確保同一生命週期只自動 init 一次

  // 若 pushEnabled 已是 true（前次儲存），isNativeApp 確認後靜默執行一次 init
  // 解決：設定頁重開時 dirtySettings 為空、不觸發 initPushNotifications 的問題
  useEffect(() => {
    if (!isNativeApp) return;                         // 1. 只在 native 執行，Web 直接返回
    if (!(settings.pushEnabled ?? false)) return;
    if (silentInitAttemptedRef.current) return;       // 2. 同一生命週期只跑一次
    silentInitAttemptedRef.current = true;
    initPushNotifications(async (input) => {
      await registerPushToken.mutateAsync(input);
    }).then(result => {
      if (result !== "success" && result !== "not_native") {
        console.warn("[Push] auto-init result:", result); // 3. 失敗只 console.warn，不 toast
      }
    }).catch(e => console.warn("[Push] auto-init failed:", e));
  }, [isNativeApp]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = trpc.user.updateNotificationSettings.useMutation({
    onSuccess: async () => {
      toast.success("通知設定已儲存");
      const shouldInitPush = pendingPushInitRef.current;
      pendingPushInitRef.current = false;
      setDirtySettings({});
      utils.auth.me.invalidate();

      if (shouldInitPush) {
        try {
          const result = await initPushNotifications(async (input) => {
            await registerPushToken.mutateAsync(input);
          });
          if (result === "success") {
            toast.success("手機推播通知已開啟");
          } else if (result === "denied") {
            toast.warning("尚未允許系統通知，請到手機設定中開啟 OXM 通知");
          } else if (result === "plugin_unavailable") {
            toast.warning("目前無法啟用手機推播，請更新至最新版 OXM App 後再試");
          } else if (result === "error") {
            toast.warning("手機推播啟用失敗，請稍後再試");
          }
          // pushEnabled 設定已儲存成功，不因 push init 結果而回滾
        } catch (e) {
          console.warn("[Push] init failed after settings save", e);
          toast.warning("手機推播啟用時發生問題，請稍後再試");
        }
      }
    },
    onError: (e) => {
      pendingPushInitRef.current = false;
      toast.error(e.message);
    },
  });

  // 同時更新顯示狀態和髒標記
  const markChanged = (key: string, v: boolean) => {
    setSettings(prev => ({ ...prev, [key]: v }));
    setDirtySettings(prev => ({ ...prev, [key]: v }));
  };

  const pushMasterOn = settings.pushEnabled ?? false;
  const pushItemDisabled = !isNativeApp || !pushMasterOn;
  const hasDirty = Object.keys(dirtySettings).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>通知設定</CardTitle>
        <CardDescription>選擇您希望接收哪些 OXM 通知。手機通知需使用 OXM App 開啟。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ── 手機推播總開關 ── */}
        <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-muted/40 border">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">手機推播通知</p>
              <p className="text-xs text-muted-foreground">允許 OXM 在手機上發送即時通知</p>
              {!isNativeApp && (
                <p className="text-xs text-orange-500 pt-0.5">請使用 OXM App 開啟手機推播通知</p>
              )}
              {isNativeApp && !pushMasterOn && (
                <p className="text-xs text-muted-foreground pt-0.5">開啟後，下方手機通知分類才會生效</p>
              )}
            </div>
          </div>
          {/* disabled on web → onCheckedChange 不觸發 → pushEnabled 不進 dirtySettings */}
          <Switch
            disabled={!isNativeApp}
            checked={pushMasterOn}
            onCheckedChange={(v) => markChanged("pushEnabled", v)}
            className={!isNativeApp ? "opacity-40 shrink-0" : "shrink-0"}
          />
        </div>

        {/* ── 通知分類表 ── */}
        <div>
          {/* 欄位標頭 */}
          <div className="flex items-center gap-3 pb-2 border-b">
            <div className="flex-1" />
            <div className="flex gap-1 shrink-0">
              <div className="w-[72px] flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                <Mail className="w-3 h-3" />
                <span>Email</span>
              </div>
              <div className="w-[72px] flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                <Smartphone className="w-3 h-3" />
                <span>手機</span>
              </div>
            </div>
          </div>

          {/* 通知列 */}
          {NOTIFICATION_ROWS.map(({ label, description, emailKey, pushKey }) => (
            <div key={emailKey} className="flex items-center gap-3 py-3 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {/* Email 開關：Web / APP 都可操作，只送 emailKey */}
                <div className="w-[72px] flex justify-center">
                  <Switch
                    checked={settings[emailKey] ?? false}
                    onCheckedChange={(v) => markChanged(emailKey, v)}
                  />
                </div>
                {/* 手機推播開關：Web disabled → onCheckedChange 不觸發 → pushKey 不進 dirtySettings */}
                <div className="w-[72px] flex justify-center">
                  <Switch
                    disabled={pushItemDisabled}
                    checked={settings[pushKey] ?? false}
                    onCheckedChange={(v) => markChanged(pushKey, v)}
                    className={pushItemDisabled ? "opacity-40" : ""}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={() => {
            if (!hasDirty) return;
            // 如果本次儲存包含 pushEnabled=true 且在 native app，儲存成功後執行 initPushNotifications
            pendingPushInitRef.current = isNativeApp && dirtySettings.pushEnabled === true;
            mutation.mutate({ settings: dirtySettings });
          }}
          disabled={mutation.isPending || !hasDirty}
          className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 disabled:opacity-50"
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

// ─── 個人訂單 ─────────────────────────────────────────────────────────────────
const PERSONAL_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待需求方同意",
  accepted: "已成立",
  rejected: "已拒絕",
  in_progress: "製作中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  cancel_requested: "取消申請中",
};

const PERSONAL_ORDER_STATUS_CLASS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  completed: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-100 text-gray-600",
  cancel_requested: "bg-red-100 text-red-700",
};

function PersonalOrdersTab() {
  const { data: orders = [], isLoading } = trpc.collaborationOrder.listPersonal.useQuery();
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">載入中…</CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>個人訂單</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
            <ClipboardList className="w-12 h-12 opacity-30" />
            <div>
              <p className="text-base font-medium text-foreground">尚無個人訂單</p>
              <p className="text-sm mt-2 text-muted-foreground">以個人身分建立或承接的訂單，未來會顯示在這裡。</p>
              <p className="text-xs mt-2 text-muted-foreground">如果你選擇以工廠身分承接訂單，該訂單會顯示在對應工廠後台的「訂單管理」中。</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sortedOrders = [...orders].sort((a, b) => {
    const aC = a.status === "completed";
    const bC = b.status === "completed";
    if (aC === bC) return 0;
    return aC ? 1 : -1;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>個人訂單</CardTitle>
        <CardDescription>以個人身分建立或承接的合作確認單</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sortedOrders.map(order => {
          const isCompleted = order.status === "completed";
          const isExpanded = expandedIds.has(order.id);
          const backTo = encodeURIComponent("/member");

          if (isCompleted && !isExpanded) {
            return (
              <div key={order.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 opacity-80">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-600 truncate">{order.projectName}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-400">
                      {order.factoryName && <span>供應：{order.factoryName}</span>}
                      {order.completedAt && (
                        <span>完成：{new Date(order.completedAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}</span>
                      )}
                    </div>
                    {order.completionNote && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{order.completionNote}</p>
                    )}
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800 shrink-0">已完成</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                    onClick={() => setExpandedIds(prev => new Set(prev).add(order.id))}
                  >
                    展開 ▾
                  </button>
                  <div className="ml-auto">
                    <Link href={`/orders/${order.id}?backTo=${backTo}`} className="text-xs text-orange-600 hover:underline font-medium">
                      查看訂單 →
                    </Link>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={order.id} className={`rounded-lg border p-3 space-y-2 ${isCompleted ? "border-gray-200 bg-gray-50 opacity-80" : ""}`}>
              {/* Header */}
              <div className="flex items-start gap-2">
                <div className="shrink-0" style={{ minWidth: "28%" }}>
                  <p className={`font-medium text-sm leading-tight ${isCompleted ? "text-gray-600" : ""}`}>{order.projectName}</p>
                  {order.factoryName ? (
                    <p className="text-xs text-muted-foreground mt-0.5">供應：{order.factoryName}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">手動輸入</p>
                  )}
                </div>
                <div className="flex-1 hidden sm:grid sm:grid-cols-3 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {order.depositDueDate && <span>首款：{order.depositDueDate.slice(5).replace("-", "/")}</span>}
                  {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                  {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                  <span>建立：{new Date(order.createdAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${PERSONAL_ORDER_STATUS_CLASS[order.status] ?? PERSONAL_ORDER_STATUS_CLASS.pending}`}>
                  {PERSONAL_ORDER_STATUS_LABEL[order.status] ?? order.status}
                </span>
              </div>
              {/* Mobile metadata */}
              <div className="grid grid-cols-2 sm:hidden gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {order.expectedShipmentDate && <span>出貨：{order.expectedShipmentDate.slice(5).replace("-", "/")}</span>}
                {order.finalPaymentDueDate && <span>尾款：{order.finalPaymentDueDate.slice(5).replace("-", "/")}</span>}
                <span className="col-span-2">建立：{new Date(order.createdAt).toLocaleDateString("zh-TW")}</span>
              </div>

              {/* Timeline bar */}
              <OrderTimelineBar order={order} compact />

              {/* Completion note for expanded completed cards */}
              {isCompleted && order.completionNote && (
                <p className="text-xs text-gray-500 bg-white border rounded px-2 py-1.5">
                  完成備註：{order.completionNote}
                </p>
              )}

              {/* Links */}
              <div className="flex items-center gap-2">
                {isCompleted && (
                  <button
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                    onClick={() => setExpandedIds(prev => { const s = new Set(prev); s.delete(order.id); return s; })}
                  >
                    收合 ▴
                  </button>
                )}
                <div className={`flex gap-3 ${isCompleted ? "ml-auto" : ""}`}>
                  <Link href={`/orders/${order.id}?backTo=${backTo}`} className="text-xs text-orange-600 hover:underline font-medium">
                    查看訂單 →
                  </Link>
                  <Link href={`/chat/${order.conversationId}`} className="text-xs text-blue-600 hover:underline">
                    查看對話 →
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground text-center pt-2">
          如果你選擇以工廠身分承接訂單，該訂單會顯示在對應工廠後台的「訂單管理」中。
        </p>
      </CardContent>
    </Card>
  );
}
