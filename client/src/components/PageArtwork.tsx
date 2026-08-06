import { useId } from "react";

// 純展示用背景／插畫元件庫，供三個公開服務介紹頁（ISO／ERP／短影音）共用。
// 全部 aria-hidden、pointer-events-none，不含互動、不含真實數字或第三方標章，
// 不含持續動畫。gradient/pattern id 一律用 useId() 加前綴，避免同頁多次使用時
// SVG defs id 互相碰撞。

export function GridTexture({
  className = "",
  opacity = 0.08,
  size = 48,
}: {
  className?: string;
  opacity?: number;
  size?: number;
}) {
  const id = useId();
  return (
    <svg aria-hidden="true" className={`pointer-events-none ${className}`} width="100%" height="100%">
      <defs>
        <pattern id={`grid-${id}`} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke="currentColor" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#grid-${id})`} opacity={opacity} />
    </svg>
  );
}

export function FactorySilhouette({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 640 260"
      preserveAspectRatio="xMidYMid meet"
      className={`pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <path d="M10,230 H630" strokeWidth={2} />
      <path
        d="M40,230 V150 L90,110 V150 L140,110 V150 L190,110 V150 L240,110 V150 L340,150 V230 Z"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <rect x="300" y="70" width="20" height="90" strokeWidth={2.5} />
      <circle cx="310" cy="55" r="8" strokeWidth={2} opacity={0.7} />
      <circle cx="322" cy="35" r="10" strokeWidth={2} opacity={0.5} />
      <circle cx="336" cy="18" r="12" strokeWidth={2} opacity={0.35} />
      <rect x="360" y="150" width="220" height="80" strokeWidth={2.5} />
      {[380, 420, 460, 500, 540].map(x => (
        <rect key={x} x={x} y="175" width="24" height="24" strokeWidth={1.5} />
      ))}
      <rect x="60" y="190" width="30" height="40" strokeWidth={1.5} />
    </svg>
  );
}

export function LeafDataMotif({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 300 300" className={`pointer-events-none ${className}`} fill="none" stroke="currentColor">
      <path d="M150,20 C230,40 260,120 220,190 C190,240 120,260 60,240 C40,180 60,90 150,20 Z" strokeWidth={2.5} />
      <path d="M150,20 C130,90 110,160 70,235" strokeWidth={1.5} opacity={0.6} />
      <circle cx="150" cy="90" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
      <circle cx="170" cy="150" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
      <circle cx="120" cy="190" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
      <path d="M150,90 L170,150 L120,190" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
    </svg>
  );
}

export function ShieldDocMotif({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 300 300" className={`pointer-events-none ${className}`} fill="none" stroke="currentColor">
      <path d="M150,20 L230,50 V140 C230,200 190,240 150,260 C110,240 70,200 70,140 V50 Z" strokeWidth={2.5} />
      <path d="M115,145 L140,170 L190,110" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <rect x="30" y="90" width="50" height="66" rx="4" strokeWidth={1.5} opacity={0.6} />
      <path d="M40,106 H70 M40,120 H70 M40,134 H60" strokeWidth={1.2} opacity={0.6} />
    </svg>
  );
}

export function HubSpokes({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 260"
      preserveAspectRatio="none"
      className={`pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <circle cx="300" cy="30" r="16" strokeWidth={2} fill="currentColor" fillOpacity={0.08} />
      <path d="M300,46 C300,100 120,120 100,220" strokeWidth={1.5} strokeDasharray="5 5" />
      <path d="M300,46 L300,220" strokeWidth={1.5} strokeDasharray="5 5" />
      <path d="M300,46 C300,100 480,120 500,220" strokeWidth={1.5} strokeDasharray="5 5" />
      <circle cx="100" cy="222" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
      <circle cx="300" cy="222" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
      <circle cx="500" cy="222" r="6" strokeWidth={1.5} fill="currentColor" fillOpacity={0.15} />
    </svg>
  );
}

export function VennCompare({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 420 260" className={`pointer-events-none ${className}`} fill="none" stroke="currentColor">
      <circle cx="150" cy="130" r="90" strokeWidth={2} />
      <circle cx="270" cy="130" r="90" strokeWidth={2} opacity={0.7} />
      <circle cx="210" cy="70" r="60" strokeWidth={1.5} opacity={0.5} />
    </svg>
  );
}

export function ConveyorRoute({ className = "", nodes = 4 }: { className?: string; nodes?: number }) {
  const points = Array.from({ length: nodes }, (_, i) => (i + 1) * (800 / (nodes + 1)));
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 800 160"
      preserveAspectRatio="none"
      className={`pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <path d="M0,110 C150,40 250,180 400,110 C550,40 650,180 800,110" strokeWidth={2} strokeDasharray="6 6" />
      {points.map((x, i) => (
        <rect key={i} x={x - 9} y={98} width="18" height="18" rx="3" strokeWidth={1.5} fill="currentColor" fillOpacity={0.1} />
      ))}
    </svg>
  );
}

export function GaugeArcs({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 360 220" className={`pointer-events-none ${className}`} fill="none">
      <defs>
        <linearGradient id={`gauge-${id}`} x1="50" y1="180" x2="310" y2="180" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c4b5fd" />
          <stop offset="0.55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <filter id={`gauge-shadow-${id}`} x="-20" y="-20" width="400" height="260" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#6b21a8" floodOpacity="0.18" />
        </filter>
      </defs>
      <path d="M50,180 A130,130 0 0 1 310,180" stroke="#ede9fe" strokeWidth={28} strokeLinecap="round" />
      <path d="M50,180 A130,130 0 0 1 310,180" stroke={`url(#gauge-${id})`} strokeWidth={18} strokeLinecap="round" filter={`url(#gauge-shadow-${id})`} />
      <g stroke="#ffffff" strokeWidth={4} strokeLinecap="round">
        <path d="M60,137 L74,142" /><path d="M87,91 L99,103" /><path d="M131,61 L137,76" />
        <path d="M180,50 L180,66" /><path d="M229,61 L223,76" /><path d="M273,91 L261,103" /><path d="M300,137 L286,142" />
      </g>
      <path d="M180,180 L248,99" stroke="#4c1d95" strokeWidth={8} strokeLinecap="round" />
      <circle cx="180" cy="180" r="18" fill="#ffffff" stroke="#7e22ce" strokeWidth={7} />
      <circle cx="180" cy="180" r="5" fill="#fb923c" />
      <path d="M101,192 H259" stroke="#ddd6fe" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export function SpotlightBeam({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg aria-hidden="true" viewBox="0 0 400 400" className={`pointer-events-none ${className}`}>
      <defs>
        <linearGradient id={`beam-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d="M200,0 L360,400 L40,400 Z" fill={`url(#beam-${id})`} />
    </svg>
  );
}

export function NodePath({
  count,
  orientation = "horizontal",
  className = "",
}: {
  count: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  const positions = Array.from({ length: count }, (_, i) => (count === 1 ? 50 : (i / (count - 1)) * 92 + 4));
  if (orientation === "vertical") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 40 100"
        preserveAspectRatio="none"
        className={`pointer-events-none ${className}`}
        fill="none"
        stroke="currentColor"
      >
        <line x1="20" y1="2" x2="20" y2="98" strokeWidth={2} strokeDasharray="4 4" />
        {positions.map((y, i) => (
          <circle key={i} cx="20" cy={y} r="3.5" fill="currentColor" fillOpacity={0.2} strokeWidth={1.5} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className={`pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <line x1="2" y1="20" x2="98" y2="20" strokeWidth={1.5} strokeDasharray="3 3" />
      {positions.map((x, i) => (
        <circle key={i} cx={x} cy="20" r="3" fill="currentColor" fillOpacity={0.2} strokeWidth={1.2} />
      ))}
    </svg>
  );
}

export function ViewfinderCorners({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  const s = size === "lg" ? "w-14 h-14" : "w-8 h-8";
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute ${className}`}>
      <span className={`absolute top-0 left-0 ${s} border-t-2 border-l-2 border-current rounded-tl-lg`} />
      <span className={`absolute top-0 right-0 ${s} border-t-2 border-r-2 border-current rounded-tr-lg`} />
      <span className={`absolute bottom-0 left-0 ${s} border-b-2 border-l-2 border-current rounded-bl-lg`} />
      <span className={`absolute bottom-0 right-0 ${s} border-b-2 border-r-2 border-current rounded-br-lg`} />
    </div>
  );
}

export function FilmStripBand({ className = "", frames = 6 }: { className?: string; frames?: number }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none flex items-center gap-2 ${className}`}>
      {Array.from({ length: frames }).map((_, i) => (
        <div key={i} className="relative w-10 h-16 md:w-14 md:h-20 rounded-sm border-2 border-current shrink-0">
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-current" />
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-current" />
        </div>
      ))}
    </div>
  );
}

export function PhoneWaveform({ className = "" }: { className?: string }) {
  const bars = [40, 70, 55, 90, 60, 45, 75];
  return (
    <div aria-hidden="true" className={`pointer-events-none ${className}`}>
      <div className="w-16 h-28 md:w-20 md:h-36 rounded-2xl border-2 border-current flex items-end justify-center gap-1 p-2">
        {bars.map((h, i) => (
          <span key={i} className="w-1 rounded-full bg-current" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}
