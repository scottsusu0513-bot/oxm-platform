import { useLocation } from "wouter";
import { Calendar, ArrowRight, Star, Trophy, Building2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiShellAttachment } from "@/contexts/AiShellContext";

/**
 * Phase 6B（見對話中「找消息」，比照 FactorySearchAttachment.tsx 的設計）：
 * 這個元件只負責「卡片＋查看全部按鈕」這個 Tool Result 的機器可讀部分，不
 * 生成任何文字說明——找到什麼、有沒有符合、0 results 怎麼講，全部由
 * server/ai/responseComposer.ts 生成，顯示在這則 assistant 訊息的 content
 * 裡。url／viewAllUrl 都是 server 端組好的正式路由字串，這裡只負責 navigate。
 */
export interface NewsSearchCandidateForUi {
  id: number;
  slug: string;
  title: string;
  summary: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
  publishedAt: string | null;
  industryNames: string[];
  relevanceTier: "high" | "medium" | "general";
  url: string;
}

function newsTypeLabel(candidate: NewsSearchCandidateForUi): { label: string; Icon: typeof Star } | null {
  if (candidate.isExhibition) return { label: "展覽消息", Icon: Building2 };
  if (candidate.isCompetition) return { label: "競賽消息", Icon: Trophy };
  if (candidate.isImportant) return { label: "重要消息", Icon: Star };
  if (candidate.isCrossIndustry) return { label: "跨產業資訊", Icon: Globe };
  return null;
}

function formatDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function NewsMiniCard({ candidate }: { candidate: NewsSearchCandidateForUi }) {
  const [, navigate] = useLocation();
  const type = newsTypeLabel(candidate);
  const date = formatDate(candidate.publishedAt);
  return (
    <button
      type="button"
      onClick={() => navigate(candidate.url)}
      className="flex w-full flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{candidate.title}</span>
        {type && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            <type.Icon className="size-3" aria-hidden="true" />
            {type.label}
          </span>
        )}
      </div>
      {date && (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          <Calendar className="size-3 shrink-0" aria-hidden="true" />
          {date}
        </span>
      )}
      <p className="truncate whitespace-pre-wrap break-words text-xs text-slate-600">{candidate.summary}</p>
    </button>
  );
}

export function NewsSearchAttachmentView({
  attachment,
}: {
  attachment: Extract<AiShellAttachment, { type: "news_search_results" }>;
}) {
  const [, navigate] = useLocation();
  if (attachment.candidates.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
      {attachment.candidates.map(c => (
        <NewsMiniCard key={c.id} candidate={c} />
      ))}
      <Button
        type="button"
        onClick={() => navigate(attachment.viewAllUrl)}
        className="w-full bg-orange-600 hover:bg-orange-700 text-white"
      >
        <ArrowRight className="size-4 mr-2" aria-hidden="true" />
        查看完整消息{attachment.total > attachment.candidates.length ? `（共 ${attachment.total} 則）` : ""}
      </Button>
    </div>
  );
}
