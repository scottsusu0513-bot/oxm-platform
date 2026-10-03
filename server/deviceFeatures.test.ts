/**
 * 裝置功能最終驗證（FINAL 前）回歸：
 *   1. PDF（聊天型錄／資訊看板附件）一律在點擊同步階段透過 openExternalUrlFromAsync
 *      開啟——await 取得 signed URL 之後才 window.open 會被 iPhone Safari 的 popup
 *      blocker 無聲擋下（資訊看板 PDF 原本就是這樣）。
 *   2. iOS：App 內有 accept="image/*" 的 <input type="file">，WKWebView 會在選單提供
 *      「拍照」；Info.plist 缺 NSCameraUsageDescription 時選「拍照」App 會直接閃退。
 *   3. 無法解碼的圖片（例如 Android 相簿的 HEIC）不得無聲略過。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf-8");

describe("PDF 開啟：點擊同步階段開分頁（popup-safe），App 走 @capacitor/browser", () => {
  for (const file of ["client/src/pages/NewsDetail.tsx", "client/src/pages/AdminNews.tsx", "client/src/pages/ChatPage.tsx"]) {
    it(`${file}：PDF signed URL 只經由 openExternalUrlFromAsync 開啟`, () => {
      const src = read(file);
      expect(src).toMatch(/openExternalUrlFromAsync\(async \(\) => \(await \w+\.mutateAsync\(/);
      // 不得先 await 取得網址、再 openExternalUrl(result.url)
      expect(src).not.toMatch(/openExternalUrl\(result\.url\)/);
    });
  }
});

describe("iOS Info.plist 與 App 實際提供的圖片選取方式一致", () => {
  const plist = read("ios/App/App/Info.plist");
  const imageInputs = ["client/src/pages/FactoryDashboard.tsx", "client/src/pages/FactoryRegister.tsx"]
    .some(f => /type="file"[\s\S]{0,200}accept="image\/\*"|accept="image\/\*"[\s\S]{0,200}type="file"/.test(read(f)));

  it("有 accept=\"image/*\" 檔案輸入 → 必須有相機與照片圖庫用途說明（否則選「拍照」會閃退）", () => {
    expect(imageInputs).toBe(true);
    for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) {
      const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
      expect(m, `${key} 缺少`).not.toBeNull();
      expect(m![1].trim().length).toBeGreaterThan(5);
    }
  });

  it("oxm:// URL scheme 仍然註冊（OAuth callback 回到 App）", () => {
    expect(plist).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>oxm<\/string>/);
  });
});

describe("工廠相簿／商品圖片：無法解碼的圖片要提示，不可無聲略過", () => {
  it("FactoryDashboard 不再有空的 compressImage catch", () => {
    const src = read("client/src/pages/FactoryDashboard.tsx");
    expect(src).not.toMatch(/compressImage\(file\)\);\s*\}\s*catch\s*\{\s*\}/);
  });
});
