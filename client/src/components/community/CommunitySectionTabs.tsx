import { useLocation } from "wouter";
import { Gavel, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  spaceCode: string;
  activeSection: "discussions" | "bids";
}

const SECTIONS = [
  { id: "discussions" as const, label: "討論區", Icon: MessagesSquare },
  { id: "bids" as const, label: "競標區", Icon: Gavel },
] as const;

export default function CommunitySectionTabs({ spaceCode, activeSection }: Props) {
  const [, navigate] = useLocation();

  return (
    <div
      className="mt-3 flex gap-2 border-b border-purple-100 dark:border-purple-900/40"
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
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1",
            activeSection === sec.id
              ? "border-orange-500 text-purple-700 dark:text-purple-300"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <sec.Icon className={cn("h-4 w-4", activeSection === sec.id && "text-orange-500")} aria-hidden="true" />
          {sec.label}
        </button>
      ))}
    </div>
  );
}
