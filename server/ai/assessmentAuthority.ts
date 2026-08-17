/**
 * Phase 5 可靠性修正（見對話中「一、Submitted Form 的最高權威不能只靠
 * Prompt」「二、建立 authoritativeAssessmentContext」）：submitted form 對
 * confirmedFacts 的覆蓋，原本只靠 prompt 文字要求模型「衝突時以正式表單為
 * 準」——這仍然是把資料一致性交給 LLM 判斷。這裡改成在送進模型之前，先由
 * server 端 deterministic 消除衝突：對於 handoff prefillData 裡的每一個
 * key，只要正式表單已經「回答」了對應概念，就直接把這個 key 從要送進模型
 * 的背景資料裡剔除，模型永遠看不到已經過期的舊值，不需要自己選邊站。
 *
 * 「回答」的判斷刻意不是 truthy 檢查（`if (submittedValue)`）——因為
 * false／0／null 都可能是使用者在正式表單裡明確選擇的合法答案（見「三、
 * 不要錯誤把「空值」當成覆蓋」），只有 undefined（呼叫端根本沒有提供這個
 * key）才代表「表單沒有回答這個概念」，此時才允許保留 handoff 的舊值當參考。
 */

export type AuthoritativeFactValue = string | number | boolean | string[] | null;

/**
 * 型別安全的 presence 判斷：只有 undefined 代表「表單沒有回答」。
 * null／false／0／空字串／空陣列都是合法的正式答案，一律視為「已回答」。
 */
export function isAnsweredValue(value: AuthoritativeFactValue | undefined): boolean {
  return value !== undefined;
}

export interface AuthoritativeReferenceBackground {
  /** handoffSummary 是敘述性文字，不是結構化 fact，不受逐欄位覆蓋判斷影響，原樣保留。 */
  handoffSummary: string;
  /** prefillData 中，尚未被正式表單回答之欄位的殘餘子集——只有這些才會被送進 prompt 當「僅供參考」背景。 */
  remainingReferenceFacts: Record<string, unknown>;
  /** 因為表單已回答對應概念而被剔除的 prefill key（供測試／除錯用，不會送進 prompt）。 */
  supersededKeys: string[];
  /**
   * supersededKeys 裡「舊值型別是 boolean」的子集（見對話中「六～八、移除
   * 衝突 Raw Summary」）——boolean 欄位（例如 hasPatent／isEnterpriseFirm／
   * isUnsure）代表使用者可能用一句直述句表達「有／沒有」「是／不是」，這正是
   * 自由文字 handoffSummary 最容易不小心重複帶出已被表單覆蓋之舊事實的模式
   * （例如「目前沒有專利」）。enum／陣列型別的欄位（例如 needType／
   * servicesWanted）被表單回答通常只是「選項更新」，不是「肯定/否定事實」，
   * 不需要為此犧牲敘述背景的品質（見「八、不要破壞沒有衝突時的
   * handoffSummary」的 ERP 範例）。呼叫端用這個欄位、而不是 supersededKeys
   * 本身，決定要不要整段捨棄 handoffSummary 原文。
   */
  supersededBooleanKeys: string[];
}

/**
 * 核心 normalization：submittedAnswers 的 key 必須跟 prefillData 用同一套
 * key 命名（見各服務 build*Prompt 裡的 xxxSubmittedAnswers 組裝邏輯），
 * value 是 undefined 就代表這次表單沒有回答這個概念、才允許保留 prefillData
 * 裡的舊值；只要有值（含 false／0／null／空字串／空陣列）就一律視為已回答，
 * prefillData 裡對應的舊值永遠不會再出現在送進模型的背景資料裡。
 */
export function buildAuthoritativeReferenceBackground(params: {
  handoffSummary: string;
  prefillData: Record<string, unknown>;
  submittedAnswers: Record<string, AuthoritativeFactValue | undefined>;
}): AuthoritativeReferenceBackground {
  const remainingReferenceFacts: Record<string, unknown> = {};
  const supersededKeys: string[] = [];
  const supersededBooleanKeys: string[] = [];
  for (const [key, value] of Object.entries(params.prefillData)) {
    if (isAnsweredValue(params.submittedAnswers[key])) {
      supersededKeys.push(key);
      if (typeof value === "boolean") supersededBooleanKeys.push(key);
      continue;
    }
    remainingReferenceFacts[key] = value;
  }
  return { handoffSummary: params.handoffSummary, remainingReferenceFacts, supersededKeys, supersededBooleanKeys };
}
