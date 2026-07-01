export type Urgency = "normal" | "warning" | "danger" | "overdue";

export type TimelineNode = {
  key: string;
  label: string;
  date: string;         // YYYY-MM-DD
  dateText: string;     // YYYY/MM/DD
  dateShort: string;    // MM/DD
  urgency: Urgency;
  positionPercent: number; // 0–100, date-proportion
  visualPercent: number;   // 4–96, for CSS left
};

export type OrderDateFields = {
  depositDueDate?: string | null;
  productionStartDate?: string | null;
  expectedCompletionDate?: string | null;
  expectedShipmentDate?: string | null;
  finalPaymentDueDate?: string | null;
};

const FIELD_DEFS = [
  { key: "depositDueDate",         label: "首款" },
  { key: "productionStartDate",    label: "開始" },
  { key: "expectedCompletionDate", label: "完工" },
  { key: "expectedShipmentDate",   label: "出貨" },
  { key: "finalPaymentDueDate",    label: "尾款" },
] as const;

export function getTimelineNodeUrgency(dateStr: string | null | undefined): Urgency {
  if (!dateStr) return "normal";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((target.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= 1) return "danger";
  if (diff <= 3) return "warning";
  return "normal";
}

export function buildOrderTimelineNodes(order: OrderDateFields): TimelineNode[] {
  const raw: Array<{ key: string; label: string; date: string }> = [];
  for (const f of FIELD_DEFS) {
    const d = (order as Record<string, string | null | undefined>)[f.key];
    if (d) raw.push({ key: f.key, label: f.label, date: d });
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a.date.localeCompare(b.date));

  const times = raw.map(r => new Date(r.date + "T00:00:00").getTime());
  const minDate = Math.min(...times);
  const maxDate = Math.max(...times);
  const range = maxDate - minDate;

  return raw.map(r => {
    const t = new Date(r.date + "T00:00:00").getTime();
    const positionPercent = range === 0 ? 50 : ((t - minDate) / range) * 100;
    const clamped = Math.min(100, Math.max(0, positionPercent));
    const visualPercent = 4 + clamped * 0.92;
    const [y, m, d] = r.date.split("-");
    return {
      key: r.key,
      label: r.label,
      date: r.date,
      dateText: `${y}/${m}/${d}`,
      dateShort: `${m}/${d}`,
      urgency: getTimelineNodeUrgency(r.date),
      positionPercent: clamped,
      visualPercent,
    };
  });
}

/**
 * Returns how far "today" has advanced through the node range (0–100).
 * Uses the same date-space-to-visual-space mapping as node positions:
 *   visualPercent = 4 + progressPercent * 0.92
 * so the fill tip aligns with "today's" position on the visual bar.
 *
 * Returns 0 if today <= minDate, 100 if today >= maxDate.
 */
export function getTimelineProgressPercent(nodes: TimelineNode[]): number {
  if (nodes.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  if (nodes.length === 1) {
    const t = new Date(nodes[0].date + "T00:00:00").getTime();
    return todayTime >= t ? 100 : 0;
  }

  const times = nodes.map(n => new Date(n.date + "T00:00:00").getTime());
  const minDate = Math.min(...times);
  const maxDate = Math.max(...times);

  if (todayTime <= minDate) return 0;
  if (todayTime >= maxDate) return 100;
  return ((todayTime - minDate) / (maxDate - minDate)) * 100;
}
