import { CheckCircle2, Circle } from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:    { label: "已寄出",  color: "text-gray-500" },
  received:   { label: "已收到",  color: "text-blue-500" },
  reviewing:  { label: "審查中",  color: "text-yellow-500" },
  processing: { label: "處理中",  color: "text-orange-500" },
  resolved:   { label: "已處理",  color: "text-green-500" },
};

type HistoryItem = {
  id: number;
  status: string;
  adminNote?: string | null;
  createdAt: Date | string;
};

export function StatusTimeline({ history, isLoading }: { history: HistoryItem[] | undefined; isLoading: boolean }) {
  if (isLoading) return <div className="text-xs text-muted-foreground py-2">載入中...</div>;
  if (!history || history.length === 0) return <div className="text-xs text-muted-foreground py-2">尚無進度紀錄</div>;

  return (
    <div className="relative pl-5 space-y-3 mt-2">
      {/* 左側垂直線 */}
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />

      {history.map((h, i) => {
        const s = STATUS_LABELS[h.status] ?? STATUS_LABELS.pending;
        const isLast = i === history.length - 1;
        const dt = new Date(h.createdAt);
        const dateStr = dt.toLocaleDateString("zh-TW");
        const timeStr = dt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });

        return (
          <div key={h.id} className="relative flex gap-3">
            {/* 圓點 */}
            <div className="absolute -left-5 mt-0.5">
              {isLast ? (
                <CheckCircle2 className={`w-3.5 h-3.5 bg-white ${s.color}`} />
              ) : (
                <Circle className="w-3.5 h-3.5 text-muted-foreground/40 bg-white" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
                <span className="text-xs text-muted-foreground">{dateStr} {timeStr}</span>
              </div>
              {h.adminNote && (
                <p className="text-xs text-muted-foreground mt-0.5 italic">{h.adminNote}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
