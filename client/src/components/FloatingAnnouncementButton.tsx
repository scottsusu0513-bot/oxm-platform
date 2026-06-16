import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { trpc } from "@/lib/trpc";
import { Megaphone, BookOpen, HelpCircle } from "lucide-react";
import { MANUAL_ENTRY_ENABLED } from "@/lib/manual";

const isNativePlatform = Capacitor.isNativePlatform();

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

// On native, AppBottomNav is 56px + safe-area-inset-bottom; add clearance above it.
const bottomStyle = isNativePlatform
  ? "calc(56px + 1.5rem + env(safe-area-inset-bottom, 0px))"
  : "calc(1.5rem + env(safe-area-inset-bottom, 0px))";

export default function FloatingAnnouncementButton() {
  const [, navigate] = useLocation();
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

  // Portal to document.body — escapes any ancestor transform/stacking-context
  // created by NativePullToRefreshLayout's contentRef or animate-page-enter.
  return createPortal(
    <div
      className="fixed right-5 z-40 flex flex-col items-end gap-2"
      style={{ bottom: bottomStyle }}
    >
      {/* 使用手冊（MANUAL_ENTRY_ENABLED 為 true 時才顯示） */}
      {MANUAL_ENTRY_ENABLED && (
        <button
          onClick={() => navigate("/manual")}
          aria-label="使用手冊"
          className={`${btnBase} bg-gradient-to-r from-orange-500 to-amber-500`}
        >
          <HelpCircle className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline text-sm">使用手冊</span>
        </button>
      )}

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
    </div>,
    document.body,
  );
}
