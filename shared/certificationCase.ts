/**
 * ISO 與低碳認證專區申請案件共用常數。服務選項本身不在這裡定義——
 * 想了解的認證服務一律來自 certificationServiceItems 現有目錄（見
 * trpc.certificationCenter.listServices），避免另建一套會失去同步的固定
 * 清單。這裡只放案件狀態機（與短影音／ERP 專區狀態值相同但各自獨立宣告，
 * 避免跨專區耦合到同一份常數）。
 */

export const CERTIFICATION_CASE_STATUSES = [
  "new", "evaluating", "proposal", "in_progress", "completed",
  "deferred", "no_interest", "archived", "unassigned",
] as const;

export type CertificationCaseStatus = (typeof CERTIFICATION_CASE_STATUSES)[number];

export const CERTIFICATION_STATUS_LABELS: Record<CertificationCaseStatus, string> = {
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

export const CERTIFICATION_OPEN_STATUSES: CertificationCaseStatus[] = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
];

export const CERTIFICATION_STATUS_TRANSITIONS: Record<string, CertificationCaseStatus[]> = {
  new: ["evaluating", "unassigned", "archived"],
  evaluating: ["proposal", "deferred", "no_interest", "archived"],
  proposal: ["in_progress", "deferred", "no_interest", "archived"],
  in_progress: ["completed", "deferred", "no_interest", "archived"],
  deferred: ["evaluating", "no_interest", "archived"],
  unassigned: ["evaluating", "archived"],
};
