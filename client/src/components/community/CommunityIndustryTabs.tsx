import { useRef, useEffect } from "react";
import { useLocation } from "wouter";
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
      className="flex overflow-x-auto border-b border-border [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="選擇產業看板"
    >
      {TABS.map(tab => (
        <button
          key={tab.slug}
          ref={tab.slug === activeSpaceCode ? activeRef : undefined}
          role="tab"
          aria-selected={tab.slug === activeSpaceCode}
          onClick={() => navigate(`/community/${tab.slug}/discussions`)}
          className={cn(
            "shrink-0 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
            "border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            tab.slug === activeSpaceCode
              ? "border-orange-500 text-orange-600 dark:text-orange-400"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
          )}
        >
          {tab.name}
        </button>
      ))}
    </div>
  );
}
