import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  targetType: "post" | "comment";
  targetId: number;
  initialCount?: number;
  initialReacted?: boolean;
  disabled?: boolean;
}

export default function CommunityReactionButton({ targetType, targetId, initialCount = 0, initialReacted = false, disabled }: Props) {
  const utils = trpc.useUtils();

  // 不可用 initialData 塞入硬編碼 0／false——全域 staleTime 是 60 秒，
  // initialData 會被視為「剛剛才取得」的新鮮資料，導致 mount 後不會真的打
  // API 覆蓋掉這個假值，使用者重新整理／回訪時會看到錯誤的「未按讚、0
  // 個讚」，即使伺服器端資料正確。改為讓 query 自然 fetch，loading 階段的
  // 顯示只靠下面的 render-time fallback（?? initialCount／?? initialReacted），
  // 不寫回 cache。
  const summaryQuery = trpc.community.reactionSummary.useQuery(
    { targetType, targetId, reactionType: "helpful" },
  );

  const toggleMut = trpc.community.toggleReaction.useMutation({
    onSuccess: () => {
      utils.community.reactionSummary.invalidate({ targetType, targetId, reactionType: "helpful" });
    },
    onError: (e) => toast.error(e.message),
  });

  const count = summaryQuery.data?.count ?? initialCount;
  const reacted = summaryQuery.data?.viewerReacted ?? initialReacted;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || toggleMut.isPending}
      onClick={() => toggleMut.mutate({ targetType, targetId, reactionType: "helpful" })}
      className={cn(
        "h-7 px-2 gap-1.5 text-xs transition-colors",
        reacted
          ? "text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <ThumbsUp className={cn("w-3.5 h-3.5", reacted && "fill-current")} />
      {count > 0 && <span>{count}</span>}
      <span className="hidden sm:inline">實用</span>
    </Button>
  );
}
