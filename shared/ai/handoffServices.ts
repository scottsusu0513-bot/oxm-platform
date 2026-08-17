/**
 * OXM AI Phase 4：AI Handoff 只串接「目前已有真人顧問既有表單」的服務，且一律
 * 導向既有表單本身（EnterpriseUpgradeApply.tsx 等），不建立 AI 專用第二套表單
 * （見對話中「六、不要建立 AI 專用表單」）。
 *
 * 找工廠（factory_search）、找消息（news）本輪不走這套 handoff CTA——找工廠有
 * 自己的後續搜尋／fallback 流程，找消息不是顧問表單，見對話中「五、本輪服務
 * 範圍」「二十三、只有可真人承接服務才顯示 CTA」。
 *
 * 這是「模型判斷 serviceKey → 程式決定表單路徑」的唯一對照表，模型本身絕對
 * 不會、也不應該自己產生表單網址（避免 hallucinated routes，見「二十二、AI
 * 對話端正式 Handoff Action」）。
 */
export const HANDOFF_ELIGIBLE_SERVICE_KEYS = [
  "gov_subsidy",
  "erp",
  "certification",
  "short_video",
  "finance",
] as const;

export type HandoffEligibleServiceKey = (typeof HANDOFF_ELIGIBLE_SERVICE_KEYS)[number];

export interface HandoffServiceMapping {
  serviceKey: HandoffEligibleServiceKey;
  /** 既有申請表單路徑——這張表單同時服務一般入口與 AI handoff 入口，是同一張表單。 */
  applyPath: string;
  displayName: string;
}

export const HANDOFF_SERVICE_MAPPINGS: HandoffServiceMapping[] = [
  { serviceKey: "gov_subsidy", applyPath: "/upgrade-center/apply", displayName: "政府補助" },
  { serviceKey: "erp", applyPath: "/erp-optimization/apply", displayName: "ERP 與產線優化" },
  { serviceKey: "certification", applyPath: "/certification-center/apply", displayName: "ISO／低碳認證" },
  { serviceKey: "short_video", applyPath: "/short-video-marketing/apply", displayName: "短影音與品牌內容" },
  { serviceKey: "finance", applyPath: "/finance-optimization/apply", displayName: "企業財務優化" },
];

const MAPPING_BY_KEY = new Map(HANDOFF_SERVICE_MAPPINGS.map(m => [m.serviceKey, m]));

export function isHandoffEligibleServiceKey(key: string | null | undefined): key is HandoffEligibleServiceKey {
  return !!key && MAPPING_BY_KEY.has(key as HandoffEligibleServiceKey);
}

export function getHandoffServiceMapping(key: string): HandoffServiceMapping | undefined {
  return MAPPING_BY_KEY.get(key as HandoffEligibleServiceKey);
}

/** Blocking Modal／CTA 固定文案，見對話中「二、所有真人服務 CTA 統一」「二十七、Blocking Modal 文案」。 */
export const HANDOFF_CTA_LABEL = "幫你送出詢問";

export const HANDOFF_MODAL_TITLE = "我先幫你把資料整理好了";
export const HANDOFF_MODAL_BODY =
  "我已經根據剛剛的對話先幫你填好部分表單，不過還有一些欄位需要你補完並送出。\n\n已經填好的內容也可以修改。\n\n這次對話中你的需求重點，我也會一起整理給顧問，讓他接手時不用再從頭問一次。";
export const HANDOFF_MODAL_CONFIRM_LABEL = "好，繼續填寫";
