// @vitest-environment jsdom
/**
 * Hotfix 2：正式站 FAQ 頁多題同時展開的 regression test。
 *
 * Root cause（見對話「Hotfix 2」，已用原始碼確認，不是 FAQ.tsx 的 state
 * 邏輯問題）：client/src/pages/FAQ.tsx 本身的 openQuestionId 已經是正確的
 * 全頁單一 state，四個分類的 <Accordion> 全部共用同一個
 * value={openQuestionId} / onValueChange={setOpenQuestionId}——問題出在
 * client/src/components/ui/accordion.tsx 的 AccordionContent：FAQ.tsx 用
 * forceMount（為了讓收合內容仍留在初始 HTML 供 SEO），但 Radix
 * CollapsibleContent 內部的 `<Presence present={forceMount || context.open}>`
 * 會讓 forceMount=true 時 present 恆為 true，連帶讓 isOpen 恆為 true、原生
 * `hidden={!isOpen}` attribute 永遠不生效；而這個專案從未定義過
 * accordion-down／accordion-up 這兩個 keyframe 動畫，所以完全沒有其他機制
 * 收合已關閉的項目——所有題目才會同時看起來是展開的。
 *
 * 這裡不用純字串比對（那種測試已經證實會漏掉這個 bug：source 裡明明只有
 * 一個 useState("")、也沒有 defaultValue，看起來完全正確），改用真正的
 * jsdom render + 使用者點擊互動，直接對真正的
 * client/src/components/ui/accordion.tsx（Radix 包裝元件）驗證行為，用一個
 * 忠實複製 FAQ.tsx accordion 寫法的最小 harness（多個 category、共用同一個
 * openQuestionId state），不需要另外 mock trpc／router／AiShellProvider
 * （那些跟這個 accordion regression 無關）。
 *
 * 範圍說明（誠實標註這份測試涵蓋什麼、不涵蓋什麼，避免自己也犯同一種
 * 「看起來測到了，其實沒有」的錯）：這裡驗證的是 Radix 的 data-state
 * open／closed 是否正確地全站只有一個（真正的 state 邏輯，F1-F6 的核心要求
 * ——這正是 bug report 真正擔心的regression），以及實際渲染出來的
 * AccordionContent DOM 節點是否帶有本次修好的
 * `data-[state=closed]:hidden` class（確認修復真的存在於渲染出來的元件，不
 * 是只存在於原始碼字串）。jsdom 沒有載入真正編譯過的 Tailwind
 * 樣式表，所以「畫面上真的 display:none」這件事本身，這裡不用
 * getComputedStyle 假裝驗證（先前一版曾經這樣做，結果驗證出一個跟修復內容
 * 完全無關、恆為真的規則，等於沒測到東西）——改成用瀏覽器實測確認
 * （見這次 hotfix 的 Browser Validation 步驟）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// 這個專案的 vitest.config.ts 沒有開 `globals: true`（每個測試檔都自己
// import describe/it/expect），@testing-library/react 依賴全域 afterEach 的
// auto-cleanup 偵測機制因此不會生效，需要自己明確在每個 it() 之間 unmount，
// 否則前一個 it() render 出來的節點會留在 DOM 裡，下一個 it() 的
// screen.getByText 會因為同樣文字出現兩次而丟出「多個符合元素」的錯誤。
afterEach(() => {
  cleanup();
});

interface TestQuestion {
  id: string;
  question: string;
  answer: string;
}
interface TestCategory {
  id: string;
  questions: TestQuestion[];
}

const CATEGORIES: TestCategory[] = [
  {
    id: "cat-a",
    questions: [
      { id: "a-1", question: "分類A 第一題", answer: "分類A 第一題的答案" },
      { id: "a-2", question: "分類A 第二題", answer: "分類A 第二題的答案" },
    ],
  },
  {
    id: "cat-b",
    questions: [
      { id: "b-1", question: "分類B 第一題", answer: "分類B 第一題的答案" },
    ],
  },
];

/** 忠實複製 client/src/pages/FAQ.tsx 的 accordion 寫法：一個全頁共用的
 * openQuestionId state，每個 category 各自一個 <Accordion>，全部指到同一個
 * value/onValueChange，AccordionContent 一律 forceMount。 */
function FaqAccordionHarness() {
  const [openQuestionId, setOpenQuestionId] = useState("");
  return (
    <>
      {CATEGORIES.map((category) => (
        <Accordion
          key={category.id}
          type="single"
          collapsible
          value={openQuestionId}
          onValueChange={setOpenQuestionId}
        >
          {category.questions.map((q) => (
            <AccordionItem key={q.id} value={q.id}>
              <AccordionTrigger>{q.question}</AccordionTrigger>
              <AccordionContent forceMount>{q.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ))}
    </>
  );
}

function getContentEl(questionId: string): HTMLElement {
  const trigger = screen.getByText(
    CATEGORIES.flatMap((c) => c.questions).find((q) => q.id === questionId)!.question
  );
  const item = trigger.closest('[data-slot="accordion-item"]')!;
  return item.querySelector('[data-slot="accordion-content"]') as HTMLElement;
}

function isOpen(questionId: string): boolean {
  return getContentEl(questionId).getAttribute("data-state") === "open";
}

function openCount(): number {
  return CATEGORIES.flatMap((c) => c.questions).filter((q) => isOpen(q.id)).length;
}

function clickQuestion(questionId: string) {
  const question = CATEGORIES.flatMap((c) => c.questions).find((q) => q.id === questionId)!;
  fireEvent.click(screen.getByText(question.question));
}

describe("FAQ accordion — single-open regression (Hotfix 2)", () => {
  it("F1: initial render — 0 answers expanded", () => {
    render(<FaqAccordionHarness />);
    expect(openCount()).toBe(0);
    for (const q of CATEGORIES.flatMap((c) => c.questions)) {
      expect(getContentEl(q.id).getAttribute("data-state")).toBe("closed");
    }
  });

  it("regression guard: the actual rendered AccordionContent DOM node carries the CSS class that visually collapses it when closed (this is the real Hotfix 2 fix — checked on the rendered node, not the source file)", () => {
    render(<FaqAccordionHarness />);
    for (const q of CATEGORIES.flatMap((c) => c.questions)) {
      expect(getContentEl(q.id).className).toMatch(/data-\[state=closed\]:hidden/);
    }
  });

  it("F2: click question A — only A expanded", () => {
    render(<FaqAccordionHarness />);
    clickQuestion("a-1");
    expect(isOpen("a-1")).toBe(true);
    expect(openCount()).toBe(1);
  });

  it("F3: click question B — A collapses, B expands", () => {
    render(<FaqAccordionHarness />);
    clickQuestion("a-1");
    expect(isOpen("a-1")).toBe(true);
    clickQuestion("a-2");
    expect(isOpen("a-1")).toBe(false);
    expect(isOpen("a-2")).toBe(true);
    expect(openCount()).toBe(1);
  });

  it("F4: A and B in different categories — still only one open at a time", () => {
    render(<FaqAccordionHarness />);
    clickQuestion("a-1");
    expect(isOpen("a-1")).toBe(true);
    clickQuestion("b-1");
    expect(isOpen("a-1")).toBe(false);
    expect(isOpen("b-1")).toBe(true);
    expect(openCount()).toBe(1);
  });

  it("F5: clicking the currently-open question again collapses it back to 0", () => {
    render(<FaqAccordionHarness />);
    clickQuestion("b-1");
    expect(isOpen("b-1")).toBe(true);
    clickQuestion("b-1");
    expect(isOpen("b-1")).toBe(false);
    expect(openCount()).toBe(0);
  });

  it("F6: expanded count never exceeds 1 across a realistic sequence of clicks", () => {
    render(<FaqAccordionHarness />);
    const sequence = ["a-1", "a-2", "b-1", "a-1", "a-1", "b-1"];
    for (const id of sequence) {
      clickQuestion(id);
      expect(openCount()).toBeLessThanOrEqual(1);
    }
  });
});
