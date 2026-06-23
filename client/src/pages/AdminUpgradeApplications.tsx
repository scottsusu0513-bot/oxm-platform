import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronDown, ChevronUp, Building2, Phone, Mail, MapPin,
  AlertTriangle, Clock, Users, BarChart3,
} from "lucide-react";
import Navbar from "@/components/Navbar";

// ── 狀態設定 ──────────────────────────────────────────────────────────────────

// 完整狀態清單（用於 badge 顯示 / statusInfo）
const STATUSES = [
  { value: "new",         label: "新案件",     color: "bg-blue-100 text-blue-700" },
  { value: "evaluating",  label: "評估中",     color: "bg-cyan-100 text-cyan-700" },
  { value: "ineligible",  label: "資格不符",   color: "bg-red-100 text-red-700" },
  { value: "accepted",    label: "已立案處理", color: "bg-violet-100 text-violet-700" },
  { value: "submitted",   label: "已送出審核", color: "bg-amber-100 text-amber-700" },
  { value: "rejected",    label: "政府駁回",   color: "bg-rose-100 text-rose-700" },
  { value: "approved",    label: "案件通過",   color: "bg-green-100 text-green-700" },
  { value: "transforming",label: "企業轉型中", color: "bg-teal-100 text-teal-700" },
  { value: "completed",   label: "案件結案",   color: "bg-emerald-100 text-emerald-700" },
  { value: "unassigned",  label: "待分派顧問", color: "bg-yellow-100 text-yellow-700" },
  { value: "archived",    label: "已封存",     color: "bg-gray-100 text-gray-500" },
  // Legacy（舊資料向下相容，不可再選）
  { value: "viewed",      label: "評估中（舊）", color: "bg-cyan-100 text-cyan-600" },
  { value: "contacted",   label: "評估中（舊）", color: "bg-cyan-100 text-cyan-600" },
  { value: "consulting",  label: "已立案（舊）", color: "bg-violet-100 text-violet-600" },
] as const;

type StatusValue = typeof STATUSES[number]["value"];

// 例外調整下拉可選範圍：移除已封存與所有舊狀態
const SELECTABLE_STATUSES = STATUSES.filter(
  s => !["archived", "viewed", "contacted", "consulting"].includes(s.value)
);

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
  plannedSubsidyAmount?: number | null;
  approvedSubsidyAmount?: number | null;
  statusTimeline?: Record<string, string> | null;
  viewedAt?: Date | string | null;
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
        {/* 頭部 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base break-all">{item.companyName}</span>
              <Badge className={`${info.color} border-0 text-xs shrink-0`}>{info.label}</Badge>
              {item.factoryId && (
                <a
                  href={`/factory/${item.factoryId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs border border-blue-200 hover:bg-blue-100 transition-colors shrink-0"
                >
                  <Building2 className="w-3 h-3" />
                  {item.factoryName ? `OXM：${item.factoryName}` : "OXM 工廠"}
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1 shrink-0"><MapPin className="w-3 h-3" />{item.location}</span>
              <span className="flex items-center gap-1 min-w-0 truncate"><Phone className="w-3 h-3 shrink-0" />{item.phone}</span>
              <span className="flex items-center gap-1 min-w-0 truncate"><Mail className="w-3 h-3 shrink-0" />{item.email}</span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 ml-2">
            {new Date(item.createdAt).toLocaleDateString("zh-TW")}
          </span>
        </div>

        {/* 快速摘要 */}
        <div className="flex flex-wrap gap-1.5 text-xs">
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
            {/* 手機版 1 欄，桌面版 2 欄 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
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
            {(item.plannedSubsidyAmount != null || item.approvedSubsidyAmount != null) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {item.plannedSubsidyAmount != null && (
                  <div><span className="text-muted-foreground">預計送審金額：</span>NT$ {item.plannedSubsidyAmount.toLocaleString("zh-TW")}</div>
                )}
                {item.approvedSubsidyAmount != null && (
                  <div><span className="text-muted-foreground">實際過案金額：</span><span className="text-green-700 font-medium">NT$ {item.approvedSubsidyAmount.toLocaleString("zh-TW")}</span></div>
                )}
              </div>
            )}
            {item.notes && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <p className="font-medium text-foreground mb-1">顧問備註</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
              </div>
            )}
            {/* 案件流程時間軸 */}
            {(() => {
              const tl = item.statusTimeline ?? {};
              const stages = [
                { key: "new",          label: "送出申請" },
                { key: "evaluating",   label: "評估中" },
                { key: "ineligible",   label: "資格不符" },
                { key: "accepted",     label: "已立案處理" },
                { key: "submitted",    label: "已送出審核" },
                { key: "rejected",     label: "政府駁回" },
                { key: "transforming", label: "企業轉型中" },
                { key: "completed",    label: "案件結案" },
              ];
              const getT = (k: string) => {
                if (k === "new") return tl.new ?? (item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt));
                if (k === "evaluating") return tl.evaluating ?? (item.viewedAt ? String(item.viewedAt) : null);
                return tl[k] ?? null;
              };
              const fmt = (s: string) => {
                const d = new Date(s);
                return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
              };
              const visible = stages.filter(s => !!getT(s.key));
              if (visible.length === 0) return null;
              return (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">案件流程</p>
                  <div className="relative pl-4 space-y-2">
                    <div className="absolute left-1 top-1 bottom-1 w-px bg-border" />
                    {visible.map(s => {
                      const t = getT(s.key)!;
                      return (
                        <div key={s.key} className="relative flex gap-2 items-start">
                          <div className="absolute -left-[14px] mt-0.5 w-2.5 h-2.5 rounded-full bg-primary/30 border border-primary/50" />
                          <div>
                            <span className="text-xs font-medium">{s.label}</span>
                            <div className="text-xs text-muted-foreground">{fmt(t)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 例外狀態調整（管理員監控用，不含已封存與舊狀態） */}
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">例外調整</span>
            <Select
              defaultValue={item.status}
              onValueChange={(v) => onStatusChange(item.id, v as StatusValue)}
              disabled={isPending}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELECTABLE_STATUSES.map(s => (
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
        <p className="text-sm">目前沒有案件</p>
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

// ── 待分派案件（管理員專屬檢視） ──────────────────────────────────────────────

function UnassignedTab() {
  const utils = trpc.useUtils();
  const query = trpc.upgradeCenter.adminList.useQuery(
    { status: "unassigned", limit: 100, offset: 0 },
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

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* 說明 */}
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 space-y-1">
        <p className="font-medium">尚未分派給顧問公司的案件</p>
        <p className="text-xs text-yellow-700/80">這些申請來自目前尚無北中南顧問承接的地區，可作為與顧問公司洽談合作的籌碼。</p>
      </div>
      <p className="text-xs text-muted-foreground">共 {items.length} 筆待分派案件</p>
      {items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">目前沒有待分派案件</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <ApplicationCard
              key={item.id}
              item={item as Application}
              onStatusChange={(id, st) => updateMutation.mutate({ id, status: st })}
              isPending={updateMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 顧問處理總覽 ──────────────────────────────────────────────────────────────

function StatsTab() {
  const query = trpc.upgradeConsultant.adminStats.useQuery(undefined, { refetchInterval: 60000 });

  if (query.isLoading) return <AppLoading />;
  if (!query.data) return <p className="text-sm text-muted-foreground py-8 text-center">無資料</p>;

  const { total, unassigned, unviewed, overdue48h, byRegion } = query.data;

  return (
    <div className="space-y-6">
      {/* 全域總覽 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{total}</p>
            <p className="text-xs text-muted-foreground mt-1">總案件數</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{unassigned}</p>
            <p className="text-xs text-muted-foreground mt-1">待分派顧問</p>
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

      {/* 北中南顧問處理總覽 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">北中南顧問處理總覽</h3>
        </div>
        <div className="space-y-3">
          {(["north", "central", "south"] as const).map(region => {
            const stat = byRegion[region];
            if (!stat) return null;
            return (
              <Card key={region}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <span className="font-medium text-sm">{stat.consultantName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{REGION_LABELS[region]}地區</span>
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">共 <strong>{stat.total}</strong> 筆</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-xs">
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center">
                      <p className="text-lg font-bold text-blue-700 leading-none">{stat.unviewed}</p>
                      <p className="text-blue-600 mt-1 opacity-80">新案件</p>
                    </div>
                    <div className="rounded-lg bg-violet-50 border border-violet-100 p-2 text-center">
                      <p className="text-lg font-bold text-violet-700 leading-none">{stat.inProgress}</p>
                      <p className="text-violet-600 mt-1 opacity-80">處理中</p>
                    </div>
                    <div className="rounded-lg bg-green-50 border border-green-100 p-2 text-center">
                      <p className="text-lg font-bold text-green-700 leading-none">{stat.submitted}</p>
                      <p className="text-green-600 mt-1 opacity-80">已送出審核</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-center">
                      <p className="text-lg font-bold text-emerald-700 leading-none">{stat.completed}</p>
                      <p className="text-emerald-600 mt-1 opacity-80">案件結案</p>
                    </div>
                    <div className="rounded-lg bg-red-50 border border-red-100 p-2 text-center">
                      <p className="text-lg font-bold text-red-700 leading-none">{stat.ineligible}</p>
                      <p className="text-red-600 mt-1 opacity-80">資格不符</p>
                    </div>
                  </div>
                  {stat.unviewed > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                      <Clock className="w-3 h-3" />
                      {stat.unviewed} 筆新案件待查收
                    </div>
                  )}
                </CardContent>
              </Card>
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
    onSuccess: (data) => {
      utils.upgradeConsultant.adminListConsultants.invalidate();
      utils.upgradeConsultant.adminStats.invalidate();
      utils.upgradeCenter.adminList.invalidate();
      const count = data.backfilledCount ?? 0;
      if (count > 0) {
        toast.success(`顧問綁定成功，已自動補派 ${count} 筆待分派案件。`);
      } else {
        toast.success("顧問綁定成功，目前沒有待補派案件。");
      }
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

            <div className="space-y-1.5">
              {consultant.userId == null ? (
                <p className="text-xs text-muted-foreground">目前尚未綁定使用者</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs shrink-0 text-muted-foreground">userId：</span>
                    <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{consultant.userId}</span>
                  </div>
                  {consultant.boundUser ? (
                    <div className="text-xs text-muted-foreground space-y-0.5 pl-2 border-l-2 border-muted ml-1">
                      <p>使用者名稱：{consultant.boundUser.name ?? "未提供名稱"}</p>
                      <p className="break-all">Email：{consultant.boundUser.email ?? "—"}</p>
                      <p>建立時間：{new Date(consultant.boundUser.createdAt).toLocaleString("zh-TW", {
                        timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
                        day: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">查無此使用者資料，請確認 userId 是否正確</p>
                  )}
                </>
              )}
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
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              後台
            </Button>
            <h1 className="text-xl font-bold">企業升級案件總覽</h1>
          </div>
          <p className="text-xs text-muted-foreground ml-1">查看北中南顧問案件分派與處理狀況</p>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
            {/* 案件狀態過濾 */}
            <TabsTrigger value="all"         className="text-xs whitespace-nowrap">全部</TabsTrigger>
            <TabsTrigger value="new"         className="text-xs whitespace-nowrap">新案件</TabsTrigger>
            <TabsTrigger value="evaluating"  className="text-xs whitespace-nowrap">評估中</TabsTrigger>
            <TabsTrigger value="ineligible"  className="text-xs whitespace-nowrap">資格不符</TabsTrigger>
            <TabsTrigger value="accepted"    className="text-xs whitespace-nowrap">已立案</TabsTrigger>
            <TabsTrigger value="submitted"   className="text-xs whitespace-nowrap">已送出審核</TabsTrigger>
            <TabsTrigger value="rejected"    className="text-xs whitespace-nowrap">政府駁回</TabsTrigger>
            <TabsTrigger value="transforming"className="text-xs whitespace-nowrap">企業轉型中</TabsTrigger>
            <TabsTrigger value="completed"   className="text-xs whitespace-nowrap">案件結案</TabsTrigger>
            <TabsTrigger value="archived"    className="text-xs whitespace-nowrap">封存</TabsTrigger>
            {/* 管理工具（顧問總覽 → 待分派案件 → 顧問設定） */}
            <TabsTrigger value="stats"       className="text-xs whitespace-nowrap font-semibold">顧問總覽</TabsTrigger>
            <TabsTrigger value="unassigned"  className="text-xs whitespace-nowrap font-semibold">待分派案件</TabsTrigger>
            <TabsTrigger value="consultants" className="text-xs whitespace-nowrap font-semibold">顧問設定</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <ApplicationList />
          </TabsContent>
          {(["new","evaluating","ineligible","accepted","submitted","rejected","transforming","completed","archived"] as const).map(s => (
            <TabsContent key={s} value={s} className="mt-4">
              <ApplicationList status={s} />
            </TabsContent>
          ))}
          <TabsContent value="stats" className="mt-4">
            <StatsTab />
          </TabsContent>
          <TabsContent value="unassigned" className="mt-4">
            <UnassignedTab />
          </TabsContent>
          <TabsContent value="consultants" className="mt-4">
            <ConsultantBindTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
