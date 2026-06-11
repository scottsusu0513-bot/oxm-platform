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
  factoryId: number;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}

export default function FactoryFollowButton({ factoryId, variant = "outline", size = "sm" }: Props) {
  const utils = trpc.useUtils();

  const statusQuery = trpc.community.factoryFollowStatus.useQuery({ factoryId });
  const following = statusQuery.data?.following ?? false;
  const notify = statusQuery.data?.notifyNewDiscussions ?? true;

  const followMut = trpc.community.followFactory.useMutation({
    onSuccess: () => {
      utils.community.factoryFollowStatus.invalidate({ factoryId });
      toast.success("已追蹤此工廠，有新討論時會通知你");
    },
    onError: (e) => toast.error(e.message),
  });

  const unfollowMut = trpc.community.unfollowFactory.useMutation({
    onSuccess: () => {
      utils.community.factoryFollowStatus.invalidate({ factoryId });
      toast.success("已取消追蹤");
    },
    onError: (e) => toast.error(e.message),
  });

  const isPending = followMut.isPending || unfollowMut.isPending;

  if (!following) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={statusQuery.isLoading || isPending}
        onClick={() => followMut.mutate({ factoryId, notifyNewDiscussions: true })}
        className="gap-1.5"
      >
        <Bell className="w-3.5 h-3.5" />
        追蹤工廠
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size={size}
          disabled={isPending}
          className="gap-1"
        >
          <Bell className="w-3.5 h-3.5 fill-current" />
          已追蹤
          <ChevronDown className="w-3 h-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => followMut.mutate({ factoryId, notifyNewDiscussions: !notify })}
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
          onClick={() => unfollowMut.mutate({ factoryId })}
        >
          <BellOff className="w-3.5 h-3.5 mr-2" />
          取消追蹤工廠
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
