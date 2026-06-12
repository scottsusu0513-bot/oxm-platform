import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Gavel, Edit2, CheckCircle, XCircle, Clock, Loader2, AlertTriangle, ShoppingBag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { INDUSTRY_SLUGS } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import CommunityBidForm from "./CommunityBidForm";
import type { CommunityBid } from "../../../../drizzle/schema";

// Slug → display name reverse map
const SLUG_TO_INDUSTRY: Record<string, string> = Object.fromEntries(
  Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])
);

type BidStatus = CommunityBid["status"];

function StatusBadge({ status }: { status: BidStatus }) {
  switch (status) {
    case "draft":        return <Badge variant="outline" className="text-muted-foreground">草稿</Badge>;
    case "pending_review": return <Badge variant="outline" className="border-yellow-400 text-yellow-600">待審核</Badge>;
    case "rejected":    return <Badge variant="destructive">已退回</Badge>;
    case "active":      return <Badge className="bg-green-500 hover:bg-green-600 text-white">進行中</Badge>;
    case "cancelled":   return <Badge variant="outline" className="text-muted-foreground">已取消</Badge>;
    case "ended":       return <Badge variant="secondary">已結束</Badge>;
    default:            return null;
  }
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <dt className="text-muted-foreground whitespace-nowrap">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

interface Props {
  spaceCode: string;
  bidId: number;
}

export default function CommunityBidDetail({ spaceCode, bidId }: Props) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showEditForm, setShowEditForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.community.getBid.useQuery(
    { bidId },
    { staleTime: 30_000 },
  );

  const submitMutation = trpc.community.submitBid.useMutation({
    onSuccess: (data) => {
      utils.community.getBid.invalidate({ bidId });
      if (data.removedProductCount > 0) {
        toast.warning(`送審成功，但有 ${data.removedProductCount} 個附加商品已失效，已自動移除`);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const withdrawMutation = trpc.community.withdrawBid.useMutation({
    onSuccess: () => utils.community.getBid.invalidate({ bidId }),
  });
  const cancelMutation = trpc.community.cancelBid.useMutation({
    onSuccess: () => utils.community.getBid.invalidate({ bidId }),
  });
  const deleteMutation = trpc.community.deleteBid.useMutation({
    onSuccess: () => navigate(`/community/${spaceCode}/bids`),
  });
  const approveMutation = trpc.admin.community.approveBid.useMutation({
    onSuccess: () => {
      utils.community.getBid.invalidate({ bidId });
      utils.community.pendingBidCount.invalidate();
    },
  });
  const rejectMutation = trpc.admin.community.rejectBid.useMutation({
    onSuccess: () => {
      utils.community.getBid.invalidate({ bidId });
      utils.community.pendingBidCount.invalidate();
      setShowRejectInput(false);
      setRejectReason("");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-48 w-full" />
        </main>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-16 text-center">
          <p className="text-muted-foreground">找不到此需求</p>
          <Button variant="link" onClick={() => navigate(`/community/${spaceCode}/bids`)} className="mt-2">返回列表</Button>
        </main>
      </div>
    );
  }

  const { bid, targetIndustries, reviewHistory, pinnedProducts } = data;
  const isOwner = bid.authorUserId === user?.id;
  const isAdmin = user?.role === "admin";

  const deadlineText = bid.deadline
    ? (() => {
        const ms = new Date(bid.deadline).getTime() - Date.now();
        if (ms <= 0) return "已截止";
        const h = Math.floor(ms / 3600000);
        if (h < 24) return `${h} 小時後截止`;
        return `${Math.floor(h / 24)} 天後截止`;
      })()
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{bid.title} — OXM 競標需求</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
        {/* Back navigation */}
        <button
          onClick={() => navigate(`/community/${spaceCode}/bids`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回競標列表
        </button>

        <article className="space-y-6">
          {/* Title + status */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <StatusBadge status={bid.status} />
              {deadlineText && bid.status === "active" && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {deadlineText}
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold leading-snug">{bid.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {bid.authorFactoryNameSnapshot ?? bid.authorNameSnapshot}
              {bid.publishedAt && (
                <span className="ml-2">· {new Date(bid.publishedAt).toLocaleDateString("zh-TW")}</span>
              )}
            </p>
          </div>

          {/* Rejection notice */}
          {bid.status === "rejected" && bid.rejectionReason && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">退回原因</p>
                <p className="text-sm text-muted-foreground mt-0.5">{bid.rejectionReason}</p>
              </div>
            </div>
          )}

          {/* Description */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">需求說明</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{bid.description}</p>
          </section>

          {/* Specs */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">採購資訊</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <InfoRow label="數量" value={bid.quantity} />
              <InfoRow label="材質" value={bid.material} />
              <InfoRow label="期望交期" value={bid.desiredDeliveryDate} />
              <InfoRow label="交貨地點" value={bid.deliveryLocation} />
              <InfoRow label="樣品需求" value={bid.sampleRequired ? "需要樣品" : null} />
              <InfoRow
                label="預算範圍"
                value={
                  bid.budgetMin != null || bid.budgetMax != null
                    ? bid.budgetMin != null && bid.budgetMax != null
                      ? `NT$ ${bid.budgetMin.toLocaleString()}–${bid.budgetMax.toLocaleString()}`
                      : bid.budgetMin != null
                        ? `NT$ ${bid.budgetMin.toLocaleString()} 起`
                        : `NT$ 最高 ${bid.budgetMax!.toLocaleString()}`
                    : null
                }
              />
              <InfoRow label="開放時長" value={`${bid.durationHours} 小時`} />
              {targetIndustries.length > 0 && (
                <InfoRow
                  label="目標產業"
                  value={targetIndustries.map(sc => SLUG_TO_INDUSTRY[sc] ?? sc).join("、")}
                />
              )}
            </dl>
          </section>

          {/* Specifications */}
          {bid.specifications && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">詳細規格</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{bid.specifications}</p>
            </section>
          )}

          {/* Images */}
          {((bid.images ?? []) as string[]).length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">參考圖片</h2>
              <div className="flex flex-wrap gap-2">
                {((bid.images ?? []) as string[]).map((url, i) => (
                  <a key={`${url}-${i}`} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`圖片 ${i + 1}`}
                      className="w-24 h-24 object-cover rounded-lg border border-border hover:opacity-90 transition-opacity"
                    />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Pinned products */}
          {pinnedProducts && pinnedProducts.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground font-medium">
                <ShoppingBag className="w-3.5 h-3.5" />
                相關商品
              </div>
              <div className="flex flex-wrap gap-2">
                {pinnedProducts.map((p) => (
                  <Link key={p.id} href={`/factory/${p.factoryId}`}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer max-w-[200px]">
                      {(p.images as string[] | null)?.[0] && (
                        <img
                          src={(p.images as string[])[0]}
                          alt={p.name}
                          className="w-8 h-8 rounded object-cover shrink-0"
                        />
                      )}
                      <span className="text-xs font-medium truncate">{p.name}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Bidding placeholder */}
          {bid.status === "active" && (
            <section className="rounded-lg border border-dashed border-border p-6 text-center">
              <Gavel className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">投標功能建置中</p>
              <p className="text-xs text-muted-foreground/60 mt-1">廠商報價功能即將推出，敬請期待</p>
            </section>
          )}

          {/* Author actions */}
          {isOwner && (
            <section className="flex flex-wrap gap-2 border-t border-border pt-4">
              {(bid.status === "draft" || bid.status === "rejected") && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowEditForm(true)}>
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                    編輯需求
                  </Button>
                  <Button
                    size="sm"
                    disabled={submitMutation.isPending}
                    onClick={() => submitMutation.mutate({ bidId })}
                  >
                    {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    送審
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (confirm("確定刪除此需求？此操作無法復原。")) {
                        deleteMutation.mutate({ bidId });
                      }
                    }}
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    刪除需求
                  </Button>
                </>
              )}
              {bid.status === "pending_review" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={withdrawMutation.isPending}
                  onClick={() => withdrawMutation.mutate({ bidId })}
                >
                  {withdrawMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  撤回審核
                </Button>
              )}
              {bid.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate({ bidId })}
                >
                  {cancelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  取消需求
                </Button>
              )}
            </section>
          )}

          {/* Admin actions */}
          {isAdmin && bid.status === "pending_review" && (
            <section className="rounded-lg border border-orange-200 bg-orange-50/40 dark:bg-orange-950/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">管理員審核</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="bg-green-500 hover:bg-green-600"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => approveMutation.mutate({ bidId })}
                >
                  {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
                  通過審核
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => setShowRejectInput(v => !v)}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" />
                  退回
                </Button>
              </div>
              {showRejectInput && (
                <div className="space-y-2">
                  <Label htmlFor="reject-reason" className="text-xs">退回原因（必填）</Label>
                  <Textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="說明退回原因，將通知作者..."
                    rows={3}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!rejectReason.trim() || rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate({ bidId, reason: rejectReason.trim() })}
                  >
                    {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    確認退回
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Admin review history */}
          {isAdmin && reviewHistory.length > 0 && (
            <section className="border-t border-border pt-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">審核歷史</h2>
              <ol className="space-y-1.5">
                {reviewHistory.map(entry => (
                  <li key={entry.id} className="text-xs text-muted-foreground flex gap-2">
                    <span className="tabular-nums whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <span className={
                      entry.action === "approved" ? "text-green-600" :
                      entry.action === "rejected" ? "text-destructive" : ""
                    }>
                      {entry.actorNameSnapshot ? <strong>{entry.actorNameSnapshot}</strong> : null}
                      {entry.actorNameSnapshot ? " · " : ""}
                      {entry.action === "submitted" ? "提交審核"
                        : entry.action === "approved" ? "通過審核"
                        : entry.action === "withdrawn" ? "撤回審核"
                        : `退回：${entry.reason ?? ""}`}
                      {entry.bidStatusBefore && entry.bidStatusAfter
                        ? <span className="text-muted-foreground/50 ml-1">({entry.bidStatusBefore} → {entry.bidStatusAfter})</span>
                        : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      </main>

      {/* Edit form */}
      {showEditForm && (
        <CommunityBidForm
          spaceCode={spaceCode}
          existingBidId={bidId}
          existingAuthorFactoryId={bid.authorFactoryId ?? null}
          defaultValues={{
            title: bid.title,
            description: bid.description,
            quantity: bid.quantity ?? undefined,
            material: bid.material ?? undefined,
            specifications: bid.specifications ?? undefined,
            sampleRequired: bid.sampleRequired,
            desiredDeliveryDate: bid.desiredDeliveryDate ?? undefined,
            deliveryLocation: bid.deliveryLocation ?? undefined,
            budgetMin: bid.budgetMin?.toString(),
            budgetMax: bid.budgetMax?.toString(),
            durationHours: bid.durationHours,
            targetIndustrySpaceCodes: targetIndustries,
            images: (bid.images ?? []) as string[],
            pinnedProductIds: (bid.pinnedProductIds ?? []) as number[],
          }}
          onSuccess={() => {
            setShowEditForm(false);
            utils.community.getBid.invalidate({ bidId });
          }}
          onCancel={() => setShowEditForm(false)}
        />
      )}
    </div>
  );
}
