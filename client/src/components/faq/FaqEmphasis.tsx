import type { ReactNode } from "react";

export type FaqEmphasisTone = "orange" | "purple";

export interface FaqEmphasisRange {
  /** 逐字比對 answerParagraphs 原文的子字串，不得改寫文案本身。 */
  text: string;
  tone: FaqEmphasisTone;
}

/**
 * FAQ 回答內文的重點樣式——單一橘色系粗體，不加底色／底線，對應
 * 【關於OXM】品牌宣言（AboutOXM.tsx 的 brandStatementLines）同一份
 * font-bold + text-orange-600 視覺份量，不再依 tone 分成橘／紫兩色（
 * 2026-08-22 使用者驗收回饋：橘紫混用看起來太亂，改統一成單一橘色系）。
 * FaqEmphasisRange.tone 這個欄位與既有 faqEmphasisData.ts 的標記資料本身
 * 保留不動（避免牽動範圍資料），只是渲染時刻意忽略 tone 的差異。
 */
export function FaqEmphasis({
  children,
}: {
  tone: FaqEmphasisTone;
  children: ReactNode;
}) {
  return <strong className="font-bold text-orange-600">{children}</strong>;
}

/**
 * 在不改動 paragraph 純文字的前提下，把 ranges 命中的子字串包成 <FaqEmphasis>。
 * 找不到（該段落沒有這個子字串）就略過，避免因段落切分而誤標其他段落。
 */
export function renderFaqParagraph(paragraph: string, ranges?: FaqEmphasisRange[]): ReactNode {
  if (!ranges || ranges.length === 0) return paragraph;

  const matches = ranges
    .map((range) => ({ range, start: paragraph.indexOf(range.text) }))
    .filter((m): m is { range: FaqEmphasisRange; start: number } => m.start !== -1)
    .sort((a, b) => a.start - b.start);

  if (matches.length === 0) return paragraph;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((m, i) => {
    if (m.start < cursor) return; // 防禦性跳過重疊命中
    const end = m.start + m.range.text.length;
    if (m.start > cursor) {
      nodes.push(paragraph.slice(cursor, m.start));
    }
    nodes.push(
      <FaqEmphasis key={i} tone={m.range.tone}>
        {paragraph.slice(m.start, end)}
      </FaqEmphasis>,
    );
    cursor = end;
  });

  if (cursor < paragraph.length) {
    nodes.push(paragraph.slice(cursor));
  }

  return nodes;
}
