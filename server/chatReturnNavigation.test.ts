import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Chat 返回導航（history.state.from → 「返回」按鈕）回歸測試。
 *
 * 同 server/factoryContactLogin.test.ts／server/navbarMobileAccordion.test.ts
 * 的既有做法：本專案 vitest 只涵蓋 environment: "node"，沒有 jsdom／React
 * Testing Library，無法對這些頁面做真正的 DOM render／click 互動測試，也不
 * 應該在這裡真的連線資料庫。這裡改用原始碼內容斷言，鎖定這次要修的具體回歸
 * 情境：
 *   1. 之前 FactoryDetail／FactoryDashboard 訂單連結／MemberCenter／
 *      OrderDetail 這幾個入口進 Chat 時完全沒帶來源，導致「返回」永遠
 *      fallback 成 /messages，即使使用者明明是從別的業務頁進來的。
 *   2. ChatPage 的「返回」原本無條件 navigate(backPath)（push），導致每次
 *      往返都在 history stack 多留一筆，形成 Chat ↔ Messages 的循環觀感。
 *
 * isSafeChatReturnSource 本身的邏輯（哪些值合法／不合法）已經在
 * client/src/lib/chatReturnSource.test.ts 用真正的函式呼叫＋斷言涵蓋，這裡
 * 只驗證「各入口有沒有正確接上它」與「ChatPage 的返回邏輯有沒有正確接上
 * history.back() / 安全 fallback，而不是退回舊的無條件 push」。
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

describe("ChatPage.tsx: 返回邏輯改用可信來源 + history.back()，不再無條件 push", () => {
  const source = readSource("client", "src", "pages", "ChatPage.tsx");

  it("匯入並使用 isSafeChatReturnSource 驗證 history.state.from，不是自己重寫一份驗證邏輯", () => {
    expect(source).toMatch(/import \{ isSafeChatReturnSource \} from ["']@\/lib\/chatReturnSource["']/);
    expect(source).toMatch(/isSafeChatReturnSource\(rawSource\)/);
  });

  it("handleReturn：有可信來源時呼叫 window.history.back()，不是 navigate(source)", () => {
    const handleReturnMatch = source.match(/const handleReturn = \(\) => \{[\s\S]*?\n  \};/);
    expect(handleReturnMatch, "找不到 handleReturn 函式定義").not.toBeNull();
    const body = handleReturnMatch![0];

    expect(body).toMatch(/if \(source && typeof window !== "undefined" && window\.history\.length > 1\) \{/);
    expect(body).toMatch(/window\.history\.back\(\);/);
    // 沒有可信來源時走 replace，不是 push——不能再讓每次「無來源」都在 history
    // stack 多留一筆。
    expect(body).toMatch(/navigate\(FALLBACK_PATH, \{ replace: true \}\);/);
    // 舊模式的殘留字樣不該再出現在這個函式體內。
    expect(body).not.toMatch(/navigate\(backPath\)/);
    expect(body).not.toMatch(/navigate\(source\)/);
  });

  it("返回按鈕文字改成不會說謊的通用「返回」，不再依 backPath 前綴猜測固定文字", () => {
    const buttonMatch = source.match(/<Button variant="ghost" size="sm" className="mb-3 self-start" onClick=\{handleReturn\}>[\s\S]*?<\/Button>/);
    expect(buttonMatch, "找不到返回按鈕").not.toBeNull();
    expect(buttonMatch![0]).toMatch(/返回<\/Button>|返回\s*<\/Button>/);
    expect(buttonMatch![0]).not.toMatch(/返回訊息列表|返回工廠管理後台|返回顧問中心/);
  });

  it("/chat/new → /chat/:id 的兩處 replace 導航都把驗證過的 source 往下傳，不是原始未驗證的 backPath", () => {
    const replaceCalls = source.match(/navigate\(`\/chat\/\$\{[^}]+\}`, \{ replace: true, state: \{ from: source \} \}\);/g);
    expect(replaceCalls, "找不到把 source 帶進 replace 導航的呼叫").not.toBeNull();
    expect(replaceCalls!.length).toBe(2);
    // 確認沒有殘留舊的 backPath 寫法。
    expect(source).not.toMatch(/state: \{ from: backPath \}/);
    expect(source).not.toMatch(/\bbackPath\b/);
  });
});

describe("FactoryDetail.tsx: 「聯繫工廠」進 Chat 時帶入工廠頁作為返回來源", () => {
  const source = readSource("client", "src", "pages", "FactoryDetail.tsx");

  it("handleChat 呼叫 navigate 時帶 state.from = /factory/{id}，且保留 productId/productName query", () => {
    const handleChatMatch = source.match(/const handleChat = \([\s\S]*?\n  \};/);
    expect(handleChatMatch, "找不到 handleChat 函式定義").not.toBeNull();
    const body = handleChatMatch![0];

    expect(body).toMatch(/params\.set\("productId", String\(productId\)\)/);
    expect(body).toMatch(/params\.set\("productName", productName\)/);
    expect(body).toMatch(/navigate\(`\/chat\/new\?\$\{params\.toString\(\)\}`, \{ state: \{ from: `\/factory\/\$\{factoryId\}` \} \}\);/);
  });
});

describe("FactoryDashboard.tsx: 訂單卡片「進入對話」帶回 /dashboard?tab=orders", () => {
  const source = readSource("client", "src", "pages", "FactoryDashboard.tsx");

  it("兩處訂單卡片的聊天連結都帶 state.from，不再是裸的 <Link href>", () => {
    const chatLinkMatches = source.match(/<Link href=\{`\/chat\/\$\{order\.conversationId\}`\}[^>]*>/g);
    expect(chatLinkMatches, "找不到訂單卡片的聊天連結").not.toBeNull();
    expect(chatLinkMatches!.length).toBe(2);
    for (const link of chatLinkMatches!) {
      expect(link).toMatch(/state=\{\{ from: "\/dashboard\?tab=orders" \}\}/);
    }
  });

  it("既有「訊息」tab 的聊天連結（本來就正確）維持不變，沒有被順手改壞", () => {
    expect(source).toMatch(/navigate\(`\/chat\/\$\{conv\.id\}`, \{ state: \{ from: "\/dashboard\?tab=messages" \} \}\)/);
  });
});

describe("MemberCenter.tsx: 訂單列表「查看對話」帶回 /member", () => {
  const source = readSource("client", "src", "pages", "MemberCenter.tsx");

  it("聊天連結帶 state.from = /member，不再是裸的 <Link href>", () => {
    expect(source).toMatch(/<Link href=\{`\/chat\/\$\{order\.conversationId\}`\} state=\{\{ from: "\/member" \}\}/);
  });
});

describe("OrderDetail.tsx: 「查看對話」帶回這筆訂單本身", () => {
  const source = readSource("client", "src", "pages", "OrderDetail.tsx");

  it("聊天連結帶 state.from = /orders/{orderId}，不再是裸的 <Link href>", () => {
    expect(source).toMatch(/<Link href=\{`\/chat\/\$\{order\.conversationId\}`\} state=\{\{ from: `\/orders\/\$\{orderId\}` \}\}/);
  });

  it("既有 parseSafeBackTo／handleBack（訂單本身的返回按鈕，非本次修改範圍）維持不變", () => {
    expect(source).toMatch(/function parseSafeBackTo\(search: string\): string \| null \{/);
    expect(source).toMatch(/function handleBack\(\) \{/);
  });
});

describe("MyMessages.tsx／ConsultantCases.tsx: 既有正確的來源設定不得被本次改動破壞", () => {
  it("MyMessages.tsx 三處聊天連結仍保留原本的 state.from", () => {
    const source = readSource("client", "src", "pages", "MyMessages.tsx");
    expect(source).toMatch(/navigate\(`\/chat\/\$\{conv\.id\}`, \{ state: \{ from: "\/messages" \} \}\)/);
    expect(source).toMatch(/navigate\(`\/chat\/\$\{item\.conversationId\}`, \{ state: \{ from: "\/messages" \} \}\)/);
    expect(source).toMatch(/navigate\(`\/chat\/\$\{conv\.id\}`, \{ state: \{ from: "\/messages\?tab=factory" \} \}\)/);
  });

  it("ConsultantCases.tsx 的自訂來源（含 caseId）仍保留", () => {
    const source = readSource("client", "src", "pages", "ConsultantCases.tsx");
    expect(source).toMatch(/navigate\(`\/chat\/new\?factoryId=\$\{item\.factoryId\}`, \{\s*state: \{ from: `\/upgrade-consultant\/cases\?caseId=\$\{item\.id\}` \},\s*\}\);/);
  });
});
