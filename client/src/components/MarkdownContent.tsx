import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";

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

const components: Components = {
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
  // Images are disabled: no external tracking pixels, no layout surprises
  // from an admin pasting an arbitrary image URL into an announcement.
  img: () => null,
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
};

/**
 * Shared, safe renderer for announcement.content everywhere it's shown to
 * end users. No raw HTML is ever allowed (skipHtml + no rehypeRaw plugin),
 * links are restricted to http/https/mailto, and images are disabled.
 */
export default function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`text-sm break-words ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkBreaks]} components={components} skipHtml>
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
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[#>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 1).trimEnd()}…`;
}
