import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import type { HandoffEligibleServiceKey } from "@shared/ai/handoffServices";

/**
 * Phase 5：顧問案件卡片上的「AI導件」低調標記＋「AI 初判」Dialog——五個顧問
 * 案件頁共用同一組元件，Dialog 內容依 serviceKey 分流渲染（政府補助固定
 * 8 欄；其餘四個服務只是一段短摘要），不是同一套 universal template（見對話
 * 中「七」「三十四」）。文案固定用「AI導件」，不用「AI推薦／AI審核／AI合格」
 * 這類容易被誤解成資格認證的字樣（見「三十五」）。
 */
export interface AiAssessmentData {
  status: "pending" | "completed" | "failed";
  assessmentJson: Record<string, unknown> | null;
}

const GOV_SUBSIDY_FIELD_ORDER: { key: string; label: string }[] = [
  { key: "primaryRecommendation", label: "主推薦" },
  { key: "secondaryRecommendation", label: "次推薦" },
  { key: "currentProblem", label: "企業目前問題" },
  { key: "rdStatus", label: "研發情況" },
  { key: "equipmentNeed", label: "設備需求及目的" },
  { key: "tariffImpact", label: "關稅影響" },
  { key: "selfFundingCapacity", label: "自籌能力" },
  { key: "aiReasoning", label: "AI 判斷理由" },
];

/** 低調小標記，只表示「這筆案件是從 OXM AI 對話承接過來」，不代表任何資格審核結果。 */
export function AiOriginBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400">
      <Sparkles className="h-3 w-3" />
      AI導件
    </span>
  );
}

function AssessmentBody({ serviceKey, assessment }: { serviceKey: HandoffEligibleServiceKey; assessment: AiAssessmentData }) {
  if (assessment.status === "pending") {
    return <p className="py-6 text-center text-sm text-muted-foreground">AI 初判整理中</p>;
  }
  if (assessment.status === "failed") {
    return <p className="py-6 text-center text-sm text-muted-foreground">AI 初判暫時無法完成，案件資料本身不受影響。</p>;
  }
  const data = assessment.assessmentJson ?? {};
  if (serviceKey === "gov_subsidy") {
    return (
      <div className="space-y-3">
        {GOV_SUBSIDY_FIELD_ORDER.map(f => (
          <div key={f.key} className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{f.label}</div>
            <div className="text-sm break-words whitespace-pre-wrap">{String(data[f.key] ?? "未提供")}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <p className="min-w-0 text-sm leading-relaxed break-words whitespace-pre-wrap">
      {String(data.summary ?? "未提供")}
    </p>
  );
}

export function AiAssessmentDialogTrigger({
  serviceKey,
  assessment,
}: {
  serviceKey: HandoffEligibleServiceKey;
  assessment: AiAssessmentData;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs">
          <Sparkles className="h-3 w-3" />
          AI 初判
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI 初判</DialogTitle>
          <DialogDescription>
            以下為 OXM AI 根據企業對話與最終申請資料整理的初步方向，實際方案仍由顧問依最新規定與企業條件確認。
          </DialogDescription>
        </DialogHeader>
        <AssessmentBody serviceKey={serviceKey} assessment={assessment} />
      </DialogContent>
    </Dialog>
  );
}
