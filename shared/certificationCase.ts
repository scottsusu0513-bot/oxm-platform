/**
 * ISO 與低碳認證專區申請案件共用常數。服務選項本身不在這裡定義——
 * 想了解的認證服務一律來自 certificationServiceItems 現有目錄（見
 * trpc.certificationCenter.listServices），避免另建一套會失去同步的固定
 * 清單。這裡只放案件狀態機（與短影音／ERP 專區流程各自獨立宣告，狀態值
 * 不互通，避免跨專區耦合到同一份常數或誤用到其他專區的中文標籤）。
 *
 * 主流程：new(新案件／待聯繫) → needs_interview(需求訪談) →
 * scope_assessment(適用性與範圍評估) → proposal(方案與報價確認) →
 * in_progress(輔導執行中) → pre_review(預審與改善，可視服務跳過) →
 * verification(驗證／成果確認) → completed(輔導完成)。
 * 例外狀態（進入時一律要求填寫 statusReason）：deferred(緩追)／
 * no_interest(無意願)／not_applicable(不適用／無法承接)／archived(已封存)。
 * unassigned＝待取件，尚未指派顧問。
 */

export const CERTIFICATION_CASE_STATUSES = [
  "new", "needs_interview", "scope_assessment", "proposal", "in_progress",
  "pre_review", "verification", "completed",
  "deferred", "no_interest", "not_applicable", "archived", "unassigned",
] as const;

export type CertificationCaseStatus = (typeof CERTIFICATION_CASE_STATUSES)[number];

export const CERTIFICATION_STATUS_LABELS: Record<CertificationCaseStatus, string> = {
  new: "新案件／待聯繫",
  needs_interview: "需求訪談",
  scope_assessment: "適用性與範圍評估",
  proposal: "方案與報價確認",
  in_progress: "輔導執行中",
  pre_review: "預審與改善",
  verification: "驗證／成果確認",
  completed: "輔導完成",
  deferred: "緩追",
  no_interest: "無意願",
  not_applicable: "不適用／無法承接",
  archived: "已封存",
  unassigned: "待取件",
};

// 未結案狀態：必須與 drizzle/schema.ts certificationCases.openFactoryId 的
// CASE WHEN 條件、server/db.ts CERTIFICATION_OPEN_STATUSES_DB 完全一致。
export const CERTIFICATION_OPEN_STATUSES: CertificationCaseStatus[] = [
  "new", "needs_interview", "scope_assessment", "proposal", "in_progress",
  "pre_review", "verification", "deferred", "unassigned",
];

// 進入時一律要求 statusReason 的例外狀態，供 server 驗證與前端表單共用。
export const CERTIFICATION_EXCEPTION_STATUSES: CertificationCaseStatus[] = [
  "deferred", "no_interest", "not_applicable", "archived",
];

// 合法狀態轉移白名單：避免任意從「新案件」直接跳到「輔導完成」，
// 供 server 與顧問看板 UI 共用同一份資料。
// Key 型別刻意放寬為 string（而非 CertificationCaseStatus）：drizzle/schema.ts 的
// status 欄位為向後相容，仍保留 'evaluating' 等本表已不再寫入的舊值（見 0075
// migration 註解），查表時可能真的用舊值當 key（一律安全 fallback 為 undefined/[]），
// 但轉移的「目的地」永遠限定在 CertificationCaseStatus 這個新版合法狀態集合內。
export const CERTIFICATION_STATUS_TRANSITIONS: Record<string, CertificationCaseStatus[]> = {
  unassigned: ["new", "archived"],
  new: ["needs_interview", "deferred", "no_interest", "not_applicable", "archived"],
  needs_interview: ["scope_assessment", "deferred", "no_interest", "not_applicable", "archived"],
  scope_assessment: ["proposal", "not_applicable", "deferred", "archived"],
  proposal: ["in_progress", "deferred", "no_interest", "archived"],
  in_progress: ["pre_review", "verification", "deferred", "archived"],
  pre_review: ["verification", "deferred", "archived"],
  verification: ["completed", "deferred", "archived"],
  completed: ["archived"],
  deferred: ["new", "no_interest", "archived"],
  no_interest: ["archived"],
  not_applicable: ["archived"],
  archived: [],
};
