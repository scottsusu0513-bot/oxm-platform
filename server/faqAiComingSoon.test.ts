/**
 * Phase 13.0 接續點：FAQ AI 問答入口（client/src/components/faq/FaqAiEntry.tsx）
 * 的 coming_soon 狀態——跟 client/**\/*.test.ts glob 下其餘元件測試一樣
 * （見 vitest.config.ts 的「client／shared 這兩個 glob 只收純函式的
 * deterministic 單元測試」註解），這裡不引入 jsdom／React Testing Library
 * render 測試，而是用跟 server/faqPage.test.ts／server/faqAiEntry.test.ts
 * 相同的「靜態原始碼契約比對」方式驗證：
 * - disabled／短路邏輯確實存在且順序正確（F6-F9）
 * - comingSoon 狀態確實來自 AiShellContext 的 server-authoritative
 *   isAiComingSoon，不是第二套寫死的 frontend flag
 * - live 時原本呼叫 onAskAi 的路徑沒有被永久拿掉（F10）
 * 真正的互動行為（input 是否真的不可輸入、Enter 是否真的沒反應、按鈕是否
 * 真的點不下去）由本輪的手動瀏覽器驗收覆蓋（見對話「十七、Browser
 * Validation」），跟這個專案既有慣例一致。
 *
 * F1-F5（/faq route、FAQ 公開 SEO、FAQ schema、FAQ prerender、Navbar FAQ
 * 入口）已經由 server/faqPage.test.ts 與 server/prerenderFaq.test.ts 完整
 * 覆蓋，這裡不重複斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("F6/F7 — coming_soon 時 input／button 皆 disabled", () => {
  const source = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");

  it("input 帶有 disabled={comingSoon}", () => {
    expect(source).toMatch(/<input[\s\S]*?disabled=\{comingSoon\}/);
  });

  it("送出按鈕帶有 disabled={comingSoon}", () => {
    expect(source).toMatch(/<button[\s\S]*?disabled=\{comingSoon\}/);
  });

  it("placeholder 在 comingSoon 時改為沿用 aiEntitlementCopy.ts 的固定文案，不是另外寫死的字面量", () => {
    expect(source).toMatch(/import \{ AI_COMING_SOON_COMPOSER_PLACEHOLDER \} from "@\/contexts\/aiEntitlementCopy"/);
    expect(source).toMatch(/comingSoon \? AI_COMING_SOON_COMPOSER_PLACEHOLDER/);
  });
});

describe("F8/F9 — coming_soon 時 Enter／送出都不會呼叫 onAskAi", () => {
  const source = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");

  it("handleSubmit 一開始就短路：comingSoon 為 true 時直接 return，不往下執行到 onAskAi", () => {
    const fnMatch = source.match(/function handleSubmit\([\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![0];

    const guardIdx = fnBody.indexOf("if (comingSoon) return;");
    const askIdx = fnBody.indexOf("onAskAi(trimmed)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(askIdx);
  });

  it("表單本身沒有另外的 onKeyDown/Enter 特殊處理——Enter 走的是同一個 <form onSubmit>，disabled 的 input/button 在瀏覽器層級本來就無法觸發", () => {
    expect(source).not.toMatch(/onKeyDown/);
    expect(source).toMatch(/<form onSubmit=\{handleSubmit\}/);
  });
});

describe("comingSoon 狀態來源：AiShellContext 的 isAiComingSoon（server-authoritative），不是第二套 frontend flag", () => {
  it("FAQ.tsx 從 useAiShell() 解構 isAiComingSoon，直接傳給 FaqAiEntry 的 comingSoon prop", () => {
    const source = readSource("client", "src", "pages", "FAQ.tsx");
    expect(source).toMatch(/const \{ askQuestion, isAiComingSoon \} = useAiShell\(\);/);
    expect(source).toMatch(/<FaqAiEntry onAskAi=\{askQuestion\} comingSoon=\{isAiComingSoon\} \/>/);
  });

  it("FAQ.tsx／FaqAiEntry.tsx 都沒有寫死 const ... = true 這種本地 coming soon 開關", () => {
    const faqSource = readSource("client", "src", "pages", "FAQ.tsx");
    const entrySource = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");
    expect(faqSource).not.toMatch(/COMING_SOON\s*=\s*true/i);
    expect(entrySource).not.toMatch(/COMING_SOON\s*=\s*true/i);
  });

  it("AiShellContext.tsx 的 isAiComingSoon 衍生自 trpc.ai.releaseMode（唯一資料源是 ENV.aiReleaseMode），不受面板是否打開限制", () => {
    const source = readSource("client", "src", "contexts", "AiShellContext.tsx");
    expect(source).toMatch(/trpc\.ai\.releaseMode\.useQuery\(\)/);
    expect(source).toMatch(/isAiComingSoon\s*=\s*releaseModeQuery\.data\?\.mode\s*!==\s*"live"/);
  });

  it("server/routers.ts 的 ai.releaseMode 直接回傳 ENV.aiReleaseMode，跟 entitlementStatus／ai.chat 判斷 coming_soon 用同一個來源", () => {
    const source = readSource("server", "routers.ts");
    expect(source).toMatch(/releaseMode: publicProcedure\.query\(\(\) => \(\{ mode: ENV\.aiReleaseMode \}\)\)/);
  });
});

describe("F10 — live 時原本 askQuestion 行為完整保留（沒有被永久拿掉，只是被 comingSoon 短路擋住）", () => {
  it("guard 之後緊接著仍是原本 trimmed → onAskAi(trimmed) → setQuestion(\"\") 的完整路徑", () => {
    const source = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");
    const fnMatch = source.match(/function handleSubmit\([\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![0];

    expect(fnBody).toMatch(/if \(comingSoon\) return;[\s\S]*const trimmed = question\.trim\(\);[\s\S]*if \(!trimmed\) return;[\s\S]*onAskAi\(trimmed\);[\s\S]*setQuestion\(""\);/);
  });

  it("comingSoon 是一般 boolean prop（不是恆為 true 的字面量型別），live 時 FaqAiEntry 收到 false 就完全是原本可互動的輸入框", () => {
    const source = readSource("client", "src", "components", "faq", "FaqAiEntry.tsx");
    expect(source).toMatch(/comingSoon: boolean;/);
    expect(source).not.toMatch(/comingSoon: true;/);
  });
});
