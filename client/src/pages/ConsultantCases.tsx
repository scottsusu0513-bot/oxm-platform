import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
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
  ArrowRight, ArrowLeft, Save, Clock, XCircle, Ban, FileCheck, Send,
  ThumbsDown, ThumbsUp, Rocket, FlagTriangleRight, History,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";

// ── 狀態設定 ─────────────────────────────────────────────────────────────────

const STATUSES: Record<string, { label: string; color: string }> = {
  new:         { label: "新案件",     color: "bg-blue-100 text-blue-700" },
  evaluating:  { label: "評估中",     color: "bg-cyan-100 text-cyan-700" },
  ineligible:  { label: "資格不符",   color: "bg-red-100 text-red-700" },
  deferred:    { label: "緩追區",     color: "bg-orange-100 text-orange-700" },
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
  if (s === "approved") return "transforming";
  return s;
}

// Tab → which raw status values belong to it
const STATUS_GROUPS: Record<string, string[]> = {
  new:         ["new"],
  evaluating:  ["evaluating", "viewed", "contacted"],
  ineligible:  ["ineligible"],
  deferred:    ["deferred"],
  accepted:    ["accepted", "consulting"],
  submitted:   ["submitted"],
  rejected:    ["rejected"],
  transforming:["transforming", "approved"],  // approved 舊資料映射到企業轉型中
  completed:   ["completed"],
  unassigned:  ["unassigned"],
};

// 頁面順序：資格不符 → 緩追區 → 已立案處理中（緩追區工廠體質符合但目前無適合
// 補助方案，暫緩追蹤，等待後續合適補助出現，不算最終資格判定）。
const TAB_ORDER = [
  { key: "new",          label: "新案件" },
  { key: "evaluating",   label: "評估中" },
  { key: "ineligible",   label: "資格不符" },
  { key: "deferred",     label: "緩追區" },
  { key: "accepted",     label: "已立案處理" },
  { key: "submitted",    label: "已送出審核" },
  { key: "rejected",     label: "政府駁回" },
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

const ANNUAL_REVENUE_LABELS: Record<string, string> = {
  under_5m: "500 萬以下",
  "5m_to_10m": "500～1,000 萬",
  over_10m: "1,000 萬以上",
};

const EMPLOYEE_LABELS: Record<string, string> = {
  "1_5": "1～5 人",
  "6_30": "6～30 人",
  "31_100": "31～100 人",
  "101_300": "101～300 人",
  over_300: "300 人以上",
};

const EXPORT_LABELS: Record<string, string> = {
  // 新選項（2026-06 起）
  direct_with_export_quote:   "直接出口（含出口報價單）",
  indirect_trading_company:   "間接出口－透過貿易商",
  indirect_distributor_agent: "間接出口－有經銷商／代理商",
  no_export:                  "無出口",
  // 舊選項（向下相容，不刪除）
  none:     "無出口",
  direct:   "直接出口",
  trader:   "透過貿易商出口",
  customer: "客戶代為出口",
  multiple: "多種模式",
};

// ── 資本額分級 ───────────────────────────────────────────────────────────────

type CapitalTier = "under_500" | "over_500" | "unknown";

function getCapitalTier(capitalAmount: string): CapitalTier {
  // 舊英文格式
  if (capitalAmount === "under_500w") return "under_500";
  if (["500w_1000w", "1000w_5000w", "5000w_1y", "over_1y"].includes(capitalAmount)) return "over_500";
  // 新中文格式（shared/constants.ts CAPITAL_OPTIONS）
  if (["100萬以下", "100~500萬"].includes(capitalAmount)) return "under_500";
  if (["500~2000萬", "2000~5000萬", "5000萬以上"].includes(capitalAmount)) return "over_500";
  return "unknown";
}

const CAPITAL_TIER_BADGE: Record<CapitalTier, { label: string; cls: string }> = {
  under_500: { label: "< 500萬", cls: "bg-sky-100 text-sky-700 border-sky-200" },
  over_500:  { label: "≥ 500萬", cls: "bg-violet-100 text-violet-700 border-violet-200" },
  unknown:   { label: "資本額未標示", cls: "bg-slate-100 text-slate-500 border-slate-200" },
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
  annualRevenue?: string | null;
  employeeCount: string;
  factoryType: string;
  isEnterpriseFirm?: boolean | null;
  hasGovernmentProject: boolean;
  governmentProjectName: string | null;
  hasGovernmentAward: boolean;
  governmentAwardName: string | null;
  hasAppliedForGovernmentSubsidy?: boolean | null;
  hasPatent: boolean;
  patentCount: number | null;
  exportStatus: string;
  notes: string | null;
  status: string;
  factoryId?: number | null;
  factoryName?: string | null;
  plannedSubsidyAmount?: number | null;
  approvedSubsidyAmount?: number | null;
  consultantFeeMode?: string | null;
  consultantFeePercentage?: string | null;
  consultantFeeAmount?: number | null;
  oxmCommissionRate?: string | null;
  oxmCommissionAmount?: number | null;
  submittedSubsidyProgram?: string | null;
  submittedSubsidyProgramOther?: string | null;
  statusTimeline?: Record<string, string> | null;
  viewedAt?: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
  // 承辦顧問（由 assignedConsultantId → 綁定的 userId 一路 join 取得的顯示名稱，
  // 不是案件地區字串）；未指派或該地區尚未綁定使用者時為 null。
  assignedConsultantUserName?: string | null;
  // 最後更新者：userId 供關聯用，name snapshot 是當下顯示名稱快照。舊案件若
  // 從未被這次新增的邏輯更新過，兩者皆為初始值（null / 空字串），視為「尚無
  // 更新紀錄」，不可用其他欄位猜測。
  lastUpdatedByUserId?: number | null;
  lastUpdatedByNameSnapshot?: string;
};

// ── 金額格式化 ───────────────────────────────────────────────────────────────

function formatNTD(n: number) {
  return `NT$ ${n.toLocaleString("zh-TW")}`;
}

function fmtDt(d: Date | string): string {
  const dt = new Date(d);
  const Y = dt.getFullYear();
  const M = String(dt.getMonth() + 1).padStart(2, "0");
  const D = String(dt.getDate()).padStart(2, "0");
  const h = String(dt.getHours()).padStart(2, "0");
  const m = String(dt.getMinutes()).padStart(2, "0");
  return `${Y}/${M}/${D} ${h}:${m}`;
}

// 最後更新時間固定以台灣時間顯示（YYYY/MM/DD HH:mm，24 小時制），不依賴瀏覽器
// 所在時區——與上面 fmtDt（案件流程時間軸，沿用既有瀏覽器本地時間慣例）刻意
// 分開，因為「最後更新」欄位的需求明確要求固定台灣時間。
function fmtTaipeiDateTime(d: Date | string): string {
  const dt = new Date(d);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(dt);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

// ── 案件流程時間軸 ──────────────────────────────────────────────────────────

const TIMELINE_STAGES = [
  { key: "new",          label: "送出申請",   dot: "bg-blue-400" },
  { key: "evaluating",   label: "評估中",     dot: "bg-cyan-500" },
  { key: "ineligible",   label: "資格不符",   dot: "bg-red-500" },
  { key: "accepted",     label: "已立案處理", dot: "bg-violet-500" },
  { key: "submitted",    label: "已送出審核", dot: "bg-amber-500" },
  { key: "rejected",     label: "政府駁回",   dot: "bg-rose-500" },
  { key: "transforming", label: "企業轉型中", dot: "bg-teal-500" },
  { key: "completed",    label: "案件結案",   dot: "bg-emerald-500" },
] as const;

function CaseTimeline({ item }: { item: Case }) {
  const tl = item.statusTimeline ?? {};
  const eff = effectiveStatus(item.status);

  const getTime = (key: string): string | null => {
    if (key === "new") {
      return tl.new ?? (item.createdAt instanceof Date
        ? item.createdAt.toISOString()
        : String(item.createdAt));
    }
    if (key === "evaluating") {
      return tl.evaluating ?? (item.viewedAt
        ? (item.viewedAt instanceof Date ? item.viewedAt.toISOString() : String(item.viewedAt))
        : null);
    }
    return tl[key] ?? null;
  };

  const visibleStages = TIMELINE_STAGES.filter(s => {
    if (s.key === "new") return true;
    return !!getTime(s.key) || s.key === eff;
  });

  return (
    <div className="relative pl-5 space-y-2.5 py-1">
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />
      {visibleStages.map(s => {
        const time = getTime(s.key);
        const isCurrent = s.key === eff;
        const isDone = !!time;

        return (
          <div key={s.key} className="relative flex gap-2.5 items-start">
            <div className="absolute -left-[18px] mt-0.5 z-10">
              {isCurrent && !isDone ? (
                <div className={`w-3 h-3 rounded-full ring-2 ring-offset-1 ring-orange-300 ${s.dot}`} />
              ) : isDone ? (
                <div className={`w-3 h-3 rounded-full ${isCurrent ? `ring-2 ring-offset-1 ring-orange-300 ${s.dot}` : s.dot}`} />
              ) : (
                <div className="w-3 h-3 rounded-full bg-muted border border-border" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-medium ${isCurrent ? "text-orange-600" : isDone ? "text-foreground" : "text-muted-foreground/60"}`}>
                {s.label}
              </span>
              {time ? (
                <div className="text-xs text-muted-foreground leading-tight">{fmtDt(time)}</div>
              ) : isCurrent ? (
                <div className="text-xs text-muted-foreground/50 leading-tight">進行中</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
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
  orange:  "bg-orange-50 border-orange-100 text-orange-700",
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

// ── 新案件分區（依資本額） ──────────────────────────────────────────────────

function NewCasesSplit({ items, targetCaseId }: { items: Case[]; targetCaseId: string | null }) {
  const under   = items.filter(i => getCapitalTier(i.capitalAmount) === "under_500");
  const over    = items.filter(i => getCapitalTier(i.capitalAmount) === "over_500");
  const unknown = items.filter(i => getCapitalTier(i.capitalAmount) === "unknown");

  if (items.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">目前沒有新案件</p>
      </div>
    );
  }

  const renderGroup = (
    label: string,
    lineCls: string,
    badgeCls: string,
    groupItems: Case[],
    emptyMsg: string,
  ) => (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={`h-px flex-1 ${lineCls}`} />
        <span className={`text-[11px] font-semibold px-3 py-1 rounded-full border whitespace-nowrap ${badgeCls}`}>
          {label} · {groupItems.length} 筆
        </span>
        <div className={`h-px flex-1 ${lineCls}`} />
      </div>
      {groupItems.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">{emptyMsg}</p>
      ) : (
        <div className="space-y-4">
          {groupItems.map(item => (
            <CaseCard key={item.id} item={item} defaultExpanded={String(item.id) === targetCaseId} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">共 {items.length} 筆新案件</p>
      {renderGroup(
        "資本額低於 500 萬", "bg-sky-200", "text-sky-700 bg-sky-50 border-sky-200",
        under, "目前沒有低於 500 萬資本額的新案件",
      )}
      {renderGroup(
        "資本額 500 萬以上", "bg-violet-200", "text-violet-700 bg-violet-50 border-violet-200",
        over, "目前沒有 500 萬以上資本額的新案件",
      )}
      {unknown.length > 0 && renderGroup(
        "資本額未標示", "bg-slate-200", "text-slate-500 bg-slate-50 border-slate-200",
        unknown, "",
      )}
    </div>
  );
}

// ── 案件卡片 ─────────────────────────────────────────────────────────────────

function CaseCard({ item, defaultExpanded }: { item: Case; defaultExpanded?: boolean }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (defaultExpanded && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);
  const [showTimeline, setShowTimeline] = useState(false);
  const [localNotes, setLocalNotes] = useState(item.notes ?? "");
  const [localPlanned, setLocalPlanned] = useState(
    item.plannedSubsidyAmount != null ? String(item.plannedSubsidyAmount) : ""
  );
  const [localApproved, setLocalApproved] = useState(
    item.approvedSubsidyAmount != null ? String(item.approvedSubsidyAmount) : ""
  );
  // 顧問服務費
  const [localFeeMode, setLocalFeeMode] = useState<"percentage" | "fixed" | "">(
    (item.consultantFeeMode as "percentage" | "fixed") ?? ""
  );
  const [localFeePct, setLocalFeePct] = useState(
    item.consultantFeePercentage ? String(parseFloat(item.consultantFeePercentage)) : ""
  );
  const [localFeeAmt, setLocalFeeAmt] = useState(
    item.consultantFeeAmount != null ? String(item.consultantFeeAmount) : ""
  );
  const [feeDirty, setFeeDirty] = useState(false);
  // 送審補助方案
  const [localProgram, setLocalProgram] = useState(item.submittedSubsidyProgram ?? "");
  const [localProgramOther, setLocalProgramOther] = useState(item.submittedSubsidyProgramOther ?? "");
  const [programDirty, setProgramDirty] = useState(false);

  const eff = effectiveStatus(item.status);
  const info = statusInfo(item.status);
  const isTerminal = TERMINAL.has(eff);
  const notesChanged = localNotes !== (item.notes ?? "");
  const plannedSaved = item.plannedSubsidyAmount != null && String(item.plannedSubsidyAmount) === localPlanned;
  const approvedSaved = item.approvedSubsidyAmount != null && String(item.approvedSubsidyAmount) === localApproved;
  const canChat = eff !== "new" && !!item.factoryId;

  // Capital tier badge
  const tier = getCapitalTier(item.capitalAmount);
  const tierBadge = CAPITAL_TIER_BADGE[tier];

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

  const busy = acknowledgeMut.isPending || statusMut.isPending || notesMut.isPending || amountsMut.isPending;

  const openChatDraft = () => {
    if (!canChat) return;
    navigate(`/chat/new?factoryId=${item.factoryId}`, {
      state: { from: `/upgrade-consultant/cases?caseId=${item.id}` },
    });
  };

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

  const handleSaveProgram = async () => {
    if (!localProgram) { toast.error("請選擇送審補助方案"); return; }
    if (localProgram === "其他" && !localProgramOther.trim()) {
      toast.error("請填寫實際補助方案名稱"); return;
    }
    await amountsMut.mutateAsync({
      applicationId: item.id,
      submittedSubsidyProgram: localProgram as "SBIR" | "CITD" | "SIIR" | "研發轉型補助" | "海外通路計畫" | "其他",
      submittedSubsidyProgramOther: localProgram === "其他" ? localProgramOther.trim() : null,
    });
    setProgramDirty(false);
  };

  const handleSaveFee = async () => {
    if (!localFeeMode) { toast.error("請選擇服務費計算方式"); return; }
    if (localFeeMode === "percentage") {
      const pct = parseFloat(localFeePct);
      if (isNaN(pct) || pct < 0 || pct > 100) { toast.error("請填寫有效的服務費成數（0～100）"); return; }
      if (!item.approvedSubsidyAmount) { toast.error("請先填寫並儲存政府實際過案金額，再填寫百分比服務費"); return; }
      await amountsMut.mutateAsync({ applicationId: item.id, consultantFeeMode: "percentage", consultantFeePercentage: pct });
    } else {
      const amt = parseAmount(localFeeAmt);
      if (amt === null) { toast.error("請填寫有效的服務費金額（0～1億）"); return; }
      await amountsMut.mutateAsync({ applicationId: item.id, consultantFeeMode: "fixed", consultantFeeAmount: amt });
    }
    setFeeDirty(false);
  };

  const handleApproved = async () => {
    const amt = parseAmount(localApproved);
    if (!amt) { toast.error("案件通過前請填寫實際過案金額（1～1億）"); return; }
    if (!approvedSaved) {
      await amountsMut.mutateAsync({ applicationId: item.id, approvedSubsidyAmount: amt });
    }
    // 顧問服務費必須已儲存
    if (feeDirty) { toast.error("請先儲存顧問服務費，再進行案件通過"); return; }
    if (!item.consultantFeeMode || item.consultantFeeAmount == null) {
      toast.error("案件通過前請先填寫並儲存顧問服務費"); return;
    }
    // 送審補助方案必須已儲存
    if (programDirty) { toast.error("請先儲存送審補助方案，再進行案件通過"); return; }
    if (!item.submittedSubsidyProgram) {
      toast.error("案件通過前請先選擇並儲存送審補助方案"); return;
    }
    statusMut.mutate({ applicationId: item.id, nextStatus: "transforming" });
  };

  const createdDate = new Date(item.createdAt).toLocaleDateString("zh-TW");
  const updatedDate = new Date(item.updatedAt).toLocaleDateString("zh-TW");
  const showUpdated = Math.abs(new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime()) > 5000;

  return (
    <Card ref={cardRef} className={`overflow-hidden ${eff === "new" ? "border-blue-200 bg-blue-50/20" : ""} ${eff === "ineligible" ? "border-red-200 bg-red-50/10" : ""} ${eff === "rejected" ? "border-rose-200 bg-rose-50/10" : ""}`}>
      <CardContent className="p-4 space-y-3">

        {/* 標題行 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-base break-all">{item.companyName}</span>
              <Badge className={`${info.color} border-0 text-xs shrink-0`}>{info.label}</Badge>
              {/* 資本額級距標籤 */}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium shrink-0 ${tierBadge.cls}`}>
                {tierBadge.label}
              </span>
              {eff === "new" && <span className="text-xs text-blue-600 font-medium shrink-0">● 待查收</span>}
              {item.factoryId && (
                <a
                  href={`/factory/${item.factoryId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 text-xs border border-orange-200 hover:bg-orange-100 transition-colors shrink-0"
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
            {/* 承辦顧問／最後更新者：由後端關聯／快照直接帶回，不是前端猜測顯示。 */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
              <span>承辦顧問：{item.assignedConsultantUserName ?? "尚未指派"}</span>
              <span>
                最後更新：{item.lastUpdatedByNameSnapshot
                  ? `${item.lastUpdatedByNameSnapshot}｜${fmtTaipeiDateTime(item.updatedAt)}`
                  : "尚無更新紀錄"}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0 space-y-0.5 ml-2">
            <div className="text-xs text-muted-foreground whitespace-nowrap">{createdDate}</div>
            {showUpdated && (
              <div className="text-xs text-muted-foreground/60 whitespace-nowrap flex items-center gap-1 justify-end">
                <Clock className="w-3 h-3" />{updatedDate}
              </div>
            )}
            <button
              className={`flex items-center gap-1 text-xs mt-0.5 ml-auto transition-colors ${showTimeline ? "text-orange-500" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setShowTimeline(v => !v)}
            >
              <History className="w-3 h-3" />
              案件流程
            </button>
          </div>
        </div>

        {/* 案件流程時間軸（可展開） */}
        {showTimeline && (
          <div className="border-t border-border/50 pt-2 pb-1">
            <CaseTimeline item={item} />
          </div>
        )}

        {/* 標籤列 */}
        <div className="flex flex-wrap gap-1.5 text-xs">
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
            {/* 手機版 1 欄，桌面版 2 欄 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div><span className="text-muted-foreground">聯絡人：</span>{item.contactName}</div>
              <div><span className="text-muted-foreground">所在地：</span>{item.location}</div>
              <div><span className="text-muted-foreground">資本額：</span>{CAPITAL_LABELS[item.capitalAmount] ?? item.capitalAmount}</div>
              <div><span className="text-muted-foreground">年營收：</span>{item.annualRevenue ? (ANNUAL_REVENUE_LABELS[item.annualRevenue] ?? item.annualRevenue) : "未填"}</div>
              <div><span className="text-muted-foreground">員工：</span>{EMPLOYEE_LABELS[item.employeeCount] ?? item.employeeCount}</div>
              <div><span className="text-muted-foreground">是否為企業社：</span>{item.isEnterpriseFirm == null ? "未填" : (item.isEnterpriseFirm ? "是" : "否")}</div>
              <div><span className="text-muted-foreground">曾申請政府補助：</span>{item.hasAppliedForGovernmentSubsidy == null ? "未填" : (item.hasAppliedForGovernmentSubsidy ? "有" : "沒有")}</div>
              <div><span className="text-muted-foreground">政府計畫：</span>{item.hasGovernmentProject ? (item.governmentProjectName || "有（未填名稱）") : "無"}</div>
              <div><span className="text-muted-foreground">專利：</span>{item.hasPatent ? `有（${item.patentCount ?? "未填"}件）` : "無"}</div>
              {item.plannedSubsidyAmount != null && (
                <div className="sm:col-span-2"><span className="text-muted-foreground">預計送審金額：</span>{formatNTD(item.plannedSubsidyAmount)}</div>
              )}
              {item.approvedSubsidyAmount != null && (
                <div className="sm:col-span-2"><span className="text-muted-foreground">實際過案金額：</span><span className="text-green-700 font-medium">{formatNTD(item.approvedSubsidyAmount)}</span></div>
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
            {eff === "deferred" && <span className="text-muted-foreground/70 ml-1">（仍可更新）</span>}
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

        {/* 實際過案金額（submitted 填寫、transforming/completed 展示） */}
        {(eff === "submitted" || eff === "transforming" || eff === "completed") && (
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

        {/* 顧問服務費（submitted 填寫，transforming/completed 展示） */}
        {(eff === "submitted" || eff === "transforming" || eff === "completed") && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              顧問服務費
              {eff === "submitted" && <span className="text-green-600 ml-1">（案件通過前必填）</span>}
            </p>
            {eff === "submitted" ? (
              <div className="space-y-2">
                {/* 模式切換 */}
                <div className="flex gap-2">
                  {(["percentage", "fixed"] as const).map(mode => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={localFeeMode === mode ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => { setLocalFeeMode(mode); setFeeDirty(true); }}
                    >
                      {mode === "percentage" ? "百分比" : "固定金額"}
                    </Button>
                  ))}
                </div>
                {localFeeMode === "percentage" && (
                  <div className="space-y-1">
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number" min={0} max={100} step={0.01}
                        value={localFeePct}
                        onChange={e => { setLocalFeePct(e.target.value); setFeeDirty(true); }}
                        placeholder="例：10"
                        className="h-8 text-xs w-28"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    {localFeePct && item.approvedSubsidyAmount && (
                      <p className="text-xs text-muted-foreground pl-1">
                        顧問服務費：約 {formatNTD(Math.round(item.approvedSubsidyAmount * parseFloat(localFeePct) / 100))}
                      </p>
                    )}
                  </div>
                )}
                {localFeeMode === "fixed" && (
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-muted-foreground shrink-0">NT$</span>
                    <Input
                      type="number" min={0} max={100000000}
                      value={localFeeAmt}
                      onChange={e => { setLocalFeeAmt(e.target.value); setFeeDirty(true); }}
                      placeholder="例：300000"
                      className="h-8 text-xs"
                    />
                  </div>
                )}
                {localFeeMode && feeDirty && (
                  <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={busy} onClick={handleSaveFee}>
                    {amountsMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    儲存服務費
                  </Button>
                )}
                {item.consultantFeeAmount != null && !feeDirty && (
                  <p className="text-xs text-green-700">✓ 顧問服務費：{formatNTD(item.consultantFeeAmount)} 已儲存</p>
                )}
              </div>
            ) : (
              <div className="space-y-0.5 text-sm font-medium">
                {item.consultantFeeAmount != null ? (
                  <p>
                    {item.consultantFeeMode === "percentage" && item.consultantFeePercentage
                      ? `${parseFloat(item.consultantFeePercentage)}%（${formatNTD(item.consultantFeeAmount)}）`
                      : `固定 ${formatNTD(item.consultantFeeAmount)}`}
                  </p>
                ) : <p className="text-muted-foreground text-xs">尚未填寫</p>}
              </div>
            )}
          </div>
        )}

        {/* 送審補助方案（submitted 填寫，transforming/completed 展示） */}
        {(eff === "submitted" || eff === "transforming" || eff === "completed") && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              送審補助方案
              {eff === "submitted" && <span className="text-green-600 ml-1">（案件通過前必填）</span>}
            </p>
            {eff === "submitted" ? (
              <div className="space-y-2">
                {/* 下拉選單 */}
                <select
                  value={localProgram}
                  onChange={e => { setLocalProgram(e.target.value); setProgramDirty(true); setLocalProgramOther(""); }}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">請選擇補助方案</option>
                  {["SBIR","CITD","SIIR","研發轉型補助","海外通路計畫","其他"].map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                {/* 其他 — 手寫欄位 */}
                {localProgram === "其他" && (
                  <Input
                    value={localProgramOther}
                    onChange={e => { setLocalProgramOther(e.target.value); setProgramDirty(true); }}
                    placeholder="請輸入補助方案名稱"
                    maxLength={100}
                    className="h-8 text-xs"
                  />
                )}
                {/* 儲存按鈕 */}
                {localProgram && programDirty && (
                  <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={busy} onClick={handleSaveProgram}>
                    {amountsMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    儲存補助方案
                  </Button>
                )}
                {item.submittedSubsidyProgram && !programDirty && (
                  <p className="text-xs text-green-700">
                    ✓ 已儲存：{item.submittedSubsidyProgram === "其他" && item.submittedSubsidyProgramOther
                      ? `其他：${item.submittedSubsidyProgramOther}`
                      : item.submittedSubsidyProgram}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm font-medium">
                {item.submittedSubsidyProgram
                  ? (item.submittedSubsidyProgram === "其他" && item.submittedSubsidyProgramOther
                    ? `其他：${item.submittedSubsidyProgramOther}`
                    : item.submittedSubsidyProgram)
                  : <span className="text-muted-foreground text-xs">尚未填寫</span>}
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

          {/* 評估中：標記資格不符 + 移至緩追區 + 立案處理 */}
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
                variant="outline"
                className="h-8 text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
                disabled={busy}
                onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "deferred" })}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Clock className="w-3.5 h-3.5 mr-1" />}
                移至緩追區
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

          {/* 緩追區：可重新評估，或直接轉為已立案／資格不符 */}
          {eff === "deferred" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => statusMut.mutate({ applicationId: item.id, nextStatus: "evaluating" })}
              >
                {statusMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ArrowLeft className="w-3.5 h-3.5 mr-1" />}
                重新評估
              </Button>
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

          {/* 企業轉型中：案件結案 */}
          {eff === "transforming" && (
            <div className="space-y-2 w-full">
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
              disabled={busy || !canChat}
              title={!item.factoryId ? "此申請未關聯 OXM 工廠，無法私訊" : "開啟與廠商的對話"}
              onClick={openChatDraft}
            >
              <MessageCircle className="w-3.5 h-3.5 mr-1" />
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
  const searchString = useSearch();
  const targetCaseId = new URLSearchParams(searchString).get("caseId");

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

  const tabItems = (tabKey: string): Case[] =>
    allItems.filter(i => STATUS_GROUPS[tabKey]?.includes(i.status) ?? false) as Case[];

  const tabCount = (tabKey: string) => tabItems(tabKey).length;

  const stats = {
    new:         tabCount("new"),
    evaluating:  tabCount("evaluating"),
    ineligible:  tabCount("ineligible"),
    deferred:    tabCount("deferred"),
    accepted:    tabCount("accepted"),
    submitted:   tabCount("submitted"),
    rejected:    tabCount("rejected"),
    transforming:tabCount("transforming"),
    completed:   tabCount("completed"),
  };

  // 顧問中心不顯示待分派顧問（包含管理員身份）；待分派案件移至管理員後台
  const allTabs = TAB_ORDER;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-8 max-w-3xl mx-auto space-y-6">

        <FloatingBackButton fallbackHref="/" />

        {/* 頁面標題 */}
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-orange-500" />
          <h1 className="text-xl font-bold">顧問中心</h1>
        </div>

        {/* 統計卡（橫向捲動，不含待分派顧問） */}
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-3 min-w-max">
            <StatCard label="新案件"     count={stats.new}          color="blue" />
            <StatCard label="評估中"     count={stats.evaluating}   color="cyan" />
            <StatCard label="資格不符"   count={stats.ineligible}   color="red" />
            <StatCard label="緩追區"     count={stats.deferred}     color="orange" />
            <StatCard label="已立案處理" count={stats.accepted}     color="violet" />
            <StatCard label="已送出審核" count={stats.submitted}    color="amber" />
            <StatCard label="政府駁回"   count={stats.rejected}     color="rose" />
            <StatCard label="企業轉型中" count={stats.transforming}  color="teal" />
            <StatCard label="案件結案"   count={stats.completed}    color="emerald" />
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="new">
          <div className="overflow-x-auto pb-1">
            <TabsList className="flex h-auto gap-1 w-max lg:w-full">
              {allTabs.map(t => (
                <TabsTrigger key={t.key} value={t.key} className="text-xs whitespace-nowrap lg:flex-1">
                  {t.label}
                  {tabCount(t.key) > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground w-4 h-4 text-[10px] font-bold">
                      {tabCount(t.key)}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {allTabs.map(t => (
            <TabsContent key={t.key} value={t.key} className="mt-4">
              {allCasesQuery.isLoading ? (
                <AppLoading />
              ) : t.key === "new" ? (
                <NewCasesSplit items={tabItems("new")} targetCaseId={targetCaseId} />
              ) : tabItems(t.key).length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">目前沒有{t.label}案件</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">共 {tabItems(t.key).length} 筆</p>
                  {tabItems(t.key).map(item => (
                    <CaseCard key={item.id} item={item} defaultExpanded={String(item.id) === targetCaseId} />
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
