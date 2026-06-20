import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Building2, Phone, Mail, MapPin, CheckCircle2, Loader2 } from "lucide-react";
import Navbar from "@/components/Navbar";

const STATUSES = [
  { value: "new",        label: "新案件",   color: "bg-blue-100 text-blue-700" },
  { value: "viewed",     label: "已查收",   color: "bg-cyan-100 text-cyan-700" },
  { value: "contacted",  label: "已聯繫",   color: "bg-indigo-100 text-indigo-700" },
  { value: "consulting", label: "輔導中",   color: "bg-violet-100 text-violet-700" },
  { value: "submitted",  label: "已送件",   color: "bg-green-100 text-green-700" },
  { value: "completed",  label: "已完成",   color: "bg-emerald-100 text-emerald-700" },
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
};

function CaseCard({ item, onAcknowledge, acknowledging }: {
  item: Case;
  onAcknowledge: (id: number) => void;
  acknowledging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const info = statusInfo(item.status);
  const isNew = item.status === "new";

  return (
    <Card className={`overflow-hidden ${isNew ? "border-blue-200 bg-blue-50/20" : ""}`}>
      <CardContent className="p-4 space-y-3">
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
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 text-xs border border-blue-200 dark:border-blue-900/40 hover:bg-blue-100 transition-colors"
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
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {new Date(item.createdAt).toLocaleDateString("zh-TW")}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-muted">{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EXPORT_LABELS[item.exportStatus] ?? item.exportStatus}</span>
        </div>

        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "收起詳情" : "查看詳情"}
        </button>

        {expanded && (
          <div className="border-t border-border/50 pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div><span className="text-muted-foreground">聯絡人：</span>{item.contactName}</div>
              <div><span className="text-muted-foreground">所在地：</span>{item.location}</div>
              <div><span className="text-muted-foreground">資本額：</span>{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</div>
              <div><span className="text-muted-foreground">員工：</span>{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</div>
              <div><span className="text-muted-foreground">政府計畫：</span>{item.hasGovernmentProject ? (item.governmentProjectName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">政府獎項：</span>{item.hasGovernmentAward ? (item.governmentAwardName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">專利：</span>{item.hasPatent ? `有（${item.patentCount ?? "未填"}件）` : "無"}</div>
            </div>
            {item.notes && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <p className="font-medium text-foreground mb-1">補充說明</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
              </div>
            )}
          </div>
        )}

        {isNew && (
          <div className="border-t border-border/50 pt-3">
            <Button
              size="sm"
              className="w-full h-8 text-xs"
              disabled={acknowledging}
              onClick={() => onAcknowledge(item.id)}
            >
              {acknowledging ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              確認查收
            </Button>
          </div>
        )}

        {item.status === "viewed" && (
          <div className="border-t border-border/50 pt-3">
            <p className="text-xs text-center text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 inline mr-1 text-cyan-500" />
              顧問已查收，可進入下一階段對話
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CaseList({ statusFilter }: { statusFilter?: StatusValue }) {
  const utils = trpc.useUtils();
  const query = trpc.upgradeConsultant.myCases.useQuery(
    { status: statusFilter, limit: 50, offset: 0 },
    { refetchInterval: 30000 }
  );

  const acknowledgeMutation = trpc.upgradeConsultant.acknowledge.useMutation({
    onSuccess: () => {
      utils.upgradeConsultant.myCases.invalidate();
      toast.success("已成功查收案件");
    },
    onError: (err) => toast.error(err.message || "查收失敗，請重試"),
  });

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
        <CaseCard
          key={item.id}
          item={item as Case}
          onAcknowledge={(id) => acknowledgeMutation.mutate({ applicationId: id })}
          acknowledging={acknowledgeMutation.isPending}
        />
      ))}
    </div>
  );
}

export default function ConsultantCases() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const profilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, {
    enabled: !!user,
  });

  if (loading || profilesQuery.isLoading) return <AppLoading />;

  if (!user) {
    navigate("/");
    return null;
  }

  if (!profilesQuery.data?.length) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 max-w-lg mx-auto text-center">
          <p className="text-muted-foreground text-sm">您沒有顧問權限，無法查看案件。</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate("/")}>返回首頁</Button>
        </div>
      </div>
    );
  }

  const regionLabel = profilesQuery.data.map(c => {
    const map: Record<string, string> = { north: "北部", central: "中部", south: "南部" };
    return `${map[c.regionKey] ?? c.regionKey}（${c.name}）`;
  }).join("、");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold">顧問案件管理</h1>
          <p className="text-xs text-muted-foreground mt-1">負責地區：{regionLabel}</p>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="new">新案件</TabsTrigger>
            <TabsTrigger value="viewed">已查收</TabsTrigger>
            <TabsTrigger value="contacted">已聯繫</TabsTrigger>
            <TabsTrigger value="consulting">輔導中</TabsTrigger>
            <TabsTrigger value="completed">已完成</TabsTrigger>
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
