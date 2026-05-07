import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Megaphone } from "lucide-react";

const LS_KEY = "oxm:lastViewedAnnouncementsAt";

function getLastViewed(): number {
  try { return parseInt(localStorage.getItem(LS_KEY) ?? "0", 10); } catch { return 0; }
}

function setLastViewed(ts: number) {
  try { localStorage.setItem(LS_KEY, ts.toString()); } catch {}
}

export default function FloatingAnnouncementButton() {
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 20 });
  const [lastViewed, setLastViewedState] = useState<number>(getLastViewed);

  if (items.length === 0) return null;

  const hasNew = items.some(item => {
    const t = item.createdAt instanceof Date
      ? item.createdAt.getTime()
      : new Date(item.createdAt as string).getTime();
    return t > lastViewed;
  });

  const handleClick = () => {
    const now = Date.now();
    setLastViewed(now);
    setLastViewedState(now);
    document.getElementById("announcements")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <button
      onClick={handleClick}
      aria-label="平台公告"
      className="fixed bottom-6 right-5 z-40 flex items-center gap-2 px-4 py-2.5
        bg-gradient-to-r from-orange-500 to-purple-500 text-white font-medium
        rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5
        transition-all duration-200 select-none
        sm:px-4 sm:py-2.5"
    >
      {/* 紅點 badge */}
      {hasNew && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
      )}

      <Megaphone className="w-4 h-4 shrink-0" />

      {/* 桌機顯示文字，手機隱藏 */}
      <span className="hidden sm:inline text-sm">
        {hasNew ? "有新公告" : "平台公告"}
      </span>
    </button>
  );
}
