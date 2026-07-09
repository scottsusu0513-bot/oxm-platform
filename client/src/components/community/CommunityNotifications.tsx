import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Helmet } from "react-helmet-async";
import { Loader2, AlertTriangle, Bell, CheckCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import CommunityNotificationItem from "./CommunityNotificationItem";

const PAGE_SIZE = 20;

export default function CommunityNotifications() {
  const [page, setPage] = useState(1);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/");
    }
  };

  const { data, isLoading, isError, refetch } = trpc.community.notificationList.useQuery(
    { page, pageSize: PAGE_SIZE },
    { retry: 1 },
  );
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const markReadMut = trpc.community.notificationMarkRead.useMutation({
    onMutate: async (variables) => {
      await utils.community.notificationList.cancel();
      const snapshot = utils.community.notificationList.getData({ page, pageSize: PAGE_SIZE });
      utils.community.notificationList.setData({ page, pageSize: PAGE_SIZE }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map(n =>
            n.id === variables.notificationId ? { ...n, isRead: true, readAt: new Date() } : n
          ),
        };
      });
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        utils.community.notificationList.setData({ page, pageSize: PAGE_SIZE }, ctx.snapshot);
      }
    },
    onSettled: () => {
      utils.community.notificationList.invalidate();
      utils.community.notificationUnreadCount.invalidate();
    },
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
        <title>通知中心 — OXM</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Navbar />

      <FloatingBackButton fallbackHref="/" />
      <main className="container py-6 max-w-2xl">

        {/* 手機版（<sm）：三欄 grid，左欄是右欄的隱形鏡像（同寬），標題在中欄真正置中，
            不會因為「全部已讀」按鈕的寬度把中心點往左推、也不會跟按鈕重疊（含 320/360px 窄螢幕：
            按鈕在手機版縮成純 icon，把兩側欄位壓到最窄，中間可用空間最大化）。
            桌面版（sm+）改回原本 flex justify-between 靠左標題／靠右按鈕版面。 */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 mb-4 sm:flex sm:justify-between">
          {/* 左欄：右欄按鈕的隱形鏡像，只用來撐出對稱寬度，不佔互動與可讀性 */}
          <div className="sm:hidden invisible pointer-events-none" aria-hidden="true">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" tabIndex={-1} className="h-8 w-8 p-0">
                <CheckCheck className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 justify-self-center sm:justify-self-auto min-w-0">
            <Bell className="w-5 h-5 text-orange-500 shrink-0" />
            <h1 className="text-xl font-bold whitespace-nowrap">通知中心</h1>
            {unreadCount > 0 && (
              <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 font-medium leading-none shrink-0">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending}
              className="h-8 w-8 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-xs text-muted-foreground justify-self-end sm:ml-auto"
              aria-label="全部已讀"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">全部已讀</span>
            </Button>
          ) : (
            <div className="sm:hidden" aria-hidden="true" />
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-destructive">通知載入失敗</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              重新載入
            </Button>
          </div>
        ) : !data?.items.length ? (
          <div className="rounded-xl border border-border bg-card py-16 text-center">
            <Bell className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">目前沒有任何通知</p>
            <p className="text-xs text-muted-foreground/70 mt-1">有新消息時會在這裡通知你</p>
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
