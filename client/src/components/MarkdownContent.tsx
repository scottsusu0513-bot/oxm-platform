import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkDirective from "remark-directive";
import { remarkAnnouncementFontSize } from "@/lib/announcementFontSize";

const SAFE_URL_PROTOCOLS = ["http:", "https:", "mailto:"];

// Deliberately no base URL: only absolute http(s)/mailto links are allowed,
// so a relative URL (which would need `window.location.origin` to resolve)
// is exactly what we want to reject anyway. This also means the check never
// touches `window`, so it works the same in the browser, in tests, and in
// any future SSR context.
function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    return SAFE_URL_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

// 只有明確 allowImages 的呼叫端（目前只有找消息 NewsDetail／AdminNews 預覽）
// 才會用到這個 components 版本；平台公告等既有呼叫端沿用 img: () => null，
// 行為完全不變。https 限定，跟 isSafeHref 的連結規則一致，但不含 mailto:
// （圖片來源沒有信箱協定的使用情境）。
function isSafeImgSrc(src: string | undefined): boolean {
  if (!src) return false;
  try {
    return new URL(src).protocol === "https:";
  } catch {
    return false;
  }
}

function buildComponents(allowImages: boolean): Components {
  return {
    a: ({ href, children, node: _node, ...props }) => {
      if (!isSafeHref(href)) {
        return <span {...props}>{children}</span>;
      }
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-600 underline underline-offset-2 hover:text-orange-700 break-words"
        >
          {children}
        </a>
      );
    },
    // Images are disabled by default: no external tracking pixels, no layout
    // surprises from an admin pasting an arbitrary image URL into an
    // announcement. Only content that explicitly opts in (allowImages) and
    // only for https sources renders a real <img>.
    img: ({ src, alt }) => {
      if (!allowImages || !isSafeImgSrc(typeof src === "string" ? src : undefined)) return null;
      return (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="max-w-full h-auto rounded-lg my-2"
        />
      );
    },
    h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed break-words">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed break-words">{children}</li>,
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-2">{children}</blockquote>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-muted text-[0.85em] break-words">{children}</code>
  ),
    // 公告字級：由 remarkAnnouncementFontSize 產生的 className，僅限固定的 4 種受控字級。
    span: ({ children, className }) => <span className={className}>{children}</span>,
  };
}

const DEFAULT_COMPONENTS = buildComponents(false);
const IMAGE_ENABLED_COMPONENTS = buildComponents(true);

/**
 * Shared, safe renderer for announcement.content everywhere it's shown to
 * end users. No raw HTML is ever allowed (skipHtml + no rehypeRaw plugin),
 * links are restricted to http/https/mailto. Images are disabled by default
 * (existing behavior, unchanged for announcements/login popups/everything
 * else); pass allowImages to render https image sources — currently only
 * used by 找消息 NewsDetail 與 AdminNews 的即時預覽。
 */
export default function MarkdownContent({ content, className, allowImages = false }: { content: string; className?: string; allowImages?: boolean }) {
  return (
    <div className={`text-sm break-words ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkBreaks, remarkDirective, remarkAnnouncementFontSize]}
        components={allowImages ? IMAGE_ENABLED_COMPONENTS : DEFAULT_COMPONENTS}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Strips Markdown syntax down to a short plain-text preview (for compact, single-line teasers). */
export function toMarkdownPreviewText(markdown: string, maxLen = 80): string {
  const plain = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/:(?:sm|base|lg|xl)\[([^\]]*)\]/g, "$1")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[#>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`;
}
