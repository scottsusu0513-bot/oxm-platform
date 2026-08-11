import { cn } from "@/lib/utils";

export type UpgradeProgramCardData = {
  id: number;
  slug: string;
  title: string;
  shortTitle: string | null;
  description: string;
  targetAudience: string | null;
  highlights: string[];
  badge: string | null;
  statusLabel: string | null;
  visualKey: string;
  maxFundingLabel: string | null;
  imageUrl: string | null;
  ctaLabel: string;
};

type VisualTheme = {
  accent: string;
  accentText: string;
  accentBg: string;
  accentBorder: string;
  number: string;
};

const VISUAL_THEMES: Record<string, VisualTheme> = {
  innovation: {
    accent: "from-orange-500 via-orange-400 to-amber-300",
    accentText: "text-orange-600",
    accentBg: "bg-orange-50",
    accentBorder: "border-orange-200",
    number: "text-orange-100/80",
  },
  manufacturing: {
    accent: "from-amber-500 via-orange-400 to-orange-300",
    accentText: "text-amber-700",
    accentBg: "bg-amber-50",
    accentBorder: "border-amber-200",
    number: "text-amber-100/80",
  },
  digital: {
    accent: "from-violet-500 via-purple-400 to-fuchsia-300",
    accentText: "text-violet-600",
    accentBg: "bg-violet-50",
    accentBorder: "border-violet-200",
    number: "text-violet-100/80",
  },
  growth: {
    accent: "from-teal-500 via-cyan-400 to-sky-300",
    accentText: "text-teal-700",
    accentBg: "bg-teal-50",
    accentBorder: "border-teal-200",
    number: "text-teal-100/80",
  },
  global: {
    accent: "from-sky-500 via-blue-400 to-indigo-400",
    accentText: "text-sky-700",
    accentBg: "bg-sky-50",
    accentBorder: "border-sky-200",
    number: "text-sky-100/80",
  },
  funding: {
    accent: "from-slate-600 via-violet-500 to-purple-400",
    accentText: "text-slate-700",
    accentBg: "bg-slate-100",
    accentBorder: "border-slate-200",
    number: "text-slate-100",
  },
};

export function UpgradeProgramCard({
  program,
  index,
}: {
  program: UpgradeProgramCardData;
  index: number;
}) {
  const theme = VISUAL_THEMES[program.visualKey] ?? VISUAL_THEMES.funding;
  const programNumber = String(index + 1).padStart(2, "0");

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,.75)] transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_26px_60px_-40px_rgba(15,23,42,.65)]">
      <div className={cn("h-[3px] w-full bg-gradient-to-r", theme.accent)} />

      {program.imageUrl && (
        <div className="mx-6 mt-6 aspect-[16/7] overflow-hidden rounded-2xl bg-slate-100">
          <img
            src={program.imageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        </div>
      )}

      <div className="relative flex flex-1 flex-col p-6 sm:p-7">
        <span
          className={cn(
            "pointer-events-none absolute right-5 top-3 font-mono text-[76px] font-black leading-none tracking-tighter",
            theme.number,
          )}
          aria-hidden="true"
        >
          {programNumber}
        </span>

        <div className="relative mb-7 flex min-h-10 items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold tracking-[.22em] text-slate-400">GOVERNMENT PROGRAM</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn("font-mono text-xs font-black tabular-nums", theme.accentText)}>{programNumber}</span>
              <span className="h-3 w-px bg-slate-300" aria-hidden="true" />
              <span className="text-xs font-extrabold tracking-wide text-slate-700">{program.shortTitle || program.slug.toUpperCase()}</span>
              {program.badge && <span className="text-[11px] font-medium text-slate-400">{program.badge}</span>}
            </div>
          </div>
          {program.statusLabel && (
            <span className="relative z-10 shrink-0 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] font-medium text-slate-500 shadow-sm">
              {program.statusLabel}
            </span>
          )}
        </div>

        <h3 className="relative text-[21px] font-black leading-[1.35] tracking-[-.02em] text-slate-950 sm:text-[22px]">{program.title}</h3>
        <p className="mt-4 text-sm leading-7 text-slate-600">{program.description}</p>

        {program.targetAudience && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-[10px] font-bold tracking-[.16em] text-slate-400">適合對象</p>
            <p className="mt-2 text-[13px] leading-6 text-slate-600">{program.targetAudience}</p>
          </div>
        )}

        {program.highlights.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {program.highlights.map((highlight) => (
              <span
                key={highlight}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold",
                  theme.accentBg,
                  theme.accentBorder,
                  theme.accentText,
                )}
              >
                {highlight}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto border-t border-slate-200 pt-6">
          {program.maxFundingLabel && (
            <>
              <p className="text-[10px] font-bold tracking-[.16em] text-slate-400">最高補助金額</p>
              <p className="mt-1.5 text-xl font-black tracking-[-.02em] text-slate-950 sm:text-2xl">{program.maxFundingLabel}</p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function UpgradeProgramSkeleton() {
  return (
    <div className="h-[420px] animate-pulse overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="h-[3px] bg-slate-200" />
      <div className="space-y-5 p-7">
        <div className="h-4 w-36 rounded bg-slate-100" />
        <div className="h-7 w-3/4 rounded bg-slate-100" />
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-slate-100" />
          <div className="h-4 w-5/6 rounded bg-slate-100" />
        </div>
        <div className="h-px bg-slate-100" />
        <div className="h-16 rounded bg-slate-50" />
      </div>
    </div>
  );
}
