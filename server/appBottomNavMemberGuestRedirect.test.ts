/**
 * Bug：手機版（Capacitor 原生 App）右下角底部導覽「會員中心」，未登入時點擊
 * 會被導回首頁——Root cause：按鈕本身不分流登入狀態，一律 navigate("/member")，
 * 而 MemberCenter.tsx 自己對未登入使用者的保護是 `if (!user) { setLocation("/");
 * return null; }`，這個 "/" fallback是給直接輸入網址／舊連結用的通用保護，不是
 * 給這顆按鈕做「引導使用者登入」用的。
 *
 * 修正：AppBottomNav.tsx 的「會員中心」按鈕改為先依 isAuthenticated 分流——
 * 未登入直接開啟既有的 LoginDialog（OXM 目前沒有獨立的「會員註冊」頁面／
 * route，一般會員的註冊與登入本來就是同一套 Google／LINE／Apple OAuth
 * 流程，全站的「註冊」「登入」按鈕都是打開這個既有元件，這裡沿用同一個，
 * 沒有新建第二套註冊頁面或第二套登入判斷），已登入才 navigate("/member")。
 * 這個判斷邏輯跟同一個檔案裡「工廠管理」按鈕（handleFactoryTap）的既有
 * pattern一致，只是導向目的地不同。
 *
 * 同專案既有慣例（見 server/navbarMobileAccordion.test.ts）：vitest 只涵蓋
 * server/**\/*.test.ts、沒有 jsdom，改用原始碼內容斷言。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(): string {
  return fs
    .readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "components", "AppBottomNav.tsx"),
      "utf-8",
    )
    .replace(/\r\n/g, "\n");
}

describe("AppBottomNav.tsx 「會員中心」：未登入時開啟登入／註冊 Dialog，不再無條件導到 /member", () => {
  const source = readSource();

  it("重用既有 LoginDialog 元件，沒有新建第二套註冊頁面或 Dialog", () => {
    expect(source).toMatch(/import LoginDialog from "@\/components\/LoginDialog";/);
    expect(source).toMatch(/<LoginDialog open=\{loginDialogOpen\} onOpenChange=\{setLoginDialogOpen\} \/>/);
  });

  it("handleMemberTap 重用既有的 isAuthenticated（不是另外建立一套判斷），未登入時開啟 Dialog、已登入才 navigate(\"/member\")", () => {
    const fnMatch = source.match(/const handleMemberTap = \(\) => \{[\s\S]*?\n {2}\};/);
    expect(fnMatch, "找不到 handleMemberTap 定義").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/if \(!isAuthenticated\) \{/);
    expect(fn).toMatch(/setLoginDialogOpen\(true\);/);
    expect(fn).toMatch(/navigate\("\/member"\);/);
    // 未登入分支必須在已登入分支之前判斷完就 return，不會落到下面的 navigate。
    const guardIdx = fn.indexOf("if (!isAuthenticated)");
    const openDialogIdx = fn.indexOf("setLoginDialogOpen(true)");
    const navigateIdx = fn.lastIndexOf('navigate("/member")');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(openDialogIdx).toBeGreaterThan(guardIdx);
    expect(navigateIdx).toBeGreaterThan(openDialogIdx);
  });

  it("「會員中心」按鈕的 onClick 已改綁 handleMemberTap，不再是無條件的 navigate(\"/member\")", () => {
    const buttonMatch = source.match(/\{\/\* 會員中心[\s\S]*?<\/button>/);
    expect(buttonMatch, "找不到會員中心按鈕區塊").not.toBeNull();
    const button = buttonMatch![0];
    expect(button).toMatch(/onClick=\{handleMemberTap\}/);
    expect(button).not.toMatch(/onClick=\{\(\) => navigate\("\/member"\)\}/);
  });

  it("沒有動到旁邊「工廠管理」按鈕既有的 handleFactoryTap 邏輯（本輪範圍只限會員中心）", () => {
    const fnMatch = source.match(/const handleFactoryTap = \(\) => \{[\s\S]*?\n {2}\};/);
    expect(fnMatch, "找不到 handleFactoryTap 定義").not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/if \(!isAuthenticated\) \{/);
    expect(fn).toMatch(/navigate\("\/"\);/);
    expect(fn).toMatch(/navigate\(showDashboard \? "\/dashboard" : "\/register-factory"\);/);
  });

  it("元件仍然只在原生 App（isNative）才渲染，本輪沒有讓這份底部導覽外流到手機瀏覽器或桌機", () => {
    expect(source).toMatch(/if \(!isNative\) return null;/);
  });
});
