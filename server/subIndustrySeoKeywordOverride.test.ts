/**
 * 子產業 SEO Keyword Mapping 基礎架構 + 第一批 6 頁 + 第二批 8 頁優化
 * （見任務定案）。
 *
 * 涵蓋：
 *   - 第一批 6 個子產業（cnc-machining／sheet-metal／smt-assembly／
 *     plastic-injection／packaging-print／cosmetic-odm）+ 第二批 8 個子產業
 *     （apparel-manufacturing／mold-making／metal-materials／
 *     eco-packaging／beverage-oem／frozen-food／large-format-printing／
 *     sticker-label）共 14 筆的 title／description／H1／intro override
 *     正確套用
 *   - pcb 本輪明確暫緩，維持沒有 override（fallback）
 *   - 沒有設定 override 的其餘子產業（58 個）完全沿用既有固定 template，
 *     一個字都不變
 *   - secondaryKeywords 純粹是 SEO 研究資料，程式碼裡任何地方都不得把它
 *     直接 render 成前台可見文字
 *   - canonical／robots（noindex 判斷邏輯）／breadcrumb 完全不受 override 影響
 *   - region × subIndustry（buildRegionSubIndustryPageContent）完全不受
 *     這輪改動影響——本輪只加了全台版的 override 消費邏輯
 *   - 沒有 keyword stuffing／禁用詞（最推薦／最大／最完整／No.1／第一）
 *   - 長度落在任務定案的建議區間附近（title 約 25-35 字、description 約
 *     60-90 字、intro 約 40-80 字，抓寬鬆一點的邊界避免測試過度死板）
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveSubIndustry, buildSubIndustryPageContent,
  resolveRegionSubIndustry, buildRegionSubIndustryPageContent,
} from "@shared/seo/subIndustryPages";
import { SUB_INDUSTRY_SEARCH_ENTRIES, SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY } from "@shared/constants";

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, "..", ...segments), "utf-8");
}

const BATCH_1_SLUGS = ["cnc-machining", "sheet-metal", "smt-assembly", "plastic-injection", "packaging-print", "cosmetic-odm"];
const BATCH_2_SLUGS = ["apparel-manufacturing", "mold-making", "metal-materials", "eco-packaging", "beverage-oem", "frozen-food", "large-format-printing", "sticker-label"];
const OVERRIDDEN_SLUGS = [...BATCH_1_SLUGS, ...BATCH_2_SLUGS];

const EXPECTED = {
  "cnc-machining": {
    h1: "CNC 加工廠",
    title: "CNC 加工廠｜台灣 CNC 代工與精密零件工廠｜OXM",
    description: "尋找台灣 CNC 加工廠？OXM 整理可承接 CNC 代工、精密零件加工與小量試作需求的工廠與工作室，並可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "CNC 加工是金屬加工底下的重要子產業。OXM 整理台灣可承接 CNC 代工與精密零件加工需求的工廠，可依地區與生產條件進一步篩選，直接送出詢價。",
  },
  "sheet-metal": {
    h1: "鈑金加工廠",
    title: "鈑金加工廠｜台灣鈑金代工、金屬製造廠商資訊｜OXM",
    description: "尋找台灣鈑金加工廠？OXM 整理可承接鈑金代工與金屬鈑金製造需求的工廠，可依地區、代工模式、可接小量與可打樣等條件進一步篩選並直接詢價。",
    intro: "鈑金加工是金屬加工底下的子產業，涵蓋鈑金代工與金屬製造需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "smt-assembly": {
    h1: "SMT 代工",
    title: "SMT 代工｜台灣 SMT 貼片與電子組裝廠商｜OXM",
    description: "尋找台灣 SMT 代工廠？OXM 整理可承接 SMT 貼片、打件與電子組裝需求的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "SMT 代工是電子零件底下的子產業，涵蓋貼片與電子組裝服務。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "plastic-injection": {
    h1: "塑膠射出代工",
    title: "塑膠射出代工｜台灣射出成型與塑膠製品代工工廠｜OXM",
    description: "尋找台灣塑膠射出代工廠？OXM 整理可承接射出成型、塑膠模具與塑膠製品代工需求的工廠，可依地區、代工模式等條件進一步篩選詢價。",
    intro: "塑膠射出代工是塑膠底下的子產業，涵蓋射出成型與塑膠製品需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "packaging-print": {
    h1: "包裝印刷廠",
    title: "包裝印刷廠｜台灣彩盒印刷與包裝印刷代工廠商｜OXM",
    description: "尋找台灣包裝印刷廠？OXM 整理可承接彩盒印刷與包裝印刷代工需求的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "包裝印刷是印刷底下的子產業，涵蓋彩盒與包裝印刷代工需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "cosmetic-odm": {
    h1: "保養品代工",
    title: "保養品代工｜台灣化妝品 ODM／OEM 廠商｜OXM",
    description: "尋找台灣保養品代工廠？OXM 整理提供化妝品 ODM、OEM 開發與生產服務的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "保養品代工是化工製造底下的子產業，涵蓋化妝品 ODM 與 OEM 開發服務。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "apparel-manufacturing": {
    h1: "成衣代工",
    title: "成衣代工｜台灣成衣代工廠搜尋與詢價｜OXM",
    description: "尋找台灣成衣代工廠？OXM 整理可承接成衣 OEM／ODM 訂單的製造業者，可依地區、代工模式、可接小量與可打樣等條件篩選與詢價。",
    intro: "成衣代工是紡織產業的重要製造服務。OXM 整理台灣可承接成衣代工、OEM／ODM 生產需求的工廠，可依地區與生產條件篩選並直接詢價。",
  },
  "mold-making": {
    h1: "模具廠",
    title: "模具廠｜台灣模具製造與加工廠商｜OXM",
    description: "尋找台灣模具廠？OXM 整理可承接模具製造、加工、開發與開模需求的廠商，涵蓋塑膠模具、沖壓模具等類型，可依地區與生產條件篩選詢價。",
    intro: "OXM 整理台灣模具廠與模具製造廠商資訊，涵蓋塑膠模具、沖壓模具、模具加工與開模需求，可依地區與生產條件篩選並直接詢價。",
  },
  "metal-materials": {
    h1: "金屬材料供應商",
    title: "金屬材料供應商｜台灣金屬原料廠商搜尋與詢價｜OXM",
    description: "尋找台灣金屬材料供應商？OXM 整理不鏽鋼、鋁材與其他金屬原料供應廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣金屬材料與原料供應商資訊，涵蓋不鏽鋼、鋁材等材料來源，可依地區瀏覽相關供應商並直接詢價。",
  },
  "eco-packaging": {
    h1: "環保包裝供應商",
    title: "環保包裝供應商｜台灣環保包材廠商搜尋與詢價｜OXM",
    description: "尋找台灣環保包裝供應商？OXM 整理可供應環保包材、可分解包裝與相關包裝方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣環保包裝與包材供應商資訊，涵蓋環保包材、可分解包裝等方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  "beverage-oem": {
    h1: "飲料代工廠",
    title: "飲料代工廠｜台灣飲品 OEM 廠商搜尋與詢價｜OXM",
    description: "尋找台灣飲料代工廠？OXM 整理可承接飲料 OEM、手搖飲與機能飲料代工需求的製造業者，可依地區與生產條件篩選並直接詢價。",
    intro: "OXM 整理台灣飲料代工廠資訊，涵蓋飲料 OEM、手搖飲與機能飲料等生產需求，可依地區與生產條件篩選並直接詢價。",
  },
  "frozen-food": {
    h1: "冷凍食品代工廠",
    title: "冷凍食品代工廠｜台灣冷凍食品 OEM／ODM 廠商｜OXM",
    description: "尋找台灣冷凍食品代工廠？OXM 整理可承接冷凍食品 OEM、ODM、調理包與料理包代工需求的製造業者，可依地區與生產條件篩選並直接詢價。",
    intro: "OXM 整理台灣冷凍食品代工廠資訊，涵蓋冷凍食品 OEM、ODM、調理包與料理包等生產需求，可依地區與生產條件篩選並直接詢價。",
  },
  "large-format-printing": {
    h1: "大圖輸出",
    title: "大圖輸出｜台灣展場輸出與布條製作廠商｜OXM",
    description: "尋找台灣大圖輸出廠商？OXM 整理可承接展場輸出、布條、立牌與大型圖像製作需求的廠商，可依地區與生產條件篩選並直接詢價。",
    intro: "OXM 整理台灣大圖輸出廠商資訊，涵蓋展場輸出、布條、立牌等製作需求，可依地區與生產條件篩選並直接詢價。",
  },
  "sticker-label": {
    h1: "貼紙印刷",
    title: "貼紙印刷｜台灣標籤貼紙印刷廠搜尋與詢價｜OXM",
    description: "尋找台灣貼紙印刷廠？OXM 整理可承接商品貼紙、LOGO 貼紙與標籤印刷需求的廠商，可依地區與生產條件篩選並直接詢價。",
    intro: "OXM 整理台灣貼紙印刷與標籤印刷廠商資訊，涵蓋商品貼紙、LOGO 貼紙與標籤製作需求，可依地區與生產條件篩選並直接詢價。",
  },
} as const;

describe.each(OVERRIDDEN_SLUGS)("buildSubIndustryPageContent：%s 的 SEO override 正確套用", (slug) => {
  const resolved = resolveSubIndustry(slug)!;
  const content = buildSubIndustryPageContent(resolved);
  const expected = EXPECTED[slug as keyof typeof EXPECTED];

  it("H1 使用 primarySeoKeyword", () => {
    expect(content.h1).toBe(expected.h1);
    expect(content.h1).toBe(resolved.entry.primarySeoKeyword);
  });

  it("Title 使用 seoTitleOverride", () => {
    expect(content.title).toBe(expected.title);
    expect(content.title).toBe(resolved.entry.seoTitleOverride);
  });

  it("Description 使用 metaDescriptionOverride", () => {
    expect(content.description).toBe(expected.description);
    expect(content.description).toBe(resolved.entry.metaDescriptionOverride);
  });

  it("Intro 使用 seoIntroOverride", () => {
    expect(content.intro).toBe(expected.intro);
    expect(content.intro).toBe(resolved.entry.seoIntroOverride);
  });

  it("Title 含品牌名 OXM，不含禁用宣稱詞（最推薦／最大／最完整／No.1／第一）", () => {
    expect(content.title).toContain("OXM");
    for (const forbidden of ["最推薦", "最大", "最完整", "No.1", "第一"]) {
      expect(content.title).not.toContain(forbidden);
      expect(content.description).not.toContain(forbidden);
      expect(content.intro).not.toContain(forbidden);
    }
  });

  it("Title 長度約 25-35 字（含品牌與分隔符號，抓寬鬆邊界 18-40）", () => {
    expect(content.title.length).toBeGreaterThanOrEqual(18);
    expect(content.title.length).toBeLessThanOrEqual(40);
  });

  it("Description 長度約 60-90 字（抓寬鬆邊界 50-100）", () => {
    expect(content.description.length).toBeGreaterThanOrEqual(50);
    expect(content.description.length).toBeLessThanOrEqual(100);
  });

  it("Intro 長度約 40-80 字（抓寬鬆邊界 35-90），且只有一段（不含換行符號）", () => {
    expect(content.intro.length).toBeGreaterThanOrEqual(35);
    expect(content.intro.length).toBeLessThanOrEqual(90);
    expect(content.intro).not.toContain("\n");
  });

  it("Primary keyword 出現在 title 的前段（靠前，不是埋在句尾）", () => {
    const primaryIndex = content.title.indexOf(resolved.entry.primarySeoKeyword!);
    expect(primaryIndex).toBe(0);
  });

  it("canonical 不受 override 影響，維持 self-canonical", () => {
    expect(content.canonical).toBe(`https://www.oxmmatch.com/factories/${slug}`);
  });
});

describe("沒有設定 override 的子產業：完全沿用既有固定 template，一個字都不變", () => {
  const nonOverriddenSlugs = SUB_INDUSTRY_SEARCH_ENTRIES
    .map(e => e.slug)
    .filter(slug => !OVERRIDDEN_SLUGS.includes(slug));

  it("除了兩批共 14 筆，其餘全部 58 筆都沒有設定任何 override 欄位", () => {
    expect(nonOverriddenSlugs.length).toBe(58);
    for (const slug of nonOverriddenSlugs) {
      const entry = SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug];
      expect(entry.primarySeoKeyword).toBeUndefined();
      expect(entry.secondaryKeywords).toBeUndefined();
      expect(entry.seoTitleOverride).toBeUndefined();
      expect(entry.metaDescriptionOverride).toBeUndefined();
      expect(entry.seoIntroOverride).toBeUndefined();
    }
  });

  it("pcb 本輪明確暫緩，維持沒有 override：h1／title／description／intro 完全符合舊有固定公式，不受本輪任何影響", () => {
    const resolved = resolveSubIndustry("pcb")!;
    const content = buildSubIndustryPageContent(resolved);
    expect(content.h1).toBe("PCB廠");
    expect(content.title).toBe("PCB廠｜台灣PCB廠搜尋與詢價｜OXM");
    expect(content.description).toBe("尋找台灣PCB廠？OXM 整理可承接PCB需求的製造業者，可依地區、代工模式、可接小量與可打樣等條件進一步篩選與詢價。");
    expect(content.intro).toBe("PCB是電子零件底下的子產業。OXM 整理台灣可承接PCB需求的工廠與工作室資訊，可使用 OXM 的搜尋功能依地區、類型、ODM／OEM／OBM 代工模式，以及可接小量、可打樣等生產條件進一步篩選，並直接送出詢價。");
    expect(resolved.entry.primarySeoKeyword).toBeUndefined();
  });

  it("welding-assembly（沒有 override）同樣完全符合舊有固定公式", () => {
    const resolved = resolveSubIndustry("welding-assembly")!;
    const content = buildSubIndustryPageContent(resolved);
    expect(content.h1).toBe("焊接組裝廠");
    expect(content.title).toBe("焊接組裝廠｜台灣焊接組裝廠搜尋與詢價｜OXM");
  });
});

describe("secondaryKeywords：純 SEO 研究資料，禁止任何形式直接 render 到前台", () => {
  it("14 個 override 頁都有設定 secondaryKeywords（SEO 策略資料存在，供文案研究參考）", () => {
    for (const slug of OVERRIDDEN_SLUGS) {
      const entry = SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug];
      expect(entry.secondaryKeywords).toBeDefined();
      expect(entry.secondaryKeywords!.length).toBeGreaterThan(0);
    }
  });

  it("buildSubIndustryPageContent 的回傳值（實際會被畫面使用的資料）不包含 secondaryKeywords 這個欄位", () => {
    for (const slug of OVERRIDDEN_SLUGS) {
      const resolved = resolveSubIndustry(slug)!;
      const content = buildSubIndustryPageContent(resolved);
      expect(content).not.toHaveProperty("secondaryKeywords");
      expect(Object.keys(content).sort()).toEqual(["canonical", "description", "h1", "intro", "title"]);
    }
  });

  it("client/src/pages/SubIndustryPage.tsx 原始碼完全沒有引用 secondaryKeywords（不會被拿去 render 成 chips／tags／熱門搜尋詞）", () => {
    const source = readSource("client", "src", "pages", "SubIndustryPage.tsx");
    expect(source).not.toContain("secondaryKeywords");
  });

  it("shared/seo/subIndustryPages.ts 的內容產生函式沒有把 secondaryKeywords 放進任何回傳值", () => {
    const source = readSource("shared", "seo", "subIndustryPages.ts");
    // 只允許在型別匯入／註解裡提到這個詞，不允許出現在任何 return 物件字面量裡
    // （粗略但有效的防呆：確認這個檔案根本沒有讀取 entry.secondaryKeywords）。
    expect(source).not.toContain("entry.secondaryKeywords");
    expect(source).not.toContain(".secondaryKeywords");
  });

  it("secondaryKeywords 沒有出現在 title／description／intro／H1 的實際輸出裡（沒有被整串塞進文案造成 keyword stuffing）", () => {
    for (const slug of OVERRIDDEN_SLUGS) {
      const resolved = resolveSubIndustry(slug)!;
      const content = buildSubIndustryPageContent(resolved);
      // secondary keyword 本身逐字出現不代表 stuffing（自然語句本來就可能
      // 剛好包含某個詞），但完整 secondaryKeywords 陣列被逐一、機械化全部
      // 塞進同一段文字才是我們要防的情況——這裡驗證沒有把全部 secondary
      // keyword 都塞進去。
      const combined = `${content.title}\n${content.description}\n${content.intro}`;
      const appearedCount = (resolved.entry.secondaryKeywords ?? []).filter(kw => combined.includes(kw)).length;
      const totalCount = (resolved.entry.secondaryKeywords ?? []).length;
      expect(appearedCount).toBeLessThan(totalCount);
    }
  });
});

describe("region × subIndustry（buildRegionSubIndustryPageContent）完全不受本輪 override 影響", () => {
  it("cnc-machining 的地區版 H1 仍是舊有固定公式（displayName，不是 primarySeoKeyword）", () => {
    const resolved = resolveRegionSubIndustry("taichung", "cnc-machining")!;
    const content = buildRegionSubIndustryPageContent(resolved);
    expect(content.h1).toBe("台中CNC加工廠");
  });

  it("sheet-metal／smt-assembly／plastic-injection／packaging-print／cosmetic-odm 的地區版同樣不受影響", () => {
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "sheet-metal")!).h1).toBe("台中鈑金加工廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "smt-assembly")!).h1).toBe("台中SMT電子組裝廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "plastic-injection")!).h1).toBe("台中塑膠外殼廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "packaging-print")!).h1).toBe("台中包裝印刷廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "cosmetic-odm")!).h1).toBe("台中保養品化妝品廠");
  });

  it("第二批 8 筆的地區版同樣不受影響（沿用 displayName，不是 primarySeoKeyword）", () => {
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "apparel-manufacturing")!).h1).toBe("台中成衣廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "mold-making")!).h1).toBe("台中模具廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "metal-materials")!).h1).toBe("台中金屬原料廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "eco-packaging")!).h1).toBe("台中環保包裝廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "beverage-oem")!).h1).toBe("台中飲料廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "frozen-food")!).h1).toBe("台中冷凍食品廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "large-format-printing")!).h1).toBe("台中大圖輸出廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "sticker-label")!).h1).toBe("台中貼紙標籤廠");
  });
});

describe("shared/constants.ts：SubIndustrySearchEntry 的 SEO 欄位是唯一 source，沒有第二份 slug 對照表", () => {
  it("14 個 override 頁的 key 都是既有 canonical slug（沒有另外新增 key 命名法）", () => {
    for (const slug of OVERRIDDEN_SLUGS) {
      expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug]).toBeDefined();
      expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug].slug).toBe(slug);
    }
  });

  it("SubIndustrySearchEntry 陣列總筆數仍是 72（本輪沒有新增／刪除任何 entry，只在既有 8 筆上加欄位）", () => {
    expect(SUB_INDUSTRY_SEARCH_ENTRIES.length).toBe(72);
  });

  it("pcb 明確沒有被加進 OVERRIDDEN_SLUGS（本輪暫緩）", () => {
    expect(OVERRIDDEN_SLUGS).not.toContain("pcb");
  });
});
