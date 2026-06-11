import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Bell, MessageSquare, Reply, AtSign, Factory } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { CommunityNotification } from "@shared/types";

interface Props {
  notification: CommunityNotification;
  onClick?: () => void;
}

function EventIcon({ eventGroup }: { eventGroup: string }) {
  switch (eventGroup) {
    case "reply": return <Reply className="w-3.5 h-3.5 text-blue-500" />;
    case "mention": return <AtSign className="w-3.5 h-3.5 text-violet-500" />;
    case "follow": return <Bell className="w-3.5 h-3.5 text-orange-500" />;
    default: return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

export default function CommunityNotificationItem({ notification, onClick }: Props) {
  const timeAgo = formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: zhTW });

  const href = notification.postId
    ? `/community/${notification.spaceCode ?? "cross-industry"}/${notification.postId}`
    : "/community";

  return (
    <Link href={href} onClick={onClick}>
      <div className={cn(
        "flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors cursor-pointer",
        notification.isRead ? "bg-card hover:bg-muted/30" : "bg-orange-50/40 dark:bg-orange-950/10 hover:bg-orange-50/70 dark:hover:bg-orange-950/20",
      )}>
        {/* Icon */}
        <div className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          notification.isRead ? "bg-muted" : "bg-orange-100 dark:bg-orange-900/30",
        )}>
          <EventIcon eventGroup={notification.eventGroup} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {notification.actorFactoryNameSnapshot ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
                  <Factory className="w-3 h-3 shrink-0" />
                  <span className="truncate">{notification.actorFactoryNameSnapshot}</span>
                </div>
              ) : (
                notification.actorNameSnapshot && (
                  <span className="text-xs font-medium">{notification.actorNameSnapshot}</span>
                )
              )}
              <p className="text-sm leading-snug mt-0.5">{notification.message}</p>
              {notification.titleSnapshot && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">「{notification.titleSnapshot}」</p>
              )}
            </div>
            {!notification.isRead && (
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-1" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>
        </div>
      </div>
    </Link>
  );
}
