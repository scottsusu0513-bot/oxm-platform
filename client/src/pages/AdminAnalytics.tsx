import { useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ANALYTICS_MIN_DATE, taipeiTodayStr, addDaysToDateStr } from "@shared/analyticsTz";

type RangeMode = "today" | "yesterday" | "7d" | "30d" | "custom";

const SOURCE_LABELS: Record<string, string> = {
  direct: "直接流量", app: "App", google_organic: "Google 自然搜尋", bing_organic: "Bing 自然搜尋",
  threads: "Threads", facebook: "Facebook", instagram: "Instagram", line: "LINE",
  chatgpt: "ChatGPT", perplexity: "Perplexity", other_referral: "其他外部連結", unknown: "未知",
};

const CLASSIFICATION_BADGE: Record<string, { label: string; className: string }> = {
  human: { label: "真人", className: "bg-green-100 text-green-700" },
  known_bot: { label: "已知 Bot", className: "bg-blue-100 text-blue-700" },
  suspicious: { label: "可疑", className: "bg-orange-100 text-orange-700" },
};

function SimpleBarList({ items, labelFn }: { items: { label: string; count: number }[]; labelFn?: (label: string) => string }) {
  const max = Math.max(...items.map(i => i.count), 1);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">尚無資料</p>;
  return (
    <div className="space-y-1.5">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-2 text-sm">
          <span className="w-32 shrink-0 truncate" title={item.label}>{labelFn ? labelFn(item.label) : item.label}</span>
          <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
            <div className="h-full bg-orange-400" style={{ width: `${Math.round((item.count / max) * 100)}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-muted-foreground">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalytics() {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (!user || user.role !== "admin") return <div className="flex items-center justify-center min-h-screen text-muted-foreground">無權限</div>;
  return <AdminAnalyticsContent />;
}

function AdminAnalyticsContent() {
  const today = useMemo(() => taipeiTodayStr(), []);
  const [rangeMode, setRangeMode] = useState<RangeMode>("7d");
  const [customStart, setCustomStart] = useState(ANALYTICS_MIN_DATE);
  const [customEnd, setCustomEnd] = useState(today);
  const [customOpen, setCustomOpen] = useState(false);

  const { start, end, rangeLabel } = useMemo(() => {
    if (rangeMode === "today") return { start: today, end: today, rangeLabel: "今日" };
    if (rangeMode === "yesterday") {
      const y = addDaysToDateStr(today, -1);
      return { start: y, end: y, rangeLabel: "昨日" };
    }
    if (rangeMode === "7d" || rangeMode === "30d") {
      const days = rangeMode === "7d" ? 6 : 29;
      const rawStart = addDaysToDateStr(today, -days);
      const clampedStart = rawStart < ANALYTICS_MIN_DATE ? ANALYTICS_MIN_DATE : rawStart;
      const label = clampedStart !== rawStart ? `上線至今（${clampedStart} ~ ${today}）` : `${clampedStart} ~ ${today}`;
      return { start: clampedStart, end: today, rangeLabel: label };
    }
    const s = customStart < ANALYTICS_MIN_DATE ? ANALYTICS_MIN_DATE : customStart;
    const e = customEnd > today ? today : customEnd;
    return { start: s, end: e, rangeLabel: `${s} ~ ${e}` };
  }, [rangeMode, today, customStart, customEnd]);

  const reportQuery = trpc.analyticsV2.getFullReport.useQuery({ startDate: start, endDate: end });
  const r = reportQuery.data;
  const maxBucket = r ? Math.max(...r.trend.buckets.map(b => b.visitors), 1) : 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <FloatingBackButton fallbackHref="/admin" noNavbar />
          <h1 className="text-3xl font-bold text-gray-900">流量分析</h1>
          <div className="text-sm text-gray-600">{rangeLabel}</div>
        </div>

        {/* 日期範圍控制 */}
        <div className="flex items-center flex-wrap gap-1.5 mb-6">
          {([
            { key: "today", label: "今日" },
            { key: "yesterday", label: "昨日" },
            { key: "7d", label: "近7天" },
            { key: "30d", label: "近30天" },
          ] as const).map(opt => (
            <Button
              key={opt.key} size="sm" variant={rangeMode === opt.key ? "default" : "outline"}
              onClick={() => setRangeMode(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm" variant={rangeMode === "custom" ? "default" : "outline"}
                onClick={() => { setRangeMode("custom"); setCustomOpen(true); }}
              >
                自訂日期
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2" align="start">
              <div className="space-y-1">
                <Label className="text-xs">開始日期</Label>
                <Input type="date" value={customStart} min={ANALYTICS_MIN_DATE} max={today} onChange={e => setCustomStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束日期</Label>
                <Input type="date" value={customEnd} min={ANALYTICS_MIN_DATE} max={today} onChange={e => setCustomEnd(e.target.value)} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Analytics 2.0 只提供 {ANALYTICS_MIN_DATE} 以後的資料，更早的日期會自動被忽略。
              </p>
              <Button size="sm" className="w-full h-7 text-xs" onClick={() => setCustomOpen(false)}>套用</Button>
            </PopoverContent>
          </Popover>
        </div>

        {reportQuery.isLoading || !r ? (
          <p className="text-muted-foreground">載入中...</p>
        ) : (
          <div className="space-y-6">
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { label: "訪客", value: r.kpi.visitors },
                { label: "真人訪客", value: r.kpi.humanVisitors },
                { label: "Bot・可疑", value: r.kpi.botSuspiciousVisitors },
                { label: "Sessions", value: r.sessions },
                { label: "Pageviews", value: r.kpi.pageviews },
                { label: "異常事件", value: r.anomalies.length },
              ].map(kpi => (
                <Card key={kpi.label}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-xl font-bold">{kpi.value}</div>
                    <div className="text-xs text-gray-500">{kpi.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 時間趨勢 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {r.trend.mode === "hourly" ? "每小時訪客趨勢" : "每日訪客趨勢"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {r.trend.buckets.length > 0 ? (
                  <div className="flex items-end gap-1 h-24">
                    {r.trend.buckets.map(b => (
                      <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-24 group relative">
                        <div
                          className="w-full max-w-[18px] bg-orange-400 group-hover:bg-orange-500 rounded-t-sm transition-all"
                          style={{ height: `${Math.round((b.visitors / maxBucket) * 100)}%`, minHeight: b.visitors > 0 ? 2 : 0 }}
                        />
                        <span className="text-[10px] text-gray-400 mt-1">{r.trend.mode === "hourly" ? b.key : b.key.slice(5)}</span>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                          {b.visitors}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">尚無資料</p>}
              </CardContent>
            </Card>

            {/* 異常事件 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">異常事件</CardTitle>
                <CardDescription>保守多訊號判定（見系統設計）：只有同時符合多個訊號才會列在這裡，流量單純變多不會觸發。</CardDescription>
              </CardHeader>
              <CardContent>
                {r.anomalies.length === 0 ? (
                  <p className="text-sm text-green-600">● 此範圍內未偵測到異常流量</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead><TableHead>時段</TableHead><TableHead>類型</TableHead>
                        <TableHead>嚴重度</TableHead><TableHead>訊號</TableHead><TableHead>處置</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.anomalies.map(a => (
                        <TableRow key={a.id}>
                          <TableCell>{a.date}</TableCell>
                          <TableCell>{a.hour != null ? `${a.hour}時` : "全日"}</TableCell>
                          <TableCell>{a.eventType}</TableCell>
                          <TableCell>
                            <Badge variant={a.severity === "high" ? "destructive" : "secondary"}>{a.severity ?? "-"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{Array.isArray(a.signals) ? a.signals.join("、") : ""}</TableCell>
                          <TableCell className="text-xs">{a.actionTaken ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">流量來源</CardTitle></CardHeader>
                <CardContent>
                  <SimpleBarList
                    items={r.sources.map(s => ({ label: s.source, count: s.count }))}
                    labelFn={l => SOURCE_LABELS[l] ?? l}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Referrer（前 20）</CardTitle></CardHeader>
                <CardContent>
                  <SimpleBarList items={r.referrerHosts.map(h => ({ label: h.host, count: h.count }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">UTM 活動（前 20）</CardTitle></CardHeader>
                <CardContent>
                  {r.utmCampaigns.length === 0 ? <p className="text-sm text-muted-foreground">尚無資料</p> : (
                    <div className="space-y-1 text-sm">
                      {r.utmCampaigns.map((u, i) => (
                        <div key={i} className="flex justify-between border-b pb-1">
                          <span className="truncate">{u.source} / {u.medium ?? "-"} / {u.campaign ?? "-"}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">{u.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Landing Pages（前 20）</CardTitle></CardHeader>
                <CardContent>
                  <SimpleBarList items={r.landingPages.map(l => ({ label: l.pathname, count: l.count }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">頁面瀏覽路徑（前 30）</CardTitle></CardHeader>
                <CardContent>
                  <SimpleBarList items={r.topPaths.map(p => ({ label: p.pathname, count: p.count }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">熱門工廠頁（前 20，僅計實際進站，不含搜尋結果卡片曝光）</CardTitle></CardHeader>
                <CardContent>
                  {r.topFactories.length === 0 ? <p className="text-sm text-muted-foreground">尚無資料</p> : (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>工廠</TableHead><TableHead className="text-right">瀏覽數</TableHead><TableHead className="text-right">不重複訪客</TableHead><TableHead className="text-right">真人</TableHead><TableHead className="text-right">Bot・可疑</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.topFactories.map(f => (
                          <TableRow key={f.factoryId}>
                            <TableCell>{f.factoryName}</TableCell>
                            <TableCell className="text-right">{f.views}</TableCell>
                            <TableCell className="text-right">{f.uniqueVisitors}</TableCell>
                            <TableCell className="text-right text-green-600">{f.human}</TableCell>
                            <TableCell className="text-right text-orange-600">{f.botSuspicious}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">熱門搜尋（前 30）</CardTitle></CardHeader>
              <CardContent>
                {r.topSearches.length === 0 ? <p className="text-sm text-muted-foreground">尚無資料</p> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>關鍵字</TableHead><TableHead className="text-right">次數</TableHead>
                        <TableHead className="text-right">不重複訪客</TableHead><TableHead className="text-right">平均結果數</TableHead>
                        <TableHead className="text-right">AI 搜尋</TableHead><TableHead className="text-right">真人</TableHead><TableHead className="text-right">Bot・可疑</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.topSearches.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{s.keyword}</TableCell>
                          <TableCell className="text-right">{s.count}</TableCell>
                          <TableCell className="text-right">{s.uniqueVisitors}</TableCell>
                          <TableCell className="text-right">{s.avgResults != null ? s.avgResults.toFixed(1) : "-"}</TableCell>
                          <TableCell className="text-right">{s.aiCount}</TableCell>
                          <TableCell className="text-right text-green-600">{s.human}</TableCell>
                          <TableCell className="text-right text-orange-600">{s.botSuspicious}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">裝置</CardTitle></CardHeader>
                <CardContent><SimpleBarList items={r.devices.map(d => ({ label: d.value, count: d.count }))} /></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">瀏覽器</CardTitle></CardHeader>
                <CardContent><SimpleBarList items={r.browsers.map(b => ({ label: b.value, count: b.count }))} /></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">作業系統</CardTitle></CardHeader>
                <CardContent><SimpleBarList items={r.oses.map(o => ({ label: o.value, count: o.count }))} /></CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">國家／地區・ASN</CardTitle>
                <CardDescription>目前尚未串接 GeoIP 資料來源，未使用未經確認的付費服務，暫不提供此區塊資料。</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">尚未提供</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
