import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import {
  ArrowRight, CheckCircle, Zap, Building2, Users, BarChart3,
  ClipboardList, ClipboardCheck, FileText, Send, Briefcase,
  ArrowDown, TrendingUp,
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
    cardCls: "border-orange-200 bg-orange-50",
    stepCls: "text-orange-600",
  },
  {
    Icon: ClipboardCheck,
    num: "02",
    title: "OXM 資格初審",
    desc: "OXM 專業團隊審查資料，確認符合政府補助基本申請資格",
    accent: "from-amber-500 to-yellow-500",
    cardCls: "border-amber-200 bg-amber-50",
    stepCls: "text-amber-600",
  },
  {
    Icon: Users,
    num: "03",
    title: "媒合合作顧問",
    desc: "依企業類型與目標計畫，媒合最適合的政府計畫顧問團隊",
    accent: "from-teal-500 to-green-500",
    cardCls: "border-teal-200 bg-teal-50",
    stepCls: "text-teal-600",
  },
  {
    Icon: Building2,
    num: "04",
    title: "專人到廠評估",
    desc: "顧問親赴貴廠進行深度訪查，全面評估申請條件與優化方向",
    accent: "from-sky-500 to-cyan-500",
    cardCls: "border-sky-200 bg-sky-50",
    stepCls: "text-sky-600",
  },
  {
    Icon: FileText,
    num: "05",
    title: "撰寫計畫",
    desc: "顧問協助撰寫完整政府計畫書，確保內容符合審查標準",
    accent: "from-indigo-500 to-violet-500",
    cardCls: "border-indigo-200 bg-indigo-50",
    stepCls: "text-indigo-600",
  },
  {
    Icon: Send,
    num: "06",
    title: "送出申請",
    desc: "提交完整計畫書至主管機關，OXM 全程追蹤審查進度",
    accent: "from-violet-500 to-purple-600",
    cardCls: "border-violet-200 bg-violet-50",
    stepCls: "text-violet-600",
  },
];

// ── KPI Widget ────────────────────────────────────────────────────────────────

function KPIWidget({
  icon: Icon,
  value,
  suffix,
  label,
  sub,
  accent,
}: {
  icon: React.ElementType;
  value: number;
  suffix: string;
  label: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6 flex flex-col gap-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className={`p-2.5 rounded-xl bg-gradient-to-br ${accent} shadow-sm`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <span className="text-xs text-muted-foreground px-2.5 py-1 bg-muted rounded-full font-medium">累計</span>
      </div>
      <div>
        <div className="flex items-end gap-1.5">
          <span className="text-4xl font-extrabold tabular-nums tracking-tight">{value}</span>
          <span className="text-base text-muted-foreground mb-1 font-medium">{suffix}</span>
        </div>
        <p className="text-sm font-semibold text-foreground mt-1">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
      <div className="relative w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${accent} rounded-full w-1`} />
      </div>
    </div>
  );
}

// ── Hero 科技視覺 ─────────────────────────────────────────────────────────────

function HeroTechVisual() {
  return (
    <div className="hidden lg:block relative h-[400px] select-none" aria-hidden="true">
      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(to right,#64748b 1px,transparent 1px),linear-gradient(to bottom,#64748b 1px,transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      {/* Glow orbs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-orange-400/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-52 h-52 bg-violet-400/15 rounded-full blur-2xl pointer-events-none" />

      {/* SVG lines */}
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <line x1="50%" y1="50%" x2="22%" y2="26%" stroke="url(#lg1)" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1="50%" y1="50%" x2="78%" y2="20%" stroke="url(#lg1)" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1="50%" y1="50%" x2="16%" y2="74%" stroke="url(#lg1)" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1="50%" y1="50%" x2="83%" y2="70%" stroke="url(#lg1)" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1="22%" y1="26%" x2="78%" y2="20%" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 6" opacity="0.3" />
        <line x1="16%" y1="74%" x2="83%" y2="70%" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 6" opacity="0.3" />
      </svg>

      {/* Central OXM node */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-violet-600 shadow-xl shadow-orange-500/30 flex flex-col items-center justify-center text-white z-10">
        <Zap className="w-6 h-6 mb-0.5" />
        <span className="text-xs font-extrabold tracking-wide">OXM</span>
      </div>

      {/* SBIR node */}
      <div className="absolute z-10" style={{ top: "16%", left: "16%", transform: "translate(-50%,-50%)" }}>
        <div className="w-[90px] rounded-xl border border-orange-200 bg-white/90 shadow-md p-2 text-center backdrop-blur-sm">
          <span className="text-sm font-extrabold text-orange-600 block">SBIR</span>
          <span className="text-[10px] text-orange-400 font-medium">最高 3,000萬</span>
        </div>
      </div>

      {/* CITD node */}
      <div className="absolute z-10" style={{ top: "12%", left: "78%", transform: "translate(-50%,-50%)" }}>
        <div className="w-[90px] rounded-xl border border-amber-200 bg-white/90 shadow-md p-2 text-center backdrop-blur-sm">
          <span className="text-sm font-extrabold text-amber-600 block">CITD</span>
          <span className="text-[10px] text-amber-400 font-medium">最高 500萬</span>
        </div>
      </div>

      {/* SIIR node */}
      <div className="absolute z-10" style={{ top: "76%", left: "14%", transform: "translate(-50%,-50%)" }}>
        <div className="w-[90px] rounded-xl border border-violet-200 bg-white/90 shadow-md p-2 text-center backdrop-blur-sm">
          <span className="text-sm font-extrabold text-violet-600 block">SIIR</span>
          <span className="text-[10px] text-violet-400 font-medium">最高 1,000萬</span>
        </div>
      </div>

      {/* Enterprise node */}
      <div className="absolute z-10" style={{ top: "72%", left: "84%", transform: "translate(-50%,-50%)" }}>
        <div className="w-14 h-14 rounded-full border border-slate-200 bg-white/90 shadow-md flex flex-col items-center justify-center backdrop-blur-sm">
          <Building2 className="w-5 h-5 text-slate-500 mb-0.5" />
          <span className="text-[9px] text-slate-400 font-medium">企業</span>
        </div>
      </div>

      {/* Consultant node */}
      <div className="absolute z-10" style={{ top: "40%", left: "91%", transform: "translate(-50%,-50%)" }}>
        <div className="w-14 h-14 rounded-full border border-slate-200 bg-white/90 shadow-md flex flex-col items-center justify-center backdrop-blur-sm">
          <Users className="w-5 h-5 text-slate-500 mb-0.5" />
          <span className="text-[9px] text-slate-400 font-medium">顧問</span>
        </div>
      </div>

      {/* Status badge */}
      <div className="absolute bottom-6 right-4 z-10 rounded-xl border border-green-200 bg-white/90 shadow-md px-3 py-2 flex items-center gap-2 backdrop-blur-sm">
        <span className="relative flex h-2 w-2">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <span className="text-xs font-medium text-green-700">免費評估開放中</span>
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading || !user || user.role !== "admin") return <AppLoading />;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業升級中心｜OXM</title>
        <meta
          name="description"
          content="OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。"
        />
      </Helmet>

      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse at 15% 50%, oklch(0.95 0.04 50) 0%, transparent 55%), radial-gradient(ellipse at 85% 30%, oklch(0.96 0.03 295) 0%, transparent 50%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(to right,#64748b 1px,transparent 1px),linear-gradient(to bottom,#64748b 1px,transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: copy */}
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-200 bg-orange-50 text-orange-700 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
              </span>
              免費資格評估開放中
            </div>

            <div className="space-y-3">
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
                <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">
                  企業升級中心
                </span>
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                協助台灣企業取得政府補助與轉型資源
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["SBIR", "CITD", "SIIR"] as const).map((tag) => (
                <span key={tag} className="px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-sm font-semibold text-foreground">
                  {tag}
                </span>
              ))}
              <span className="px-3 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-sm font-semibold text-orange-700">
                最高補助 3,000 萬元
              </span>
            </div>

            <ul className="space-y-2.5">
              {[
                "全程顧問陪跑，從評估到送件",
                "媒合最適合您企業的計畫類型",
                "專人到廠評估，提高申請成功率",
              ].map((pt) => (
                <li key={pt} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle className="w-4 h-4 text-orange-500 shrink-0" />
                  {pt}
                </li>
              ))}
            </ul>

            <Link href="/upgrade-center/apply">
              <Button
                size="lg"
                className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 text-base px-8 shadow-lg shadow-orange-500/25"
              >
                免費評估資格
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          {/* Right: tech visual */}
          <HeroTechVisual />
        </div>
      </section>

      {/* ── KPI Dashboard ─────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">平台數據</h2>
            <p className="text-muted-foreground text-sm">數據將在平台正式啟動後持續更新</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <KPIWidget icon={BarChart3} value={0} suffix="件" label="已媒合案件數" sub="含 SBIR・CITD・SIIR 全類型" accent="from-orange-500 to-amber-500" />
            <KPIWidget icon={TrendingUp} value={0} suffix="萬" label="已協助申請金額" sub="政府計畫核准補助總額" accent="from-violet-500 to-indigo-500" />
            <KPIWidget icon={Briefcase} value={0} suffix="家" label="合作企業數" sub="台灣各產業合作廠商" accent="from-teal-500 to-cyan-500" />
          </div>
        </div>
      </section>

      {/* ── 補助方案 ──────────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">主要補助方案</h2>
            <p className="text-muted-foreground">OXM 協助媒合最適合您企業的政府計畫</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {SUBSIDY_PLANS.map((plan) => (
              <div
                key={plan.code}
                className="rounded-2xl border border-border bg-background flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                <div className={`h-1.5 bg-gradient-to-r ${plan.topBar}`} />
                <div className="p-6 flex flex-col gap-4 flex-1">
                  <div className="flex items-center justify-between">
                    <span className={`px-3 py-1 rounded-full text-sm font-extrabold tracking-wide ${plan.badgeCls}`}>
                      {plan.code}
                    </span>
                    <span className="text-xs text-muted-foreground">政府補助計畫</span>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <h3 className="font-bold text-lg leading-snug">{plan.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{plan.desc}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <span className="text-xs text-muted-foreground font-medium">最高補助金額</span>
                    <span className={`text-xl font-extrabold bg-gradient-to-r ${plan.maxCls} bg-clip-text text-transparent`}>
                      {plan.max}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 申請流程 Timeline ─────────────────────────────────────────────── */}
      <section className="py-16 md:py-20 bg-muted/20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold">申請流程</h2>
            <p className="text-muted-foreground">六個步驟，OXM 企業升級顧問全程陪跑</p>
          </div>

          <div>
            {PROCESS_STEPS.map((step, i) => (
              <div key={step.num} className="flex gap-5">
                {/* Left: icon + connector */}
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md`}>
                    <step.Icon className="w-5 h-5 text-white" />
                  </div>
                  {i < PROCESS_STEPS.length - 1 && (
                    <div className="flex flex-col items-center py-2 gap-1">
                      <div className="w-px h-8 bg-border" />
                      <ArrowDown className="w-3 h-3 text-muted-foreground/40" />
                    </div>
                  )}
                </div>

                {/* Right: card */}
                <div style={{ paddingBottom: i < PROCESS_STEPS.length - 1 ? "8px" : "0" }} className="flex-1">
                  <div className={`rounded-xl border ${step.cardCls} p-4 flex items-start gap-3`}>
                    <span className={`text-xs font-extrabold opacity-60 shrink-0 mt-0.5 ${step.stepCls}`}>
                      STEP {step.num}
                    </span>
                    <div className="space-y-0.5">
                      <p className="font-semibold text-sm leading-snug">{step.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-amber-500 to-violet-600 p-10 md:p-16 text-white text-center space-y-6 shadow-xl shadow-orange-500/20">
            <div
              className="absolute inset-0 pointer-events-none opacity-10"
              aria-hidden="true"
              style={{
                backgroundImage:
                  "radial-gradient(circle,white 1px,transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
            <div className="relative space-y-4">
              <h2 className="text-2xl md:text-3xl font-extrabold">不確定適合哪項補助？</h2>
              <p className="text-white/80 text-lg">讓 OXM 協助免費評估，找到最適合您企業的計畫</p>
              <div className="pt-2">
                <Link href="/upgrade-center/apply">
                  <Button size="lg" className="bg-white text-orange-600 hover:bg-orange-50 border-0 text-base px-8 font-bold shadow-lg">
                    立即免費評估
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
