import { useEffect, Fragment } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AppLoading } from "@/components/AppLoading";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
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
      className="relative overflow-hidden rounded-2xl bg-slate-950 flex flex-col gap-5 p-6 group"
      style={{ border: "1px solid rgba(148,163,184,0.12)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.012) 2px,rgba(255,255,255,0.012) 4px)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at top right, ${ledColor.hex}0a, transparent 65%)` }}
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500/50" />
            <span className="w-2 h-2 rounded-full bg-yellow-500/50" />
            <span className="w-2 h-2 rounded-full bg-green-500/70" />
          </span>
          <span
            className="text-[9px] font-mono tracking-[0.2em] uppercase ml-1"
            style={{ color: "rgba(148,163,184,0.4)" }}
          >
            {headerLabel}
          </span>
        </div>
        <div
          className="p-1.5 rounded-lg"
          style={{ background: `${ledColor.hex}15`, border: `1px solid ${ledColor.hex}25` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: ledColor.hex }} />
        </div>
      </div>

      <div className="relative flex-1 space-y-5">
        {rows.map(({ label, value, unit }) => (
          <div key={label}>
            <p
              className="text-[9px] font-mono uppercase tracking-[0.18em] mb-1.5"
              style={{ color: "rgba(148,163,184,0.35)" }}
            >
              {label}
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono font-bold tabular-nums"
                style={{
                  color: ledColor.hex,
                  fontSize: "2.5rem",
                  lineHeight: 1,
                  letterSpacing: "0.08em",
                  textShadow: ledColor.shadow,
                }}
              >
                {value}
              </span>
              <span className="text-sm font-mono" style={{ color: ledColor.hex, opacity: 0.45 }}>
                {unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div
        className="relative flex items-center gap-1.5 pt-3"
        style={{ borderTop: "1px solid rgba(148,163,184,0.07)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"
          style={{ boxShadow: "0 0 5px #4ade80" }}
        />
        <span className="text-[9px] font-mono tracking-widest" style={{ color: "rgba(148,163,184,0.3)" }}>
          LIVE · 數據將於平台啟動後更新
        </span>
      </div>
    </div>
  );
}

// ── Hero 全版科技城市背景 ─────────────────────────────────────────────────────

function HeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Deep tech gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg,#06091a 0%,#0c1535 30%,#100820 60%,#080c18 100%)",
        }}
      />

      {/* Tech grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right,rgba(148,163,184,0.04) 1px,transparent 1px)," +
            "linear-gradient(to bottom,rgba(148,163,184,0.04) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Atmospheric glow orbs */}
      <div
        className="absolute rounded-full"
        style={{
          top: "15%", left: "12%", width: "520px", height: "420px",
          background: "radial-gradient(ellipse,rgba(249,115,22,0.13) 0%,transparent 68%)",
          filter: "blur(35px)",
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          top: "8%", right: "10%", width: "450px", height: "380px",
          background: "radial-gradient(ellipse,rgba(168,85,247,0.13) 0%,transparent 68%)",
          filter: "blur(35px)",
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          bottom: "25%", left: "38%", width: "380px", height: "320px",
          background: "radial-gradient(ellipse,rgba(79,70,229,0.09) 0%,transparent 68%)",
          filter: "blur(28px)",
        }}
      />

      {/* Horizontal light streaks */}
      <div
        className="absolute"
        style={{
          top: "38%", left: 0, right: 0, height: "1px",
          background:
            "linear-gradient(to right,transparent 0%,rgba(249,115,22,0.22) 25%,rgba(168,85,247,0.28) 65%,transparent 100%)",
        }}
      />
      <div
        className="absolute"
        style={{
          top: "62%", left: 0, right: 0, height: "1px",
          background:
            "linear-gradient(to right,transparent 5%,rgba(99,102,241,0.15) 40%,rgba(168,85,247,0.18) 70%,transparent 100%)",
        }}
      />

      {/* City skyline + light beams + trend line */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        height="240"
        viewBox="0 0 1400 240"
        preserveAspectRatio="xMidYMax meet"
      >
        <defs>
          <linearGradient id="hbm_org" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hbm_vio" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hbm_wht" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="h_trend" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
            <stop offset="20%" stopColor="#f97316" stopOpacity="0.5" />
            <stop offset="75%" stopColor="#a855f7" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>
          <filter id="h_glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Light beams above buildings */}
        <rect x="65"   y="0" width="30" height="175" fill="url(#hbm_org)" />
        <rect x="195"  y="0" width="48" height="148" fill="url(#hbm_wht)" />
        <rect x="345"  y="0" width="34" height="162" fill="url(#hbm_vio)" />
        <rect x="492"  y="0" width="58" height="130" fill="url(#hbm_org)" />
        <rect x="625"  y="0" width="42" height="145" fill="url(#hbm_wht)" />
        <rect x="760"  y="0" width="36" height="156" fill="url(#hbm_vio)" />
        <rect x="875"  y="0" width="52" height="135" fill="url(#hbm_org)" />
        <rect x="1015" y="0" width="40" height="150" fill="url(#hbm_wht)" />
        <rect x="1155" y="0" width="44" height="140" fill="url(#hbm_vio)" />
        <rect x="1295" y="0" width="32" height="160" fill="url(#hbm_org)" />

        {/* Background (dark) buildings */}
        <rect x="0"    y="188" width="58"  height="52"  fill="#040912" />
        <rect x="62"   y="168" width="48"  height="72"  fill="#040912" />
        <rect x="115"  y="152" width="62"  height="88"  fill="#040912" />
        <rect x="182"  y="172" width="38"  height="68"  fill="#040912" />
        <rect x="225"  y="142" width="78"  height="98"  fill="#040912" />
        <rect x="308"  y="162" width="42"  height="78"  fill="#040912" />
        <rect x="355"  y="118" width="95"  height="122" fill="#040912" />
        <rect x="455"  y="158" width="48"  height="82"  fill="#040912" />
        <rect x="508"  y="106" width="118" height="134" fill="#040912" />
        <rect x="632"  y="148" width="52"  height="92"  fill="#040912" />
        <rect x="690"  y="112" width="100" height="128" fill="#040912" />
        <rect x="796"  y="145" width="52"  height="95"  fill="#040912" />
        <rect x="853"  y="120" width="90"  height="120" fill="#040912" />
        <rect x="948"  y="152" width="48"  height="88"  fill="#040912" />
        <rect x="1002" y="126" width="85"  height="114" fill="#040912" />
        <rect x="1092" y="155" width="50"  height="85"  fill="#040912" />
        <rect x="1148" y="132" width="78"  height="108" fill="#040912" />
        <rect x="1232" y="158" width="46"  height="82"  fill="#040912" />
        <rect x="1284" y="140" width="65"  height="100" fill="#040912" />
        <rect x="1355" y="155" width="45"  height="85"  fill="#040912" />

        {/* Foreground buildings (slightly lighter) */}
        <rect x="28"   y="196" width="32"  height="44"  fill="#0a1020" />
        <rect x="165"  y="185" width="38"  height="55"  fill="#0a1020" />
        <rect x="420"  y="175" width="30"  height="65"  fill="#0a1020" />
        <rect x="578"  y="168" width="48"  height="72"  fill="#0a1020" />
        <rect x="745"  y="178" width="42"  height="62"  fill="#0a1020" />
        <rect x="1000" y="182" width="28"  height="58"  fill="#0a1020" />
        <rect x="1168" y="175" width="35"  height="65"  fill="#0a1020" />

        {/* Windows — orange + violet lit */}
        {/* x=355 tall building */}
        <rect x="363" y="126" width="12" height="13" fill="#fb923c" fillOpacity="0.80" rx="0.5" />
        <rect x="379" y="126" width="12" height="13" fill="#a78bfa" fillOpacity="0.65" rx="0.5" />
        <rect x="395" y="126" width="12" height="13" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="411" y="126" width="12" height="13" fill="#fb923c" fillOpacity="0.55" rx="0.5" />
        <rect x="363" y="145" width="12" height="13" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="379" y="145" width="12" height="13" fill="#fb923c" fillOpacity="0.65" rx="0.5" />
        <rect x="395" y="145" width="12" height="13" fill="#a78bfa" fillOpacity="0.55" rx="0.5" />

        {/* x=508 tallest center-left building */}
        <rect x="516" y="114" width="14" height="15" fill="#fb923c" fillOpacity="0.92" rx="0.5" />
        <rect x="534" y="114" width="14" height="15" fill="#fb923c" fillOpacity="0.72" rx="0.5" />
        <rect x="552" y="114" width="14" height="15" fill="#a78bfa" fillOpacity="0.88" rx="0.5" />
        <rect x="570" y="114" width="14" height="15" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="588" y="114" width="14" height="15" fill="#fb923c" fillOpacity="0.60" rx="0.5" />
        <rect x="516" y="135" width="14" height="15" fill="#a78bfa" fillOpacity="0.62" rx="0.5" />
        <rect x="534" y="135" width="14" height="15" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="552" y="135" width="14" height="15" fill="#fb923c" fillOpacity="0.72" rx="0.5" />
        <rect x="570" y="135" width="14" height="15" fill="#a78bfa" fillOpacity="0.62" rx="0.5" />

        {/* x=690 building */}
        <rect x="698" y="120" width="13" height="14" fill="#fb923c" fillOpacity="0.80" rx="0.5" />
        <rect x="715" y="120" width="13" height="14" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="732" y="120" width="13" height="14" fill="#a78bfa" fillOpacity="0.72" rx="0.5" />
        <rect x="749" y="120" width="13" height="14" fill="#fb923c" fillOpacity="0.55" rx="0.5" />
        <rect x="698" y="139" width="13" height="14" fill="#334155" fillOpacity="0.4"  rx="0.5" />
        <rect x="715" y="139" width="13" height="14" fill="#fb923c" fillOpacity="0.65" rx="0.5" />

        {/* x=853 building */}
        <rect x="861" y="128" width="12" height="13" fill="#fb923c" fillOpacity="0.72" rx="0.5" />
        <rect x="877" y="128" width="12" height="13" fill="#a78bfa" fillOpacity="0.68" rx="0.5" />
        <rect x="893" y="128" width="12" height="13" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="909" y="128" width="12" height="13" fill="#fb923c" fillOpacity="0.50" rx="0.5" />

        {/* x=1002 building */}
        <rect x="1010" y="134" width="12" height="13" fill="#fb923c" fillOpacity="0.68" rx="0.5" />
        <rect x="1026" y="134" width="12" height="13" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="1042" y="134" width="12" height="13" fill="#a78bfa" fillOpacity="0.60" rx="0.5" />

        {/* x=1148 building */}
        <rect x="1156" y="140" width="11" height="12" fill="#a78bfa" fillOpacity="0.65" rx="0.5" />
        <rect x="1171" y="140" width="11" height="12" fill="#fb923c" fillOpacity="0.55" rx="0.5" />
        <rect x="1186" y="140" width="11" height="12" fill="#334155" fillOpacity="0.40" rx="0.5" />

        {/* Antenna on tallest (x=508) */}
        <line x1="553" y1="106" x2="553" y2="78" stroke="#f97316" strokeWidth="1.5" strokeOpacity="0.85" />
        <circle cx="553" cy="76" r="5" fill="#f97316" fillOpacity="0.92" filter="url(#h_glow)" />
        <circle cx="553" cy="76" r="11" fill="#f97316" fillOpacity="0.10" />

        {/* Small antennas */}
        <line x1="400" y1="118" x2="400" y2="102" stroke="#f97316" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="400" cy="100" r="3" fill="#f97316" fillOpacity="0.6" />
        <line x1="730" y1="112" x2="730" y2="98" stroke="#a855f7" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="730" cy="96" r="3" fill="#a855f7" fillOpacity="0.6" />

        {/* Tech connection lines */}
        <line x1="553" y1="76" x2="400" y2="100" stroke="#f97316" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="5 7" />
        <line x1="553" y1="76" x2="730" y2="98"  stroke="#a855f7" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="5 7" />

        {/* Growth trend line */}
        <polyline
          points="0,228 140,210 280,194 420,177 560,161 700,145 840,128 980,112 1120,96 1260,80 1400,64"
          fill="none"
          stroke="url(#h_trend)"
          strokeWidth="2"
          strokeDasharray="8 4"
        />
        <polygon
          points="0,228 140,210 280,194 420,177 560,161 700,145 840,128 980,112 1120,96 1260,80 1400,64 1400,230 0,230"
          fill="url(#h_trend)"
          fillOpacity="0.04"
        />

        {/* Trend dots */}
        <circle cx="280"  cy="194" r="3.5" fill="#f97316" fillOpacity="0.55" />
        <circle cx="560"  cy="161" r="3.5" fill="#f97316" fillOpacity="0.65" />
        <circle cx="840"  cy="128" r="4"   fill="#f97316" fillOpacity="0.75" filter="url(#h_glow)" />
        <circle cx="1120" cy="96"  r="3.5" fill="#a855f7" fillOpacity="0.65" />

        {/* Horizon line */}
        <line x1="0" y1="225" x2="1400" y2="225" stroke="#f97316" strokeWidth="0.5" strokeOpacity="0.12" />

        {/* Ground */}
        <rect x="0" y="225" width="1400" height="15" fill="#020508" />
      </svg>

      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.06) 3px,rgba(0,0,0,0.06) 4px)",
        }}
      />
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

      {/* ── Hero (滿版科技城市背景) ──────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ minHeight: "640px" }}>
        <HeroBackground />

        {/* Center content */}
        <div
          className="relative z-10 flex flex-col items-center justify-center text-center px-4 sm:px-6 lg:px-8"
          style={{ minHeight: "640px", paddingTop: "6rem", paddingBottom: "7rem" }}
        >
          {/* Live pill */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{ border: "1px solid rgba(249,115,22,0.32)", background: "rgba(249,115,22,0.10)" }}
          >
            <span className="relative flex h-2 w-2">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
            </span>
            <span className="text-sm font-medium text-orange-300">免費資格評估開放中</span>
          </div>

          {/* Tagline */}
          <p
            className="text-[11px] font-mono tracking-[0.28em] uppercase mb-5"
            style={{ color: "rgba(148,163,184,0.45)" }}
          >
            數位轉型 · 智慧製造 · 產業升級
          </p>

          {/* Main title */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-5">
            <span
              style={{
                background:
                  "linear-gradient(135deg,#fb923c 0%,#f97316 28%,#e879f9 65%,#7c3aed 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 0 32px rgba(249,115,22,0.35))",
              }}
            >
              企業升級中心
            </span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-lg sm:text-xl max-w-md mb-7 leading-relaxed"
            style={{ color: "rgba(203,213,225,0.80)" }}
          >
            協助台灣企業取得政府補助與轉型資源
          </p>

          {/* Key points (inline on desktop) */}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-8">
            {["全程顧問陪跑", "免費資格評估", "提高申請成功率"].map((pt) => (
              <span
                key={pt}
                className="flex items-center gap-1.5 text-sm"
                style={{ color: "rgba(148,163,184,0.75)" }}
              >
                <CheckCircle className="w-4 h-4 text-orange-400/80 shrink-0" />
                {pt}
              </span>
            ))}
          </div>

          {/* CTA */}
          <Link href="/upgrade-center/apply">
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 text-base px-8 shadow-lg shadow-orange-500/30"
            >
              免費評估資格
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>

          {/* Mobile inline badges (hidden on lg) */}
          <div className="flex flex-wrap justify-center gap-2 mt-8 lg:hidden">
            {[
              { code: "SBIR", max: "3,000萬", hex: "#fb923c" },
              { code: "CITD", max: "500萬",   hex: "#fbbf24" },
              { code: "SIIR", max: "1,000萬", hex: "#c084fc" },
            ].map(({ code, max, hex }) => (
              <div
                key={code}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-sm"
                style={{ border: `1px solid ${hex}40`, background: `${hex}18`, color: hex }}
              >
                <span className="text-xs font-bold font-mono">{code}</span>
                <span className="text-[10px] font-mono opacity-70">最高 {max}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Desktop floating badge cards (absolute to section) ── */}

        {/* SBIR — upper right */}
        <div
          className="hidden lg:flex absolute z-20 flex-col items-center gap-1.5 rounded-2xl px-5 py-4 backdrop-blur-md"
          style={{
            top: "18%", right: "8%",
            border: "1px solid rgba(249,115,22,0.38)",
            background: "rgba(249,115,22,0.12)",
          }}
        >
          <span
            className="text-[10px] font-mono tracking-[0.18em] uppercase"
            style={{ color: "rgba(251,146,60,0.65)" }}
          >
            SBIR
          </span>
          <span
            className="text-3xl font-extrabold font-mono tabular-nums"
            style={{ color: "#fb923c", textShadow: "0 0 24px rgba(249,115,22,0.55)" }}
          >
            3,000萬
          </span>
          <span className="text-[10px] font-mono" style={{ color: "rgba(251,146,60,0.50)" }}>
            最高補助
          </span>
        </div>

        {/* CITD — right middle */}
        <div
          className="hidden lg:flex absolute z-20 flex-col items-center gap-1.5 rounded-2xl px-5 py-4 backdrop-blur-md"
          style={{
            top: "52%", right: "6%", transform: "translateY(-50%)",
            border: "1px solid rgba(245,158,11,0.38)",
            background: "rgba(245,158,11,0.12)",
          }}
        >
          <span
            className="text-[10px] font-mono tracking-[0.18em] uppercase"
            style={{ color: "rgba(251,191,36,0.65)" }}
          >
            CITD
          </span>
          <span
            className="text-3xl font-extrabold font-mono tabular-nums"
            style={{ color: "#fbbf24", textShadow: "0 0 24px rgba(245,158,11,0.55)" }}
          >
            500萬
          </span>
          <span className="text-[10px] font-mono" style={{ color: "rgba(251,191,36,0.50)" }}>
            最高補助
          </span>
        </div>

        {/* SIIR — lower left */}
        <div
          className="hidden lg:flex absolute z-20 flex-col items-center gap-1.5 rounded-2xl px-5 py-4 backdrop-blur-md"
          style={{
            bottom: "18%", left: "7%",
            border: "1px solid rgba(168,85,247,0.38)",
            background: "rgba(168,85,247,0.12)",
          }}
        >
          <span
            className="text-[10px] font-mono tracking-[0.18em] uppercase"
            style={{ color: "rgba(192,132,252,0.65)" }}
          >
            SIIR
          </span>
          <span
            className="text-3xl font-extrabold font-mono tabular-nums"
            style={{ color: "#c084fc", textShadow: "0 0 24px rgba(168,85,247,0.55)" }}
          >
            1,000萬
          </span>
          <span className="text-[10px] font-mono" style={{ color: "rgba(192,132,252,0.50)" }}>
            最高補助
          </span>
        </div>

        {/* "數位轉型 智慧製造" label — upper left */}
        <div
          className="hidden lg:flex absolute z-20 items-center gap-2.5 rounded-xl px-4 py-2.5 backdrop-blur-md"
          style={{
            top: "20%", left: "8%",
            border: "1px solid rgba(249,115,22,0.20)",
            background: "rgba(6,9,26,0.72)",
          }}
        >
          <div
            className="w-2 h-2 rounded-full bg-orange-500"
            style={{ boxShadow: "0 0 8px #f97316" }}
          />
          <div>
            <p
              className="text-[9px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "rgba(148,163,184,0.45)" }}
            >
              智慧製造
            </p>
            <p className="text-xs font-bold font-mono text-orange-300">產業升級</p>
          </div>
        </div>

        {/* "最高補助 3,000萬元" — lower right */}
        <div
          className="hidden lg:flex absolute z-20 items-center gap-2 rounded-xl px-4 py-2.5 backdrop-blur-md"
          style={{
            bottom: "20%", right: "10%",
            border: "1px solid rgba(168,85,247,0.20)",
            background: "rgba(6,9,26,0.72)",
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "#a855f7", boxShadow: "0 0 8px #a855f7" }}
          />
          <div>
            <p
              className="text-[9px] font-mono tracking-[0.2em] uppercase"
              style={{ color: "rgba(148,163,184,0.45)" }}
            >
              最高補助
            </p>
            <p className="text-xs font-bold font-mono text-violet-300">3,000 萬元</p>
          </div>
        </div>

        {/* "免費評估開放中" live dot — bottom center */}
        <div
          className="absolute z-20 bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm"
          style={{ border: "1px solid rgba(74,222,128,0.22)", background: "rgba(74,222,128,0.07)" }}
        >
          <span className="relative flex h-2 w-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
          </span>
          <span className="text-[11px] font-mono font-medium text-green-300">SYSTEM ACTIVE</span>
        </div>
      </section>

      {/* ── LED 儀表板 ────────────────────────────────────────────────────── */}
      <section className="py-16 md:py-20 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-100">平台數據</h2>
            <p className="text-slate-500 text-sm font-mono tracking-wider">CONTROL CENTER · LIVE DATA</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <LedPanel
              headerLabel="申請廠商"
              icon={Building2}
              ledColor={{ hex: "#4ade80", shadow: "0 0 10px #4ade8090, 0 0 22px #4ade8040" }}
              rows={[
                { label: "有送出申請", value: "0", unit: "家" },
                { label: "有過件",     value: "0", unit: "家" },
                { label: "過件率",     value: "0", unit: "%"  },
              ]}
            />
            <LedPanel
              headerLabel="總申請金額"
              icon={TrendingUp}
              ledColor={{ hex: "#fb923c", shadow: "0 0 10px #fb923c90, 0 0 22px #fb923c40" }}
              rows={[
                { label: "總金額", value: "0", unit: "萬元" },
              ]}
            />
            <LedPanel
              headerLabel="已結案數量"
              icon={CheckCircle}
              ledColor={{ hex: "#c084fc", shadow: "0 0 10px #c084fc90, 0 0 22px #c084fc40" }}
              rows={[
                { label: "已結案", value: "0", unit: "件" },
              ]}
            />
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

      {/* ── 申請流程（橫向） ──────────────────────────────────────────────── */}
      <section className="py-16 md:py-20 bg-muted/20">
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
                    <span className={`text-[10px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>
                      STEP {step.num}
                    </span>
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

          {/* Mobile: single/two column */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PROCESS_STEPS.map((step) => (
              <div key={step.num} className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md shrink-0`}>
                  <step.Icon className="w-4 h-4 text-white" />
                </div>
                <div className="space-y-0.5">
                  <span className={`text-[10px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>
                    STEP {step.num}
                  </span>
                  <p className="font-semibold text-sm">{step.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
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
              style={{ backgroundImage: "radial-gradient(circle,white 1px,transparent 1px)", backgroundSize: "24px 24px" }}
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
