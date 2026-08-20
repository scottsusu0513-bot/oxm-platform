import { useLocation } from "wouter";
import { Star, MapPin, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiShellAttachment } from "@/contexts/AiShellContext";

/**
 * Phase 6 UI Foundation（見對話中「Factory Cards 交付方式」）：這個元件只負責
 * 「卡片＋查看全部搜尋結果按鈕」這個 Tool Result 的機器可讀部分，不再產生任何
 * 文字說明——搜尋到什麼、有沒有明確符合、有沒有交給人工協尋，全部改由
 * server/ai/actionPlanner.ts 的 assistantReply／routing.ts 的 finalReply
 * 生成，顯示在這則 assistant 訊息的 content 裡（見「所有使用者看到的對話
 * 文字，都必須由AI assistant message自然說出來」）。
 *
 * 舊版 FactorySearchResultCards.tsx 的 ManualSourcingBanner／
 * buildManualSourcingMessage／zeroResult 系統通知文字（「目前這組地區／
 * 產業條件……」）已整段移除——那正是這一輪要拔掉的「系統通知框」。
 *
 * url／viewAllUrl 都是 server 端組好的正式路由字串，這裡只負責 navigate，
 * 不自己拼接或修改網址。
 */
export interface FactorySearchCandidateForUi {
  factory: {
    id: number;
    companyName: string;
    region: string;
    industry: string[];
    subIndustry: string[];
    avgRating: number;
    reviewCount: number;
    certified: boolean;
  };
  relevanceTier: "high" | "medium" | "general";
  matchReason: string;
  url: string;
}

const TIER_LABEL: Record<FactorySearchCandidateForUi["relevanceTier"], string> = {
  high: "高度相關",
  medium: "可能相關",
  general: "其他符合條件",
};

/**
 * Phase 7.1 P0-1（見對話中「Factory status 必須由 server 結構化資料決定」）：
 * MATCH_FOUND／SIMILAR_ONLY 的視覺差異只能吃 candidate.relevanceTier 這個
 * server 算好的結構化欄位，不解析 matchReason 文字、不解析 finalReply。
 * general（SIMILAR_ONLY）用琥珀色（警示色，非品牌橘色）跟 high／medium 明確
 * 區分，避免視覺上暗示「已確認具備能力」。
 */
export function factoryTierBadgeClassName(tier: FactorySearchCandidateForUi["relevanceTier"]): string {
  if (tier === "general") {
    return "shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700";
  }
  if (tier === "high") {
    return "shrink-0 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700";
  }
  return "shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500";
}

/**
 * Phase 7.1 P0-1：先前 truncate（強制單行省略號）跟 whitespace-pre-wrap（允許
 * 換行）同時作用在同一個元素上，是互相衝突的 class，可能把 buildMatchReason()
 * 在 general tier 附加的誠實免責句（「目前公開資料未明確提到相關能力」）截斷
 * 看不到。改成 line-clamp-3（多行截斷，不是單行）——真實文字通常遠短於 3
 * 行會完整顯示，只有極端情況才會被截斷，且不會把卡片撐成大段文字。
 */
export function factoryMatchReasonClassName(tier: FactorySearchCandidateForUi["relevanceTier"]): string {
  const color = tier === "general" ? "text-amber-700" : "text-slate-600";
  return `line-clamp-3 whitespace-pre-wrap break-words text-xs ${color}`;
}

/** Phase 7.1 P0-1：attachment header 是否要顯示一次性的 SIMILAR_ONLY 提醒。 */
export function factoryAttachmentHasCaution(candidates: FactorySearchCandidateForUi[]): boolean {
  return candidates.some(c => c.relevanceTier === "general");
}

function FactoryMiniCard({ candidate }: { candidate: FactorySearchCandidateForUi }) {
  const [, navigate] = useLocation();
  const { factory } = candidate;
  return (
    <button
      type="button"
      onClick={() => navigate(candidate.url)}
      className="flex w-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{factory.companyName}</span>
        <span className={factoryTierBadgeClassName(candidate.relevanceTier)}>
          {candidate.relevanceTier === "general" && <Info className="size-2.5 shrink-0" aria-hidden="true" />}
          {TIER_LABEL[candidate.relevanceTier]}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3 shrink-0" aria-hidden="true" />
          {factory.region}
        </span>
        {factory.reviewCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />
            {factory.avgRating.toFixed(1)}
          </span>
        )}
      </div>
      <p className={factoryMatchReasonClassName(candidate.relevanceTier)}>{candidate.matchReason}</p>
    </button>
  );
}

export function FactorySearchAttachmentView({
  attachment,
}: {
  attachment: Extract<AiShellAttachment, { type: "factory_search_results" }>;
}) {
  const [, navigate] = useLocation();
  if (attachment.candidates.length === 0) return null;
  const hasCaution = factoryAttachmentHasCaution(attachment.candidates);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
      {hasCaution && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800">
          以下包含相似候選：目前公開資料尚未足以確認符合你指定的核心能力，建議進入工廠頁後直接與工廠確認。
        </p>
      )}
      {attachment.candidates.map(c => (
        <FactoryMiniCard key={c.factory.id} candidate={c} />
      ))}
      <Button
        type="button"
        onClick={() => navigate(attachment.viewAllUrl)}
        className="w-full bg-orange-600 hover:bg-orange-700 text-white"
      >
        <ArrowRight className="size-4 mr-2" aria-hidden="true" />
        查看完整搜尋結果{attachment.total > attachment.candidates.length ? `（共 ${attachment.total} 家）` : ""}
      </Button>
    </div>
  );
}
