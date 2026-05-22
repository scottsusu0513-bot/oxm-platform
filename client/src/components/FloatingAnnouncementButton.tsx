import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Megaphone, BookOpen } from "lucide-react";

const LS_KEY = "oxm:lastViewedAnnouncementsAt";

function getLastViewed(): number {
  try { return parseInt(localStorage.getItem(LS_KEY) ?? "0", 10); } catch { return 0; }
}

function setLastViewed(ts: number) {
  try { localStorage.setItem(LS_KEY, ts.toString()); } catch {}
}

const btnBase = `relative flex items-center gap-2 px-4 py-2.5
  text-white font-medium rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5
  transition-all duration-200 select-none`;

export default function FloatingAnnouncementButton() {
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 20 });
  const [lastViewed, setLastViewedState] = useState<number>(getLastViewed);

  const hasNew = items.some(item => {
    const t = item.createdAt instanceof Date
      ? item.createdAt.getTime()
      : new Date(item.createdAt as string).getTime();
    return t > lastViewed;
  });

  const handleAnnouncementClick = () => {
    const now = Date.now();
    setLastViewed(now);
    setLastViewedState(now);
    document.getElementById("announcements")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="fixed bottom-6 right-5 z-40 flex flex-col items-end gap-2">
      {/* 找代工指南 */}
      <button
        onClick={() => document.getElementById("guides")?.scrollIntoView({ behavior: "smooth" })}
        aria-label="找代工指南"
        className={`${btnBase} bg-gradient-to-r from-purple-500 to-violet-500`}
      >
        <BookOpen className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline text-sm">找代工指南</span>
      </button>

      {/* 平台公告（有公告才顯示） */}
      {items.length > 0 && (
        <button
          onClick={handleAnnouncementClick}
          aria-label="平台公告"
          className={`${btnBase} bg-gradient-to-r from-orange-500 to-purple-500`}
        >
          {hasNew && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-white" />
          )}
          <Megaphone className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline text-sm">
            {hasNew ? "有新公告" : "平台公告"}
          </span>
        </button>
      )}
    </div>
  );
}
