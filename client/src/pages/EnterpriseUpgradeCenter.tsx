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
  TrendingUp, Cpu, Factory, Leaf, FlaskConical,
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
      {/* Dim "off-segment" ghost layer — shows all segments dark */}
      <span
        aria-hidden
        style={{ ...base, position: "absolute", top: 0, left: 0, color: `${color}1e`, userSelect: "none", pointerEvents: "none" }}
      >
        {"8".repeat(val.length)}
      </span>
      {/* Active "on-segment" layer */}
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
      className="relative overflow-hidden rounded-2xl bg-slate-950 flex flex-col gap-4 p-5 group"
      style={{
        border: `1px solid ${ledColor.hex}28`,
        boxShadow: `0 0 28px ${ledColor.hex}08, inset 0 0 0 1px ${ledColor.hex}0a`,
      }}
    >
      {/* Top colored accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg,transparent 0%,${ledColor.hex}90 35%,${ledColor.hex}90 65%,transparent 100%)` }}
      />
      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.18) 3px,rgba(0,0,0,0.18) 4px)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Pulsing status LED */}
          <span className="relative flex h-2.5 w-2.5">
            <span
              className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-55"
              style={{ backgroundColor: ledColor.hex }}
            />
            <span
              className="relative inline-flex rounded-full h-2.5 w-2.5"
              style={{ backgroundColor: ledColor.hex, boxShadow: `0 0 7px ${ledColor.hex}` }}
            />
          </span>
          <span className="text-[9px] font-mono tracking-[0.22em] uppercase ml-0.5" style={{ color: `${ledColor.hex}88` }}>
            {headerLabel}
          </span>
        </div>
        <div className="p-1.5 rounded-lg" style={{ background: `${ledColor.hex}12`, border: `1px solid ${ledColor.hex}25` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: ledColor.hex }} />
        </div>
      </div>
      <div className="relative flex-1 space-y-5">
        {rows.map(({ label, value, unit }) => (
          <div key={label}>
            <p className="text-[9px] font-mono uppercase tracking-[0.20em] mb-2" style={{ color: "rgba(148,163,184,0.28)" }}>
              {label}
            </p>
            <div className="flex items-baseline gap-2.5">
              <SegmentNumber val={value} color={ledColor.hex} glow={ledColor.shadow} />
              <span className="text-sm font-mono" style={{ color: ledColor.hex, opacity: 0.38 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="relative flex items-center gap-1.5 pt-2" style={{ borderTop: `1px solid ${ledColor.hex}10` }}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" style={{ boxShadow: "0 0 4px #4ade80" }} />
        <span className="text-[9px] font-mono tracking-widest" style={{ color: "rgba(148,163,184,0.22)" }}>
          LIVE · 數據將於平台啟動後更新
        </span>
      </div>
    </div>
  );
}

// ── Hero 右側：透視公路 + 科技城市 SVG ────────────────────────────────────────

function HeroCityVisual() {
  return (
    <svg
      viewBox="0 0 700 480"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* Orange streak: bottom transparent → bright mid → VP fade */}
        <linearGradient id="hc_og" x1="0" y1="480" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#f97316" stopOpacity="0" />
          <stop offset="5%"   stopColor="#f97316" stopOpacity="0.82" />
          <stop offset="30%"  stopColor="#fb923c" stopOpacity="1.0" />
          <stop offset="60%"  stopColor="#fbbf24" stopOpacity="0.85" />
          <stop offset="88%"  stopColor="#fde68a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </linearGradient>

        {/* Orange white-hot core */}
        <linearGradient id="hc_og_core" x1="0" y1="480" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
          <stop offset="4%"   stopColor="#fff7ed" stopOpacity="0.96" />
          <stop offset="18%"  stopColor="#ffffff" stopOpacity="1.0" />
          <stop offset="46%"  stopColor="#fed7aa" stopOpacity="0.96" />
          <stop offset="72%"  stopColor="#f97316" stopOpacity="0.74" />
          <stop offset="92%"  stopColor="#fb923c" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>

        {/* Blue/cyan streak */}
        <linearGradient id="hc_bg" x1="0" y1="480" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#06b6d4" stopOpacity="0" />
          <stop offset="5%"   stopColor="#06b6d4" stopOpacity="0.78" />
          <stop offset="30%"  stopColor="#0ea5e9" stopOpacity="0.97" />
          <stop offset="60%"  stopColor="#38bdf8" stopOpacity="0.82" />
          <stop offset="88%"  stopColor="#7dd3fc" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
        </linearGradient>

        {/* Blue white-hot core */}
        <linearGradient id="hc_bg_core" x1="0" y1="480" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
          <stop offset="4%"   stopColor="#e0f2fe" stopOpacity="0.96" />
          <stop offset="18%"  stopColor="#ffffff" stopOpacity="1.0" />
          <stop offset="46%"  stopColor="#bae6fd" stopOpacity="0.94" />
          <stop offset="72%"  stopColor="#06b6d4" stopOpacity="0.70" />
          <stop offset="92%"  stopColor="#0ea5e9" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
        </linearGradient>

        {/* VP atmospheric radial glow (big) */}
        <radialGradient id="hc_vp" cx="350" cy="107" r="340" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#06b6d4" stopOpacity="0.58" />
          <stop offset="25%"  stopColor="#0284c7" stopOpacity="0.24" />
          <stop offset="60%"  stopColor="#0ea5e9" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </radialGradient>

        {/* Ground ambient glow — orange left */}
        <radialGradient id="hc_gl_o" cx="120" cy="455" r="310" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#f97316" stopOpacity="0.48" />
          <stop offset="45%"  stopColor="#ea580c" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>

        {/* Ground ambient glow — blue right */}
        <radialGradient id="hc_gl_b" cx="580" cy="455" r="310" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#06b6d4" stopOpacity="0.40" />
          <stop offset="45%"  stopColor="#0284c7" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
        </radialGradient>

        {/* City atmospheric haze at horizon */}
        <radialGradient id="hc_city_atm" cx="350" cy="218" r="400" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#0d2448" stopOpacity="0.90" />
          <stop offset="42%"  stopColor="#071230" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#060a14" stopOpacity="0" />
        </radialGradient>

        {/* Sky gradient */}
        <linearGradient id="hc_sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#020508" stopOpacity="0.80" />
          <stop offset="100%" stopColor="#060e1e" stopOpacity="0" />
        </linearGradient>

        {/* MEGA blur — pure glow, no source (sd=40) */}
        <filter id="hc_mega" x="-600%" y="-200%" width="1300%" height="500%">
          <feGaussianBlur stdDeviation="40"/>
        </filter>

        {/* LARGE blur — pure glow (sd=22) */}
        <filter id="hc_xlg" x="-400%" y="-150%" width="900%" height="400%">
          <feGaussianBlur stdDeviation="22"/>
        </filter>

        {/* WIDE glow + source merge (sd=13) */}
        <filter id="hc_wide" x="-250%" y="-100%" width="600%" height="300%">
          <feGaussianBlur stdDeviation="13" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>

        {/* MID glow + source (sd=6) */}
        <filter id="hc_mid" x="-150%" y="-60%" width="400%" height="220%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>

        {/* SHARP glow + source (sd=2.5) */}
        <filter id="hc_sharp" x="-60%" y="-30%" width="220%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>

        {/* Window glow */}
        <filter id="hc_win" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="3.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* ── Base ── */}
      <rect width="700" height="480" fill="#060a14"/>

      {/* Sky gradient overlay */}
      <rect width="700" height="290" fill="url(#hc_sky)"/>

      {/* ── Ground ambient glow ── */}
      <ellipse cx="120" cy="455" rx="330" ry="145" fill="url(#hc_gl_o)"/>
      <ellipse cx="580" cy="455" rx="330" ry="145" fill="url(#hc_gl_b)"/>

      {/* ── City atmospheric haze ── */}
      <ellipse cx="350" cy="218" rx="500" ry="145" fill="url(#hc_city_atm)"/>

      {/* ── Perspective road grid ── VP=(350,107) */}
      <line x1="350" y1="107" x2="0"   y2="480" stroke="#0ea5e9" strokeWidth="0.6" strokeOpacity="0.14"/>
      <line x1="350" y1="107" x2="60"  y2="480" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.10"/>
      <line x1="350" y1="107" x2="130" y2="480" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.08"/>
      <line x1="350" y1="107" x2="200" y2="480" stroke="#0ea5e9" strokeWidth="0.4" strokeOpacity="0.07"/>
      <line x1="350" y1="107" x2="275" y2="480" stroke="#0ea5e9" strokeWidth="0.4" strokeOpacity="0.06"/>
      <line x1="350" y1="107" x2="700" y2="480" stroke="#0ea5e9" strokeWidth="0.6" strokeOpacity="0.14"/>
      <line x1="350" y1="107" x2="640" y2="480" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.10"/>
      <line x1="350" y1="107" x2="570" y2="480" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.08"/>
      <line x1="350" y1="107" x2="500" y2="480" stroke="#0ea5e9" strokeWidth="0.4" strokeOpacity="0.07"/>
      <line x1="350" y1="107" x2="425" y2="480" stroke="#0ea5e9" strokeWidth="0.4" strokeOpacity="0.06"/>
      <line x1="350" y1="107" x2="350" y2="480" stroke="#0ea5e9" strokeWidth="0.8" strokeOpacity="0.18" strokeDasharray="12 10"/>
      {/* Horizontal markers */}
      <line x1="306" y1="195" x2="394" y2="195" stroke="#0ea5e9" strokeWidth="0.4" strokeOpacity="0.09"/>
      <line x1="258" y1="240" x2="442" y2="240" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.09"/>
      <line x1="204" y1="285" x2="496" y2="285" stroke="#0ea5e9" strokeWidth="0.5" strokeOpacity="0.10"/>
      <line x1="148" y1="330" x2="552" y2="330" stroke="#0ea5e9" strokeWidth="0.6" strokeOpacity="0.10"/>
      <line x1="88"  y1="375" x2="612" y2="375" stroke="#0ea5e9" strokeWidth="0.6" strokeOpacity="0.11"/>
      <line x1="20"  y1="420" x2="680" y2="420" stroke="#0ea5e9" strokeWidth="0.7" strokeOpacity="0.12"/>

      {/* ── City Buildings — deep background layer ── */}
      <rect x="0"   y="200" width="48"  height="40"  fill="#080e1c"/>
      <rect x="52"  y="183" width="36"  height="57"  fill="#080e1c"/>
      <rect x="92"  y="165" width="52"  height="75"  fill="#0a1224"/>
      <rect x="148" y="149" width="42"  height="91"  fill="#0a1224"/>
      <rect x="194" y="132" width="58"  height="108" fill="#0c1632"/>
      <rect x="256" y="117" width="66"  height="123" fill="#0e1a3a"/>
      <rect x="326" y="101" width="82"  height="139" fill="#10203f"/>
      <rect x="412" y="113" width="68"  height="127" fill="#0e1a3a"/>
      <rect x="484" y="128" width="56"  height="112" fill="#0c1632"/>
      <rect x="544" y="143" width="46"  height="97"  fill="#0a1224"/>
      <rect x="594" y="157" width="44"  height="83"  fill="#0a1224"/>
      <rect x="642" y="170" width="36"  height="70"  fill="#080e1c"/>
      <rect x="682" y="182" width="18"  height="58"  fill="#080e1c"/>

      {/* ── City Buildings — mid layer ── */}
      <rect x="0"   y="212" width="26"  height="28"  fill="#090f20"/>
      <rect x="62"  y="193" width="30"  height="47"  fill="#090f20"/>
      <rect x="115" y="174" width="34"  height="66"  fill="#0a1528"/>
      <rect x="152" y="160" width="38"  height="80"  fill="#0a1528"/>
      <rect x="198" y="140" width="48"  height="100" fill="#0c1830"/>
      <rect x="250" y="122" width="58"  height="118" fill="#0e1c38"/>
      <rect x="313" y="107" width="68"  height="133" fill="#101e42"/>
      <rect x="385" y="116" width="62"  height="124" fill="#0e1c38"/>
      <rect x="451" y="131" width="50"  height="109" fill="#0c1830"/>
      <rect x="505" y="144" width="44"  height="96"  fill="#0a1528"/>
      <rect x="553" y="157" width="38"  height="83"  fill="#0a1528"/>
      <rect x="595" y="169" width="34"  height="71"  fill="#090f20"/>
      <rect x="633" y="180" width="26"  height="60"  fill="#090f20"/>
      <rect x="662" y="190" width="20"  height="50"  fill="#090f20"/>

      {/* ── City Buildings — accent mid-ground ── */}
      <rect x="170" y="175" width="26"  height="65"  fill="#0c1830"/>
      <rect x="278" y="137" width="42"  height="103" fill="#0e1c3a"/>
      <rect x="348" y="110" width="54"  height="130" fill="#111e44"/>
      <rect x="406" y="124" width="38"  height="116" fill="#0e1c3a"/>
      <rect x="450" y="148" width="32"  height="92"  fill="#0c1830"/>
      <rect x="504" y="158" width="28"  height="82"  fill="#0a1628"/>

      {/* ── City Buildings — foreground silhouette ── */}
      <rect x="0"   y="226" width="16"  height="14"  fill="#070c1a"/>
      <rect x="142" y="210" width="14"  height="30"  fill="#070c1a"/>
      <rect x="412" y="212" width="16"  height="28"  fill="#070c1a"/>
      <rect x="615" y="205" width="18"  height="35"  fill="#070c1a"/>

      {/* ── Building Windows — center tall building ── */}
      <g filter="url(#hc_win)">
        <rect x="336" y="108" width="13" height="14" fill="#f97316" fillOpacity="0.92" rx="0.5"/>
        <rect x="354" y="108" width="13" height="14" fill="#06b6d4" fillOpacity="0.90" rx="0.5"/>
        <rect x="372" y="108" width="13" height="14" fill="#f97316" fillOpacity="0.80" rx="0.5"/>
        <rect x="390" y="108" width="13" height="14" fill="#1e3a5f" fillOpacity="0.45" rx="0.5"/>
        <rect x="336" y="127" width="13" height="14" fill="#a78bfa" fillOpacity="0.78" rx="0.5"/>
        <rect x="354" y="127" width="13" height="14" fill="#f97316" fillOpacity="0.68" rx="0.5"/>
        <rect x="372" y="127" width="13" height="14" fill="#1e3a5f" fillOpacity="0.38" rx="0.5"/>
        <rect x="390" y="127" width="13" height="14" fill="#06b6d4" fillOpacity="0.65" rx="0.5"/>
        <rect x="336" y="146" width="13" height="14" fill="#06b6d4" fillOpacity="0.55" rx="0.5"/>
        <rect x="354" y="146" width="13" height="14" fill="#1e3a5f" fillOpacity="0.32" rx="0.5"/>
        <rect x="372" y="146" width="13" height="14" fill="#f97316" fillOpacity="0.60" rx="0.5"/>
        <rect x="390" y="146" width="13" height="14" fill="#a78bfa" fillOpacity="0.50" rx="0.5"/>
        <rect x="336" y="165" width="13" height="14" fill="#1e3a5f" fillOpacity="0.28" rx="0.5"/>
        <rect x="354" y="165" width="13" height="14" fill="#f97316" fillOpacity="0.48" rx="0.5"/>
        <rect x="372" y="165" width="13" height="14" fill="#06b6d4" fillOpacity="0.40" rx="0.5"/>
        <rect x="390" y="165" width="13" height="14" fill="#1e3a5f" fillOpacity="0.25" rx="0.5"/>
      </g>

      {/* Left-center building windows */}
      <g filter="url(#hc_win)">
        <rect x="264" y="124" width="11" height="12" fill="#f97316" fillOpacity="0.88" rx="0.5"/>
        <rect x="279" y="124" width="11" height="12" fill="#06b6d4" fillOpacity="0.82" rx="0.5"/>
        <rect x="294" y="124" width="11" height="12" fill="#1e3a5f" fillOpacity="0.42" rx="0.5"/>
        <rect x="264" y="140" width="11" height="12" fill="#a78bfa" fillOpacity="0.72" rx="0.5"/>
        <rect x="279" y="140" width="11" height="12" fill="#f97316" fillOpacity="0.62" rx="0.5"/>
        <rect x="294" y="140" width="11" height="12" fill="#06b6d4" fillOpacity="0.55" rx="0.5"/>
        <rect x="264" y="156" width="11" height="12" fill="#1e3a5f" fillOpacity="0.30" rx="0.5"/>
        <rect x="279" y="156" width="11" height="12" fill="#f97316" fillOpacity="0.48" rx="0.5"/>
        <rect x="294" y="156" width="11" height="12" fill="#a78bfa" fillOpacity="0.40" rx="0.5"/>
      </g>

      {/* Right-center building windows */}
      <g filter="url(#hc_win)">
        <rect x="422" y="121" width="11" height="12" fill="#06b6d4" fillOpacity="0.88" rx="0.5"/>
        <rect x="437" y="121" width="11" height="12" fill="#f97316" fillOpacity="0.72" rx="0.5"/>
        <rect x="452" y="121" width="11" height="12" fill="#1e3a5f" fillOpacity="0.38" rx="0.5"/>
        <rect x="422" y="137" width="11" height="12" fill="#a78bfa" fillOpacity="0.64" rx="0.5"/>
        <rect x="437" y="137" width="11" height="12" fill="#06b6d4" fillOpacity="0.55" rx="0.5"/>
        <rect x="452" y="137" width="11" height="12" fill="#f97316" fillOpacity="0.48" rx="0.5"/>
        <rect x="422" y="153" width="11" height="12" fill="#1e3a5f" fillOpacity="0.30" rx="0.5"/>
        <rect x="437" y="153" width="11" height="12" fill="#06b6d4" fillOpacity="0.42" rx="0.5"/>
      </g>

      {/* Scattered windows — smaller buildings */}
      <rect x="220" y="138" width="10" height="11" fill="#f97316" fillOpacity="0.78" rx="0.5"/>
      <rect x="234" y="138" width="10" height="11" fill="#a78bfa" fillOpacity="0.62" rx="0.5"/>
      <rect x="248" y="138" width="10" height="11" fill="#1e3a5f" fillOpacity="0.38" rx="0.5"/>
      <rect x="220" y="153" width="10" height="11" fill="#06b6d4" fillOpacity="0.52" rx="0.5"/>
      <rect x="234" y="153" width="10" height="11" fill="#f97316" fillOpacity="0.58" rx="0.5"/>
      <rect x="514" y="135" width="10" height="11" fill="#f97316" fillOpacity="0.75" rx="0.5"/>
      <rect x="528" y="135" width="10" height="11" fill="#06b6d4" fillOpacity="0.66" rx="0.5"/>
      <rect x="542" y="135" width="10" height="11" fill="#1e3a5f" fillOpacity="0.38" rx="0.5"/>
      <rect x="514" y="150" width="10" height="11" fill="#a78bfa" fillOpacity="0.58" rx="0.5"/>
      <rect x="528" y="150" width="10" height="11" fill="#f97316" fillOpacity="0.48" rx="0.5"/>
      <rect x="102" y="172" width="9"  height="10" fill="#06b6d4" fillOpacity="0.60" rx="0.5"/>
      <rect x="115" y="172" width="9"  height="10" fill="#f97316" fillOpacity="0.50" rx="0.5"/>
      <rect x="102" y="185" width="9"  height="10" fill="#1e3a5f" fillOpacity="0.35" rx="0.5"/>
      <rect x="602" y="164" width="9"  height="10" fill="#f97316" fillOpacity="0.68" rx="0.5"/>
      <rect x="615" y="164" width="9"  height="10" fill="#06b6d4" fillOpacity="0.58" rx="0.5"/>
      <rect x="602" y="177" width="9"  height="10" fill="#1e3a5f" fillOpacity="0.35" rx="0.5"/>
      <rect x="615" y="177" width="9"  height="10" fill="#a78bfa" fillOpacity="0.45" rx="0.5"/>

      {/* ── Antennas ── */}
      <line x1="397" y1="101" x2="397" y2="68" stroke="#f97316" strokeWidth="1.5" strokeOpacity="0.90"/>
      <circle cx="397" cy="67" r="5.5" fill="#f97316" fillOpacity="0.98"/>
      <circle cx="397" cy="67" r="13"  fill="#f97316" fillOpacity="0.14"/>
      <circle cx="397" cy="67" r="22"  fill="#f97316" fillOpacity="0.05"/>
      <line x1="289" y1="117" x2="289" y2="94" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.70"/>
      <circle cx="289" cy="93" r="4"   fill="#06b6d4" fillOpacity="0.90"/>
      <circle cx="289" cy="93" r="10"  fill="#06b6d4" fillOpacity="0.12"/>
      <line x1="411" y1="113" x2="411" y2="88" stroke="#a78bfa" strokeWidth="1" strokeOpacity="0.65"/>
      <circle cx="411" cy="87" r="4"   fill="#a78bfa" fillOpacity="0.88"/>
      <circle cx="411" cy="87" r="10"  fill="#a78bfa" fillOpacity="0.12"/>

      {/* ── VP Mega Atmospheric Glow ── */}
      <ellipse cx="350" cy="107" rx="440" ry="295" fill="url(#hc_vp)"/>

      {/* ── ORANGE SPEED STREAKS (left cluster) ── VP=(350,107) */}

      {/* MEGA outer aura — giant glow nebula, pure blur */}
      <g filter="url(#hc_mega)">
        <line x1="95"  y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="260" strokeOpacity="0.070"/>
        <line x1="115" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="210" strokeOpacity="0.058"/>
      </g>

      {/* LARGE aura — wide glow flood, pure blur */}
      <g filter="url(#hc_xlg)">
        <line x1="70"  y1="480" x2="348" y2="107" stroke="url(#hc_og)" strokeWidth="130" strokeOpacity="0.18"/>
        <line x1="90"  y1="480" x2="349" y2="107" stroke="url(#hc_og)" strokeWidth="110" strokeOpacity="0.18"/>
        <line x1="110" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="110" strokeOpacity="0.18"/>
        <line x1="130" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="96"  strokeOpacity="0.14"/>
      </g>

      {/* WIDE glow + source */}
      <g filter="url(#hc_wide)">
        <line x1="56"  y1="480" x2="347" y2="107" stroke="url(#hc_og)" strokeWidth="58" strokeOpacity="0.34"/>
        <line x1="74"  y1="480" x2="348" y2="107" stroke="url(#hc_og)" strokeWidth="50" strokeOpacity="0.38"/>
        <line x1="92"  y1="480" x2="349" y2="107" stroke="url(#hc_og)" strokeWidth="46" strokeOpacity="0.42"/>
        <line x1="110" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="46" strokeOpacity="0.42"/>
        <line x1="128" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="42" strokeOpacity="0.35"/>
        <line x1="148" y1="480" x2="351" y2="107" stroke="url(#hc_og)" strokeWidth="34" strokeOpacity="0.26"/>
        <line x1="168" y1="480" x2="352" y2="107" stroke="url(#hc_og)" strokeWidth="22" strokeOpacity="0.18"/>
      </g>

      {/* MID glow + source */}
      <g filter="url(#hc_mid)">
        <line x1="78"  y1="480" x2="348" y2="107" stroke="url(#hc_og)" strokeWidth="24" strokeOpacity="0.62"/>
        <line x1="94"  y1="480" x2="349" y2="107" stroke="url(#hc_og)" strokeWidth="19" strokeOpacity="0.66"/>
        <line x1="110" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="19" strokeOpacity="0.66"/>
        <line x1="126" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="16" strokeOpacity="0.54"/>
      </g>

      {/* SHARP glow + source */}
      <g filter="url(#hc_sharp)">
        <line x1="86"  y1="480" x2="349" y2="107" stroke="url(#hc_og)" strokeWidth="9" strokeOpacity="0.82"/>
        <line x1="102" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="8" strokeOpacity="0.84"/>
        <line x1="116" y1="480" x2="350" y2="107" stroke="url(#hc_og)" strokeWidth="7" strokeOpacity="0.78"/>
      </g>

      {/* WHITE-HOT CORE — no filter */}
      <line x1="91"  y1="480" x2="349" y2="107" stroke="url(#hc_og_core)" strokeWidth="4.5" strokeOpacity="1.0"/>
      <line x1="107" y1="480" x2="350" y2="107" stroke="url(#hc_og_core)" strokeWidth="4"   strokeOpacity="1.0"/>
      <line x1="78"  y1="480" x2="348" y2="107" stroke="url(#hc_og)"      strokeWidth="2.2" strokeOpacity="0.82"/>
      <line x1="122" y1="480" x2="351" y2="107" stroke="url(#hc_og)"      strokeWidth="1.6" strokeOpacity="0.62"/>
      <line x1="50"  y1="480" x2="346" y2="107" stroke="url(#hc_og)"      strokeWidth="1.2" strokeOpacity="0.30"/>

      {/* ── BLUE/CYAN SPEED STREAKS (right cluster) ── */}

      {/* MEGA outer aura */}
      <g filter="url(#hc_mega)">
        <line x1="605" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="260" strokeOpacity="0.065"/>
        <line x1="585" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="210" strokeOpacity="0.054"/>
      </g>

      {/* LARGE aura */}
      <g filter="url(#hc_xlg)">
        <line x1="630" y1="480" x2="352" y2="107" stroke="url(#hc_bg)" strokeWidth="130" strokeOpacity="0.17"/>
        <line x1="610" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="110" strokeOpacity="0.17"/>
        <line x1="592" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="110" strokeOpacity="0.17"/>
        <line x1="572" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="96"  strokeOpacity="0.13"/>
      </g>

      {/* WIDE glow + source */}
      <g filter="url(#hc_wide)">
        <line x1="644" y1="480" x2="353" y2="107" stroke="url(#hc_bg)" strokeWidth="58" strokeOpacity="0.32"/>
        <line x1="626" y1="480" x2="352" y2="107" stroke="url(#hc_bg)" strokeWidth="50" strokeOpacity="0.36"/>
        <line x1="608" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="46" strokeOpacity="0.40"/>
        <line x1="591" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="46" strokeOpacity="0.40"/>
        <line x1="573" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="42" strokeOpacity="0.33"/>
        <line x1="554" y1="480" x2="349" y2="107" stroke="url(#hc_bg)" strokeWidth="34" strokeOpacity="0.24"/>
        <line x1="535" y1="480" x2="348" y2="107" stroke="url(#hc_bg)" strokeWidth="22" strokeOpacity="0.16"/>
      </g>

      {/* MID glow + source */}
      <g filter="url(#hc_mid)">
        <line x1="622" y1="480" x2="352" y2="107" stroke="url(#hc_bg)" strokeWidth="24" strokeOpacity="0.58"/>
        <line x1="606" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="19" strokeOpacity="0.62"/>
        <line x1="590" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="19" strokeOpacity="0.62"/>
        <line x1="574" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="16" strokeOpacity="0.52"/>
      </g>

      {/* SHARP glow + source */}
      <g filter="url(#hc_sharp)">
        <line x1="614" y1="480" x2="352" y2="107" stroke="url(#hc_bg)" strokeWidth="9" strokeOpacity="0.80"/>
        <line x1="598" y1="480" x2="351" y2="107" stroke="url(#hc_bg)" strokeWidth="8" strokeOpacity="0.82"/>
        <line x1="583" y1="480" x2="350" y2="107" stroke="url(#hc_bg)" strokeWidth="7" strokeOpacity="0.75"/>
      </g>

      {/* WHITE-HOT CORE — no filter */}
      <line x1="609" y1="480" x2="351" y2="107" stroke="url(#hc_bg_core)" strokeWidth="4.5" strokeOpacity="1.0"/>
      <line x1="593" y1="480" x2="351" y2="107" stroke="url(#hc_bg_core)" strokeWidth="4"   strokeOpacity="1.0"/>
      <line x1="622" y1="480" x2="352" y2="107" stroke="url(#hc_bg)"      strokeWidth="2.2" strokeOpacity="0.80"/>
      <line x1="578" y1="480" x2="350" y2="107" stroke="url(#hc_bg)"      strokeWidth="1.6" strokeOpacity="0.60"/>
      <line x1="650" y1="480" x2="353" y2="107" stroke="url(#hc_bg)"      strokeWidth="1.2" strokeOpacity="0.28"/>

      {/* Road center divider */}
      <line x1="350" y1="200" x2="350" y2="480" stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.05"/>
    </svg>
  );
}

// ── Hero 右側疊加卡片 ─────────────────────────────────────────────────────────

const UPGRADE_TREND_PTS = "0,60 20,48 40,52 60,38 80,28 100,18 120,8";

function HeroCards() {
  return (
    <>
      {/* SBIR card — upper-left */}
      <div
        className="absolute flex flex-col gap-1 px-3 py-2.5 rounded-xl backdrop-blur-md"
        style={{ top: "8%", left: "2%", border: "1px solid rgba(249,115,22,0.38)", background: "rgba(6,10,20,0.80)", minWidth: "108px" }}
      >
        <span className="text-[9px] font-mono tracking-[0.2em] text-orange-400/70 uppercase">SBIR</span>
        <span className="text-[9px] font-mono text-slate-400/60">最高補助</span>
        <span className="text-xl font-extrabold font-mono text-orange-400 leading-none" style={{ textShadow: "0 0 18px rgba(249,115,22,0.55)" }}>
          3,000萬元
        </span>
      </div>

      {/* 企業升級 UPGRADE card — center (largest, highlighted) */}
      <div
        className="absolute flex flex-col items-center gap-2 px-4 py-3 rounded-2xl backdrop-blur-md"
        style={{
          top: "14%", left: "28%",
          border: "1.5px solid rgba(6,182,212,0.55)",
          background: "rgba(6,12,26,0.88)",
          boxShadow: "0 0 32px rgba(6,182,212,0.22), 0 0 64px rgba(6,182,212,0.08)",
          minWidth: "130px",
        }}
      >
        {/* Mini trend chart */}
        <svg width="124" height="68" viewBox="0 0 124 68">
          <defs>
            <linearGradient id="card_area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Grid */}
          <line x1="0" y1="22" x2="124" y2="22" stroke="#06b6d4" strokeWidth="0.4" strokeOpacity="0.20" />
          <line x1="0" y1="44" x2="124" y2="44" stroke="#06b6d4" strokeWidth="0.4" strokeOpacity="0.20" />
          {/* Area fill */}
          <polyline points={`0,68 ${UPGRADE_TREND_PTS} 120,68`} fill="url(#card_area)" />
          {/* Trend line */}
          <polyline points={UPGRADE_TREND_PTS} fill="none" stroke="#06b6d4" strokeWidth="2" strokeOpacity="0.95" />
          {/* Latest point */}
          <circle cx="120" cy="8" r="4" fill="#06b6d4" fillOpacity="0.9" />
          <circle cx="120" cy="8" r="8" fill="#06b6d4" fillOpacity="0.15" />
        </svg>
        <div className="text-center -mt-1">
          <p className="text-base font-extrabold text-cyan-300" style={{ textShadow: "0 0 14px rgba(6,182,212,0.65)" }}>
            企業升級
          </p>
          <p className="text-[9px] font-mono tracking-[0.22em] text-cyan-400/60 uppercase mt-0.5">UPGRADE ↑</p>
        </div>
      </div>

      {/* CITD card — upper-right */}
      <div
        className="absolute flex flex-col gap-1 px-3 py-2.5 rounded-xl backdrop-blur-md"
        style={{ top: "5%", right: "18%", border: "1px solid rgba(245,158,11,0.38)", background: "rgba(6,10,20,0.80)", minWidth: "108px" }}
      >
        <span className="text-[9px] font-mono tracking-[0.2em] text-amber-400/70 uppercase">CITD</span>
        <span className="text-[9px] font-mono text-slate-400/60">最高補助</span>
        <span className="text-xl font-extrabold font-mono text-amber-400 leading-none" style={{ textShadow: "0 0 18px rgba(245,158,11,0.55)" }}>
          500萬元
        </span>
      </div>

      {/* SIIR card — center-lower */}
      <div
        className="absolute flex flex-col gap-1 px-3 py-2.5 rounded-xl backdrop-blur-md"
        style={{ top: "52%", left: "28%", border: "1px solid rgba(168,85,247,0.38)", background: "rgba(6,10,20,0.80)", minWidth: "108px" }}
      >
        <span className="text-[9px] font-mono tracking-[0.2em] text-violet-400/70 uppercase">SIIR</span>
        <span className="text-[9px] font-mono text-slate-400/60">最高補助</span>
        <span className="text-xl font-extrabold font-mono text-violet-400 leading-none" style={{ textShadow: "0 0 18px rgba(168,85,247,0.55)" }}>
          1,000萬元
        </span>
      </div>

      {/* Right edge vertical labels */}
      <div className="absolute top-0 right-0 bottom-0 flex flex-col justify-evenly items-center pr-1.5 py-4">
        {[
          { Icon: Cpu,         label: "智慧製造", color: "#06b6d4" },
          { Icon: Factory,     label: "數位轉型", color: "#f97316" },
          { Icon: FlaskConical,label: "研發創新", color: "#a78bfa" },
          { Icon: Leaf,        label: "永續發展", color: "#4ade80" },
        ].map(({ Icon, label, color }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${color}18`, border: `1px solid ${color}35` }}
            >
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <span className="text-[9px] font-mono text-slate-400/60 whitespace-nowrap">{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);

  // Permission check queries
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

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ background: "#06090f", borderBottom: "1px solid rgba(148,163,184,0.08)" }}
      >
        {/* Top tagline */}
        <div className="text-center pt-4 pb-0">
          <span
            className="text-[11px] font-mono tracking-[0.32em] uppercase"
            style={{ color: "rgba(148,163,184,0.45)" }}
          >
            數位轉型・智慧製造・企業升級
          </span>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 grid lg:grid-cols-2 gap-8 lg:gap-6 items-center">
          {/* ── Left: text ── */}
          <div className="space-y-6 text-white">
            {/* Live pill */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ border: "1px solid rgba(249,115,22,0.35)", background: "rgba(249,115,22,0.10)" }}
            >
              <span className="relative flex h-2 w-2">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
              </span>
              <span className="text-sm font-medium text-orange-300">免費資格評估開放中</span>
            </div>

            {/* Title */}
            <div>
              <h1 className="text-5xl md:text-6xl font-extrabold leading-tight tracking-tight">
                <span className="text-white">企業</span>
                <span
                  style={{
                    background: "linear-gradient(135deg,#f97316 0%,#fbbf24 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  升級
                </span>
                <span className="text-white">中心</span>
              </h1>
              <p className="text-slate-300 mt-3 text-lg leading-relaxed">
                協助台灣企業取得政府補助與轉型資源
              </p>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2">
              {["SBIR", "CITD", "SIIR"].map((code) => (
                <span
                  key={code}
                  className="px-3 py-1 rounded text-sm font-bold font-mono text-slate-200"
                  style={{ border: "1px solid rgba(148,163,184,0.35)" }}
                >
                  {code}
                </span>
              ))}
              <span className="px-3 py-1 rounded text-sm font-bold bg-orange-500 text-white">
                最高補助 3,000 萬元
              </span>
            </div>

            {/* Bullets */}
            <div className="space-y-2.5">
              {[
                { Icon: CheckCircle, text: "全程顧問陪跑，從評估到送件" },
                { Icon: TrendingUp,  text: "媒合最適合您企業的計畫類型" },
                { Icon: Users,       text: "專人到廠評估，提高申請成功率" },
              ].map(({ Icon, text }) => (
                <div key={text} className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 text-orange-400 shrink-0" />
                  <span className="text-slate-300 text-sm">{text}</span>
                </div>
              ))}
            </div>

            {/* CTA button */}
            <div>
              <Button
                size="lg"
                onClick={handleApplyClick}
                disabled={accessChecking && !!user}
                className="bg-orange-500 hover:bg-orange-600 text-white border-0 text-base px-8 rounded-lg shadow-lg shadow-orange-500/25"
              >
                免費評估資格
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>

            {/* Mobile badges */}
            <div className="flex flex-wrap gap-2 lg:hidden pt-1">
              {[
                { code: "SBIR", max: "3,000萬", color: "#fb923c" },
                { code: "CITD", max: "500萬",   color: "#fbbf24" },
                { code: "SIIR", max: "1,000萬", color: "#c084fc" },
              ].map(({ code, max, color }) => (
                <div
                  key={code}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{ border: `1px solid ${color}40`, background: `${color}18`, color }}
                >
                  <span className="text-xs font-bold font-mono">{code}</span>
                  <span className="text-[10px] font-mono opacity-70">最高 {max}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: city visual ── */}
          <div className="relative h-[360px] lg:h-[460px] rounded-2xl overflow-hidden hidden md:block">
            <HeroCityVisual />
            <HeroCards />
          </div>
        </div>
      </section>

      {/* ── LED 儀表板 ────────────────────────────────────────────────────── */}
      <section className="py-14 md:py-18 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div>
            <h2 className="text-xl font-bold text-slate-100">平台數據</h2>
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
