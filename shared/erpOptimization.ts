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

// 案件狀態機：與短影音／ISO 專區狀態值相同但各自獨立宣告，不跨專區耦合。
export const ERP_CASE_STATUSES = [
  "new", "evaluating", "proposal", "in_progress", "completed",
  "deferred", "no_interest", "archived", "unassigned",
] as const;

export type ErpCaseStatus = (typeof ERP_CASE_STATUSES)[number];

export const ERP_STATUS_LABELS: Record<ErpCaseStatus, string> = {
  new: "新案件",
  evaluating: "評估中",
  proposal: "提案中",
  in_progress: "執行中",
  completed: "已完成",
  deferred: "緩追區",
  no_interest: "無意願",
  archived: "已封存",
  unassigned: "未指派",
};

export const ERP_OPEN_STATUSES: ErpCaseStatus[] = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
];

export const ERP_STATUS_TRANSITIONS: Record<string, ErpCaseStatus[]> = {
  new: ["evaluating", "unassigned", "archived"],
  evaluating: ["proposal", "deferred", "no_interest", "archived"],
  proposal: ["in_progress", "deferred", "no_interest", "archived"],
  in_progress: ["completed", "deferred", "no_interest", "archived"],
  deferred: ["evaluating", "no_interest", "archived"],
  unassigned: ["evaluating", "archived"],
};
