import type { ReactNode } from "react";

export type FaqEmphasisTone = "orange" | "purple";

export interface FaqEmphasisRange {
  /** 逐字比對 answerParagraphs 原文的子字串，不得改寫文案本身。 */
  text: string;
  tone: FaqEmphasisTone;
}

/**
 * FAQ 回答內文的重點樣式——只有粗體＋OXM 品牌色，不加底色／底線，
 * 對應 client/src/pages/FAQ.tsx 既有的 text-orange-600 / text-purple-700 用色慣例。
 */
export function FaqEmphasis({
  tone,
  children,
}: {
  tone: FaqEmphasisTone;
  children: ReactNode;
}) {
  return (
    <strong
      className={tone === "orange" ? "font-semibold text-orange-600" : "font-semibold text-purple-700"}
    >
      {children}
    </strong>
  );
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
