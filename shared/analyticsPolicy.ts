/** Internal routes never contribute to external visitor analytics. */
export function isExcludedAnalyticsPath(pathname?: string): boolean {
  return !!pathname && /^\/(?:admin|api)(?:\/|$)/.test(pathname.split(/[?#]/)[0]);
}

export function analyticsRiskLabel(classification: string, score: number): string {
  if (classification === "known_bot") return "已知 Bot（UA 命中）";
  if (classification !== "suspicious") return "正常";
  return score >= 80 ? "高風險" : score >= 60 ? "中風險" : "低風險";
}

const SIGNAL_LABELS: Record<string, string> = {
  AUTOMATION_UA: "自動化工具特徵",
  HIGH_NEW_VISITOR_RATE: "同 IP 五分鐘超過 20 個訪客 ID",
  SEARCH_RATE_SPIKE: "同 IP 一分鐘大量搜尋",
  FIXED_INTERVAL_REQUESTS: "固定間隔請求",
  MOSTLY_SINGLE_EVENT_SESSIONS: "大量單一事件造訪",
  REPEATED_QUERY: "短時間重複搜尋相同關鍵字",
  FACTORY_ENUMERATION: "依序掃描工廠頁面",
  CLOUD_ASN: "雲端資料中心網路",
};
export function analyticsSignalLabel(signal: string): string {
  return SIGNAL_LABELS[signal] ?? signal;
}
