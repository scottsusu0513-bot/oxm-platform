/**
 * Batch 3.5：聊天 PDF 型錄的前端契約（BL–BR）與「await 後開啟外部網址」不被
 * popup blocker 無聲擋下（§35）。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ value: false, opened: [] as string[] }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.value, getPlatform: () => (native.value ? "ios" : "web") } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: async ({ url }: { url: string }) => { native.opened.push(url); } } }));

const { openExternalUrlFromAsync } = await import("./platform");

const chatSource = fs.readFileSync(path.resolve(__dirname, "../pages/ChatPage.tsx"), "utf-8");
const pdfCard = chatSource.slice(chatSource.indexOf("function PdfMessageCard"), chatSource.indexOf("// ── 商品選擇 Modal"));
const uploadHandler = chatSource.slice(chatSource.indexOf("const handlePdfUpload"), chatSource.indexOf("const handlePdfUpload") + 2500);

describe("ChatPage PDF 契約（BL–BR）", () => {
  it("BL：不再呼叫 base64 版 chat.sendPdf，也不讀 data URL", () => {
    expect(chatSource).not.toMatch(/chat\.sendPdf/);
    expect(uploadHandler).not.toMatch(/readAsDataURL|FileReader|base64/);
  });
  it("BM／BN／BO：先取得 upload session → 直接 PUT 檔案本體 → finalize", () => {
    const s = uploadHandler.indexOf("createPdfUploadSessionMut.mutateAsync");
    const p = uploadHandler.indexOf("uploadPdfToPresignedUrl(");
    const f = uploadHandler.indexOf("finalizePdfUploadMut.mutateAsync");
    expect(s).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(s);
    expect(f).toBeGreaterThan(p);
    expect(chatSource).toMatch(/fetch\(uploadUrl, \{ method: "PUT", headers: \{ "Content-Type": contentType \}, body: file \}\)/);
  });
  it("BP：下載改用 openExternalUrlFromAsync，不再 await 後動態建立 <a target=_blank>", () => {
    expect(pdfCard).toMatch(/openExternalUrlFromAsync\(/);
    expect(pdfCard).not.toMatch(/createElement\("a"\)|\.click\(\)/);
  });
  it("BQ：client 不讀取 fileUrl／fileKey", () => {
    expect(chatSource).not.toMatch(/fileUrl|fileKey/);
  });
  it("BR：tRPC 輸入只有 metadata（檔案本體走 presigned PUT，結構上不經過 Express 100kb JSON body）", () => {
    const sessionCall = uploadHandler.slice(uploadHandler.indexOf("createPdfUploadSessionMut.mutateAsync"), uploadHandler.indexOf("uploadPdfToPresignedUrl("));
    expect(sessionCall).toMatch(/fileName: file\.name/);
    expect(sessionCall).not.toMatch(/fileData|body:|file,/);
  });
  it("逾期卡片的檔名會換行（break-words＋min-w-0），不會橫向溢出", () => {
    expect(pdfCard).toMatch(/min-w-0">\s*<p className=\{`text-sm font-medium break-words/);
  });
});

describe("openExternalUrlFromAsync（§35 popup blocking）", () => {
  afterEach(() => { vi.unstubAllGlobals(); native.value = false; native.opened.length = 0; });

  it("Web：在第一個 await 之前就同步開好分頁，取得網址後導向", async () => {
    const popup = { opener: {} as unknown, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal("window", { open, location: { assign: vi.fn() } });
    let resolveUrl!: (u: string) => void;
    const done = openExternalUrlFromAsync(() => new Promise<string>(r => { resolveUrl = r; }));
    expect(open).toHaveBeenCalledTimes(1); // 同步階段（仍在使用者點擊內）
    expect(popup.opener).toBeNull();
    resolveUrl("https://private.example/x.pdf?test-signature=placeholder");
    await done;
    expect(popup.location.replace).toHaveBeenCalledWith("https://private.example/x.pdf?test-signature=placeholder");
  });
  it("Web：取得網址失敗 → 關閉空白分頁並把錯誤丟回呼叫端（顯示 toast）", async () => {
    const popup = { opener: null, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    vi.stubGlobal("window", { open: () => popup, location: { assign: vi.fn() } });
    await expect(openExternalUrlFromAsync(async () => { throw new Error("此型錄已逾期，無法下載"); })).rejects.toThrow("此型錄已逾期");
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });
  it("Web：連空白分頁都被擋 → 改在同分頁開啟，不會無聲失敗", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { open: () => null, location: { assign } });
    await openExternalUrlFromAsync(async () => "https://private.example/y.pdf");
    expect(assign).toHaveBeenCalledWith("https://private.example/y.pdf");
  });
  it("App（Capacitor）：取得網址後用 @capacitor/browser 開啟，不在 WebView 內 window.open", async () => {
    native.value = true;
    const open = vi.fn();
    vi.stubGlobal("window", { open, location: { assign: vi.fn() } });
    await openExternalUrlFromAsync(async () => "https://private.example/z.pdf");
    expect(native.opened).toEqual(["https://private.example/z.pdf"]);
    expect(open).not.toHaveBeenCalled();
  });
});
