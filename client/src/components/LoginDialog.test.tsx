// @vitest-environment jsdom
/**
 * iOS App OAuth 取消／失敗後登入按鈕卡在 disabled 的回歸測試。
 *
 * 根因：LoginDialog 的 loading 在點擊時設定、之後從未歸位。App 內 performLogin 在
 * Browser.open 呈現登入頁後即返回，取消／失敗／放棄都不會回呼；LoginDialog 常駐
 * （AppBottomNav／GlobalAiShell）不會重新掛載，所以要到 App 重啟才恢復。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const performLogin = vi.fn<(provider?: string) => Promise<void>>();
vi.mock("@/const", () => ({ performLogin: (p?: string) => performLogin(p) }));

import LoginDialog from "./LoginDialog";

afterEach(() => { cleanup(); performLogin.mockReset(); });

function Host() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <LoginDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
const providerButtons = () => [/Google/, /LINE/, /Apple/].map(n => screen.getByRole("button", { name: n }));
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("LoginDialog：OAuth 嘗試結束後一定回到可操作狀態", () => {
  it("開啟登入頁期間（Browser.open 尚未返回）防止重複點擊，只呼叫一次", async () => {
    const d = deferred();
    performLogin.mockReturnValue(d.promise);
    render(<LoginDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /LINE/ }));
    for (const b of providerButtons()) expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    expect(performLogin).toHaveBeenCalledTimes(1);
    expect(performLogin).toHaveBeenCalledWith("line");
    await act(async () => { d.resolve(); await d.promise; });
    for (const b of providerButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("取消／返回／放棄（Browser.open 已返回、沒有任何 callback）→ 回到 App 重新打開對話框，按鈕可再次登入", async () => {
    performLogin.mockResolvedValue(undefined);
    render(<Host />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /LINE/ })); });
    // 對話框已關閉；使用者取消後回到 App 再打開
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    for (const b of providerButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Google/ })); });
    expect(performLogin).toHaveBeenNthCalledWith(2, "google");
  });

  it("performLogin 失敗（Browser.open reject）→ 按鈕恢復", async () => {
    const d = deferred();
    performLogin.mockReturnValue(d.promise);
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    await act(async () => { d.reject(new Error("open failed")); await d.promise.catch(() => {}); });
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    for (const b of providerButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("Browser.open 一直沒返回（放棄的流程）→ 重新打開對話框仍可操作", async () => {
    performLogin.mockReturnValue(new Promise<void>(() => {}));
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /Apple/ }));
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    for (const b of providerButtons()) expect((b as HTMLButtonElement).disabled).toBe(false);
  });
});
