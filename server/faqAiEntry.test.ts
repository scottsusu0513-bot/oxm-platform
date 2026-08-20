/**
 * FAQ 頁「AI 問答入口」＋ App 層級的 Global AI Shell（見對話中「Phase 6 UI
 * Foundation：全站AI Shell」）——這裡驗證：
 * 1. 既有 16 題 FAQ／四大分類／JSON-LD 完全未被本輪改動破壞
 * 2. FaqAiEntry 確實接上，且位置正確；不再自己持有聊天視窗開關狀態
 * 3. FaqAiEntry 本身仍然只是「輸入殼」：把問題交給 Global AI Shell 的
 *    askQuestion，不直接呼叫任何 API
 * 4. Global AI Shell（contexts/AiShellContext.tsx／components/ai/
 *    GlobalAiShell.tsx）沒有把任何 model 名稱／API endpoint／LINE 連結寫死在
 *    前端，且掛在 App.tsx（Router 的手足層級），不是 FAQ 頁面內部
 * 5. prerender 靜態文字併入 raw HTML，且不影響 16 題正文與題數
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FAQ_AI_ENTRY_CONTENT } from "../shared/content/faqAiEntry";
import { FAQ_CONTENT, getFaqQuestionsFlat } from "../shared/content/faq";
import { getFaqPageSchema } from "@shared/seo/schema";
import { renderFaqContentHtml } from "../scripts/prerender-faq";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("既有 16 題 FAQ 完全未被本輪改動破壞", () => {
  it("FAQ_CONTENT 仍是 4 分類、題數 5/4/3/4，合計 16 題", () => {
    expect(FAQ_CONTENT.categories).toHaveLength(4);
    expect(FAQ_CONTENT.categories.map(c => c.questions.length)).toEqual([5, 4, 3, 4]);
    expect(getFaqQuestionsFlat()).toHaveLength(16);
  });

  it("FAQPage JSON-LD 仍恰好 16 題 mainEntity", () => {
    expect(getFaqPageSchema().mainEntity as unknown[]).toHaveLength(16);
  });
});

describe("client/src/pages/FAQ.tsx 已接上 AI 問答入口，且不再自己持有聊天狀態", () => {
  const source = readSource("client", "src", "pages", "FAQ.tsx");

  it("import 並 render <FaqAiEntry />，透過 useAiShell().askQuestion 交給 Global AI Shell", () => {
    expect(source).toMatch(/import \{ FaqAiEntry \} from "@\/components\/faq\/FaqAiEntry"/);
    expect(source).toMatch(/import \{ useAiShell \} from "@\/contexts\/AiShellContext"/);
    expect(source).toMatch(/<FaqAiEntry\b/);
    expect(source).toMatch(/onAskAi=\{askQuestion\}/);
  });

  it("不再自己 render <FaqAiChatShell />，也沒有本地的 aiChatOpen/aiChatPendingQuestion 狀態（見「conversation 沒有真正被保留」的根因修正）", () => {
    expect(source).not.toMatch(/FaqAiChatShell/);
    expect(source).not.toMatch(/aiChatOpen|aiChatPendingQuestion/);
  });

  it("AI 問答入口放在 Hero 區塊之後、四大分類容器（FAQ_CONTENT.categories.map）之前", () => {
    const heroEndIdx = source.indexOf("</section>");
    const aiEntryIdx = source.indexOf("<FaqAiEntry");
    const categoriesContainerIdx = source.indexOf("FAQ_CONTENT.categories.map");

    expect(heroEndIdx).toBeGreaterThan(-1);
    expect(aiEntryIdx).toBeGreaterThan(heroEndIdx);
    expect(aiEntryIdx).toBeLessThan(categoriesContainerIdx);
  });
});

describe("client/src/components/faq/FaqAiEntry.tsx — 輸入殼，不直接呼叫 API", () => {
  const source = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");

  it("標題文字「有問題？直接問 OXM」存在（來自 shared/content/faqAiEntry.ts，非另外硬寫一份）", () => {
    expect(FAQ_AI_ENTRY_CONTENT.title).toBe("有問題？直接問 OXM");
    expect(source).toMatch(/FAQ_AI_ENTRY_CONTENT\.title/);
    expect(source).not.toMatch(/"有問題？直接問 OXM"/); // 不應該另外硬寫一份字面量
  });

  it("有一個文字輸入框（input type=\"text\"）與送出按鈕（type=\"submit\"）", () => {
    expect(source).toMatch(/<input[\s\S]*?type="text"/);
    expect(source).toMatch(/<button[\s\S]*?type="submit"/);
    expect(source).toContain("例如：我們工廠最近訂單減少，應該先找新市場還是先做內部轉型？");
  });

  it("送出（handleSubmit）本身不直接呼叫任何 API（沒有 fetch／trpc／axios／XMLHttpRequest），而是把問題交給 onAskAi callback", () => {
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/trpc\./);
    expect(source).not.toMatch(/axios/);
    expect(source).not.toMatch(/XMLHttpRequest/);
    expect(source).toMatch(/onAskAi\(trimmed\)/);
  });

  it("沒有寫死任何 LINE URL 或 QR Code", () => {
    expect(source).not.toMatch(/line\.me|liff\.line\.me|qrcode|QRCode/i);
  });
});

describe("client/src/contexts/AiShellContext.tsx — Global AI Shell 狀態，透過 trpc.ai.chat 呼叫伺服器端 AI", () => {
  const source = readSource("client", "src", "contexts", "AiShellContext.tsx");

  it("透過 trpc.ai.chat mutation 呼叫伺服器端 AI（模型/金鑰完全在 server 端，前端只呼叫 tRPC）", () => {
    expect(source).toMatch(/trpc\.ai\.chat\.useMutation/);
  });

  it("單次 API 呼叫失敗時只顯示可重試的錯誤訊息，不清空既有對話紀錄", () => {
    expect(source).toMatch(/onError:/);
    expect(source).not.toMatch(/setMessages\(\[\]\)/);
  });

  it("沒有把任何 model 名稱／API endpoint 寫死在前端 bundle 裡，也沒有真實 LINE 連結", () => {
    expect(source).not.toMatch(/https?:\/\/api\./);
    expect(source).not.toMatch(/gpt-|claude-|anthropic|openai/i);
    expect(source).not.toMatch(/line\.me|liff\.line\.me/i);
  });
});

describe("client/src/App.tsx — Global AI Shell 掛在 Router 的手足層級，不是 FAQ 頁面內部（見對話中「全站AI Shell」）", () => {
  const source = readSource("client", "src", "App.tsx");

  it("AiShellProvider／GlobalAiShell 都在 App() 裡跟 <Router /> 平行掛載，Provider 包住 Router 讓路由切換不會讓它卸載", () => {
    expect(source).toMatch(/import \{ AiShellProvider \} from "@\/contexts\/AiShellContext"/);
    expect(source).toMatch(/import \{ GlobalAiShell \} from "@\/components\/ai\/GlobalAiShell"/);
    expect(source).toMatch(/<AiShellProvider>[\s\S]*<Router \/>[\s\S]*<\/AiShellProvider>/);
  });
});

describe("scripts/prerender-faq.ts — AI 入口靜態文字併入 raw HTML，且不影響 16 題正文", () => {
  it("prerender 輸出包含 AI 入口標題與說明（<h2>／<p>），且仍包含全部 16 個 <h3> 題目", () => {
    const html = renderFaqContentHtml();

    expect(html).toContain(`<h2>${FAQ_AI_ENTRY_CONTENT.title}</h2>`);
    expect(html).toContain(`<p>${FAQ_AI_ENTRY_CONTENT.description}</p>`);

    const h3s = html.match(/<h3>/g) ?? [];
    expect(h3s).toHaveLength(16);

    for (const q of getFaqQuestionsFlat()) {
      expect(html).toContain(`<h3>${q.question}</h3>`);
    }
  });

  it("AI 入口標題出現在 <h1> 之後、四大分類第一個 <h2>01｜...） 之前", () => {
    const html = renderFaqContentHtml();
    const h1Idx = html.indexOf("<h1>OXM 常見問答 FAQ</h1>");
    const aiTitleIdx = html.indexOf(`<h2>${FAQ_AI_ENTRY_CONTENT.title}</h2>`);
    const firstCategoryIdx = html.indexOf("<h2>01｜");

    expect(h1Idx).toBeGreaterThan(-1);
    expect(aiTitleIdx).toBeGreaterThan(h1Idx);
    expect(firstCategoryIdx).toBeGreaterThan(aiTitleIdx);
  });

  it("不含任何 input／button／form 等互動標籤（只收錄靜態標題說明，不把互動功能塞進 prerender）", () => {
    const html = renderFaqContentHtml();
    expect(html).not.toMatch(/<input|<button|<form/i);
  });
});
