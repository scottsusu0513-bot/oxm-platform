import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search } from "lucide-react";
import { CERTIFICATION_BADGES, BADGE_CATEGORY_LABELS, sortBadgeIds, type BadgeCategory } from "@shared/badges";
import { BadgeIcon } from "./BadgeIcon";

/** 搜尋 + 複選徽章清單，用於 FactoryDashboard「徽章系統」區塊。 */
export function BadgePicker({ selected, onChange, disabled }: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CERTIFICATION_BADGES;
    return CERTIFICATION_BADGES.filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const groups = new Map<BadgeCategory, typeof CERTIFICATION_BADGES[number][]>();
    for (const b of filtered) {
      const list = groups.get(b.category) ?? [];
      list.push(b);
      groups.set(b.category, list);
    }
    return groups;
  }, [filtered]);

  const toggle = (id: string) => {
    if (disabled) return;
    const next = selected.includes(id) ? selected.filter(x => x !== id) : sortBadgeIds([...selected, id]);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜尋徽章名稱或代碼（中英文／數字皆可）"
          className="pl-9"
        />
      </div>
      <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
        {(["bni", "company", "product"] as const).map(cat => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <div key={cat} className="p-2">
              <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">{BADGE_CATEGORY_LABELS[cat]}</p>
              <div className="grid sm:grid-cols-2 gap-1">
                {items.map(b => (
                  <label
                    key={b.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${disabled ? "opacity-50" : "hover:bg-muted cursor-pointer"}`}
                  >
                    <Checkbox disabled={disabled} checked={selected.includes(b.id)} onCheckedChange={() => toggle(b.id)} />
                    <BadgeIcon badgeId={b.id} size={22} />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">找不到符合的徽章</p>
        )}
      </div>
    </div>
  );
}
