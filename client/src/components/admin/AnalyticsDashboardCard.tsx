import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Activity, ExternalLink, X } from "lucide-react";
import { ANALYTICS_MIN_DATE, taipeiTodayStr, addDaysToDateStr, isAnalyticsDateAllowed } from "@shared/analyticsTz";

type RangeMode = "today" | "yesterday" | "7d" | "custom";
type ClassFilter = "all" | "human" | "bot_suspicious";

/**
 * Admin Dashboard 的「全站流量」compact card（見對話「三、Dashboard 全站流量
 * 卡片重新設計」）。取代原本只有 3 個累計數字＋24 小時柱狀圖的「全站不重複
 * 訪客數」卡片——這裡維持同樣「摘要 → 點擊展開 → 完整頁」三層揭露原則
 * （見對話「UI 三層揭露原則」）：4 個 KPI＋一行異常燈號＋可點擊柱狀圖是
 * 摘要層，點柱子展開的 detail panel 是第二層，「查看流量分析 →」導到
 * /admin/analytics 才是完整第三層，卡片本身高度不會因為展開 panel 而永久
 * 變高太多（panel 用固定高度區塊、可關閉）。
 */
export function AnalyticsDashboardCard() {
  const [, setLocation] = useLocation();
  const today = useMemo(() => taipeiTodayStr(), []);
  const yesterday = useMemo(() => addDaysToDateStr(today, -1), [today]);
  const yesterdayAllowed = isAnalyticsDateAllowed(yesterday);

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customStart, setCustomStart] = useState(ANALYTICS_MIN_DATE);
  const [customEnd, setCustomEnd] = useState(today);
  const [customOpen, setCustomOpen] = useState(false);
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; hour: number | null } | null>(null);

  const { start, end, rangeLabel } = useMemo(() => {
    if (rangeMode === "today") return { start: today, end: today, rangeLabel: "今日" };
    if (rangeMode === "yesterday") {
      if (!yesterdayAllowed) return { start: today, end: today, rangeLabel: "今日" };
      return { start: yesterday, end: yesterday, rangeLabel: "昨日" };
    }
    if (rangeMode === "7d") {
      const rawStart = addDaysToDateStr(today, -6);
      const clampedStart = rawStart < ANALYTICS_MIN_DATE ? ANALYTICS_MIN_DATE : rawStart;
      const label = clampedStart !== rawStart
        ? `上線至今（${clampedStart} ~ ${today}）`
        : `近7天（${clampedStart} ~ ${today}）`;
      return { start: clampedStart, end: today, rangeLabel: label };
    }
    // custom：即使使用者手動打了不合法日期，這裡也先夾一次；後端
    // clampAnalyticsDateRange 是最終防線（即使繞過前端也擋得住）。
    const s = customStart < ANALYTICS_MIN_DATE ? ANALYTICS_MIN_DATE : customStart;
    const e = customEnd > today ? today : customEnd;
    return { start: s, end: e, rangeLabel: `${s} ~ ${e}` };
  }, [rangeMode, today, yesterday, yesterdayAllowed, customStart, customEnd]);

  const dashboardQuery = trpc.analyticsV2.getDashboard.useQuery({ startDate: start, endDate: end, classFilter });
  const d = dashboardQuery.data;
  const trend = d?.trend;
  const anomalyCount = d?.anomalies.count ?? 0;

  const slotDetailQuery = trpc.analyticsV2.getSlotDetail.useQuery(
    selectedSlot ?? { date: today, hour: null },
    { enabled: !!selectedSlot },
  );

  useEffect(() => {
    if (!selectedSlot) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedSlot(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlot]);

  // 換日期範圍／分類篩選就關掉目前展開的 detail panel，避免顯示跟目前查詢
  // 範圍對不上的殘留資料。
  useEffect(() => { setSelectedSlot(null); }, [start, end, classFilter]);

  const maxBucket = trend ? Math.max(...trend.buckets.map(b => b.visitors), 1) : 1;

  function slotFromBucketKey(key: string): { date: string; hour: number | null } {
    if (trend?.mode === "hourly") return { date: start, hour: Number(key) };
    return { date: key, hour: null };
  }

  function onBucketClick(key: string) {
    const next = slotFromBucketKey(key);
    setSelectedSlot(prev => (prev && prev.date === next.date && prev.hour === next.hour) ? null : next);
  }

  const latestAnomaly = d?.anomalies.items[0];

  return (
    <Card className="mb-8">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
            <Activity className="h-4 w-4" />全站流量
          </CardTitle>
          <Button
            variant="link" size="sm" className="h-auto p-0 text-xs gap-1"
            onClick={() => setLocation("/admin/analytics")}
          >
            查看流量分析 → <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* 日期／快速範圍控制 */}
        <div className="flex items-center flex-wrap gap-1.5 mb-3">
          {([
            { key: "today", label: "今日", disabled: false },
            { key: "yesterday", label: "昨日", disabled: !yesterdayAllowed },
            { key: "7d", label: "近7天", disabled: false },
          ] as const).map(opt => (
            <Button
              key={opt.key}
              size="sm"
              variant={rangeMode === opt.key ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              disabled={opt.disabled}
              title={opt.disabled ? `${ANALYTICS_MIN_DATE} 以前尚無 Analytics 2.0 資料` : undefined}
              onClick={() => setRangeMode(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant={rangeMode === "custom" ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => { setRangeMode("custom"); setCustomOpen(true); }}
              >
                自訂日期
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2" align="start">
              <div className="space-y-1">
                <Label className="text-xs">開始日期</Label>
                <Input
                  type="date" value={customStart} min={ANALYTICS_MIN_DATE} max={today}
                  onChange={e => setCustomStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束日期</Label>
                <Input
                  type="date" value={customEnd} min={ANALYTICS_MIN_DATE} max={today}
                  onChange={e => setCustomEnd(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Analytics 2.0 只提供 {ANALYTICS_MIN_DATE} 以後的資料，更早的日期會自動被忽略。
              </p>
              <Button size="sm" className="w-full h-7 text-xs" onClick={() => setCustomOpen(false)}>套用</Button>
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground ml-1">{rangeLabel}</span>
        </div>

        {/* 4 個 KPI */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center">
            <div className="text-xl font-bold">{d?.visitors ?? 0}</div>
            <div className="text-[11px] text-gray-500">訪客</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-600">{d?.humanVisitors ?? 0}</div>
            <div className="text-[11px] text-gray-500">真人訪客</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-amber-600">{d?.botSuspiciousVisitors ?? 0}</div>
            <div className="text-[11px] text-gray-500">Bot・可疑</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold">{d?.pageviews ?? 0}</div>
            <div className="text-[11px] text-gray-500">Pageviews</div>
          </div>
        </div>

        {/* 異常一行指示燈 */}
        <button
          type="button"
          className="w-full text-left text-xs mb-3 flex items-center gap-1.5 disabled:cursor-default"
          disabled={anomalyCount === 0}
          onClick={() => {
            if (latestAnomaly) {
              setSelectedSlot({ date: latestAnomaly.date, hour: latestAnomaly.hour });
            }
          }}
        >
          {anomalyCount === 0 ? (
            <span className="text-green-600">● 流量正常</span>
          ) : (
            <span className="text-orange-600 hover:underline">⚠ 發現異常流量（{anomalyCount} 個時段，點擊查看）</span>
          )}
        </button>

        {/* 流量圖：全部／真人／Bot・可疑 切換 + 可點擊柱狀圖 */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">
            {trend?.mode === "hourly" ? "每小時訪客（點擊查看該時段）" : "每日訪客（點擊查看該日）"}
          </span>
          <div className="flex gap-1">
            {([
              { key: "all", label: "全部" },
              { key: "human", label: "真人" },
              { key: "bot_suspicious", label: "Bot・可疑" },
            ] as const).map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`text-[11px] px-1.5 py-0.5 rounded ${classFilter === opt.key ? "bg-orange-100 text-orange-700" : "text-gray-400 hover:text-gray-600"}`}
                onClick={() => setClassFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {trend && trend.buckets.length > 0 ? (
          <div className="flex items-end gap-0.5 h-12">
            {trend.buckets.map(b => {
              const height = Math.round((b.visitors / maxBucket) * 100);
              const isSelected = selectedSlot != null &&
                ((trend.mode === "hourly" && selectedSlot.hour === Number(b.key) && selectedSlot.date === start) ||
                 (trend.mode === "daily" && selectedSlot.hour === null && selectedSlot.date === b.key));
              return (
                <button
                  key={b.key}
                  type="button"
                  className="flex-1 flex flex-col items-center justify-end h-12 group relative"
                  onClick={() => onBucketClick(b.key)}
                >
                  <div
                    className={`w-full max-w-[10px] rounded-t-sm transition-all ${isSelected ? "bg-orange-600" : "bg-orange-400 group-hover:bg-orange-500"}`}
                    style={{ height: `${height}%`, minHeight: b.visitors > 0 ? 2 : 0 }}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                    {trend.mode === "hourly" ? `${b.key}時` : b.key}: {b.visitors}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="h-12 flex items-center justify-center text-xs text-muted-foreground">尚無資料</div>
        )}

        {/* 點擊柱子展開的 compact detail panel */}
        {selectedSlot && (
          <div className="mt-3 border rounded-md p-3 bg-muted/30 relative">
            <button
              type="button"
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedSlot(null)}
              aria-label="關閉"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <p className="text-xs font-medium mb-2">
              {selectedSlot.date}{selectedSlot.hour != null ? ` ${selectedSlot.hour}時` : "（全日）"}
            </p>
            {slotDetailQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">載入中...</p>
            ) : slotDetailQuery.data ? (
              <div className="space-y-2 text-xs">
                <div className="flex gap-4 flex-wrap">
                  <span>訪客 {slotDetailQuery.data.visitors}</span>
                  <span className="text-green-600">真人 {slotDetailQuery.data.human}</span>
                  <span className="text-amber-600">已知 Bot {slotDetailQuery.data.knownBot}</span>
                  <span className="text-orange-600">可疑 {slotDetailQuery.data.suspicious}</span>
                  <span>Pageviews {slotDetailQuery.data.pageviews}</span>
                </div>
                {slotDetailQuery.data.topSources.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">主要來源：</span>
                    {slotDetailQuery.data.topSources.map(s => `${s.source}(${s.count})`).join("、")}
                  </div>
                )}
                {slotDetailQuery.data.topPaths.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">熱門頁面：</span>
                    {slotDetailQuery.data.topPaths.slice(0, 5).map(p => `${p.pathname}(${p.count})`).join("、")}
                  </div>
                )}
                {slotDetailQuery.data.topKeywords.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">熱門搜尋：</span>
                    {slotDetailQuery.data.topKeywords.slice(0, 5).map(k => `${k.keyword}(${k.count})`).join("、")}
                  </div>
                )}
                <Button
                  variant="link" size="sm" className="h-auto p-0 text-xs"
                  onClick={() => setLocation("/admin/analytics")}
                >
                  查看完整分析 →
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">無資料</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
