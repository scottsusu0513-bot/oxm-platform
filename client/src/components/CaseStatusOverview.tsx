import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * 五種服務案件看板（政府補助／企業財務優化／ISO低碳認證／ERP產線優化／
 * 短影音品牌內容）共用的「狀態統計卡 + 狀態分類 Tab」呈現元件。只負責
 * 統計／篩選 UI，不含任何案件業務邏輯——每個服務仍使用自己在
 * shared/*.ts 定義的 status enum／中文標籤，這裡只接收已經算好的
 * label／count，不在元件內部假設任何特定服務的狀態值。
 *
 * 只維護一個 selectedStatus（"all" 或某個 status key），統計卡與下方
 * Tab 都是同一個 state 的兩種呈現方式，點擊任一邊都會同步。
 */

export type CaseStatusColor =
  | "blue" | "cyan" | "violet" | "amber" | "yellow" | "red" | "rose"
  | "orange" | "green" | "emerald" | "teal" | "slate";

export type CaseStatusDef = { key: string; label: string; color: CaseStatusColor };

const COLOR_CLASSES: Record<CaseStatusColor, string> = {
  blue:    "bg-blue-50 border-blue-100 text-blue-700",
  cyan:    "bg-cyan-50 border-cyan-100 text-cyan-700",
  violet:  "bg-violet-50 border-violet-100 text-violet-700",
  amber:   "bg-amber-50 border-amber-100 text-amber-700",
  yellow:  "bg-yellow-50 border-yellow-100 text-yellow-700",
  red:     "bg-red-50 border-red-100 text-red-700",
  rose:    "bg-rose-50 border-rose-100 text-rose-700",
  orange:  "bg-orange-50 border-orange-100 text-orange-700",
  green:   "bg-green-50 border-green-100 text-green-700",
  emerald: "bg-emerald-50 border-emerald-100 text-emerald-700",
  teal:    "bg-teal-50 border-teal-100 text-teal-700",
  slate:   "bg-slate-50 border-slate-100 text-slate-600",
};

const SELECTED_RING: Record<CaseStatusColor, string> = {
  blue: "ring-blue-300", cyan: "ring-cyan-300", violet: "ring-violet-300",
  amber: "ring-amber-300", yellow: "ring-yellow-300", red: "ring-red-300",
  rose: "ring-rose-300", orange: "ring-orange-300", green: "ring-green-300",
  emerald: "ring-emerald-300", teal: "ring-teal-300", slate: "ring-slate-300",
};

function StatChip({
  label, count, color, selected, onClick,
}: { label: string; count: number; color: CaseStatusColor; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`text-left rounded-xl border p-2.5 transition-shadow min-w-0 ${COLOR_CLASSES[color]} ${selected ? `ring-2 ${SELECTED_RING[color]}` : "hover:shadow-sm"}`}
    >
      <div className="text-xl font-bold leading-none">{count}</div>
      <div className="text-[11px] mt-1 opacity-80 truncate">{label}</div>
    </button>
  );
}

export function CaseStatusOverview({
  statuses, counts, totalCount, selectedStatus, onStatusChange, allLabel = "全部案件",
}: {
  statuses: CaseStatusDef[];
  counts: Record<string, number>;
  totalCount: number;
  selectedStatus: string;
  onStatusChange: (key: string) => void;
  allLabel?: string;
}) {
  return (
    <div className="space-y-3">
      {/* 狀態統計卡：responsive grid，桌機自然換行，不橫向捲動 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        <StatChip
          label={allLabel}
          count={totalCount}
          color="slate"
          selected={selectedStatus === "all"}
          onClick={() => onStatusChange("all")}
        />
        {statuses.map(s => (
          <StatChip
            key={s.key}
            label={s.label}
            count={counts[s.key] ?? 0}
            color={s.color}
            selected={selectedStatus === s.key}
            onClick={() => onStatusChange(s.key)}
          />
        ))}
      </div>

      {/* 狀態分類 Tab：與統計卡共用同一個 selectedStatus，flex-wrap 換行，
          不使用 overflow-x-auto 橫向捲動。 */}
      <Tabs value={selectedStatus} onValueChange={onStatusChange}>
        <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
          <TabsTrigger value="all" className="text-xs whitespace-nowrap">
            {allLabel}
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-background/70 text-muted-foreground min-w-4 h-4 px-1 text-[10px] font-bold">
              {totalCount}
            </span>
          </TabsTrigger>
          {statuses.map(s => (
            <TabsTrigger key={s.key} value={s.key} className="text-xs whitespace-nowrap">
              {s.label}
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-background/70 text-muted-foreground min-w-4 h-4 px-1 text-[10px] font-bold">
                {counts[s.key] ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
