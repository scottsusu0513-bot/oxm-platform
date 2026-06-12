import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, Inbox, Clock, XCircle, ChevronRight, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import CommunityBidForm from "./CommunityBidForm";
import type { CommunityBid } from "../../../../drizzle/schema";

interface Props {
  spaceCode: string;
}

type BidStatus = CommunityBid["status"];

function BidStatusBadge({ status }: { status: BidStatus }) {
  switch (status) {
    case "draft":
      return <Badge variant="outline" className="text-muted-foreground">草稿</Badge>;
    case "pending_review":
      return <Badge variant="outline" className="border-yellow-400 text-yellow-600">待審核</Badge>;
    case "rejected":
      return <Badge variant="destructive">已退回</Badge>;
    case "active":
      return <Badge className="bg-green-500 hover:bg-green-600 text-white">進行中</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="text-muted-foreground">已取消</Badge>;
    case "ended":
      return <Badge variant="secondary">已結束</Badge>;
    default:
      return null;
  }
}

function BidCard({ bid, onClick }: {
  bid: CommunityBid & { targetIndustries: string[] };
  onClick: () => void;
}) {
  const deadlineText = bid.deadline
    ? (() => {
        const ms = new Date(bid.deadline).getTime() - Date.now();
        if (ms <= 0) return "已截止";
        const h = Math.floor(ms / 3600000);
        if (h < 24) return `剩 ${h} 小時`;
        return `剩 ${Math.floor(h / 24)} 天`;
      })()
    : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg border border-border hover:border-orange-300 hover:bg-orange-50/30 dark:hover:bg-orange-950/10 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <BidStatusBadge status={bid.status} />
            {deadlineText && bid.status === "active" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {deadlineText}
              </span>
            )}
          </div>
          <p className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-orange-700 dark:group-hover:text-orange-400 transition-colors">
            {bid.title}
          </p>
          {bid.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{bid.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            <span>{bid.authorFactoryNameSnapshot ?? bid.authorNameSnapshot}</span>
            {bid.budgetMin != null || bid.budgetMax != null ? (
              <span>
                {bid.budgetMin != null && bid.budgetMax != null
                  ? `NT$ ${bid.budgetMin.toLocaleString()}–${bid.budgetMax.toLocaleString()}`
                  : bid.budgetMin != null
                    ? `NT$ ${bid.budgetMin.toLocaleString()} 起`
                    : `NT$ 最高 ${bid.budgetMax!.toLocaleString()}`}
              </span>
            ) : null}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 group-hover:text-orange-500 transition-colors" />
      </div>
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-20 text-center">
      <Inbox className="w-10 h-10 mx-auto mb-4 text-muted-foreground/40" />
      <p className="text-base font-semibold text-muted-foreground">目前沒有進行中的需求</p>
      <p className="text-sm text-muted-foreground/60 mt-1 mb-5">率先發布您的採購需求，讓合適的廠商找到您</p>
      <Button variant="outline" size="sm" onClick={onCreate}>
        <Plus className="w-4 h-4 mr-1.5" />
        發布需求
      </Button>
    </div>
  );
}

export default function CommunityBidsPage({ spaceCode }: Props) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showForm, setShowForm] = useState(false);

  const bidsQuery = trpc.community.listBids.useQuery(
    { spaceCode, page: 1, pageSize: 20 },
    { staleTime: 30_000 },
  );
  const myBidsQuery = trpc.community.getMyBids.useQuery(
    { page: 1, pageSize: 20 },
    { staleTime: 30_000 },
  );
  const pendingCountQuery = trpc.community.pendingBidCount.useQuery(undefined, {
    enabled: user?.role === "admin",
    staleTime: 30_000,
  });

  const activeBids = bidsQuery.data?.bids ?? [];
  const myInactiveBids = (myBidsQuery.data?.bids ?? []).filter(
    b => b.status !== "active" && b.status !== "ended",
  );
  const pendingCount = pendingCountQuery.data?.count ?? 0;

  function handleBidClick(bidId: number) {
    navigate(`/community/${spaceCode}/bids/${bidId}`);
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">採購需求</h2>
          <p className="text-xs text-muted-foreground mt-0.5">發布需求讓廠商主動聯繫，或瀏覽其他買家需求</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && pendingCount > 0 && (
            <Badge variant="outline" className="border-orange-400 text-orange-600 gap-1">
              <AlertCircle className="w-3 h-3" />
              {pendingCount} 待審
            </Badge>
          )}
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            發布需求
          </Button>
        </div>
      </div>

      {/* My pending/draft/rejected bids */}
      {myInactiveBids.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">我的需求草稿／審核狀態</p>
          <div className="space-y-2">
            {myInactiveBids.map(bid => (
              <BidCard key={bid.id} bid={bid} onClick={() => handleBidClick(bid.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Active bids list */}
      {bidsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : activeBids.length === 0 ? (
        myInactiveBids.length === 0 ? (
          <EmptyState onCreate={() => setShowForm(true)} />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground/60">目前沒有進行中的需求</div>
        )
      ) : (
        <div className="space-y-2">
          {activeBids.map(bid => (
            <BidCard key={bid.id} bid={bid} onClick={() => handleBidClick(bid.id)} />
          ))}
        </div>
      )}

      {/* Pagination hint */}
      {(bidsQuery.data?.total ?? 0) > 20 && (
        <p className="text-center text-xs text-muted-foreground">
          顯示前 20 筆，共 {bidsQuery.data!.total} 筆需求
        </p>
      )}

      {/* Create bid dialog */}
      {showForm && (
        <CommunityBidForm
          spaceCode={spaceCode}
          onSuccess={(bidId) => {
            setShowForm(false);
            bidsQuery.refetch();
            myBidsQuery.refetch();
            navigate(`/community/${spaceCode}/bids/${bidId}`);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
