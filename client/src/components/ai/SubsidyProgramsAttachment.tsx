import { useLocation } from "wouter";
import { ArrowRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiShellAttachment } from "@/contexts/AiShellContext";

/**
 * Phase 6C（見對話中「政府補助資訊查詢 ≠ Handoff」，比照
 * NewsSearchAttachment.tsx 的設計）：只負責「卡片＋查看全部按鈕」這個 Tool
 * Result 的機器可讀部分，不生成任何文字說明——找到什麼、怎麼比較、0
 * results 怎麼講，全部由 server/ai/responseComposer.ts 生成。url／viewAllUrl
 * 都是 server 端組好的正式路由字串（/upgrade-center），這裡只負責 navigate。
 */
export interface SubsidyProgramCandidateForUi {
  slug: string;
  title: string;
  shortTitle: string | null;
  description: string;
  targetAudience: string | null;
  highlights: string[];
  maxFundingLabel: string | null;
  statusLabel: string | null;
  url: string;
}

function SubsidyMiniCard({ candidate }: { candidate: SubsidyProgramCandidateForUi }) {
  const [, navigate] = useLocation();
  return (
    <button
      type="button"
      onClick={() => navigate(candidate.url)}
      className="flex w-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
          {candidate.title}
          {candidate.shortTitle ? `（${candidate.shortTitle}）` : ""}
        </span>
        {candidate.maxFundingLabel && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            <Landmark className="size-3" aria-hidden="true" />
            {candidate.maxFundingLabel}
          </span>
        )}
      </div>
      <p className="truncate whitespace-pre-wrap break-words text-xs text-slate-600">{candidate.description}</p>
    </button>
  );
}

export function SubsidyProgramsAttachmentView({
  attachment,
}: {
  attachment: Extract<AiShellAttachment, { type: "subsidy_programs_results" }>;
}) {
  const [, navigate] = useLocation();
  if (attachment.candidates.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
      {attachment.candidates.map(c => (
        <SubsidyMiniCard key={c.slug} candidate={c} />
      ))}
      <Button
        type="button"
        onClick={() => navigate(attachment.viewAllUrl)}
        className="w-full bg-orange-600 hover:bg-orange-700 text-white"
      >
        <ArrowRight className="size-4 mr-2" aria-hidden="true" />
        查看政府補助專區{attachment.totalActiveCount > attachment.candidates.length ? `（共 ${attachment.totalActiveCount} 個方案）` : ""}
      </Button>
    </div>
  );
}
