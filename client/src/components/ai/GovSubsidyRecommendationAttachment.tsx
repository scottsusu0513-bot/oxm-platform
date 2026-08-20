import { Compass } from "lucide-react";
import type { AiShellAttachment } from "@/contexts/AiShellContext";

/**
 * Phase 7.1（見對話中「P0-2：Government Subsidy Recommendation 專屬 UI」）：
 * 這是 AI 依對話情境做的「方案方向初步判斷」，跟 SubsidyProgramsAttachment.tsx
 * （政府補助公開方案清單查詢）是完全不同的兩件事——這裡刻意用紫色（跟
 * GlobalAiShell 開關按鈕上代表「AI」的 Sparkles 徽章同一個色系）做視覺區分，
 * 不共用 Lookup 卡片的白底＋橘色按鈕樣式，避免使用者把「AI 初步方向」誤認成
 * 官方公開資料或正式資格審查結果（見「七、不要把 Recommendation 做成
 * 「審核結果」」：UI 不得出現符合/不符合/合格/不合格/通過率/評分/資格確認
 * 這類字眼）。沒有可點擊的 CTA——這不是一個可以直接前往的頁面，是一段需要
 * 搭配 finalReply 文字閱讀的建議。
 */
export interface GovSubsidyRecommendationForUi {
  primaryProgramKey: string;
  primaryProgramName: string;
  secondaryProgramKey: string | null;
  secondaryProgramName: string | null;
  reasoning: string;
  missingInformation: string[];
}

export const GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER =
  "這是依目前對話資訊做的方向判斷，實際資格與申請條件仍需依當年度公告及顧問確認。";

export function GovSubsidyRecommendationAttachmentView({
  attachment,
}: {
  attachment: Extract<AiShellAttachment, { type: "gov_subsidy_recommendation" }>;
}) {
  const missingInformation = attachment.missingInformation.slice(0, 3);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-purple-200 bg-purple-50/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700">
        <Compass className="size-3.5 shrink-0" aria-hidden="true" />
        AI 初步建議方向
      </div>
      <div className="flex flex-col gap-1 text-sm text-slate-800">
        <p className="break-words">
          <span className="text-slate-500">主要方向：</span>
          {attachment.primaryProgramName}
        </p>
        {attachment.secondaryProgramName && (
          <p className="break-words">
            <span className="text-slate-500">次要方向：</span>
            {attachment.secondaryProgramName}
          </p>
        )}
        {attachment.reasoning && (
          <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{attachment.reasoning}</p>
        )}
        {missingInformation.length > 0 && (
          <div className="mt-0.5 text-xs text-slate-600">
            <span className="font-medium text-slate-700">還需要確認：</span>
            <ul className="mt-0.5 list-disc pl-4">
              {missingInformation.map((item, i) => (
                <li key={i} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">{GOV_SUBSIDY_RECOMMENDATION_DISCLAIMER}</p>
    </div>
  );
}
