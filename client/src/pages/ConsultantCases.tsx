import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, Building2, Phone, Mail, MapPin,
  CheckCircle2, Loader2, Briefcase, MessageCircle, ShieldAlert,
  ArrowRight, Save, Clock,
} from "lucide-react";
import Navbar from "@/components/Navbar";

// ── 狀態對應 ────────────────────────────────────────────────────────────────

const STATUSES = [
  { value: "new",        label: "新案件",   color: "bg-blue-100 text-blue-700" },
  { value: "viewed",     label: "已查收",   color: "bg-cyan-100 text-cyan-700" },
  { value: "contacted",  label: "已聯繫",   color: "bg-indigo-100 text-indigo-700" },
  { value: "consulting", label: "輔導中",   color: "bg-violet-100 text-violet-700" },
  { value: "submitted",  label: "已送件",   color: "bg-green-100 text-green-700" },
  { value: "completed",  label: "已結案",   color: "bg-emerald-100 text-emerald-700" },
] as const;

type StatusValue = typeof STATUSES[number]["value"];

function statusInfo(s: string) {
  return STATUSES.find(x => x.value === s) ?? { label: s, color: "bg-gray-100 text-gray-700" };
}

const CAPITAL_LABELS: Record<string, string> = {
  under_500w: "500 萬以下",
  "500w_1000w": "500 萬～1,000 萬",
  "1000w_5000w": "1,000 萬～5,000 萬",
  "5000w_1y": "5,000 萬～1 億",
  over_1y: "1 億以上",
};

const EMPLOYEE_LABELS: Record<string, string> = {
  "1_5": "1～5 人",
  "6_30": "6～30 人",
  "31_100": "31～100 人",
  "101_300": "101～300 人",
  over_300: "300 人以上",
};

const EXPORT_LABELS: Record<string, string> = {
  none: "無出口",
  direct: "直接出口",
  trader: "透過貿易商出口",
  customer: "客戶代為出口",
  multiple: "多種模式",
};

// 狀態推進設定（new→viewed 由 acknowledge 處理）
const STATUS_NEXT: Partial<Record<string, { label: string; next: string }>> = {
  viewed:     { label: "標記已聯繫", next: "contacted" },
  contacted:  { label: "標記輔導中", next: "consulting" },
  consulting: { label: "標記已送件", next: "submitted" },
  submitted:  { label: "標記已結案", next: "completed" },
};

// ── 型別 ────────────────────────────────────────────────────────────────────

type Case = {
  id: number;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  location: string;
  capitalAmount: string;
  employeeCount: string;
  factoryType: string;
  hasGovernmentProject: boolean;
  governmentProjectName: string | null;
  hasGovernmentAward: boolean;
  governmentAwardName: string | null;
  hasPatent: boolean;
  patentCount: number | null;
  exportStatus: string;
  notes: string | null;
  status: string;
  factoryId?: number | null;
  factoryName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── 統計卡 ─────────────────────────────────────────────────────────────────

const STAT_COLORS: Record<string, string> = {
  blue:    "bg-blue-50 border-blue-100 text-blue-700",
  cyan:    "bg-cyan-50 border-cyan-100 text-cyan-700",
  violet:  "bg-violet-50 border-violet-100 text-violet-700",
  green:   "bg-green-50 border-green-100 text-green-700",
  emerald: "bg-emerald-50 border-emerald-100 text-emerald-700",
};

function StatCard({ label, count, color }: { label: string; count: number; color: keyof typeof STAT_COLORS }) {
  return (
    <div className={`rounded-xl border p-3 ${STAT_COLORS[color]}`}>
      <div className="text-2xl font-bold leading-none">{count}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}

// ── 案件卡片 ────────────────────────────────────────────────────────────────

function CaseCard({ item }: { item: Case }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [localNotes, setLocalNotes] = useState(item.notes ?? "");

  const info = statusInfo(item.status);
  const isNew = item.status === "new";
  const nextStep = STATUS_NEXT[item.status];
  const notesChanged = localNotes !== (item.notes ?? "");

  const invalidate = () => utils.upgradeConsultant.myCases.invalidate();

  const acknowledgeMutation = trpc.upgradeConsultant.acknowledge.useMutation({
    onSuccess: () => { invalidate(); toast.success("已成功查收案件"); },
    onError: (err) => toast.error(err.message || "查收失敗，請重試"),
  });

  const statusMutation = trpc.upgradeConsultant.updateCaseStatus.useMutation({
    onSuccess: () => { invalidate(); toast.success("狀態已更新"); },
    onError: (err) => toast.error(err.message || "狀態更新失敗"),
  });

  const notesMutation = trpc.upgradeConsultant.updateCaseNotes.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("備註已儲存");
    },
    onError: (err) => toast.error(err.message || "儲存失敗"),
  });

  const updatedDate = new Date(item.updatedAt).toLocaleDateString("zh-TW");
  const createdDate = new Date(item.createdAt).toLocaleDateString("zh-TW");
  const showUpdated = updatedDate !== createdDate ||
    Math.abs(new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime()) > 5000;

  return (
    <Card className={`overflow-hidden ${isNew ? "border-blue-200 bg-blue-50/20 dark:border-blue-900/40 dark:bg-blue-950/10" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* 標題行 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base">{item.companyName}</span>
              <Badge className={`${info.color} border-0 text-xs`}>{info.label}</Badge>
              {isNew && <span className="text-xs text-blue-600 font-medium">● 待查收</span>}
              {item.factoryId && (
                <a
                  href={`/factory/${item.factoryId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 text-xs border border-orange-200 dark:border-orange-900/40 hover:bg-orange-100 transition-colors"
                >
                  <Building2 className="w-3 h-3" />
                  {item.factoryName ? `OXM：${item.factoryName}` : "OXM 工廠"}
                </a>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location}</span>
              <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{item.phone}</span>
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{item.email}</span>
            </div>
          </div>
          <div className="text-right shrink-0 space-y-0.5">
            <div className="text-xs text-muted-foreground whitespace-nowrap">{createdDate}</div>
            {showUpdated && (
              <div className="text-xs text-muted-foreground/60 whitespace-nowrap flex items-center gap-1 justify-end">
                <Clock className="w-3 h-3" />{updatedDate}
              </div>
            )}
          </div>
        </div>

        {/* 標籤列 */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-muted">{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EXPORT_LABELS[item.exportStatus] ?? item.exportStatus}</span>
        </div>

        {/* 展開/收起 */}
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "收起詳情" : "查看詳情"}
        </button>

        {expanded && (
          <div className="border-t border-border/50 pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div><span className="text-muted-foreground">聯絡人：</span>{item.contactName}</div>
              <div><span className="text-muted-foreground">所在地：</span>{item.location}</div>
              <div><span className="text-muted-foreground">資本額：</span>{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</div>
              <div><span className="text-muted-foreground">員工：</span>{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</div>
              <div><span className="text-muted-foreground">政府計畫：</span>{item.hasGovernmentProject ? (item.governmentProjectName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">政府獎項：</span>{item.hasGovernmentAward ? (item.governmentAwardName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">專利：</span>{item.hasPatent ? `有（${item.patentCount ?? "未填"}件）` : "無"}</div>
            </div>
          </div>
        )}

        {/* 備註區 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">顧問備註</p>
          <Textarea
            value={localNotes}
            onChange={e => setLocalNotes(e.target.value)}
            placeholder="記錄聯繫狀況、推薦補助方案等…"
            rows={2}
            className="text-xs resize-none"
          />
          {notesChanged && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={notesMutation.isPending}
              onClick={() => notesMutation.mutate({ applicationId: item.id, notes: localNotes })}
            >
              {notesMutation.isPending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                : <Save className="w-3 h-3 mr-1" />}
              儲存備註
            </Button>
          )}
        </div>

        {/* 動作區 */}
        <div className="border-t border-border/50 pt-3 flex items-center gap-2 flex-wrap">
          {isNew && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={acknowledgeMutation.isPending}
              onClick={() => acknowledgeMutation.mutate({ applicationId: item.id })}
            >
              {acknowledgeMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              查收案件
            </Button>
          )}
          {nextStep && !isNew && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({
                applicationId: item.id,
                nextStatus: nextStep.next as "contacted" | "consulting" | "submitted" | "completed",
              })}
            >
              {statusMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                : <ArrowRight className="w-3.5 h-3.5 mr-1" />}
              {nextStep.label}
            </Button>
          )}
          {item.status === "completed" && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已結案
            </span>
          )}
          {/* 私訊廠商 — 預留入口，本階段 disabled */}
          <Button
            size="sm"
            variant="outline"
            disabled
            className="h-8 text-xs ml-auto opacity-50 cursor-not-allowed"
            title="即將開放：顧問身分私訊功能開發中"
          >
            <MessageCircle className="w-3.5 h-3.5 mr-1" />
            私訊廠商（即將開放）
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 案件列表（per-tab） ─────────────────────────────────────────────────────

function CaseList({ statusFilter }: { statusFilter?: StatusValue }) {
  const query = trpc.upgradeConsultant.myCases.useQuery(
    { status: statusFilter, limit: 50, offset: 0 },
    { refetchInterval: 30000 }
  );

  if (query.isLoading) return <AppLoading />;
  if (query.error) return (
    <div className="text-center py-16 text-muted-foreground">
      <p className="text-sm text-red-500">{query.error.message}</p>
    </div>
  );
  if (!query.data?.items.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">目前沒有案件</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">共 {query.data.total} 筆</p>
      {query.data.items.map(item => (
        <CaseCard key={item.id} item={item as Case} />
      ))}
    </div>
  );
}

// ── 主頁面 ──────────────────────────────────────────────────────────────────

export default function ConsultantCases() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const isAdmin = user?.role === 'admin';

  const profilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, {
    enabled: !!user,
  });

  const isActiveConsultant = profilesQuery.data?.some(p => p.isActive) ?? false;
  const canAccess = isAdmin || isActiveConsultant;

  const statsQuery = trpc.upgradeConsultant.myCases.useQuery(
    { limit: 200, offset: 0 },
    { enabled: !!user && canAccess, refetchInterval: 60000 }
  );

  if (loading || profilesQuery.isLoading) return <AppLoading />;

  if (!user) {
    navigate("/");
    return null;
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 max-w-lg mx-auto text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="font-medium">您沒有顧問權限</p>
          <p className="text-muted-foreground text-sm">此頁面僅供 OXM 企業升級顧問使用</p>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>返回首頁</Button>
        </div>
      </div>
    );
  }

  const allItems = statsQuery.data?.items ?? [];
  const stats = {
    new:        allItems.filter(i => i.status === "new").length,
    viewed:     allItems.filter(i => i.status === "viewed").length,
    consulting: allItems.filter(i => i.status === "contacted" || i.status === "consulting").length,
    submitted:  allItems.filter(i => i.status === "submitted").length,
    completed:  allItems.filter(i => i.status === "completed").length,
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">

        {/* 頁面標題 */}
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-orange-500" />
          <h1 className="text-xl font-bold">顧問中心</h1>
        </div>

        {/* 統計卡 */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <StatCard label="新進案件" count={stats.new} color="blue" />
          <StatCard label="已查收" count={stats.viewed} color="cyan" />
          <StatCard label="諮詢中" count={stats.consulting} color="violet" />
          <StatCard label="已送件" count={stats.submitted} color="green" />
          <StatCard label="已結案" count={stats.completed} color="emerald" />
        </div>

        {/* 分頁案件列表 */}
        <Tabs defaultValue="all">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="new">新案件</TabsTrigger>
            <TabsTrigger value="viewed">已查收</TabsTrigger>
            <TabsTrigger value="contacted">已聯繫</TabsTrigger>
            <TabsTrigger value="consulting">輔導中</TabsTrigger>
            <TabsTrigger value="completed">已結案</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <CaseList />
          </TabsContent>
          {(["new", "viewed", "contacted", "consulting", "completed"] as const).map(s => (
            <TabsContent key={s} value={s} className="mt-4">
              <CaseList statusFilter={s} />
            </TabsContent>
          ))}
        </Tabs>

      </div>
    </div>
  );
}
