import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface Props {
  spaceCode: string;
  activeSection: "discussions" | "bids";
}

const SECTIONS = [
  { id: "discussions" as const, label: "討論區" },
  { id: "bids" as const, label: "競標區" },
] as const;

export default function CommunitySectionTabs({ spaceCode, activeSection }: Props) {
  const [, navigate] = useLocation();

  return (
    <div
      className="flex gap-0 border-b border-border mt-4"
      role="tablist"
      aria-label="討論區或競標區"
    >
      {SECTIONS.map(sec => (
        <button
          key={sec.id}
          role="tab"
          aria-selected={activeSection === sec.id}
          onClick={() => navigate(`/community/${spaceCode}/${sec.id}`)}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            "border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            activeSection === sec.id
              ? "border-orange-500 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {sec.label}
        </button>
      ))}
    </div>
  );
}
