import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { Fragment } from "react";
import {
  ArrowRight, CheckCircle, Building2, Users,
  ClipboardList, ClipboardCheck, FileText, Send,
  TrendingUp,
} from "lucide-react";

// ── 補助方案 ──────────────────────────────────────────────────────────────────

const SUBSIDY_PLANS = [
  {
    code: "SBIR",
    title: "小型企業創新研發計畫",
    desc: "針對中小企業創新研發活動提供補助，涵蓋前期研究、可行性評估及研發計畫三個階段。",
    tags: ["研發費用補助", "可分期申請", "最廣適用"],
    max: "3,000 萬元",
    topBar: "from-orange-500 to-amber-500",
    badgeCls: "bg-orange-100 text-orange-700",
    maxCls: "from-orange-500 to-amber-500",
  },
  {
    code: "CITD",
    title: "協助傳統產業技術開發",
    desc: "專為傳統製造業設計，補助技術升級、製程改善及智慧化轉型所需研發費用。",
    tags: ["傳統產業適用", "製程技術升級", "智慧化補助"],
    max: "500 萬元",
    topBar: "from-amber-500 to-yellow-500",
    badgeCls: "bg-amber-100 text-amber-700",
    maxCls: "from-amber-500 to-yellow-500",
  },
  {
    code: "SIIR",
    title: "服務業創新研發計畫",
    desc: "鼓勵服務業廠商投入創新研發，提升服務模式與數位轉型能力。",
    tags: ["服務業適用", "數位轉型", "商業模式創新"],
    max: "1,000 萬元",
    topBar: "from-violet-500 to-indigo-500",
    badgeCls: "bg-violet-100 text-violet-700",
    maxCls: "from-violet-500 to-indigo-500",
  },
];

// ── 申請流程 ──────────────────────────────────────────────────────────────────

const PROCESS_STEPS = [
  {
    Icon: ClipboardList,
    num: "01",
    title: "填寫評估資料",
    desc: "提供企業基本資訊、研發能力與財務狀況，5 分鐘完成初步評估表單",
    accent: "from-orange-500 to-amber-500",
    stepCls: "text-orange-500",
  },
  {
    Icon: ClipboardCheck,
    num: "02",
    title: "OXM 資格初審",
    desc: "OXM 專業團隊審查資料，確認符合政府補助基本申請資格",
    accent: "from-amber-500 to-yellow-500",
    stepCls: "text-amber-500",
  },
  {
    Icon: Users,
    num: "03",
    title: "媒合合作顧問",
    desc: "依企業類型與目標計畫，媒合最適合的政府計畫顧問團隊",
    accent: "from-teal-500 to-green-500",
    stepCls: "text-teal-500",
  },
  {
    Icon: Building2,
    num: "04",
    title: "專人到廠評估",
    desc: "顧問親赴貴廠進行深度訪查，全面評估申請條件與優化方向",
    accent: "from-sky-500 to-cyan-500",
    stepCls: "text-sky-500",
  },
  {
    Icon: FileText,
    num: "05",
    title: "撰寫計畫",
    desc: "顧問協助撰寫完整政府計畫書，確保內容符合審查標準",
    accent: "from-indigo-500 to-violet-500",
    stepCls: "text-indigo-500",
  },
  {
    Icon: Send,
    num: "06",
    title: "送出申請",
    desc: "提交完整計畫書至主管機關，OXM 全程追蹤審查進度",
    accent: "from-violet-500 to-purple-600",
    stepCls: "text-violet-500",
  },
];

// ── LED 七段數碼管數字 ─────────────────────────────────────────────────────────

function SegmentNumber({
  val,
  color,
  glow,
  size = "2.5rem",
}: {
  val: string;
  color: string;
  glow: string;
  size?: string;
}) {
  const base: React.CSSProperties = {
    fontFamily: "'Courier New','Lucida Console',monospace",
    fontWeight: 900,
    letterSpacing: "0.14em",
    fontSize: size,
    lineHeight: 1,
  };
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        aria-hidden
        style={{ ...base, position: "absolute", top: 0, left: 0, color: `${color}1e`, userSelect: "none", pointerEvents: "none" }}
      >
        {"8".repeat(val.length)}
      </span>
      <span style={{ ...base, position: "relative", color, textShadow: glow }}>
        {val}
      </span>
    </span>
  );
}

// ── LED 儀表板面板 ────────────────────────────────────────────────────────────

function LedPanel({
  headerLabel,
  icon: Icon,
  ledColor,
  rows,
}: {
  headerLabel: string;
  icon: React.ElementType;
  ledColor: { hex: string; shadow: string };
  rows: { label: string; value: string; unit: string }[];
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl flex flex-col"
      style={{
        background: "linear-gradient(160deg,rgba(2,6,18,0.98) 0%,rgba(1,4,12,0.98) 100%)",
        border: `1px solid ${ledColor.hex}28`,
        boxShadow: `0 0 40px ${ledColor.hex}0a, inset 0 0 0 1px ${ledColor.hex}10`,
      }}
    >
      {/* Top accent bar */}
      <div
        className="shrink-0"
        style={{ height: 2, background: `linear-gradient(90deg,transparent 0%,${ledColor.hex}cc 30%,${ledColor.hex} 50%,${ledColor.hex}cc 70%,transparent 100%)` }}
      />
      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-35"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.30) 3px,rgba(0,0,0,0.30) 4px)" }}
      />
      {/* Corner brackets */}
      <div className="absolute top-3 right-3 w-4 h-4 pointer-events-none" style={{ borderTop: `1.5px solid ${ledColor.hex}28`, borderRight: `1.5px solid ${ledColor.hex}28` }} />
      <div className="absolute bottom-3 left-3 w-4 h-4 pointer-events-none" style={{ borderBottom: `1.5px solid ${ledColor.hex}28`, borderLeft: `1.5px solid ${ledColor.hex}28` }} />

      {/* Header */}
      <div className="relative flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ backgroundColor: ledColor.hex }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: ledColor.hex, boxShadow: `0 0 8px ${ledColor.hex}` }} />
          </span>
          <span className="text-[9px] font-mono tracking-[0.25em] uppercase" style={{ color: `${ledColor.hex}88` }}>
            {headerLabel}
          </span>
        </div>
        <Icon className="w-3.5 h-3.5 opacity-50" style={{ color: ledColor.hex }} />
      </div>

      {/* Data rows */}
      <div className="relative flex-1 px-5 pb-4 space-y-5">
        {rows.map(({ label, value, unit }) => (
          <div key={label} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono uppercase tracking-[0.22em]" style={{ color: "rgba(148,163,184,0.25)" }}>
                {label}
              </span>
              <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg,${ledColor.hex}18,transparent)` }} />
            </div>
            <div className="flex items-baseline gap-2.5">
              <SegmentNumber val={value} color={ledColor.hex} glow={ledColor.shadow} size="2.8rem" />
              <span className="text-sm font-mono" style={{ color: ledColor.hex, opacity: 0.35 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="relative flex items-center justify-between px-5 pb-4 pt-2"
        style={{ borderTop: `1px solid ${ledColor.hex}0c` }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" style={{ boxShadow: "0 0 4px #4ade80" }} />
          <span className="text-[8px] font-mono tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.20)" }}>LIVE</span>
        </div>
        <span className="text-[8px] font-mono" style={{ color: "rgba(148,163,184,0.14)" }}>DATA PENDING LAUNCH</span>
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: !!user,
  });

  const hasFactoryAccess = useMemo(() => {
    if (!user) return false;
    if (ownedFactory) return true;
    if (coManaged && coManaged.length > 0) return true;
    return false;
  }, [user, ownedFactory, coManaged]);

  const accessChecking = ownedLoading || coManagedLoading;

  const handleApplyClick = () => {
    if (!user) { setShowDialog(true); return; }
    if (accessChecking) return;
    if (!hasFactoryAccess) { setShowDialog(true); return; }
    navigate("/upgrade-center/apply");
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業升級中心｜OXM</title>
        <meta name="description" content="OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。" />
      </Helmet>

      <Navbar />

      {/* ── Hero Banner Card ───────────────────────────────────────────────── */}
      <section className="py-4 md:py-6" style={{ backgroundColor: "#06090f" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="sr-only">企業升級中心</h1>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
            <img
              src="/images/upgrade-center/hero-bg.png"
              alt="企業升級中心"
              style={{
                width: "100%",
                height: "clamp(200px, 27vw, 400px)",
                objectFit: "cover",
                objectPosition: "center 30%",
                display: "block",
              }}
            />
            {/* Bottom gradient for button readability */}
            <div
              className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(4,7,18,0.85) 0%, transparent 100%)" }}
            />
            {/* Overlay CTA */}
            <div className="absolute bottom-4 left-4 md:bottom-6 md:left-8 flex items-center gap-3">
              <Button
                size="default"
                onClick={handleApplyClick}
                disabled={accessChecking && !!user}
                className="bg-orange-500 hover:bg-orange-600 text-white border-0 px-5 rounded-lg shadow-lg shadow-orange-500/40"
              >
                免費評估資格
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <span className="hidden sm:inline text-xs font-mono text-slate-300/70 tracking-wider">
                SBIR · CITD · SIIR
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── LED 儀表板 ────────────────────────────────────────────────────── */}
      <section
        className="relative py-8 md:py-10 overflow-hidden"
        style={{
          background: "linear-gradient(180deg,#06090f 0%,#020508 70%,#040c1a 100%)",
          borderTop: "1px solid rgba(148,163,184,0.06)",
        }}
      >
        {/* Cyan grid pattern (CSS only) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(6,182,212,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(6,182,212,0.025) 1px,transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div>
            <p className="text-[9px] font-mono tracking-[0.30em] uppercase" style={{ color: "rgba(6,182,212,0.50)" }}>
              CONTROL ROOM · LIVE
            </p>
            <h2 className="text-xl font-bold text-slate-100 mt-1">平台數據</h2>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: "0 0 4px #4ade80" }} />
              <p className="text-xs font-mono text-slate-500">數據將在平台正式啟動後持續更新</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <LedPanel
              headerLabel="申請廠商"
              icon={Building2}
              ledColor={{ hex: "#4ade80", shadow: "0 0 10px #4ade8080, 0 0 22px #4ade8030" }}
              rows={[
                { label: "有送出申請", value: "0", unit: "家" },
                { label: "有過件",     value: "0", unit: "家" },
                { label: "過件率",     value: "0", unit: "%"  },
              ]}
            />
            <LedPanel
              headerLabel="總申請金額"
              icon={TrendingUp}
              ledColor={{ hex: "#fb923c", shadow: "0 0 10px #fb923c80, 0 0 22px #fb923c30" }}
              rows={[{ label: "累積補助金額", value: "0", unit: "萬元" }]}
            />
            <LedPanel
              headerLabel="已結案數量"
              icon={CheckCircle}
              ledColor={{ hex: "#c084fc", shadow: "0 0 10px #c084fc80, 0 0 22px #c084fc30" }}
              rows={[{ label: "已結案案件數", value: "0", unit: "件" }]}
            />
          </div>
        </div>
      </section>

      {/* ── 三大政府補助方案 ───────────────────────────────────────────────── */}
      <section className="py-14 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">三大政府補助方案</h2>
            <div className="w-12 h-1 bg-gradient-to-r from-orange-500 to-amber-500 mx-auto rounded-full" />
            <p className="text-muted-foreground mt-3">OXM 協助媒合最適合您企業的政府計畫</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {SUBSIDY_PLANS.map((plan) => (
              <div key={plan.code} className="rounded-2xl border border-border bg-background flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <div className={`h-1.5 bg-gradient-to-r ${plan.topBar}`} />
                <div className="p-6 flex flex-col gap-4 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`px-3 py-1 rounded-full text-sm font-extrabold tracking-wide ${plan.badgeCls}`}>{plan.code}</span>
                    <span className="text-xs text-muted-foreground">政府補助計畫</span>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <h3 className="font-bold text-lg leading-snug">{plan.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{plan.desc}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <span className="text-xs text-muted-foreground font-medium">最高補助金額</span>
                    <span className={`text-xl font-extrabold bg-gradient-to-r ${plan.maxCls} bg-clip-text text-transparent`}>{plan.max}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 申請流程 ──────────────────────────────────────────────────────── */}
      <section className="py-14 md:py-20 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">申請流程</h2>
            <p className="text-muted-foreground">六個步驟，OXM 企業升級顧問全程陪跑</p>
          </div>
          {/* Desktop: horizontal */}
          <div className="hidden lg:flex items-start">
            {PROCESS_STEPS.map((step, i) => (
              <Fragment key={step.num}>
                <div className="flex-1 flex flex-col items-center text-center gap-3 min-w-0 px-2">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md shrink-0`}>
                    <step.Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-1 w-full">
                    <span className={`text-[10px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>STEP {step.num}</span>
                    <p className="font-semibold text-sm leading-snug">{step.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <div className="flex items-start pt-4 shrink-0">
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          {/* Mobile */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PROCESS_STEPS.map((step) => (
              <div key={step.num} className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md shrink-0`}>
                  <step.Icon className="w-4 h-4 text-white" />
                </div>
                <div className="space-y-0.5">
                  <span className={`text-[10px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>STEP {step.num}</span>
                  <p className="font-semibold text-sm">{step.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-14 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-amber-500 to-violet-600 p-10 md:p-16 text-white text-center space-y-6 shadow-xl shadow-orange-500/20">
            <div
              className="absolute inset-0 pointer-events-none opacity-10"
              aria-hidden="true"
              style={{ backgroundImage: "radial-gradient(circle,white 1px,transparent 1px)", backgroundSize: "24px 24px" }}
            />
            <div className="relative space-y-4">
              <h2 className="text-2xl md:text-3xl font-extrabold">不確定適合哪項補助？</h2>
              <p className="text-white/80 text-lg">讓 OXM 協助免費評估，找到最適合您企業的計畫</p>
              <div className="pt-2">
                <Button
                  size="lg"
                  onClick={handleApplyClick}
                  disabled={accessChecking && !!user}
                  className="bg-white text-orange-600 hover:bg-orange-50 border-0 text-base px-8 font-bold shadow-lg"
                >
                  立即免費評估
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 權限不足 Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>此功能僅提供 OXM 工廠會員</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              企業升級中心評估服務目前僅提供給 OXM 工廠會員與工作室會員使用。
              <br /><br />
              如需申請政府補助評估，請先於 OXM 完成工廠或工作室註冊。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <Link href="/register-factory" onClick={() => setShowDialog(false)}>
              <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                立即註冊工廠
              </Button>
            </Link>
            <Button variant="outline" className="w-full" onClick={() => setShowDialog(false)}>
              我知道了
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
