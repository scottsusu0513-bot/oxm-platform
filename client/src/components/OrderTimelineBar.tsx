import {
  buildOrderTimelineNodes,
  getTimelineProgressPercent,
  type OrderDateFields,
  type TimelineNode,
  type Urgency,
} from "@/lib/orderTimeline";

// ── Urgency dot / text styles ─────────────────────────────────────────────────
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

const BADGE_LABEL: Record<Urgency, string> = {
  normal:  "",
  warning: "接近",
  danger:  "緊急",
  overdue: "已逾期",
};

const BADGE_CLASS: Record<Urgency, string> = {
  normal:  "",
  warning: "bg-amber-100 text-amber-700",
  danger:  "bg-orange-100 text-orange-700",
  overdue: "bg-red-100 text-red-700",
};

// OXM brand progress fill: orange gradient, left-capped rounded
const FILL_STYLE = {
  background: "linear-gradient(to right, #fb923c, #ea580c)",
};

type Props = {
  order: OrderDateFields;
  compact?: boolean;
};

export function OrderTimelineBar({ order, compact = false }: Props) {
  const nodes = buildOrderTimelineNodes(order);

  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">尚無日期節點</p>;
  }

  // rawProgress: 0–100 in date space
  const rawProgress = getTimelineProgressPercent(nodes);
  // Map to visual space so fill tip aligns with node positions (same formula)
  const progressVisualPct = rawProgress === 0 ? 0 : 4 + rawProgress * 0.92;

  return compact
    ? <CompactBar nodes={nodes} progressVisualPct={progressVisualPct} />
    : <FullBar nodes={nodes} progressVisualPct={progressVisualPct} />;
}

// ── Compact (list cards) ──────────────────────────────────────────────────────
// Container 56px:
//   gray track + fill  top=12px  h=4px
//   dots               centered on track (top=10px for 8px dot)
//   label              top=22px
//   date MM/DD         top=32px
function CompactBar({
  nodes,
  progressVisualPct,
}: {
  nodes: TimelineNode[];
  progressVisualPct: number;
}) {
  return (
    <div className="relative w-full select-none" style={{ height: "56px" }}>
      {/* Gray track */}
      <div
        className="absolute left-0 right-0 rounded-full bg-gray-200"
        style={{ top: "12px", height: "4px" }}
      />
      {/* OXM orange progress fill */}
      {progressVisualPct > 0 && (
        <div
          className="absolute left-0 rounded-full"
          style={{ top: "12px", height: "4px", width: `${progressVisualPct}%`, ...FILL_STYLE }}
        />
      )}
      {nodes.map(node => (
        <NodePin
          key={node.key}
          node={node}
          compact
          dotTop={10}
          labelTop={22}
          dateTop={32}
          progressVisualPct={progressVisualPct}
        />
      ))}
    </div>
  );
}

// ── Full (detail page) ────────────────────────────────────────────────────────
// Container 76px:
//   gray track + fill  top=16px  h=6px
//   dots               centered on track (top=13px for 12px dot)
//   label (+badge)     top=30px
//   date YYYY/MM/DD    top=46px
function FullBar({
  nodes,
  progressVisualPct,
}: {
  nodes: TimelineNode[];
  progressVisualPct: number;
}) {
  return (
    <div className="relative w-full select-none" style={{ height: "76px" }}>
      {/* Gray track */}
      <div
        className="absolute left-0 right-0 rounded-full bg-gray-200"
        style={{ top: "16px", height: "6px" }}
      />
      {/* OXM orange progress fill */}
      {progressVisualPct > 0 && (
        <div
          className="absolute left-0 rounded-full"
          style={{ top: "16px", height: "6px", width: `${progressVisualPct}%`, ...FILL_STYLE }}
        />
      )}
      {nodes.map(node => (
        <NodePin
          key={node.key}
          node={node}
          compact={false}
          dotTop={13}
          labelTop={30}
          dateTop={46}
          progressVisualPct={progressVisualPct}
        />
      ))}
    </div>
  );
}

// ── NodePin ───────────────────────────────────────────────────────────────────
// isPassed = today has reached or passed this node's date (urgency === "overdue")
// Passed nodes: white ring (sits on the orange fill), slightly muted
// Upcoming nodes: colored ring
function NodePin({
  node,
  compact,
  dotTop,
  labelTop,
  dateTop,
  progressVisualPct,
}: {
  node: TimelineNode;
  compact: boolean;
  dotTop: number;
  labelTop: number;
  dateTop: number;
  progressVisualPct: number;
}) {
  const left = `${node.visualPercent}%`;
  // A node is "reached" if today's fill has passed it
  const isPassed = node.visualPercent <= progressVisualPct;

  const dotSize = compact ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  const dotColor = DOT_CLASS[node.urgency];
  // Passed nodes sit on the orange fill → white ring for contrast
  // Upcoming nodes → transparent ring (subtle)
  const ringClass = isPassed
    ? "ring-2 ring-white"
    : "ring-2 ring-white/60";

  const textClass = TEXT_CLASS[node.urgency];
  const dateStr = compact ? node.dateShort : node.dateText;

  return (
    <>
      {/* Dot */}
      <div
        className={`absolute ${dotSize} rounded-full ${dotColor} ${ringClass}`}
        style={{ left, top: `${dotTop}px`, transform: "translateX(-50%)" }}
      />
      {/* Label (+ badge for full mode) */}
      <div
        className="absolute flex items-center gap-0.5"
        style={{ left, top: `${labelTop}px`, transform: "translateX(-50%)" }}
      >
        <span
          className={`${compact ? "text-[9px]" : "text-[10px]"} font-medium whitespace-nowrap leading-none ${textClass}`}
        >
          {node.label}
        </span>
        {!compact && BADGE_LABEL[node.urgency] && (
          <span className={`text-[8px] px-0.5 rounded font-medium leading-none ${BADGE_CLASS[node.urgency]}`}>
            {BADGE_LABEL[node.urgency]}
          </span>
        )}
      </div>
      {/* Date */}
      <span
        className={`absolute ${compact ? "text-[9px]" : "text-[10px]"} whitespace-nowrap leading-none ${textClass}`}
        style={{ left, top: `${dateTop}px`, transform: "translateX(-50%)" }}
      >
        {dateStr}
      </span>
    </>
  );
}
