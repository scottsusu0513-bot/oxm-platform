import {
  ArrowRight,
  BadgeCheck,
  Box,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  CircleDollarSign,
  Factory,
  FileCheck2,
  Gavel,
  GraduationCap,
  Handshake,
  Landmark,
  MapPin,
  Megaphone,
  MessageSquare,
  Newspaper,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";

export type AboutArtworkKind = "factory" | "resources" | "talent" | "brand" | "news" | "discussion";

type ArtworkProps = {
  kind: AboutArtworkKind;
  className?: string;
};

const stageClass =
  "relative isolate h-full min-h-[18rem] overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/70 shadow-[0_24px_70px_-36px_rgba(15,23,42,0.4)] backdrop-blur-sm";

function DotGrid({ tone = "purple" }: { tone?: "purple" | "orange" | "teal" | "blue" | "rose" | "violet" }) {
  const color = {
    purple: "bg-purple-500",
    orange: "bg-orange-500",
    teal: "bg-teal-500",
    blue: "bg-blue-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
  }[tone];
  return (
    <div className="pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden="true">
      <div className={`absolute inset-0 ${color}`} style={{ maskImage: "radial-gradient(circle, black 1px, transparent 1.4px)", maskSize: "18px 18px" }} />
    </div>
  );
}

function Connector({ className = "" }: { className?: string }) {
  return <div className={`h-px border-t-2 border-dashed border-current opacity-45 ${className}`} aria-hidden="true" />;
}

function FactorySearchArtwork() {
  return (
    <div className={`${stageClass} bg-gradient-to-br from-orange-50 via-white to-amber-100/70`}>
      <DotGrid tone="orange" />
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-200/60 blur-2xl" />
      <div className="relative flex h-full min-h-[18rem] items-center justify-center p-6 sm:p-8">
        <div className="relative h-56 w-full max-w-md">
          <svg viewBox="0 0 460 230" className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
            <path d="M72 185C120 126 150 149 194 94C226 54 266 42 321 61C352 72 374 94 401 67" stroke="#fb923c" strokeWidth="3" strokeDasharray="7 9" strokeLinecap="round" />
            <path d="M226 42C251 50 266 74 258 98C250 123 226 133 218 156C210 178 224 194 205 212" stroke="#fdba74" strokeWidth="18" strokeLinecap="round" opacity=".35" />
            <circle cx="72" cy="185" r="7" fill="#f97316" />
            <circle cx="194" cy="94" r="7" fill="#f97316" />
            <circle cx="321" cy="61" r="7" fill="#9333ea" />
            <circle cx="401" cy="67" r="7" fill="#9333ea" />
          </svg>

          <div className="absolute left-0 top-4 w-36 rounded-2xl border border-orange-200 bg-white p-3 shadow-lg shadow-orange-900/10">
            <div className="mb-2 flex items-center gap-2 text-orange-700"><Factory className="h-5 w-5" /><span className="text-xs font-bold">製造能力</span></div>
            <div className="flex gap-1.5"><span className="rounded bg-orange-50 px-2 py-1 text-[10px] text-orange-700">OEM</span><span className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">ODM</span></div>
          </div>

          <div className="absolute bottom-1 right-0 w-40 rounded-2xl border border-purple-200 bg-white p-3 shadow-lg shadow-purple-900/10">
            <div className="mb-2 flex items-center gap-2 text-purple-700"><MapPin className="h-5 w-5" /><span className="text-xs font-bold">地區與條件</span></div>
            <div className="h-2 rounded-full bg-purple-100"><div className="h-2 w-24 rounded-full bg-purple-500" /></div>
          </div>

          <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2rem] bg-gradient-to-br from-orange-500 to-purple-600 text-white shadow-2xl shadow-purple-500/30 ring-8 ring-white/80">
            <Search className="h-10 w-10" strokeWidth={2.2} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourcesArtwork() {
  const resources = [
    { icon: CircleDollarSign, label: "財務", className: "left-5 top-8 bg-purple-100 text-purple-700" },
    { icon: ShieldCheck, label: "認證", className: "right-4 top-7 bg-indigo-100 text-indigo-700" },
    { icon: TrendingUp, label: "行銷", className: "left-8 bottom-7 bg-fuchsia-100 text-fuchsia-700" },
    { icon: BriefcaseBusiness, label: "系統", className: "right-6 bottom-8 bg-violet-100 text-violet-700" },
  ];
  return (
    <div className={`${stageClass} bg-gradient-to-br from-violet-50 via-white to-indigo-100/70`}>
      <DotGrid tone="purple" />
      <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-purple-300" />
      <div className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-purple-200 bg-white/50" />
      {resources.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.label} className={`absolute flex w-20 flex-col items-center gap-1 rounded-2xl border border-white bg-white/90 p-3 text-center shadow-lg ${item.className}`}>
            <Icon className="h-6 w-6" />
            <span className="text-[11px] font-bold">{item.label}</span>
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[2rem] bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-2xl shadow-purple-500/30">
        <Factory className="mb-2 h-9 w-9" />
        <span className="text-xs font-bold">找資源</span>
      </div>
    </div>
  );
}

function TalentArtwork() {
  return (
    <div className={`${stageClass} bg-gradient-to-br from-emerald-50 via-white to-teal-100/80`}>
      <DotGrid tone="teal" />
      <div className="relative grid h-full min-h-[18rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1.05fr)] items-center gap-2 p-4 sm:gap-3 sm:p-8">
        <div className="space-y-3">
          {[{ icon: Wrench, label: "實作技能" }, { icon: GraduationCap, label: "課程培訓" }, { icon: BadgeCheck, label: "能力證明" }].map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-white px-2 py-2.5 shadow-sm sm:gap-2 sm:px-3" style={{ marginLeft: index * 4 }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Icon className="h-4 w-4" /></span>
                <span className="whitespace-nowrap text-[10px] font-bold text-emerald-900 sm:text-[11px]">{item.label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col items-center gap-2 text-teal-500">
          <Connector className="w-10 rotate-90" />
          <ArrowRight className="h-6 w-6" />
          <Connector className="w-10 rotate-90" />
        </div>
        <div className="relative flex h-48 items-end justify-center rounded-[2rem] border border-teal-200 bg-gradient-to-b from-white to-teal-100 p-3 sm:p-5">
          <div className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-orange-600 shadow-sm"><Sparkles className="h-5 w-5" /></div>
          <div className="absolute left-5 top-9 h-16 w-2 rounded-full bg-teal-200" />
          <div className="absolute left-8 top-7 h-2 w-12 rounded-full bg-teal-300" />
          <div className="flex flex-col items-center text-teal-800">
            <Users className="mb-2 h-14 w-14" />
            <span className="whitespace-nowrap text-[10px] font-bold sm:text-xs">人才銜接產業</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandArtwork() {
  return (
    <div className={`${stageClass} bg-gradient-to-br from-amber-50 via-white to-rose-100/80`}>
      <DotGrid tone="rose" />
      <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-orange-300/30 blur-2xl" />
      <div className="relative flex h-full min-h-[18rem] items-center justify-center p-6 sm:p-8">
        <div className="relative h-56 w-full max-w-md rounded-[2rem] border-2 border-dashed border-rose-200 bg-white/55 p-5">
          <span className="absolute -left-1 -top-1 h-10 w-10 rounded-tl-2xl border-l-4 border-t-4 border-orange-500" />
          <span className="absolute -right-1 -top-1 h-10 w-10 rounded-tr-2xl border-r-4 border-t-4 border-rose-500" />
          <span className="absolute -bottom-1 -left-1 h-10 w-10 rounded-bl-2xl border-b-4 border-l-4 border-amber-500" />
          <span className="absolute -bottom-1 -right-1 h-10 w-10 rounded-br-2xl border-b-4 border-r-4 border-purple-500" />

          <div className="absolute left-6 top-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg"><Camera className="h-8 w-8" /></div>
          <div className="absolute bottom-7 left-7 flex gap-2">
            <span className="h-5 w-5 rounded-full bg-orange-400" /><span className="h-5 w-5 rounded-full bg-rose-400" /><span className="h-5 w-5 rounded-full bg-purple-500" />
          </div>
          <div className="absolute right-8 top-1/2 flex h-32 w-36 -translate-y-1/2 flex-col items-center justify-center rounded-[1.75rem] bg-gradient-to-b from-white to-orange-50 shadow-xl shadow-rose-900/10">
            <div className="relative mb-2">
              <Box className="h-16 w-16 text-orange-500" strokeWidth={1.6} />
              <Sparkles className="absolute -right-5 -top-3 h-6 w-6 text-purple-500" />
            </div>
            <span className="text-xs font-bold text-rose-900">產品成為品牌</span>
          </div>
          <Palette className="absolute right-4 top-4 h-6 w-6 text-rose-400" />
        </div>
      </div>
    </div>
  );
}

function NewsArtwork() {
  const cards = [
    { icon: Landmark, className: "left-5 top-7", label: "政策" },
    { icon: CalendarDays, className: "right-5 top-8", label: "活動" },
    { icon: Megaphone, className: "bottom-7 left-1/2 -translate-x-1/2", label: "公告" },
  ];
  return (
    <div className={`${stageClass} bg-gradient-to-br from-blue-50 via-white to-indigo-100/80`}>
      <DotGrid tone="blue" />
      <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-200" />
      <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-blue-300" />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-100/80" />
      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        <path d="M200 150L78 72M200 150L324 76M200 150L200 248" stroke="#93c5fd" strokeWidth="2" strokeDasharray="6 7" />
      </svg>
      {cards.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.label} className={`absolute flex w-24 items-center gap-2 rounded-2xl border border-blue-200 bg-white p-3 text-blue-800 shadow-lg shadow-blue-900/10 ${item.className}`}>
            <Icon className="h-5 w-5" /><span className="text-[11px] font-bold">{item.label}</span>
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl shadow-blue-500/30">
        <Newspaper className="mb-1.5 h-8 w-8" /><span className="text-xs font-bold">消息中心</span>
      </div>
    </div>
  );
}

function DiscussionArtwork() {
  return (
    <div className={`${stageClass} bg-gradient-to-br from-violet-50 via-white to-slate-100`}>
      <DotGrid tone="violet" />
      <svg viewBox="0 0 500 300" className="absolute inset-0 h-full w-full" fill="none" aria-hidden="true">
        <path d="M102 77C172 94 177 126 250 150C316 171 348 139 409 90" stroke="#c4b5fd" strokeWidth="3" strokeDasharray="7 9" />
        <path d="M89 221C159 194 185 169 250 150C315 132 350 175 420 218" stroke="#fb923c" strokeWidth="3" strokeDasharray="7 9" />
      </svg>
      <div className="absolute left-6 top-7 w-36 rounded-2xl border border-violet-200 bg-white p-3 shadow-lg">
        <div className="flex items-center gap-2 text-violet-700"><MessageSquare className="h-5 w-5" /><span className="text-xs font-bold">公開討論</span></div>
        <div className="mt-2 space-y-1"><div className="h-1.5 w-24 rounded bg-violet-100" /><div className="h-1.5 w-16 rounded bg-violet-100" /></div>
      </div>
      <div className="absolute bottom-7 right-5 w-36 rounded-2xl border border-orange-200 bg-white p-3 shadow-lg">
        <div className="flex items-center gap-2 text-orange-700"><Gavel className="h-5 w-5" /><span className="text-xs font-bold">需求競標</span></div>
        <div className="mt-2 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" /><div className="h-1.5 flex-1 rounded bg-orange-100" /></div>
      </div>
      <div className="absolute bottom-8 left-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-white shadow-lg"><Users className="h-7 w-7" /></div>
      <div className="absolute right-7 top-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg"><BriefcaseBusiness className="h-7 w-7" /></div>
      <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-orange-500 text-white shadow-2xl shadow-violet-500/30 ring-8 ring-white/80">
        <Handshake className="mb-2 h-9 w-9" /><span className="text-xs font-bold">建立合作</span>
      </div>
    </div>
  );
}

export function AboutServiceArtwork({ kind, className = "" }: ArtworkProps) {
  const artwork = {
    factory: <FactorySearchArtwork />,
    resources: <ResourcesArtwork />,
    talent: <TalentArtwork />,
    brand: <BrandArtwork />,
    news: <NewsArtwork />,
    discussion: <DiscussionArtwork />,
  }[kind];

  return <div className={className} aria-hidden="true">{artwork}</div>;
}
