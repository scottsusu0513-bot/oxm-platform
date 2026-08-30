import { useEffect, useReducer, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getFriendlyFormError } from "@/lib/formErrors";
import {
  Building2, Phone, MapPin, Clock, User as UserIcon, Loader2, ShieldAlert,
  ArrowRight, Save, LogIn,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import LoginDialog from "@/components/LoginDialog";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { CaseStatusOverview, type CaseStatusDef, type CaseStatusColor } from "@/components/CaseStatusOverview";
import { AiOriginBadge, AiAssessmentDialogTrigger } from "@/components/AiAssessmentBadge";
import { resolveFinanceCasesViewState, selectAssignableConsultants } from "./financeConsultantCasesViewState";
import {
  createInitialFinanceCasesPaginationState, financeCasesPaginationReducer, selectMergedFinanceCases,
} from "./financeCasesPagination";

const STATUSES: Record<string, { label: string; color: string }> = {
  new:            { label: "新案件",   color: "bg-blue-100 text-blue-700" },
  evaluating:     { label: "評估中",   color: "bg-cyan-100 text-cyan-700" },
  deferred:       { label: "緩追區",   color: "bg-orange-100 text-orange-700" },
  not_interested: { label: "無意願",   color: "bg-rose-100 text-rose-700" },
  won:            { label: "成交區",   color: "bg-emerald-100 text-emerald-700" },
};

function statusInfo(s: string) {
  return STATUSES[s] ?? { label: s, color: "bg-gray-100 text-gray-700" };
}

const TAB_ORDER: { key: string; label: string }[] = [
  { key: "new", label: "新案件" },
  { key: "evaluating", label: "評估中" },
  { key: "deferred", label: "緩追區" },
  { key: "not_interested", label: "無意願" },
  { key: "won", label: "成交區" },
];

// financeApplications.status enum 本身只有這 5 個值（無 unassigned／archived），
// 見 drizzle/schema.ts；顏色僅供視覺分類，不影響狀態邏輯本身。
const FINANCE_STATUS_COLORS: Record<string, CaseStatusColor> = {
  new: "blue",
  evaluating: "cyan",
  deferred: "orange",
  not_interested: "rose",
  won: "emerald",
};

const FINANCE_STATUS_DEFS: CaseStatusDef[] = TAB_ORDER.map(t => ({
  key: t.key,
  label: t.label,
  color: FINANCE_STATUS_COLORS[t.key] ?? "slate",
}));

// 每個狀態下允許推進的下一個狀態（與 server FINANCE_ALLOWED 一致）
const NEXT_STATUS_OPTIONS: Record<string, { value: string; label: string }[]> = {
  new: [{ value: "evaluating", label: "開始評估" }],
  evaluating: [
    { value: "deferred", label: "移至緩追區" },
    { value: "not_interested", label: "標記無意願" },
    { value: "won", label: "標記成交" },
  ],
  deferred: [
    { value: "evaluating", label: "重新評估" },
    { value: "not_interested", label: "標記無意願" },
    { value: "won", label: "標記成交" },
  ],
};

function fmtTaipeiDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function NotesEditor({ applicationId, initialNotes, onMutated }: { applicationId: number; initialNotes: string | null; onMutated: () => void }) {
  const [value, setValue] = useState(initialNotes ?? "");
  const mutation = trpc.financeConsultant.updateCaseNotes.useMutation({
    onSuccess: () => {
      toast.success("備註已儲存");
      onMutated();
    },
    onError: (err) => toast.error(getFriendlyFormError(err, "儲存失敗，請稍後再試。")),
  });
  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="顧問內部備註（僅顧問／管理員可見）"
        className="text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ applicationId, notes: value })}
      >
        {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        儲存備註
      </Button>
    </div>
  );
}

function AssignConsultantControl({ applicationId, currentConsultantId, onMutated }: { applicationId: number; currentConsultantId: number | null; onMutated: () => void }) {
  const { data: consultants } = trpc.financeConsultant.adminListConsultants.useQuery();
  const mutation = trpc.financeConsultant.adminAssignConsultant.useMutation({
    onSuccess: () => {
      toast.success("已更新承辦顧問");
      onMutated();
    },
    onError: (err) => toast.error(getFriendlyFormError(err, "指派失敗，請稍後再試。")),
  });
  // 只列出啟用中且已綁定使用者帳號的顧問——見
  // client/src/pages/financeConsultantCasesViewState.ts 的
  // selectAssignableConsultants 與其行為測試。
  const assignableConsultants = selectAssignableConsultants(consultants);
  return (
    <Select
      value={currentConsultantId != null ? String(currentConsultantId) : "none"}
      onValueChange={(v) => mutation.mutate({ applicationId, consultantId: v === "none" ? null : Number(v) })}
    >
      <SelectTrigger className="h-8 text-xs w-44">
        <SelectValue placeholder="指派顧問" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">尚未指派</SelectItem>
        {assignableConsultants.map(c => (
          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CaseCard({ item, isAdmin, onMutated }: { item: any; isAdmin: boolean; onMutated: () => void }) {
  const statusMutation = trpc.financeConsultant.updateCaseStatus.useMutation({
    onSuccess: () => {
      toast.success("狀態已更新");
      onMutated();
    },
    onError: (err) => toast.error(getFriendlyFormError(err, "更新失敗，請稍後再試。")),
  });
  const info = statusInfo(item.status);
  const nextOptions = NEXT_STATUS_OPTIONS[item.status] ?? [];

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-semibold truncate">{item.companyNameSnapshot}</span>
              <Badge className={info.color}>{info.label}</Badge>
              {item.aiAssessment && <AiOriginBadge />}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{item.companyAddressSnapshot}</span>
            </div>
          </div>
          {item.aiAssessment && <AiAssessmentDialogTrigger serviceKey="finance" assessment={item.aiAssessment} />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5"><UserIcon className="w-3.5 h-3.5 text-muted-foreground" />聯絡人：{item.contactName}</div>
          <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-muted-foreground" />電話：{item.phone}</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />方便聯絡時間：{item.contactTime}</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />送出時間：{fmtTaipeiDateTime(item.createdAt)}</div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-2">
          <span>承辦顧問：{item.assignedConsultantUserName ?? "尚未指派"}</span>
          <span>最後更新者：{item.lastUpdatedByNameSnapshot || "尚無更新紀錄"}</span>
          <span>最後更新時間：{fmtTaipeiDateTime(item.updatedAt)}</span>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">承辦顧問：</span>
            <AssignConsultantControl applicationId={item.id} currentConsultantId={item.assignedConsultantId} onMutated={onMutated} />
          </div>
        )}

        <NotesEditor applicationId={item.id} initialNotes={item.notes} onMutated={onMutated} />

        {nextOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {nextOptions.map(opt => (
              <Button
                key={opt.value}
                size="sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ applicationId: item.id, nextStatus: opt.value as any })}
              >
                {opt.label}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PAGE_SIZE = 200;

function LoginRequiredView() {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container py-24 flex flex-col items-center text-center space-y-6 max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
          <LogIn className="w-8 h-8 text-blue-600" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold">請先登入</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">登入後，若您是啟用中的財務優化顧問或管理員，即可查看案件看板。</p>
        </div>
        <Button
          className="w-full max-w-xs bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white border-0"
          onClick={() => setLoginOpen(true)}
        >
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
        <p className="text-muted-foreground text-sm">{message || "您目前不是啟用中的財務優化顧問，也不是管理員。"}</p>
        <Link href="/">
          <Button variant="outline">返回首頁</Button>
        </Link>
      </div>
    </div>
  );
}

export default function FinanceConsultantCases() {
  const { user, loading: authLoading } = useAuth();
  const [location] = useLocation();
  const [tab, setTab] = useState("new");
  // 分頁狀態改用 reducer：每一頁用 offset 當 key 存成獨立 slot，同一個 offset
  // 重新 refetch（例如 mutation 觸發 invalidate）會整頁取代，不會疊加出重複
  // 案件；合併時用案件 id 去重＋依 createdAt/id 穩定排序。見
  // client/src/pages/financeCasesPagination.ts 與其行為測試
  // server/financeCasesPagination.test.ts。
  const [offset, setOffset] = useState(0);
  const [paginationState, dispatchPagination] = useReducer(
    financeCasesPaginationReducer,
    undefined,
    createInitialFinanceCasesPaginationState,
  );
  const utils = trpc.useUtils();

  // /admin/finance-applications 與 /finance-consultant/cases 共用同一個元件；
  // 深層網址的返回 fallback 依路徑分流，管理員後台頁面回到 /admin，一般顧問
  // 頁面回到顧問中心分流頁，兩者都不應該落到網站首頁。
  const isAdminRoute = location.startsWith("/admin");

  const casesQuery = trpc.financeConsultant.myCases.useQuery(
    { limit: PAGE_SIZE, offset },
    {
      enabled: !!user,
      // 沒有權限（FORBIDDEN）重試也不會成功，不重試才能讓查詢乾脆地落到
      // error 狀態，而不是卡在 react-query v5 的 retry／pending 中間態
      // （曾經實測到 retry 預設值搭配這支查詢的 403 回應，會卡在
      // status:"pending"、fetchStatus:"paused"、isLoading:false 的模稜兩可
      // 狀態，導致畫面誤判成「board」而不是「no-permission」）。
      retry: false,
    }
  );

  useEffect(() => {
    if (!casesQuery.data) return;
    dispatchPagination({ type: "PAGE_LOADED", offset, items: casesQuery.data.items });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casesQuery.data, offset]);

  // Mutation（狀態／備註／指派）成功後呼叫：把分頁狀態重置回只保留第一頁、
  // offset 歸零，再 invalidate 讓第一頁重新 fetch——避免「還停留在第 3 頁，
  // 其他頁面殘留舊資料」的情況，狀態／備註／承辦顧問異動能立即反映在畫面上。
  function handleMutated() {
    dispatchPagination({ type: "RESET", keepOffset: 0 });
    setOffset(0);
    utils.financeConsultant.myCases.invalidate();
  }

  const viewState = resolveFinanceCasesViewState({
    authLoading,
    isAuthenticated: !!user,
    // 未登入時 query 因 enabled:false 停用，react-query 的 isPending 會永遠
    // 停在 true——只在已登入時才把真正的載入狀態傳進去，避免卡在 loading。
    // isPending 搭配 retry:false：已登入時，查詢不是仍在 pending（沒有
    // data／error），就是已經有明確的 data 或 error，不會有模稜兩可的中間態。
    casesLoading: !!user && casesQuery.isPending,
    casesError: !!casesQuery.error,
  });

  if (viewState === "loading") return <AppLoading />;
  if (viewState === "login-required") return <LoginRequiredView />;
  if (viewState === "no-permission") return <NoPermissionView message={casesQuery.error?.message} />;

  const items = selectMergedFinanceCases(paginationState);
  const total = casesQuery.data?.total ?? items.length;
  const hasMore = total > items.length;
  const isAdmin = !!user?.isAdmin;

  const statusCounts: Record<string, number> = {};
  for (const c of items) {
    const key = c.status as string;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  const filteredItems = tab === "all" ? items : items.filter(i => i.status === tab);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <FloatingBackButton
        fallbackHref={isAdminRoute ? "/admin" : "/consultant-center"}
        label={isAdminRoute ? "後台" : "返回"}
      />
      <div className="container py-8 max-w-4xl mx-auto space-y-6">
        {/* 標題與浮動返回鈕（fixed，top ≈ 4.75rem～7rem）分屬不同垂直區塊。
            這裡刻意用 margin-top 而不是 padding-top：padding 只會把「視覺內容」
            往下推，元素自己的 border-box 起始位置不會跟著移動，量測
            getBoundingClientRect() 時兩個元素仍然算相交；margin 才會真的移動
            元素本身的框，讓 390px 窄螢幕下兩者的 bounding rect 確實不相交
            （已用瀏覽器真實量測驗證，非只看 Tailwind class）。桌面版寬度
            足夠，sm:mt-0 讓多餘留白消失，排列不受影響。 */}
        <h1 className="text-xl font-bold mt-14 sm:mt-0">財務優化顧問案件看板</h1>

        <CaseStatusOverview
          statuses={FINANCE_STATUS_DEFS}
          counts={statusCounts}
          totalCount={items.length}
          selectedStatus={tab}
          onStatusChange={setTab}
        />

        <div className="space-y-4">
          {filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">目前沒有案件</p>
          ) : (
            filteredItems.map(item => (
              <CaseCard key={item.id} item={item} isAdmin={isAdmin} onMutated={handleMutated} />
            ))
          )}
        </div>

        {hasMore && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <p className="text-xs text-muted-foreground">已顯示 {items.length} / {total} 筆案件</p>
            <Button
              variant="outline"
              disabled={casesQuery.isFetching}
              onClick={() => setOffset(items.length)}
            >
              {casesQuery.isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              載入更多
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
