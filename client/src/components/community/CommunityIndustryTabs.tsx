import { useRef, useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Factory, Network } from "lucide-react";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { cn } from "@/lib/utils";

interface Props {
  activeSpaceCode: string;
}

const TABS: Array<{ name: string; slug: string }> = [
  { name: COMMUNITY_CROSS_INDUSTRY_NAME, slug: COMMUNITY_CROSS_INDUSTRY_SLUG },
  ...Array.from(INDUSTRY_OPTIONS)
    .map(name => ({ name, slug: INDUSTRY_SLUGS[name] ?? "" }))
    .filter(t => t.slug !== ""),
];

// 超過這個像素數才視為「拖曳」；未超過則視為一般點擊，正常切換產業。
//
// BUG 5 根因（見對話「臺灣傳產論壇看板點不進去」）：這裡原本設 5px。滑鼠
// pointerdown → pointerup 之間，真實使用者的手幾乎不可能完全靜止在同一個
// 像素——一般滑鼠／觸控板的正常點擊，手震或指標裝置取樣造成的誤差就經常
// 超過 5px，等於「幾乎每一次點擊」都被 handlePointerMove 判定成
// state.moved = true，pointerup 時設下 justDraggedRef，接著
// handleClickCapture 在 capture 階段直接 preventDefault + stopPropagation
// 把這次點擊整個吃掉，button 自己的 onClick（navigate）完全不會執行——但
// button 本身仍然會因為滑鼠真的按上去而拿到瀏覽器原生 :hover / :focus-visible
// 樣式，使用者因此看到「這個 tab 好像被選到了」的視覺效果，實際上看板內容
// 完全沒有切換。這不是 CSS active 樣式寫錯，也不是路由或資料層的問題——
// 用瀏覽器實測：7px 的位移就足以讓點擊完全失效，300px 的位移則是真正的拖曳
// 卷動意圖。把門檻拉高到 15px，讓一般點擊的正常誤差不會被誤判為拖曳，同時
// 保留滑鼠拖曳橫向捲動 tab 列的既有功能（真正想拖曳捲動的位移遠大於這個
// 門檻，不受影響）。
const DRAG_THRESHOLD_PX = 15;

export default function CommunityIndustryTabs({ activeSpaceCode }: Props) {
  const [, navigate] = useLocation();
  const activeRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 拖曳中的暫存狀態放在 ref（不觸發 re-render，pointermove 頻率很高）；
  // justDraggedRef 則是拖曳「結束後」到「click 事件觸發前」之間唯一活著的
  // 旗標，用來在 click 的 capture 階段擋下這次因拖曳而連帶觸發的 click，
  // 避免放開滑鼠時誤觸該按鈕的 tab navigation。
  const dragStateRef = useRef<{ startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSpaceCode]);

  // 只接手滑鼠（pointerType === "mouse"）；觸控維持瀏覽器原生 touch-scroll
  // 行為完全不介入，滾輪／trackpad 水平捲動也不受影響（本來就是靠
  // overflow-x-auto 原生處理，這裡沒有加任何 wheel handler）。
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const container = containerRef.current;
    if (!container) return;
    dragStateRef.current = { startX: e.clientX, startScrollLeft: container.scrollLeft, moved: false };
    container.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const state = dragStateRef.current;
    const container = containerRef.current;
    if (!state || !container) return;
    const delta = e.clientX - state.startX;
    if (!state.moved && Math.abs(delta) > DRAG_THRESHOLD_PX) {
      state.moved = true;
      setIsDragging(true);
    }
    if (state.moved) {
      container.scrollLeft = state.startScrollLeft - delta;
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const state = dragStateRef.current;
    if (state?.moved) justDraggedRef.current = true;
    const container = containerRef.current;
    if (container?.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  // Capture 階段（比按鈕自己的 onClick 更早觸發）：這次點擊如果是拖曳放開
  // 滑鼠連帶觸發的，直接擋下，不讓事件繼續傳到按鈕的 onClick。
  const handleClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex gap-1 overflow-x-auto overflow-y-hidden rounded-xl border border-purple-100/80 bg-white/90 p-1.5 shadow-sm dark:border-purple-900/40 dark:bg-card [&::-webkit-scrollbar]:hidden",
        "cursor-grab",
        isDragging && "cursor-grabbing select-none",
      )}
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="選擇產業看板"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      {TABS.map(tab => {
        const isActive = tab.slug === activeSpaceCode;
        const Icon = tab.slug === COMMUNITY_CROSS_INDUSTRY_SLUG ? Network : Factory;
        return (
          <button
            key={tab.slug}
            ref={isActive ? activeRef : undefined}
            role="tab"
            aria-selected={isActive}
            onClick={() => navigate(`/community/${tab.slug}/discussions`)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
              isActive
                ? "bg-purple-600 text-white shadow-sm"
                : "text-muted-foreground hover:-translate-y-px hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950/30 dark:hover:text-purple-300"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-orange-200")} aria-hidden="true" />
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
