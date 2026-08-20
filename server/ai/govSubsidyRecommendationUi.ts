import { getGovSubsidyProgramDisplayName } from "../../shared/ai/serviceRegistry";
import type { GovSubsidyRecommendation } from "./routing";

/**
 * Phase 7.1（見對話中「P0-2：Government Subsidy Recommendation 專屬 UI」）：
 * 這裡只做 transport / type mapping——把既有 routing.ts 判斷出的
 * GovSubsidyRecommendation（primaryProgramKey／secondaryProgramKey／
 * reasoning／missingInformation）轉成前端可以直接渲染的形狀，不重新判斷
 * 任何方向、不新增 LLM call，方案名稱只能查
 * shared/ai/serviceRegistry.ts（server-authoritative），不得自己硬寫對照表。
 */
export interface GovSubsidyRecommendationForUi {
  primaryProgramKey: string;
  primaryProgramName: string;
  secondaryProgramKey: string | null;
  secondaryProgramName: string | null;
  reasoning: string;
  missingInformation: string[];
}

/**
 * primaryProgramKey 是 null（資訊不足，見 GovSubsidyRecommendation 型別註解
 * 「允許 null」）時，這裡不產生任何 attachment——沒有方向可以顯示，finalReply
 * 本身已經負責用文字繼續追問，不需要一張半空的卡片。
 */
export function buildGovSubsidyRecommendationForUi(
  recommendation: GovSubsidyRecommendation | null
): GovSubsidyRecommendationForUi | null {
  if (!recommendation || !recommendation.primaryProgramKey) return null;
  const primaryProgramName = getGovSubsidyProgramDisplayName(recommendation.primaryProgramKey);
  if (!primaryProgramName) return null;
  const secondaryProgramName = recommendation.secondaryProgramKey
    ? getGovSubsidyProgramDisplayName(recommendation.secondaryProgramKey)
    : null;
  return {
    primaryProgramKey: recommendation.primaryProgramKey,
    primaryProgramName,
    secondaryProgramKey: secondaryProgramName ? recommendation.secondaryProgramKey : null,
    secondaryProgramName,
    reasoning: recommendation.reasoning,
    missingInformation: recommendation.missingInformation.slice(0, 3),
  };
}
