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
    <div className="relative overflow-hidden rounded-2xl bg-slate-950 flex flex-col gap-5 p-6 group"
      style={{ border: "1px solid rgba(148,163,184,0.12)" }}
    >
      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.012) 2px,rgba(255,255,255,0.012) 4px)",
        }}
      />
      {/* Hover glow */}
      <div
        className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `radial-gradient(ellipse at top right, ${ledColor.hex}0a, transparent 65%)` }}
      />

      {/* Header */}
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

      {/* Data rows */}
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
              <span
                className="text-sm font-mono"
                style={{ color: ledColor.hex, opacity: 0.45 }}
              >
                {unit}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom status */}
      <div className="relative flex items-center gap-1.5 pt-3" style={{ borderTop: "1px solid rgba(148,163,184,0.07)" }}>
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

// ── Hero 智慧城市視覺 ─────────────────────────────────────────────────────────

function HeroSmartVisual() {
  return (
    <div
      className="hidden lg:block relative h-[480px] select-none overflow-hidden rounded-2xl"
      aria-hidden="true"
      style={{ border: "1px solid rgba(148,163,184,0.12)" }}
    >
      {/* Dark background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950" />

      {/* Tech grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right,rgba(148,163,184,0.06) 1px,transparent 1px)," +
            "linear-gradient(to bottom,rgba(148,163,184,0.06) 1px,transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Glow orbs */}
      <div
        className="absolute top-1/4 left-1/3 w-72 h-72 rounded-full blur-3xl pointer-events-none"
        style={{ background: "rgba(249,115,22,0.10)" }}
      />
      <div
        className="absolute bottom-1/3 right-1/4 w-52 h-52 rounded-full blur-2xl pointer-events-none"
        style={{ background: "rgba(168,85,247,0.10)" }}
      />

      {/* CRT scanlines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.5) 2px,rgba(255,255,255,0.5) 4px)",
        }}
      />

      {/* Main SVG: city skyline + growth trend + antennas */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 460 480"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="trendLine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
            <stop offset="30%" stopColor="#f97316" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="trendFill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.07" />
          </linearGradient>
          <filter id="dotGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="antGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── City buildings ─────────────────────────────────────────────── */}
        {/* Left cluster */}
        <rect x="0" y="355" width="32" height="125" fill="#1e293b" rx="1" />
        <rect x="36" y="375" width="20" height="105" fill="#0f172a" rx="1" />
        <rect x="60" y="310" width="40" height="170" fill="#1e293b" rx="1" />
        <rect x="104" y="355" width="23" height="125" fill="#0f172a" rx="1" />
        <rect x="131" y="278" width="46" height="202" fill="#1e293b" rx="1" />

        {/* Center-left */}
        <rect x="181" y="340" width="26" height="140" fill="#0f172a" rx="1" />

        {/* Tallest/central */}
        <rect x="211" y="250" width="56" height="230" fill="#1e293b" rx="1" />

        {/* Center-right */}
        <rect x="271" y="360" width="20" height="120" fill="#0f172a" rx="1" />
        <rect x="295" y="290" width="40" height="190" fill="#1e293b" rx="1" />
        <rect x="339" y="325" width="26" height="155" fill="#0f172a" rx="1" />
        <rect x="369" y="305" width="34" height="175" fill="#1e293b" rx="1" />
        <rect x="407" y="358" width="22" height="122" fill="#0f172a" rx="1" />
        <rect x="433" y="335" width="27" height="145" fill="#1e293b" rx="1" />

        {/* Ground */}
        <rect x="0" y="458" width="460" height="22" fill="#0f172a" />

        {/* ── Windows ─────────────────────────────────────────────────────── */}
        {/* Left building */}
        <rect x="4" y="362" width="7" height="8" fill="#fb923c" fillOpacity="0.75" rx="0.5" />
        <rect x="15" y="362" width="7" height="8" fill="#334155" fillOpacity="0.5" rx="0.5" />
        <rect x="4" y="376" width="7" height="8" fill="#334155" fillOpacity="0.4" rx="0.5" />
        <rect x="15" y="376" width="7" height="8" fill="#fb923c" fillOpacity="0.5" rx="0.5" />

        {/* x=60 building */}
        <rect x="64" y="318" width="9" height="10" fill="#fb923c" fillOpacity="0.80" rx="0.5" />
        <rect x="77" y="318" width="9" height="10" fill="#334155" fillOpacity="0.4" rx="0.5" />
        <rect x="88" y="318" width="9" height="10" fill="#a78bfa" fillOpacity="0.65" rx="0.5" />
        <rect x="64" y="334" width="9" height="10" fill="#334155" fillOpacity="0.4" rx="0.5" />
        <rect x="77" y="334" width="9" height="10" fill="#fb923c" fillOpacity="0.60" rx="0.5" />
        <rect x="88" y="334" width="9" height="10" fill="#fb923c" fillOpacity="0.45" rx="0.5" />

        {/* x=131 tall building */}
        <rect x="135" y="286" width="10" height="11" fill="#fb923c" fillOpacity="0.90" rx="0.5" />
        <rect x="149" y="286" width="10" height="11" fill="#a78bfa" fillOpacity="0.70" rx="0.5" />
        <rect x="163" y="286" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="135" y="303" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="149" y="303" width="10" height="11" fill="#fb923c" fillOpacity="0.65" rx="0.5" />
        <rect x="163" y="303" width="10" height="11" fill="#a78bfa" fillOpacity="0.55" rx="0.5" />
        <rect x="135" y="320" width="10" height="11" fill="#a78bfa" fillOpacity="0.60" rx="0.5" />
        <rect x="149" y="320" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />

        {/* x=211 tallest */}
        <rect x="215" y="258" width="11" height="12" fill="#fb923c" fillOpacity="0.95" rx="0.5" />
        <rect x="230" y="258" width="11" height="12" fill="#fb923c" fillOpacity="0.80" rx="0.5" />
        <rect x="245" y="258" width="11" height="12" fill="#a78bfa" fillOpacity="0.90" rx="0.5" />
        <rect x="215" y="276" width="11" height="12" fill="#a78bfa" fillOpacity="0.65" rx="0.5" />
        <rect x="230" y="276" width="11" height="12" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="245" y="276" width="11" height="12" fill="#fb923c" fillOpacity="0.75" rx="0.5" />
        <rect x="215" y="294" width="11" height="12" fill="#fb923c" fillOpacity="0.55" rx="0.5" />
        <rect x="230" y="294" width="11" height="12" fill="#a78bfa" fillOpacity="0.70" rx="0.5" />
        <rect x="245" y="294" width="11" height="12" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="215" y="312" width="11" height="12" fill="#a78bfa" fillOpacity="0.50" rx="0.5" />
        <rect x="230" y="312" width="11" height="12" fill="#fb923c" fillOpacity="0.60" rx="0.5" />

        {/* x=295 building */}
        <rect x="299" y="298" width="10" height="11" fill="#fb923c" fillOpacity="0.70" rx="0.5" />
        <rect x="313" y="298" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="325" y="298" width="10" height="11" fill="#a78bfa" fillOpacity="0.60" rx="0.5" />
        <rect x="299" y="315" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="313" y="315" width="10" height="11" fill="#fb923c" fillOpacity="0.50" rx="0.5" />

        {/* x=369 building */}
        <rect x="373" y="313" width="10" height="11" fill="#fb923c" fillOpacity="0.60" rx="0.5" />
        <rect x="387" y="313" width="10" height="11" fill="#334155" fillOpacity="0.40" rx="0.5" />
        <rect x="395" y="313" width="10" height="11" fill="#a78bfa" fillOpacity="0.55" rx="0.5" />

        {/* ── Antenna on tallest ──────────────────────────────────────────── */}
        <line x1="239" y1="250" x2="239" y2="222" stroke="#f97316" strokeWidth="1.5" strokeOpacity="0.85" />
        <circle cx="239" cy="220" r="4.5" fill="#f97316" fillOpacity="0.9" filter="url(#antGlow)" />
        <circle cx="239" cy="220" r="9" fill="#f97316" fillOpacity="0.12" />

        {/* Tech connection lines from antenna */}
        <line x1="239" y1="220" x2="154" y2="278" stroke="#f97316" strokeOpacity="0.18" strokeWidth="0.8" strokeDasharray="4 5" />
        <line x1="239" y1="220" x2="315" y2="288" stroke="#a855f7" strokeOpacity="0.18" strokeWidth="0.8" strokeDasharray="4 5" />

        {/* Small antenna on x=131 building */}
        <line x1="154" y1="278" x2="154" y2="262" stroke="#f97316" strokeWidth="1" strokeOpacity="0.5" />
        <circle cx="154" cy="260" r="2.5" fill="#f97316" fillOpacity="0.6" />

        {/* ── Growth trend line ────────────────────────────────────────────── */}
        <polyline
          points="20,440 80,395 145,348 210,298 275,245 340,192 400,142 450,98"
          fill="none"
          stroke="url(#trendLine)"
          strokeWidth="2.5"
          strokeDasharray="6 3"
        />
        <polygon
          points="20,440 80,395 145,348 210,298 275,245 340,192 400,142 450,98 450,458 20,458"
          fill="url(#trendFill)"
        />

        {/* Trend data points */}
        {([[80, 395], [210, 298], [340, 192], [450, 98]] as [number, number][]).map(([cx, cy]) => (
          <circle key={`${cx}`} cx={cx} cy={cy} r={cx === 450 ? 5.5 : 3} fill="#f97316" fillOpacity={cx === 450 ? 0.95 : 0.55} filter={cx === 450 ? "url(#dotGlow)" : undefined} />
        ))}
        <circle cx="450" cy="98" r="11" fill="#f97316" fillOpacity="0.10" />

        {/* Upward arrow at tip */}
        <polyline points="444,106 450,96 456,106" fill="none" stroke="#f97316" strokeWidth="2" strokeOpacity="0.9" strokeLinejoin="round" />
      </svg>

      {/* Subsidy badges (top) */}
      <div className="absolute top-4 left-4 right-4 flex gap-2 flex-wrap">
        {[
          { code: "SBIR", max: "3,000萬", border: "rgba(249,115,22,0.30)", bg: "rgba(249,115,22,0.10)", text: "#fb923c", dot: "#f97316" },
          { code: "CITD", max: "500萬",   border: "rgba(245,158,11,0.30)", bg: "rgba(245,158,11,0.10)", text: "#fbbf24", dot: "#f59e0b" },
          { code: "SIIR", max: "1,000萬", border: "rgba(168,85,247,0.30)", bg: "rgba(168,85,247,0.10)", text: "#c084fc", dot: "#a855f7" },
        ].map(({ code, max, border, bg, text, dot }) => (
          <div
            key={code}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg backdrop-blur-sm"
            style={{ border: `1px solid ${border}`, background: bg }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
            <span className="text-[11px] font-mono font-bold" style={{ color: text }}>{code}</span>
            <span className="text-[10px] font-mono" style={{ color: text, opacity: 0.7 }}>最高 {max}</span>
          </div>
        ))}
      </div>

      {/* Mini control panel (right side) */}
      <div
        className="absolute top-14 right-4 w-[140px] rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(148,163,184,0.10)", background: "rgba(15,23,42,0.88)", backdropFilter: "blur(10px)" }}
      >
        <div
          className="flex items-center gap-1.5 px-3 py-2"
          style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-green-400"
            style={{ boxShadow: "0 0 5px #4ade80" }}
          />
          <span className="text-[9px] font-mono tracking-[0.15em] uppercase" style={{ color: "rgba(148,163,184,0.4)" }}>
            STATUS
          </span>
        </div>
        <div className="p-3 space-y-2.5">
          {[
            { label: "評估中", val: "0", color: "#fb923c" },
            { label: "媒合中", val: "0", color: "#c084fc" },
            { label: "申請中", val: "0", color: "#4ade80" },
          ].map(({ label, val, color }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono" style={{ color: "rgba(148,163,184,0.4)" }}>{label}</span>
                <span
                  className="text-[12px] font-mono font-bold"
                  style={{ color, textShadow: `0 0 8px ${color}80` }}
                >
                  {val}
                </span>
              </div>
              <div className="h-0.5 rounded-full" style={{ background: "rgba(148,163,184,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: "0%", background: color }} />
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 pb-3">
          <div
            className="text-[8px] font-mono uppercase tracking-[0.15em] mb-1.5"
            style={{ color: "rgba(148,163,184,0.3)" }}
          >
            UPGRADE IDX
          </div>
          <div className="flex items-end gap-0.5 h-8">
            {[12, 24, 18, 36, 30, 48, 42, 60, 55, 72].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  background: i === 9 ? "#f97316" : `rgba(249,115,22,${0.12 + (i / 9) * 0.22})`,
                  boxShadow: i === 9 ? "0 0 6px #f9731660" : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom: live status */}
      <div
        className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm"
        style={{ border: "1px solid rgba(74,222,128,0.22)", background: "rgba(74,222,128,0.07)" }}
      >
        <span className="relative flex h-2 w-2">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
        </span>
        <span className="text-[11px] font-mono font-medium text-green-300">免費評估開放中</span>
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
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
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

          {/* Right: smart city visual */}
          <HeroSmartVisual />
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
            {/* Panel 1: 申請廠商 */}
            <LedPanel
              headerLabel="申請廠商"
              icon={Building2}
              ledColor={{ hex: "#4ade80", shadow: "0 0 10px #4ade8090, 0 0 22px #4ade8040" }}
              rows={[
                { label: "有送出申請", value: "0", unit: "家" },
                { label: "有過件", value: "0", unit: "家" },
                { label: "過件率", value: "0", unit: "%" },
              ]}
            />

            {/* Panel 2: 總申請金額 */}
            <LedPanel
              headerLabel="總申請金額"
              icon={TrendingUp}
              ledColor={{ hex: "#fb923c", shadow: "0 0 10px #fb923c90, 0 0 22px #fb923c40" }}
              rows={[
                { label: "總金額", value: "0", unit: "萬元" },
              ]}
            />

            {/* Panel 3: 已結案數量 */}
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

          {/* Mobile: single column */}
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
