/**
 * 子產業 SEO Keyword Mapping 基礎架構 + 第一批 6 頁 + 第二批 8 頁 + 第三批
 * 26 頁（原 24 頁 + 電子零件「線束 / 連接器」拆分新增的 wire-cable／
 * wire-harness-assembly／connector-terminal，見任務定案「線束 / 連接器拆分
 * 為三類」）優化（見任務定案）。
 *
 * 涵蓋：
 *   - 第一批 6 個子產業（cnc-machining／sheet-metal／smt-assembly／
 *     plastic-injection／packaging-print／cosmetic-odm）+ 第二批 8 個子產業
 *     （apparel-manufacturing／mold-making／metal-materials／
 *     eco-packaging／beverage-oem／frozen-food／large-format-printing／
 *     sticker-label）+ 第三批 26 個子產業（見 BATCH_3_SLUGS）共 40
 *     筆的 title／description／H1／intro override 正確套用
 *   - pcb 本輪重新審核（PCB代工／PCB板廠／PCB電路板廠／PCB製造／PCB打樣
 *     等候選 primary）後仍無法高信心收斂成單一 primary，維持沒有 override
 *     （fallback）
 *   - 沒有設定 override 的其餘子產業（34 個，含 pcb）完全沿用既有固定
 *     template，一個字都不變——這些是本輪審核後明確判斷 confidence 低、
 *     split-intent、cannibalization 風險高，或屬 informational intent 而
 *     刻意保留 fallback 的項目，不是因為忘記處理
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
const BATCH_3_SLUGS = [
  "fabric-materials", "functional-textiles", "welding-assembly", "wire-cable", "wire-harness-assembly", "connector-terminal", "lighting-modules",
  "plastic-containers-bottles", "plastic-pipes-sheets", "rubber-silicone-seals", "pu-products", "furniture-making",
  "gift-specialty-packaging", "protective-packaging", "bakery-pastry", "snacks", "seasonings-sauces",
  "cleaning-products", "fragrance-essential-oils", "lighting-fixtures", "stationery-office-supplies",
  "outdoor-sports-goods", "pet-supplies", "baby-products", "automation-production-line-equipment",
  "inspection-measurement-equipment",
];
const OVERRIDDEN_SLUGS = [...BATCH_1_SLUGS, ...BATCH_2_SLUGS, ...BATCH_3_SLUGS];

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
  "fabric-materials": {
    h1: "布料供應商",
    title: "布料供應商｜台灣布料工廠搜尋與詢價｜OXM",
    description: "尋找台灣布料供應商？OXM 整理可供應各式布料、面料與機能布料的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣布料供應商資訊，涵蓋一般布料與面料來源，可依地區瀏覽相關供應商並直接詢價。",
  },
  "functional-textiles": {
    h1: "機能布料代工",
    title: "機能布料代工｜台灣機能性紡織品廠商｜OXM",
    description: "尋找台灣機能布料代工廠？OXM 整理可承接機能性紡織品需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣機能布料代工廠資訊，涵蓋機能性紡織品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "welding-assembly": {
    h1: "焊接加工",
    title: "焊接加工｜台灣焊接代工廠商搜尋與詢價｜OXM",
    description: "尋找台灣焊接加工廠？OXM 整理可承接焊接代工、金屬組裝需求的廠商，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣焊接加工廠資訊，涵蓋焊接代工與金屬組裝需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "wire-cable": {
    h1: "電子線材工廠",
    title: "電子線材工廠｜台灣電源線、訊號線與線材代工廠商｜OXM",
    description: "尋找台灣電子線材工廠？OXM 整理可承接電源線、訊號線、同軸線、排線等線材代工需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "線材／電纜是電子零件底下的子產業，涵蓋電源線、訊號線、同軸線、排線等各類線材本體製造。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "wire-harness-assembly": {
    h1: "線束加工廠",
    title: "線束加工廠｜台灣線束代工與線組加工廠商｜OXM",
    description: "尋找台灣線束加工廠？OXM 整理可承接裁線、剝皮、端子壓接、客製線組組裝需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "線束／線組加工是電子零件底下的子產業，涵蓋 Wire Harness、Cable Assembly 等線組組裝需求。OXM 整理台灣相關工廠資訊，可依地區篩選並直接詢價。",
  },
  "connector-terminal": {
    h1: "連接器工廠",
    title: "連接器工廠｜台灣連接器與端子製造廠商｜OXM",
    description: "尋找台灣連接器工廠？OXM 整理可承接連接器、端子、接插件與插座製造需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    intro: "連接器／端子是電子零件底下的子產業，涵蓋 Connector、Terminal 等接插件與插座製造需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  "lighting-modules": {
    h1: "LED照明代工",
    title: "LED照明代工｜台灣照明模組廠商搜尋與詢價｜OXM",
    description: "尋找台灣LED照明代工廠？OXM 整理可承接照明模組、工業照明需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣LED照明代工廠資訊，涵蓋照明模組與工業照明生產需求，可依地區查看相關工廠並直接詢價。",
  },
  "plastic-containers-bottles": {
    h1: "塑膠容器代工",
    title: "塑膠容器代工｜台灣塑膠瓶罐廠商搜尋與詢價｜OXM",
    description: "尋找台灣塑膠容器代工廠？OXM 整理可承接塑膠瓶罐、容器生產需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣塑膠容器代工廠資訊，涵蓋塑膠瓶罐與容器生產需求，可依地區查看相關工廠並直接詢價。",
  },
  "plastic-pipes-sheets": {
    h1: "塑膠板材供應商",
    title: "塑膠板材供應商｜台灣塑膠管材廠商搜尋與詢價｜OXM",
    description: "尋找台灣塑膠板材供應商？OXM 整理可供應塑膠管材、板材與押出加工的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣塑膠板材與管材供應商資訊，涵蓋押出加工相關廠商，可依地區瀏覽相關供應商並直接詢價。",
  },
  "rubber-silicone-seals": {
    h1: "橡膠密封件代工",
    title: "橡膠密封件代工｜台灣O-Ring廠商搜尋與詢價｜OXM",
    description: "尋找台灣橡膠密封件代工廠？OXM 整理可承接O-Ring、密封圈生產需求的廠商，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣橡膠密封件代工廠資訊，涵蓋O-Ring、密封圈生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "pu-products": {
    h1: "PU製品代工",
    title: "PU製品代工｜台灣聚氨酯製品廠商搜尋與詢價｜OXM",
    description: "尋找台灣PU製品代工廠？OXM 整理可承接聚氨酯、PU發泡製品需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣PU製品代工廠資訊，涵蓋聚氨酯與PU發泡製品需求，可依地區查看相關工廠並直接詢價。",
  },
  "furniture-making": {
    h1: "家具代工",
    title: "家具代工｜台灣OEM家具工廠搜尋與詢價｜OXM",
    description: "尋找台灣家具代工廠？OXM 整理可承接家具OEM、訂製生產需求的工廠，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣家具代工廠資訊，涵蓋家具OEM與訂製生產需求，可依地區查看相關工廠並直接詢價。",
  },
  "gift-specialty-packaging": {
    h1: "禮盒代工",
    title: "禮盒代工｜台灣禮盒包裝廠商搜尋與詢價｜OXM",
    description: "尋找台灣禮盒代工廠？OXM 整理可承接禮盒、特殊包裝生產需求的廠商，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣禮盒代工廠資訊，涵蓋禮盒與特殊包裝生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "protective-packaging": {
    h1: "緩衝包材廠商",
    title: "緩衝包材廠商｜台灣包裝緩衝材搜尋與詢價｜OXM",
    description: "尋找台灣緩衝包材廠商？OXM 整理可供應緩衝材、氣泡布等包裝防護方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣緩衝包材廠商資訊，涵蓋緩衝材、氣泡布等包裝防護方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  "bakery-pastry": {
    h1: "烘焙代工",
    title: "烘焙代工｜台灣糕點伴手禮廠商搜尋與詢價｜OXM",
    description: "尋找台灣烘焙代工廠？OXM 整理可承接糕點、伴手禮代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣烘焙代工廠資訊，涵蓋糕點與伴手禮代工需求，可依地區查看相關工廠並直接詢價。",
  },
  "snacks": {
    h1: "零食代工",
    title: "零食代工｜台灣休閒食品廠商搜尋與詢價｜OXM",
    description: "尋找台灣零食代工廠？OXM 整理可承接零食、休閒食品代工需求的製造業者，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣零食代工廠資訊，涵蓋零食與休閒食品代工需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "seasonings-sauces": {
    h1: "調味料代工",
    title: "調味料代工｜台灣醬料代工廠商搜尋與詢價｜OXM",
    description: "尋找台灣調味料代工廠？OXM 整理可承接調味料、醬料代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣調味料代工廠資訊，涵蓋調味料與醬料代工需求，可依地區查看相關工廠並直接詢價。",
  },
  "cleaning-products": {
    h1: "清潔用品代工",
    title: "清潔用品代工｜台灣清潔劑廠商搜尋與詢價｜OXM",
    description: "尋找台灣清潔用品代工廠？OXM 整理可承接清潔劑、洗劑代工需求的製造業者，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣清潔用品代工廠資訊，涵蓋清潔劑與洗劑代工需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "fragrance-essential-oils": {
    h1: "精油代工",
    title: "精油代工｜台灣香氛保養品廠商搜尋與詢價｜OXM",
    description: "尋找台灣精油代工廠？OXM 整理可承接精油、香氛產品代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣精油代工廠資訊，涵蓋精油與香氛產品代工需求，可依地區查看相關工廠並直接詢價。",
  },
  "lighting-fixtures": {
    h1: "燈具代工",
    title: "燈具代工｜台灣照明燈具廠商搜尋與詢價｜OXM",
    description: "尋找台灣燈具代工廠？OXM 整理可承接照明燈具、燈飾生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣燈具代工廠資訊，涵蓋照明燈具與燈飾生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "stationery-office-supplies": {
    h1: "文具代工",
    title: "文具代工｜台灣辦公用品廠商搜尋與詢價｜OXM",
    description: "尋找台灣文具代工廠？OXM 整理可承接文具、辦公用品生產需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣文具代工廠資訊，涵蓋文具與辦公用品生產需求，可依地區查看相關工廠並直接詢價。",
  },
  "outdoor-sports-goods": {
    h1: "運動用品代工",
    title: "運動用品代工｜台灣戶外用品廠商搜尋與詢價｜OXM",
    description: "尋找台灣運動用品代工廠？OXM 整理可承接運動用品、戶外用品生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣運動用品代工廠資訊，涵蓋運動用品與戶外用品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "pet-supplies": {
    h1: "寵物用品代工",
    title: "寵物用品代工｜台灣寵物商品廠商搜尋與詢價｜OXM",
    description: "尋找台灣寵物用品代工廠？OXM 整理可承接寵物用品、寵物商品生產需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    intro: "OXM 整理台灣寵物用品代工廠資訊，涵蓋寵物用品與寵物商品生產需求，可依地區查看相關工廠並直接詢價。",
  },
  "baby-products": {
    h1: "嬰幼兒用品代工",
    title: "嬰幼兒用品代工｜台灣嬰兒用品廠商搜尋與詢價｜OXM",
    description: "尋找台灣嬰幼兒用品代工廠？OXM 整理可承接嬰幼兒用品生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    intro: "OXM 整理台灣嬰幼兒用品代工廠資訊，涵蓋嬰幼兒用品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  "automation-production-line-equipment": {
    h1: "自動化設備廠商",
    title: "自動化設備廠商｜台灣產線設備搜尋與詢價｜OXM",
    description: "尋找台灣自動化設備廠商？OXM 整理可供應產線設備、自動化整合方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣自動化設備廠商資訊，涵蓋產線設備與自動化整合方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  "inspection-measurement-equipment": {
    h1: "檢測設備廠商",
    title: "檢測設備廠商｜台灣量測設備搜尋與詢價｜OXM",
    description: "尋找台灣檢測設備廠商？OXM 整理可供應檢測設備、量測儀器與品管設備的廠商，可依地區瀏覽相關供應商並直接詢價。",
    intro: "OXM 整理台灣檢測設備廠商資訊，涵蓋檢測與量測設備供應，可依地區瀏覽相關供應商並直接詢價。",
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

  it("除了三批共 40 筆，其餘全部 34 筆都沒有設定任何 override 欄位（本輪審核後刻意保留 fallback，不是遺漏）", () => {
    expect(nonOverriddenSlugs.length).toBe(34);
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

  it("industrial-machinery-equipment（沒有 override）同樣完全符合舊有固定公式", () => {
    const resolved = resolveSubIndustry("industrial-machinery-equipment")!;
    const content = buildSubIndustryPageContent(resolved);
    expect(content.h1).toBe("工業機械設備廠");
    expect(content.title).toBe("工業機械設備廠｜台灣工業機械設備廠搜尋與詢價｜OXM");
  });

  it("刻意保留 fallback 的 parent-aware collision 兩筆（plastic-packaging／packaging-plastic-materials）：cannibalization 風險高，本輪明確不做 override", () => {
    expect(resolveSubIndustry("plastic-packaging")!.entry.primarySeoKeyword).toBeUndefined();
    expect(resolveSubIndustry("packaging-plastic-materials")!.entry.primarySeoKeyword).toBeUndefined();
  });

  it("刻意保留 fallback 的 split-intent 案例：food-medical-silicone／coatings-adhesives／machinery-parts-maintenance／wood-products-crafts", () => {
    for (const slug of ["food-medical-silicone", "coatings-adhesives", "machinery-parts-maintenance", "wood-products-crafts"]) {
      expect(resolveSubIndustry(slug)!.entry.primarySeoKeyword).toBeUndefined();
    }
  });

  it("刻意保留 fallback 的 doorway／bundling 風險案例：general-printing／custom-merchandise-printing／professional-printing-technology", () => {
    for (const slug of ["general-printing", "custom-merchandise-printing", "professional-printing-technology"]) {
      expect(resolveSubIndustry(slug)!.entry.primarySeoKeyword).toBeUndefined();
    }
  });

  it("永續材料 7 筆本輪維持全部 fallback（GSC 已知訊號偏主產業層級，細項沒有足夠明確 B2B transactional intent，不為了完整性硬做）", () => {
    const sustainableSlugs = [
      "bioplastics", "starch-based-materials", "biodegradable-materials", "recycled-materials",
      "natural-fiber-materials", "biocomposite-materials", "compostable-materials",
    ];
    expect(sustainableSlugs.length).toBe(7);
    for (const slug of sustainableSlugs) {
      expect(resolveSubIndustry(slug)!.entry.primarySeoKeyword).toBeUndefined();
    }
  });
});

describe("secondaryKeywords：純 SEO 研究資料，禁止任何形式直接 render 到前台", () => {
  it("40 個 override 頁都有設定 secondaryKeywords（SEO 策略資料存在，供文案研究參考）", () => {
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

  it("第三批 24 筆抽樣（跨紡織／金屬加工／塑膠／橡膠矽膠／木工／包裝／食品／化工製造／生活用品／工業設備機械）的地區版同樣不受影響", () => {
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "fabric-materials")!).h1).toBe("台中布料廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "welding-assembly")!).h1).toBe("台中焊接組裝廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "plastic-containers-bottles")!).h1).toBe("台中塑膠容器廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "rubber-silicone-seals")!).h1).toBe("台中橡膠矽膠密封件廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "furniture-making")!).h1).toBe("台中家具廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "protective-packaging")!).h1).toBe("台中緩衝包材廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "bakery-pastry")!).h1).toBe("台中烘焙糕點廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "cleaning-products")!).h1).toBe("台中清潔用品廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "baby-products")!).h1).toBe("台中嬰幼兒用品廠");
    expect(buildRegionSubIndustryPageContent(resolveRegionSubIndustry("taichung", "automation-production-line-equipment")!).h1).toBe("台中自動化產線設備廠");
  });
});

describe("shared/constants.ts：SubIndustrySearchEntry 的 SEO 欄位是唯一 source，沒有第二份 slug 對照表", () => {
  it("40 個 override 頁的 key 都是既有 canonical slug（沒有另外新增 key 命名法）", () => {
    for (const slug of OVERRIDDEN_SLUGS) {
      expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug]).toBeDefined();
      expect(SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug].slug).toBe(slug);
    }
  });

  it("SubIndustrySearchEntry 陣列總筆數是 74（電子零件「線束 / 連接器」拆分為 wire-cable／wire-harness-assembly／connector-terminal 三筆，見任務定案「線束 / 連接器拆分為三類」，淨增 2 筆）", () => {
    expect(SUB_INDUSTRY_SEARCH_ENTRIES.length).toBe(74);
  });

  it("OVERRIDDEN_SLUGS 精確等於 40 筆（14 筆既有 + 本輪新增 24 筆 + 拆分子分類新增 2 筆），沒有重複也沒有遺漏", () => {
    expect(OVERRIDDEN_SLUGS.length).toBe(40);
    expect(new Set(OVERRIDDEN_SLUGS).size).toBe(40);
  });

  it("pcb 明確沒有被加進 OVERRIDDEN_SLUGS（本輪暫緩）", () => {
    expect(OVERRIDDEN_SLUGS).not.toContain("pcb");
  });
});
