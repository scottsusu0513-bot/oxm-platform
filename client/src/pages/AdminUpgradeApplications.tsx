import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, ChevronUp, Building2, Phone, Mail, MapPin, AlertTriangle, Clock, Users } from "lucide-react";
import Navbar from "@/components/Navbar";

// ── 狀態設定 ──────────────────────────────────────────────────────────────────

const STATUSES = [
  { value: "new",        label: "新案件",   color: "bg-blue-100 text-blue-700" },
  { value: "viewed",     label: "已查收",   color: "bg-cyan-100 text-cyan-700" },
  { value: "contacted",  label: "已聯繫",   color: "bg-indigo-100 text-indigo-700" },
  { value: "consulting", label: "輔導中",   color: "bg-violet-100 text-violet-700" },
  { value: "submitted",  label: "已送件",   color: "bg-green-100 text-green-700" },
  { value: "completed",  label: "已完成",   color: "bg-emerald-100 text-emerald-700" },
  { value: "unassigned", label: "未分派",   color: "bg-yellow-100 text-yellow-700" },
  { value: "archived",   label: "封存",     color: "bg-gray-100 text-gray-500" },
] as const;

type StatusValue = typeof STATUSES[number]["value"];

function statusInfo(s: string) {
  return STATUSES.find(x => x.value === s) ?? STATUSES[0];
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

const FACTORY_TYPE_LABELS: Record<string, string> = {
  general: "一般工廠",
  specific: "特定工廠登記",
  managed: "納管工廠",
  unregistered: "尚未登記",
  unknown: "不確定",
};

const EXPORT_LABELS: Record<string, string> = {
  none: "無出口",
  direct: "直接出口",
  trader: "透過貿易商出口",
  customer: "客戶代為出口",
  multiple: "多種模式",
};

const REGION_LABELS: Record<string, string> = {
  north: "北部",
  central: "中部",
  south: "南部",
};

// ── 單筆申請卡片 ──────────────────────────────────────────────────────────────

type Application = {
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

function ApplicationCard({
  item,
  onStatusChange,
  isPending,
}: {
  item: Application;
  onStatusChange: (id: number, status: StatusValue) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const info = statusInfo(item.status);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {/* 頭部：公司名稱 + 狀態 + 日期 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base">{item.companyName}</span>
              <Badge className={`${info.color} border-0 text-xs`}>{info.label}</Badge>
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

        {/* 快速摘要 */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-muted">{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{FACTORY_TYPE_LABELS[item.factoryType] ?? item.factoryType}</span>
          <span className="px-2 py-0.5 rounded-full bg-muted">{EXPORT_LABELS[item.exportStatus] ?? item.exportStatus}</span>
        </div>

        {/* 展開詳情 */}
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
              <div><span className="text-muted-foreground">員工人數：</span>{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</div>
              <div><span className="text-muted-foreground">工廠類型：</span>{FACTORY_TYPE_LABELS[item.factoryType] ?? item.factoryType}</div>
              <div><span className="text-muted-foreground">出口狀況：</span>{EXPORT_LABELS[item.exportStatus] ?? item.exportStatus}</div>
              <div><span className="text-muted-foreground">政府計畫：</span>{item.hasGovernmentProject ? (item.governmentProjectName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">政府獎項：</span>{item.hasGovernmentAward ? (item.governmentAwardName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">專利：</span>{item.hasPatent ? `有（${item.patentCount ?? "未填數量"}件）` : "無"}</div>
            </div>
            {item.notes && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <p className="font-medium text-foreground mb-1">補充說明</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* 狀態更新 */}
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">更新狀態</span>
            <Select
              defaultValue={item.status}
              onValueChange={(v) => onStatusChange(item.id, v as StatusValue)}
              disabled={isPending}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 分頁列表 ──────────────────────────────────────────────────────────────────

function ApplicationList({ status }: { status?: StatusValue }) {
  const utils = trpc.useUtils();
  const query = trpc.upgradeCenter.adminList.useQuery(
    { status, limit: 50, offset: 0 },
    { refetchInterval: 60000 }
  );

  const updateMutation = trpc.upgradeCenter.adminUpdateStatus.useMutation({
    onSuccess: () => {
      utils.upgradeCenter.adminList.invalidate();
      toast.success("狀態已更新");
    },
    onError: (err) => toast.error(err.message || "更新失敗"),
  });

  if (query.isLoading) return <AppLoading />;
  if (!query.data?.items.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">目前沒有申請案件</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">共 {query.data.total} 筆</p>
      {query.data.items.map(item => (
        <ApplicationCard
          key={item.id}
          item={item as Application}
          onStatusChange={(id, st) => updateMutation.mutate({ id, status: st })}
          isPending={updateMutation.isPending}
        />
      ))}
    </div>
  );
}

// ── 統計分頁 ──────────────────────────────────────────────────────────────────

function StatsTab() {
  const query = trpc.upgradeConsultant.adminStats.useQuery(undefined, { refetchInterval: 60000 });

  if (query.isLoading) return <AppLoading />;
  if (!query.data) return <p className="text-sm text-muted-foreground py-8 text-center">無資料</p>;

  const { total, unassigned, unviewed, overdue48h, byRegion } = query.data;

  return (
    <div className="space-y-6">
      {/* 總覽數字 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground mt-1">總申請數</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{unassigned}</p>
            <p className="text-xs text-muted-foreground mt-1">未分派</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{unviewed}</p>
            <p className="text-xs text-muted-foreground mt-1">新案待查收</p>
          </CardContent>
        </Card>
        <Card className={overdue48h > 0 ? "border-red-200" : ""}>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1">
              {overdue48h > 0 && <AlertTriangle className="w-4 h-4 text-red-500" />}
              <p className={`text-2xl font-bold ${overdue48h > 0 ? "text-red-600" : ""}`}>{overdue48h}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">超過 48h 未查收</p>
          </CardContent>
        </Card>
      </div>

      {/* 各區域統計 */}
      <div>
        <h3 className="text-sm font-semibold mb-3">各區域案件數</h3>
        <div className="space-y-2">
          {(["north", "central", "south"] as const).map(region => {
            const stat = byRegion[region];
            if (!stat) return null;
            return (
              <div key={region} className="flex items-center gap-3 p-3 rounded-lg border bg-card text-sm">
                <span className="font-medium w-12">{REGION_LABELS[region]}</span>
                <span className="text-muted-foreground text-xs">{stat.consultantName}</span>
                <div className="ml-auto flex items-center gap-4 text-xs">
                  <span>共 <strong>{stat.total}</strong> 筆</span>
                  {stat.unviewed > 0 && (
                    <span className="flex items-center gap-1 text-blue-600">
                      <Clock className="w-3 h-3" />新 {stat.unviewed}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 顧問綁定分頁 ──────────────────────────────────────────────────────────────

function ConsultantBindTab() {
  const utils = trpc.useUtils();
  const query = trpc.upgradeConsultant.adminListConsultants.useQuery();
  const bindMutation = trpc.upgradeConsultant.adminBindUser.useMutation({
    onSuccess: () => {
      utils.upgradeConsultant.adminListConsultants.invalidate();
      utils.upgradeConsultant.adminStats.invalidate();
      toast.success("綁定已更新");
    },
    onError: (err) => toast.error(err.message || "操作失敗"),
  });

  const [userIdInputs, setUserIdInputs] = useState<Record<number, string>>({});

  if (query.isLoading) return <AppLoading />;
  if (!query.data?.length) return <p className="text-sm text-muted-foreground py-8 text-center">無顧問資料</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">設定每個地區顧問所對應的使用者帳號（輸入 userId）</p>
      {query.data.map(consultant => (
        <Card key={consultant.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{consultant.name}</p>
                <p className="text-xs text-muted-foreground">{REGION_LABELS[consultant.regionKey]} 地區</p>
              </div>
              <Badge className="ml-auto" variant={consultant.isActive ? "default" : "secondary"}>
                {consultant.isActive ? "啟用" : "停用"}
              </Badge>
            </div>

            <div className="text-xs text-muted-foreground">
              服務縣市：{(consultant.serviceAreas as string[]).join("、")}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs shrink-0">目前 userId：</span>
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                {consultant.userId ?? "（未綁定）"}
              </span>
            </div>

            <div className="flex gap-2">
              <Input
                className="h-8 text-xs"
                placeholder="輸入 userId（數字）"
                value={userIdInputs[consultant.id] ?? ""}
                onChange={e => setUserIdInputs(prev => ({ ...prev, [consultant.id]: e.target.value }))}
              />
              <Button
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={bindMutation.isPending}
                onClick={() => {
                  const val = userIdInputs[consultant.id]?.trim();
                  const userId = val ? parseInt(val, 10) : null;
                  if (val && (isNaN(userId!) || userId! <= 0)) {
                    toast.error("請輸入有效的數字 userId");
                    return;
                  }
                  bindMutation.mutate({ consultantId: consultant.id, userId });
                  setUserIdInputs(prev => ({ ...prev, [consultant.id]: "" }));
                }}
              >
                {userIdInputs[consultant.id]?.trim() ? "綁定" : "解除綁定"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function AdminUpgradeApplications() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            後台
          </Button>
          <h1 className="text-xl font-bold">企業升級中心申請</h1>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="new">新案件</TabsTrigger>
            <TabsTrigger value="unassigned">未分派</TabsTrigger>
            <TabsTrigger value="viewed">已查收</TabsTrigger>
            <TabsTrigger value="consulting">輔導中</TabsTrigger>
            <TabsTrigger value="completed">已完成</TabsTrigger>
            <TabsTrigger value="archived">封存</TabsTrigger>
            <TabsTrigger value="stats">統計</TabsTrigger>
            <TabsTrigger value="consultants">顧問設定</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <ApplicationList />
          </TabsContent>
          {(["new", "unassigned", "viewed", "consulting", "completed", "archived"] as const).map(s => (
            <TabsContent key={s} value={s} className="mt-4">
              <ApplicationList status={s} />
            </TabsContent>
          ))}
          <TabsContent value="stats" className="mt-4">
            <StatsTab />
          </TabsContent>
          <TabsContent value="consultants" className="mt-4">
            <ConsultantBindTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
