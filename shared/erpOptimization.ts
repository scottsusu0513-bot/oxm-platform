/**
 * ERP 與產線優化專區共用常數。needType 為單選（不是複選），"unsure" 本身
 * 就是列舉值之一，語意天生互斥，不需要另外的 isUnsure 布林欄位。
 */

export const ERP_NEED_TYPE_KEYS = ["erp_adoption", "line_optimization", "integrated", "unsure"] as const;
export type ErpNeedTypeKey = (typeof ERP_NEED_TYPE_KEYS)[number];

export const ERP_NEED_TYPES: { key: ErpNeedTypeKey; label: string; desc: string }[] = [
  {
    key: "erp_adoption",
    label: "ERP 導入",
    desc: "適合仍以紙本、Excel、分散系統或舊系統管理，希望整理訂單、採購、庫存、生產與成本資訊的工廠。",
  },
  {
    key: "line_optimization",
    label: "產線與動線優化",
    desc: "適合現場存在搬運距離長、等待、回流、在製品堆積、瓶頸、空間利用或安全問題的工廠。",
  },
  {
    key: "integrated",
    label: "整合改善",
    desc: "適合管理資訊與生產現場互相卡住，需要先診斷，再決定 ERP、MES、倉儲或產線調整順序的工廠。",
  },
  {
    key: "unsure",
    label: "不確定，希望由顧問協助判斷",
    desc: "",
  },
];

export function erpNeedTypeLabel(key: string): string {
  return ERP_NEED_TYPES.find(n => n.key === key)?.label ?? key;
}

// 案件狀態機：ERP／產線優化專屬流程，與短影音／ISO 專區狀態值各自獨立宣告，
// 不跨專區耦合。主流程：new(新案件／待聯繫) → needs_triage(需求分流：確認屬於
// ERP導入／產線優化／整合改善／不確定由顧問判斷) → diagnosis(現場診斷／流程
// 盤點) → solution_design(改善方案設計) → proposal(範圍與報價確認) →
// in_progress(導入執行中) → pilot_adjustment(試行與調整) → acceptance(驗收中)
// → completed(專案完成)。例外狀態（進入時一律要求 statusReason）：
// deferred(緩追)／no_interest(無意願)／not_applicable(不適用／無法承接)／
// archived(已封存)。unassigned＝待取件，尚未指派顧問。
export const ERP_CASE_STATUSES = [
  "new", "needs_triage", "diagnosis", "solution_design", "proposal", "in_progress",
  "pilot_adjustment", "acceptance", "completed",
  "deferred", "no_interest", "not_applicable", "archived", "unassigned",
] as const;

export type ErpCaseStatus = (typeof ERP_CASE_STATUSES)[number];

export const ERP_STATUS_LABELS: Record<ErpCaseStatus, string> = {
  new: "新案件／待聯繫",
  needs_triage: "需求分流",
  diagnosis: "現場診斷／流程盤點",
  solution_design: "改善方案設計",
  proposal: "範圍與報價確認",
  in_progress: "導入執行中",
  pilot_adjustment: "試行與調整",
  acceptance: "驗收中",
  completed: "專案完成",
  deferred: "緩追",
  no_interest: "無意願",
  not_applicable: "不適用／無法承接",
  archived: "已封存",
  unassigned: "待取件",
};

// 未結案狀態：必須與 drizzle/schema.ts erpCases.openFactoryId 的 CASE WHEN
// 條件、server/db.ts ERP_OPEN_STATUSES_DB 完全一致。
export const ERP_OPEN_STATUSES: ErpCaseStatus[] = [
  "new", "needs_triage", "diagnosis", "solution_design", "proposal", "in_progress",
  "pilot_adjustment", "acceptance", "deferred", "unassigned",
];

// 進入時一律要求 statusReason 的例外狀態，供 server 驗證與前端表單共用。
export const ERP_EXCEPTION_STATUSES: ErpCaseStatus[] = [
  "deferred", "no_interest", "not_applicable", "archived",
];

// 合法狀態轉移白名單：避免任意從「新案件」直接跳到「專案完成」。
// Key 型別刻意放寬為 string，理由同 shared/certificationCase.ts（0075 向後相容
// migration 保留 'evaluating' 等舊值，查表安全 fallback，轉移目的地仍限定新版狀態）。
export const ERP_STATUS_TRANSITIONS: Record<string, ErpCaseStatus[]> = {
  unassigned: ["new", "archived"],
  new: ["needs_triage", "deferred", "no_interest", "not_applicable", "archived"],
  needs_triage: ["diagnosis", "not_applicable", "deferred", "archived"],
  diagnosis: ["solution_design", "deferred", "archived"],
  solution_design: ["proposal", "deferred", "archived"],
  proposal: ["in_progress", "deferred", "no_interest", "archived"],
  in_progress: ["pilot_adjustment", "deferred", "archived"],
  pilot_adjustment: ["acceptance", "deferred", "archived"],
  acceptance: ["completed", "deferred", "archived"],
  completed: ["archived"],
  deferred: ["new", "no_interest", "archived"],
  no_interest: ["archived"],
  not_applicable: ["archived"],
  archived: [],
};
