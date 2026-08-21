import { useState } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { trpc } from "@/lib/trpc";
import { Megaphone, BookOpen, HelpCircle, CalendarCheck, X } from "lucide-react";
import { MANUAL_ENTRY_ENABLED } from "@/lib/manual";

const isNativePlatform = Capacitor.isNativePlatform();

export const OXM_LINE_URL = "https://page.line.me/785bsmsr";

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

async function openLineUrl() {
  if (isNativePlatform) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: OXM_LINE_URL });
      return;
    } catch {}
  }
  window.open(OXM_LINE_URL, "_blank", "noopener,noreferrer");
}

export default function FloatingAnnouncementButton() {
  const [, navigate] = useLocation();
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 20 });
  const [lastViewed, setLastViewedState] = useState<number>(getLastViewed);
  const [showVisitCard, setShowVisitCard] = useState(false);

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

  // Phase 7.4（見對話中「Floating UI Stack Consolidation」）：這個元件本身
  // 不再自己 fixed 定位／portal——positioning 與 portal 現在統一由
  // FloatingActionStack.tsx 擁有（見該檔說明），這裡只回傳按鈕／卡片本身，
  // 當作那個共用 flex-col stack 裡的一組 sibling children，state／查詢／
  // 點擊行為（收藏公告已讀時間、預約卡片開合、LINE 連結）完全不變。
  return (
    <>
      {/* 預約說明展開卡片（點擊按鈕後顯示，預設收起） */}
      {showVisitCard && (
        <div className="w-72 max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl shadow-2xl border border-orange-100 overflow-hidden">
          {/* 卡片 header */}
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 flex items-center justify-between">
            <span className="text-white font-semibold text-sm">預約 OXM 到廠說明</span>
            <button
              onClick={() => setShowVisitCard(false)}
              className="text-white/80 hover:text-white transition-colors ml-2 shrink-0"
              aria-label="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* 卡片內容 */}
          <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
            <p className="text-sm text-gray-700 leading-relaxed">
              還在觀望 OXM 是否適合你的工廠？<br />
              可以透過官方 LINE 預約到廠說明，我們會簡單介紹平台功能、上架方式與未來合作方向。
            </p>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">適合：</p>
              <ul className="space-y-1">
                {[
                  "想了解 OXM 平台理念",
                  "想知道工廠如何免費曝光",
                  "想評估是否適合上架",
                  "想了解媒合、補助與產業資源",
                  "想當面交換名片與合作資訊",
                ].map(item => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <span className="shrink-0 text-orange-400 leading-relaxed">・</span>
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* QR Code 區塊 */}
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div className="bg-white rounded-xl border border-gray-200 shadow-md p-2 inline-block">
                <img
                  src="/images/oxm-line-qr.png"
                  alt="OXM 官方 LINE QR Code"
                  className="w-[130px] h-[130px] object-contain block"
                />
              </div>
              <p className="text-xs font-semibold text-gray-600 text-center">掃描加入 OXM 官方 LINE</p>
              <p className="text-xs text-gray-400 text-center">也可以點下方按鈕直接開啟</p>
            </div>
            {/* LINE CTA */}
            <button
              onClick={openLineUrl}
              className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-semibold rounded-xl hover:from-orange-600 hover:to-amber-600 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
            >
              開啟官方 LINE 預約
            </button>
          </div>
        </div>
      )}

      {/* 預約說明浮動入口（主按鈕） */}
      <button
        onClick={() => setShowVisitCard(v => !v)}
        aria-label="線上預約"
        aria-expanded={showVisitCard}
        className={`${btnBase} bg-gradient-to-r from-orange-500 to-amber-500`}
      >
        <CalendarCheck className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline text-sm">線上預約</span>
      </button>

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

      {/* 找代工指南 — 暫時隱藏，未來改造成「平台 QA 區」入口 */}
      {/* <button
        onClick={() => document.getElementById("guides")?.scrollIntoView({ behavior: "smooth" })}
        aria-label="找代工指南"
        className={`${btnBase} bg-gradient-to-r from-purple-500 to-violet-500`}
      >
        <BookOpen className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline text-sm">找代工指南</span>
      </button> */}

      {/* 平台公告（有公告才顯示） */}
      {items.length > 0 && (
        hasNew ? (
          <div className="relative">
            {/* Breathing glow halo */}
            <span className="absolute inset-0 rounded-full announce-glow pointer-events-none" />
            {/* Expanding ring waves (staggered) */}
            <span className="absolute inset-0 rounded-full announce-ripple-a pointer-events-none" />
            <span className="absolute inset-0 rounded-full announce-ripple-b pointer-events-none" />
            <button
              onClick={handleAnnouncementClick}
              aria-label="平台公告"
              className={`${btnBase} bg-gradient-to-r from-orange-500 to-purple-500 shadow-[0_0_18px_rgba(249,115,22,0.65),0_0_36px_rgba(168,85,247,0.4)]`}
            >
              <span className="absolute -top-2.5 -right-1.5 z-10 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none shadow-sm pointer-events-none select-none">
                NEW
              </span>
              <Megaphone className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline text-sm">有新公告</span>
            </button>
          </div>
        ) : (
          <button
            onClick={handleAnnouncementClick}
            aria-label="平台公告"
            className={`${btnBase} bg-gradient-to-r from-orange-500 to-purple-500`}
          >
            <Megaphone className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline text-sm">平台公告</span>
          </button>
        )
      )}
    </>
  );
}
