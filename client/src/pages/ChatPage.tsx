import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useRoute, useLocation, useSearch } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Send, ArrowLeft, Factory, User, CheckCircle, XCircle, Plus, Package, FileText, ExternalLink, Download } from "lucide-react";

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

// ── 主元件 ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [matchExisting, params] = useRoute("/chat/:conversationId");
  const isNewChat = !matchExisting || params?.conversationId === "new";
  const conversationId = isNewChat ? null : Number(params?.conversationId);

  const [, navigate] = useLocation();
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
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: existingConv } = trpc.chat.getExisting.useQuery(
    { factoryId: factoryId!, productId: undefined },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );
  const { data: meta } = trpc.chat.getConversationMeta.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId && isAuthenticated }
  );
  const { data: msgs, isLoading: msgsLoading, isError: msgsError } = trpc.chat.getMessages.useQuery(
    { conversationId: conversationId!, page: 1 },
    { enabled: !!conversationId && isAuthenticated, refetchInterval: 5000 }
  );
  const { data: factoryData } = trpc.factory.getById.useQuery(
    { id: factoryId! },
    { enabled: isNewChat && !!factoryId && isAuthenticated }
  );

  const isFactoryOwner = !!user && meta?.factoryOwnerId === user.id;

  useEffect(() => {
    if (existingConv) navigate(`/chat/${existingConv.id}`, { replace: true });
  }, [existingConv, navigate]);

  useEffect(() => {
    if (isNewChat && factoryData && !existingConv) {
      const name = factoryData.name ?? "工廠";
      const product = factoryData.products?.find((p: any) => p.id === productId);
      if (product) {
        setMessage(`${name}你好，我對您的「${product.name}」產品有興趣，希望你可以提供不同訂購數量之間的報價，謝謝！`);
      } else {
        setMessage(`${name}你好，我想詢問貴工廠的代工服務，期待您的回覆！`);
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

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
          <a href={getLoginUrl()}><Button>登入</Button></a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <div className="container py-4 flex-1 flex flex-col max-w-3xl">
        <Button variant="ghost" size="sm" className="mb-3 self-start" onClick={() => navigate("/messages")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回訊息列表
        </Button>

        <Card className="flex-1 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Factory className="w-5 h-5" />
              {displayFactoryName}
              {displayProductName && (
                <Badge variant="outline" className="text-xs font-normal">{displayProductName}</Badge>
              )}
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3" style={{ maxHeight: "calc(100vh - 300px)", minHeight: "400px" }}>
              {msgsLoading && !isNewChat ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-3/4" />)}
                </div>
              ) : msgsError && !isNewChat ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  訊息載入失敗，請重新整理頁面
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
                  const isMine = msg.senderId === user?.id;
                  const messageType: string = (msg as any).type || "text";
                  const isInvite = messageType === "co_manager_invite";
                  const isProduct = messageType === "product";
                  const isPdf = messageType === "pdf";
                  const invStatus = (msg as any).invitationStatus;
                  const invId = (msg as any).invitationId;
                  const attachmentData = (msg as any).attachmentData as Record<string, any> | null;
                  const canRespond = isInvite && !isMine && invStatus === "pending" && invId;

                  return (
                    <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
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
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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
                    </div>
                  );
                })
              )}
            </div>

            {/* Input area */}
            <div className="border-t p-4">
              <div className="flex gap-2 items-center">
                {/* "+" 附件按鈕（僅工廠 owner 可見） */}
                {conversationId && isFactoryOwner && (
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

                    {attachMenuOpen && (
                      <div className="absolute bottom-12 left-0 z-50 w-48 rounded-lg border bg-popover shadow-md py-1">
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
                    )}
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

      {/* Product picker modal — 只有工廠 owner 才可開啟 */}
      {conversationId && isFactoryOwner && (
        <ProductPickerModal
          conversationId={conversationId}
          open={productPickerOpen}
          onClose={() => setProductPickerOpen(false)}
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
