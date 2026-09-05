import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * BUG 4 回歸測試：短影音服務頁「五大服務內容」區塊底下原本多一個重複的
 * 「申請免費初步諮詢」CTA。這裡不是比對無意義字串，而是鎖定兩個具體、會真的
 * 讓 bug 復發的行為：
 * 1. 整頁的 CTA 出現次數必須固定是 2（Hero 一個、頁尾收尾一個）——如果變成
 *    3，代表重複 CTA 又跑回來了；如果變成 0 或 1，代表誤刪了必要的 CTA。
 * 2. 「五大服務內容」的卡片 grid 到 section 結尾之間，不能再出現 CTA 連結。
 *
 * ERP 頁（/erp-optimization）「三條需求路徑」下方同一個模式的 CTA 移除，
 * 已改在既有的 server/erpOptimizationNoPublicEntry.test.ts 裡更新對應斷言
 * （該檔案本來就有一整組 ERP 頁專屬的靜態原始碼契約測試，包含這顆 CTA 的
 * 歷史沿革記錄，集中維護在同一處比在這裡重複一份更不容易漂移），不在這裡
 * 重複涵蓋。
 */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf-8");
}

const CTA_TEXT = "申請免費初步諮詢";

describe("ShortVideoMarketing.tsx — 五大服務內容區塊不再有重複 CTA", () => {
  const source = readSource("./ShortVideoMarketing.tsx");

  it("全頁仍然剛好有 2 個「申請免費初步諮詢」CTA（Hero + 頁尾收尾），不多不少", () => {
    const count = source.split(CTA_TEXT).length - 1;
    expect(count).toBe(2);
  });

  it("「五大服務內容」卡片 grid 到 section 結尾之間，不包含 CTA 連結", () => {
    // 錨定 section 開頭的獨有註解，避免字串本身在檔案別處出現時，把不相干的
    // 區塊也框進比對範圍。
    const sectionMatch = source.match(/\{\/\* ── 4\. 五大服務內容[\s\S]*?SHORT_VIDEO_SERVICES\.map[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/);
    expect(sectionMatch, "找不到「五大服務內容」section 的結尾範圍").not.toBeNull();
    expect(sectionMatch![0]).not.toContain(CTA_TEXT);
  });
});
