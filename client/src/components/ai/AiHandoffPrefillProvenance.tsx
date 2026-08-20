/**
 * Phase 7.2（見對話中「D：Handoff AI Prefill Provenance」）：useAiHandoff() 回傳
 * 的 confirmedFields 一直都帶有「這個欄位是不是 AI 從對話裡確認過的」這個
 * provenance 資訊，但先前 5 個 Apply 表單完全沒有把這個資訊顯示給使用者
 * ——這裡補上最小、共用的一套 UI，5 個表單共用同一份元件，不各自複製貼上。
 *
 * 判斷來源只能是 confirmedFields 本身（server-authoritative，見
 * server/ai/handoffPrefill.ts 的白名單驗證），不能用「欄位目前有沒有值」
 * 判斷——欄位可能本來就有值（例如既有工廠 autofill，見 EnterpriseUpgradeApply.tsx
 * 的 AutoFillHint／amber 配色），兩種來源必須能分開標示，這裡刻意用紫色
 * （跟 GlobalAiShell／GovSubsidyRecommendationAttachment 代表「AI」的既有配色
 * 一致）跟 amber 的工廠 autofill 提示做出區隔。
 */
export interface AiHandoffConfirmedFields {
  [fieldKey: string]: { sourceFact: string } | undefined;
}

/** 這個表單實際會拿來 setValue 的欄位裡，有沒有任何一個是 AI 確認過的。 */
export function hasAiPrefilledAnyOf(confirmedFields: AiHandoffConfirmedFields, relevantFieldKeys: string[]): boolean {
  return relevantFieldKeys.some(key => !!confirmedFields[key]);
}

/** 表單最上方的一次性提示，只在真的有欄位被 AI 帶入時才顯示。 */
export function AiHandoffPrefillBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/60 px-4 py-2.5 text-xs text-purple-800 dark:border-purple-900/40 dark:bg-purple-950/20 dark:text-purple-300">
      已依剛才與 OXM AI 的對話，幫你預先帶入部分資料；送出前仍可自行修改。
    </div>
  );
}

/** 單一欄位旁的輕量提示，只在 confirmedFields 裡真的有這個 key 時才顯示。 */
export function AiPrefillFieldHint({
  confirmedFields,
  fieldKey,
}: {
  confirmedFields: AiHandoffConfirmedFields;
  fieldKey: string;
}) {
  const confirmed = confirmedFields[fieldKey];
  if (!confirmed) return null;
  return (
    <p className="text-[11px] text-purple-600/80 dark:text-purple-400/70" title={confirmed.sourceFact}>
      AI 已帶入
    </p>
  );
}
