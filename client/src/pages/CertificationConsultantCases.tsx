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
  ArrowRight, Save, LogIn, Inbox, History,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { CaseStatusOverview, type CaseStatusDef, type CaseStatusColor } from "@/components/CaseStatusOverview";
import {
  CERTIFICATION_CASE_STATUSES, CERTIFICATION_STATUS_LABELS, CERTIFICATION_STATUS_TRANSITIONS,
  CERTIFICATION_EXCEPTION_STATUSES, type CertificationCaseStatus,
} from "@shared/certificationCase";

// 狀態統計卡顏色僅供視覺分類，不影響狀態邏輯本身。
const CERTIFICATION_STATUS_COLORS: Record<string, CaseStatusColor> = {
  new: "blue",
  needs_interview: "cyan",
  scope_assessment: "cyan",
  proposal: "violet",
  in_progress: "amber",
  pre_review: "amber",
  verification: "teal",
  completed: "emerald",
  deferred: "orange",
  no_interest: "rose",
  not_applicable: "red",
  archived: "slate",
  unassigned: "slate",
};

const CERTIFICATION_STATUS_DEFS: CaseStatusDef[] = CERTIFICATION_CASE_STATUSES.map(key => ({
  key,
  label: CERTIFICATION_STATUS_LABELS[key],
  color: CERTIFICATION_STATUS_COLORS[key] ?? "slate",
}));

function statusColor(s: string): string {
  const COLORS: Record<string, string> = {
    unassigned: "bg-gray-100 text-gray-600",
    new: "bg-blue-100 text-blue-700",
    needs_interview: "bg-cyan-100 text-cyan-700",
    scope_assessment: "bg-sky-100 text-sky-700",
    proposal: "bg-violet-100 text-violet-700",
    in_progress: "bg-amber-100 text-amber-700",
    pre_review: "bg-yellow-100 text-yellow-700",
    verification: "bg-indigo-100 text-indigo-700",
    completed: "bg-emerald-100 text-emerald-700",
    deferred: "bg-orange-100 text-orange-700",
    no_interest: "bg-rose-100 text-rose-700",
    not_applicable: "bg-stone-200 text-stone-700",
    archived: "bg-gray-200 text-gray-600",
  };
  return COLORS[s] ?? "bg-gray-100 text-gray-700";
}

function fmtTaipeiDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function NotesEditor({ caseId, initialNotes, onMutated }: { caseId: number; initialNotes: string | null; onMutated: () => void }) {
  const [value, setValue] = useState(initialNotes ?? "");
  const mutation = trpc.certificationConsultant.updateCaseNotes.useMutation({
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
  const { data: consultants } = trpc.certificationConsultant.adminListConsultants.useQuery();
  const mutation = trpc.certificationConsultant.adminAssignConsultant.useMutation({
    onSuccess: () => { toast.success("已更新承辦顧問"); onMutated(); },
    onError: (err) => toast.error(err.message || "指派失敗"),
  });
  const assignable = (consultants ?? []).filter(c => c.isActive && c.userId != null);
  return (
    <Select
      value={currentConsultantId != null ? String(currentConsultantId) : "none"}
      onValueChange={(v) => mutation.mutate({ caseId, consultantId: v === "none" ? null : Number(v) })}
    >
      <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="指派顧問" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">尚未指派</SelectItem>
        {assignable.map(c => (<SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

function StatusHistoryPanel({ history }: { history: any[] | null | undefined }) {
  const [open, setOpen] = useState(false);
  const entries = history ?? [];
  if (entries.length === 0) return null;
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <History className="w-3.5 h-3.5" />{open ? "隱藏狀態歷程" : `查看狀態歷程（${entries.length}）`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
          {entries.map((h, i) => (
            <li key={i} className="text-muted-foreground">
              <span className="font-medium text-foreground">{CERTIFICATION_STATUS_LABELS[h.status as CertificationCaseStatus] ?? h.status}</span>
              {h.action === "claim" ? "（取件）" : h.forced ? "（管理員強制修正）" : ""}
              {" "}— {fmtTaipeiDateTime(h.at)} · {h.byName || "系統"}
              {h.reason && <div className="italic">原因：{h.reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusAdvanceControls({ item, onMutated }: { item: any; onMutated: () => void }) {
  const [pending, setPending] = useState<CertificationCaseStatus | null>(null);
  const [reason, setReason] = useState("");
  const statusMutation = trpc.certificationConsultant.updateCaseStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); setPending(null); setReason(""); onMutated(); },
    onError: (err) => toast.error(err.message || "更新失敗"),
  });
  const nextOptions = CERTIFICATION_STATUS_TRANSITIONS[item.status as CertificationCaseStatus] ?? [];
  if (nextOptions.length === 0) return null;

  function handleClick(opt: CertificationCaseStatus) {
    if (CERTIFICATION_EXCEPTION_STATUSES.includes(opt)) {
      setPending(opt);
      setReason("");
    } else {
      statusMutation.mutate({ caseId: item.id, nextStatus: opt });
    }
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap gap-2">
        {nextOptions.map(opt => (
          <Button key={opt} size="sm" variant={pending === opt ? "default" : "outline"} disabled={statusMutation.isPending} onClick={() => handleClick(opt)}>
            {CERTIFICATION_STATUS_LABELS[opt]}<ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        ))}
      </div>
      {pending && (
        <div className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">進入「{CERTIFICATION_STATUS_LABELS[pending]}」必須填寫原因：</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="請說明原因" className="text-sm" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!reason.trim() || statusMutation.isPending} onClick={() => statusMutation.mutate({ caseId: item.id, nextStatus: pending, reason: reason.trim() })}>
              {statusMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}確認
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPending(null); setReason(""); }}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CaseCard({ item, isAdmin, serviceNameByCode, onMutated }: { item: any; isAdmin: boolean; serviceNameByCode: Map<string, string>; onMutated: () => void }) {
  const services: string[] = item.isUnsure
    ? ["不確定，希望由顧問協助判斷"]
    : (item.servicesWanted ?? []).map((code: string) => serviceNameByCode.get(code) ?? code);

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-semibold truncate">{item.companyNameSnapshot}</span>
              <Badge className={statusColor(item.status)}>{CERTIFICATION_STATUS_LABELS[item.status as CertificationCaseStatus] ?? item.status}</Badge>
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
          <p><span className="text-muted-foreground">想了解的認證服務：</span>{services.join("、")}</p>
          {item.additionalNotes && <p className="text-xs text-muted-foreground">補充需求：{item.additionalNotes}</p>}
          {item.statusReason && <p className="text-xs text-muted-foreground">最近一次例外原因：{item.statusReason}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-2">
          <span>最後更新者：{item.lastUpdatedByNameSnapshot || "尚無更新紀錄"}</span>
          <span>最後更新時間：{fmtTaipeiDateTime(item.updatedAt)}</span>
          {item.claimedAt && <span>取件時間：{fmtTaipeiDateTime(item.claimedAt)}</span>}
        </div>

        <StatusHistoryPanel history={item.statusHistory} />

        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">承辦顧問：</span>
            <AssignConsultantControl caseId={item.id} currentConsultantId={item.assignedConsultantId} onMutated={onMutated} />
          </div>
        )}

        <NotesEditor caseId={item.id} initialNotes={item.notes} onMutated={onMutated} />

        <StatusAdvanceControls item={item} onMutated={onMutated} />
      </CardContent>
    </Card>
  );
}

function UnassignedCaseCard({ item, serviceNameByCode, onClaimed }: { item: any; serviceNameByCode: Map<string, string>; onClaimed: () => void }) {
  const claimMutation = trpc.certificationConsultant.claimCase.useMutation({
    onSuccess: () => { toast.success("取件成功，案件已加入您的案件列表"); onClaimed(); },
    onError: (err) => {
      if (err.data?.code === "CONFLICT") {
        toast.error("案件已由其他顧問承接，請重新整理");
        onClaimed();
      } else {
        toast.error(err.message || "取件失敗");
      }
    },
  });
  const services: string[] = item.isUnsure
    ? ["不確定，希望由顧問協助判斷"]
    : (item.servicesWanted ?? []).map((code: string) => serviceNameByCode.get(code) ?? code);

  return (
    <Card className="border-dashed">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-semibold truncate">{item.companyNameSnapshot}</span>
          <Badge className={statusColor("unassigned")}>{CERTIFICATION_STATUS_LABELS.unassigned}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-muted-foreground" />聯絡人：{item.contactName}</div>
          <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" />電話：{item.phone}</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />送出時間：{fmtTaipeiDateTime(item.createdAt)}</div>
        </div>
        <p className="text-sm"><span className="text-muted-foreground">想了解的認證服務：</span>{services.join("、")}</p>
        <Button size="sm" disabled={claimMutation.isPending} onClick={() => claimMutation.mutate({ caseId: item.id })}>
          {claimMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Inbox className="w-3.5 h-3.5 mr-1.5" />}
          取件
        </Button>
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
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center"><LogIn className="w-8 h-8 text-emerald-600" /></div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold">請先登入</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">登入後，若您是啟用中的 ISO 認證顧問或管理員，即可查看案件看板。</p>
        </div>
        <Button className="w-full max-w-xs bg-emerald-600 hover:bg-emerald-700 text-white border-0" onClick={() => setLoginOpen(true)}>
          <LogIn className="w-4 h-4 mr-2" />前往登入
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
        <p className="text-muted-foreground text-sm">{message || "您目前不是啟用中的 ISO 認證顧問，也不是管理員。"}</p>
        <Link href="/"><Button variant="outline">返回首頁</Button></Link>
      </div>
    </div>
  );
}

export default function CertificationConsultantCases() {
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const [selectedStatus, setSelectedStatus] = useState("all");

  const casesQuery = trpc.certificationConsultant.myCases.useQuery({}, { enabled: !!user, retry: false });
  const isAdmin = !!user?.isAdmin;
  const unassignedQuery = trpc.certificationConsultant.unassignedCases.useQuery(undefined, {
    enabled: !!user && !isAdmin && !casesQuery.error, retry: false,
  });
  const { data: services = [] } = trpc.certificationCenter.listServices.useQuery();
  const serviceNameByCode = new Map(services.map(s => [s.code, s.name]));

  function handleMutated() {
    utils.certificationConsultant.myCases.invalidate();
    utils.certificationConsultant.unassignedCases.invalidate();
  }

  if (authLoading) return <AppLoading />;
  if (!user) return <LoginRequiredView />;
  if (casesQuery.isPending) return <AppLoading />;
  if (casesQuery.error) return <NoPermissionView message={casesQuery.error.message} />;

  // Admin 的「全部案件」本來就包含 unassigned（後端 myCases 對 admin 無 status
  // 篩選），且 admin 不會另外渲染下方的待取件區塊，故此處不需要再濾掉 unassigned，
  // 否則會讓 admin 完全看不到尚未指派顧問的案件。一般顧問則維持原本的「我的案件」
  // 定義，不應包含 unassigned（那些顯示在下方待取件區塊，需先取件才會進來）。
  const baseItems: any[] = isAdmin
    ? (casesQuery.data ?? [])
    : (casesQuery.data ?? []).filter((c: any) => c.status !== "unassigned");
  const unassignedItems = unassignedQuery.data ?? [];

  const statusCounts: Record<string, number> = {};
  for (const c of baseItems) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  const statusDefs = isAdmin
    ? CERTIFICATION_STATUS_DEFS
    : CERTIFICATION_STATUS_DEFS.filter(s => s.key !== "unassigned");
  const items = selectedStatus === "all" ? baseItems : baseItems.filter(c => c.status === selectedStatus);

  return (
    <div className="min-h-screen bg-background">
      <Helmet><title>ISO 認證顧問案件看板｜OXM</title></Helmet>
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className="container py-8 md:py-12 max-w-3xl mx-auto space-y-8">
        <h1 className="text-xl md:text-2xl font-bold">ISO 與低碳認證案件看板</h1>

        {!isAdmin && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">待取件（{unassignedItems.length}）</h2>
            {unassignedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">目前沒有待取件的案件。</p>
            ) : (
              <div className="space-y-4">
                {unassignedItems.map((item: any) => (
                  <UnassignedCaseCard key={item.id} item={item} serviceNameByCode={serviceNameByCode} onClaimed={handleMutated} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{isAdmin ? "全部案件" : "我的案件"}</h2>
          <CaseStatusOverview
            statuses={statusDefs}
            counts={statusCounts}
            totalCount={baseItems.length}
            selectedStatus={selectedStatus}
            onStatusChange={setSelectedStatus}
          />
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">目前沒有案件。</p>
          ) : (
            <div className="space-y-4">
              {items.map((item: any) => (
                <CaseCard key={item.id} item={item} isAdmin={isAdmin} serviceNameByCode={serviceNameByCode} onMutated={handleMutated} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
