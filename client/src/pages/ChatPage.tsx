import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/_core/hooks/useAuth";
import { performLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Send, ArrowLeft, Factory, User, CheckCircle, XCircle, Plus, Package, FileText, ExternalLink, Download, ClipboardList, Star } from "lucide-react";

// ── 型別 ──────────────────────────────────────────────────────────────────
type AttachedProduct = {
  id: number;
  name: string;
  imageUrl: string | null;
  description: string | null;
  factoryId: number;
  detailUrl?: string;
};

type PdfAttachment = {
  fileKey?: string;
  fileName: string;
  fileSize: number;
  expiresAt: string;
  deleted?: boolean;
};

// ── 商品附件卡片 ─────────────────────────────────────────────────────────
function ProductMessageCard({ data, isMine }: { data: Record<string, any>; isMine: boolean }) {
  // 優先使用 snapshot（新格式），fallback 到 products（舊格式）
  const products: AttachedProduct[] = data?.snapshot ?? data?.products ?? [];

  if (!products || products.length === 0) {
    return <p className="text-sm text-muted-foreground italic">（商品資料無法顯示）</p>;
  }
  return (
    <div className="space-y-2 mt-1">
      {products.map(p => {
        const linkUrl = p.detailUrl ?? (p.factoryId ? `/factory/${p.factoryId}` : null);
        return (
          <div key={p.id} className={`rounded-lg border overflow-hidden text-sm ${isMine ? "border-white/30 bg-white/10" : "border-border bg-background"}`}>
            <div className="flex gap-2 p-2">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="w-14 h-14 object-cover rounded shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded bg-muted flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className={`font-medium truncate ${isMine ? "text-primary-foreground" : "text-foreground"}`}>{p.name}</p>
                {p.description && (
                  <p className={`text-xs mt-0.5 line-clamp-2 ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{p.description}</p>
                )}
                {linkUrl ? (
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 text-xs mt-1 hover:underline ${isMine ? "text-blue-200" : "text-blue-600"}`}
                    onClick={e => e.stopPropagation()}
                  >
                    查看商品 <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <p className={`text-xs mt-1 ${isMine ? "text-primary-foreground/50" : "text-muted-foreground"}`}>商品可能已下架</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── PDF 附件卡片 ──────────────────────────────────────────────────────────
function PdfMessageCard({ pdf, messageId, isMine }: { pdf: PdfAttachment; messageId: number; isMine: boolean }) {
  const isExpired = !pdf.expiresAt || new Date(pdf.expiresAt) < new Date();
  const isDeleted = !!pdf.deleted;
  const isUnavailable = isExpired || isDeleted;

  const expireDate = pdf.expiresAt ? new Date(pdf.expiresAt).toLocaleDateString("zh-TW") : "—";
  const sizeKB = Math.round((pdf.fileSize ?? 0) / 1024);

  const border = isMine ? "border-white/30 bg-white/10" : "border-border bg-background";
  const text = isMine ? "text-primary-foreground" : "text-foreground";
  const sub = isMine ? "text-primary-foreground/60" : "text-muted-foreground";

  const getUrlMut = trpc.chat.getPdfDownloadUrl.useMutation({
    onSuccess: ({ url }) => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isUnavailable) {
    return (
      <div className={`rounded-lg border p-3 mt-1 ${border}`}>
        <div className="flex items-center gap-2">
          <FileText className={`w-5 h-5 ${sub} shrink-0`} />
          <div>
            <p className={`text-sm font-medium ${text}`}>{pdf.fileName}</p>
            <p className={`text-xs ${sub}`}>此型錄已逾期，無法下載</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 mt-1 ${border}`}>
      <div className="flex items-start gap-2">
        <FileText className={`w-5 h-5 mt-0.5 ${isMine ? "text-blue-200" : "text-blue-500"} shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${text}`}>{pdf.fileName}</p>
          <p className={`text-xs ${sub}`}>{sizeKB} KB · 到期：{expireDate}</p>
        </div>
        <button
          type="button"
          disabled={getUrlMut.isPending}
          onClick={(e) => {
            e.stopPropagation();
            getUrlMut.mutate({ messageId });
          }}
          className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
            isMine
              ? "border-white/30 text-primary-foreground hover:bg-white/10"
              : "border-border text-foreground hover:bg-muted"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Download className="w-3 h-3" />
          {getUrlMut.isPending ? "載入…" : "開啟"}
        </button>
      </div>
    </div>
  );
}

// ── 商品選擇 Modal ────────────────────────────────────────────────────────
function ProductPickerModal({
  conversationId,
  open,
  onClose,
  onSent,
}: {
  conversationId: number;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const productsQuery = trpc.chat.getFactoryProducts.useQuery(
    { conversationId },
    { enabled: open },
  );
  const sendMut = trpc.chat.sendProduct.useMutation({
    onSuccess: () => {
      toast.success("商品已傳送");
      setSelected([]);
      onSent();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>選擇要傳送的商品</DialogTitle>
        </DialogHeader>
        {productsQuery.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : !productsQuery.data || productsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">此工廠目前沒有商品</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto py-2">
            {productsQuery.data.map(p => {
              const isChecked = selected.includes(p.id);
              const imageUrl = ((p.images as string[] | null)?.[0]) ?? null;
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    isChecked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(p.id)}
                  />
                  {imageUrl ? (
                    <img src={imageUrl} alt={p.name} className="w-12 h-12 object-cover rounded shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{p.description}</p>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={selected.length === 0 || sendMut.isPending}
            onClick={() => sendMut.mutate({ conversationId, productIds: selected })}
          >
            傳送 {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 合作確認單 Dialog ─────────────────────────────────────────────────────
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

function CollaborationOrderDialog({
  conversationId,
  open,
  onClose,
  onSent,
}: {
  conversationId: number;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [source, setSource] = useState<"product" | "manual">("manual");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [depositDueDate, setDepositDueDate] = useState("");
  const [productionStartDate, setProductionStartDate] = useState("");
  const [expectedCompletionDate, setExpectedCompletionDate] = useState("");
  const [expectedShipmentDate, setExpectedShipmentDate] = useState("");
  const [finalPaymentDueDate, setFinalPaymentDueDate] = useState("");
  const [note, setNote] = useState("");

  const productsQuery = trpc.chat.getFactoryProducts.useQuery({ conversationId }, { enabled: open });

  const createMut = trpc.collaborationOrder.create.useMutation({
    onSuccess: () => {
      toast.success("合作確認單已送出");
      onSent();
      onClose();
      resetForm();
    },
    onError: e => toast.error(e.message),
  });

  function resetForm() {
    setSource("manual");
    setSelectedProductId("");
    setProjectName("");
    setDescription("");
    setDepositDueDate("");
    setProductionStartDate("");
    setExpectedCompletionDate("");
    setExpectedShipmentDate("");
    setFinalPaymentDueDate("");
    setNote("");
  }

  function handleProductSelect(productId: string) {
    setSelectedProductId(productId);
    const prod = productsQuery.data?.find(p => String(p.id) === productId);
    if (prod) {
      setProjectName(prod.name);
      setDescription(prod.description ?? "");
    }
  }

  function handleSubmit() {
    if (!projectName.trim() || !description.trim()) {
      toast.error("請填寫合作項目名稱與合作內容描述");
      return;
    }
    createMut.mutate({
      conversationId,
      productId: source === "product" && selectedProductId ? Number(selectedProductId) : null,
      projectName: projectName.trim(),
      description: description.trim(),
      depositDueDate: depositDueDate || null,
      productionStartDate: productionStartDate || null,
      expectedCompletionDate: expectedCompletionDate || null,
      expectedShipmentDate: expectedShipmentDate || null,
      finalPaymentDueDate: finalPaymentDueDate || null,
      note: note.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-orange-500" />
            建立合作確認單
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            填寫合作項目後，需求方需同意方可成立。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 合作項目來源 */}
          <div className="space-y-1.5">
            <Label>合作項目來源</Label>
            <Select value={source} onValueChange={v => { setSource(v as "product" | "manual"); setSelectedProductId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product">選擇已上架商品</SelectItem>
                <SelectItem value="manual">不綁定商品，手動輸入</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 商品選擇（只在 source=product 時顯示） */}
          {source === "product" && (
            <div className="space-y-1.5">
              <Label>選擇商品</Label>
              {productsQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : !productsQuery.data || productsQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground bg-muted rounded px-3 py-2">尚無上架商品，可改用手動輸入</p>
              ) : (
                <Select value={selectedProductId} onValueChange={handleProductSelect}>
                  <SelectTrigger><SelectValue placeholder="選擇商品…" /></SelectTrigger>
                  <SelectContent>
                    {productsQuery.data.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* 合作項目名稱 */}
          <div className="space-y-1.5">
            <Label>合作項目名稱 <span className="text-destructive">*</span></Label>
            <Input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="例如：包裝盒印刷" maxLength={200} />
          </div>

          {/* 合作內容描述 */}
          <div className="space-y-1.5">
            <Label>合作內容描述 <span className="text-destructive">*</span></Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="請描述合作內容、規格、數量等" rows={3} />
          </div>

          {/* 日期欄位 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">首款付款日期</Label>
              <Input type="date" value={depositDueDate} onChange={e => setDepositDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">製作開始日期</Label>
              <Input type="date" value={productionStartDate} onChange={e => setProductionStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">預計完成日期</Label>
              <Input type="date" value={expectedCompletionDate} onChange={e => setExpectedCompletionDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">預計出貨日期</Label>
              <Input type="date" value={expectedShipmentDate} onChange={e => setExpectedShipmentDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">尾款結款日期</Label>
              <Input type="date" value={finalPaymentDueDate} onChange={e => setFinalPaymentDueDate(e.target.value)} />
            </div>
          </div>

          {/* 備註 */}
          <div className="space-y-1.5">
            <Label>備註（選填）</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="其他說明事項" rows={2} />
          </div>

          <p className="text-xs text-muted-foreground bg-muted rounded px-3 py-2 leading-relaxed">
            此合作確認單僅作為雙方於 OXM 平台內確認合作內容之紀錄，實際付款、合約、交付與售後責任由雙方自行協議。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); resetForm(); }}>取消</Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
            {createMut.isPending ? "送出中…" : "送出合作確認單"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 取消合作申請卡片 ────────────────────────────────────────────────────
function CancelRequestCard({
  data,
  conversationId,
  currentUserId,
  onActed,
}: {
  data: Record<string, any>;
  conversationId: number;
  currentUserId?: number;
  onActed: () => void;
}) {
  const orderId: number = data?.orderId;
  const { data: orders, refetch } = trpc.collaborationOrder.getForConversation.useQuery(
    { conversationId },
    { enabled: !!conversationId }
  );
  const order = orders?.find(o => o.id === orderId);
  const status = order?.status ?? "cancel_requested";

  const respondCancelMut = trpc.collaborationOrder.respondCancel.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.action === "accept" ? "已同意取消" : "已拒絕取消");
      refetch();
      onActed();
    },
    onError: e => toast.error(e.message),
  });

  const isRequester = currentUserId === data?.requestedByUserId;
  const isResolved = status !== "cancel_requested";

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm w-72 sm:w-96 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-gray-700">
        <XCircle className="w-4 h-4 text-red-500" />
        取消合作申請
      </div>
      <div className="space-y-1 text-foreground">
        <p><span className="text-muted-foreground text-xs">合作項目：</span>{data.projectName}</p>
        <p><span className="text-muted-foreground text-xs">申請方：</span>{data.requestedByRole === "factory" ? "工廠方" : "需求方"}</p>
        <p><span className="text-muted-foreground text-xs">取消原因：</span>{data.reason}</p>
      </div>
      {isResolved ? (
        <p className={`text-xs text-center font-medium ${status === "cancelled" ? "text-gray-500" : "text-green-600"}`}>
          {status === "cancelled" ? "已同意取消，合作確認單已取消" : "已拒絕取消，合作確認單維持原狀態"}
        </p>
      ) : isRequester ? (
        <p className="text-xs text-muted-foreground text-center">等待對方回覆取消申請</p>
      ) : (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive hover:bg-destructive/5"
            disabled={respondCancelMut.isPending}
            onClick={() => respondCancelMut.mutate({ orderId, action: "accept" })}>
            同意取消
          </Button>
          <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            disabled={respondCancelMut.isPending}
            onClick={() => respondCancelMut.mutate({ orderId, action: "reject" })}>
            拒絕取消
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 合作確認單訊息卡片 ────────────────────────────────────────────────────
function CollaborationOrderCard({
  data,
  conversationId,
  isFactorySide,
  buyerId,
  currentUserId,
  onActed,
}: {
  data: Record<string, any>;
  conversationId: number;
  isFactorySide: boolean;
  buyerId?: number;
  currentUserId?: number;
  onActed: () => void;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const orderId: number = data?.orderId;
  const { data: orders, refetch } = trpc.collaborationOrder.getForConversation.useQuery(
    { conversationId },
    { enabled: !!conversationId }
  );
  const order = orders?.find(o => o.id === orderId);

  const respondMut = trpc.collaborationOrder.respond.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.action === "accepted" ? "已同意合作確認單" : "已拒絕合作確認單");
      refetch();
      onActed();
    },
    onError: e => toast.error(e.message),
  });

  const requestCancelMut = trpc.collaborationOrder.requestCancel.useMutation({
    onSuccess: () => {
      toast.success("取消申請已送出");
      setCancelOpen(false);
      setCancelReason("");
      refetch();
      onActed();
    },
    onError: e => toast.error(e.message),
  });

  const statusLabel = order ? ORDER_STATUS_LABEL[order.status] ?? order.status : ORDER_STATUS_LABEL["pending"];
  const status = order?.status ?? "pending";

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    accepted: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    in_progress: "bg-blue-100 text-blue-800",
    shipped: "bg-purple-100 text-purple-800",
    completed: "bg-orange-100 text-orange-800",
    cancelled: "bg-gray-100 text-gray-600",
    cancel_requested: "bg-red-100 text-red-700",
  };

  const isBuyer = currentUserId === buyerId;
  const canRequestCancel = ["pending", "accepted", "in_progress", "shipped"].includes(status);

  function fmt(d?: string | null) {
    if (!d) return "—";
    return d;
  }

  return (
    <>
      <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm w-72 sm:w-96 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-orange-700">
            <ClipboardList className="w-4 h-4" />
            合作確認單
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[status] ?? statusColor.pending}`}>
            {statusLabel}
          </span>
        </div>

        <div className="space-y-1.5 text-foreground">
          <p><span className="text-muted-foreground text-xs">合作項目：</span>{data.projectName ?? order?.projectName}</p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{data.description ?? order?.description}</p>
          {data.depositDueDate && <p><span className="text-muted-foreground text-xs">首款付款日：</span>{fmt(data.depositDueDate)}</p>}
          {(data.productionStartDate || data.expectedCompletionDate) && (
            <p><span className="text-muted-foreground text-xs">製作期間：</span>{fmt(data.productionStartDate)} — {fmt(data.expectedCompletionDate)}</p>
          )}
          {data.expectedShipmentDate && <p><span className="text-muted-foreground text-xs">預計出貨日：</span>{fmt(data.expectedShipmentDate)}</p>}
          {data.finalPaymentDueDate && <p><span className="text-muted-foreground text-xs">尾款結款日：</span>{fmt(data.finalPaymentDueDate)}</p>}
          {data.note && <p><span className="text-muted-foreground text-xs">備註：</span>{data.note}</p>}
        </div>

        {/* 操作按鈕區 */}
        {status === "pending" && isBuyer && !isFactorySide && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              disabled={respondMut.isPending}
              onClick={() => respondMut.mutate({ orderId, action: "accepted" })}>
              <CheckCircle className="w-3.5 h-3.5 mr-1" />同意合作內容
            </Button>
            <Button size="sm" variant="outline" className="flex-1"
              disabled={respondMut.isPending}
              onClick={() => respondMut.mutate({ orderId, action: "rejected" })}>
              <XCircle className="w-3.5 h-3.5 mr-1" />拒絕
            </Button>
          </div>
        )}
        {status === "pending" && isFactorySide && (
          <p className="text-xs text-muted-foreground text-center pt-1">等待需求方同意</p>
        )}

        {/* 取消申請中提示 */}
        {status === "cancel_requested" && (
          <p className="text-xs text-red-600 text-center font-medium pt-1">取消申請進行中，請至聊天室回覆</p>
        )}

        {/* 已完成合作後，需求方可留評價入口 */}
        {status === "completed" && isBuyer && !isFactorySide && orderId && (
          <VerifiedReviewButton orderId={orderId} factoryId={order?.factoryId} onDone={onActed} />
        )}

        {/* 申請取消按鈕 */}
        {canRequestCancel && orderId && (
          <div className="pt-1">
            <Button size="sm" variant="outline" className="w-full text-xs text-muted-foreground border-dashed"
              onClick={() => setCancelOpen(true)}>
              申請取消合作
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed border-t border-orange-200 pt-2">
          此合作確認單僅作為雙方於 OXM 平台內確認合作內容之紀錄，實際付款、合約、交付與售後責任由雙方自行協議。
        </p>
      </div>

      {/* 申請取消 Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>申請取消合作</DialogTitle>
            <DialogDescription>送出後對方需在聊天室同意或拒絕取消申請</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">合作項目</Label>
              <p className="text-sm text-muted-foreground mt-0.5">{data.projectName ?? order?.projectName}</p>
            </div>
            <div>
              <Label className="text-sm">取消原因 *</Label>
              <Textarea
                className="mt-1"
                placeholder="請說明申請取消的原因…"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelOpen(false); setCancelReason(""); }}>取消</Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={!cancelReason.trim() || requestCancelMut.isPending}
              onClick={() => requestCancelMut.mutate({ orderId, reason: cancelReason.trim() })}
            >
              送出取消申請
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 已完成合作評價按鈕 ────────────────────────────────────────────────────
function VerifiedReviewButton({ orderId, factoryId, onDone }: { orderId: number; factoryId?: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const createMut = trpc.collaborationOrder.createVerifiedReview.useMutation({
    onSuccess: () => { toast.success("已完成合作評價已送出"); setOpen(false); onDone(); },
    onError: e => toast.error(e.message),
  });
  return (
    <>
      <Button size="sm" variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50"
        onClick={() => setOpen(true)}>
        <Star className="w-3.5 h-3.5 mr-1" />留下已完成合作評價
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>已完成合作評價</DialogTitle>
            <DialogDescription>針對這筆合作留下評價</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-1 justify-center">
              {[1,2,3,4,5].map(s => (
                <button key={s} type="button"
                  onMouseEnter={() => setHover(s)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(s)}>
                  <Star className={`w-7 h-7 transition-colors ${(hover || rating) >= s ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/30"}`} />
                </button>
              ))}
            </div>
            <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="分享合作心得…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={rating === 0 || createMut.isPending}
              onClick={() => createMut.mutate({ collaborationOrderId: orderId, rating, comment: comment || undefined })}
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
              {createMut.isPending ? "送出中…" : "送出評價"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [matchExisting, params] = useRoute("/chat/:conversationId");
  const isNewChat = !matchExisting || params?.conversationId === "new";
  const conversationId = isNewChat ? null : Number(params?.conversationId);

  const [, navigate] = useLocation();
  const backPath: string = (window.history.state as Record<string, string> | null)?.from ?? "/messages";
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const factoryId = searchParams.get("factoryId") ? Number(searchParams.get("factoryId")) : null;
  const productId = searchParams.get("productId") ? Number(searchParams.get("productId")) : undefined;

  const { user, isAuthenticated } = useAuth();
  const productName = searchParams.get("productName");
  const [message, setMessage] = useState(
    productId && productName
      ? `您好，我對貴工廠的「${productName}」有興趣，想了解報價、最低訂購數量及生產交期，請問方便提供嗎？謝謝！`
      : ""
  );
  const [isSending, setIsSending] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isInitialScrollDone = useRef(false);
  const scrollAfterSend = useRef(false);
  const utils = trpc.useUtils();

  const { data: existingConv } = trpc.chat.getExisting.useQuery(
    { factoryId: factoryId!, productId: undefined },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );
  const { data: meta } = trpc.chat.getConversationMeta.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId && isAuthenticated }
  );
  const { data: msgs, isLoading: msgsLoading, isError: msgsError, refetch: refetchMsgs } = trpc.chat.getMessages.useQuery(
    { conversationId: conversationId!, page: 1 },
    { enabled: !!conversationId && isAuthenticated, refetchInterval: 5000 }
  );
  const { data: factoryData } = trpc.factory.getById.useQuery(
    { id: factoryId! },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );

  const isFactoryOwner = !!user && meta?.factoryOwnerId === user.id;
  const isCoMgr = !!meta?.isCoMgr;
  const isFactorySide = isFactoryOwner || isCoMgr;

  // Refs to avoid stale closures inside mutation callbacks
  const isFactorySideRef = useRef(isFactorySide);
  useEffect(() => { isFactorySideRef.current = isFactorySide; }, [isFactorySide]);

  // Optimistic mark-read mutation
  const markReadMut = trpc.chat.markConversationRead.useMutation({
    onMutate: async ({ conversationId: convId }) => {
      await utils.chat.unreadCount.cancel();
      await utils.chat.myConversations.cancel();
      const prevUnread = utils.chat.unreadCount.getData();
      const prevConvs = utils.chat.myConversations.getData();

      const conv = prevConvs?.find((c: any) => c.id === convId);
      const convUnread: number = conv?.unreadCount ?? 0;

      if (convUnread > 0) {
        utils.chat.myConversations.setData(undefined, (prev: any) =>
          prev?.map((c: any) => c.id === convId ? { ...c, unreadCount: 0 } : c) ?? prev
        );
        utils.chat.unreadCount.setData(undefined, (prev: any) => {
          if (!prev) return prev;
          const side = isFactorySideRef.current ? 'factoryCount' : 'userCount';
          return { ...prev, [side]: Math.max(0, (prev[side] ?? 0) - convUnread) };
        });
      }

      return { prevUnread, prevConvs };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevUnread !== undefined) utils.chat.unreadCount.setData(undefined, ctx.prevUnread);
      if (ctx?.prevConvs !== undefined) utils.chat.myConversations.setData(undefined, ctx.prevConvs);
    },
    onSettled: () => {
      utils.chat.unreadCount.invalidate();
      utils.chat.myConversations.invalidate();
      utils.notification.getAppBadgeCount.invalidate();
      utils.inquiryBatch.listMine.invalidate();
    },
  });

  // in-flight guard: stores conversationId of the currently pending markRead request
  const markReadInFlightRef = useRef<number | null>(null);
  // Track the last known unreadCount for the current conversation to detect new arrivals
  const lastSeenUnreadRef = useRef<number>(0);

  useEffect(() => {
    if (!conversationId || !isAuthenticated) {
      markReadInFlightRef.current = null;
      lastSeenUnreadRef.current = 0;
      return;
    }

    // Get current unreadCount from myConversations cache
    const convs = utils.chat.myConversations.getData();
    const conv = convs?.find((c: any) => c.id === conversationId);
    const currentUnread: number = conv?.unreadCount ?? 0;

    // Trigger mark-read when:
    // 1. Entering a new conversation (conversationId changed)
    // 2. Staying in same conversation and new unread messages arrived (currentUnread increased from 0)
    const isNewConv = markReadInFlightRef.current !== conversationId;
    const hasNewMessages = !isNewConv && currentUnread > 0 && currentUnread > lastSeenUnreadRef.current;

    if (!isNewConv && !hasNewMessages) return;
    if (markReadInFlightRef.current === conversationId && currentUnread === 0) return;

    lastSeenUnreadRef.current = currentUnread;
    markReadInFlightRef.current = conversationId;

    markReadMut.mutate({ conversationId }, {
      onSettled: () => {
        // Clear in-flight only for this conversation to allow future re-triggers
        if (markReadInFlightRef.current === conversationId) {
          markReadInFlightRef.current = null;
        }
      },
    });
  // deps: conversationId triggers on nav; msgs triggers on new polling messages; isAuthenticated on auth change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isAuthenticated, msgs]);

  useEffect(() => {
    if (existingConv) navigate(`/chat/${existingConv.id}`, { replace: true });
  }, [existingConv, navigate]);

  useEffect(() => {
    if (isNewChat && factoryData && !existingConv) {
      const name = factoryData.name ?? "工廠";
      const product = factoryData.products?.find((p: any) => p.id === productId);
      if (product) {
        setMessage(`${name}您好，我對您的「${product.name}」產品有興趣，希望您可以提供不同訂購數量之間的報價，謝謝！`);
      } else {
        setMessage(`${name}您好，我想詢問貴工廠的商品、服務或合作方式，期待您的回覆！`);
      }
    }
  }, [isNewChat, factoryData, existingConv, productId]);

  // 點擊外部關閉附件選單
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    if (attachMenuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [attachMenuOpen]);

  const getOrCreateMut = trpc.chat.getOrCreate.useMutation();
  const sendMut = trpc.chat.send.useMutation({
    onSuccess: () => {
      setMessage("");
      scrollAfterSend.current = true;
      utils.chat.getMessages.invalidate({ conversationId: conversationId! });
      utils.chat.myConversations.invalidate();
      utils.chat.unreadCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const sendPdfMut = trpc.chat.sendPdf.useMutation({
    onSuccess: () => {
      toast.success("PDF 型錄已傳送");
      utils.chat.getMessages.invalidate({ conversationId: conversationId! });
      utils.chat.myConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // 切換對話時重置 scroll 狀態
  useEffect(() => {
    isInitialScrollDone.current = false;
  }, [conversationId]);

  useEffect(() => {
    if (msgsLoading || !msgs) return;
    const el = scrollRef.current;
    if (!el) return;

    if (!isInitialScrollDone.current) {
      // 第一次載入：直接跳到最底
      el.scrollTop = el.scrollHeight;
      isInitialScrollDone.current = true;
      return;
    }

    if (scrollAfterSend.current) {
      // 使用者剛送出訊息：跳到最底
      el.scrollTop = el.scrollHeight;
      scrollAfterSend.current = false;
      return;
    }

    // 自動 refetch：只有在距底部 120px 以內才跟著捲動
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs, msgsLoading]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;
    setIsSending(true);
    try {
      if (isNewChat && factoryId) {
        const conv = await getOrCreateMut.mutateAsync({ factoryId, productId });
        await sendMut.mutateAsync({ conversationId: conv.id, content: message.trim() });
        utils.chat.myConversations.invalidate();
        utils.chat.unreadCount.invalidate();
        navigate(`/chat/${conv.id}`, { replace: true });
      } else if (conversationId) {
        sendMut.mutate({ conversationId, content: message.trim() });
      }
    } catch {
      toast.error("訊息送出失敗");
    } finally {
      setIsSending(false);
    }
  };

  const handlePdfUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !conversationId) return;

    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("只允許上傳 PDF 檔案");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("檔案大小不可超過 10MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const fileData = reader.result as string;
      sendPdfMut.mutate({
        conversationId,
        fileData,
        fileName: file.name,
        fileSize: file.size,
        mimeType: "application/pdf",
      });
    };
    reader.readAsDataURL(file);
  }, [conversationId, sendPdfMut]);

  const invalidateMessages = useCallback(() => {
    utils.chat.getMessages.invalidate({ conversationId: conversationId! });
    utils.chat.myConversations.invalidate();
  }, [utils, conversationId]);

  const displayFactoryName = isNewChat ? (factoryData?.name ?? "工廠") : (meta?.factoryName ?? "對話");
  const displayProductName = isNewChat
    ? (factoryData?.products?.find((p: any) => p.id === productId)?.name ?? null)
    : (meta?.productName ?? null);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container py-16 text-center">
          <p className="text-muted-foreground mb-4">請先登入以查看訊息</p>
          <Button onClick={() => performLogin()}>登入</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar />

      <div className="container py-4 flex-1 flex flex-col max-w-3xl overflow-hidden">
        <Button variant="ghost" size="sm" className="mb-3 self-start" onClick={() => navigate(backPath)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> {backPath.startsWith("/dashboard") ? "返回工廠管理後台" : "返回訊息列表"}
        </Button>

        <Card className="flex-1 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              {isFactorySide && !isNewChat ? <User className="w-5 h-5" /> : <Factory className="w-5 h-5" />}
              {isFactorySide && !isNewChat ? (meta?.buyerName ?? "對方") : displayFactoryName}
              {displayProductName && (
                <Badge variant="outline" className="text-xs font-normal">{displayProductName}</Badge>
              )}
            </CardTitle>
            {isFactorySide && !isNewChat && meta?.buyerAffiliation && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                <Link href={`/factory/${meta.buyerAffiliation.factoryId}`} className="hover:underline">
                  {meta.buyerAffiliation.factoryName}
                </Link>
                ・{meta.buyerAffiliation.role === "owner" ? "負責人" : "管理員"}
              </p>
            )}
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3" style={{ maxHeight: "calc(100vh - 300px)", minHeight: "400px" }}>
              {msgsLoading && !isNewChat ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-3/4" />)}
                </div>
              ) : msgsError && !isNewChat ? (
                <div className="text-center text-muted-foreground py-8 text-sm space-y-3">
                  <p>訊息載入失敗</p>
                  <Button variant="outline" size="sm" onClick={() => refetchMsgs()}>重新載入</Button>
                </div>
              ) : isNewChat ? (
                <div className="text-center text-muted-foreground py-12">
                  <p>與 {displayFactoryName} 開始對話</p>
                  <p className="text-sm mt-1">送出第一則訊息後，對話將會建立</p>
                </div>
              ) : msgs?.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  <p>開始對話吧！</p>
                  <p className="text-sm mt-1">輸入訊息與對方溝通</p>
                </div>
              ) : (
                msgs?.map((msg) => {
                  const isMine = isFactorySide
                    ? msg.senderRole === "factory"
                    : msg.senderId === user?.id;
                  const messageType: string = (msg as any).type || "text";
                  const isInvite = messageType === "co_manager_invite";
                  const isProduct = messageType === "product";
                  const isPdf = messageType === "pdf";
                  const isOrder = messageType === "collaboration_order";
                  const invStatus = (msg as any).invitationStatus;
                  const invId = (msg as any).invitationId;
                  const attachmentData = (msg as any).attachmentData as Record<string, any> | null;
                  const canRespond = isInvite && !isMine && invStatus === "pending" && invId;

                  return (
                    <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      {/* 合作確認單 / 取消申請：不套用氣泡樣式，直接渲染卡片 */}
                      {isOrder ? (
                        <div className="max-w-[85%]">
                          {attachmentData?.subType === "cancel_request" ? (
                            <CancelRequestCard
                              data={attachmentData}
                              conversationId={conversationId!}
                              currentUserId={user?.id}
                              onActed={invalidateMessages}
                            />
                          ) : attachmentData ? (
                            <CollaborationOrderCard
                              data={attachmentData}
                              conversationId={conversationId!}
                              isFactorySide={isFactorySide}
                              buyerId={meta?.userId}
                              currentUserId={user?.id}
                              onActed={invalidateMessages}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">（合作確認單資料異常）</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1 px-1">
                            {new Date(msg.createdAt).toLocaleString("zh-TW")}
                          </p>
                        </div>
                      ) : (
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        isMine
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : isInvite
                            ? "bg-orange-50 border border-orange-200 rounded-bl-md"
                            : "bg-muted rounded-bl-md"
                      }`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {msg.senderRole === "factory" ? <Factory className="w-3 h-3 opacity-70" /> : <User className="w-3 h-3 opacity-70" />}
                          <span className="text-xs opacity-70">
                            {msg.senderRole === "factory" ? "工廠" : "使用者"}
                          </span>
                          {isInvite && <span className="text-xs text-orange-600 font-medium">次管理者邀請</span>}
                          {isProduct && <span className="text-xs opacity-70">商品分享</span>}
                          {isPdf && <span className="text-xs opacity-70">PDF 型錄</span>}
                        </div>

                        {/* 文字訊息或附件，type 預設 text，attachmentData 異常時顯示提示不崩潰 */}
                        {isProduct ? (
                          attachmentData
                            ? <ProductMessageCard data={attachmentData} isMine={isMine} />
                            : <p className="text-sm text-muted-foreground italic">（附件資料異常）</p>
                        ) : isPdf ? (
                          attachmentData
                            ? <PdfMessageCard pdf={attachmentData as unknown as PdfAttachment} messageId={msg.id} isMine={isMine} />
                            : <p className="text-sm text-muted-foreground italic">（附件資料異常）</p>
                        ) : (messageType === "text" || messageType === "co_manager_invite") ? (
                          <p className="text-sm whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{msg.content}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">（此訊息類型暫不支援）</p>
                        )}

                        {canRespond && (
                          <InviteResponseButtons
                            invitationId={invId}
                            onResponded={() => utils.chat.getMessages.invalidate({ conversationId: conversationId! })}
                          />
                        )}
                        {isInvite && !canRespond && invStatus && invStatus !== "pending" && (
                          <p className="text-xs mt-2 font-medium text-muted-foreground">
                            {invStatus === "accepted" ? "✓ 已接受邀請" : "✗ 已拒絕邀請"}
                          </p>
                        )}
                        <p className={`text-xs mt-1 ${isMine ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                          {new Date(msg.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Input area */}
            <div className="border-t p-4">
              <div className="flex gap-2 items-center">
                {/* "+" 附件按鈕（工廠 owner 與 co-manager 可見） */}
                {conversationId && isFactorySide && (
                  <div className="relative shrink-0" ref={attachMenuRef}>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => setAttachMenuOpen(v => !v)}
                      disabled={sendPdfMut.isPending}
                      title="附件"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>

                    <div
                      className={`absolute bottom-12 left-0 z-50 w-48 rounded-lg border bg-popover shadow-md py-1 transition-all duration-[180ms] ease-out origin-bottom-left ${
                        attachMenuOpen
                          ? "opacity-100 scale-100 pointer-events-auto"
                          : "opacity-0 scale-95 pointer-events-none"
                      }`}
                    >
                        <button
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setOrderDialogOpen(true);
                          }}
                        >
                          <ClipboardList className="w-4 h-4 text-orange-600 shrink-0" />
                          建立合作確認單
                        </button>
                        <button
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            setProductPickerOpen(true);
                          }}
                        >
                          <Package className="w-4 h-4 text-orange-500 shrink-0" />
                          傳送架上商品
                        </button>
                        <label className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors cursor-pointer">
                          <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                          上傳商品型錄（限 PDF，7 天）
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            className="hidden"
                            onChange={(e) => {
                              setAttachMenuOpen(false);
                              handlePdfUpload(e);
                            }}
                          />
                        </label>
                      </div>
                  </div>
                )}

                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={isNewChat ? "輸入第一則訊息以開始對話..." : "輸入訊息..."}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  disabled={isSending || sendMut.isPending || sendPdfMut.isPending}
                />
                <Button
                  onClick={handleSend}
                  disabled={!message.trim() || isSending || sendMut.isPending || sendPdfMut.isPending}
                  className="shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>

              {sendPdfMut.isPending && (
                <p className="text-xs text-muted-foreground mt-2 text-center">正在上傳 PDF，請稍候…</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product picker modal — 工廠 owner 與 co-manager 可開啟 */}
      {conversationId && isFactorySide && (
        <ProductPickerModal
          conversationId={conversationId}
          open={productPickerOpen}
          onClose={() => setProductPickerOpen(false)}
          onSent={invalidateMessages}
        />
      )}

      {/* 合作確認單 Dialog — 工廠 owner 與 co-manager 可開啟 */}
      {conversationId && isFactorySide && (
        <CollaborationOrderDialog
          conversationId={conversationId}
          open={orderDialogOpen}
          onClose={() => setOrderDialogOpen(false)}
          onSent={invalidateMessages}
        />
      )}
    </div>
  );
}

// ── 邀請回應按鈕 ──────────────────────────────────────────────────────────
function InviteResponseButtons({ invitationId, onResponded }: { invitationId: number; onResponded: () => void }) {
  const respondMut = trpc.factory.respondToInvitation.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.action === "accept" ? "已接受邀請，您現在是次管理者" : "已拒絕邀請");
      onResponded();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex gap-2 mt-3">
      <Button
        size="sm"
        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
        disabled={respondMut.isPending}
        onClick={() => respondMut.mutate({ invitationId, action: "accept" })}
      >
        <CheckCircle className="w-3.5 h-3.5 mr-1" />接受
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="flex-1"
        disabled={respondMut.isPending}
        onClick={() => respondMut.mutate({ invitationId, action: "decline" })}
      >
        <XCircle className="w-3.5 h-3.5 mr-1" />拒絕
      </Button>
    </div>
  );
}

