import { visit } from "unist-util-visit";

// 公告字級：只允許這 4 種受控 className，不開放任意 inline style。
export const ANNOUNCEMENT_FONT_SIZES = ["sm", "base", "lg", "xl"] as const;
export type AnnouncementFontSize = (typeof ANNOUNCEMENT_FONT_SIZES)[number];

export const ANNOUNCEMENT_FONT_SIZE_LABELS: Record<AnnouncementFontSize, string> = {
  sm: "小",
  base: "一般",
  lg: "大",
  xl: "特大",
};

/**
 * Remark plugin: turns `:sm[text]` / `:base[text]` / `:lg[text]` / `:xl[text]`
 * text directives (from remark-directive) into a <span className="announcement-text-*">
 * node for remark-rehype, via the standard data.hName/hProperties convention.
 * Any other/unknown directive name is unwrapped back to plain text so it never
 * breaks rendering of pre-existing announcement content.
 */
export function remarkAnnouncementFontSize() {
  return (tree: any) => {
    visit(tree, (node: any, index, parent) => {
      if (node.type !== "textDirective") return;
      const name = node.name;
      if (!parent || typeof index !== "number") return;
      if (!(ANNOUNCEMENT_FONT_SIZES as readonly string[]).includes(name)) {
        // 未知指令：直接展開子節點，避免整段內容消失
        parent.children.splice(index, 1, ...(node.children ?? []));
        return index;
      }
      node.data = node.data || {};
      node.data.hName = "span";
      node.data.hProperties = { className: `announcement-text-${name}` };
    });
  };
}
