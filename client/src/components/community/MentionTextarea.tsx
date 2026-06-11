import { useRef, useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Factory, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MentionInput {
  type: "user" | "factory";
  id: number;
  displayName?: string; // kept for text-sync: remove mention if @displayName no longer in content
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  mentions: MentionInput[];
  onMentionsChange: (mentions: MentionInput[]) => void;
  postId?: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

interface MentionTarget {
  type: "factory" | "user";
  id: number;
  displayName: string;
  avatarUrl?: string | null;
}

interface Mention {
  query: string;
  startIndex: number;
}

function parseMentionAtCursor(text: string, cursor: number): Mention | null {
  const before = text.slice(0, cursor);
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return null;
  return {
    query: match[1],
    startIndex: before.lastIndexOf("@"),
  };
}

export default function MentionTextarea({
  value, onChange, mentions, onMentionsChange,
  postId, placeholder, rows = 2, disabled, className, onKeyDown,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeMention, setActiveMention] = useState<Mention | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [popoverAnchor, setPopoverAnchor] = useState<{ top: number; left: number } | null>(null);

  const searchEnabled = !!activeMention && activeMention.query.length >= 1;
  const searchQuery = trpc.community.searchMentionTargets.useQuery(
    { query: activeMention?.query ?? "", postId },
    { enabled: searchEnabled, placeholderData: (prev) => prev },
  );

  const results: MentionTarget[] = searchQuery.data ?? [];

  useEffect(() => setHighlightedIdx(0), [results.length]);

  const insertMention = useCallback((target: MentionTarget) => {
    if (!activeMention || !textareaRef.current) return;

    const { startIndex, query } = activeMention;
    const before = value.slice(0, startIndex);
    const after = value.slice(startIndex + 1 + query.length);
    const insertText = `@${target.displayName} `;

    onChange(before + insertText + after);
    // Include displayName so text-sync can remove this mention if text is deleted
    onMentionsChange([
      ...mentions.filter(m => !(m.type === target.type && m.id === target.id)),
      { type: target.type, id: target.id, displayName: target.displayName },
    ]);
    setActiveMention(null);

    const newCursor = before.length + insertText.length;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    });
  }, [activeMention, value, onChange, mentions, onMentionsChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Remove stale mentions whose @displayName no longer appears in the text
    const stale = mentions.filter(
      m => m.displayName && !newValue.includes(`@${m.displayName}`),
    );
    if (stale.length > 0) {
      onMentionsChange(mentions.filter(m => !stale.includes(m)));
    }

    const cursor = e.target.selectionStart ?? newValue.length;
    const mention = parseMentionAtCursor(newValue, cursor);
    setActiveMention(mention);

    if (mention && textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setPopoverAnchor({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    } else {
      setPopoverAnchor(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (activeMention && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIdx(i => (i + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIdx(i => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(results[highlightedIdx]);
        return;
      }
      if (e.key === "Escape") {
        setActiveMention(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const handleBlur = () => {
    // Delay so click on dropdown item fires first
    setTimeout(() => setActiveMention(null), 150);
  };

  const showDropdown = !!activeMention && (searchEnabled || searchQuery.isLoading);

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={cn(
          "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none",
          className,
        )}
      />

      {showDropdown && popoverAnchor && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[220px] max-w-[300px]"
          style={{ top: popoverAnchor.top, left: Math.min(popoverAnchor.left, window.innerWidth - 320) }}
        >
          {searchQuery.isLoading && results.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              搜尋中…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              沒有符合的結果
            </div>
          ) : (
            results.map((t, i) => (
              <button
                key={`${t.type}:${t.id}`}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors",
                  i === highlightedIdx ? "bg-orange-50 dark:bg-orange-950/30" : "hover:bg-muted/50",
                )}
                onMouseDown={(e) => { e.preventDefault(); insertMention(t); }}
                onMouseEnter={() => setHighlightedIdx(i)}
              >
                {t.avatarUrl ? (
                  <img src={t.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0 object-cover" />
                ) : t.type === "factory" ? (
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                    <Factory className="w-3.5 h-3.5 text-orange-500" />
                  </span>
                ) : (
                  <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                )}
                <span className="truncate">{t.displayName}</span>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                  {t.type === "factory" ? "工廠" : "用戶"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
