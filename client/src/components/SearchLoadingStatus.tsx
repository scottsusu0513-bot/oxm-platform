import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search as SearchIcon, Sparkles } from "lucide-react";
import {
  SEARCH_LOADING_LONG_MS,
  SEARCH_LOADING_SHOW_DELAY_MS,
  getSearchLoadingLines,
  type SearchLoadingPhase,
} from "@/lib/searchLoadingState";

/**
 * pending 期間依經過時間回傳 Loading 階段；activeKey（目前搜尋條件的
 * fingerprint）一變就重新計時，舊搜尋的計時不會延續到新搜尋上。
 */
export function useSearchLoadingPhase(pending: boolean, activeKey: string): SearchLoadingPhase {
  // 階段跟產生它的 activeKey 綁在一起：換成新搜尋的第一個 render 不會沿用
  // 上一個搜尋已經累積到的階段（例如 "long"）。但如果 Loading 已經顯示中、
  // 使用者又換了條件，新搜尋直接維持 "searching"，不先退回舊的筆數再重新
  // 等 delay（那樣會閃一下上一個搜尋的結果數）。
  const wasVisibleRef = useRef(false);
  const [state, setState] = useState<{ key: string; phase: SearchLoadingPhase }>({ key: activeKey, phase: "hidden" });
  useEffect(() => {
    const carry = pending && wasVisibleRef.current;
    setState({ key: activeKey, phase: carry ? "searching" : "hidden" });
    if (!pending) return;
    const show = carry ? undefined : setTimeout(() => setState({ key: activeKey, phase: "searching" }), SEARCH_LOADING_SHOW_DELAY_MS);
    const long = setTimeout(() => setState({ key: activeKey, phase: "long" }), SEARCH_LOADING_LONG_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(long);
    };
  }, [pending, activeKey]);
  let phase: SearchLoadingPhase = "hidden";
  if (pending) {
    phase = state.key === activeKey ? state.phase : wasVisibleRef.current ? "searching" : "hidden";
  }
  wasVisibleRef.current = phase !== "hidden";
  return phase;
}

/**
 * 結果區中央的 Loading 卡片。呼叫端的結果區容器必須是 position:relative；
 * 卡片以「結果區目前在畫面上可見的部分（扣掉 sticky Navbar）」的中心定位，
 * 捲動／縮放／結果區高度改變時重新計算——結果列表常常比畫面高，固定在容器
 * 幾何中心會跑到畫面外。只改卡片自己的 top，不動任何 scroll position。
 *
 * 整張卡片 aria-hidden：朗讀交給呼叫端常駐的 role="status" live region，
 * 避免同一段文字被讀兩次。
 */
export function SearchLoadingOverlay({ keyword, phase }: { keyword: string; phase: Exclude<SearchLoadingPhase, "hidden"> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const container = card?.offsetParent as HTMLElement | null;
    if (!card || !container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = container.getBoundingClientRect();
      const headerBottom = Math.max(0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
      const next = computeOverlayTop({
        containerTop: rect.top,
        containerHeight: rect.height,
        visibleTop: headerBottom,
        visibleBottom: window.innerHeight,
        cardHeight: card.offsetHeight,
      });
      setTop(prev => (prev === next ? prev : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(container);
    ro?.observe(card);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, []);

  const { title, detail, compactDetail } = getSearchLoadingLines(keyword, phase);
  const isAi = phase === "long";
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      <div
        ref={cardRef}
        style={{ top: top ?? 0 }}
        className="absolute left-1/2 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-background/95 px-6 py-5 text-center shadow-lg backdrop-blur-sm"
        data-testid="search-loading-overlay"
      >
        <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
          <span className={`absolute inset-0 rounded-full bg-primary/15 motion-reduce:hidden ${isAi ? "oxm-search-halo-ai" : "oxm-search-halo"}`} />
          <span
            className={`absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin motion-reduce:animate-none ${isAi ? "[animation-duration:1.6s]" : ""}`}
          />
          {isAi ? <Sparkles className="relative h-5 w-5 text-primary" /> : <SearchIcon className="relative h-5 w-5 text-primary" />}
        </div>
        <p key={phase} className="flex items-center justify-center gap-2 text-sm font-medium text-foreground break-words animate-in fade-in duration-300 motion-reduce:animate-none">
          <span className="min-w-0">{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-primary">
            <span className="oxm-loading-dot" />
            <span className="oxm-loading-dot" />
            <span className="oxm-loading-dot" />
          </span>
        </p>
        {detail && (
          <p className="mt-1.5 text-xs text-muted-foreground break-words animate-in fade-in slide-in-from-bottom-1 duration-500 motion-reduce:animate-none">
            {compactDetail ? (
              <>
                <span className="hidden sm:inline">{detail}</span>
                <span className="sm:hidden">{compactDetail}</span>
              </>
            ) : detail}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 卡片 top（相對結果區容器）：結果區可見部分的中心，並夾在容器範圍內。
 * 結果區完全不在畫面內時貼齊最近的一端。
 */
export function computeOverlayTop(args: {
  containerTop: number;
  containerHeight: number;
  visibleTop: number;
  visibleBottom: number;
  cardHeight: number;
}): number {
  const { containerTop, containerHeight, visibleTop, visibleBottom, cardHeight } = args;
  const containerBottom = containerTop + containerHeight;
  const from = Math.max(containerTop, visibleTop);
  const to = Math.min(containerBottom, visibleBottom);
  const centerInViewport = to > from ? (from + to) / 2 : containerTop >= visibleBottom ? containerTop : containerBottom;
  const maxTop = Math.max(0, containerHeight - cardHeight);
  return Math.round(Math.min(maxTop, Math.max(0, centerInViewport - containerTop - cardHeight / 2)));
}
