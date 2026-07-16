import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const MAX_ITEMS = 5;

// 登入通知面板：最多同時呈現 5 則啟用中的登入彈窗消息（既有「平台消息」公告
// 的登入曝光入口，不是獨立公告系統）。未登入訪客與已登入會員共用同一支
// toShow query，後端依 session 是否存在分流——訪客每次進首頁都可能再看到
// （沒有「今天看過」這個狀態、也不會建立任何觀看紀錄），會員則維持每個台灣
// 日曆日只完成顯示一次。
//
// 刻意不用 client/src/components/ui/dialog.tsx 共用的 <DialogContent>——那個
// 元件預設可以點遮罩或按 Esc 關閉，且沒有暴露 overlay 透明度／卡片樣式的客製
// 介面。這裡直接組 Radix 原始元件，才能同時滿足「不可點遮罩關閉、不可按 Esc
// 關閉、只有按鈕才能觸發已讀」的需求，也不需要動到其他頁面共用的 dialog.tsx。
export default function LoginPopupModal() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  // 訪客也要查詢，所以不能因為未登入就 enabled:false；只需要等登入狀態確定
  // （authLoading 結束）後再送出查詢，避免用尚未確定的登入狀態打一次注定要
  // 被丟棄、又立刻重打的請求。
  const { data } = trpc.loginPopup.toShow.useQuery(undefined, {
    enabled: !authLoading,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const items = data?.items ?? [];

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (items.length > 0) setOpen(true);
    // 只在「這批消息的組成」改變時重新評估要不要開啟，避免同一批資料重新
    // render 時被誤判成新的一批而重新彈出。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(i => i.id).join(",")]);

  // 使用者在首頁上完成登入、從「訪客」變成「已登入」時，同一個 query 要重新
  // 打一次，才會從訪客版本換成「今天是否看過」的會員版本。用 ref 記錄上一次
  // 確定後的登入狀態，只在真正發生 false→true 的轉變時才 invalidate，避免
  // 每次 render 或第一次掛載就觸發，不會造成無限 refetch。
  const previousAuthStateRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (previousAuthStateRef.current === false && isAuthenticated) {
      utils.loginPopup.toShow.invalidate();
    }
    previousAuthStateRef.current = isAuthenticated;
  }, [authLoading, isAuthenticated, utils]);

  const markViewedMut = trpc.loginPopup.markViewed.useMutation();

  if (items.length === 0) return null;

  // 面板剛出現不會標記已讀；只有使用者實際點擊「我知道了」或任一「進入完整
  // 公告」才寫入，且後端用 (userId, date) 唯一索引做 idempotent 處理，重複
  // 點擊或同時點多個按鈕都不會出錯或造成重複紀錄。標記的是「今天完成顯示」
  // 這件事本身，不是逐則消息分別已讀，所以哪一則被點擊都只需要呼叫一次。
  //
  // 未登入訪客沒有 session 可以寫入，且訪客版本本來就允許「每次進首頁都
  // 可能再看到」，所以訪客點任何按鈕都只關閉／導向，不呼叫 markViewed，也
  // 不會用 cookie／localStorage 等替代方式記錄「訪客看過」。
  const markTodayDoneIfAuthenticated = (representativeId: number) => {
    if (isAuthenticated) {
      markViewedMut.mutate({ id: representativeId });
    }
  };

  const handleAcknowledge = () => {
    markTodayDoneIfAuthenticated(items[0].id);
    setOpen(false);
  };

  const handleGoToAnnouncement = (item: (typeof items)[number]) => {
    markTodayDoneIfAuthenticated(item.id);
    setOpen(false);
    navigate(`/announcements?highlight=${item.announcementId}`);
  };

  const slots = Array.from({ length: MAX_ITEMS }, (_, i) => items[i] ?? null);

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/65 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-[100] w-[calc(100%-2.5rem)] sm:w-[620px] max-w-[620px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[22px] bg-white shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 focus:outline-none"
          onEscapeKeyDown={e => e.preventDefault()}
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">登入通知（{items.length} 則）</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {items.map(i => i.title).join("、")}
          </DialogPrimitive.Description>

          <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-purple-500 px-6 py-5 rounded-t-[22px]">
            <p aria-hidden className="text-white font-bold text-lg leading-snug">最新消息通知</p>
          </div>

          <div>
            {slots.map((item, i) =>
              item ? (
                <div
                  key={item.id}
                  className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${i > 0 ? "border-t border-gray-100" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm sm:text-base text-gray-900 leading-snug">{item.title}</p>
                    <p className="text-xs sm:text-sm text-gray-500 leading-relaxed mt-0.5 line-clamp-3">{item.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGoToAnnouncement(item)}
                    className="shrink-0 w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-purple-500 text-white font-semibold text-xs sm:text-sm shadow-sm hover:shadow-md active:scale-[0.98] transition-all whitespace-nowrap"
                  >
                    進入完整公告
                  </button>
                </div>
              ) : (
                // 空白列：整欄留白，不顯示標題／摘要 placeholder、不顯示按鈕、
                // 不顯示「尚無消息」，只維持一個淺淺的分隔橫列，讓五列結構仍
                // 清楚，但不佔用跟有內容列一樣的高度。
                <div key={`empty-${i}`} className={`h-3 sm:h-4 ${i > 0 ? "border-t border-gray-50" : ""}`} />
              )
            )}
          </div>

          <div className="px-6 pt-2 pb-6">
            <button
              type="button"
              onClick={handleAcknowledge}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-500 via-amber-500 to-purple-500 text-white font-semibold text-sm shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
            >
              我知道了
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
