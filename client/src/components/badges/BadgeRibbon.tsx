import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sortBadgeIds, CERTIFICATION_BADGE_MAP } from "@shared/badges";
import { BadgeIcon } from "./BadgeIcon";

/**
 * 單個緞帶勳章：圓形徽章本體 + 下方緞帶尾端 + 陰影，別在卡片左上角、跨越卡片
 * 上邊界的視覺效果由外層容器（見 FactoryResultCard.tsx）負責定位，這裡只管
 * 單顆勳章本身的外觀。桌面 hover 或點擊、手機 tap 都會開啟 Popover 顯示名稱
 * （沿用 BadgeChip 的互動模式）。
 */
function RibbonMedal({ badgeId, size }: { badgeId: string; size: number }) {
  const def = CERTIFICATION_BADGE_MAP[badgeId];
  const [open, setOpen] = useState(false);
  if (!def) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1 rounded-full shrink-0"
          style={{ width: size, height: size * 1.42 }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
          aria-label={def.name}
        >
          {/* 緞帶尾端：疊在圓章下方，V 形缺角製造垂墜感 */}
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 bg-orange-600"
            style={{
              top: size * 0.58,
              width: size * 0.62,
              height: size * 0.62,
              clipPath: "polygon(0% 0%, 100% 0%, 100% 70%, 50% 100%, 0% 70%)",
              zIndex: 0,
              filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.25))",
            }}
          />
          {/* 圓章本體：白底圓框 + 陰影，立體層次 */}
          <span
            aria-hidden="true"
            className="absolute top-0 left-0 rounded-full bg-white ring-2 ring-white flex items-center justify-center z-10"
            style={{ width: size, height: size, boxShadow: "0 2px 5px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.06)" }}
          >
            <BadgeIcon badgeId={badgeId} size={Math.round(size * 0.8)} />
          </span>
          <span className="sr-only">{def.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 text-sm"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <p className="font-semibold">{def.name}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{def.description}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 搜尋卡片左上角的緞帶勳章列：由左至右排列、跨越卡片上邊界（一部分在卡片
 * 外、一部分壓在卡片上）。單排顯示，超出 maxVisible 用「+N」收合，點擊開
 * 啟完整清單 Dialog。只接受「已獲得且選擇公開」的 badgeIds（由呼叫端決定
 * 傳入哪個欄位，這個元件本身不做任何權限判斷）。
 */
export function BadgeRibbon({ badgeIds, size = 40, maxVisible = 4, className }: {
  badgeIds: readonly string[];
  size?: number;
  maxVisible?: number;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = sortBadgeIds(badgeIds);
  if (sorted.length === 0) return null;

  const visible = sorted.slice(0, maxVisible);
  const overflowCount = sorted.length - visible.length;

  return (
    <>
      <div className={`flex items-start gap-1.5 ${className ?? ""}`} onClick={(e) => e.preventDefault()}>
        {visible.map(id => <RibbonMedal key={id} badgeId={id} size={size} />)}
        {overflowCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAll(true); }}
            className="flex items-center justify-center rounded-full bg-white ring-2 ring-white text-muted-foreground text-[11px] font-semibold hover:bg-muted/50 shrink-0"
            style={{ width: size, height: size, boxShadow: "0 2px 5px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.06)" }}
            aria-label={`還有 ${overflowCount} 個徽章`}
          >
            +{overflowCount}
          </button>
        )}
      </div>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>徽章與認證（{sorted.length}）</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {sorted.map(id => {
              const def = CERTIFICATION_BADGE_MAP[id];
              if (!def) return null;
              return (
                <div key={id} className="flex items-start gap-3">
                  <BadgeIcon badgeId={id} size={32} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{def.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{def.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
