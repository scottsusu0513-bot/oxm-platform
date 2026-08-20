/**
 * Phase 9.2（見對話中「十五」）：aiModelCalls.layer 的中文顯示名稱唯一來源。
 * 刻意放在 shared/（不是 server/ai/aiCallContext.ts 本身，那是 server-only
 * 檔案，client 端的 Admin AI 管理頁面也需要用到這份對照），避免各個元件
 * 各自寫一份 switch／if-else（見「不要各 component 自己寫 switch」）。
 *
 * 這裡刻意用純字串 key（不 import server 端的 AiModelCallLayer type），
 * 因為 shared/ 不能依賴 server/ 底下的模組——但 key 的實際值必須跟
 * server/ai/aiCallContext.ts 的 AiModelCallLayer 完全一致，新增 layer 時
 * 兩邊都要同步更新。
 */
export const AI_USAGE_LAYER_LABELS: Record<string, string> = {
  diagnosis: "企業診斷",
  routing: "資源分流",
  factorySemantic: "工廠語意搜尋",
  actionPlanner: "動作規劃",
  responseComposer: "回覆整理",
  casualPauseGate: "閒聊判斷",
  caseAssessment: "案件初判",
  memorySummary: "企業記憶摘要",
  memoryMerge: "企業記憶合併",
};

/** 未知 layer（例如新增了 layer 但還沒更新這份對照表）安全 fallback 顯示原始值，不 throw。 */
export function getAiUsageLayerLabel(layer: string): string {
  return AI_USAGE_LAYER_LABELS[layer] ?? layer;
}
