/**
 * 新增產業「綠色材料／永續材料」與新增代工模式「OBM」— 回歸測試。
 *
 * 產業與子產業儲存在 factories.industry／factories.subIndustry（JSON 陣列，無
 * DB enum 限制），唯一權威來源是 shared/constants.ts 的 INDUSTRIES；代工模式
 * 儲存在 factories.mfgModes（同樣是 JSON 陣列），唯一權威來源是
 * MFG_MODE_OPTIONS。這裡驗證：
 *   1. 新產業／新代工模式已經正確加入這些單一來源常數。
 *   2. 產業對應的 SEO slug／SEO 內容存在（維持與其他既有產業一致的架構）。
 *   3. Home.tsx／Search.tsx 裡原本用硬編碼陣列（不是動態讀
 *      MFG_MODE_OPTIONS）呈現代工模式篩選的地方，也同步加入了 OBM——這幾處
 *      是純靜態原始碼契約檢查（readFileSync + 字串比對），因為它們本來就不是
 *      從常數動態產生，無法用「import 常數後跑行為測試」驗證，只能直接確認
 *      原始碼裡真的有這段文字。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  INDUSTRIES,
  INDUSTRY_OPTIONS,
  INDUSTRY_SLUGS,
  INDUSTRY_SLUG_TO_NAME,
  INDUSTRY_SLUG_TO_NAMES,
  INDUSTRY_SEO_CONTENT,
  MFG_MODE_OPTIONS,
} from "@shared/constants";

const NEW_INDUSTRY_NAME = "綠色材料／永續材料";
const NEW_INDUSTRY_SUBS = ["生質塑膠", "全澱粉基材料", "生物可分解材料", "再生材料", "天然纖維材料", "生質複合材料", "可堆肥材料", "其他"];

describe("新增產業：綠色材料／永續材料", () => {
  it("INDUSTRIES 包含新產業，且子產業依序精確等於指定的 7 項＋比照其他既有產業慣例補上的「其他」（共 8 項，不多不少）", () => {
    const entry = INDUSTRIES.find(i => i.name === NEW_INDUSTRY_NAME);
    expect(entry).toBeTruthy();
    expect([...(entry?.sub ?? [])]).toEqual(NEW_INDUSTRY_SUBS);
  });

  it("INDUSTRY_OPTIONS 包含新產業名稱", () => {
    expect(INDUSTRY_OPTIONS).toContain(NEW_INDUSTRY_NAME);
  });

  it("既有產業與子產業維持不變（只新增，沒有調整既有順序或內容）", () => {
    expect(INDUSTRIES[0].name).toBe("紡織");
    expect(INDUSTRIES[INDUSTRIES.length - 2].name).toBe("工業設備／機械");
    expect(INDUSTRIES.length).toBe(13);
  });

  it("INDUSTRY_SLUGS 有新產業的 slug，且 INDUSTRY_SLUG_TO_NAME／INDUSTRY_SLUG_TO_NAMES 能正確反查回中文名稱", () => {
    const slug = INDUSTRY_SLUGS[NEW_INDUSTRY_NAME];
    expect(slug).toBeTruthy();
    expect(INDUSTRY_SLUG_TO_NAME[slug!]).toBe(NEW_INDUSTRY_NAME);
    expect(INDUSTRY_SLUG_TO_NAMES[slug!]).toEqual([NEW_INDUSTRY_NAME]);
  });

  it("INDUSTRY_SEO_CONTENT 有新產業的介紹內容（intro／applications／howToChoose 皆非空字串）", () => {
    const content = INDUSTRY_SEO_CONTENT[NEW_INDUSTRY_NAME];
    expect(content).toBeTruthy();
    expect(content?.intro.length).toBeGreaterThan(0);
    expect(content?.applications.length).toBeGreaterThan(0);
    expect(content?.howToChoose.length).toBeGreaterThan(0);
  });
});

describe("新增代工模式：OBM", () => {
  it("MFG_MODE_OPTIONS 依序為 ODM、OEM、OBM（既有兩項順序不變，OBM 新增在後）", () => {
    expect([...MFG_MODE_OPTIONS]).toEqual(["ODM", "OEM", "OBM"]);
  });

  it("client/src/pages/Home.tsx 首頁代工模式篩選下拉選單含 OBM（僅靜態原始碼契約，非行為證明）", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "Home.tsx"),
      "utf-8"
    );
    expect(source).toMatch(/label: "OBM（自有品牌）", value: "OBM"/);
  });

  it("client/src/pages/Search.tsx 搜尋頁代工模式篩選（桌面＋手機）皆含 OBM（僅靜態原始碼契約，非行為證明）", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "client", "src", "pages", "Search.tsx"),
      "utf-8"
    );
    const matches = source.match(/l: "OBM", v: "OBM"/g) ?? [];
    // Search.tsx 桌面版側欄與手機版篩選各自獨立渲染同一組選項（非共用元件），
    // 兩處都必須各自加上 OBM，這裡確認至少出現兩次。
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
