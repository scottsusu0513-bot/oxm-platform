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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, Building2, Phone, Mail, MapPin,
  CheckCircle2, Loader2, Briefcase, MessageCircle, ShieldAlert,
  ArrowRight, Save, Clock, XCircle, Ban, FileCheck, Send,
  ThumbsDown, ThumbsUp, Rocket, FlagTriangleRight,
} from "lucide-react";
import Navbar from "@/components/Navbar";

// ── 狀態設定 ─────────────────────────────────────────────────────────────────

const STATUSES: Record<string, { label: string; color: string }> = {
  new:         { label: "新案件",     color: "bg-blue-100 text-blue-700" },
  evaluating:  { label: "評估中",     color: "bg-cyan-100 text-cyan-700" },
  ineligible:  { label: "資格不符",   color: "bg-red-100 text-red-700" },
  accepted:    { label: "已立案處理", color: "bg-violet-100 text-violet-700" },
  submitted:   { label: "已送出審核", color: "bg-amber-100 text-amber-700" },
  rejected:    { label: "政府駁回",   color: "bg-rose-100 text-rose-700" },
  approved:    { label: "案件通過",   color: "bg-green-100 text-green-700" },
  transforming:{ label: "企業轉型中", color: "bg-teal-100 text-teal-700" },
  completed:   { label: "案件結案",   color: "bg-emerald-100 text-emerald-700" },
  unassigned:  { label: "待分派顧問", color: "bg-slate-100 text-slate-600" },
  archived:    { label: "已封存",     color: "bg-slate-100 text-slate-500" },
  // Legacy: map to new labels
  viewed:      { label: "評估中",     color: "bg-cyan-100 text-cyan-700" },
  contacted:   { label: "評估中",     color: "bg-cyan-100 text-cyan-700" },
  consulting:  { label: "已立案處理", color: "bg-violet-100 text-violet-700" },
};

function statusInfo(s: string) {
  return STATUSES[s] ?? { label: s, color: "bg-gray-100 text-gray-700" };
}

// Maps legacy statuses to their effective new equivalent for UI logic
function effectiveStatus(s: string): string {
  if (s === "viewed" || s === "contacted") return "evaluating";
  if (s === "consulting") return "accepted";
  return s;
}

// Tab → which raw status values belong to it
const STATUS_GROUPS: Record<string, string[]> = {
  new:         ["new"],
  evaluating:  ["evaluating", "viewed", "contacted"],
  ineligible:  ["ineligible"],
  accepted:    ["accepted", "consulting"],
  submitted:   ["submitted"],
  rejected:    ["rejected"],
  approved:    ["approved"],
  transforming:["transforming"],
  completed:   ["completed"],
  unassigned:  ["unassigned"],
};

const TAB_ORDER = [
  { key: "new",          label: "新案件" },
  { key: "evaluating",   label: "評估中" },
  { key: "ineligible",   label: "資格不符" },
  { key: "accepted",     label: "已立案處理" },
  { key: "submitted",    label: "已送出審核" },
  { key: "rejected",     label: "政府駁回" },
  { key: "approved",     label: "案件通過" },
  { key: "transforming", label: "企業轉型中" },
  { key: "completed",    label: "案件結案" },
];

// Terminal statuses: no next step
const TERMINAL = new Set(["ineligible", "completed"]);

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

// ── 型別 ─────────────────────────────────────────────────────────────────────

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
  plannedSubsidyAmount?: number | null;
  approvedSubsidyAmount?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

// ── 金額格式化 ───────────────────────────────────────────────────────────────

function formatNTD(n: number) {
  return `NT$ ${n.toLocaleString("zh-TW")}`;
}

function parseAmount(s: string): number | null {
  const v = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (isNaN(v) || v <= 0 || v > 100_000_000) return null;
  return v;
}

// ── 統計卡 ───────────────────────────────────────────────────────────────────

const STAT_COLORS: Record<string, string> = {
  blue:    "bg-blue-50 border-blue-100 text-blue-700",
  cyan:    "bg-cyan-50 border-cyan-100 text-cyan-700",
  red:     "bg-red-50 border-red-100 text-red-700",
  violet:  "bg-violet-50 border-violet-100 text-violet-700",
  amber:   "bg-amber-50 border-amber-100 text-amber-700",
  rose:    "bg-rose-50 border-rose-100 text-rose-700",
  green:   "bg-green-50 border-green-100 text-green-700",
  teal:    "bg-teal-50 border-teal-100 text-teal-700",
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

// ── 案件卡片 ─────────────────────────────────────────────────────────────────

function CaseCard({ item }: { item: Case }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [localNotes, setLocalNotes] = useState(item.notes ?? "");
  const [localPlanned, setLocalPlanned] = useState(
    item.plannedSubsidyAmount != null ? String(item.plannedSubsidyAmount) : ""
  );
  const [localApproved, setLocalApproved] = useState(
    item.approvedSubsidyAmount != null ? String(item.approvedSubsidyAmount) : ""
  );

  const eff = effectiveStatus(item.status);
  const info = statusInfo(item.status);
  const isTerminal = TERMINAL.has(eff);
  const notesChanged = localNotes !== (item.notes ?? "");
  const plannedSaved = item.plannedSubsidyAmount != null && String(item.plannedSubsidyAmount) === localPlanned;
  const approvedSaved = item.approvedSubsidyAmount != null && String(item.approvedSubsidyAmount) === localApproved;
  const canChat = eff !== "new" && !!item.factoryId;

  const invalidate = () => utils.upgradeConsultant.myCases.invalidate();

  const acknowledgeMut = trpc.upgradeConsultant.acknowledge.useMutation({
    onSuccess: () => { invalidate(); toast.success("已查收，案件進入評估中"); },
    onError: (e) => toast.error(e.message || "查收失敗"),
  });

  const statusMut = trpc.upgradeConsultant.updateCaseStatus.useMutation({
    onSuccess: () => { invalidate(); toast.success("狀態已更新"); },
    onError: (e) => toast.error(e.message || "狀態更新失敗"),
  });

  const notesMut = trpc.upgradeConsultant.updateCaseNotes.useMutation({
    onSuccess: () => { invalidate(); toast.success("備註已儲存"); },
    onError: (e) => toast.error(e.message || "儲存失敗"),
  });

  const amountsMut = trpc.upgradeConsultant.updateCaseAmounts.useMutation({
    onSuccess: () => { invalidate(); toast.success("金額已儲存"); },
    onError: (e) => toast.error(e.message || "金額儲存失敗"),
  });

  const chatMut = trpc.chat.getOrCreate.useMutation({
    onSuccess: (conv) => navigate(`/chat/${conv.id}`),
    onError: (e) => toast.error(e.message || "無法開啟對話"),
  });

  const busy = acknowledgeMut.isPending || statusMut.isPending || notesMut.isPending || amountsMut.isPending;

  // ── 動作處理 ────────────────────────────────────────────────────────────────

  const handleMarkIneligible = () => {
    if (!localNotes.trim()) { toast.error("請先填寫資格不符原因（備註欄）"); return; }
    if (notesChanged) { toast.error("請先儲存備註，再標記資格不符"); return; }
    statusMut.mutate({ applicationId: item.id, nextStatus: "ineligible" });
  };

  const handleAccepted = async () => {
    if (!localNotes.trim()) { toast.error("立案前請先填寫顧問備註"); return; }
    if (notesChanged) { toast.error("請先儲存備註，再立案處理"); return; }
    statusMut.mutate({ applicationId: item.id, nextStatus: "accepted" });
  };

  const handleSubmitted = async () => {
    if (item.plannedSubsidyAmount == null && !localPlanned.trim()) {
      toast.error("送件前請先填寫並儲存預計送審金額"); return;
    }
    if (localPlanned.trim() && !plannedSaved) {
      const amt = parseAmount(localPlanned);
      if (!amt) { toast.error("請填寫有效的預計送審金額（1～1億）"); return; }
      await amountsMut.mutateAsync({ applicationId: item.id, plannedSubsidyAmount: amt });
    }
    statusMut.mutate({ applicationId: item.id, nextStatus: "submitted" });
  };

  const handleApproved = async () => {
    const amt = parseAmount(localApproved);
    if (!amt) { toast.error("案件通過前請填寫實際過案金額（1～1億）"); return; }
    if (!approvedSaved) {
      await amountsMut.mutateAsync({ applicationId: item.id, approvedSubsidyAmount: amt });
    }
    statusMut.mutate({ applicationId: item.id, nextStatus: "approved" });
  };

  const createdDate = new Date(item.createdAt).toLocaleDateString("zh-TW");
  const updatedDate = new Date(item.updatedAt).toLocaleDateString("zh-TW");
  const showUpdated = Math.abs(new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime()) > 5000;

  return (
    <Card className={`overflow-hidden ${eff === "new" ? "border-blue-200 bg-blue-50/20" : ""} ${eff === "ineligible" ? "border-red-200 bg-red-50/10" : ""} ${eff === "rejected" ? "border-rose-200 bg-rose-50/10" : ""}`}>
      <CardContent className="p-4 space-y-3">

        {/* 標題行 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base">{item.companyName}</span>
              <Badge className={`${info.color} border-0 text-xs`}>{info.label}</Badge>
              {eff === "new" && <span className="text-xs text-blue-600 font-medium">● 待查收</span>}
              {item.factoryId && (
                <a
                  href={`/factory/${item.factoryId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 text-xs border border-orange-200 hover:bg-orange-100 transition-colors"
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
              {item.plannedSubsidyAmount != null && (
                <div className="col-span-2"><span className="text-muted-foreground">預計送審金額：</span>{formatNTD(item.plannedSubsidyAmount)}</div>
              )}
              {item.approvedSubsidyAmount != null && (
                <div className="col-span-2"><span className="text-muted-foreground">實際過案金額：</span><span className="text-green-700 font-medium">{formatNTD(item.approvedSubsidyAmount)}</span></div>
              )}
            </div>
          </div>
        )}

        {/* 顧問備註 */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            顧問備註
            {eff === "evaluating" && <span className="text-red-500 ml-1">（立案前必填）</span>}
            {eff === "ineligible" && <span className="text-muted-foreground/70 ml-1">（仍可更新）</span>}
          </p>
          <Textarea
            value={localNotes}
            onChange={e => setLocalNotes(e.target.value)}
            placeholder="記錄聯繫狀況、評估結果、資格不符原因、政府補助方案等…"
            rows={2}
            className="text-xs resize-none"
          />
          {notesChanged && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => notesMut.mutate({ applicationId: item.id, notes: localNotes })}
            >
              {notesMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
              儲存備註
            </Button>
          )}
        </div>

        {/* 預計送審金額（accepted 可填寫、submitted/approved 展示） */}
        {(eff === "accepted" || eff === "submitted" || eff === "approved") && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              預計送審金額
              {eff === "accepted" && <span className="text-amber-600 ml-1">（送件前必填）</span>}
            </p>
            {eff === "approved" ? (
              <p className="text-sm font-medium">
                {item.plannedSubsidyAmount != null ? formatNTD(item.plannedSubsidyAmount) : "—"}
              </p>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground shrink-0">NT$</span>
                <Input
                  type="number"
                  min={1}
                  max={100000000}
                  value={localPlanned}
                  onChange={e => setLocalPlanned(e.target.value)}
                  placeholder="例：3000000"
                  className="h-8 text-xs"
                />
                {localPlanned !== (item.plannedSubsidyAmount != null ? String(item.plannedSubsidyAmount) : "") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs shrink-0"
                    disabled={busy}
                    onClick={() => {
                      const amt = parseAmount(localPlanned);
                      if (!amt) { toast.error("請填寫有效金額（1～1億）"); return; }
                      amountsMut.mutate({ applicationId: item.id, plannedSubsidyAmount: amt });
                    }}
                  >
                    {amountsMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    儲存
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 實際過案金額（submitted 填寫、approved/transforming/completed 展示） */}
        {(eff === "submitted" || eff === "approved" || eff === "transforming" || eff === "completed") && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              實際過案金額
              {eff === "submitted" && <span className="text-green-600 ml-1">（案件通過前必填）</span>}
            </p>
            {eff === "submitted" ? (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground shrink-0">NT$</span>
                <Input
                  type="number"
                  min={1}
                  max={100000000}
                  value={localApproved}
                  onChange={e => setLocalApproved(e.target.value)}
                  placeholder="例：3000000"
                  className="h-8 text-xs"
                />
                {localApproved !== (item.approvedSubsidyAmount != null ? String(item.approvedSubsidyAmount) : "") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs shrink-0"
                    disabled={busy}
                    onClick={() => {
                      const amt = parseAmount(localApproved);
                      if (!amt) { toast.error("請填寫有效金額（1～1億）"); return; }
                      amountsMut.mutate({ applicationId: item.id, approvedSubsidyAmount: amt });
                    }}
                  >
                    {amountsMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    儲存
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm font-medium text-green-700">
                {item.approvedSubsidyAmount != null ? formatNTD(item.approvedSubsidyAmount) : "—"}
              </p>
            )}
          </div>
        )}

        {/* 動作區 */}
        <div className="border-t border-border/50 pt-3 flex items-center gap-2 flex-wrap">

          {/* 新案件：查收 */}
          {eff === "new" && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => acknowledgeMut.mutate({ applicationId: item.id })}
            >
              {acknowledgeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              查收案件
            </Button>
          )}

          {/* 評估中：標記資格不符 + 立案處理 */}
          {eff === "evaluating" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50"
                disabled={busy}
                onClick={handleMarkIneligible}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Ban className="w-3.5 h-3.5 mr-1" />}
                標記資格不符
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={busy}
                onClick={handleAccepted}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FileCheck className="w-3.5 h-3.5 mr-1" />}
                立案處理
              </Button>
            </>
          )}

          {/* 已立案處理：送出審核（需先填金額） */}
          {eff === "accepted" && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={handleSubmitted}
            >
              {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              標記已送出審核
            </Button>
          )}

          {/* 已送出審核：政府駁回 / 案件通過 */}
          {eff === "submitted" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-rose-200 text-rose-600 hover:bg-rose-50"
                disabled={busy}
                onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "rejected" })}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ThumbsDown className="w-3.5 h-3.5 mr-1" />}
                政府駁回
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                disabled={busy}
                onClick={handleApproved}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ThumbsUp className="w-3.5 h-3.5 mr-1" />}
                案件通過
              </Button>
            </>
          )}

          {/* 案件通過：進入企業轉型中 */}
          {eff === "approved" && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "transforming" })}
            >
              {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Rocket className="w-3.5 h-3.5 mr-1" />}
              進入企業轉型中
            </Button>
          )}

          {/* 企業轉型中：案件結案 */}
          {eff === "transforming" && (
            <div className="space-y-2 w-full">
              <p className="text-xs text-muted-foreground">一年期專案完成且政府補助尾款撥付後再結案</p>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "completed" })}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FlagTriangleRight className="w-3.5 h-3.5 mr-1" />}
                案件結案
              </Button>
            </div>
          )}

          {/* 終止狀態提示 */}
          {eff === "completed" && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              案件已結案（備註仍可更新）
            </span>
          )}
          {eff === "ineligible" && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              已標記資格不符（備註仍可更新）
            </span>
          )}
          {/* 政府駁回：可補件後重新送出審核 */}
          {eff === "rejected" && (
            <div className="space-y-2 w-full">
              <p className="text-xs text-rose-600">
                政府駁回，請於備註補充修正內容，確認補件完成後再重新送出審核。
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={busy}
                onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "submitted" })}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                重新送出審核
              </Button>
            </div>
          )}

          {/* 私訊廠商（評估中以後，且需有 factoryId） */}
          {eff !== "new" && (
            <Button
              size="sm"
              variant="outline"
              className={`h-8 text-xs ml-auto ${!canChat ? "opacity-40 cursor-not-allowed" : ""}`}
              disabled={busy || !canChat || chatMut.isPending}
              title={!item.factoryId ? "此申請未關聯 OXM 工廠，無法私訊" : "開啟與廠商的對話"}
              onClick={() => { if (canChat) chatMut.mutate({ factoryId: item.factoryId! }); }}
            >
              {chatMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <MessageCircle className="w-3.5 h-3.5 mr-1" />}
              私訊廠商
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── 主頁面 ───────────────────────────────────────────────────────────────────

export default function ConsultantCases() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  const isAdmin = user?.role === "admin";

  const profilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, {
    enabled: !!user && !isAdmin,
  });

  const isActiveConsultant = profilesQuery.data?.some(p => p.isActive) ?? false;
  const canAccess = isAdmin || isActiveConsultant;

  const allCasesQuery = trpc.upgradeConsultant.myCases.useQuery(
    { limit: 200, offset: 0 },
    { enabled: !!user && canAccess, refetchInterval: 60000 }
  );

  if (loading || (!isAdmin && profilesQuery.isLoading)) return <AppLoading />;

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

  const allItems = allCasesQuery.data?.items ?? [];

  const tabItems = (tabKey: string) =>
    allItems.filter(i => STATUS_GROUPS[tabKey]?.includes(i.status) ?? false);

  const tabCount = (tabKey: string) => tabItems(tabKey).length;

  const stats = {
    new:         tabCount("new"),
    evaluating:  tabCount("evaluating"),
    ineligible:  tabCount("ineligible"),
    accepted:    tabCount("accepted"),
    submitted:   tabCount("submitted"),
    rejected:    tabCount("rejected"),
    approved:    tabCount("approved"),
    transforming:tabCount("transforming"),
    completed:   tabCount("completed"),
  };

  const visibleTabs = TAB_ORDER.filter(t => {
    // Admin: show unassigned tab too
    if (t.key === "unassigned" && !isAdmin) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">

        {/* 頁面標題 */}
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-orange-500" />
          <h1 className="text-xl font-bold">顧問中心</h1>
        </div>

        {/* 統計卡（橫向捲動） */}
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-3 min-w-max">
            <StatCard label="新案件"     count={stats.new}          color="blue" />
            <StatCard label="評估中"     count={stats.evaluating}   color="cyan" />
            <StatCard label="資格不符"   count={stats.ineligible}   color="red" />
            <StatCard label="已立案處理" count={stats.accepted}     color="violet" />
            <StatCard label="已送出審核" count={stats.submitted}    color="amber" />
            <StatCard label="政府駁回"   count={stats.rejected}     color="rose" />
            <StatCard label="案件通過"   count={stats.approved}     color="green" />
            <StatCard label="企業轉型中" count={stats.transforming}  color="teal" />
            <StatCard label="案件結案"   count={stats.completed}    color="emerald" />
          </div>
        </div>

        {/* Tabs — 預設顯示新案件，無「全部」 */}
        <Tabs defaultValue="new">
          <TabsList className="flex-wrap h-auto gap-1">
            {visibleTabs.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="text-xs">
                {t.label}
                {tabCount(t.key) > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground w-4 h-4 text-[10px] font-bold">
                    {tabCount(t.key)}
                  </span>
                )}
              </TabsTrigger>
            ))}
            {isAdmin && (
              <TabsTrigger value="unassigned" className="text-xs">
                待分派顧問
                {tabCount("unassigned") > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground w-4 h-4 text-[10px] font-bold">
                    {tabCount("unassigned")}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          {[...visibleTabs, ...(isAdmin ? [{ key: "unassigned", label: "待分派顧問" }] : [])].map(t => (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              {allCasesQuery.isLoading ? (
                <AppLoading />
              ) : tabItems(t.key).length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">目前沒有{t.label}案件</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">共 {tabItems(t.key).length} 筆</p>
                  {tabItems(t.key).map(item => (
                    <CaseCard key={item.id} item={item as Case} />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

      </div>
    </div>
  );
}
