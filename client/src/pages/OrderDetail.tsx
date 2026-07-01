import { useState } from "react";
import { useRoute, useLocation, Link, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AppLoading } from "@/components/AppLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, ClipboardList, MessageCircle, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { OrderTimelineBar } from "@/components/OrderTimelineBar";

// ── 訂單狀態標籤 ──────────────────────────────────────────────────────────────
const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "待需求方同意",
  accepted: "已成立",
  rejected: "已拒絕",
  in_progress: "製作中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  cancel_requested: "取消申請中",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  completed: "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-100 text-gray-600",
  cancel_requested: "bg-red-100 text-red-700",
};

// ── 日期欄位定義 ──────────────────────────────────────────────────────────────
const DATE_FIELD_KEYS = [
  "depositDueDate",
  "productionStartDate",
  "expectedCompletionDate",
  "expectedShipmentDate",
  "finalPaymentDueDate",
] as const;

const DATE_FIELD_LABELS: Record<typeof DATE_FIELD_KEYS[number], string> = {
  depositDueDate: "首款付款日",
  productionStartDate: "製作開始日",
  expectedCompletionDate: "預計完工日",
  expectedShipmentDate: "預計出貨日",
  finalPaymentDueDate: "尾款結款日",
};

type DateFormState = Record<typeof DATE_FIELD_KEYS[number], string>;


// ── 修改歷史節點（accepted change requests）────────────────────────────────────
type ChangeHistoryItem = {
  id: number;
  requesterName?: string | null;
  reason?: string | null;
  oldValuesJson: Record<string, string | null>;
  newValuesJson: Record<string, string | null>;
  acceptedAt?: Date | string | null;
  createdAt: Date | string;
};

function ChangeHistoryTimeline({ history }: { history: ChangeHistoryItem[] }) {
  if (history.length === 0) return null;
  return (
    <div className="border-t mt-2 pt-4">
      <p className="text-xs font-medium text-muted-foreground mb-3 pl-6">── 修改歷史</p>
      <div className="relative pl-6">
        {history.map((change, i) => {
          const isLast = i === history.length - 1;
          const dateStr = change.acceptedAt
            ? new Date(change.acceptedAt).toLocaleDateString("zh-TW")
            : new Date(change.createdAt).toLocaleDateString("zh-TW");
          const changedFields = DATE_FIELD_KEYS.filter(
            k => change.oldValuesJson[k] !== change.newValuesJson[k]
          );
          return (
            <div key={change.id} className="relative">
              {!isLast && (
                <div className="absolute left-[-1.1rem] top-4 w-0.5 h-full bg-blue-200" />
              )}
              <div className="absolute left-[-1.4rem] top-1.5 w-3 h-3 rounded-full bg-blue-400 ring-2 ring-white" />
              <div className="pb-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-700">更改訂單日期</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {dateStr}{change.requesterName ? ` · 由 ${change.requesterName} 提出` : ""}
                </p>
                {changedFields.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {changedFields.map(k => (
                      <p key={k} className="text-xs text-muted-foreground">
                        {DATE_FIELD_LABELS[k]}：
                        <span className="line-through mr-1">{change.oldValuesJson[k] ?? "—"}</span>
                        <span className="text-blue-700 font-medium">{change.newValuesJson[k] ?? "—"}</span>
                      </p>
                    ))}
                  </div>
                )}
                {change.reason && (
                  <p className="text-xs text-muted-foreground mt-1">原因：{change.reason}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 日期修改申請比較表（buyer 確認用）────────────────────────────────────────
type PendingChangeRequest = {
  id: number;
  requesterName?: string | null;
  reason?: string | null;
  status: string;
  oldValuesJson: Record<string, string | null>;
  newValuesJson: Record<string, string | null>;
  createdAt: Date | string;
};

function PendingChangeCard({
  request,
  onAccept,
  onReject,
  isPending,
}: {
  request: PendingChangeRequest;
  onAccept: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const changedFields = DATE_FIELD_KEYS.filter(
    k => request.oldValuesJson[k] !== request.newValuesJson[k]
  );

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-800">
          <CalendarClock className="w-4 h-4" />
          待確認：日期修改申請
        </CardTitle>
        <CardDescription className="text-amber-700">
          供應工廠提出日期修改，請確認是否同意
          {request.requesterName && `（由 ${request.requesterName} 提出）`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-normal pb-1">日期項目</th>
              <th className="text-left font-normal pb-1 pl-3">目前</th>
              <th className="text-left font-normal pb-1 pl-3">提議修改為</th>
            </tr>
          </thead>
          <tbody>
            {changedFields.map(k => (
              <tr key={k} className="border-t border-amber-200">
                <td className="py-1.5 text-xs text-muted-foreground">{DATE_FIELD_LABELS[k]}</td>
                <td className="py-1.5 pl-3 text-xs line-through text-muted-foreground">
                  {request.oldValuesJson[k] ?? "未設定"}
                </td>
                <td className="py-1.5 pl-3 text-xs font-semibold text-amber-800">
                  {request.newValuesJson[k] ?? "移除"}
                </td>
              </tr>
            ))}
            {changedFields.length === 0 && (
              <tr>
                <td colSpan={3} className="text-xs text-muted-foreground py-2">（無日期變更）</td>
              </tr>
            )}
          </tbody>
        </table>
        {request.reason && (
          <p className="text-xs text-amber-800 border-t border-amber-200 pt-2">
            修改原因：{request.reason}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            disabled={isPending}
            onClick={onAccept}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            同意修改
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
            disabled={isPending}
            onClick={onReject}
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            拒絕修改
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── backTo 安全解析 ───────────────────────────────────────────────────────────
function parseSafeBackTo(search: string): string | null {
  const raw = new URLSearchParams(search).get("backTo");
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("://")) return null;
  return raw;
}

// ── 頁面主體 ─────────────────────────────────────────────────────────────────
export default function OrderDetail() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/orders/:orderId");
  const search = useSearch();
  const orderId = params?.orderId ? parseInt(params.orderId, 10) : null;
  const utils = trpc.useUtils();

  // Phase 4B 日期修改表單 state
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [formDates, setFormDates] = useState<DateFormState>({
    depositDueDate: "",
    productionStartDate: "",
    expectedCompletionDate: "",
    expectedShipmentDate: "",
    finalPaymentDueDate: "",
  });

  const { data: order, isLoading, error } = trpc.collaborationOrder.getById.useQuery(
    { orderId: orderId! },
    { enabled: !!orderId && !!user }
  );

  const requestDateChangeMut = trpc.collaborationOrder.requestDateChange.useMutation({
    onSuccess: () => {
      toast.success("日期修改申請已送出，等待對方確認");
      setChangeOpen(false);
      setChangeReason("");
      utils.collaborationOrder.getById.invalidate({ orderId: orderId! });
    },
    onError: (e) => toast.error(e.message),
  });

  const respondDateChangeMut = trpc.collaborationOrder.respondDateChange.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.action === "accepted" ? "已同意日期修改，訂單日期已更新" : "已拒絕日期修改");
      utils.collaborationOrder.getById.invalidate({ orderId: orderId! });
    },
    onError: (e) => toast.error(e.message),
  });

  if (authLoading || isLoading) return <AppLoading />;

  if (!user) {
    navigate("/");
    return null;
  }

  const backTo = parseSafeBackTo(search);
  function handleBack() {
    if (backTo) {
      navigate(backTo);
    } else if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1 as any);
    } else {
      navigate("/member");
    }
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <ClipboardList className="w-12 h-12 opacity-30" />
        <p className="text-lg font-medium text-foreground">找不到訂單</p>
        <Button variant="outline" onClick={handleBack}>返回</Button>
      </div>
    );
  }

  function handleOpenChangeDialog() {
    setFormDates({
      depositDueDate: order!.depositDueDate ?? "",
      productionStartDate: order!.productionStartDate ?? "",
      expectedCompletionDate: order!.expectedCompletionDate ?? "",
      expectedShipmentDate: order!.expectedShipmentDate ?? "",
      finalPaymentDueDate: order!.finalPaymentDueDate ?? "",
    });
    setChangeReason("");
    setChangeOpen(true);
  }

  function handleSubmitDateChange() {
    const dates = {
      ...(formDates.depositDueDate ? { depositDueDate: formDates.depositDueDate } : {}),
      ...(formDates.productionStartDate ? { productionStartDate: formDates.productionStartDate } : {}),
      ...(formDates.expectedCompletionDate ? { expectedCompletionDate: formDates.expectedCompletionDate } : {}),
      ...(formDates.expectedShipmentDate ? { expectedShipmentDate: formDates.expectedShipmentDate } : {}),
      ...(formDates.finalPaymentDueDate ? { finalPaymentDueDate: formDates.finalPaymentDueDate } : {}),
    };
    requestDateChangeMut.mutate({
      orderId: orderId!,
      reason: changeReason || undefined,
      dates,
    });
  }

  const pendingChangeRequest = order.pendingChangeRequest;
  const acceptedChangeHistory = order.acceptedChangeHistory ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* 頁首 */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <button onClick={handleBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base truncate">{order.projectName}</h1>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_BADGE_CLASS[order.status] ?? STATUS_BADGE_CLASS.pending}`}>
          {ORDER_STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Phase 4B：待確認的日期修改申請（需求方看到） */}
        {order.canRespondDateChange && pendingChangeRequest && (
          <PendingChangeCard
            request={pendingChangeRequest}
            isPending={respondDateChangeMut.isPending}
            onAccept={() => respondDateChangeMut.mutate({ requestId: pendingChangeRequest.id, action: "accepted" })}
            onReject={() => respondDateChangeMut.mutate({ requestId: pendingChangeRequest.id, action: "rejected" })}
          />
        )}

        {/* 工廠方已有待確認申請時顯示提示 */}
        {order.canRequestDateChange && pendingChangeRequest && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 shrink-0" />
            日期修改申請已送出，等待對方確認中
          </div>
        )}

        {/* 基本資料 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="w-4 h-4 text-orange-500" />
              訂單資訊
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <p className="text-xs text-muted-foreground">供應工廠</p>
                <p className="font-medium">{order.factoryName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">需求方</p>
                <p className="font-medium">{order.buyerName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">接受身分</p>
                <p className="font-medium">
                  {order.acceptedAsType === "factory" ? "工廠身分" : "個人身分"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">建立時間</p>
                <p className="font-medium">{new Date(order.createdAt).toLocaleDateString("zh-TW")}</p>
              </div>
            </div>

            {order.description && (
              <div className="pt-1 border-t mt-2">
                <p className="text-xs text-muted-foreground mb-1">訂單說明</p>
                <p className="whitespace-pre-wrap text-sm">{order.description}</p>
              </div>
            )}

            {order.note && (
              <div className="pt-1 border-t mt-2">
                <p className="text-xs text-muted-foreground mb-1">備註</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{order.note}</p>
              </div>
            )}

            {order.status === "cancel_requested" && order.cancelRequestReason && (
              <div className="pt-1 border-t mt-2">
                <p className="text-xs text-muted-foreground mb-1">取消原因</p>
                <p className="text-sm text-red-600">{order.cancelRequestReason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 日期 Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">日期節點</CardTitle>
            <CardDescription>1 天內緊急 · 3 天內接近 · 超過今天已逾期</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <OrderTimelineBar order={order} compact={false} />
            <ChangeHistoryTimeline history={acceptedChangeHistory} />
          </CardContent>
        </Card>

        {/* 操作按鈕 */}
        <div className="flex gap-3">
          <Link href={`/chat/${order.conversationId}`} className="flex-1">
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" size="sm">
              <MessageCircle className="w-4 h-4 mr-1.5" />
              查看對話
            </Button>
          </Link>
          {/* Phase 4B：工廠方修改日期按鈕（無待確認申請時顯示） */}
          {order.canRequestDateChange && !pendingChangeRequest && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleOpenChangeDialog}
            >
              <CalendarClock className="w-4 h-4 mr-1.5" />
              修改訂單日期
            </Button>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground pb-4">
          此合作確認單僅作為雙方於 OXM 平台內確認合作內容之紀錄，實際付款、合約、交付與售後責任由雙方自行協議。
        </p>
      </div>

      {/* Phase 4B：日期修改 Dialog */}
      <Dialog
        open={changeOpen}
        onOpenChange={(open) => { if (!requestDateChangeMut.isPending) setChangeOpen(open); }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>修改訂單日期</DialogTitle>
            <DialogDescription>
              修改後需對方確認才會生效。留空表示保留現有日期，不變更。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {DATE_FIELD_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label className="text-sm">{DATE_FIELD_LABELS[key]}</Label>
                <p className="text-xs text-muted-foreground">
                  目前：{order[key] ?? "未設定"}
                </p>
                <Input
                  type="date"
                  value={formDates[key]}
                  onChange={(e) => setFormDates((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}

            <div className="space-y-1">
              <Label className="text-sm">修改原因（選填）</Label>
              <Textarea
                placeholder="說明修改原因，有助於對方理解並同意"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setChangeOpen(false)}
              disabled={requestDateChangeMut.isPending}
            >
              取消
            </Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={requestDateChangeMut.isPending}
              onClick={handleSubmitDateChange}
            >
              {requestDateChangeMut.isPending ? "送出中…" : "送出申請"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
