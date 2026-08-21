import { useEffect, useRef, useState, type CSSProperties } from "react";
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
   * target（例如最後一步的 LINE 客服卡片）。 */
  targetKeys: readonly string[];
  title: string;
  description: string;
  /** 只有窄螢幕（找不到 desktop target、改用 mobile fallback target）才會
   *額外顯示的補充說明。 */
  mobileNote?: string;
};

const STEPS: readonly StepDef[] = [
  {
    targetKeys: ["create-factory"],
    title: "先建立你的工廠",
    description: "完成工廠資料後，讓其他企業能在 OXM 找到你，也能開始使用更多企業服務。",
  },
  {
    targetKeys: ["search-factory"],
    title: "尋找新的合作夥伴",
    description: "依產業、地區與需求搜尋全台工廠，找到新的供應商或合作夥伴。",
  },
  {
    targetKeys: ["services-nav", "services-menu"],
    title: "探索 OXM 的產業服務",
    description: "除了找工廠，你也可以透過 OXM 尋找企業資源、人才、品牌服務、產業消息與交流內容。",
    mobileNote: "點擊右上角選單，即可查看 OXM 的六大主要服務入口。",
  },
  {
    targetKeys: [],
    title: "需要協助，直接找 OXM",
    description: "不知道該從哪開始，或平台操作遇到問題，都可以直接加入 OXM LINE 詢問。",
  },
];

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
  const [resolvedTargetKey, setResolvedTargetKey] = useState<string | null>(null);

  const targetElRef = useRef<HTMLElement | null>(null);
  const scrolledForStepRef = useRef<number>(-1);

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

  const currentStep = STEPS[step];

  // 每次 step 改變時：找 target → （必要時）捲進 viewport → 量測位置。
  //
  // 這裡用「有限次數重試」而不是找一次就放棄：Home 頁面是透過
  // React.lazy() 載入的（見 client/src/App.tsx），這個 effect 第一次執行
  // 的當下，Home 內容（尤其是頁面下半部的 CTA 區塊）不一定已經掛載完成，
  // 若只嘗試一次找不到就直接判定「target 找不到」並顯示 fallback，會誤判
  // 成永久性的「target missing」，即使該 target 幾百毫秒後就會出現。重試
  // 視窗設在最多約 2 秒（20 次 × 100ms），找到後立即停止；真的等不到才視
  // 為第二十八節要求的「target 找不到」安全 fallback。
  //
  // 捲動這裡刻意不用 behavior:"smooth"：實測發現 smooth 捲動搭配「捲動後
  // 再用固定延遲重新量測」的寫法，量到的位置經常還是捲動前的舊位置（疑似
  // smooth 動畫本身的時間跟任何固定延遲都對不上，導致量測時機不穩定）。
  // 改用瀏覽器預設（相當於立即跳轉）的 scrollIntoView，呼叫後立刻同步呼叫
  // getBoundingClientRect() 量測——瀏覽器在下一次讀取版面相關屬性前會強制
  // 完成 reflow，因此這裡量到的一定是捲動後的正確位置。
  useEffect(() => {
    if (!open) return;

    if (currentStep.targetKeys.length === 0) {
      targetElRef.current = null;
      setRect(null);
      setTargetMissing(false);
      setResolvedTargetKey(null);
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
        targetElRef.current = el;
        setTargetMissing(false);
        setResolvedTargetKey(el.getAttribute("data-onboarding"));

        if (scrolledForStepRef.current !== step) {
          scrolledForStepRef.current = step;
          el.scrollIntoView({ block: "center" });
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        return;
      }

      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        targetElRef.current = null;
        setRect(null);
        setTargetMissing(true);
        setResolvedTargetKey(null);
        console.warn(`[OnboardingTour] step ${step} target not found: ${currentStep.targetKeys.join(", ")}`);
        return;
      }
      timeoutId = window.setTimeout(tryResolve, RETRY_DELAY_MS);
    };

    tryResolve();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [open, step, currentStep]);

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
        mobileNote={targetMissing ? undefined : currentStep.mobileNote}
        showMobileNote={resolvedTargetKey === "services-menu"}
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
  mobileNote,
  showMobileNote,
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
  mobileNote?: string;
  showMobileNote?: boolean;
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

  if (isMobile) {
    // Mobile：一律固定在畫面下方，不硬貼 target 旁邊，避免超出 viewport。
    containerClassName =
      "fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] mx-auto max-w-sm";
  } else if (rect && typeof window !== "undefined") {
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
    // 沒有 target（最後一步／target 找不到的 fallback）：置中顯示。
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
        {showMobileNote && mobileNote && (
          <p className="text-sm text-muted-foreground leading-relaxed">{mobileNote}</p>
        )}

        {isLineStep && (
          <div className="flex flex-col items-center gap-2 py-2">
            <img
              src="/images/oxm-line-qr.png"
              alt="OXM 官方 LINE QR Code"
              className="w-32 h-32 rounded-md border object-contain"
            />
            <a
              href={OXM_LINE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-orange-600 hover:underline"
            >
              加入 OXM LINE
            </a>
          </div>
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
