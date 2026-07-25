import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 這個專案的 vitest 設定僅涵蓋 server/**/*.test.ts、environment: "node"，並未安裝
// jsdom／@testing-library/react，因此無法用真正的 DOM render 測試 React 元件互動。
// 這裡改用「原始碼內容斷言」的方式，在不新增任何測試相關套件或設定的前提下，
// 針對「未登入點擊聯繫商家」這個具體回歸情境做最低限度防護：
// 1. 工廠公開頁的 handleChatClick 未登入時要開啟登入選擇彈窗，不能直接呼叫 performLogin()
// 2. 登入選擇彈窗本身（LoginDialog）不能在掛載時就自動觸發任何登入 provider
//
// 這段互動邏輯原本在 FactoryDetail.tsx，後來抽成 FactoryDetail.tsx（正式頁）與
// FactoryDashboard.tsx（工廠管理「預覽工廠頁面」）共用的 FactoryDetailView.tsx，
// 因此本檔案改為對 FactoryDetailView.tsx 做原始碼斷言。

const FACTORY_DETAIL_VIEW_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "FactoryDetailView.tsx"
);
const LOGIN_DIALOG_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "LoginDialog.tsx"
);

describe("FactoryDetailView.tsx: 未登入點擊聯繫商家", () => {
  const source = fs.readFileSync(FACTORY_DETAIL_VIEW_PATH, "utf-8");

  it("匯入並渲染共用的 LoginDialog（沒有另外做第二套登入彈窗）", () => {
    expect(source).toMatch(/import LoginDialog from ["']@\/components\/LoginDialog["']/);
    expect(source).toMatch(/<LoginDialog\s+open=\{loginDialogOpen\}\s+onOpenChange=\{setLoginDialogOpen\}\s*\/>/);
  });

  it("handleChatClick 未登入時開啟登入選擇彈窗，而不是直接呼叫 performLogin()", () => {
    const handleChatMatch = source.match(/const handleChatClick = \([\s\S]*?\n  \};/);
    expect(handleChatMatch, "找不到 handleChatClick 函式定義").not.toBeNull();
    const handleChatBody = handleChatMatch![0];

    expect(handleChatBody).toMatch(/if \(!isAuthenticated\) \{ setLoginDialogOpen\(true\); return; \}/);
    expect(handleChatBody).not.toMatch(/performLogin\(/);
  });
});

describe("LoginDialog.tsx: 開啟彈窗本身不會直接啟動 Google OAuth", () => {
  const source = fs.readFileSync(LOGIN_DIALOG_PATH, "utf-8");

  it("performLogin／login() 只出現在按鈕的 onClick 內，元件掛載時不會自動呼叫", () => {
    // 元件本體（Dialog 開啟後渲染的內容）不應該有 useEffect 之類的掛載時自動執行邏輯
    // 呼叫 login()／performLogin()；唯一允許呼叫的地方是各登入方式按鈕的 onClick。
    expect(source).not.toMatch(/useEffect/);

    const googleButtonMatch = source.match(/\{\/\* Google \*\/\}[\s\S]*?<\/Button>/);
    expect(googleButtonMatch, "找不到 Google 登入按鈕").not.toBeNull();
    expect(googleButtonMatch![0]).toMatch(/onClick=\{\(\) => login\("google"\)\}/);
  });

  it("Google 選項標示「最推薦」，且不影響 LINE／Apple 仍可正常選擇", () => {
    const googleButtonMatch = source.match(/\{\/\* Google \*\/\}[\s\S]*?<\/Button>/);
    expect(googleButtonMatch![0]).toMatch(/最推薦/);

    const lineButtonMatch = source.match(/\{\/\* LINE \*\/\}[\s\S]*?<\/Button>/);
    expect(lineButtonMatch, "找不到 LINE 登入按鈕").not.toBeNull();
    expect(lineButtonMatch![0]).toMatch(/onClick=\{\(\) => login\("line"\)\}/);
    expect(lineButtonMatch![0]).not.toMatch(/disabled=\{true\}|disabled$/m);

    const appleButtonMatch = source.match(/\{\/\* Apple \*\/\}[\s\S]*?<\/Button>/);
    expect(appleButtonMatch, "找不到 Apple 登入按鈕").not.toBeNull();
    expect(appleButtonMatch![0]).toMatch(/onClick=\{\(\) => login\("apple"\)\}/);
  });
});
