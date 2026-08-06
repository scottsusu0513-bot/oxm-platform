/**
 * OXM 短影音與品牌內容行銷專區共用常數。五項服務可單獨選擇也可組合，因此
 * SERVICES 的 key 同時是申請表 servicesWanted 陣列的合法值、顧問
 * serviceAreas 篩選依據，以及頁面文案的唯一資料來源（頁面與表單都應
 * import 這裡的陣列，不要各自重複寫一份服務清單，避免兩邊文案或數量兜不
 * 起來）。
 */

export const SHORT_VIDEO_SERVICE_KEYS = [
  "shooting",
  "kol",
  "social",
  "media",
  "interview",
] as const;

export type ShortVideoServiceKey = (typeof SHORT_VIDEO_SERVICE_KEYS)[number];

export const SHORT_VIDEO_SERVICES: {
  key: ShortVideoServiceKey;
  label: string;
  shortLabel: string;
  summary: string;
}[] = [
  {
    key: "shooting",
    label: "短影音企劃與拍攝",
    shortLabel: "短影音拍攝",
    summary: "從需求盤點、腳本到現場拍攝與剪輯，產出直式短影音成品。",
  },
  {
    key: "kol",
    label: "KOL 合作方案",
    shortLabel: "KOL 合作",
    summary: "依受眾與目標媒合合適創作者，規劃合作內容與使用授權。",
  },
  {
    key: "social",
    label: "社群內容代操",
    shortLabel: "社群代操",
    summary: "帳號內容排程、文案發布與成效回顧，持續累積品牌內容。",
  },
  {
    key: "media",
    label: "新聞媒體露出",
    shortLabel: "媒體露出",
    summary: "整理品牌議題，規劃新聞稿、採訪或媒體合作露出形式。",
  },
  {
    key: "interview",
    label: "訪談製作",
    shortLabel: "訪談製作",
    summary: "創辦人、技術人員或客戶案例訪談，從訪綱到現場拍攝與後製。",
  },
];

export function shortVideoServiceLabel(key: string): string {
  return SHORT_VIDEO_SERVICES.find(s => s.key === key)?.label ?? key;
}

// 主要目標：單選，對應「先決定目的，再選服務」區塊的目標→建議服務對照。
export const SHORT_VIDEO_GOAL_KEYS = [
  "quick_intro",
  "brand_content",
  "audience_kol",
  "pr_visibility",
  "founder_story",
  "unsure",
] as const;

export type ShortVideoGoalKey = (typeof SHORT_VIDEO_GOAL_KEYS)[number];

export const SHORT_VIDEO_GOALS: { key: ShortVideoGoalKey; label: string; suggestedService: ShortVideoServiceKey | null }[] = [
  { key: "quick_intro", label: "快速介紹產品、設備或製程", suggestedService: "shooting" },
  { key: "brand_content", label: "穩定累積品牌內容", suggestedService: "social" },
  { key: "audience_kol", label: "接觸特定受眾與創作者社群", suggestedService: "kol" },
  { key: "pr_visibility", label: "建立企業議題與公開能見度", suggestedService: "media" },
  { key: "founder_story", label: "深入呈現創辦人、技術與品牌故事", suggestedService: "interview" },
  { key: "unsure", label: "不確定，希望由顧問協助判斷", suggestedService: null },
];

// 目前經營平台：可複選，「尚未經營」與其他平台互斥（見申請表 zod refine）。
export const SHORT_VIDEO_PLATFORM_KEYS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type ShortVideoPlatformKey = (typeof SHORT_VIDEO_PLATFORM_KEYS)[number];

export const SHORT_VIDEO_PLATFORMS: { key: ShortVideoPlatformKey; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
];

export function shortVideoPlatformLabel(key: string): string {
  return SHORT_VIDEO_PLATFORMS.find(p => p.key === key)?.label ?? key;
}

// 案件狀態：new → evaluating → proposal → in_progress → completed 為主流程；
// deferred／no_interest／archived／unassigned 為例外狀態。獨立於
// upgradeApplications／financeApplications 的狀態機，不共用列舉值。
export const SHORT_VIDEO_CASE_STATUSES = [
  "new", "evaluating", "proposal", "in_progress", "completed",
  "deferred", "no_interest", "archived", "unassigned",
] as const;

export type ShortVideoCaseStatus = (typeof SHORT_VIDEO_CASE_STATUSES)[number];

export const SHORT_VIDEO_STATUS_LABELS: Record<ShortVideoCaseStatus, string> = {
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

// 案件未結案狀態：影響「同一工廠是否已有進行中案件」判斷與顧問看板篩選，
// 與 drizzle/schema.ts shortVideoCases.openFactoryId 的 CASE WHEN 條件必須
// 完全一致。
export const SHORT_VIDEO_OPEN_STATUSES: ShortVideoCaseStatus[] = [
  "new", "evaluating", "proposal", "in_progress", "deferred", "unassigned",
];

// 合法狀態轉移白名單，供 server 與顧問看板 UI 共用同一份資料，避免前後端
// 兜不起來。no_interest／completed／archived 為結案狀態，不再轉移。
export const SHORT_VIDEO_STATUS_TRANSITIONS: Record<string, ShortVideoCaseStatus[]> = {
  new: ["evaluating", "unassigned", "archived"],
  evaluating: ["proposal", "deferred", "no_interest", "archived"],
  proposal: ["in_progress", "deferred", "no_interest", "archived"],
  in_progress: ["completed", "deferred", "no_interest", "archived"],
  deferred: ["evaluating", "no_interest", "archived"],
  unassigned: ["evaluating", "archived"],
};
