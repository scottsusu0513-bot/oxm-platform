import {
  buildOrderTimelineNodes,
  getTimelineBarGradient,
  type OrderDateFields,
  type TimelineNode,
  type Urgency,
} from "@/lib/orderTimeline";

const DOT_CLASS: Record<Urgency, string> = {
  normal:  "bg-blue-400",
  warning: "bg-amber-400",
  danger:  "bg-orange-500",
  overdue: "bg-red-500",
};

const RING_CLASS: Record<Urgency, string> = {
  normal:  "ring-blue-200",
  warning: "ring-amber-200",
  danger:  "ring-orange-300",
  overdue: "ring-red-300",
};

const TEXT_CLASS: Record<Urgency, string> = {
  normal:  "text-blue-600",
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

type Props = {
  order: OrderDateFields;
  compact?: boolean;
};

export function OrderTimelineBar({ order, compact = false }: Props) {
  const nodes = buildOrderTimelineNodes(order);

  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">尚無日期節點</p>;
  }

  const gradient = getTimelineBarGradient(nodes);
  return compact
    ? <CompactBar nodes={nodes} gradient={gradient} />
    : <FullBar nodes={nodes} gradient={gradient} />;
}

// ── Compact (list card) ───────────────────────────────────────────────────────
// Layout (top-down within 60px container):
//  [bar + dot]  top=12px, 4px bar, dot centered at 14px
//  [label]      top=22px
//  [date MM/DD] top=32px
function CompactBar({ nodes, gradient }: { nodes: TimelineNode[]; gradient: string }) {
  return (
    <div className="relative w-full" style={{ height: "56px" }}>
      <div
        className="absolute left-0 right-0 rounded-full"
        style={{ top: "12px", height: "4px", background: gradient }}
      />
      {nodes.map(node => (
        <NodePin
          key={node.key}
          node={node}
          compact
          dotTop={10}
          labelTop={22}
          dateTop={32}
        />
      ))}
    </div>
  );
}

// ── Full (detail page) ────────────────────────────────────────────────────────
// Layout (top-down within 72px container):
//  [bar + dot]        top=16px, 6px bar, dot centered at 19px
//  [label + badge]    top=30px
//  [full date]        top=44px
function FullBar({ nodes, gradient }: { nodes: TimelineNode[]; gradient: string }) {
  return (
    <div className="relative w-full" style={{ height: "72px" }}>
      <div
        className="absolute left-0 right-0 rounded-full"
        style={{ top: "16px", height: "6px", background: gradient }}
      />
      {nodes.map(node => (
        <NodePin
          key={node.key}
          node={node}
          compact={false}
          dotTop={13}
          labelTop={30}
          dateTop={44}
        />
      ))}
    </div>
  );
}

function NodePin({
  node,
  compact,
  dotTop,
  labelTop,
  dateTop,
}: {
  node: TimelineNode;
  compact: boolean;
  dotTop: number;
  labelTop: number;
  dateTop: number;
}) {
  const left = `${node.visualPercent}%`;
  const textClass = node.urgency !== "normal" ? TEXT_CLASS[node.urgency] : "text-muted-foreground";
  const dotSize = compact ? "w-2 h-2" : "w-3 h-3";
  const dateStr = compact ? node.dateShort : node.dateText;

  return (
    <>
      {/* Dot */}
      <div
        className={`absolute ${dotSize} rounded-full ${DOT_CLASS[node.urgency]} ring-1 ${RING_CLASS[node.urgency]}`}
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
