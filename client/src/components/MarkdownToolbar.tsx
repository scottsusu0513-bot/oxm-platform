import type { ReactNode, RefObject } from "react";
import { Bold, Italic, Heading2, Link2, SeparatorHorizontal, Type, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ANNOUNCEMENT_FONT_SIZES, ANNOUNCEMENT_FONT_SIZE_LABELS } from "@/lib/announcementFontSize";

// 這份 helper 與工具列 JSX 原本只存在於 AdminAnnouncements.tsx，抽成共用元件
// 讓 AdminNews 能沿用同一套語法／行為，不建立第二套不相容的 Markdown 工具列。
// 抽取時逐字保留原本邏輯，AdminAnnouncements 改用這個元件後畫面與行為必須
// 零差異（見 server/announcementActionUrl.test.ts、server/news.test.ts 的
// 對應回歸測試）。

export function wrapSelection(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
  prefix: string,
  suffix: string,
  placeholder: string,
) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const inserted = selected || placeholder;
  const next = value.slice(0, start) + prefix + inserted + suffix + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const selStart = start + prefix.length;
    textarea.setSelectionRange(selStart, selStart + inserted.length);
  });
}

// 對目前選取涵蓋的每一行開頭加上 prefix（標題／項目符號／編號清單皆是逐行語法）
export function prefixLines(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
  linePrefix: string,
  placeholder: string,
) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const content = block.trim() === "" ? placeholder : block;
  const prefixed = content.split("\n").map(line => (line ? `${linePrefix}${line}` : line)).join("\n");
  const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
  });
}

export function insertLink(textarea: HTMLTextAreaElement, value: string, onChange: (next: string) => void) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const linkText = selected || "連結文字";
  const inserted = `[${linkText}](https://)`;
  const next = value.slice(0, start) + inserted + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    // Select the "https://" placeholder so the admin can immediately type the real URL over it.
    const urlStart = start + `[${linkText}](`.length;
    textarea.setSelectionRange(urlStart, urlStart + "https://".length);
  });
}

// 插入一段純文字到游標位置（有選取則取代選取範圍）；用於分隔線這類不需要「包住文字」的插入。
export function insertAtCursor(textarea: HTMLTextAreaElement, value: string, onChange: (next: string) => void, text: string) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const cursor = start + text.length;
    textarea.setSelectionRange(cursor, cursor);
  });
}

interface MarkdownToolbarProps {
  contentRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  onChange: (next: string) => void;
  /** 插在字級選單之後的額外按鈕（目前只有 AdminNews 的「上傳圖片」）。 */
  extraButtons?: ReactNode;
}

/** 平台公告與找消息共用的 Markdown 文字特效工具列：粗體／斜體／標題／連結／分隔線／字級。 */
export function MarkdownToolbar({ contentRef, content, onChange, extraButtons }: MarkdownToolbarProps) {
  const toolbarActions: Array<{ icon: typeof Bold; label: string; onClick: () => void }> = [
    { icon: Bold, label: "粗體", onClick: () => contentRef.current && wrapSelection(contentRef.current, content, onChange, "**", "**", "粗體文字") },
    { icon: Italic, label: "斜體", onClick: () => contentRef.current && wrapSelection(contentRef.current, content, onChange, "*", "*", "斜體文字") },
    { icon: Heading2, label: "標題", onClick: () => contentRef.current && prefixLines(contentRef.current, content, onChange, "## ", "標題文字") },
    { icon: Link2, label: "連結", onClick: () => contentRef.current && insertLink(contentRef.current, content, onChange) },
    { icon: SeparatorHorizontal, label: "分隔線", onClick: () => contentRef.current && insertAtCursor(contentRef.current, content, onChange, "\n\n---\n\n") },
  ];
  const applyFontSize = (size: (typeof ANNOUNCEMENT_FONT_SIZES)[number]) => {
    if (!contentRef.current) return;
    wrapSelection(contentRef.current, content, onChange, `:${size}[`, "]", "文字");
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 mb-1.5 p-1.5 bg-muted/40 rounded-md border overflow-x-auto">
      {toolbarActions.map(a => (
        <button
          key={a.label}
          type="button"
          title={a.label}
          aria-label={a.label}
          onClick={a.onClick}
          className="p-1.5 rounded hover:bg-white hover:shadow-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <a.icon className="w-3.5 h-3.5" />
        </button>
      ))}
      <div className="w-px h-4 bg-border mx-0.5" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="字體大小"
            aria-label="字體大小"
            className="flex items-center gap-0.5 p-1.5 rounded hover:bg-white hover:shadow-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Type className="w-3.5 h-3.5" />
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ANNOUNCEMENT_FONT_SIZES.map(size => (
            <DropdownMenuItem key={size} onClick={() => applyFontSize(size)}>
              {ANNOUNCEMENT_FONT_SIZE_LABELS[size]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {extraButtons}
    </div>
  );
}
