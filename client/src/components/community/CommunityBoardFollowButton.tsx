import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, BellOff, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Props {
  spaceCode: string;
}

export default function CommunityBoardFollowButton({ spaceCode }: Props) {
  const utils = trpc.useUtils();

  const statusQuery = trpc.community.boardFollowStatus.useQuery({ spaceCode });
  const following = statusQuery.data?.following ?? false;
  const notify = statusQuery.data?.notifyNewDiscussions ?? true;

  const followMut = trpc.community.followBoard.useMutation({
    onSuccess: () => {
      utils.community.boardFollowStatus.invalidate({ spaceCode });
      toast.success("已追蹤此看板");
    },
    onError: (e) => toast.error(e.message),
  });

  const unfollowMut = trpc.community.unfollowBoard.useMutation({
    onSuccess: () => {
      utils.community.boardFollowStatus.invalidate({ spaceCode });
      toast.success("已取消追蹤");
    },
    onError: (e) => toast.error(e.message),
  });

  const isPending = followMut.isPending || unfollowMut.isPending;

  if (!following) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={statusQuery.isLoading || isPending}
        onClick={() => followMut.mutate({ spaceCode, notifyNewDiscussions: true })}
        className="h-8 gap-1.5 text-xs"
      >
        <Bell className="w-3.5 h-3.5" />
        追蹤看板
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          className="h-8 gap-1 text-xs"
        >
          <Bell className="w-3.5 h-3.5 fill-current" />
          已追蹤
          <ChevronDown className="w-3 h-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => followMut.mutate({ spaceCode, notifyNewDiscussions: !notify })}
        >
          {notify ? (
            <>
              <BellOff className="w-3.5 h-3.5 mr-2" />
              關閉新討論通知
            </>
          ) : (
            <>
              <Bell className="w-3.5 h-3.5 mr-2" />
              開啟新討論通知
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => unfollowMut.mutate({ spaceCode })}
        >
          <BellOff className="w-3.5 h-3.5 mr-2" />
          取消追蹤
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
