import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Sparkles } from "lucide-react";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { getAiUsageLayerLabel } from "@shared/ai/aiUsageLayerLabels";

/**
 * Phase 9.2（見對話中「AI 管理」）：OXM AI 營運監控後台第一版。
 *
 * 明確排除範圍（見對話中「不要碰」）：不顯示 prompt／assistant 回覆／
 * memory／Handoff 表單內容，不做「查看對話」功能——只顯示 metadata（見
 * server/ai/aiUsageAudit.ts 的說明）。這裡不引入新的視覺風格，沿用既有
 * Admin 頁面（如 UsersList.tsx）的 Card／table／pagination 慣例。
 */

const COMPACT_FORMATTER = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
function compactNumber(n: number): string {
  return COMPACT_FORMATTER.format(n);
}

/**
 * 見對話中「四十」實測發現的真實 bug：這裡收到的 iso 字串已經是伺服器端
 * 修正過的真正 UTC（見 server/ai/aiUsageAudit.ts 的 toTrueUtcIso 說明）。
 * 顯示時明確指定 timeZone: "Asia/Taipei"，不依賴瀏覽器本地時區——即使
 * 管理員從其他時區開這個頁面，顯示的仍然是台灣時間（跟頁首「資料日期
 * （台灣時間）」一致），不會因為瀏覽器本地時區不是台灣而顯示錯誤時間。
 */
function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  provider_error: "Provider 錯誤",
  timeout: "逾時",
  invalid_response: "回應格式錯誤",
  rate_limit: "速率限制",
  auth_error: "驗證錯誤",
  provider_server_error: "Provider 伺服器錯誤",
  empty_reply: "空回應",
  unknown_error: "其他",
  other: "其他",
};

export default function AdminAiManagement() {
  const { user, loading: authLoading } = useAuth();
  const [recentPage, setRecentPage] = useState(1);
  const isAdmin = user?.role === "admin";

  const dashboardQuery = trpc.admin.aiUsage.dashboard.useQuery(undefined, { enabled: isAdmin });
  const recentTurnsQuery = trpc.admin.aiUsage.recentTurns.useQuery(
    { page: recentPage, pageSize: 20 },
    { enabled: isAdmin }
  );

  if (authLoading) return <AppLoading />;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  const d = dashboardQuery.data;
  const s = d?.summary;
  const failureRate = s && s.modelCalls > 0 ? (s.modelCallFailures / s.modelCalls) * 100 : 0;

  function refresh() {
    void dashboardQuery.refetch();
    void recentTurnsQuery.refetch();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-4 pb-4 md:px-8 md:pb-8 admin-page-top">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-2">
          <FloatingBackButton fallbackHref="/admin" noNavbar />
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-orange-600" />
            <h1 className="text-3xl font-bold text-gray-900">AI 管理</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              資料日期：{d?.quotaDate ?? "-"}（台灣時間）
            </span>
            <Button variant="outline" size="sm" onClick={refresh} disabled={dashboardQuery.isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${dashboardQuery.isFetching ? "animate-spin" : ""}`} />
              重新整理
            </Button>
          </div>
        </div>

        {dashboardQuery.isError ? (
          <Card className="mb-6 border-red-200">
            <CardContent className="pt-6 text-red-600">
              AI 使用資料載入失敗，請重新整理。
            </CardContent>
          </Card>
        ) : dashboardQuery.isLoading ? (
          <div className="text-center py-8 text-gray-500">載入中...</div>
        ) : (
          <>
            {/* 第一區：6 張 KPI 卡 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">今日使用工廠</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* 見對話中「今日使用工廠」：故意用 d.factories.length（跟下方
                      工廠表格同一份「真的扣過額度」定義），不是
                      summary.uniqueFactories（那個包含 admin 自己工廠的
                      bypass turn，會跟工廠表格顯示「今天尚無工廠使用」互相
                      矛盾——這是實測時發現的真實不一致，已修正）。 */}
                  <div className="text-2xl font-bold">{d?.factories.length ?? 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">今日 AI 對話</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{s?.totalTurns ?? 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Model Calls</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{compactNumber(s?.modelCalls ?? 0)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Total Tokens</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{compactNumber(s?.totalTokens ?? 0)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">失敗率</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${failureRate > 0 ? "text-orange-600" : ""}`}>
                    {failureRate.toFixed(1)}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Quota 狀態</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${d && d.counterMismatchCount > 0 ? "text-red-600" : "text-green-600"}`}>
                    {d && d.counterMismatchCount > 0 ? `${d.counterMismatchCount} 筆異常` : "正常"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Admin / internal 用量標註（見對話中「三十三」）：避免測試成本被誤認成工廠用量 */}
            {s && (s.adminNoFactoryTurns > 0 || s.adminWithFactoryBypassTurns > 0) && (
              <p className="text-xs text-gray-500 mb-6">
                其中 Admin / internal：{s.adminNoFactoryTurns + s.adminWithFactoryBypassTurns} turns
                （無工廠語境 {s.adminNoFactoryTurns} ／ 有工廠但 bypass {s.adminWithFactoryBypassTurns}），不計入工廠額度。
              </p>
            )}

            {/* 第二區：今日工廠使用 */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>今日工廠使用</CardTitle>
                <CardDescription>只列今天實際有使用 AI 的工廠</CardDescription>
              </CardHeader>
              <CardContent>
                {!d || d.factories.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">今天尚無工廠使用 OXM AI</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">工廠</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">今日使用</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap min-w-[140px]">額度</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">使用帳號數</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">Model Calls</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">Tokens</th>
                          <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">最後使用</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.factories.map(f => {
                          const pct = (f.usedTurns / f.limit) * 100;
                          const level = f.usedTurns >= f.limit ? "額度已滿" : f.usedTurns >= 16 ? "接近額度" : "正常";
                          const levelColor = f.usedTurns >= f.limit ? "text-red-600" : f.usedTurns >= 16 ? "text-orange-600" : "text-gray-500";
                          return (
                            <tr key={f.factoryId} className="border-b hover:bg-gray-50 align-middle">
                              <td className="py-3 px-4 align-middle whitespace-nowrap font-medium">{f.factoryName}</td>
                              <td className="py-3 px-4 align-middle whitespace-nowrap">{f.usedTurns} / {f.limit}</td>
                              <td className="py-3 px-4 align-middle min-w-[140px]">
                                <div className="flex items-center gap-2">
                                  <Progress value={Math.min(100, pct)} className="w-16 h-2" />
                                  <span className={`text-xs whitespace-nowrap ${levelColor}`}>剩 {f.remaining}（{level}）</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 align-middle">{f.actorsCount}</td>
                              <td className="py-3 px-4 align-middle">{compactNumber(f.modelCalls)}</td>
                              <td className="py-3 px-4 align-middle">{compactNumber(f.totalTokens)}</td>
                              <td className="py-3 px-4 align-middle whitespace-nowrap text-gray-600">{formatDateTime(f.lastUsedAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 第三區：Model / Layer 使用 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle>Model 使用</CardTitle>
                </CardHeader>
                <CardContent>
                  {!d || d.byModel.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 text-sm">今天尚無資料</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b">
                          <tr>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">名稱</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Calls</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Input</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Output</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Total</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">失敗</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.byModel.map(m => (
                            <tr key={m.key} className="border-b align-middle">
                              <td className="py-2 px-2 align-middle font-mono text-xs whitespace-nowrap">{m.key}</td>
                              <td className="py-2 px-2 align-middle">{m.modelCalls}</td>
                              <td className="py-2 px-2 align-middle">{compactNumber(m.inputTokens)}</td>
                              <td className="py-2 px-2 align-middle">{compactNumber(m.outputTokens)}</td>
                              <td className="py-2 px-2 align-middle">{compactNumber(m.totalTokens)}</td>
                              <td className="py-2 px-2 align-middle">{m.failures}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Layer 使用</CardTitle>
                </CardHeader>
                <CardContent>
                  {!d || d.byLayer.length === 0 ? (
                    <div className="text-center py-6 text-gray-500 text-sm">今天尚無資料</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b">
                          <tr>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">功能</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Calls</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">Tokens</th>
                            <th className="text-left py-2 px-2 font-semibold whitespace-nowrap">失敗</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.byLayer.map(l => (
                            <tr key={l.key} className="border-b align-middle">
                              <td className="py-2 px-2 align-middle whitespace-nowrap">{getAiUsageLayerLabel(l.key)}</td>
                              <td className="py-2 px-2 align-middle">{l.modelCalls}</td>
                              <td className="py-2 px-2 align-middle">{compactNumber(l.totalTokens)}</td>
                              <td className="py-2 px-2 align-middle">{l.failures}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 第四區：失敗與額度記帳 */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle>失敗</CardTitle>
                  <CardDescription>
                    失敗 turns {s?.failedTurns ?? 0}／失敗 model calls {s?.modelCallFailures ?? 0}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!d || d.byErrorCategory.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 text-sm">今天沒有失敗紀錄</div>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.byErrorCategory.map(e => (
                        <li key={e.errorCategory} className="flex justify-between">
                          <span>{ERROR_CATEGORY_LABELS[e.errorCategory] ?? e.errorCategory}</span>
                          <span className="font-medium">{e.calls}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>額度記帳狀態</CardTitle>
                </CardHeader>
                <CardContent>
                  {!d || d.counterMismatchCount === 0 ? (
                    <p className="text-sm text-green-600">✓ 額度記帳正常</p>
                  ) : (
                    <p className="text-sm text-red-600 font-medium">
                      ⚠ 發現 {d.counterMismatchCount} 筆額度記帳差異，建議進一步檢查
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>卡住中的 AI Turn</CardTitle>
                  <CardDescription>
                    超過 {d?.staleStartedTurns.thresholdMinutes ?? 10} 分鐘仍未完成
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Phase 10.2 P1（見「十三、十四」）：純偵測，不提供自動修復——
                      正常一輪 AI turn 從建立到收尾都在同一次 request 內同步完成，
                      long-stuck 在 started 代表 server process 中途死掉或真的卡住，
                      需要人工判斷，不能自動 fail／退款／刪除。 */}
                  {!d || d.staleStartedTurns.count === 0 ? (
                    <p className="text-sm text-green-600">✓ 沒有卡住的 turn</p>
                  ) : (
                    <p className="text-sm text-red-600 font-medium">
                      ⚠ {d.staleStartedTurns.count} 筆卡在進行中超過 {d.staleStartedTurns.thresholdMinutes} 分鐘
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>永久失敗的收尾摘要</CardTitle>
                  <CardDescription>已達重試上限，原文仍保留</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Phase 11.2（見「二十二、二十三」）：收尾摘要持續失敗達到
                      MAX_SUMMARY_RETRY_COUNT 後不再自動重試，但原文不會被刪除
                      ——這裡純粹讓這類 governance 案件不會完全 invisible，不
                      提供自動修復或刪除。 */}
                  {!d || d.permanentlyFailedSummaryCount === 0 ? (
                    <p className="text-sm text-green-600">✓ 沒有永久失敗的摘要</p>
                  ) : (
                    <p className="text-sm text-red-600 font-medium">
                      ⚠ {d.permanentlyFailedSummaryCount} 筆已達重試上限，需要人工檢查
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* 第五區：Recent Turns */}
        <Card>
          <CardHeader>
            <CardTitle>最近 AI 使用紀錄</CardTitle>
            <CardDescription>只顯示 metadata，不含對話內容</CardDescription>
          </CardHeader>
          <CardContent>
            {recentTurnsQuery.isError ? (
              <div className="text-center py-8 text-red-600">AI 使用資料載入失敗，請重新整理。</div>
            ) : recentTurnsQuery.isLoading ? (
              <div className="text-center py-8 text-gray-500">載入中...</div>
            ) : !recentTurnsQuery.data || recentTurnsQuery.data.items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">今天尚無 AI 使用紀錄</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">時間</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">工廠</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">帳號</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">功能</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">狀態</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">扣額度</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">Model Calls</th>
                      <th className="text-left py-3 px-4 font-semibold whitespace-nowrap">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTurnsQuery.data.items.map(t => (
                      <tr key={t.turnId} className="border-b hover:bg-gray-50 align-middle">
                        <td className="py-3 px-4 align-middle whitespace-nowrap text-gray-600">{formatDateTime(t.createdAt)}</td>
                        <td className="py-3 px-4 align-middle whitespace-nowrap">{t.factoryName ?? "Admin / 無工廠"}</td>
                        <td className="py-3 px-4 align-middle whitespace-nowrap">{t.actorName ?? `#${t.actorUserId}`}</td>
                        <td className="py-3 px-4 align-middle whitespace-nowrap">{t.resourceTarget ?? t.intent ?? "-"}</td>
                        <td className="py-3 px-4 align-middle whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            t.status === "completed" ? "bg-green-100 text-green-700" :
                            t.status === "failed" ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>
                            {t.status === "completed" ? "完成" : t.status === "failed" ? "失敗" : "進行中"}
                          </span>
                        </td>
                        <td className="py-3 px-4 align-middle">{t.quotaCharged ? "是" : "否"}</td>
                        <td className="py-3 px-4 align-middle">{t.modelCalls}</td>
                        <td className="py-3 px-4 align-middle">{compactNumber(t.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {recentTurnsQuery.data && recentTurnsQuery.data.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <Button variant="outline" size="sm" onClick={() => setRecentPage(p => Math.max(1, p - 1))} disabled={recentPage === 1}>
                  上一頁
                </Button>
                <span className="text-sm text-gray-600 flex items-center px-2">
                  {recentPage} / {recentTurnsQuery.data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecentPage(p => Math.min(recentTurnsQuery.data!.totalPages, p + 1))}
                  disabled={recentPage === recentTurnsQuery.data.totalPages}
                >
                  下一頁
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
