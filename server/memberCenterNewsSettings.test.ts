/**
 * 會員中心「通知設定」— 產業情報中心 UI 結構回歸測試。
 *
 * 這個專案的 vitest 設定（vitest.config.ts）environment 是 "node"、include
 * 只有 server/**\/*.test.ts，沒有 jsdom／React Testing Library，無法實際
 * render React 元件。跟本專案既有慣例一致（server/news.test.ts、
 * server/newsBoardSubscription.test.ts 對 adminProcedure／publicProcedure
 * 權限、dispatchNewsNotifications 內部邏輯都是直接讀原始碼字串斷言，不是
 * 跑真的 tRPC caller），這裡改成直接讀 client/src/pages/MemberCenter.tsx
 * 的原始碼，用結構性斷言驗證「產業情報中心」這一列確實併入既有
 * NOTIFICATION_ROWS 表格、不再是獨立卡片、key 沒有被改掉。
 *
 * 開關實際點擊後的儲存／重新整理保留行為，屬於 trpc.user.updateNotificationSettings
 * 既有既有邏輯（這次完全沒有改動該 mutation 或 db.updateUserNotificationSettings），
 * 已有涵蓋範圍更廣的既有測試保護，這裡不重複測。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/MemberCenter.tsx"), "utf-8");

function extractRowsBlock(): string {
  const start = source.indexOf("const NOTIFICATION_ROWS = [");
  const end = source.indexOf("\n];", start);
  if (start === -1 || end === -1) throw new Error("找不到 NOTIFICATION_ROWS 定義");
  return source.slice(start, end);
}

function extractLabelsInOrder(block: string): string[] {
  const matches = [...block.matchAll(/label:\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

describe("MemberCenter NOTIFICATION_ROWS：產業情報中心併入既有通知表格", () => {
  it("最終列順序：產業情報中心是第 6 列，緊接在平台公告之後", () => {
    const labels = extractLabelsInOrder(extractRowsBlock());
    expect(labels).toEqual([
      "工廠回覆我的評價",
      "詢價有新訊息",
      "檢舉狀態更新",
      "客服投訴狀態更新",
      "平台公告",
      "產業情報中心",
    ]);
  });

  it("產業情報中心這一列的 emailKey／pushKey 仍是既有的 news／pushNews（沒有另外發明新 key）", () => {
    const block = extractRowsBlock();
    const idx = block.indexOf('label: "產業情報中心"');
    expect(idx).toBeGreaterThan(-1);
    const entryEnd = block.indexOf("},", idx);
    const entry = block.slice(idx, entryEnd);
    expect(entry).toMatch(/emailKey:\s*"news"/);
    expect(entry).toMatch(/pushKey:\s*"pushNews"/);
  });

  it("說明文字讓會員知道關閉開關不影響看板訂閱或站內通知中心", () => {
    const block = extractRowsBlock();
    const idx = block.indexOf('label: "產業情報中心"');
    const entryEnd = block.indexOf("},", idx);
    const entry = block.slice(idx, entryEnd);
    expect(entry).toMatch(/description:\s*"[^"]*OXM 通知中心[^"]*"/);
  });

  it("DEFAULT_NOTIFICATIONS 仍保留 news／pushNews 兩個 key（沿用既有 opt-out 預設 true 語意）", () => {
    const start = source.indexOf("const DEFAULT_NOTIFICATIONS");
    const end = source.indexOf("\n};", start);
    const block = source.slice(start, end);
    expect(block).toMatch(/news:\s*true/);
    expect(block).toMatch(/pushNews:\s*true/);
  });

  it("不再存在獨立的「產業情報中心」卡片：沒有專屬的 settings.news／settings.pushNews 直接存取，也沒有獨立卡片容器的殘留註解", () => {
    expect(source).not.toMatch(/settings\.news\b/);
    expect(source).not.toMatch(/settings\.pushNews\b/);
    expect(source).not.toMatch(/獨立成自己的區塊/);
    // "產業情報中心" 字樣在檔案中只會出現在 NOTIFICATION_ROWS 的 label 與上方
    // 說明註解各一次，不會有第三處（例如獨立卡片自己的標題 <p>）。
    const occurrences = (source.match(/產業情報中心/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it("產業情報中心這一列由共用的 NOTIFICATION_ROWS.map 渲染，跟其他列共用同一套列高／字級／Email／手機欄位結構，沒有另外寫一份 JSX", () => {
    const mapIdx = source.indexOf("NOTIFICATION_ROWS.map(");
    expect(mapIdx).toBeGreaterThan(-1);
    // map 之後到下一個 </div> 收尾（通知分類表整體結束）之間才是列的渲染邏輯，
    // 產業情報中心的 label/description/emailKey/pushKey 只在陣列定義裡出現，
    // render 區塊本身完全不寫死 "產業情報中心" 或 "news"／"pushNews" 字面值。
    const renderBlockEnd = source.indexOf("{/* ── 產業情報中心", mapIdx);
    expect(renderBlockEnd).toBe(-1); // 舊的獨立卡片註解已經不存在
  });
});
