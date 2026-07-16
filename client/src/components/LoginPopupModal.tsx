import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

const MAX_ITEMS = 5;

// 登入通知面板：最多同時呈現 5 則啟用中的登入彈窗消息（既有「平台消息」公告
// 的登入曝光入口，不是獨立公告系統）。
//
// 刻意不用 client/src/components/ui/dialog.tsx 共用的 <DialogContent>——那個
// 元件預設可以點遮罩或按 Esc 關閉，且沒有暴露 overlay 透明度／卡片樣式的客製
// 介面。這裡直接組 Radix 原始元件，才能同時滿足「不可點遮罩關閉、不可按 Esc
// 關閉、只有按鈕才能觸發已讀」的需求，也不需要動到其他頁面共用的 dialog.tsx。
export default function LoginPopupModal() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const { data } = trpc.loginPopup.toShow.useQuery(undefined, {
    enabled: isAuthenticated,
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

  const markViewedMut = trpc.loginPopup.markViewed.useMutation();

  if (items.length === 0) return null;

  // 面板剛出現不會標記已讀；只有使用者實際點擊「我知道了」或任一「進入完整
  // 公告」才寫入，且後端用 (userId, date) 唯一索引做 idempotent 處理，重複
  // 點擊或同時點多個按鈕都不會出錯或造成重複紀錄。標記的是「今天完成顯示」
  // 這件事本身，不是逐則消息分別已讀，所以哪一則被點擊都只需要呼叫一次。
  const markTodayDone = (representativeId: number) => {
    markViewedMut.mutate({ id: representativeId });
  };

  const handleAcknowledge = () => {
    markTodayDone(items[0].id);
    setOpen(false);
  };

  const handleGoToAnnouncement = (item: (typeof items)[number]) => {
    markTodayDone(item.id);
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
                    <p className="text-xs sm:text-sm text-gray-500 leading-relaxed mt-0.5 line-clamp-2">{item.summary}</p>
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
