import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CERTIFICATION_BADGE_MAP } from "@shared/badges";
import { BadgeIcon } from "./BadgeIcon";

/**
 * 可點擊／可鍵盤操作的單一徽章：桌面 hover 或點擊、手機 tap 都會開啟
 * Popover 顯示完整名稱與簡短說明（不能只靠 hover，因為手機沒有 hover）。
 */
export function BadgeChip({ badgeId, size = 26 }: { badgeId: string; size?: number }) {
  const def = CERTIFICATION_BADGE_MAP[badgeId];
  const [open, setOpen] = useState(false);
  if (!def) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v); }}
          aria-label={def.name}
        >
          <BadgeIcon badgeId={badgeId} size={size} />
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
