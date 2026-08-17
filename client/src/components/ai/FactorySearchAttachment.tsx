import { useLocation } from "wouter";
import { Star, MapPin, ArrowRight } from "lucide-react";
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
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
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
      <p className="truncate whitespace-pre-wrap break-words text-xs text-slate-600">{candidate.matchReason}</p>
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

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
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
