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
  {
    code: "研發轉型補助",
    title: "企業研發轉型與升級計畫",
    desc: "協助企業投入產品開發、技術升級、研發流程優化與轉型布局，強化長期競爭力。",
    tags: ["產品開發", "技術升級", "轉型布局"],
    max: "4,000 萬元",
    topBar: "from-teal-500 to-cyan-500",
    badgeCls: "bg-teal-100 text-teal-700",
    maxCls: "from-teal-500 to-cyan-500",
  },
  {
    code: "海外通路計畫",
    title: "海外市場拓展與通路布局",
    desc: "協助企業評估海外市場、建立通路合作、參展推廣與品牌能見度，提升國際接單機會。",
    tags: ["海外市場", "通路拓展", "品牌推廣"],
    max: "2,000 萬元",
    topBar: "from-sky-500 to-blue-500",
    badgeCls: "bg-sky-100 text-sky-700",
    maxCls: "from-sky-500 to-blue-500",
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

// ── 平台數據（後續可替換為 API 資料） ─────────────────────────────────────────

const upgradeStats = {
  appliedFactories: 0,    // 有送出申請（家）
  approvedCases: 0,       // 有過件（家）
  approvalRate: 0,        // 過件率（%）
  totalGrantAmountWan: 0, // 累積補助金額（萬元）
  completedCases: 0,      // 已結案案件數（件）
};

const fmt = (n: number, digits: number) => String(n).padStart(digits, "0");

// ── 七段數碼管數字 ────────────────────────────────────────────────────────────

function SevenSegmentNumber({
  value,
  color,
  size = "large",
}: {
  value: string;
  color: string;
  size?: "small" | "medium" | "large";
}) {
  const sizeClass = size === "large" ? "text-5xl" : size === "medium" ? "text-2xl" : "text-xl";
  const glow = `0 0 6px ${color}, 0 0 14px ${color}99, 0 0 28px ${color}44`;
  return (
    <span
      className={`relative inline-block ${sizeClass} leading-none`}
      style={{
        fontFamily:
          '"DSEG7 Classic","DS-Digital","Digital-7","Orbitron","Share Tech Mono","Courier New",ui-monospace,monospace',
        fontWeight: 700,
        letterSpacing: "0.10em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Dim ghost "8888…" simulates unlit segments */}
      <span
        aria-hidden
        className="absolute top-0 left-0 select-none pointer-events-none"
        style={{ color: `${color}15` }}
      >
        {"8".repeat(value.length)}
      </span>
      {/* Lit digits */}
      <span className="relative" style={{ color, textShadow: glow }}>
        {value}
      </span>
    </span>
  );
}

// ── 平台數據卡片 ────────────────────────────────────────────────────────────

function StatCard({
  title,
  icon: Icon,
  color,
  rows,
  bar,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  rows: { label: string; value: string; unit: string }[];
  bar?: number;
}) {
  return (
    <div
      className="rounded-xl flex flex-col overflow-hidden shadow-lg"
      style={{
        background: "#07111f",
        border: `1px solid ${color}22`,
        boxShadow: `0 4px 20px rgba(0,0,0,0.45), 0 0 24px ${color}06`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-3"
        style={{ borderBottom: `1px solid ${color}10` }}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-40" style={{ backgroundColor: color }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
          </span>
          <span className="text-[10px] font-mono tracking-[0.20em] uppercase font-semibold" style={{ color: `${color}90` }}>{title}</span>
        </div>
        <Icon className="w-3.5 h-3.5" style={{ color: `${color}50` }} />
      </div>

      {/* Body — 3-col for multi-row, big single for solo */}
      {rows.length > 1 ? (
        <div className="flex-1 flex">
          {rows.map(({ label, value, unit }, idx) => (
            <div
              key={label}
              className="flex-1 min-w-0 flex flex-col items-center justify-center text-center px-2 py-5"
              style={idx > 0 ? { borderLeft: "1px solid rgba(148,163,184,0.18)" } : {}}
            >
              <div className="text-[8px] font-mono tracking-widest uppercase mb-2" style={{ color: "rgba(148,163,184,0.35)" }}>{label}</div>
              <SevenSegmentNumber value={value} color={color} size="medium" />
              <div className="text-[10px] font-mono mt-1.5 font-semibold" style={{ color: `${color}60` }}>{unit}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center px-5 py-5">
          <div className="text-[8px] font-mono tracking-widest uppercase mb-2.5" style={{ color: "rgba(148,163,184,0.35)" }}>{rows[0].label}</div>
          <div className="flex items-baseline gap-2.5">
            <SevenSegmentNumber value={rows[0].value} color={color} size="large" />
            <span className="font-mono font-bold text-sm" style={{ color: `${color}60` }}>{rows[0].unit}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 pb-4 pt-2 space-y-2">
        {bar !== undefined && (
          <div className="h-1.5 rounded-full" style={{ background: "rgba(30,41,59,0.8)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${bar}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: "0 0 4px #4ade80" }} />
          <span className="text-[7px] font-mono tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.20)" }}>DATA PENDING LAUNCH</span>
        </div>
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
            {/* Overlay CTA — x≈65% y≈85%: below UPGRADE card, above road trail */}
            <div
              className="absolute hidden sm:flex"
              style={{ left: "65%", top: "85%", transform: "translate(-50%, -50%)" }}
            >
              <Button
                size="default"
                onClick={handleApplyClick}
                disabled={accessChecking && !!user}
                className="bg-orange-500 hover:bg-orange-600 text-white border-0 px-5 rounded-lg shadow-lg shadow-orange-500/40"
              >
                免費評估資格
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 平台數據 ────────────────────────────────────────────────────── */}
      <section className="bg-slate-50 py-8 md:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-center">
              {/* Left: title */}
              <div className="md:w-44 shrink-0 space-y-3">
                <h2 className="text-2xl font-bold text-slate-900">平台數據</h2>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 mt-1 shrink-0" style={{ boxShadow: "0 0 6px #4ade80" }} />
                  <p className="text-sm text-slate-500 leading-relaxed">數據將在平台正式啟動後持續更新</p>
                </div>
              </div>
              {/* Right: 3 stat cards */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  title="申請廠商"
                  icon={Building2}
                  color="#4ade80"
                  rows={[
                    { label: "有送出申請", value: fmt(upgradeStats.appliedFactories, 5), unit: "家" },
                    { label: "有過件",     value: fmt(upgradeStats.approvedCases, 5),    unit: "家" },
                    { label: "過件率",     value: fmt(upgradeStats.approvalRate, 2),     unit: "%" },
                  ]}
                  bar={upgradeStats.approvalRate}
                />
                <StatCard
                  title="總申請金額"
                  icon={TrendingUp}
                  color="#fb923c"
                  rows={[{ label: "累積補助金額", value: fmt(upgradeStats.totalGrantAmountWan, 5), unit: "萬元" }]}
                  bar={0}
                />
                <StatCard
                  title="已結案數量"
                  icon={CheckCircle}
                  color="#c084fc"
                  rows={[{ label: "已結案案件數", value: fmt(upgradeStats.completedCases, 5), unit: "件" }]}
                  bar={0}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 多項政府補助方案 ───────────────────────────────────────────────── */}
      <section className="py-14 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">多項政府補助方案</h2>
            <div className="w-12 h-1 bg-gradient-to-r from-orange-500 to-amber-500 mx-auto rounded-full" />
            <p className="text-muted-foreground mt-3">OXM 協助媒合適合企業階段的政府計畫</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-stretch">
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
