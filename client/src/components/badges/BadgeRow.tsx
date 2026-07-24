import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sortBadgeIds, CERTIFICATION_BADGE_MAP } from "@shared/badges";
import { BadgeChip } from "./BadgeChip";
import { BadgeIcon } from "./BadgeIcon";

/**
 * 徽章列：BNI 永遠第一，其餘依 shared 排序。單排顯示數量超出 maxVisible
 * 時顯示「＋N」，點擊開啟完整清單 Dialog（同時支援桌面與手機 tap）。
 */
export function BadgeRow({ badgeIds, maxVisible = 4, size = 26, className }: {
  badgeIds: readonly string[];
  maxVisible?: number;
  size?: number;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const sorted = sortBadgeIds(badgeIds);
  if (sorted.length === 0) return null;

  const visible = sorted.slice(0, maxVisible);
  const overflowCount = sorted.length - visible.length;

  return (
    <>
      <div className={`flex items-center gap-1 ${className ?? ""}`} onClick={(e) => e.preventDefault()}>
        {visible.map(id => <BadgeChip key={id} badgeId={id} size={size} />)}
        {overflowCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAll(true); }}
            className="flex items-center justify-center rounded-full bg-muted text-muted-foreground text-[11px] font-medium hover:bg-muted/80 outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
            style={{ width: size, height: size }}
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
