/**
 * Hotfix：正式站 OXM AI panel 右上角沒有關閉按鈕——實際根因是既有 close
 * button 一直都在，但 className 帶了 `sm:hidden`，導致只有 < sm（640px）的
 * 窄螢幕看得到，桌機／平板完全看不到。這裡跟這個專案既有慣例一致
 * （見 vitest.config.ts 的「client／shared 這兩個 glob 只收純函式的
 * deterministic 單元測試」註解），不引入 jsdom／React Testing Library render
 * 測試，改用靜態原始碼契約比對，鎖住這個 regression 不會再發生。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

const source = readSource("client", "src", "components", "ai", "GlobalAiShell.tsx");

function extractCloseButtonTag(): string {
  const match = source.match(/<button[\s\S]*?onClick=\{closeShell\}[\s\S]*?<\/button>/);
  expect(match, "close button JSX (onClick={closeShell}) not found").toBeTruthy();
  return match![0];
}

describe("OXM AI panel close button hotfix", () => {
  it("1. header renders a close button wired to closeShell", () => {
    const tag = extractCloseButtonTag();
    expect(tag).toMatch(/type="button"/);
    expect(tag).toMatch(/onClick=\{closeShell\}/);
  });

  it("2. close button has the correct aria-label", () => {
    const tag = extractCloseButtonTag();
    expect(tag).toMatch(/aria-label="關閉 OXM AI 對話"/);
  });

  it("3. click handler is closeShell (not a no-op or different handler)", () => {
    const tag = extractCloseButtonTag();
    expect(tag).toMatch(/onClick=\{closeShell\}/);
  });

  it("regression guard: close button is not hidden at any breakpoint (the actual root cause of this hotfix)", () => {
    const tag = extractCloseButtonTag();
    expect(tag).not.toMatch(/\bsm:hidden\b/);
    expect(tag).not.toMatch(/\bhidden\b(?!\S)/); // no bare "hidden" utility class either
  });

  it("touch target is at least 40x40 (size-10)", () => {
    const tag = extractCloseButtonTag();
    expect(tag).toMatch(/\bsize-10\b/);
  });

  it("4. Coming Soon mode also shows the close button: the button is declared structurally before (outside) the isComingSoon branch", () => {
    const closeButtonIdx = source.indexOf("onClick={closeShell}");
    const comingSoonIdx = source.indexOf("isComingSoon ? (");
    expect(closeButtonIdx).toBeGreaterThan(-1);
    expect(comingSoonIdx).toBeGreaterThan(-1);
    expect(closeButtonIdx).toBeLessThan(comingSoonIdx);
  });

  it("5. Live mode also shows the close button: the button is declared structurally before (outside) the isEntitlementLoading/isGated/normal-chat ternary", () => {
    const closeButtonIdx = source.indexOf("onClick={closeShell}");
    const ternaryIdx = source.indexOf("isEntitlementLoading ? (");
    expect(closeButtonIdx).toBeGreaterThan(-1);
    expect(ternaryIdx).toBeGreaterThan(-1);
    expect(closeButtonIdx).toBeLessThan(ternaryIdx);
  });
});
