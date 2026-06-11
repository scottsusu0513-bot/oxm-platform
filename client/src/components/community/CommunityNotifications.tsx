import { useState } from "react";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { ChevronLeft, Loader2, AlertTriangle, Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import CommunityNotificationItem from "./CommunityNotificationItem";

const PAGE_SIZE = 20;

export default function CommunityNotifications() {
  const [page, setPage] = useState(1);
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.community.notificationList.useQuery({ page, pageSize: PAGE_SIZE });
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const markReadMut = trpc.community.notificationMarkRead.useMutation({
    onSuccess: () => utils.community.notificationList.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const markAllMut = trpc.community.notificationMarkAllRead.useMutation({
    onSuccess: () => {
      utils.community.notificationList.invalidate();
      utils.community.notificationUnreadCount.invalidate();
      toast.success("已全部標為已讀");
    },
    onError: (e) => toast.error(e.message),
  });

  const unreadCount = (data?.items ?? []).filter(n => !n.isRead).length;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>通知中心 — OXM 商案討論區</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <main className="container py-8 max-w-2xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/community" className="hover:text-foreground transition-colors">商案討論區</Link>
          <ChevronLeft className="w-3 h-3 rotate-180" />
          <span className="text-foreground font-medium">通知中心</span>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-500" />
            <h1 className="text-xl font-bold">通知中心</h1>
            {unreadCount > 0 && (
              <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 font-medium leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending}
              className="h-8 gap-1.5 text-xs text-muted-foreground"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              全部已讀
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-destructive py-12 justify-center text-sm">
            <AlertTriangle className="w-4 h-4" />
            載入失敗，請重試
          </div>
        ) : !data?.items.length ? (
          <div className="rounded-xl border border-border bg-card py-16 text-center">
            <Bell className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">目前沒有任何通知</p>
            <p className="text-xs text-muted-foreground/70 mt-1">追蹤看板或工廠後，有新討論時會在這裡通知你</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            {data.items.map((notification) => (
              <CommunityNotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => {
                  if (!notification.isRead) {
                    markReadMut.mutate({ notificationId: notification.id });
                  }
                }}
              />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              上一頁
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              下一頁
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
