import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { trpc } from "@/lib/trpc";
import { Megaphone, HelpCircle, CalendarCheck, X, Apple, Smartphone, MessageCircle, ChevronRight, ChevronDown } from "lucide-react";
import { MANUAL_ENTRY_ENABLED } from "@/lib/manual";

const isNativePlatform = Capacitor.isNativePlatform();

export const OXM_LINE_URL = "https://page.line.me/785bsmsr";
// OXM App 正式上架連結（與 shared/seo/brand.ts 的 BRAND.sameAs 同一組官方
// 網址）。QR 圖檔由這兩個網址產生，見 client/public/images/oxm-apple-qr.png
// 與 oxm-android-qr.png。
export const OXM_APP_STORE_URL = "https://apps.apple.com/tw/app/oxm/id6774048275";
export const OXM_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.oxmmatch.app";

// 線上預約面板的 Accordion 展開狀態：同一時間最多一個主題展開，null = 全收合。
type ReservationSection = "line" | "apple" | "android" | null;

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

async function openExternalUrl(url: string) {
  if (isNativePlatform) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {}
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// 線上預約面板的單一 Accordion 列：真正可點的 <button>，帶 aria-expanded／
// aria-controls，鍵盤（Enter／Space）由原生 button 行為支援。收合用
// max-height:0 + overflow:hidden 即時裁掉、展開放開高度，再加 200ms 透明度
// 淡入當輕量過渡（無 bounce）。內容常駐 DOM，維持 onboarding 對
// reservation-qr 的 querySelector 能運作。
function ReservationAccordionRow({
  section,
  label,
  icon,
  expandedSection,
  onToggle,
  children,
}: {
  section: Exclude<ReservationSection, null>;
  label: string;
  icon: ReactNode;
  expandedSection: ReservationSection;
  onToggle: (section: Exclude<ReservationSection, null>) => void;
  children: ReactNode;
}) {
  const expanded = expandedSection === section;
  const contentId = `reservation-${section}-content`;
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(section)}
        aria-expanded={expanded}
        aria-controls={contentId}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="shrink-0 text-orange-500">{icon}</span>
        <span className="flex-1 min-w-0 text-left">{label}</span>
        {expanded
          ? <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
          : <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />}
      </button>
      <div
        id={contentId}
        role="region"
        aria-label={label}
        className="overflow-hidden"
        /* 收合＝max-height:0 + overflow:hidden 直接裁掉（即時、無 bounce）；
           展開＝max-height:none 讓內容以自然高度呈現，超過面板高度時由外層
           body 的 overflow-y-auto 捲動。內層再做 200ms 透明度淡入淡出當作
           輕量過渡——opacity 過渡穩定，不依賴 max-height 動畫。 */
        style={{ maxHeight: expanded ? undefined : 0 }}
      >
        <div
          className={`px-3 pb-3 pt-1 space-y-2.5 transition-opacity duration-200 ease-out ${expanded ? "opacity-100" : "opacity-0"}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// 三個主題共用的 QR 呈現：responsive 尺寸、aspect-square、object-contain，
// 桌機上限 220px、手機用 min(220px, 60vw) 避免固定超大尺寸或橫向溢出。
function ReservationQr({ src, alt, onboarding }: { src: string; alt: string; onboarding?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-md p-2 mx-auto w-fit max-w-full">
      <img
        {...(onboarding ? { "data-onboarding": "reservation-qr" } : {})}
        src={src}
        alt={alt}
        loading="lazy"
        className="block aspect-square object-contain h-auto max-w-full"
        style={{ width: "min(220px, 60vw)" }}
      />
    </div>
  );
}

export default function FloatingAnnouncementButton() {
  const [, navigate] = useLocation();
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 20 });
  const [lastViewed, setLastViewedState] = useState<number>(getLastViewed);
  const [showVisitCard, setShowVisitCard] = useState(false);
  // 三個主題（LINE／Apple／Android）的 Accordion 展開狀態，單一 state 保證
  // 同時只有一個展開；null = 全收合，也是每次打開面板的預設。
  const [expandedSection, setExpandedSection] = useState<ReservationSection>(null);

  const closeVisitCard = () => {
    setShowVisitCard(false);
    setExpandedSection(null);
  };
  const toggleVisitCard = () => {
    setShowVisitCard(v => {
      if (v) setExpandedSection(null);
      return !v;
    });
  };
  const toggleSection = (section: Exclude<ReservationSection, null>) => {
    setExpandedSection(cur => (cur === section ? null : section));
  };

  // 新會員導覽最後一步（見 OnboardingTour.tsx）會 spotlight 這顆按鈕，並希望
  // 直接展示展開後的說明卡片內容，而不是只highlight收合狀態的按鈕本身；用
  // window CustomEvent 溝通，避免額外把 open/close state 提升到
  // FloatingActionStack 或另外建一個 context，維持這個元件原本自己管理
  // showVisitCard 的既有寫法。導覽 spotlight 的目標是 LINE QR
  // （data-onboarding="reservation-qr"），所以打開面板時一併展開 LINE 主題，
  // 讓 QR 實際可見、可被 scrollIntoView。
  useEffect(() => {
    const handleShow = () => { setShowVisitCard(true); setExpandedSection("line"); };
    const handleHide = () => { setShowVisitCard(false); setExpandedSection(null); };
    window.addEventListener("oxm:onboarding-show-reservation", handleShow);
    window.addEventListener("oxm:onboarding-hide-reservation", handleHide);
    return () => {
      window.removeEventListener("oxm:onboarding-show-reservation", handleShow);
      window.removeEventListener("oxm:onboarding-hide-reservation", handleHide);
    };
  }, []);

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
      {/* data-onboarding="reservation-button" 這次改包在卡片＋按鈕外層，而不是
          只放在按鈕本身：新會員導覽最後一步（見 OnboardingTour.tsx）展開説明
          卡片後，希望 spotlight 框住的是「按鈕＋展開內容」整個區塊，只量測
          按鈕本身的話，展開卡片會落在 spotlight 範圍外面。這層 wrapper 沿用
          外層 FloatingActionStack 同一套 flex-col items-end 排版，維持卡片在
          上、按鈕在下的視覺順序不變。 */}
      <div data-onboarding="reservation-button" className="flex flex-col items-end gap-2">
      {/* 預約說明展開面板（點擊按鈕後顯示，預設三個主題全收合）。
          面板高度 = header（一般區塊流）＋ body。body 才 overflow-y-auto，並把
          max-height 綁定 viewport（扣掉上下 safe-area 與下方按鈕堆疊空間），
          header 永遠在 body 上方、不被捲走——不論展開哪個 QR，面板都不會長出
          viewport、右上角關閉 X 永遠可見。 */}
      {showVisitCard && (
        <div className="w-72 max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl shadow-2xl border border-orange-100 overflow-hidden">
          {/* 面板 header（一般區塊流，恆在 body 上方） */}
          <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 flex items-center justify-between">
            <span className="text-white font-semibold text-sm">線上預約 OXM</span>
            <button
              type="button"
              onClick={closeVisitCard}
              className="text-white/80 hover:text-white transition-colors ml-2 shrink-0"
              aria-label="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* 面板內容（唯一捲動區）。max-height = 100dvh 扣掉上下 safe-area，再扣
              20rem 給面板下方的浮動按鈕堆疊（線上預約／平台公告／OXM AI，最多
              3 顆＋間距）、bottom offset（web 1.5rem／native 另加 56px 底部導覽）
              與頂部留白，確保含 header 的整個面板都落在 viewport 內。 */}
          <div className="overflow-y-auto px-3 py-3 space-y-2 max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-20rem)]">
            <ReservationAccordionRow
              section="line"
              label="LINE 聯絡 / 預約"
              icon={<MessageCircle className="w-4 h-4" />}
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
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
              <div className="flex flex-col items-center gap-1.5 py-1">
                <ReservationQr src="/images/oxm-line-qr.png" alt="OXM 官方 LINE QR Code" onboarding />
                <p className="text-xs font-semibold text-gray-600 text-center">掃描加入 OXM 官方 LINE</p>
                <p className="text-xs text-gray-400 text-center">也可以點下方按鈕直接開啟</p>
              </div>
              <button
                type="button"
                onClick={() => openExternalUrl(OXM_LINE_URL)}
                className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-semibold rounded-xl hover:from-orange-600 hover:to-amber-600 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
              >
                開啟官方 LINE 預約
              </button>
            </ReservationAccordionRow>

            <ReservationAccordionRow
              section="apple"
              label="Apple App 下載"
              icon={<Apple className="w-4 h-4" />}
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <div className="flex flex-col items-center gap-1.5 py-1">
                <ReservationQr src="/images/oxm-apple-qr.png" alt="OXM App Store 下載 QR Code" />
                <p className="text-xs font-semibold text-gray-600 text-center">iPhone / iPad 掃描前往 App Store</p>
                <p className="text-xs text-gray-400 text-center">也可以點下方按鈕直接開啟</p>
              </div>
              <button
                type="button"
                onClick={() => openExternalUrl(OXM_APP_STORE_URL)}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
              >
                前往 App Store 下載
              </button>
            </ReservationAccordionRow>

            <ReservationAccordionRow
              section="android"
              label="Android App 下載"
              icon={<Smartphone className="w-4 h-4" />}
              expandedSection={expandedSection}
              onToggle={toggleSection}
            >
              <div className="flex flex-col items-center gap-1.5 py-1">
                <ReservationQr src="/images/oxm-android-qr.png" alt="OXM Google Play 下載 QR Code" />
                <p className="text-xs font-semibold text-gray-600 text-center">Android 掃描前往 Google Play</p>
                <p className="text-xs text-gray-400 text-center">也可以點下方按鈕直接開啟</p>
              </div>
              <button
                type="button"
                onClick={() => openExternalUrl(OXM_PLAY_STORE_URL)}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
              >
                前往 Google Play 下載
              </button>
            </ReservationAccordionRow>
          </div>
        </div>
      )}

      {/* 預約說明浮動入口（主按鈕） */}
      <button
        onClick={toggleVisitCard}
        aria-label="線上預約"
        aria-expanded={showVisitCard}
        className={`${btnBase} bg-gradient-to-r from-orange-500 to-amber-500`}
      >
        <CalendarCheck className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline text-sm">線上預約</span>
      </button>
      </div>

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
