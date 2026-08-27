import { useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Factory, Network } from "lucide-react";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS } from "@shared/constants";
import { COMMUNITY_CROSS_INDUSTRY_NAME, COMMUNITY_CROSS_INDUSTRY_SLUG } from "@shared/const";
import { cn } from "@/lib/utils";

interface Props {
  activeSpaceCode: string;
}

const TABS: Array<{ name: string; slug: string }> = [
  { name: COMMUNITY_CROSS_INDUSTRY_NAME, slug: COMMUNITY_CROSS_INDUSTRY_SLUG },
  ...Array.from(INDUSTRY_OPTIONS)
    .map(name => ({ name, slug: INDUSTRY_SLUGS[name] ?? "" }))
    .filter(t => t.slug !== ""),
];

export default function CommunityIndustryTabs({ activeSpaceCode }: Props) {
  const [, navigate] = useLocation();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSpaceCode]);

  return (
    <div
      className="flex gap-1 overflow-x-auto overflow-y-hidden rounded-xl border border-purple-100/80 bg-white/90 p-1.5 shadow-sm dark:border-purple-900/40 dark:bg-card [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="選擇產業看板"
    >
      {TABS.map(tab => {
        const isActive = tab.slug === activeSpaceCode;
        const Icon = tab.slug === COMMUNITY_CROSS_INDUSTRY_SLUG ? Network : Factory;
        return (
          <button
            key={tab.slug}
            ref={isActive ? activeRef : undefined}
            role="tab"
            aria-selected={isActive}
            onClick={() => navigate(`/community/${tab.slug}/discussions`)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
              isActive
                ? "bg-purple-600 text-white shadow-sm"
                : "text-muted-foreground hover:-translate-y-px hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950/30 dark:hover:text-purple-300"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive && "text-orange-200")} aria-hidden="true" />
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
