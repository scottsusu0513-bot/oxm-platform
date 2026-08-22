/**
 * FAQ 第 6 項：依人工黃色標記加入 OXM 橘／紫粗體重點——這裡驗證：
 * 1. FAQ_CONTENT 原始 16 題純文字完全未被本輪改動（answerParagraphs 逐字不變）
 * 2. FAQ_EMPHASIS 標記的每一段子字串，都逐字存在於對應題目的 answerParagraphs 原文中
 *    （不得自行改寫、不得標記不存在的文字）
 * 3. FAQ.tsx 透過 renderFaqParagraph(paragraph, FAQ_EMPHASIS[q.id]) 套用重點，
 *    answerParagraphs 本身沒有被改成 ReactNode，JSON-LD／SEO 用的純文字資料不受影響
 * 4. FaqEmphasis 只有粗體＋文字色（沿用既有 text-orange-600 / text-purple-700），
 *    沒有任何黃色底色／background／underline
 * 5. 沒有使用 dangerouslySetInnerHTML
 * 6. 「OXM 是什麼？」（about-1）在 FAQ_CONTENT 中仍然只有一題
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAQ_CONTENT, getFaqQuestionsFlat } from "../shared/content/faq";
import { getFaqPageSchema } from "@shared/seo/schema";
import { FAQ_EMPHASIS } from "../client/src/components/faq/faqEmphasisData";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("FAQ_CONTENT 原始資料完全未被本輪改動", () => {
  it("仍是 4 分類、題數 5/4/3/4，合計 16 題", () => {
    expect(FAQ_CONTENT.categories).toHaveLength(4);
    expect(FAQ_CONTENT.categories.map((c) => c.questions.length)).toEqual([5, 4, 3, 4]);
    expect(getFaqQuestionsFlat()).toHaveLength(16);
  });

  it("FAQPage JSON-LD 仍恰好 16 題，且 acceptedAnswer.text 仍是純文字（未被 emphasis 污染）", () => {
    const flat = getFaqQuestionsFlat();
    const schema = getFaqPageSchema();
    const mainEntity = schema.mainEntity as { acceptedAnswer: { text: string } }[];
    expect(mainEntity).toHaveLength(16);
    mainEntity.forEach((entry, i) => {
      expect(entry.acceptedAnswer.text).toBe(flat[i].answerParagraphs.join("\n\n"));
      expect(entry.acceptedAnswer.text).not.toMatch(/<[a-z][\s\S]*>/i);
    });
  });

  it("「OXM 是什麼？」只有一題（about-1），不因截圖重複出現而增加資料", () => {
    const matches = getFaqQuestionsFlat().filter((q) => q.question === "OXM 是什麼？");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("about-1");
  });
});

describe("FAQ_EMPHASIS 標記範圍——逐字存在於原文，且未被過度標記", () => {
  const flat = getFaqQuestionsFlat();
  const byId = new Map(flat.map((q) => [q.id, q]));

  it("每一個標記的 question id 都是既有 FAQ 題目", () => {
    for (const id of Object.keys(FAQ_EMPHASIS)) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it("每一段標記子字串都逐字存在於該題 answerParagraphs 的某一段落中", () => {
    for (const [id, ranges] of Object.entries(FAQ_EMPHASIS)) {
      const q = byId.get(id)!;
      for (const range of ranges) {
        const hit = q.answerParagraphs.some((p) => p.includes(range.text));
        expect(hit, `[${id}] 找不到標記文字：${range.text}`).toBe(true);
      }
    }
  });

  it("16 題都至少有一段標記重點", () => {
    for (const q of flat) {
      expect(FAQ_EMPHASIS[q.id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("tone 只能是 orange 或 purple", () => {
    for (const ranges of Object.values(FAQ_EMPHASIS)) {
      for (const range of ranges) {
        expect(["orange", "purple"]).toContain(range.tone);
      }
    }
  });
});

describe("client/src/components/faq/FaqEmphasis.tsx——只有粗體＋文字色，沒有黃色底色", () => {
  const source = readSource("client", "src", "components", "faq", "FaqEmphasis.tsx");

  it("使用既有 OXM 品牌色 text-orange-600 / text-purple-700，沒有自訂 hex 色碼", () => {
    expect(source).toMatch(/text-orange-600/);
    expect(source).toMatch(/text-purple-700/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("沒有黃色 background、底線，也沒有改變字級／行高", () => {
    expect(source).not.toMatch(/bg-yellow|bg-\[#/i);
    expect(source).not.toMatch(/underline/);
    expect(source).not.toMatch(/text-(xs|sm|base|lg|xl|\d?xl)\b/);
    expect(source).not.toMatch(/leading-/);
  });

  it("沒有使用 dangerouslySetInnerHTML", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("client/src/pages/FAQ.tsx——套用 emphasis 但不改動 answerParagraphs 純文字資料", () => {
  const source = readSource("client", "src", "pages", "FAQ.tsx");

  it("透過 renderFaqParagraph(paragraph, FAQ_EMPHASIS[q.id]) 渲染，而不是直接改寫 answerParagraphs", () => {
    expect(source).toMatch(/import \{ renderFaqParagraph \} from "@\/components\/faq\/FaqEmphasis"/);
    expect(source).toMatch(/import \{ FAQ_EMPHASIS \} from "@\/components\/faq\/faqEmphasisData"/);
    expect(source).toMatch(/renderFaqParagraph\(paragraph, FAQ_EMPHASIS\[q\.id\]\)/);
  });

  it("沒有使用 dangerouslySetInnerHTML", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("Accordion 結構（AccordionItem/Trigger/Content）與題目文字渲染未被改動", () => {
    expect(source).toMatch(/<AccordionTrigger[\s\S]*?>[\s\S]*?\{q\.question\}/);
    expect(source).toMatch(/<AccordionContent/);
  });

  it("FaqAiEntry 入口未被移除", () => {
    expect(source).toMatch(/<FaqAiEntry\b/);
  });
});
