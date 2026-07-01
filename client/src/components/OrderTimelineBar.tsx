import {
  buildOrderTimelineNodes,
  getTimelineProgressPercent,
  type OrderDateFields,
  type TimelineNode,
  type Urgency,
} from "@/lib/orderTimeline";

// ── Urgency styles ────────────────────────────────────────────────────────────
const DOT_CLASS: Record<Urgency, string> = {
  normal:  "bg-blue-400",
  warning: "bg-amber-400",
  danger:  "bg-orange-500",
  overdue: "bg-red-500",
};

const TEXT_CLASS: Record<Urgency, string> = {
  normal:  "text-slate-500",
  warning: "text-amber-600",
  danger:  "text-orange-600",
  overdue: "text-red-600",
};

const FILL_STYLE = {
  background: "linear-gradient(to right, #fb923c, #ea580c)",
};

// ── NodeGroup: same-date nodes merged into one text block ─────────────────────
type NodeGroup = {
  date: string;
  dateShort: string;
  dateText: string;
  labels: string[];
  urgency: Urgency;
  visualPercent: number;
  placement: "top" | "bottom";
};

const URGENCY_ORDER: Record<Urgency, number> = {
  normal: 0, warning: 1, danger: 2, overdue: 3,
};

function groupNodes(nodes: TimelineNode[]): NodeGroup[] {
  const map = new Map<string, NodeGroup>();
  for (const node of nodes) {
    const existing = map.get(node.date);
    if (existing) {
      existing.labels.push(node.label);
      if (URGENCY_ORDER[node.urgency] > URGENCY_ORDER[existing.urgency]) {
        existing.urgency = node.urgency;
      }
    } else {
      map.set(node.date, {
        date: node.date,
        dateShort: node.dateShort,
        dateText: node.dateText,
        labels: [node.label],
        urgency: node.urgency,
        visualPercent: node.visualPercent,
        placement: "bottom",
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.visualPercent - b.visualPercent);
}

// If two adjacent groups are within `threshold` visual-%, flip the second to
// the opposite side of the first.
function assignPlacements(groups: NodeGroup[], threshold: number): NodeGroup[] {
  const result = groups.map(g => ({ ...g, placement: "bottom" as "top" | "bottom" }));
  for (let i = 1; i < result.length; i++) {
    if (result[i].visualPercent - result[i - 1].visualPercent < threshold) {
      result[i].placement = result[i - 1].placement === "bottom" ? "top" : "bottom";
    }
  }
  return result;
}

// ── Layout ────────────────────────────────────────────────────────────────────
// Compact (72px): bar centred at 28px.
//   Above-bar zone (0–23px): fits 1-label "top" text cleanly; 2-label with
//   minor edge-clipping within card's space-y-2 gap (acceptable).
// Full (92px): bar centred at 39px, larger text.
type Layout = {
  containerH: number;
  barTop: number;
  barH: number;
  dotTop: number;
  dotH: number;
  dotCls: string;
  lineH: number;
  fontCls: string;
  threshold: number;
};

const COMPACT: Layout = {
  containerH: 72,
  barTop: 26,
  barH: 4,
  dotTop: 23,   // centre = 23+5 = 28 = barTop+barH/2 ✓
  dotH: 10,
  dotCls: "w-2.5 h-2.5",
  lineH: 9,
  fontCls: "text-[9px]",
  threshold: 14,
};

const FULL: Layout = {
  containerH: 92,
  barTop: 36,
  barH: 6,
  dotTop: 32,   // centre = 32+7 = 39 = barTop+barH/2 ✓
  dotH: 14,
  dotCls: "w-3.5 h-3.5",
  lineH: 11,
  fontCls: "text-[10px]",
  threshold: 12,
};

// ── Component ─────────────────────────────────────────────────────────────────
type Props = {
  order: OrderDateFields;
  compact?: boolean;
};

export function OrderTimelineBar({ order, compact = false }: Props) {
  const nodes = buildOrderTimelineNodes(order);
  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">尚無日期節點</p>;
  }

  const rawProgress = getTimelineProgressPercent(nodes);
  const progressVisualPct = rawProgress === 0 ? 0 : 4 + rawProgress * 0.92;

  const layout = compact ? COMPACT : FULL;
  const groups = assignPlacements(groupNodes(nodes), layout.threshold);

  return (
    <div className="relative w-full select-none" style={{ height: `${layout.containerH}px` }}>
      {/* Gray base track */}
      <div
        className="absolute left-0 right-0 rounded-full bg-gray-200"
        style={{ top: `${layout.barTop}px`, height: `${layout.barH}px` }}
      />
      {/* OXM orange progress fill */}
      {progressVisualPct > 0 && (
        <div
          className="absolute left-0 rounded-full"
          style={{
            top: `${layout.barTop}px`,
            height: `${layout.barH}px`,
            width: `${progressVisualPct}%`,
            ...FILL_STYLE,
          }}
        />
      )}
      {groups.map(group => (
        <GroupPin
          key={group.date}
          group={group}
          layout={layout}
          compact={compact}
          progressVisualPct={progressVisualPct}
        />
      ))}
    </div>
  );
}

// ── GroupPin ──────────────────────────────────────────────────────────────────
// Text layout:
//   "top"    — labels stack upward from bar, date is bottom-most (closest to bar)
//   "bottom" — labels first then date, stacked downward from dot bottom
//
// Date: text-slate-400 (de-emphasised)
// Labels: urgency colour + font-medium
function GroupPin({
  group,
  layout,
  compact,
  progressVisualPct,
}: {
  group: NodeGroup;
  layout: Layout;
  compact: boolean;
  progressVisualPct: number;
}) {
  const left = `${group.visualPercent}%`;
  const isPassed = group.visualPercent <= progressVisualPct;
  const ringCls = isPassed ? "ring-2 ring-white" : "ring-2 ring-white/60";
  const textCls = TEXT_CLASS[group.urgency];
  const dateStr = compact ? group.dateShort : group.dateText;
  const { dotTop, dotH, lineH, fontCls, dotCls } = layout;

  type TextLine = { text: string; y: number; isDate: boolean };
  const lines: TextLine[] = [];

  if (group.placement === "top") {
    // Block ends just above the dot; date is closest to bar, labels above.
    const dateY = dotTop - 3 - lineH;
    for (let i = 0; i < group.labels.length; i++) {
      lines.push({
        text: group.labels[i],
        y: dateY - (group.labels.length - i) * lineH,
        isDate: false,
      });
    }
    lines.push({ text: dateStr, y: dateY, isDate: true });
  } else {
    // Block starts just below the dot; labels first, date last.
    const blockStart = dotTop + dotH + 2;
    for (let i = 0; i < group.labels.length; i++) {
      lines.push({ text: group.labels[i], y: blockStart + i * lineH, isDate: false });
    }
    lines.push({ text: dateStr, y: blockStart + group.labels.length * lineH, isDate: true });
  }

  return (
    <>
      {/* One dot per group (same-date nodes share visualPercent) */}
      <div
        className={`absolute ${dotCls} rounded-full ${DOT_CLASS[group.urgency]} ${ringCls}`}
        style={{ left, top: `${dotTop}px`, transform: "translateX(-50%)" }}
      />
      {lines.map((line, i) => (
        <span
          key={i}
          className={`absolute ${fontCls} whitespace-nowrap leading-none ${
            line.isDate ? "text-slate-400" : `${textCls} font-medium`
          }`}
          style={{ left, top: `${line.y}px`, transform: "translateX(-50%)" }}
        >
          {line.text}
        </span>
      ))}
    </>
  );
}
