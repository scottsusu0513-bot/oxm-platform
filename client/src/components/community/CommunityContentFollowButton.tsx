import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

interface Props {
  contentId: number;
  contentType?: "discussion" | "bid";
}

export default function CommunityContentFollowButton({ contentId, contentType = "discussion" }: Props) {
  const utils = trpc.useUtils();

  const statusQuery = trpc.community.contentFollowStatus.useQuery({ contentType, contentId });
  const following = statusQuery.data?.following ?? false;

  const followMut = trpc.community.followContent.useMutation({
    onSuccess: () => {
      utils.community.contentFollowStatus.invalidate({ contentType, contentId });
      toast.success("已追蹤此討論，有新留言時會通知你");
    },
    onError: (e) => toast.error(e.message),
  });

  const unfollowMut = trpc.community.unfollowContent.useMutation({
    onSuccess: () => {
      utils.community.contentFollowStatus.invalidate({ contentType, contentId });
      toast.success("已取消追蹤");
    },
    onError: (e) => toast.error(e.message),
  });

  const isPending = followMut.isPending || unfollowMut.isPending;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={statusQuery.isLoading || isPending}
      onClick={() => {
        if (following) unfollowMut.mutate({ contentType, contentId });
        else followMut.mutate({ contentType, contentId });
      }}
      className="h-8 gap-1.5 text-xs"
    >
      {following ? (
        <>
          <BellOff className="w-3.5 h-3.5" />
          取消追蹤
        </>
      ) : (
        <>
          <Bell className="w-3.5 h-3.5" />
          追蹤討論
        </>
      )}
    </Button>
  );
}
