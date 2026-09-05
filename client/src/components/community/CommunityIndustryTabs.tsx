import { useRef, useEffect } from "react";
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

// 產業看板點不進去的正式站回歸（見對話「臺灣傳產論壇看板點不進去」第二輪
// Audit）：這裡本來有一整套自製滑鼠 pointer-capture drag-to-scroll 邏輯，
// 靠一個 justDraggedRef 旗標在 click 的 capture 階段判斷「這次點擊是不是
// 剛拖曳完連帶觸發的」，是的話就 preventDefault + stopPropagation 吃掉。
// 上一輪只把觸發拖曳的位移門檻從 5px 調到 15px，但正式站人工複測後證實
// bug 依然存在，且症狀明確：tab 有拿到 focus／hover 樣式（代表 pointer 真的
// 有作用在按鈕上），但 onClick 沒有執行——鎖定到真正 root cause 是
// justDraggedRef 這個旗標本身的生命週期不可靠：pointer capture
// （setPointerCapture）只會把後續的 pointermove／pointerup 導到目前這個
// container，但完全不影響瀏覽器原生的 click 事件——click 仍然是照滑鼠實際
// 放開時「底下真正是什麼元素」來決定要不要觸發、觸發在哪裡。只要一次拖曳
// 放開滑鼠的位置剛好在這個 tablist 容器範圍之外（例如拖曳到卡片邊界外一點
// 點，這在窄視窗、tab 列貼近卡片邊緣時很容易發生），對應的 click 事件根本
// 不會落在這個容器上，本來要負責重置旗標的 onClickCapture 完全不會被觸發，
// justDraggedRef 就會永遠卡在 true。接下來使用者不管再點幾次任何一個 tab，
// 只要 click 真的有進到這個 capture handler，第一次一定會被這個「上一輪
// 拖曳留下的殘留旗標」誤判成「這次也是拖曳」而整個吃掉——這正是「狂點也點
// 不進去」的成因，而且跟門檻設多少完全無關，調高到任何數字都無法根治。
//
// 修法採用使用者明確核准的簡化方向：整個移除這套自製 pointer-capture
// drag-to-scroll 機制，改成完全依賴瀏覽器原生的 overflow-x-auto 捲動
// （滑鼠 shift+滾輪、trackpad 雙指左右滑、觸控拖曳、或直接拖曳下方原生
// scrollbar 都能正常橫向捲動這個 tab 列）。button 的 onClick 不再被任何
// 自製邏輯攔截或延遲，一定會在瀏覽器判定為真正的 click 時原生觸發——
// 「產業 tab 一定點得進去」的優先權高於「桌機可以直接按住 tab 本身拖曳
// 捲動」，且原生捲動機制不存在任何殘留旗標，這整個 bug 類別直接被根除，
// 不是靠更複雜的水平／垂直位移比較去縫補同一種容易出錯的攔截式設計。
//
// 拿掉 scrollbar 隱藏樣式，讓純滑鼠（沒有 trackpad／滾輪 shift 習慣）的
// 使用者也能直接拖曳下方原生 scrollbar 捲動，不會因為拿掉自製拖曳就沒有
// 其他方式可以看到超出畫面的 tab。
export default function CommunityIndustryTabs({ activeSpaceCode }: Props) {
  const [, navigate] = useLocation();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSpaceCode]);

  return (
    <div
      className="flex gap-1 overflow-x-auto overflow-y-hidden rounded-xl border border-purple-100/80 bg-white/90 p-1.5 shadow-sm dark:border-purple-900/40 dark:bg-card"
      style={{ scrollbarWidth: "thin" }}
      role="tablist"
      aria-label="選擇產業看板"
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
