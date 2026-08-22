import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { OXM_LINE_URL } from "@/components/FloatingAnnouncementButton";

// 新會員 Spotlight 新手導引——只針對「導覽正式啟用日之後」建立的新會員顯示
// （判斷邏輯見 shared/onboarding.ts 的 userNeedsOnboarding，依 auth.me 回傳
// 的 needsOnboarding 欄位決定），舊會員完全不受影響。
//
// 顯示條件同時要求 !needsConsent（見下方 open 計算），確保 ConsentGate 與
// 這裡兩個 overlay 永遠不會同時出現——一個使用者不可能同時 needsConsent
// 為 true 又被判定該顯示導覽。
//
// 這不是 blocking modal（不像 ConsentGate 整頁遮蔽），而是「除了目前引導
// 的 UI 之外，其餘畫面變暗且不可操作」的 spotlight：用四塊實心背板圍住
// target，而不是單純的 box-shadow 挖洞（那樣背景仍可被點擊），確保使用者
// 只能透過導覽卡片上的按鈕控制流程，不會誤觸背景跑去別的頁面把 tour 弄亂。

type StepDef = {
  /** 依序嘗試的 data-onboarding target key；空陣列代表這一步沒有 spotlight
   * target，會置中顯示（目前四步都各自有 target，暫時沒有步驟用到這個
   * fallback，但 targetMissing 安全機制仍保留，找不到 target 時一樣會退回
   * 置中顯示）。桌機／手機的 target key 現在都指向「真正的內容」（選單
   * item、六大入口區塊、搜尋面板、線上預約區塊），不再有任何一步是「只
   * highlight 觸發按鈕、靠文案補充說明」的 fallback 設計。 */
  targetKeys: readonly string[];
  title: string;
  description: string;
};

const STEPS: readonly StepDef[] = [
  {
    targetKeys: ["factory-dashboard-desktop-item", "factory-dashboard-mobile-item"],
    title: "先從工廠後台開始",
    description: "點擊右上角帳號選單，進入工廠後台建立與管理你的工廠資料。",
  },
  {
    targetKeys: ["search-panel"],
    title: "尋找新的合作夥伴",
    description: "在這個搜尋區塊中設定產業、地區與關鍵字條件，尋找合作夥伴。",
  },
  {
    targetKeys: ["services-nav", "services-hub-mobile"],
    title: "探索 OXM 的六大主要服務",
    description: "除了找工廠，也可以從這裡尋找企業資源、人才、品牌服務、產業消息與交流內容。",
  },
  {
    targetKeys: ["reservation-button"],
    title: "需要協助，直接找 OXM",
    description: "需要協助時，可直接使用右下角的線上預約與我們聯繫。",
  },
];

/** Step 4（最後一步）手機版專用 override：桌機維持原本 spotlight 整個
 * 「線上預約」按鈕＋展開卡片（reservation-button），手機螢幕較小，改成直接
 * spotlight 卡片裡真正的 QR Code 圖片（reservation-qr，見
 * FloatingAnnouncementButton.tsx 加在 <img> 上的 data-onboarding），文案也
 * 對應改成引導使用者掃 QR Code，而不是「使用右下角線上預約」。只在
 * isMobile 時套用（見 currentStep 的組合邏輯），桌機的 STEPS[3] 完全不受
 * 影響。 */
const MOBILE_LAST_STEP_OVERRIDE: Pick<StepDef, "targetKeys" | "description"> = {
  targetKeys: ["reservation-qr"],
  description: "需要平台操作、上架或合作協助時，可以掃描 QR Code，直接透過官方 LINE 與我們聯繫。",
};

const OVERLAY_COLOR = "rgba(0, 0, 0, 0.55)";
const TARGET_PADDING = 8;
const MOBILE_BREAKPOINT = 768;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 依序嘗試每個 key，回傳第一個「真的存在且目前有實際版面（不是
 * display:none）」的元素——用 offsetParent 判斷可見性，不假定固定的
 * breakpoint 寬度（同一個 target 在不同裝置下是否可見，完全依實際 DOM
 * 版面決定）。 */
function resolveVisibleTarget(keys: readonly string[]): HTMLElement | null {
  for (const key of keys) {
    const el = document.querySelector<HTMLElement>(`[data-onboarding="${key}"]`);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

/** Mobile 專用「程式性定位」：把 step 的 target 移到一個看得到、也不會被
 * 導覽卡蓋住的位置。只在手機呼叫，桌機完全不會執行到這裡（見呼叫端的
 * isMobile 判斷）。
 *
 * - Step 1／Step 3（index 0／2）：target 都在 Navbar.tsx 手機漢堡選單自己
 *   的 overflow-y-auto 容器裡，跟外層被鎖住的 body 是兩個獨立的捲動情境，
 *   呼叫 scrollIntoView 只會捲選單內部，不會影響外層背景。
 * - Step 2（index 1）：搜尋面板在一般頁面流裡，外層 body 目前是
 *   position:fixed 鎖定畫面（見 OnboardingTour 的背景鎖定 effect），本身
 *   没有可捲動 overflow，scrollIntoView 對它沒有效果；改成直接調整鎖定中
 *   的 body.style.top 位移量，把面板移到畫面上半部——這仍然是「程式性定
 *   位」而不是解鎖，使用者仍然完全無法自己滑動背景。
 * - Step 4（index 3）：手機版 target 是展開卡片裡的 QR Code 圖片
 *   （reservation-qr，見 MOBILE_LAST_STEP_OVERRIDE），這個卡片本身是
 *   FloatingAnnouncementButton.tsx 內部 max-h-[60vh] overflow-y-auto 的
 *   獨立捲動容器，跟 Step 1／Step 3 的選單同一類情況：呼叫 scrollIntoView
 *   只會捲卡片自己的內部捲動，不會動到外層被鎖住的背景，用來確保 QR Code
 *   本身完整落在可視範圍內、不被卡片自己的捲動裁掉。
 */
function revealMobileTarget(el: HTMLElement, stepIndex: number): void {
  if (stepIndex === 1) {
    const r = el.getBoundingClientRect();
    const desiredTop = 88; // 略低於手機版 header 高度，留一點呼吸空間
    const delta = r.top - desiredTop;
    if (Math.abs(delta) > 4) {
      const body = document.body;
      const currentTop = parseFloat(body.style.top || "0") || 0;
      body.style.top = `${currentTop - delta}px`;
    }
    return;
  }
  if (stepIndex === 0 || stepIndex === 2 || stepIndex === 3) {
    el.scrollIntoView({ block: "center" });
  }
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export function OnboardingTour() {
  const { user, isAuthenticated } = useAuth();
  const [pathname] = useLocation();
  const utils = trpc.useUtils();
  const isMobile = useIsMobileViewport();

  const [step, setStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const targetElRef = useRef<HTMLElement | null>(null);
  const revealedForStepRef = useRef<number>(-1);

  const completeOnboarding = trpc.auth.completeOnboarding.useMutation({
    onSuccess: async () => {
      setErrorMsg(null);
      await utils.auth.me.invalidate();
    },
    onError: (err) => {
      setErrorMsg(err.message || "操作失敗，請稍後再試一次。");
    },
  });

  const typedUser = user as { needsConsent?: boolean; needsOnboarding?: boolean } | null;
  const needsConsent = Boolean(typedUser?.needsConsent);
  const needsOnboarding = Boolean(typedUser?.needsOnboarding);
  const open = isAuthenticated && !needsConsent && needsOnboarding && pathname === "/";

  // Step 4（最後一步）在手機版套用 QR Code override（見
  // MOBILE_LAST_STEP_OVERRIDE 說明）；桌機（!isMobile）或其他步驟一律用
  // STEPS 原始定義，不受影響。這個「effective step」同時餵給 target 解析
  // effect 與下方 JSX 渲染，兩處看到的 targetKeys／description 保證一致。
  //
  // 用 useMemo 而不是每次 render 都直接 spread 出新物件：下方 target 解析
  // effect 把 currentStep 放進 dependency array，若每次 render 都產生新的
  // object reference，該 effect 會被誤判成「依賴改變」而重新執行；效果內部
  // 呼叫 setRect／setTargetMissing 又會觸發 re-render，形成無窮迴圈（曾經
  // 實際造成測試時 heap out of memory）。用 useMemo 讓 reference 只在
  // step／isMobile 真的改變時才變化。
  const isLastStepIndex = step === STEPS.length - 1;
  const currentStep: StepDef = useMemo(
    () => (isLastStepIndex && isMobile ? { ...STEPS[step], ...MOBILE_LAST_STEP_OVERRIDE } : STEPS[step]),
    [step, isLastStepIndex, isMobile]
  );

  // 導覽開啟期間鎖住背景捲動與捲動「位置」本身：只用 overflow:hidden 沒辦法
  // 保證畫面完全靜止（元件內部仍可能呼叫 scrollIntoView／window.scrollTo 之
  // 類的程式性捲動，且部分瀏覽器下 overflow:hidden 仍可能被程式性捲動繞
  // 過），改用跟 Navbar.tsx 手機選單開啟時完全相同的「body position:fixed +
  // 負值 top」做法（見該檔同名註解）：body 被 fixed 在原本捲動位置，之後不
  // 管任何程式或使用者輸入怎麼嘗試捲動，畫面都不會真的移動；離開時還原
  // inline style 並用 window.scrollTo 精準跳回原本的 scrollY，不留下永久
  // 鎖死或位置偏移。
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // Step 1（工廠後台 item）與 Step 3（六大主要入口區塊）都需要展示選單裡
  // 「真正的內容」，而不只是選單的觸發按鈕，所以要主動打開對應選單：桌機只
  // 有 Step 1 需要（帳號下拉），手機 Step 1／Step 3 都需要打開同一個漢堡選
  // 單。離開這一步或導覽結束時透過 cleanup 收合，不留下選單開啟狀態（見
  // Navbar.tsx 監聽同一組 CustomEvent 名稱）。isMobile 沿用同一份
  // useIsMobileViewport()，跟 target 解析／卡片版型共用同一個判斷依據。
  //
  // 只 dispatch 一次會有時機問題：Navbar 掛在 Home 頁面（React.lazy() 載
  // 入，見下方 target 解析 effect 的說明）裡，這個 effect 第一次執行時
  // Navbar 的監聽器不一定已經掛上，唯一一次的事件可能直接被錯過，選單就永
  // 遠不會自動打開。改成跟 target 解析同一種「短間隔重複 dispatch」策略，
  // 直到離開這一步才停止；選單已經開著時重複 dispatch「打開」是無害的
  // no-op，不會有副作用。
  const stepNeedsMenu = step === 0 || step === 2;
  useEffect(() => {
    if (!open) return;
    if (!stepNeedsMenu) return;
    if (!isMobile && step !== 0) return; // 桌機只有 Step 1 需要打開帳號下拉
    const openEvent = isMobile ? "oxm:onboarding-open-mobile-menu" : "oxm:onboarding-open-factory-menu-desktop";
    const closeEvent = isMobile ? "oxm:onboarding-close-mobile-menu" : "oxm:onboarding-close-factory-menu-desktop";
    window.dispatchEvent(new Event(openEvent));
    const intervalId = window.setInterval(() => {
      window.dispatchEvent(new Event(openEvent));
    }, 100);
    return () => {
      window.clearInterval(intervalId);
      window.dispatchEvent(new Event(closeEvent));
    };
  }, [open, step, stepNeedsMenu, isMobile]);

  // 最後一步 spotlight 對準右下角的「線上預約」按鈕時，順便把它原本收合的
  // 說明卡片展開，讓使用者直接看到內容，而不是只 highlight 收合狀態的按鈕
  // 外觀；離開這一步或導覽結束時透過 cleanup 收回，不留下多餘的展開狀態
  // （見 FloatingAnnouncementButton.tsx 監聽同一組 CustomEvent 名稱）。
  useEffect(() => {
    if (!open) return;
    if (step !== STEPS.length - 1) return;
    window.dispatchEvent(new Event("oxm:onboarding-show-reservation"));
    return () => {
      window.dispatchEvent(new Event("oxm:onboarding-hide-reservation"));
    };
  }, [open, step]);

  // 每次 step 改變時：找 target → （手機部分步驟）程式性定位 → 量測位置。
  //
  // 這裡用「有限次數重試」而不是找一次就放棄：Home 頁面是透過
  // React.lazy() 載入的（見 client/src/App.tsx），這個 effect 第一次執行
  // 的當下，Home 內容（尤其是頁面下半部的 CTA 區塊）不一定已經掛載完成，
  // 若只嘗試一次找不到就直接判定「target 找不到」並顯示 fallback，會誤判
  // 成永久性的「target missing」，即使該 target 幾百毫秒後就會出現。重試
  // 視窗設在最多約 2 秒（20 次 × 100ms），找到後立即停止；真的等不到才視
  // 為「target 找不到」安全 fallback。
  //
  // Desktop 完全不呼叫任何程式性捲動（維持已驗收行為：導覽開啟期間背景捲
  // 動位置一律固定，見上方 body position:fixed 鎖定）；找到的 target 若目
  // 前不在可視範圍內，直接視為「這次量測不算」繼續重試，不會為了對齊
  // target 移動整個頁面。
  //
  // Mobile 則改成「使用者不能自己滑，但程式可以為了排版把 target 定位好」：
  // - Step 1／Step 3 的 target 都在手機漢堡選單自己的 overflow-y-auto 容器
  //   裡，呼叫 scrollIntoView 只會捲選單自己的內部捲動，不會動到外層被鎖住
  //   的背景。
  // - Step 2 的搜尋面板在一般頁面流裡，外層 body 目前是 position:fixed 鎖
  //   定畫面、本身沒有可捲動的 overflow，scrollIntoView 對它沒有作用；改成
  //   直接調整鎖定中的 body.style.top 位移量，把面板移到畫面上半部——這一
  //   樣是「程式性定位」，不是把鎖打開，使用者仍然完全無法自己滑動。
  // revealedForStepRef 確保每個 step 只執行一次定位，避免每次 retry／
  // remeasure 都重新疊加位移。
  useEffect(() => {
    if (!open) return;

    if (currentStep.targetKeys.length === 0) {
      targetElRef.current = null;
      setRect(null);
      setTargetMissing(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;
    const MAX_ATTEMPTS = 20;
    const RETRY_DELAY_MS = 100;

    const tryResolve = () => {
      if (cancelled) return;

      const el = resolveVisibleTarget(currentStep.targetKeys);
      if (el) {
        if (isMobile && revealedForStepRef.current !== step) {
          revealedForStepRef.current = step;
          revealMobileTarget(el, step);
        }
        const r = el.getBoundingClientRect();
        const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
        if (inViewport) {
          targetElRef.current = el;
          setTargetMissing(false);
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          return;
        }
      }

      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        targetElRef.current = null;
        setRect(null);
        setTargetMissing(true);
        console.warn(`[OnboardingTour] step ${step} target not found or not in viewport: ${currentStep.targetKeys.join(", ")}`);
        return;
      }
      timeoutId = window.setTimeout(tryResolve, RETRY_DELAY_MS);
    };

    tryResolve();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [open, step, currentStep, isMobile]);

  // resize／scroll 時持續重新量測（rAF 節流），確保 responsive 情況下
  // target 位置維持準確。
  useEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const remeasure = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const el = targetElRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [open]);

  if (!open) return null;

  const isFirstStep = step === 0;
  const isLastStep = step === STEPS.length - 1;
  const hasSpotlight = rect != null && !targetMissing;

  const handlePrev = () => setStep((s) => Math.max(s - 1, 0));
  const handleNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  // 略過／完成共用同一支 mutation：兩者持久化效果相同，成功後
  // needsOnboarding 變 false、整個 tour 自然不再 render；失敗則保留 tour
  // 並顯示錯誤，不 optimistic 關閉。
  const handleFinishOrSkip = () => {
    if (completeOnboarding.isPending) return;
    setErrorMsg(null);
    completeOnboarding.mutate();
  };

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="新手導覽">
      {hasSpotlight && rect ? (
        <SpotlightMask rect={rect} />
      ) : (
        <div className="fixed inset-0" style={{ background: OVERLAY_COLOR }} />
      )}

      <OnboardingCard
        step={step}
        totalSteps={STEPS.length}
        rect={hasSpotlight ? rect : null}
        title={currentStep.title}
        description={currentStep.description}
        isMobile={isMobile}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        isPending={completeOnboarding.isPending}
        errorMsg={errorMsg}
        onPrev={handlePrev}
        onNext={handleNext}
        onSkip={handleFinishOrSkip}
        onFinish={handleFinishOrSkip}
      />
    </div>
  );
}

/** 四塊實心背板圍住 target（不是 pointer-events:none 的 box-shadow 挖
 * 洞）：確保背景真的無法被點擊，只有 target 區域本身維持原本亮度；target
 * 區域再疊一層透明但會攔截點擊的層，避免使用者真的點下去提早觸發背景動
 * 作、跳去別的 route 把 tour 弄亂。 */
function SpotlightMask({ rect }: { rect: TargetRect }) {
  const top = Math.max(rect.top - TARGET_PADDING, 0);
  const left = Math.max(rect.left - TARGET_PADDING, 0);
  const width = rect.width + TARGET_PADDING * 2;
  const height = rect.height + TARGET_PADDING * 2;

  return (
    <>
      <div className="fixed left-0 right-0 top-0" style={{ height: top, background: OVERLAY_COLOR }} />
      <div className="fixed left-0 right-0 bottom-0" style={{ top: top + height, background: OVERLAY_COLOR }} />
      <div className="fixed" style={{ top, left: 0, width: left, height, background: OVERLAY_COLOR }} />
      <div className="fixed" style={{ top, left: left + width, right: 0, height, background: OVERLAY_COLOR }} />
      {/* 高亮框：橘色細邊 + 輕微 glow，target 本身保持原本亮度 */}
      <div
        className="fixed rounded-lg pointer-events-none ring-2 ring-orange-400"
        style={{ top, left, width, height, boxShadow: "0 0 0 4px rgba(249,115,22,0.15)" }}
      />
      {/* target 區域的透明點擊攔截層：導覽期間不允許真的觸發背景按鈕 */}
      <div className="fixed" style={{ top, left, width, height }} />
    </>
  );
}

function OnboardingCard({
  step,
  totalSteps,
  rect,
  title,
  description,
  isMobile,
  isFirstStep,
  isLastStep,
  isPending,
  errorMsg,
  onPrev,
  onNext,
  onSkip,
  onFinish,
}: {
  step: number;
  totalSteps: number;
  rect: TargetRect | null;
  title: string;
  description: string;
  isMobile: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  isPending: boolean;
  errorMsg: string | null;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const CARD_WIDTH = 360;
  const MARGIN = 16;

  let containerClassName: string;
  let style: CSSProperties = {};
  let isCentered = false;

  if (rect && isMobile) {
    // Mobile：導覽卡必須避開 target，不能沿用桌機那套「置中對齊 target 水平
    // 中心」的窄卡片版型（手機沒有那麼多水平空間）。改成整段全寬（留左右
    // margin），放在 target 上方或下方——哪一側剩餘空間比較多就放哪一側，
    // 確保卡片跟 target 兩者都完整可見、不互相重疊。每個 step 的 target 形
    // 狀差異很大（選單 item／整個搜尋面板／六大入口區塊／QR Code 圖片），
    // 用「比較上下剩餘空間」這個通用規則，不需要每個 step 各寫一套判斷。
    //
    // 用 window.visualViewport?.height 取代 window.innerHeight：手機瀏覽器
    // （尤其 Safari）下方工具列會動態顯示／收起，innerHeight 在工具列還顯示
    // 時可能回報「工具列收起後才有」的較大高度，導致算出來的 spaceBelow 比
    // 實際可視空間更大、卡片因此被工具列蓋住一角；visualViewport.height 才
    // 是當下實際可視的高度。
    //
    // 「below」（卡片放在 target 下方）這個分支原本用
    // top: rect.bottom + MARGIN 往下長，完全沒有下邊界，卡片內容較高時就會
    // 整個往下溢出可視範圍（這次要修的 Step 2 問題）。改成跟「above」分支
    // 同一種做法——一律從真正的可視範圍下緣往上錨定（bottom + 安全間距 +
    // safe-area-inset-bottom），卡片高度不管多少都不可能超出可視範圍下緣；
    // 由於這個分支只會在「下方剩餘空間 >= 上方剩餘空間」時才會被選到，錨定
    // 在下緣附近仍然落在 target 下方，不會反過來蓋住 target。
    const viewportH =
      typeof window !== "undefined" ? window.visualViewport?.height ?? window.innerHeight : 800;
    const SAFE_BOTTOM_GAP = 20; // 16–24px 呼吸空間
    const spaceBelow = viewportH - (rect.top + rect.height);
    const spaceAbove = rect.top;
    const placeAbove = spaceBelow < spaceAbove;
    containerClassName = "fixed inset-x-4";
    style = placeAbove
      ? { bottom: `calc(${Math.max(viewportH - rect.top + MARGIN, SAFE_BOTTOM_GAP)}px + env(safe-area-inset-bottom, 0px))` }
      : { bottom: `calc(${SAFE_BOTTOM_GAP}px + env(safe-area-inset-bottom, 0px))` };
  } else if (rect && !isMobile && typeof window !== "undefined") {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let top = rect.top + rect.height + MARGIN;
    let placeAbove = false;
    if (top + 200 > viewportH) {
      placeAbove = true;
    }
    let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    left = Math.max(MARGIN, Math.min(left, viewportW - CARD_WIDTH - MARGIN));
    containerClassName = "fixed";
    style = placeAbove
      ? { left, bottom: Math.max(viewportH - rect.top + MARGIN, MARGIN), width: CARD_WIDTH }
      : { left, top, width: CARD_WIDTH };
  } else {
    // 沒有 target（target 找不到的安全 fallback）：桌機／手機都置中顯示。
    containerClassName = "fixed inset-0 flex items-center justify-center px-4";
    isCentered = true;
  }

  const isLineStep = isLastStep;

  return (
    <div className={containerClassName} style={style}>
      <div
        className={`bg-background border rounded-lg shadow-lg p-5 space-y-3 w-full ${
          isCentered ? "max-w-sm" : ""
        }`}
      >
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-5 bg-orange-500" : "w-1.5 bg-muted"
              }`}
            />
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {step + 1} / {totalSteps}
          </span>
        </div>

        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>

        {isLineStep && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            也可以透過官方{" "}
            <a
              href={OXM_LINE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
            >
              LINE
            </a>{" "}
            聯繫我們。
          </p>
        )}

        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {!isFirstStep && (
              <Button variant="ghost" size="sm" onClick={onPrev} disabled={isPending}>
                上一步
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onSkip} disabled={isPending}>
              略過導覽
            </Button>
            {isLineStep ? (
              <Button size="sm" onClick={onFinish} disabled={isPending}>
                {isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" aria-hidden="true" />}
                完成導覽
              </Button>
            ) : (
              <Button size="sm" onClick={onNext} disabled={isPending}>
                下一步
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
