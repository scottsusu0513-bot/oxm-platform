import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Helmet } from "react-helmet-async";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Building2, Phone, Clock, User as UserIcon, Loader2, ShieldAlert,
  ArrowRight, Save, LogIn,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import {
  SHORT_VIDEO_STATUS_LABELS, SHORT_VIDEO_STATUS_TRANSITIONS,
  shortVideoServiceLabel, SHORT_VIDEO_GOALS, shortVideoPlatformLabel,
} from "@shared/shortVideoMarketing";

function statusColor(s: string): string {
  const COLORS: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    evaluating: "bg-cyan-100 text-cyan-700",
    proposal: "bg-violet-100 text-violet-700",
    in_progress: "bg-amber-100 text-amber-700",
    completed: "bg-emerald-100 text-emerald-700",
    deferred: "bg-orange-100 text-orange-700",
    no_interest: "bg-rose-100 text-rose-700",
    archived: "bg-gray-200 text-gray-600",
    unassigned: "bg-gray-100 text-gray-600",
  };
  return COLORS[s] ?? "bg-gray-100 text-gray-700";
}

function fmtTaipeiDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function goalLabel(key: string): string {
  return SHORT_VIDEO_GOALS.find(g => g.key === key)?.label ?? key;
}

function NotesEditor({ caseId, initialNotes, onMutated }: { caseId: number; initialNotes: string | null; onMutated: () => void }) {
  const [value, setValue] = useState(initialNotes ?? "");
  const mutation = trpc.shortVideoConsultant.updateCaseNotes.useMutation({
    onSuccess: () => { toast.success("備註已儲存"); onMutated(); },
    onError: (err) => toast.error(err.message || "儲存失敗"),
  });
  return (
    <div className="space-y-2">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="顧問內部備註（僅顧問／管理員可見）" className="text-sm" />
      <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ caseId, notes: value })}>
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        儲存備註
      </Button>
    </div>
  );
}

function AssignConsultantControl({ caseId, currentConsultantId, onMutated }: { caseId: number; currentConsultantId: number | null; onMutated: () => void }) {
  const { data: consultants } = trpc.shortVideoConsultant.adminListConsultants.useQuery();
  const mutation = trpc.shortVideoConsultant.adminAssignConsultant.useMutation({
    onSuccess: () => { toast.success("已更新承辦顧問"); onMutated(); },
    onError: (err) => toast.error(err.message || "指派失敗"),
  });
  const assignable = (consultants ?? []).filter(c => c.isActive && c.userId != null);
  return (
    <Select
      value={currentConsultantId != null ? String(currentConsultantId) : "none"}
      onValueChange={(v) => mutation.mutate({ caseId, consultantId: v === "none" ? null : Number(v) })}
    >
      <SelectTrigger className="h-8 text-xs w-44">
        <SelectValue placeholder="指派顧問" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">尚未指派</SelectItem>
        {assignable.map(c => (
          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CaseCard({ item, isAdmin, onMutated }: { item: any; isAdmin: boolean; onMutated: () => void }) {
  const statusMutation = trpc.shortVideoConsultant.updateCaseStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); onMutated(); },
    onError: (err) => toast.error(err.message || "更新失敗"),
  });
  const nextOptions = SHORT_VIDEO_STATUS_TRANSITIONS[item.status] ?? [];
  const services: string[] = item.isUnsure ? ["不確定，希望由顧問協助判斷"] : (item.servicesWanted ?? []).map((k: string) => shortVideoServiceLabel(k));
  // 經營平台：noPlatformYet 與 platforms 互斥（同申請表），舊資料兩者皆缺時顯示「未填寫」，
  // 不得直接印出英文代碼／JSON／null／空陣列。
  const platforms: string[] = Array.isArray(item.platforms) ? item.platforms : [];

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-semibold truncate">{item.companyNameSnapshot}</span>
              <Badge className={statusColor(item.status)}>{SHORT_VIDEO_STATUS_LABELS[item.status as keyof typeof SHORT_VIDEO_STATUS_LABELS] ?? item.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">{item.companyAddressSnapshot}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-muted-foreground" />聯絡人：{item.contactName}</div>
          <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" />電話：{item.phone}</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />方便聯絡時間：{item.contactTime}</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />送出時間：{fmtTaipeiDateTime(item.createdAt)}</div>
        </div>

        <div className="text-sm space-y-1">
          <p><span className="text-muted-foreground">想了解的服務：</span>{services.join("、")}</p>
          <p><span className="text-muted-foreground">主要目標：</span>{goalLabel(item.primaryGoal)}</p>
          {item.noPlatformYet ? (
            <p><span className="text-muted-foreground">經營平台：</span>尚未經營</p>
          ) : platforms.length > 0 ? (
            <div className="flex items-start gap-1.5 flex-wrap">
              <span className="text-muted-foreground shrink-0">經營平台：</span>
              <div className="flex flex-wrap gap-1.5">
                {platforms.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs font-normal">{shortVideoPlatformLabel(p)}</Badge>
                ))}
              </div>
            </div>
          ) : (
            <p><span className="text-muted-foreground">經營平台：</span>未填寫</p>
          )}
          {item.additionalNotes && <p className="text-xs text-muted-foreground">補充需求：{item.additionalNotes}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-2">
          <span>最後更新者：{item.lastUpdatedByNameSnapshot || "尚無更新紀錄"}</span>
          <span>最後更新時間：{fmtTaipeiDateTime(item.updatedAt)}</span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">承辦顧問：</span>
            <AssignConsultantControl caseId={item.id} currentConsultantId={item.assignedConsultantId} onMutated={onMutated} />
          </div>
        )}

        <NotesEditor caseId={item.id} initialNotes={item.notes} onMutated={onMutated} />

        {nextOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {nextOptions.map(opt => (
              <Button key={opt} size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ caseId: item.id, nextStatus: opt as any })}>
                {SHORT_VIDEO_STATUS_LABELS[opt]}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoginRequiredView() {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center">
          <LogIn className="w-8 h-8 text-orange-600" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold">請先登入</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">登入後，若您是啟用中的短影音顧問或管理員，即可查看案件看板。</p>
        </div>
        <Button className="w-full max-w-xs bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0" onClick={() => setLoginOpen(true)}>
          <LogIn className="w-4 h-4 mr-2" />
          前往登入
        </Button>
      </div>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}

function NoPermissionView({ message }: { message?: string }) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-4 max-w-sm mx-auto">
        <ShieldAlert className="w-8 h-8 text-red-500" />
        <h2 className="text-xl font-bold">無法存取</h2>
        <p className="text-muted-foreground text-sm">{message || "您目前不是啟用中的短影音顧問，也不是管理員。"}</p>
        <Link href="/"><Button variant="outline">返回首頁</Button></Link>
      </div>
    </div>
  );
}

export default function ShortVideoConsultantCases() {
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const casesQuery = trpc.shortVideoConsultant.myCases.useQuery({}, {
    enabled: !!user,
    retry: false,
  });

  function handleMutated() {
    utils.shortVideoConsultant.myCases.invalidate();
  }

  if (authLoading) return <AppLoading />;
  if (!user) return <LoginRequiredView />;
  if (casesQuery.isPending) return <AppLoading />;
  if (casesQuery.error) return <NoPermissionView message={casesQuery.error.message} />;

  const items = casesQuery.data ?? [];
  const isAdmin = !!user.isAdmin;

  return (
    <div className="min-h-screen bg-background">
      <Helmet><title>短影音顧問案件看板｜OXM</title></Helmet>
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className="container py-8 md:py-12 max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl md:text-2xl font-bold">短影音與品牌內容行銷案件看板</h1>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">目前沒有指派給您的案件。</p>
        ) : (
          <div className="space-y-4">
            {items.map((item: any) => (
              <CaseCard key={item.id} item={item} isAdmin={isAdmin} onMutated={handleMutated} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
