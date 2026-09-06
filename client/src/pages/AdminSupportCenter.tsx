import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Flag, HeadphonesIcon, ChevronDown, ChevronUp, User, History, Lightbulb, MessageSquare } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { toast } from "sonner";
import { StatusTimeline } from "@/components/StatusTimeline";

const STATUSES = [
  { value: "pending",    label: "已寄出",  color: "bg-gray-100 text-gray-700" },
  { value: "received",   label: "已收到",  color: "bg-blue-100 text-blue-700" },
  { value: "reviewing",  label: "審查中",  color: "bg-yellow-100 text-yellow-700" },
  { value: "processing", label: "處理中",  color: "bg-orange-100 text-orange-700" },
  { value: "resolved",   label: "已處理",  color: "bg-green-100 text-green-700" },
] as const;

type StatusValue = typeof STATUSES[number]["value"];

function statusInfo(s: string) {
  return STATUSES.find(x => x.value === s) ?? STATUSES[0];
}

// ─── 狀態更新 + 進度時間軸 ───────────────────────────────────────────────────
function ReportActions({ id, currentStatus, currentNote, onUpdate, isPending }: {
  id: number; currentStatus: string; currentNote: string | null;
  onUpdate: (id: number, status: StatusValue, note: string) => void; isPending: boolean;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState<StatusValue>(currentStatus as StatusValue);
  const [note, setNote] = useState(currentNote ?? "");
  const historyQuery = trpc.admin.getReportHistory.useQuery({ id }, { enabled: showHistory });

  return (
    <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-2">
      <div className="flex gap-2">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowHistory(v => !v); setShowEdit(false); }}>
          <History className="w-3.5 h-3.5" />{showHistory ? "收起進度" : "查看進度"}
        </button>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowEdit(v => !v); setShowHistory(false); }}>
          {showEdit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          更新狀態
        </button>
      </div>
      {showHistory && <StatusTimeline history={historyQuery.data} isLoading={historyQuery.isLoading} />}
      {showEdit && (
        <div className="space-y-2">
          <Select value={status} onValueChange={v => setStatus(v as StatusValue)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="處理備註（僅內部可見）" rows={2} className="text-xs" />
          <Button size="sm" className="h-7 text-xs" disabled={isPending} onClick={() => onUpdate(id, status, note)}>儲存</Button>
        </div>
      )}
    </div>
  );
}

function TicketActions({ id, currentStatus, currentNote, onUpdate, isPending }: {
  id: number; currentStatus: string; currentNote: string | null;
  onUpdate: (id: number, status: StatusValue, note: string) => void; isPending: boolean;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState<StatusValue>(currentStatus as StatusValue);
  const [note, setNote] = useState(currentNote ?? "");
  const historyQuery = trpc.admin.getTicketHistory.useQuery({ id }, { enabled: showHistory });

  return (
    <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-2">
      <div className="flex gap-2">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowHistory(v => !v); setShowEdit(false); }}>
          <History className="w-3.5 h-3.5" />{showHistory ? "收起進度" : "查看進度"}
        </button>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowEdit(v => !v); setShowHistory(false); }}>
          {showEdit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          更新狀態
        </button>
      </div>
      {showHistory && <StatusTimeline history={historyQuery.data} isLoading={historyQuery.isLoading} />}
      {showEdit && (
        <div className="space-y-2">
          <Select value={status} onValueChange={v => setStatus(v as StatusValue)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="處理備註（僅內部可見）" rows={2} className="text-xs" />
          <Button size="sm" className="h-7 text-xs" disabled={isPending} onClick={() => onUpdate(id, status, note)}>儲存</Button>
        </div>
      )}
    </div>
  );
}

// ─── 工廠檢舉列表 ─────────────────────────────────────────────────────────────
function ReportsTab() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data, isLoading } = trpc.admin.getReports.useQuery({
    page,
    pageSize: 15,
    status: filterStatus === "all" ? undefined : filterStatus,
  });

  const updateMutation = trpc.admin.updateReportStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); utils.admin.getReports.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-4">
      {/* 篩選 */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={filterStatus === "all" ? "default" : "outline"} onClick={() => { setFilterStatus("all"); setPage(1); }}>全部 {filterStatus === "all" && total > 0 && `(${total})`}</Button>
        {STATUSES.map(s => (
          <Button key={s.value} size="sm" variant={filterStatus === s.value ? "default" : "outline"} onClick={() => { setFilterStatus(s.value); setPage(1); }}>{s.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-8">載入中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">沒有符合的檢舉紀錄</div>
      ) : (
        <div className="space-y-3">
          {items.map(r => {
            const si = statusInfo(r.status);
            return (
              <div key={r.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${si.color}`}>{si.label}</span>
                      <span className="font-medium text-sm">被檢舉工廠：{r.factoryName ?? `#${r.factoryId}`}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                      <User className="w-3 h-3" />
                      {r.userName ?? "未知"} {r.userEmail ? `(${r.userEmail})` : ""}
                      <span className="mx-1">·</span>
                      {new Date(r.createdAt).toLocaleDateString("zh-TW")}
                    </div>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded p-2">{r.reason}</p>
                    {r.adminNote && (
                      <p className="text-xs text-muted-foreground mt-2 italic">備註：{r.adminNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.status === "pending" && (
                      <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground">#{r.id}</span>
                  </div>
                </div>
                <ReportActions
                  id={r.id}
                  currentStatus={r.status}
                  currentNote={r.adminNote ?? null}
                  isPending={updateMutation.isPending}
                  onUpdate={(id, status, adminNote) => updateMutation.mutate({ id, status, adminNote })}
                />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
          <span className="text-sm flex items-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>下一頁</Button>
        </div>
      )}
    </div>
  );
}

// ─── 客服投訴列表 ─────────────────────────────────────────────────────────────
function TicketsTab() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data, isLoading } = trpc.admin.getSupportTickets.useQuery({
    page,
    pageSize: 15,
    status: filterStatus === "all" ? undefined : filterStatus,
  });

  const updateMutation = trpc.admin.updateTicketStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); utils.admin.getSupportTickets.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-4">
      {/* 篩選 */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={filterStatus === "all" ? "default" : "outline"} onClick={() => { setFilterStatus("all"); setPage(1); }}>全部 {filterStatus === "all" && total > 0 && `(${total})`}</Button>
        {STATUSES.map(s => (
          <Button key={s.value} size="sm" variant={filterStatus === s.value ? "default" : "outline"} onClick={() => { setFilterStatus(s.value); setPage(1); }}>{s.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-8">載入中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">沒有符合的客服工單</div>
      ) : (
        <div className="space-y-3">
          {items.map(t => {
            const si = statusInfo(t.status);
            return (
              <div key={t.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${si.color}`}>{si.label}</span>
                      <Badge variant="outline" className="text-xs">{t.type}</Badge>
                      <span className="font-medium text-sm truncate">{t.subject}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                      <User className="w-3 h-3" />
                      {t.userName ?? "未知"} {t.userEmail ? `(${t.userEmail})` : ""}
                      <span className="mx-1">·</span>
                      {new Date(t.createdAt).toLocaleDateString("zh-TW")}
                    </div>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded p-2 whitespace-pre-wrap">{t.description}</p>
                    {t.adminNote && (
                      <p className="text-xs text-muted-foreground mt-2 italic">備註：{t.adminNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.status === "pending" && (
                      <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground">#{t.id}</span>
                  </div>
                </div>
                <TicketActions
                  id={t.id}
                  currentStatus={t.status}
                  currentNote={t.adminNote ?? null}
                  isPending={updateMutation.isPending}
                  onUpdate={(id, status, adminNote) => updateMutation.mutate({ id, status, adminNote })}
                />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
          <span className="text-sm flex items-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>下一頁</Button>
        </div>
      )}
    </div>
  );
}

// ─── 產業要求 ─────────────────────────────────────────────────────────────────
const INDUSTRY_STATUSES = [
  { value: "pending",   label: "待處理", color: "bg-gray-100 text-gray-700" },
  { value: "reviewing", label: "處理中", color: "bg-orange-100 text-orange-700" },
  { value: "resolved",  label: "已完成", color: "bg-green-100 text-green-700" },
  { value: "rejected",  label: "不採用", color: "bg-red-100 text-red-700" },
] as const;
type IndustryStatusValue = typeof INDUSTRY_STATUSES[number]["value"];
function industryStatusInfo(s: string) {
  return INDUSTRY_STATUSES.find(x => x.value === s) ?? INDUSTRY_STATUSES[0];
}

function IndustryRequestActions({ id, currentStatus, currentNote, onUpdate, isPending }: {
  id: number; currentStatus: string; currentNote: string | null;
  onUpdate: (id: number, status: IndustryStatusValue, note: string) => void; isPending: boolean;
}) {
  const [, setLocation] = useLocation();
  const [showEdit, setShowEdit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState<IndustryStatusValue>(currentStatus as IndustryStatusValue);
  const [note, setNote] = useState(currentNote ?? "");
  const historyQuery = trpc.industryRequest.admin.getHistory.useQuery({ id }, { enabled: showHistory });
  const messageMut = trpc.industryRequest.admin.messageUser.useMutation({
    onSuccess: (res) => { setLocation(`/admin/messages/${res.campaignId}`); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap items-center">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowHistory(v => !v); setShowEdit(false); }}>
          <History className="w-3.5 h-3.5" />{showHistory ? "收起進度" : "查看進度"}
        </button>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setShowEdit(v => !v); setShowHistory(false); }}>
          {showEdit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          更新狀態
        </button>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <button
          className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 transition-colors disabled:opacity-50"
          disabled={messageMut.isPending}
          onClick={() => messageMut.mutate({ id })}
        >
          <MessageSquare className="w-3.5 h-3.5" />私訊會員
        </button>
      </div>
      {showHistory && <StatusTimeline history={historyQuery.data} isLoading={historyQuery.isLoading} />}
      {showEdit && (
        <div className="space-y-2">
          <Select value={status} onValueChange={v => setStatus(v as IndustryStatusValue)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{INDUSTRY_STATUSES.map(s => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="處理備註（僅內部可見）" rows={2} className="text-xs" />
          <Button size="sm" className="h-7 text-xs" disabled={isPending} onClick={() => onUpdate(id, status, note)}>儲存</Button>
        </div>
      )}
    </div>
  );
}

function IndustryRequestsTab() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = trpc.industryRequest.admin.list.useQuery({
    page,
    pageSize: 15,
    status: filterStatus === "all" ? undefined : (filterStatus as IndustryStatusValue),
  });

  const updateMutation = trpc.industryRequest.admin.updateStatus.useMutation({
    onSuccess: () => { toast.success("狀態已更新"); utils.industryRequest.admin.list.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={filterStatus === "all" ? "default" : "outline"} onClick={() => { setFilterStatus("all"); setPage(1); }}>全部 {filterStatus === "all" && total > 0 && `(${total})`}</Button>
        {INDUSTRY_STATUSES.map(s => (
          <Button key={s.value} size="sm" variant={filterStatus === s.value ? "default" : "outline"} onClick={() => { setFilterStatus(s.value); setPage(1); }}>{s.label}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-8">載入中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">沒有符合的產業要求</div>
      ) : (
        <div className="space-y-3">
          {items.map(r => {
            const si = industryStatusInfo(r.status);
            const expanded = expandedId === r.id;
            return (
              <div key={r.id} className="border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${si.color}`}>{si.label}</span>
                      <span className="font-medium text-sm break-words">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 flex-wrap">
                      <User className="w-3 h-3 shrink-0" />
                      <span className="break-all">{r.email}</span>
                      {r.phone && <><span className="mx-1">·</span><span className="break-all">{r.phone}</span></>}
                      <span className="mx-1">·</span>
                      提出 {new Date(r.createdAt).toLocaleDateString("zh-TW")}
                      <span className="mx-1">·</span>
                      更新 {new Date(r.updatedAt).toLocaleDateString("zh-TW")}
                    </div>
                    <p className={`text-sm text-gray-700 bg-gray-50 rounded p-2 whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-2"}`}>{r.description}</p>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground mt-1"
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                    >
                      {expanded ? "收合" : "展開完整內容"}
                    </button>
                    {expanded && (
                      <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                        <p>會員 ID：#{r.userId}（目前帳號：{r.currentUserName ?? "未知"}{r.currentUserEmail ? ` / ${r.currentUserEmail}` : ""}）</p>
                        <p>提出時間：{new Date(r.createdAt).toLocaleString("zh-TW")}</p>
                        <p>案件狀態：{si.label}</p>
                        {r.adminNote && <p className="italic">管理員備註：{r.adminNote}</p>}
                      </div>
                    )}
                    {!expanded && r.adminNote && (
                      <p className="text-xs text-muted-foreground mt-2 italic">備註：{r.adminNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(r.status === "pending" || r.status === "reviewing") && (
                      <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    )}
                    <span className="text-xs text-muted-foreground">#{r.id}</span>
                  </div>
                </div>
                <IndustryRequestActions
                  id={r.id}
                  currentStatus={r.status}
                  currentNote={r.adminNote ?? null}
                  isPending={updateMutation.isPending}
                  onUpdate={(id, status, adminNote) => updateMutation.mutate({ id, status, adminNote })}
                />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
          <span className="text-sm flex items-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>下一頁</Button>
        </div>
      )}
    </div>
  );
}

// ─── 主頁面 ───────────────────────────────────────────────────────────────────
export default function AdminSupportCenter() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const reportsCountQuery = trpc.admin.getReports.useQuery({ page: 1, pageSize: 1, excludeResolved: true });
  const ticketsCountQuery = trpc.admin.getSupportTickets.useQuery({ page: 1, pageSize: 1, excludeResolved: true });
  const industryCountQuery = trpc.industryRequest.admin.list.useQuery({ page: 1, pageSize: 1, status: "pending" });

  if (authLoading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return <div className="flex items-center justify-center min-h-screen"><div className="text-red-600">您沒有權限存取此頁面</div></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
      <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-gray-900">客服中心</h1>
          </div>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span>檢舉 {reportsCountQuery.data?.total ?? 0} 件</span>
            <span>·</span>
            <span>客服 {ticketsCountQuery.data?.total ?? 0} 件</span>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="tickets">
              <TabsList className="mb-6">
                <TabsTrigger value="tickets" className="gap-2">
                  <HeadphonesIcon className="w-4 h-4" />
                  客服投訴
                  {(ticketsCountQuery.data?.total ?? 0) > 0 && (
                    <span className="ml-1 h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="reports" className="gap-2">
                  <Flag className="w-4 h-4" />
                  工廠檢舉
                  {(reportsCountQuery.data?.total ?? 0) > 0 && (
                    <span className="ml-1 h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="industry" className="gap-2">
                  <Lightbulb className="w-4 h-4" />
                  產業要求
                  {(industryCountQuery.data?.total ?? 0) > 0 && (
                    <span className="ml-1 h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="tickets"><TicketsTab /></TabsContent>
              <TabsContent value="reports"><ReportsTab /></TabsContent>
              <TabsContent value="industry"><IndustryRequestsTab /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
