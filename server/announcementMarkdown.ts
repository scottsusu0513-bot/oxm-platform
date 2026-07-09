import { Marked, type RendererObject, type Tokens, type TokenizerAndRendererExtension } from "marked";

// Renders admin-authored Markdown (bold/italic/headings/lists/links/line
// breaks/hr) into inline-styled HTML safe to drop straight into an email
// body. No raw HTML is ever allowed to survive: the source is fully
// HTML-escaped *before* Markdown parsing, so any literal "<script>" (or any
// other tag) the admin typed becomes inert escaped text rather than a tag
// marked could interpret. Links are restricted to http(s)/mailto; images are
// dropped entirely (no external tracking pixels, no email layout surprises).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeEmailHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

const HEADING_STYLES: Record<number, string> = {
  1: "font-size:20px;font-weight:700;margin:16px 0 8px;color:#1f2937;",
  2: "font-size:17px;font-weight:700;margin:14px 0 6px;color:#1f2937;",
  3: "font-size:15px;font-weight:700;margin:12px 0 6px;color:#1f2937;",
};
const DEFAULT_HEADING_STYLE = "font-size:14px;font-weight:700;margin:10px 0 6px;color:#1f2937;";

// 公告字級：與前台 client/src/lib/announcementFontSize.ts 的 :sm[]/:base[]/:lg[]/:xl[]
// 語法一致，讓公告 Email 通知也能正確呈現字級（Email 需用 inline style，不能用 CSS class）。
const FONT_SIZE_STYLES: Record<string, string> = {
  sm: "font-size:12px;",
  base: "",
  lg: "font-size:18px;",
  xl: "font-size:24px;",
};

const fontSizeExtension: TokenizerAndRendererExtension = {
  name: "announcementFontSize",
  level: "inline",
  start(src: string) {
    return src.match(/:(?:sm|base|lg|xl)\[/)?.index;
  },
  tokenizer(src: string) {
    const match = /^:(sm|base|lg|xl)\[([^\]]*)\]/.exec(src);
    if (!match) return undefined;
    const [raw, size, inner] = match;
    return {
      type: "announcementFontSize",
      raw,
      size,
      tokens: this.lexer.inlineTokens(inner),
    } as Tokens.Generic;
  },
  renderer(token: any) {
    const style = FONT_SIZE_STYLES[token.size] ?? "";
    return `<span style="${style}">${this.parser.parseInline(token.tokens)}</span>`;
  },
};

const renderer: RendererObject = {
  link({ href, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    if (!isSafeEmailHref(href)) return text;
    // href was extracted from markdown source that was already fully
    // HTML-escaped up front (see renderAnnouncementEmailHtml below), so it's
    // already attribute-safe here — escaping it again would double-encode
    // "&" into "&amp;amp;" and corrupt any URL with a query string.
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#f97316;text-decoration:underline;">${text}</a>`;
  },
  image({ text }: Tokens.Image): string {
    // Images are disabled for announcement emails (no external tracking
    // pixels, no layout surprises) — fall back to just the alt text, if any.
    return text ? escapeHtml(text) : "";
  },
  heading({ tokens, depth }: Tokens.Heading): string {
    const style = HEADING_STYLES[depth] ?? DEFAULT_HEADING_STYLE;
    return `<h${depth} style="${style}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  },
  paragraph({ tokens }: Tokens.Paragraph): string {
    return `<p style="margin:8px 0;line-height:1.7;">${this.parser.parseInline(tokens)}</p>\n`;
  },
  list(token: Tokens.List): string {
    const tag = token.ordered ? "ol" : "ul";
    const start = token.ordered && token.start !== "" && token.start !== 1 ? ` start="${token.start}"` : "";
    const items = token.items.map(item => this.listitem(item)).join("");
    return `<${tag}${start} style="margin:8px 0;padding-left:22px;">\n${items}</${tag}>\n`;
  },
  listitem(item: Tokens.ListItem): string {
    return `<li style="margin:4px 0;line-height:1.6;">${this.parser.parse(item.tokens)}</li>\n`;
  },
  hr(): string {
    return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">\n`;
  },
};

// A dedicated instance (rather than mutating the shared default `marked`
// singleton) so this module's renderer/options can never leak into or be
// affected by any other future use of the `marked` package in this codebase.
const emailMarked = new Marked({ renderer, breaks: true, gfm: true });
emailMarked.use({ extensions: [fontSizeExtension] });

/** Converts admin-authored announcement Markdown into safe, inline-styled email HTML. */
export function renderAnnouncementEmailHtml(markdown: string): string {
  const escaped = escapeHtml(markdown);
  return emailMarked.parse(escaped, { async: false }) as string;
}
