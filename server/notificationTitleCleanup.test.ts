/**
 * 通知標題 Markdown 清理（toPlainNotificationText）回歸測試。
 *
 * 分兩塊：
 *   1) 對 server/push.ts 匯出的 toPlainNotificationText 做純函式單元測試
 *      （不需要 DB）。
 *   2) 對 server/routers.ts／server/db.ts 原始碼做內容斷言，確認 Email／
 *      Push／站內通知三個管道都呼叫同一支 helper，而且 news.title 這個
 *      DB 欄位本身完全不會被這支 helper 動到（createNews／updateNews 不
 *      import、不呼叫）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { toPlainNotificationText } from "./push";

describe("toPlainNotificationText：Markdown／HTML／控制字元清理", () => {
  it("移除 Markdown 粗體 **文字**", () => {
    expect(toPlainNotificationText("**2026 OXM 傳產創新消息**")).toBe("2026 OXM 傳產創新消息");
  });

  it("移除 Markdown 粗體 __文字__", () => {
    expect(toPlainNotificationText("__2026 OXM 傳產創新消息__")).toBe("2026 OXM 傳產創新消息");
  });

  it("移除 Markdown 斜體 *文字* 與 _文字_", () => {
    expect(toPlainNotificationText("*重要*公告")).toBe("重要公告");
    expect(toPlainNotificationText("_重要_公告")).toBe("重要公告");
  });

  it("移除行首 Markdown 標題符號 #／##／###，保留內容", () => {
    expect(toPlainNotificationText("### 【重要】設備汰舊補助")).toBe("【重要】設備汰舊補助");
    expect(toPlainNotificationText("## 標題")).toBe("標題");
    expect(toPlainNotificationText("# 標題")).toBe("標題");
  });

  it("句子中間合理出現的 # 不會被誤刪（只處理行首標題符號）", () => {
    expect(toPlainNotificationText("徵才職缺 #1 招募中")).toBe("徵才職缺 #1 招募中");
  });

  it("Markdown 連結 [文字](網址) 只保留文字，網址不出現在結果中", () => {
    expect(toPlainNotificationText("[經濟部公告](https://example.com)")).toBe("經濟部公告");
    const result = toPlainNotificationText("詳情請見 [官方網站](https://gov.example.com/subsidy?id=123)");
    expect(result).toBe("詳情請見 官方網站");
    expect(result).not.toMatch(/https?:\/\//);
  });

  it("移除行內程式碼反引號", () => {
    expect(toPlainNotificationText("使用 `npm install` 安裝")).toBe("使用 npm install 安裝");
  });

  it("移除 HTML 標籤", () => {
    expect(toPlainNotificationText("<b>重要公告</b>")).toBe("重要公告");
  });

  it("換行、tab 與控制字元被清除，多個連續空白收斂成一個", () => {
    expect(toPlainNotificationText("重要\n公告\t內容")).toBe("重要 公告 內容");
    expect(toPlainNotificationText("重要   公告    內容")).toBe("重要 公告 內容");
    expect(toPlainNotificationText("重要\x00公告")).toBe("重要 公告");
  });

  it("前後空白裁掉", () => {
    expect(toPlainNotificationText("   重要公告   ")).toBe("重要公告");
  });

  it("不刪除中文標點、括號、全形/半形斜線、連字號、百分比與數字", () => {
    const title = "2026第17屆競賽（台北場）：補助20%，最高NT$50,000／案，2026-08-01截止";
    expect(toPlainNotificationText(title)).toBe(title);
  });

  it("清理後若變成空字串，fallback 成固定安全標題", () => {
    expect(toPlainNotificationText("### ```")).toBe("OXM 產業情報中心有新消息"); // 行首標題符號 + 程式碼反引號
    expect(toPlainNotificationText("***___~~~")).toBe("OXM 產業情報中心有新消息"); // 純粗體/斜體/刪除線符號
    expect(toPlainNotificationText("   ")).toBe("OXM 產業情報中心有新消息");
    expect(toPlainNotificationText("")).toBe("OXM 產業情報中心有新消息");
  });

  it("超過長度限制時截斷，且截斷點不會落在殘留 Markdown 符號上（因為已經清乾淨）", () => {
    const longTitle = "**" + "產業情報".repeat(30) + "**"; // 清理後純文字很長
    const result = toPlainNotificationText(longTitle, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).not.toMatch(/[*_`~#]/);
    expect(result.endsWith("…")).toBe(true);
  });

  it("組合案例：多種 Markdown 符號同時出現，一次全部清乾淨", () => {
    const messy = "### **[開拓海外市場方案](https://example.com/x)**\n每家企業最高補助 `NT$200,000`";
    const result = toPlainNotificationText(messy);
    expect(result).toBe("開拓海外市場方案 每家企業最高補助 NT$200,000");
  });
});

describe("news.title 原始資料完全不受 toPlainNotificationText 影響", () => {
  it("server/db.ts 完全沒有 import 或呼叫 toPlainNotificationText——createNews／updateNews 寫入 DB 的 title 欄位維持原始 Markdown", () => {
    const dbSource = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    expect(dbSource).not.toMatch(/toPlainNotificationText/);
  });

  it("client 端（News.tsx／NewsDetail.tsx／AdminNews.tsx）不會 import server 專用的 toPlainNotificationText，網站頁面顯示邏輯不受通知清理影響", () => {
    for (const file of ["../client/src/pages/News.tsx", "../client/src/pages/NewsDetail.tsx", "../client/src/pages/AdminNews.tsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, file), "utf-8");
      expect(src).not.toMatch(/toPlainNotificationText/);
    }
  });
});

describe("Email／Push／站內通知三個管道共用同一支 toPlainNotificationText（routers.ts 原始碼斷言）", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");

  it("routers.ts 從 ./push 匯入 toPlainNotificationText", () => {
    expect(source).toMatch(/import\s*\{[^}]*toPlainNotificationText[^}]*\}\s*from\s*"\.\/push"/);
  });

  it("dispatchNewsNotifications：先算出 plainTitle 一次，站內通知 titleSnapshot／sendNewsEmail／sendPushToUser 都用同一個變數，不是各自呼叫 toPlainNotificationText 或直接用 params.title", () => {
    const start = source.indexOf("async function dispatchNewsNotifications");
    const end = source.indexOf("\n/**\n * 管理員限定的「重試本篇失敗通知」", start);
    const fn = source.slice(start, end);

    expect(fn).toMatch(/const plainTitle = toPlainNotificationText\(params\.title\)/);
    expect(fn).toMatch(/titleSnapshot: plainTitle/);
    expect(fn).toMatch(/newsTitle: plainTitle/);
    expect(fn).toMatch(/title: plainTitle/);
    // 站內通知／Email／Push 三個管道都不應該直接用未清理過的 params.title。
    expect(fn).not.toMatch(/titleSnapshot: params\.title/);
    expect(fn).not.toMatch(/newsTitle: params\.title/);
    expect(fn).not.toMatch(/title: params\.title/);
  });

  it("retryNewsNotifications：一樣先算出 plainTitle 一次，Email／Push 都共用同一個變數", () => {
    const start = source.indexOf("async function retryNewsNotifications");
    const end = source.indexOf("\n// Returns null (no filter)", start);
    const fn = source.slice(start, end === -1 ? start + 3000 : end);

    expect(fn).toMatch(/const plainTitle = toPlainNotificationText\(item\.title\)/);
    expect(fn).toMatch(/newsTitle: plainTitle/);
    expect(fn).toMatch(/title: plainTitle/);
    expect(fn).not.toMatch(/newsTitle: item\.title/);
    expect(fn).not.toMatch(/\btitle: item\.title\b/);
  });
});
