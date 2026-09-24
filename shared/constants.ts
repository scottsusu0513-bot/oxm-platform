// ===== 產業分類（含小分類）=====
export const INDUSTRIES = [
  {
    name: "紡織",
    sub: ["布料 / 面料", "服飾 / 成衣", "織帶 / 線材", "毛巾 / 家用織品", "功能性紡織品", "染整 / 後加工", "其他"],
  },
  {
    name: "金屬加工",
    sub: ["CNC加工 / 精密加工", "鈑金加工", "焊接 / 組裝", "模具製造", "金工飾品 / 金屬設計", "金屬原料", "沖壓 / 金屬成型", "表面處理", "其他"],
  },
  {
    name: "電子零件",
    sub: ["PCB / 電路板", "電子組裝 / SMT", "線材 / 電纜", "線束 / 線組加工", "連接器 / 端子", "感測器 / 模組", "半導體封裝", "照明模組 / 工業照明", "其他"],
  },
  {
    name: "塑膠",
    sub: ["塑膠外殼 / 零件", "塑膠容器 / 瓶罐", "塑膠管材 / 板材", "塑膠包裝", "發泡塑膠", "客製塑膠製品", "射出成型", "擠出成型", "吹塑成型", "其他"],
  },
  {
    name: "橡膠 / 矽膠",
    sub: ["橡膠 / 矽膠密封件", "工業橡膠 / 矽膠製品", "PU製品（聚氨酯）", "食品 / 醫療級矽膠", "高精密矽膠（LSR）", "客製橡膠 / 矽膠製品", "其他"],
  },
  {
    name: "木工",
    sub: ["家具製作", "木製品 / 工藝品", "建材 / 裝潢材料", "竹製品", "其他"],
  },
  {
    name: "包裝",
    sub: ["紙盒 / 紙袋", "塑膠包裝", "環保包裝", "禮盒 / 特殊包裝", "緩衝包材", "瓦楞紙箱 / 紙箱", "其他"],
  },
  {
    name: "食品",
    sub: ["烘焙 / 糕點", "飲料 / 飲品", "冷凍食品", "零食 / 點心", "調味料 / 醬料", "調理食品 / 即食食品", "保健食品 / 機能食品", "其他"],
  },
  {
    name: "化工製造",
    sub: ["清潔用品", "塗料 / 黏著劑", "保養品 / 化妝品原料", "香氛 / 精油", "工業化學品", "其他"],
  },
  {
    name: "生活用品",
    sub: ["家居用品", "照明燈具", "文具 / 辦公用品", "戶外 / 運動用品", "寵物用品", "嬰幼兒用品", "其他"],
  },
  {
    name: "印刷",
    sub: ["展場 / 大圖輸出（立牌、背板、布條）", "貼紙 / 標籤（商品貼紙、LOGO貼）", "包裝印刷（彩盒、紙盒、包裝袋）", "一般印刷（名片、DM、型錄）", "商品周邊印刷（客製商品、品牌周邊、布料印刷）", "專業印刷技術（平版 / 數位 / 網版）", "其他"],
  },
  {
    name: "工業設備／機械",
    sub: ["工業機械設備", "自動化／產線設備", "產業專用機械", "檢測／量測設備", "機械零件／維修保養", "其他"],
  },
  {
    name: "永續材料",
    sub: ["生質塑膠", "全澱粉基材料", "生物可分解材料", "再生材料", "天然纖維材料", "生質複合材料", "可堆肥材料", "其他"],
  },
] as const;

export const INDUSTRY_OPTIONS = INDUSTRIES.map(i => i.name) as unknown as readonly string[];
export type Industry = (typeof INDUSTRIES)[number]["name"];

// ===== 工廠能力（跨產業通用，自由複選）=====
export const CAPABILITIES = [
  "提供模具開發",
  "提供打樣",
  "可小量生產",
  "可大量生產",
  "可客製化",
  "可代工包裝",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// ===== 代工模式 =====
export const MFG_MODE_OPTIONS = ["ODM", "OEM", "OBM"] as const;
export type MfgMode = (typeof MFG_MODE_OPTIONS)[number];

// ===== 台灣縣市 =====
export const TAIWAN_REGIONS = [
  "基隆市", "台北市", "新北市", "宜蘭縣",
  "桃園市", "新竹市", "新竹縣",
  "苗栗縣", "台中市", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "台南市",
  "高雄市", "屏東縣",
  "花蓮縣", "台東縣",
  "澎湖縣", "金門縣", "連江縣",
] as const;
export type TaiwanRegion = (typeof TAIWAN_REGIONS)[number];

// ===== 縣市 SEO Slug 對照表（見「地區 × 主產業 SEO Landing Page」需求定案）=====
// 與 INDUSTRY_SLUGS 同一種角色：固定、明確列出的 canonical mapping，唯一
// source of truth，不得由其他地方各自推導或重新拼字。新增/修改前必須先確認
// TAIWAN_REGIONS 沒有變動——REGION_SLUGS 的 key 必須與 TAIWAN_REGIONS 完全
// 一一對應（見 server/regionIndustrySeo.test.ts 的 22/22 覆蓋率測試）。
export const REGION_SLUGS: Record<string, string> = {
  "台北市": "taipei",
  "新北市": "new-taipei",
  "基隆市": "keelung",
  "桃園市": "taoyuan",
  "新竹市": "hsinchu-city",
  "新竹縣": "hsinchu-county",
  "苗栗縣": "miaoli",
  "台中市": "taichung",
  "彰化縣": "changhua",
  "南投縣": "nantou",
  "雲林縣": "yunlin",
  "嘉義市": "chiayi-city",
  "嘉義縣": "chiayi-county",
  "台南市": "tainan",
  "高雄市": "kaohsiung",
  "屏東縣": "pingtung",
  "宜蘭縣": "yilan",
  "花蓮縣": "hualien",
  "台東縣": "taitung",
  "澎湖縣": "penghu",
  "金門縣": "kinmen",
  "連江縣": "lienchiang",
};

export const REGION_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_SLUGS).map(([name, slug]) => [slug, name])
);

// SEO 文案顯示用地區名稱：拿掉「市／縣」尾綴（例如「台中市」→「台中」）。
// 只能用在標題／H1／描述等顯示文字，絕不可用於 DB 篩選或 factory.search 的
// region 參數——底層 filter 必須永遠使用 TAIWAN_REGIONS 的完整 canonical 值。
export const REGION_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  TAIWAN_REGIONS.map(name => [name, name.replace(/(市|縣)$/, "")])
);

// 鄰近縣市對照表（預設廣告覆蓋範圍）
export const ADJACENT_REGIONS: Record<string, string[]> = {
  "台北市": ["新北市", "基隆市"],
  "新北市": ["台北市", "基隆市", "桃園市", "宜蘭縣"],
  "桃園市": ["新北市", "新竹縣"],
  "台中市": ["彰化縣", "南投縣", "苗栗縣"],
  "台南市": ["高雄市", "嘉義縣"],
  "高雄市": ["台南市", "屏東縣"],
  "基隆市": ["台北市", "新北市"],
  "新竹市": ["新竹縣", "苗栗縣"],
  "嘉義市": ["嘉義縣", "雲林縣"],
  "新竹縣": ["新竹市", "桃園市", "苗栗縣"],
  "苗栗縣": ["新竹縣", "台中市"],
  "彰化縣": ["台中市", "南投縣", "雲林縣"],
  "南投縣": ["台中市", "彰化縣", "嘉義縣"],
  "雲林縣": ["彰化縣", "嘉義縣", "嘉義市"],
  "嘉義縣": ["雲林縣", "嘉義市", "台南市", "南投縣"],
  "屏東縣": ["高雄市", "台東縣"],
  "宜蘭縣": ["新北市", "花蓮縣"],
  "花蓮縣": ["宜蘭縣", "台東縣"],
  "台東縣": ["花蓮縣", "屏東縣"],
  "澎湖縣": [],
  "金門縣": [],
  "連江縣": [],
};

// ===== 資本額分級 =====
export const CAPITAL_OPTIONS = [
  "100萬以下",
  "100~500萬",
  "500~2000萬",
  "2000~5000萬",
  "5000萬以上",
] as const;
export type CapitalLevel = (typeof CAPITAL_OPTIONS)[number];

// ===== 評分範圍 =====
export const RATING_MIN = 1;
export const RATING_MAX = 5;

// ===== 產業 SEO Slug 對照表 =====
export const INDUSTRY_SLUGS: Record<string, string> = {
  "紡織": "textile",
  "金屬加工": "metal-processing",
  "電子零件": "electronics",
  "塑膠": "plastic",
  "橡膠 / 矽膠": "rubber-silicone",
  "木工": "woodworking",
  "包裝": "packaging",
  "食品": "food",
  "化工製造": "chemical-manufacturing",
  "生活用品": "consumer-goods",
  "印刷": "printing",
  "工業設備／機械": "industrial-machinery",
  "永續材料": "sustainable-materials",
};

// 每個 slug 對應一或多個主產業名稱。
// plastic-rubber（曾經同時對應塑膠與橡膠/矽膠的舊 slug）已改成 301 永久轉址
// 到 /industry/plastic（見 shared/seo/industryPages.ts 的
// resolveLegacyIndustrySlugRedirect），塑膠與橡膠/矽膠都已各自有獨立、正式
// 的 slug（plastic、rubber-silicone），這裡不再需要保留這個 legacy 別名。
export const INDUSTRY_SLUG_TO_NAMES: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, [name]])),
};
// 保留單值版本供其他地方使用（取第一個名稱）
export const INDUSTRY_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(INDUSTRY_SLUG_TO_NAMES).map(([slug, names]) => [slug, names[0]])
);

// ===== 產業頁 SEO 內容 =====
export const INDUSTRY_SEO_CONTENT: Record<string, { intro: string; applications: string; howToChoose: string }> = {
  "紡織": {
    intro: "台灣紡織代工產業擁有數十年發展歷史，從布料織造、成衣製作到功能性紡織品，形成完整的供應鏈體系。台灣紡織廠以精良的製程技術與嚴格的品質管控聞名，能配合客戶需求提供 OEM 代工或 ODM 自主設計服務，廣泛應用於運動服飾、戶外機能衣、職業制服及家用紡織品等領域。",
    applications: "台灣紡織代工常見應用包含：運動機能衣（吸濕排汗、防曬 UPF）、戶外防水外套、瑜伽及健身服飾、企業制服與工作服、毛巾浴袍等家用織品、醫療防護衣物，以及精品時裝 OEM 訂單。小量打樣至大量生產皆可配合，部分廠商具備快速翻單能力，適合電商與品牌新品開發。",
    howToChoose: "選擇紡織工廠時，建議優先確認以下幾點：工廠是否具備 OEKO-TEX、GOTS 等國際紡織認證；是否有環保染整製程；最低訂購量（MOQ）是否符合需求；樣品打板週期與正式交期；以及工廠是否有自有布料倉，可縮短備料時間。建議索取實體樣品，比對色差與縫工品質後再正式下單。",
  },
  "金屬加工": {
    intro: "台灣金屬加工產業以精密 CNC 加工、鈑金加工與模具製造為核心競爭力，廣布於桃竹苗與台中彰化等工業區。廠商普遍具備 ISO 9001 品質管理體系，能精準加工鋁合金、不鏽鋼、碳鋼及特殊合金等材料，公差控制達微米等級，提供從單件打樣到量產的一站式服務，是電子、汽機車、航太及醫療設備產業的關鍵供應商。",
    applications: "金屬加工代工常見應用包含：電子產品機殼與散熱模組、汽機車零組件與引擎周邊、工業設備機台零件、醫療器材不鏽鋼結構件、精密量治具、建築與室內設計金屬裝飾件、戶外廣告招牌鈑金件，以及客製化五金零件等。部分廠商亦提供表面處理（陽極、電鍍、烤漆）一條龍服務。",
    howToChoose: "選擇金屬加工廠時，應確認設備規格是否符合產品尺寸與公差需求；廠商是否具備材料進料檢驗（IQC）與出貨前量測報告；是否有 CMM 三次元量測儀等精密檢測設備；以及廠商對特殊材料（鈦合金、因瓦合金等）的加工經驗。建議提供完整 2D/3D 圖面，並要求報價前的 DFM（設計可製造性分析）評估。",
  },
  "電子零件": {
    intro: "台灣是全球電子製造重鎮，電子零件代工產業涵蓋 PCB 製造、SMT 電子組裝、線束連接器、感測器模組到半導體封裝測試。台灣電子廠商熟悉國際品牌規格要求，具備 IPC-A-610 等業界標準認證，能提供從設計驗證（DVT）、小量試產（EVT）到量產（MP）的完整支援，服務領域橫跨消費電子、工業控制、醫療電子與車用電子。",
    applications: "電子零件代工常見應用包含：IoT 物聯網裝置與模組、工業控制面板與 PLC 周邊、醫療監測設備電路板、車用 ECU 及感測器模組、智慧家電控制主板、穿戴裝置電子模組、LED 驅動電路與電源供應器，以及 RF 無線通訊模組等，適合新創品牌、ODM 設計公司與電子系統整合商尋找可靠製造夥伴。",
    howToChoose: "選擇電子零件工廠時，建議確認廠商是否具備 IPC-A-610 Class 2/3 組裝認證；是否有 AOI 自動光學檢測、X-Ray 及 ICT 線路測試設備；對微型化元件（如 01005 被動元件）的貼片能力；以及物料管理系統（避免假料）。此外，小量彈性代工的起訂門檻與報價透明度也是選擇關鍵。",
  },
  "塑膠": {
    intro: "台灣塑膠代工產業歷史悠久，射出成型、吹塑、押出等工廠遍布全台各工業區。廠商普遍具備自主模具開發能力，可依客戶 3D 圖面或樣品進行模具設計與試模，材料覆蓋 ABS、PP、PA、PC、TPU、HDPE 等各類工程塑膠，能配合食品級、阻燃、抗靜電等特殊規格，提供從模具開發、試模到大量生產的一站式服務。",
    applications: "塑膠代工常見應用包含：消費電子外殼與保護套、汽機車內外裝塑件、家電產品外觀件、食品接觸容器（PP、HDPE）、醫療器材外殼與耗材、工業設備零件、戶外休閒設備配件，以及各類客製化塑膠射出、吹塑、吸塑成品等。",
    howToChoose: "選擇塑膠工廠時，應確認廠商的模具製作經驗與試模週期；是否提供材料規格書（SDS）及符合 RoHS、REACH 等法規的材料選用；廠商是否具備短射、縮水、翹曲等瑕疵改善能力；以及後加工服務（噴漆、烤漆、二次成型）是否一站提供。建議要求試模樣品做尺寸與外觀確認後再批量生產。",
  },
  "橡膠 / 矽膠": {
    intro: "台灣橡膠與矽膠代工產業具備精密成型與材料應用技術，涵蓋工業橡膠密封件、液態矽膠（LSR）精密射出、食品醫療級矽膠製品等多元領域。廠商熟悉 NBR、EPDM、Silicone、LSR 等各類彈性體材料特性，能依客戶需求設計模具並提供認證測試支援，廣泛服務汽車、電子、醫療、食品等高規格產業。",
    applications: "橡膠矽膠代工常見應用包含：工業 O-Ring 與客製密封件、汽車橡膠零件與防震元件、液態矽膠（LSR）精密射出件、食品級矽膠廚具與嬰兒用品、醫療耗材與矽膠導管、電子設備防水密封條，以及高精密 LSR 光學與感測元件等。",
    howToChoose: "選擇橡膠矽膠工廠時，應確認廠商熟悉的材料種類與硬度範圍（Shore A）；是否具備 LSR 液態矽膠射出設備；食品醫療級製品是否通過 FDA、LFGB 等認證；模具精度與試模週期是否合理；以及是否提供材料規格書（SDS）與物性測試報告。建議提供完整圖面並索取樣品確認後再量產。",
  },
  "木工": {
    intro: "台灣木工代工產業以精緻手工藝與現代 CNC 加工技術並存著稱，從實木家具、木製工藝品、竹製品到建築裝潢材料，廠商普遍具備優異的榫接、烤漆與表面塗裝工藝。部分廠商提供 FSC 認證木材來源，符合國際環保採購要求，能配合客製化尺寸、木種選用與表面處理，服務範圍涵蓋室內設計、家具品牌代工及禮品訂製等。",
    applications: "木工代工常見應用包含：實木餐桌椅與收納家具、室內木作裝潢（門片、木格柵、天花板）、竹製環保餐具與容器、木製禮品與紀念品、辦公室傢俱 OEM 訂單、展覽道具與陳設佈景、玩具與兒童傢俱，以及客製化木製包裝盒等，適合品牌商、室內設計師與電商通路尋找製造夥伴。",
    howToChoose: "選擇木工工廠時，應確認廠商使用的木材來源是否符合 FSC 或 PEFC 永續認證；廠商對木材含水率的管控能力（影響產品尺寸穩定性）；表面塗裝（水性漆、UV 漆、油蠟）的選擇彈性；以及榫接或五金接合的結構強度測試報告。建議索取 1:1 實物樣品進行外觀與結構確認。",
  },
  "包裝": {
    intro: "台灣包裝代工產業供應鏈完整，涵蓋紙盒、紙袋、塑膠容器、環保包材、特殊禮盒與緩衝包材等多元品項。廠商多具備自有印刷產線，能提供設計稿到成品的一站式服務，且因應全球環保趨勢，環保材質（再生紙、PLA 生物基塑膠）及減塑包裝方案已成主流選項，適合食品、美妝、電子及零售業的品牌包裝需求。",
    applications: "包裝代工常見應用包含：食品禮盒與伴手禮包裝、美妝保養品外盒與提袋、電商商品紙箱與緩衝包材、3C 產品天地蓋盒、飲料容器與瓶蓋、藥品與醫療器材 PTP 泡殼、農產品標籤貼紙，以及展覽活動特殊造型包裝等，部分廠商提供小量客製起印（數位印刷），適合新品試銷與品牌活動限定版。",
    howToChoose: "選擇包裝工廠時，應確認廠商是否有平版印刷、數位印刷、絲印等多種印刷能力；是否具備打凸、燙金、局部 UV 等後加工工藝；環保材質的取得與認證（FSC、PCW 再生含量）；以及小量打樣的起印量與費用。建議請廠商提供色彩打樣（Proof）確認印刷色差後再量產。",
  },
  "食品": {
    intro: "台灣食品代工產業在衛生管理與製程技術上達到國際水準，多數廠商通過 HACCP、ISO 22000 或 SQF 食品安全認證，能提供烘焙、飲料、冷凍食品、零食及調味料等多類食品的 OEM 代工服務。台灣食品廠的優勢在於研發能力強、能配合品牌商進行配方調整與口味開發，且對兩岸三地及東南亞出口的法規要求相當熟悉。",
    applications: "食品代工常見應用包含：伴手禮糕點（鳳梨酥、太陽餅）、機能飲料與茶飲 OEM、氮氣充填零食與堅果包裝、冷凍調理食品（水餃、湯圓）、調味醬料與沾醬、寵物食品代工、健康補給品（膠囊、錠劑）OEM，以及品牌超市自有品牌（Private Label）食品代工，適合電商品牌、連鎖餐飲與零售通路。",
    howToChoose: "選擇食品工廠時，最重要的是確認廠商持有的食品安全認證（HACCP、ISO 22000）；是否具備符合產品需求的潔淨室或溫控倉儲環境；配方研發的保密協議（NDA）是否完善；以及最低訂購量、保存期限與包材提供方式。建議先進行小量試製，確認口感、外觀與保存測試後再量產。",
  },
  "化工製造": {
    intro: "台灣化工製造代工產業具備精細化工、日用化學品與特用化學品的完整研發生產能力，涵蓋清潔用品、塗料黏著劑、保養品原料、香氛精油及工業化學品等。廠商多具備 ISO 9001 及 GMP 生產認證，能依客戶配方或自主研發提供 OEM 服務，並協助完成 MSDS/SDS、成分申報及進出口化學品法規文件，適合品牌商、通路商及工業用戶尋找穩定的化工製造夥伴。",
    applications: "化工製造代工常見應用包含：家用清潔劑（洗碗精、浴廁清潔）、工業級切削液與防鏽油、UV 固化塗料與水性漆、美妝保養品（乳液、精華液、洗髮精）OEM、天然植物精油萃取與香氛產品、食品工業用酵素與添加物，以及電子清洗劑與精密工業用化學品等，部分廠商提供白牌供貨，適合品牌快速上市。",
    howToChoose: "選擇化工製造工廠時，應確認廠商是否具備合法化學品製造工廠登記；是否有 ISO 9001 或 GMP 認證；配方保密機制是否完善；廢水處理與環保合規記錄是否良好；以及 SDS（安全資料表）出具能力。建議優先選擇有出口經驗的廠商，確保產品符合目標市場的化學品法規。",
  },
  "生活用品": {
    intro: "台灣生活用品代工產業提供多元的消費性產品製造服務，包含家居用品、文具辦公用品、戶外運動器材、寵物用品及嬰幼兒產品等。廠商普遍具備快速打樣能力與彈性小量生產機制，能配合品牌商的設計圖或樣品進行開模打樣，材料覆蓋塑膠、金屬、布料、矽膠等多種材質，並熟悉 CE、EN71 玩具安全、ASTM 等國際認證規範，適合電商、零售品牌及通路商尋找製造夥伴。",
    applications: "生活用品代工常見應用包含：居家收納整理用品、廚房料理工具、文具筆記本與辦公用品、瑜伽健身器材與戶外露營用品、寵物食碗玩具與外出包、嬰兒餐具浴具與玩具、旅行盥洗用品組，以及品牌商超市自有品牌（PB）生活雜貨等，適合快速上架電商或進駐大型通路的品牌商。",
    howToChoose: "選擇生活用品工廠時，應確認廠商是否具備目標市場認證（如歐盟 CE、美國 CPSC 兒童安全）；打樣週期與模具費用是否合理；小量訂購的彈性與價格梯度；以及廠商是否有完整的包裝設計與出貨整合能力。建議先進行市場測試打樣，確認銷售反應後再決定量產規模。",
  },
  "印刷": {
    intro: "台灣印刷代工產業技術成熟，涵蓋平版印刷（膠印）、數位印刷、網版印刷、標籤貼紙及包裝印刷等多種工藝，廠商設備新穎、色彩管理精準，能穩定重現 Pantone 專色與品牌色。加上後加工選項豐富（燙金、打凸、局部 UV、覆膜），能配合各種創意設計需求，並提供從設計稿審稿、色彩打樣（Proof）到交貨的全流程服務，廣受出版、品牌行銷與包裝產業採用。",
    applications: "印刷代工常見應用包含：企業型錄與產品說明書、精裝書籍與平裝書冊、品牌包裝紙盒與手提袋、防偽標籤與序號貼紙、展覽看板與大圖輸出、名片與文宣品、食品飲料標籤（耐水、耐油材質），以及客製化禮品印刷（馬克杯、T恤、手機殼）等，部分廠商提供小量數位印刷，適合個人與小企業客製需求。",
    howToChoose: "選擇印刷工廠時，應確認廠商是否具備 ISO 12647 印刷色彩認證；打樣費用與打樣週期是否合理；對特殊材質（金銀卡紙、PP 合成紙、不乾膠）的印刷經驗；後加工選項（燙金、模切、壓紋）的齊全程度；以及廠商是否有 CTP 直接製版設備，確保印刷精度。建議正式量產前務必確認色彩打樣與成品一致性。",
  },
  "工業設備／機械": {
    intro: "台灣工業設備與機械代工產業具備精密機械設計、自動化產線整合與客製化機台製造的完整能力，廠商遍布台中精密機械聚落、新竹科學園區周邊及高雄工業區，能提供標準型與非標準型工業設備的 OEM/ODM 服務，並支援機械零件維修與產線改善。台灣機械業長年深耕全球供應鏈，在半導體、PCB、汽車、食品及紡織等多元產業的製程設備領域均有深厚積累。",
    applications: "工業設備與機械代工常見應用包含：半導體與面板製程設備零組件、自動化搬運與輸送系統、工業機器手臂與夾治具、CCD 視覺檢測設備、產線自動化改善整合、農業與食品加工機械、紡織機械零件，以及各類非標準客製化機台等，廣泛服務製造業生產自動化升級與設備汰換需求。",
    howToChoose: "選擇工業設備與機械工廠時，應確認廠商的機械設計能力（是否有 SolidWorks/AutoCAD 工程師）；自動化整合的控制系統熟悉度（PLC、伺服、視覺）；對目標產業製程的理解深度；以及售後維修與備品供應的服務承諾。建議提供產線現況與改善目標，讓廠商評估整合方案後再進行規格確認。",
  },
  "永續材料": {
    intro: "台灣永續材料產業近年快速發展，涵蓋生質塑膠、全澱粉基材料、生物可分解材料、再生材料、天然纖維材料、生質複合材料與可堆肥材料等多元品項。廠商致力以植物基、回收再生或可分解原料取代傳統石化塑膠，協助品牌因應國際 ESG 與環保法規要求，適合追求永續轉型的品牌商、包裝廠與零售通路尋找替代材料供應夥伴。",
    applications: "永續材料常見應用包含：一次性餐具與外帶容器（生質塑膠、全澱粉基材料）、電商緩衝包材與環保袋（生物可分解材料、可堆肥材料）、服飾與家紡纖維（天然纖維材料）、3C 及日用品外殼（再生材料、生質複合材料）、農業與園藝資材，以及品牌永續系列商品開發等，適合推動減塑與碳中和目標的企業採購。",
    howToChoose: "選擇永續材料供應商時，應確認廠商是否具備國際認證（如 OK Compost、BPI 可堆肥認證、FSC 或 GRS 再生材料認證）；材料的分解條件（工業堆肥或家用堆肥）與實際耐用度是否符合產品使用情境；再生料的成分比例與一致性；以及是否能提供第三方檢測報告供品牌 ESG 揭露使用。建議先索取材料樣品進行實際應用測試，確認強度與外觀符合需求後再量產。",
  },
};

// ===== 子產業 SEO Slug 對照表（Phase 1）=====
// Key: "industrySlug/subSlug"，Value 必須完全對應 INDUSTRIES[n].sub[m] 的中文值（API 查詢需完全一致）
export const SUB_INDUSTRY_SLUG_TO_NAME: Record<string, string> = {
  "metal-processing/cnc-machining":        "CNC加工 / 精密加工",
  "metal-processing/sheet-metal":          "鈑金加工",
  "metal-processing/mold-making":          "模具製造",
  "metal-processing/metal-materials":      "金屬原料",
  "plastic/plastic-injection":             "塑膠外殼 / 零件",
  "electronics/pcb":                       "PCB / 電路板",
  "electronics/smt-assembly":              "電子組裝 / SMT",
  "printing/packaging-print":              "包裝印刷（彩盒、紙盒、包裝袋）",
  "printing/sticker-label":                "貼紙 / 標籤（商品貼紙、LOGO貼）",
  "chemical-manufacturing/cosmetic-odm":   "保養品 / 化妝品原料",
  "food/beverage-oem":                     "飲料 / 飲品",
  "packaging/eco-packaging":               "環保包裝",
  "textile/apparel-manufacturing":         "服飾 / 成衣",
};

// 供 sitemap.xml 使用
export const PHASE1_SUB_INDUSTRY_PAGES = Object.keys(SUB_INDUSTRY_SLUG_TO_NAME).map(key => {
  const idx = key.indexOf("/");
  return { industrySlug: key.slice(0, idx), subSlug: key.slice(idx + 1) };
});

// ===== 子產業「搜尋」SEO Slug 對照表（/factories/:subIndustrySlug 與
// /factories/:regionSlug/:subIndustrySlug，見「子產業 SEO 完整化」任務定案）=====
//
// 這是跟上面 SUB_INDUSTRY_SLUG_TO_NAME（Phase 1，服務 /industry/:slug/:sub
// 傳產圖書館長文頁、只收 13 筆代表性子產業、key 用 "industrySlug/subSlug"
// 複合字串）完全不同的另一組 canonical slug——本表服務的是以真實 factory
// 搜尋結果為核心、用工廠數當 indexing 閘門的 /factories/* 搜尋 landing
// page，涵蓋 INDUSTRIES 底下「除了『其他』」的每一筆 (主產業, 子產業)
// 組合，slug 是「全台單一扁平命名空間」（URL 只有一段，不像 Phase 1 用
// industrySlug 當前綴），所以每個 slug 必須在全部子產業之間唯一，也不能跟
// 13 個主產業 slug（INDUSTRY_SLUGS 的值）撞名——見
// server/subIndustrySearchSlugs.test.ts 的完整覆蓋率／唯一性測試。
//
// 「其他」在全部 13 個主產業底下都存在（逐字重複 13 次），語意上不是一個
// 可獨立索引的具體子產業，且 DB 篩選（JSON_CONTAINS 比對 factories.subIndustry
// 這個純字串陣列欄位）無法從資料本身分辨這家工廠選的「其他」屬於哪個主
// 產業，因此刻意不建 SEO 頁（使用者仍可在 /search 手動篩選到），不在這張表
// 裡出現。
//
// 「塑膠包裝」同時是「塑膠」與「包裝」兩個主產業底下的子產業（資料設計上
// 本來就允許同名子產業存在於不同主產業，不是資料錯誤）——這裡刻意保留兩筆
// 各自獨立的 entry、各自唯一的 slug（plastic-packaging／
// packaging-plastic-materials），不合併、不刪除任何一筆，label 都維持
// 「塑膠包裝」，靠 parentIndustry／breadcrumb／intro 文字的語境與各自獨立
// 的 canonical URL 區分，不是靠 slug 語意本身區分（見對話中「parent-aware
// unique slug」定案）。
export interface SubIndustrySearchEntry {
  /** 全台唯一，供 /factories/:slug 與 /factories/:region/:slug 使用。 */
  slug: string;
  /** INDUSTRIES[n].sub 的原始中文值，可能有多筆 entry 共用同一個 label（塑膠包裝）——
   *  DB 篩選（factory.search 的 subIndustry 參數）一律用這個完整值，不可用 displayName。 */
  label: string;
  /** SEO title／H1／breadcrumb 用的簡短顯示名稱（人工簡化，拿掉「/」「（）」等
   *  複合寫法，避免 H1 出現「XX / YY廠」這種不自然的標題），純顯示用途，
   *  絕不可用於 DB 篩選或 /search 的 subIndustry 參數。 */
  displayName: string;
  /** INDUSTRIES[n].name，一定是 INDUSTRY_OPTIONS 裡的合法值。 */
  parentIndustry: string;
  /** INDUSTRY_SLUGS[parentIndustry]，一定是既有 13 個主產業 slug 之一。 */
  parentIndustrySlug: string;

  // ===== SEO keyword mapping（選填，見任務定案「子產業 SEO Keyword Mapping
  // 基礎架構」）=====
  // 這五個欄位是唯一的 SEO 設定層：以這個 entry 的 canonical slug 為唯一
  // key（entry 本身），不建第二份 slug 對照表。shared/seo/subIndustryPages.ts
  // 的 buildSubIndustryPageContent() 在算 title／description／H1／intro 時，
  // 優先讀這裡的 override，沒有設定就 fallback 沿用既有固定 template——
  // 目前共 38 個子產業有值：第一批 6 筆（cnc-machining／sheet-metal／
  // smt-assembly／plastic-injection／packaging-print／cosmetic-odm）+
  // 第二批 8 筆（apparel-manufacturing／mold-making／metal-materials／
  // eco-packaging／beverage-oem／frozen-food／large-format-printing／
  // sticker-label）+ 第三批 24 筆（剩餘 58 筆全量審核後，通過 confidence／
  // cannibalization／doorway 三項把關的子產業，見任務定案「剩餘 Sub-industry
  // SEO Mapping 全量審核」）。pcb 本輪重新審核後仍無法高信心確定單一
  // primary，維持 fallback；其餘 34 筆因 confidence 低、split-intent、
  // cannibalization 風險高或屬 informational intent，同樣維持 fallback。
  // 其餘 34 筆（本輪之前的 72 筆總數）維持 undefined，頁面輸出完全不變。
  // 本輪（taxonomy 調整：紡織/金屬加工/塑膠/包裝/食品新增 9 個子分類，見對話
  // 中「OXM taxonomy 本輪調整」）新增的 9 筆 entry 同樣刻意不設定 SEO
  // override（沿用 fallback template），SEO 文案屬於獨立的編輯決策，不因為
  // taxonomy 結構調整就自動生成——現在總數是 74+9=83 個子產業，38 筆有值、
  // 45 筆（83-38）維持 undefined。
  //
  // 極重要的前台限制（見任務定案「正式站視覺限制」）：primarySeoKeyword／
  // secondaryKeywords 純粹是 SEO 研究資料（判斷 title/H1/description 怎麼
  // 下的依據），secondaryKeywords 尤其絕對禁止被任何元件直接 render 成
  // 前台可見的 keyword chips／tags／熱門搜尋詞／關鍵字牆——目前唯一合法的
  // 消費者只有 shared/seo/subIndustryPages.ts 的內容產生函式，且只會用來
  // 決定 h1（primarySeoKeyword 有值時取代預設的「{displayName}廠」），不會
  // 把 secondaryKeywords 本身輸出到任何畫面或 meta 標籤。

  /** 主要 SEO 關鍵字，例如「CNC 加工廠」。有值時取代預設 h1 公式
   *  （`${displayName}廠`），沒有其他用途（不影響 DB 篩選、不影響 slug）。 */
  primarySeoKeyword?: string;
  /** 次要 keyword cluster，純 SEO 策略研究資料——只給人／未來 SEO 工具參考
   *  怎麼寫文案，程式碼裡任何地方都不得把這個陣列直接 render 成前台可見的
   *  文字、清單、標籤或 badge。 */
  secondaryKeywords?: string[];
  /** 覆寫預設 title 公式；未設定則 fallback 沿用既有固定 template。 */
  seoTitleOverride?: string;
  /** 覆寫預設 meta description；未設定則 fallback。 */
  metaDescriptionOverride?: string;
  /** 覆寫預設 intro（H1 正下方那段簡短文字）；未設定則 fallback。 */
  seoIntroOverride?: string;
}

export const SUB_INDUSTRY_SEARCH_ENTRIES: SubIndustrySearchEntry[] = [
  // 紡織
  {
    slug: "fabric-materials", label: "布料 / 面料", displayName: "布料",
    parentIndustry: "紡織", parentIndustrySlug: "textile",
    primarySeoKeyword: "布料供應商",
    secondaryKeywords: ["布料工廠", "布料批發", "面料供應商", "機能布料供應商"],
    seoTitleOverride: "布料供應商｜台灣布料工廠搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣布料供應商？OXM 整理可供應各式布料、面料與機能布料的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣布料供應商資訊，涵蓋一般布料與面料來源，可依地區瀏覽相關供應商並直接詢價。",
  },
  {
    slug: "apparel-manufacturing", label: "服飾 / 成衣", displayName: "成衣",
    parentIndustry: "紡織", parentIndustrySlug: "textile",
    primarySeoKeyword: "成衣代工",
    secondaryKeywords: ["成衣代工廠", "服飾代工", "服裝OEM", "ODM成衣", "成衣製造"],
    seoTitleOverride: "成衣代工｜台灣成衣代工廠搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣成衣代工廠？OXM 整理可承接成衣 OEM／ODM 訂單的製造業者，可依地區、代工模式、可接小量與可打樣等條件篩選與詢價。",
    seoIntroOverride: "成衣代工是紡織產業的重要製造服務。OXM 整理台灣可承接成衣代工、OEM／ODM 生產需求的工廠，可依地區與生產條件篩選並直接詢價。",
  },
  { slug: "webbing-yarn", label: "織帶 / 線材", displayName: "織帶", parentIndustry: "紡織", parentIndustrySlug: "textile" },
  { slug: "towel-home-textiles", label: "毛巾 / 家用織品", displayName: "家用織品", parentIndustry: "紡織", parentIndustrySlug: "textile" },
  {
    slug: "functional-textiles", label: "功能性紡織品", displayName: "功能性紡織品",
    parentIndustry: "紡織", parentIndustrySlug: "textile",
    primarySeoKeyword: "機能布料代工",
    secondaryKeywords: ["機能性紡織品", "機能布代工", "機能布廠商", "機能布料廠"],
    seoTitleOverride: "機能布料代工｜台灣機能性紡織品廠商｜OXM",
    metaDescriptionOverride: "尋找台灣機能布料代工廠？OXM 整理可承接機能性紡織品需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣機能布料代工廠資訊，涵蓋機能性紡織品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  { slug: "dyeing-finishing", label: "染整 / 後加工", displayName: "染整後加工", parentIndustry: "紡織", parentIndustrySlug: "textile" },
  // 金屬加工
  {
    slug: "cnc-machining", label: "CNC加工 / 精密加工", displayName: "CNC加工",
    parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing",
    primarySeoKeyword: "CNC 加工廠",
    secondaryKeywords: ["CNC 加工", "CNC 代工", "CNC 代工廠", "CNC 小量代工", "CNC 零件代工", "CNC 精密加工", "五軸加工代工"],
    seoTitleOverride: "CNC 加工廠｜台灣 CNC 代工與精密零件工廠｜OXM",
    metaDescriptionOverride: "尋找台灣 CNC 加工廠？OXM 整理可承接 CNC 代工、精密零件加工與小量試作需求的工廠與工作室，並可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "CNC 加工是金屬加工底下的重要子產業。OXM 整理台灣可承接 CNC 代工與精密零件加工需求的工廠，可依地區與生產條件進一步篩選，直接送出詢價。",
  },
  {
    slug: "sheet-metal", label: "鈑金加工", displayName: "鈑金加工",
    parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing",
    primarySeoKeyword: "鈑金加工廠",
    secondaryKeywords: ["鈑金加工", "鈑金代工", "金屬鈑金加工", "鈑金製造"],
    seoTitleOverride: "鈑金加工廠｜台灣鈑金代工、金屬製造廠商資訊｜OXM",
    metaDescriptionOverride: "尋找台灣鈑金加工廠？OXM 整理可承接鈑金代工與金屬鈑金製造需求的工廠，可依地區、代工模式、可接小量與可打樣等條件進一步篩選並直接詢價。",
    seoIntroOverride: "鈑金加工是金屬加工底下的子產業，涵蓋鈑金代工與金屬製造需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  {
    slug: "welding-assembly", label: "焊接 / 組裝", displayName: "焊接組裝",
    parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing",
    primarySeoKeyword: "焊接加工",
    secondaryKeywords: ["焊接代工", "焊接加工廠", "金屬焊接代工", "焊接廠商"],
    seoTitleOverride: "焊接加工｜台灣焊接代工廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣焊接加工廠？OXM 整理可承接焊接代工、金屬組裝需求的廠商，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣焊接加工廠資訊，涵蓋焊接代工與金屬組裝需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  {
    slug: "mold-making", label: "模具製造", displayName: "模具",
    parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing",
    primarySeoKeyword: "模具廠",
    secondaryKeywords: ["模具製造", "模具加工", "模具開發", "開模", "塑膠模具", "沖壓模具"],
    seoTitleOverride: "模具廠｜台灣模具製造與加工廠商｜OXM",
    metaDescriptionOverride: "尋找台灣模具廠？OXM 整理可承接模具製造、加工、開發與開模需求的廠商，涵蓋塑膠模具、沖壓模具等類型，可依地區與生產條件篩選詢價。",
    seoIntroOverride: "OXM 整理台灣模具廠與模具製造廠商資訊，涵蓋塑膠模具、沖壓模具、模具加工與開模需求，可依地區與生產條件篩選並直接詢價。",
  },
  { slug: "metal-craft-design", label: "金工飾品 / 金屬設計", displayName: "金工飾品", parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing" },
  {
    slug: "metal-materials", label: "金屬原料", displayName: "金屬原料",
    parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing",
    primarySeoKeyword: "金屬材料供應商",
    secondaryKeywords: ["金屬原料", "金屬材料", "金屬原料供應商", "不鏽鋼材料", "鋁材供應商"],
    seoTitleOverride: "金屬材料供應商｜台灣金屬原料廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣金屬材料供應商？OXM 整理不鏽鋼、鋁材與其他金屬原料供應廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣金屬材料與原料供應商資訊，涵蓋不鏽鋼、鋁材等材料來源，可依地區瀏覽相關供應商並直接詢價。",
  },
  { slug: "metal-stamping-forming", label: "沖壓 / 金屬成型", displayName: "沖壓成型", parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing" },
  { slug: "surface-treatment", label: "表面處理", displayName: "表面處理", parentIndustry: "金屬加工", parentIndustrySlug: "metal-processing" },
  // 電子零件
  { slug: "pcb", label: "PCB / 電路板", displayName: "PCB", parentIndustry: "電子零件", parentIndustrySlug: "electronics" },
  {
    slug: "smt-assembly", label: "電子組裝 / SMT", displayName: "SMT電子組裝",
    parentIndustry: "電子零件", parentIndustrySlug: "electronics",
    primarySeoKeyword: "SMT 代工",
    secondaryKeywords: ["SMT 加工", "SMT 打件", "SMT 貼片", "電子組裝代工", "SMT 廠商"],
    seoTitleOverride: "SMT 代工｜台灣 SMT 貼片與電子組裝廠商｜OXM",
    metaDescriptionOverride: "尋找台灣 SMT 代工廠？OXM 整理可承接 SMT 貼片、打件與電子組裝需求的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "SMT 代工是電子零件底下的子產業，涵蓋貼片與電子組裝服務。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  // 電子零件／線束 / 連接器 拆分（見任務定案「線束 / 連接器拆分為三類」）：
  // 舊 slug wire-harness-connectors 混合了線材、線束組裝、連接器端子三種不同
  // 能力，拆成以下三筆獨立 entry；舊 slug 不再是可選子分類，改由
  // shared/seo/subIndustryPages.ts 的 resolveSplitSubIndustryNotice() 接手，
  // 顯示過渡頁並連到這三筆新 entry（本表本身不再收舊 slug）。
  {
    slug: "wire-cable", label: "線材 / 電纜", displayName: "線材電纜",
    parentIndustry: "電子零件", parentIndustrySlug: "electronics",
    primarySeoKeyword: "電子線材工廠",
    secondaryKeywords: ["電子線材", "電源線工廠", "訊號線工廠", "同軸線材", "排線加工", "線材代工"],
    seoTitleOverride: "電子線材工廠｜台灣電源線、訊號線與線材代工廠商｜OXM",
    metaDescriptionOverride: "尋找台灣電子線材工廠？OXM 整理可承接電源線、訊號線、同軸線、排線等線材代工需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "線材／電纜是電子零件底下的子產業，涵蓋電源線、訊號線、同軸線、排線等各類線材本體製造。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  {
    slug: "wire-harness-assembly", label: "線束 / 線組加工", displayName: "線束加工",
    parentIndustry: "電子零件", parentIndustrySlug: "electronics",
    primarySeoKeyword: "線束加工廠",
    secondaryKeywords: ["線束加工", "線束代工", "Wire Harness", "Cable Assembly", "端子壓接", "客製線組加工"],
    seoTitleOverride: "線束加工廠｜台灣線束代工與線組加工廠商｜OXM",
    metaDescriptionOverride: "尋找台灣線束加工廠？OXM 整理可承接裁線、剝皮、端子壓接、客製線組組裝需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "線束／線組加工是電子零件底下的子產業，涵蓋 Wire Harness、Cable Assembly 等線組組裝需求。OXM 整理台灣相關工廠資訊，可依地區篩選並直接詢價。",
  },
  {
    slug: "connector-terminal", label: "連接器 / 端子", displayName: "連接器端子",
    parentIndustry: "電子零件", parentIndustrySlug: "electronics",
    primarySeoKeyword: "連接器工廠",
    secondaryKeywords: ["連接器製造", "端子製造", "接插件工廠", "接頭代工", "插座製造"],
    seoTitleOverride: "連接器工廠｜台灣連接器與端子製造廠商｜OXM",
    metaDescriptionOverride: "尋找台灣連接器工廠？OXM 整理可承接連接器、端子、接插件與插座製造需求的廠商，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "連接器／端子是電子零件底下的子產業，涵蓋 Connector、Terminal 等接插件與插座製造需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  { slug: "sensors-modules", label: "感測器 / 模組", displayName: "感測器模組", parentIndustry: "電子零件", parentIndustrySlug: "electronics" },
  { slug: "semiconductor-packaging", label: "半導體封裝", displayName: "半導體封裝", parentIndustry: "電子零件", parentIndustrySlug: "electronics" },
  {
    slug: "lighting-modules", label: "照明模組 / 工業照明", displayName: "工業照明",
    parentIndustry: "電子零件", parentIndustrySlug: "electronics",
    primarySeoKeyword: "LED照明代工",
    secondaryKeywords: ["照明模組代工", "工業照明代工", "LED模組OEM", "照明控制模組"],
    seoTitleOverride: "LED照明代工｜台灣照明模組廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣LED照明代工廠？OXM 整理可承接照明模組、工業照明需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣LED照明代工廠資訊，涵蓋照明模組與工業照明生產需求，可依地區查看相關工廠並直接詢價。",
  },
  // 塑膠
  {
    slug: "plastic-injection", label: "塑膠外殼 / 零件", displayName: "塑膠外殼",
    parentIndustry: "塑膠", parentIndustrySlug: "plastic",
    primarySeoKeyword: "塑膠射出代工",
    secondaryKeywords: ["塑膠射出", "塑膠射出工廠", "射出成型", "塑膠製品代工", "塑膠模具"],
    seoTitleOverride: "塑膠射出代工｜台灣射出成型與塑膠製品代工工廠｜OXM",
    metaDescriptionOverride: "尋找台灣塑膠射出代工廠？OXM 整理可承接射出成型、塑膠模具與塑膠製品代工需求的工廠，可依地區、代工模式等條件進一步篩選詢價。",
    seoIntroOverride: "塑膠射出代工是塑膠底下的子產業，涵蓋射出成型與塑膠製品需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  {
    slug: "plastic-containers-bottles", label: "塑膠容器 / 瓶罐", displayName: "塑膠容器",
    parentIndustry: "塑膠", parentIndustrySlug: "plastic",
    primarySeoKeyword: "塑膠容器代工",
    secondaryKeywords: ["塑膠瓶罐代工", "塑膠罐工廠", "塑膠瓶供應商", "吹塑成型代工"],
    seoTitleOverride: "塑膠容器代工｜台灣塑膠瓶罐廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣塑膠容器代工廠？OXM 整理可承接塑膠瓶罐、容器生產需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣塑膠容器代工廠資訊，涵蓋塑膠瓶罐與容器生產需求，可依地區查看相關工廠並直接詢價。",
  },
  {
    slug: "plastic-pipes-sheets", label: "塑膠管材 / 板材", displayName: "塑膠管材",
    parentIndustry: "塑膠", parentIndustrySlug: "plastic",
    primarySeoKeyword: "塑膠板材供應商",
    secondaryKeywords: ["塑膠管材廠商", "塑膠押出加工", "PVC板材供應商", "塑膠押出代工"],
    seoTitleOverride: "塑膠板材供應商｜台灣塑膠管材廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣塑膠板材供應商？OXM 整理可供應塑膠管材、板材與押出加工的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣塑膠板材與管材供應商資訊，涵蓋押出加工相關廠商，可依地區瀏覽相關供應商並直接詢價。",
  },
  { slug: "plastic-packaging", label: "塑膠包裝", displayName: "塑膠包裝", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  { slug: "foam-plastics", label: "發泡塑膠", displayName: "發泡塑膠", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  { slug: "custom-plastic-products", label: "客製塑膠製品", displayName: "客製塑膠", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  { slug: "injection-molding", label: "射出成型", displayName: "射出成型", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  { slug: "extrusion-molding", label: "擠出成型", displayName: "擠出成型", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  { slug: "blow-molding", label: "吹塑成型", displayName: "吹塑成型", parentIndustry: "塑膠", parentIndustrySlug: "plastic" },
  // 橡膠 / 矽膠
  {
    slug: "rubber-silicone-seals", label: "橡膠 / 矽膠密封件", displayName: "橡膠矽膠密封件",
    parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone",
    primarySeoKeyword: "橡膠密封件代工",
    secondaryKeywords: ["矽膠密封件廠商", "O-Ring代工", "密封圈代工", "油封代工"],
    seoTitleOverride: "橡膠密封件代工｜台灣O-Ring廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣橡膠密封件代工廠？OXM 整理可承接O-Ring、密封圈生產需求的廠商，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣橡膠密封件代工廠資訊，涵蓋O-Ring、密封圈生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  { slug: "industrial-rubber-silicone", label: "工業橡膠 / 矽膠製品", displayName: "工業橡膠矽膠", parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone" },
  {
    slug: "pu-products", label: "PU製品（聚氨酯）", displayName: "PU製品",
    parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone",
    primarySeoKeyword: "PU製品代工",
    secondaryKeywords: ["聚氨酯代工", "PU發泡代工", "PU零件代工", "聚氨酯製品廠"],
    seoTitleOverride: "PU製品代工｜台灣聚氨酯製品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣PU製品代工廠？OXM 整理可承接聚氨酯、PU發泡製品需求的廠商，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣PU製品代工廠資訊，涵蓋聚氨酯與PU發泡製品需求，可依地區查看相關工廠並直接詢價。",
  },
  { slug: "food-medical-silicone", label: "食品 / 醫療級矽膠", displayName: "食品醫療級矽膠", parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone" },
  { slug: "lsr-silicone", label: "高精密矽膠（LSR）", displayName: "LSR矽膠", parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone" },
  { slug: "custom-rubber-silicone", label: "客製橡膠 / 矽膠製品", displayName: "客製橡膠矽膠", parentIndustry: "橡膠 / 矽膠", parentIndustrySlug: "rubber-silicone" },
  // 木工
  {
    slug: "furniture-making", label: "家具製作", displayName: "家具",
    parentIndustry: "木工", parentIndustrySlug: "woodworking",
    primarySeoKeyword: "家具代工",
    secondaryKeywords: ["OEM家具工廠", "家具製造代工", "訂製家具工廠", "家具貼牌代工"],
    seoTitleOverride: "家具代工｜台灣OEM家具工廠搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣家具代工廠？OXM 整理可承接家具OEM、訂製生產需求的工廠，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣家具代工廠資訊，涵蓋家具OEM與訂製生產需求，可依地區查看相關工廠並直接詢價。",
  },
  { slug: "wood-products-crafts", label: "木製品 / 工藝品", displayName: "木製品", parentIndustry: "木工", parentIndustrySlug: "woodworking" },
  { slug: "building-decor-materials", label: "建材 / 裝潢材料", displayName: "建材裝潢", parentIndustry: "木工", parentIndustrySlug: "woodworking" },
  { slug: "bamboo-products", label: "竹製品", displayName: "竹製品", parentIndustry: "木工", parentIndustrySlug: "woodworking" },
  // 包裝
  { slug: "paper-boxes-bags", label: "紙盒 / 紙袋", displayName: "紙盒紙袋", parentIndustry: "包裝", parentIndustrySlug: "packaging" },
  { slug: "packaging-plastic-materials", label: "塑膠包裝", displayName: "塑膠包裝", parentIndustry: "包裝", parentIndustrySlug: "packaging" },
  {
    slug: "eco-packaging", label: "環保包裝", displayName: "環保包裝",
    parentIndustry: "包裝", parentIndustrySlug: "packaging",
    primarySeoKeyword: "環保包裝供應商",
    secondaryKeywords: ["環保包裝廠商", "環保包材", "環保包材供應商", "可分解包裝"],
    seoTitleOverride: "環保包裝供應商｜台灣環保包材廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣環保包裝供應商？OXM 整理可供應環保包材、可分解包裝與相關包裝方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣環保包裝與包材供應商資訊，涵蓋環保包材、可分解包裝等方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  {
    slug: "gift-specialty-packaging", label: "禮盒 / 特殊包裝", displayName: "禮盒包裝",
    parentIndustry: "包裝", parentIndustrySlug: "packaging",
    primarySeoKeyword: "禮盒代工",
    secondaryKeywords: ["禮盒包裝工廠", "特殊包裝代工", "禮盒設計代工", "精品包裝代工"],
    seoTitleOverride: "禮盒代工｜台灣禮盒包裝廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣禮盒代工廠？OXM 整理可承接禮盒、特殊包裝生產需求的廠商，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣禮盒代工廠資訊，涵蓋禮盒與特殊包裝生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  {
    slug: "protective-packaging", label: "緩衝包材", displayName: "緩衝包材",
    parentIndustry: "包裝", parentIndustrySlug: "packaging",
    primarySeoKeyword: "緩衝包材廠商",
    secondaryKeywords: ["緩衝材代工", "氣泡布供應商", "包裝緩衝材", "防震包材"],
    seoTitleOverride: "緩衝包材廠商｜台灣包裝緩衝材搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣緩衝包材廠商？OXM 整理可供應緩衝材、氣泡布等包裝防護方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣緩衝包材廠商資訊，涵蓋緩衝材、氣泡布等包裝防護方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  { slug: "corrugated-cartons", label: "瓦楞紙箱 / 紙箱", displayName: "瓦楞紙箱", parentIndustry: "包裝", parentIndustrySlug: "packaging" },
  // 食品
  {
    slug: "bakery-pastry", label: "烘焙 / 糕點", displayName: "烘焙糕點",
    parentIndustry: "食品", parentIndustrySlug: "food",
    primarySeoKeyword: "烘焙代工",
    secondaryKeywords: ["糕點代工廠", "伴手禮代工", "烘焙OEM", "甜點代工"],
    seoTitleOverride: "烘焙代工｜台灣糕點伴手禮廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣烘焙代工廠？OXM 整理可承接糕點、伴手禮代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣烘焙代工廠資訊，涵蓋糕點與伴手禮代工需求，可依地區查看相關工廠並直接詢價。",
  },
  {
    slug: "beverage-oem", label: "飲料 / 飲品", displayName: "飲料",
    parentIndustry: "食品", parentIndustrySlug: "food",
    primarySeoKeyword: "飲料代工廠",
    secondaryKeywords: ["飲料OEM", "飲品代工", "手搖飲代工", "機能飲料代工"],
    seoTitleOverride: "飲料代工廠｜台灣飲品 OEM 廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣飲料代工廠？OXM 整理可承接飲料 OEM、手搖飲與機能飲料代工需求的製造業者，可依地區與生產條件篩選並直接詢價。",
    seoIntroOverride: "OXM 整理台灣飲料代工廠資訊，涵蓋飲料 OEM、手搖飲與機能飲料等生產需求，可依地區與生產條件篩選並直接詢價。",
  },
  {
    slug: "frozen-food", label: "冷凍食品", displayName: "冷凍食品",
    parentIndustry: "食品", parentIndustrySlug: "food",
    primarySeoKeyword: "冷凍食品代工廠",
    secondaryKeywords: ["冷凍食品代工", "冷凍食品OEM", "冷凍食品ODM", "調理包代工", "料理包代工"],
    seoTitleOverride: "冷凍食品代工廠｜台灣冷凍食品 OEM／ODM 廠商｜OXM",
    metaDescriptionOverride: "尋找台灣冷凍食品代工廠？OXM 整理可承接冷凍食品 OEM、ODM、調理包與料理包代工需求的製造業者，可依地區與生產條件篩選並直接詢價。",
    seoIntroOverride: "OXM 整理台灣冷凍食品代工廠資訊，涵蓋冷凍食品 OEM、ODM、調理包與料理包等生產需求，可依地區與生產條件篩選並直接詢價。",
  },
  {
    slug: "snacks", label: "零食 / 點心", displayName: "零食點心",
    parentIndustry: "食品", parentIndustrySlug: "food",
    primarySeoKeyword: "零食代工",
    secondaryKeywords: ["點心代工廠", "零食OEM", "休閒食品代工", "餅乾代工"],
    seoTitleOverride: "零食代工｜台灣休閒食品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣零食代工廠？OXM 整理可承接零食、休閒食品代工需求的製造業者，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣零食代工廠資訊，涵蓋零食與休閒食品代工需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  {
    slug: "seasonings-sauces", label: "調味料 / 醬料", displayName: "調味料",
    parentIndustry: "食品", parentIndustrySlug: "food",
    primarySeoKeyword: "調味料代工",
    secondaryKeywords: ["醬料代工廠", "醬料OEM", "醬料代工廠商", "辣椒醬代工"],
    seoTitleOverride: "調味料代工｜台灣醬料代工廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣調味料代工廠？OXM 整理可承接調味料、醬料代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣調味料代工廠資訊，涵蓋調味料與醬料代工需求，可依地區查看相關工廠並直接詢價。",
  },
  { slug: "ready-to-eat-food", label: "調理食品 / 即食食品", displayName: "調理即食食品", parentIndustry: "食品", parentIndustrySlug: "food" },
  { slug: "health-functional-food", label: "保健食品 / 機能食品", displayName: "保健機能食品", parentIndustry: "食品", parentIndustrySlug: "food" },
  // 化工製造
  {
    slug: "cleaning-products", label: "清潔用品", displayName: "清潔用品",
    parentIndustry: "化工製造", parentIndustrySlug: "chemical-manufacturing",
    primarySeoKeyword: "清潔用品代工",
    secondaryKeywords: ["清潔劑OEM", "洗劑代工廠", "居家清潔代工", "清潔用品ODM"],
    seoTitleOverride: "清潔用品代工｜台灣清潔劑廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣清潔用品代工廠？OXM 整理可承接清潔劑、洗劑代工需求的製造業者，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣清潔用品代工廠資訊，涵蓋清潔劑與洗劑代工需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  { slug: "coatings-adhesives", label: "塗料 / 黏著劑", displayName: "塗料黏著劑", parentIndustry: "化工製造", parentIndustrySlug: "chemical-manufacturing" },
  {
    slug: "cosmetic-odm", label: "保養品 / 化妝品原料", displayName: "保養品化妝品",
    parentIndustry: "化工製造", parentIndustrySlug: "chemical-manufacturing",
    primarySeoKeyword: "保養品代工",
    secondaryKeywords: ["保養品 ODM", "保養品 OEM", "化妝品代工", "化妝品 OEM", "化妝品 ODM"],
    seoTitleOverride: "保養品代工｜台灣化妝品 ODM／OEM 廠商｜OXM",
    metaDescriptionOverride: "尋找台灣保養品代工廠？OXM 整理提供化妝品 ODM、OEM 開發與生產服務的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "保養品代工是化工製造底下的子產業，涵蓋化妝品 ODM 與 OEM 開發服務。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  {
    slug: "fragrance-essential-oils", label: "香氛 / 精油", displayName: "香氛精油",
    parentIndustry: "化工製造", parentIndustrySlug: "chemical-manufacturing",
    primarySeoKeyword: "精油代工",
    secondaryKeywords: ["香氛OEM", "精油ODM", "香氛保養品代工", "香氛蠟燭代工"],
    seoTitleOverride: "精油代工｜台灣香氛保養品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣精油代工廠？OXM 整理可承接精油、香氛產品代工需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣精油代工廠資訊，涵蓋精油與香氛產品代工需求，可依地區查看相關工廠並直接詢價。",
  },
  { slug: "industrial-chemicals", label: "工業化學品", displayName: "工業化學品", parentIndustry: "化工製造", parentIndustrySlug: "chemical-manufacturing" },
  // 生活用品
  { slug: "home-goods", label: "家居用品", displayName: "家居用品", parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods" },
  {
    slug: "lighting-fixtures", label: "照明燈具", displayName: "照明燈具",
    parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods",
    primarySeoKeyword: "燈具代工",
    secondaryKeywords: ["照明燈具OEM", "燈具製造廠", "燈飾代工", "LED燈具代工"],
    seoTitleOverride: "燈具代工｜台灣照明燈具廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣燈具代工廠？OXM 整理可承接照明燈具、燈飾生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣燈具代工廠資訊，涵蓋照明燈具與燈飾生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  {
    slug: "stationery-office-supplies", label: "文具 / 辦公用品", displayName: "文具辦公用品",
    parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods",
    primarySeoKeyword: "文具代工",
    secondaryKeywords: ["辦公用品OEM", "文具製造廠", "文具ODM", "辦公用品代工"],
    seoTitleOverride: "文具代工｜台灣辦公用品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣文具代工廠？OXM 整理可承接文具、辦公用品生產需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣文具代工廠資訊，涵蓋文具與辦公用品生產需求，可依地區查看相關工廠並直接詢價。",
  },
  {
    slug: "outdoor-sports-goods", label: "戶外 / 運動用品", displayName: "戶外運動用品",
    parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods",
    primarySeoKeyword: "運動用品代工",
    secondaryKeywords: ["戶外用品OEM", "運動器材代工", "戶外用品代工", "運動用品ODM"],
    seoTitleOverride: "運動用品代工｜台灣戶外用品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣運動用品代工廠？OXM 整理可承接運動用品、戶外用品生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣運動用品代工廠資訊，涵蓋運動用品與戶外用品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  {
    slug: "pet-supplies", label: "寵物用品", displayName: "寵物用品",
    parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods",
    primarySeoKeyword: "寵物用品代工",
    secondaryKeywords: ["寵物用品OEM", "寵物商品代工", "寵物用品ODM", "寵物周邊代工"],
    seoTitleOverride: "寵物用品代工｜台灣寵物商品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣寵物用品代工廠？OXM 整理可承接寵物用品、寵物商品生產需求的製造業者，可依地區瀏覽相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣寵物用品代工廠資訊，涵蓋寵物用品與寵物商品生產需求，可依地區查看相關工廠並直接詢價。",
  },
  {
    slug: "baby-products", label: "嬰幼兒用品", displayName: "嬰幼兒用品",
    parentIndustry: "生活用品", parentIndustrySlug: "consumer-goods",
    primarySeoKeyword: "嬰幼兒用品代工",
    secondaryKeywords: ["嬰兒用品OEM", "嬰幼兒商品代工", "嬰兒用品ODM", "兒童用品代工"],
    seoTitleOverride: "嬰幼兒用品代工｜台灣嬰兒用品廠商搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣嬰幼兒用品代工廠？OXM 整理可承接嬰幼兒用品生產需求的製造業者，可依地區查看相關廠商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣嬰幼兒用品代工廠資訊，涵蓋嬰幼兒用品生產需求，可依地區瀏覽相關工廠並直接詢價。",
  },
  // 印刷
  {
    slug: "large-format-printing", label: "展場 / 大圖輸出（立牌、背板、布條）", displayName: "大圖輸出",
    parentIndustry: "印刷", parentIndustrySlug: "printing",
    primarySeoKeyword: "大圖輸出",
    secondaryKeywords: ["大圖輸出廠商", "大圖輸出公司", "展場輸出", "布條輸出", "立牌製作"],
    seoTitleOverride: "大圖輸出｜台灣展場輸出與布條製作廠商｜OXM",
    metaDescriptionOverride: "尋找台灣大圖輸出廠商？OXM 整理可承接展場輸出、布條、立牌與大型圖像製作需求的廠商，可依地區與生產條件篩選並直接詢價。",
    seoIntroOverride: "OXM 整理台灣大圖輸出廠商資訊，涵蓋展場輸出、布條、立牌等製作需求，可依地區與生產條件篩選並直接詢價。",
  },
  {
    slug: "sticker-label", label: "貼紙 / 標籤（商品貼紙、LOGO貼）", displayName: "貼紙標籤",
    parentIndustry: "印刷", parentIndustrySlug: "printing",
    primarySeoKeyword: "貼紙印刷",
    secondaryKeywords: ["標籤印刷", "貼紙印刷廠", "貼紙代工", "標籤貼紙印刷", "LOGO貼紙製作"],
    seoTitleOverride: "貼紙印刷｜台灣標籤貼紙印刷廠搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣貼紙印刷廠？OXM 整理可承接商品貼紙、LOGO 貼紙與標籤印刷需求的廠商，可依地區與生產條件篩選並直接詢價。",
    seoIntroOverride: "OXM 整理台灣貼紙印刷與標籤印刷廠商資訊，涵蓋商品貼紙、LOGO 貼紙與標籤製作需求，可依地區與生產條件篩選並直接詢價。",
  },
  {
    slug: "packaging-print", label: "包裝印刷（彩盒、紙盒、包裝袋）", displayName: "包裝印刷",
    parentIndustry: "印刷", parentIndustrySlug: "printing",
    primarySeoKeyword: "包裝印刷廠",
    secondaryKeywords: ["包裝印刷", "包裝印刷代工", "包裝印刷工廠", "彩盒印刷"],
    seoTitleOverride: "包裝印刷廠｜台灣彩盒印刷與包裝印刷代工廠商｜OXM",
    metaDescriptionOverride: "尋找台灣包裝印刷廠？OXM 整理可承接彩盒印刷與包裝印刷代工需求的工廠，可依地區、代工模式、可接小量與可打樣等條件篩選詢價。",
    seoIntroOverride: "包裝印刷是印刷底下的子產業，涵蓋彩盒與包裝印刷代工需求。OXM 整理台灣相關工廠資訊，可依地區與生產條件篩選，直接送出詢價。",
  },
  { slug: "general-printing", label: "一般印刷（名片、DM、型錄）", displayName: "一般印刷", parentIndustry: "印刷", parentIndustrySlug: "printing" },
  { slug: "custom-merchandise-printing", label: "商品周邊印刷（客製商品、品牌周邊、布料印刷）", displayName: "商品周邊印刷", parentIndustry: "印刷", parentIndustrySlug: "printing" },
  { slug: "professional-printing-technology", label: "專業印刷技術（平版 / 數位 / 網版）", displayName: "專業印刷", parentIndustry: "印刷", parentIndustrySlug: "printing" },
  // 工業設備／機械
  { slug: "industrial-machinery-equipment", label: "工業機械設備", displayName: "工業機械設備", parentIndustry: "工業設備／機械", parentIndustrySlug: "industrial-machinery" },
  {
    slug: "automation-production-line-equipment", label: "自動化／產線設備", displayName: "自動化產線設備",
    parentIndustry: "工業設備／機械", parentIndustrySlug: "industrial-machinery",
    primarySeoKeyword: "自動化設備廠商",
    secondaryKeywords: ["產線設備代工", "自動化整合廠商", "工業自動化設備", "產線自動化廠商"],
    seoTitleOverride: "自動化設備廠商｜台灣產線設備搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣自動化設備廠商？OXM 整理可供應產線設備、自動化整合方案的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣自動化設備廠商資訊，涵蓋產線設備與自動化整合方案，可依地區瀏覽相關供應商並直接詢價。",
  },
  { slug: "industry-specific-machinery", label: "產業專用機械", displayName: "產業專用機械", parentIndustry: "工業設備／機械", parentIndustrySlug: "industrial-machinery" },
  {
    slug: "inspection-measurement-equipment", label: "檢測／量測設備", displayName: "檢測量測設備",
    parentIndustry: "工業設備／機械", parentIndustrySlug: "industrial-machinery",
    primarySeoKeyword: "檢測設備廠商",
    secondaryKeywords: ["量測設備代工", "品管檢測儀器", "檢測儀器廠商", "量測儀器代工"],
    seoTitleOverride: "檢測設備廠商｜台灣量測設備搜尋與詢價｜OXM",
    metaDescriptionOverride: "尋找台灣檢測設備廠商？OXM 整理可供應檢測設備、量測儀器與品管設備的廠商，可依地區瀏覽相關供應商並直接詢價。",
    seoIntroOverride: "OXM 整理台灣檢測設備廠商資訊，涵蓋檢測與量測設備供應，可依地區瀏覽相關供應商並直接詢價。",
  },
  { slug: "machinery-parts-maintenance", label: "機械零件／維修保養", displayName: "機械零件維修", parentIndustry: "工業設備／機械", parentIndustrySlug: "industrial-machinery" },
  // 永續材料
  { slug: "bioplastics", label: "生質塑膠", displayName: "生質塑膠", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "starch-based-materials", label: "全澱粉基材料", displayName: "全澱粉基材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "biodegradable-materials", label: "生物可分解材料", displayName: "生物可分解材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "recycled-materials", label: "再生材料", displayName: "再生材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "natural-fiber-materials", label: "天然纖維材料", displayName: "天然纖維材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "biocomposite-materials", label: "生質複合材料", displayName: "生質複合材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
  { slug: "compostable-materials", label: "可堆肥材料", displayName: "可堆肥材料", parentIndustry: "永續材料", parentIndustrySlug: "sustainable-materials" },
];

/** slug → entry 唯一反查表，是 /factories/:slug 與 /factories/:region/:slug
 *  判斷「這段 slug 是不是合法子產業」的唯一依據，不得在其他地方另建一份。 */
export const SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY: Record<string, SubIndustrySearchEntry> =
  Object.fromEntries(SUB_INDUSTRY_SEARCH_ENTRIES.map(e => [e.slug, e]));

/**
 * (parentIndustry, label) → entry 反查表，key 是 `${parentIndustry}|||${label}`。
 * 「塑膠包裝」同時是「塑膠」與「包裝」底下的子產業（parent-aware
 * collision，見上方說明），單純用 label 反查會拿到兩筆裡的其中一筆、
 * 語意不明確，所以查表一定要同時帶 parentIndustry 才能唯一鎖定是哪一筆
 * entry。sitemap（server/_core/index.ts）用這個把 DB 撈出來的
 * (industry, subIndustry) 組合對回正確的那一個 slug，existence 查詢
 * （server/db.ts 的 hasApprovedFactoryForSubIndustry 系列）也用同一組
 * (industry, subIndustry) 條件，確保「這個 slug 是否至少 1 家 approved
 * 工廠」的判斷跟這個 slug 實際會顯示的搜尋結果（factory.search 用
 * industry+subIndustry 兩個條件 AND）完全一致。
 */
export const SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL: Record<string, SubIndustrySearchEntry> =
  Object.fromEntries(SUB_INDUSTRY_SEARCH_ENTRIES.map(e => [`${e.parentIndustry}|||${e.label}`, e]));

/**
 * 舊子產業 slug 被拆成多個新 slug 時的過渡頁資料（目前唯一項目：電子零件
 * 「線束 / 連接器」拆成 wire-harness-assembly + connector-terminal，見任務
 * 定案「線束 / 連接器拆分為三類」）。跟 LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG
 * 是不同機制：後者是「舊 URL 格式 → 新 slug」的單一對應（301 等價內容），
 * 這裡是「一個舊 slug 的語意被拆成多個新 slug」，沒有單一等價頁面可以
 * 301，因此不做自動轉址，改由 shared/seo/subIndustryPages.ts 的
 * resolveSplitSubIndustryNotice() 產生一個列出所有新分類連結的過渡頁
 * （200 + noindex，避免跟新分類頁產生重複內容）。
 *
 * successorSlugs 只存 slug，label／displayName 等一律透過
 * SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY 反查，避免文案在兩處各自維護、日後改字
 * 時漏改其中一邊。
 */
export const SPLIT_SUB_INDUSTRY_NOTICES: Record<string, {
  label: string;
  parentIndustry: string;
  parentIndustrySlug: string;
  successorSlugs: string[];
}> = {
  "wire-harness-connectors": {
    label: "線束 / 連接器",
    parentIndustry: "電子零件",
    parentIndustrySlug: "electronics",
    successorSlugs: ["wire-harness-assembly", "connector-terminal"],
  },
};

// 子產業頁 SEO 內容（Phase 1）
export const SUB_INDUSTRY_SEO_CONTENT: Record<string, {
  title: string;
  description: string;
  intro: string;
  applications: string;
  howToChoose: string;
}> = {
  "metal-processing/cnc-machining": {
    title: "CNC精密加工代工｜台灣傳產廠商資源｜OXM",
    description: "尋找台灣 CNC 精密加工工廠，五軸加工、車床、銑床 OEM 服務，公差精準，直接詢價比較。",
    intro: "台灣 CNC 精密加工廠以三軸到五軸加工中心、精密車床與磨床為主力設備，能精準加工鋁合金、不鏽鋼、鈦合金等金屬材料，公差控制普遍達 ±0.01mm，頂尖廠商可達 ±0.005mm 以下。台灣 CNC 加工廠商多集中於桃竹苗、台中精密機械聚落，擁有豐富的電子、醫療器材與航太零件代工經驗，能從單件打樣快速轉換至批量生產。",
    applications: "CNC 精密加工代工常見應用包含：消費電子與筆電金屬機殼、手機中框 CNC 銑削、無人機機身結構件、醫療器材不鏽鋼與鈦合金零件、光學設備固定座與鏡頭筒、航太精密結構件、工業機械手臂關節件，以及量治具與客製化精密零件等。台灣 CNC 廠商普遍具備 CAD/CAM 讀取能力，能依 STP、STEP、DXF 圖檔直接報價打樣。",
    howToChoose: "選擇 CNC 精密加工廠時，建議確認廠商的軸數能力（三軸、四軸、五軸聯動）及設備工作台尺寸；是否配備 CMM 三次元量測儀，提供尺寸量測報告；廠商對特殊材料（鈦合金、因瓦合金、PEEK）的加工經驗；以及表面處理（陽極處理、電鍍、噴砂）是否一站配合。建議提供完整 3D 檔（STP）並要求 DFM 評估，確認公差可達性後再下單。",
  },
  "metal-processing/sheet-metal": {
    title: "鈑金加工代工｜台灣傳產廠商資源｜OXM",
    description: "在 OXM 尋找台灣鈑金加工廠商，雷射切割、折彎、衝孔一條龍，工業零件 OEM 接單，直接詢價。",
    intro: "台灣鈑金加工廠具備雷射切割、折彎、衝孔、焊接等完整加工製程，能處理冷軋鋼板、不鏽鋼、鍍鋅鋼板及鋁板等各類金屬板材，厚度範圍從 0.5mm 薄板到 10mm 厚板不等。廠商多配備 CNC 折彎機、光纖雷射切割機與氬弧焊接設備，能依客戶圖面進行鈑金展開計算，提供從雷射切割到表面處理的一站式服務。",
    applications: "鈑金加工代工常見應用包含：機櫃與機箱外殼、伺服器機架與導軌、工業設備保護蓋、通風空調風管、電控箱與配電盤外殼、展覽展示架、餐飲設備不鏽鋼工作台，以及建築裝飾金屬格柵與扶手等。台灣鈑金廠商普遍具備小量到大量彈性接單能力，適合機械設備廠、系統整合商及工業設計公司尋找代工夥伴。",
    howToChoose: "選擇鈑金加工廠時，應確認廠商雷射切割機的功率（直接影響可加工厚度）與折彎機最大折彎長度；焊接方式（MIG、TIG、點焊）是否符合產品需求；是否提供後續表面處理（電鍍、噴粉、烤漆）；以及廠商對精密折彎角度的公差控制。建議提供展開圖及 3D 組立圖，要求廠商報價前確認可製造性。",
  },
  "metal-processing/metal-materials": {
    title: "金屬原料供應商｜台灣金屬材料、板材、棒材、管材、型材｜OXM",
    description: "OXM 整合台灣金屬原料與金屬材料供應商，包含鋼材、鋁材、銅材、不鏽鋼材料、板材、棒材、管材、型材與特殊金屬材料，協助企業、品牌與採購人員快速找到合適的金屬原料合作對象。",
    intro: "金屬原料是許多加工與製造流程的起點，從板材、棒材、管材、型材到特殊金屬材料，不同規格與材質會直接影響後續加工方式、成本與產品品質。台灣金屬材料供應商涵蓋鋼材（碳鋼、合金鋼、工具鋼）、鋁材（6061、7075、2024 等合金）、銅材（純銅、黃銅、磷銅）、不鏽鋼（304、316、430）及特殊金屬（鈦合金、鎳合金、因瓦合金）等多元品項，能以板材、棒材、管材、型材、線材、鑄件等多種形態供料，部分廠商提供按需裁切、下料及初加工服務，降低採購與庫存管理成本。OXM 協助使用者快速找到台灣金屬材料供應商，適合需要採購金屬原料、尋找穩定材料來源，或希望與金屬材料廠商建立長期合作的企業與品牌。",
    applications: "金屬原料供應常見應用包含：機械製造業採購結構鋼材與特殊合金棒材、鈑金加工廠穩定採購不鏽鋼板與鍍鋅鋼板、CNC 精密加工廠的鋁棒與鈦合金棒材備料、建築與室內設計案的不鏽鋼型材與鋁擠型、電子散熱模組與機殼用鋁板採購、醫療器材廠商採購醫療級不鏽鋼與鈦合金、汽機車零件廠採購碳鋼圓棒與扁鋼、珠寶與精品業採購銅材與特殊金屬線材，以及新創硬體團隊少量採購測試用金屬材料等，適合各規模的製造商、加工廠與品牌採購部門。",
    howToChoose: "選擇金屬原料供應商時，應確認廠商能提供的材質認證文件（Mill Certificate、材料成分報告）；庫存規格是否涵蓋所需尺寸（厚度、寬度、長度或外徑）；是否提供按需裁切（下料）與簡單初加工服務；交期與最小訂購量（MOQ）是否符合生產計畫；以及是否提供原廠材料追溯碼，滿足品質管控與製程追溯需求。對於特殊金屬（鈦合金、高溫合金）需確認廠商的備貨能力與技術知識，避免以一般材料替代造成品質問題。",
  },
  "metal-processing/mold-making": {
    title: "模具製造代工｜台灣開模工廠推薦｜OXM",
    description: "在 OXM 尋找台灣模具製造廠商，塑膠射出模、壓鑄模、沖壓模設計開發，快速打樣，直接詢價。",
    intro: "台灣模具製造業是台灣製造業的根基，涵蓋塑膠射出模具、壓鑄模具（鋁鑄、鋅鑄）、沖壓模具（連續模、複合模）與矽膠模具等多種型態。台灣模具廠普遍具備 CAD/CAM 設計能力、高速銑削加工中心與 EDM 電極放電加工設備，能在 4～8 週內完成中等複雜度模具開發，公差控制達 ±0.02mm，適合台灣、東南亞量產的模具需求。",
    applications: "模具製造代工常見應用包含：消費電子產品塑膠外殼模具、家電產品結構件射出模具、汽機車塑件與鋁鑄件壓鑄模具、金屬連接器與端子衝壓連續模、矽膠按鍵與密封件模具、醫療耗材精密射出模具，以及食品包裝 PET/PP 瓶吹塑模等。台灣模具廠多具備試模服務，能提供試模樣品供客戶確認結構與外觀。",
    howToChoose: "選擇模具製造廠時，應確認廠商熟悉的模具類型（射出、壓鑄、沖壓）；是否具備高速銑削中心（HSM）與 EDM 精密放電加工設備；試模費用是否含在模具報價中；廠商的鋼料選用（P20、718H、S136）是否符合預定產量需求；以及修模服務的保固期與費用說明。建議要求廠商提供模流分析報告，評估缺料、縮水與翹曲風險。",
  },
  "plastic/plastic-injection": {
    title: "塑膠射出成型代工｜台灣傳產廠商資源｜OXM",
    description: "台灣塑膠射出成型工廠，外殼零件開模打樣，ABS、PC、PP 各材質，OEM / ODM 接單。",
    intro: "台灣塑膠射出成型工廠具備從模具設計開發到大量生產的一站式能力，使用材料涵蓋 ABS、PP、PC、PA（尼龍）、POM、TPU 等工程塑膠及彈性體，能依客戶需求選用食品級、阻燃（UL94）、抗靜電、耐高溫等特殊規格材料。射出噸位從 50T 到 1500T 不等，能生產從精密小件到大型外殼零件。",
    applications: "塑膠射出成型代工常見應用包含：消費電子外殼（手機殼、筆電蓋、平板支架）、家電產品外觀件（吹風機殼、電源供應器外殼）、汽機車內裝塑件、醫療器材外殼與一次性耗材、工業設備操作面板、戶外運動器材配件，以及玩具與嬰幼兒用品等。部分廠商提供雙色射出、嵌入射出、氣輔成型等進階工藝。",
    howToChoose: "選擇塑膠射出工廠時，應確認廠商的噸位範圍能否覆蓋產品需求；是否提供模具設計（DFM）評估；廠商的材料管理是否嚴謹（防止混料）；後加工（噴漆、電鍍、絲印）是否一站完成；以及廠商對縮水、翹曲、毛邊等常見缺陷的改善能力。建議提供 3D 圖，要求試模後提供全尺寸量測報告。",
  },
  "electronics/pcb": {
    title: "PCB電路板代工｜台灣傳產廠商資源｜OXM",
    description: "在 OXM 尋找台灣 PCB 電路板製造廠商，單雙面至多層板，快速打樣，OEM 量產服務，直接詢價。",
    intro: "台灣 PCB（印刷電路板）製造業是全球供應鏈的重要環節，廠商技術覆蓋單面板、雙面板、多層板（4L～32L+）、軟性電路板（FPC）、剛撓結合板及 HDI 高密度板。台灣 PCB 廠普遍具備 IPC-6012/6013 認證，能穩定生產線寬 75μm 以下、盲埋孔、高頻材料（Rogers、Taconic）等高階規格，供應消費電子、工業、車用及通訊基站等市場。",
    applications: "PCB 代工常見應用包含：消費電子主機板（手機、平板、筆電）、工業控制 PLC 與 HMI 電路板、醫療電子監測設備、車用 ECU 與 ADAS 系統板、IoT 物聯網模組與無線通訊板、電源管理模組、LED 驅動板，以及高頻/微波天線板等。台灣 PCB 廠商多具備快速打樣（3～5 工作天）服務，適合研發驗證與小批量試產。",
    howToChoose: "選擇 PCB 工廠時，應確認廠商的最小線寬/線距能力；是否具備 IPC-A-600 外觀認證與 IPC-6012 性能認證；阻抗控制板的測試報告是否可提供；高頻材料的加工經驗；以及 AOI 全板測試是否為標準製程。快速打樣建議優先選擇線上報價系統完整的廠商，縮短溝通時間。",
  },
  "electronics/smt-assembly": {
    title: "SMT電子組裝代工｜台灣PCBA工廠推薦｜OXM",
    description: "台灣 SMT 電子組裝 PCBA 一站式代工，高速貼片、AOI 檢測、功能測試，OEM 彈性接單。",
    intro: "台灣 SMT 電子組裝工廠具備高速 SMT 貼片機、回流焊、波峰焊、AOI 自動光學檢測及 ICT 測試等完整設備，能組裝從 01005 微型被動元件到 BGA、QFN 等細腳距 IC，提供 PCBA 一站式代工（PCB 製作＋零件採購＋SMT 組裝＋功能測試）。部分廠商具備 IPC-A-610 Class 3 認證，能服務醫療、航太等高可靠度應用。",
    applications: "SMT 電子組裝代工常見應用包含：消費電子 PCBA（藍牙耳機、智慧手錶、小家電）、工業控制板組裝（PLC、變頻器、伺服驅動器）、醫療電子設備、車用電子模組、IoT 智慧感測節點、電源模組與充電器 PCB，以及網通設備主板等。台灣 SMT 廠商彈性接受小量試產（如 50～200pcs），適合新品開發與市場驗證。",
    howToChoose: "選擇 SMT 電子組裝廠時，應確認廠商的最小貼片能力（01005 元件需求）；BGA 植球與 X-Ray 檢測能力；物料管控機制（防止假料混入）；功能測試（FCT）的規劃能力；以及提供 IQC 進料檢驗報告的意願。建議提供完整 BOM 表與 Gerber 檔，要求廠商進行 DFM/DFA 評估。",
  },
  "printing/packaging-print": {
    title: "包裝印刷代工｜台灣傳產廠商資源｜OXM",
    description: "台灣包裝印刷工廠，彩盒、紙盒、包裝袋設計印刷一站式，燙金打凸 UV 後加工，直接詢價。",
    intro: "台灣包裝印刷工廠具備從設計稿到成品的一站式服務，涵蓋平版膠印（CMYK+專色）、數位印刷、後加工（燙金、打凸、局部 UV、覆霧膜/光膜）及模切成型等完整製程。廠商能生產彩盒（天地蓋、插底、自鎖底）、紙盒（摺疊式、硬盒）、手提袋及軟袋等多種包裝形式，廣受美妝保養品、食品、電子產品及保健品牌採用。",
    applications: "包裝印刷代工常見應用包含：美妝保養品彩盒與禮盒組合、食品伴手禮包裝（鳳梨酥盒、月餅禮盒）、電子產品天地蓋外盒、保健食品膠囊瓶標及外盒、品牌服飾手提袋與鞋盒、茶葉與烈酒精裝禮盒、電商出貨彩盒，以及農產品包裝盒設計印刷等，適合品牌商、電商賣家及行銷活動採購。",
    howToChoose: "選擇包裝印刷廠時，應確認廠商是否提供色彩打樣（Proof）並有 ISO 12647 色彩管理；後加工工藝（燙金版費、模切刀版費）費用是否透明；紙材克重與等級的選用彈性；以及環保認證（FSC 認證紙材）是否可取得。建議先打 1:1 刀模樣（Beer Sample），確認結構與外觀後再正式量產。",
  },
  "printing/sticker-label": {
    title: "貼紙標籤代工｜台灣傳產廠商資源｜OXM",
    description: "台灣貼紙、標籤 OEM 印刷廠推薦，商品貼紙、LOGO貼、防偽標籤、耐水耐油材質皆可配合。",
    intro: "台灣貼紙與標籤印刷廠具備輪轉印刷、平版印刷與數位印刷多種工藝，能生產不乾膠貼紙、熱縮套標、膜內標（IML）、防偽標籤、資產管理貼及各式商品標籤，材質涵蓋 PET、PE、PP、BOPP、熱感紙、銅板紙等。部分廠商提供小量數位印刷打樣服務，最低可接受百張起印，適合新創品牌測試市場與限量商品需求。",
    applications: "貼紙與標籤代工常見應用包含：商品包裝 LOGO 貼與品牌識別貼紙、食品與飲料成分標籤（耐水耐油）、化妝品與保養品瓶身標、電子產品合規認證標籤（CE、FCC、UL）、藥品警示貼與醫療器材追蹤標籤、電商出貨感謝卡與封口貼、活動票券與防偽雷射標，以及資產管理條碼標籤等。",
    howToChoose: "選擇貼紙標籤印刷廠時，應確認材質與黏膠規格是否符合使用環境（冷凍、戶外、耐油）；是否具備防偽功能（雷射全像膜、刮刮銀、序號印刷）；色彩打樣是否準確；以及輪轉印刷的最低起印量是否符合需求。如需小量，選擇提供數位印刷的廠商可降低浪費，建議依銷售量選擇最佳方案。",
  },
  "chemical-manufacturing/cosmetic-odm": {
    title: "保養品化妝品代工｜台灣傳產廠商資源｜OXM",
    description: "在 OXM 尋找台灣保養品、化妝品 OEM / ODM 廠商，ISO 22716 GMP 認證，自有品牌快速上市，直接詢價。",
    intro: "台灣保養品與化妝品工廠具備完整的 OEM/ODM 研發生產能力，多數廠商通過 ISO 22716 化妝品 GMP 認證，能依品牌配方需求或自主研發開發乳液、精華液、面膜、洗髮精、防曬品等多品項，並提供穩定性測試、防腐效能測試（PET）及皮膚刺激性測試等法規文件支援。台灣化妝品工廠的優勢在於配方技術成熟、能快速客製打樣，且熟悉台灣、中國大陸、東南亞及歐美市場的法規要求。",
    applications: "保養品化妝品 ODM 代工常見應用包含：電商自有品牌保養品（精華液、乳霜、面膜）、敏感肌與醫美術後修護系列、防曬乳與 BB 霜、有機天然成分美妝品、男性保養系列、寵物洗毛精與護毛素，以及品牌通路 Private Label 商品等。台灣 ODM 廠商通常提供配方開發、包材採購、充填包裝一站服務，適合無工廠的品牌商快速上市。",
    howToChoose: "選擇保養品化妝品工廠時，應確認廠商是否具備 ISO 22716 GMP 認證；配方保密協議（NDA）是否完善；是否提供穩定性測試與微生物檢驗報告；廠商對目標市場法規的熟悉程度；以及最低起訂量是否符合品牌初期規模。建議選擇具備小量打樣（如 50～100 件）能力的廠商，降低新品開發風險。",
  },
  "food/beverage-oem": {
    title: "飲料代工｜台灣飲品OEM工廠推薦｜OXM",
    description: "在 OXM 尋找台灣飲料、機能飲品 OEM 廠商，HACCP 認證，PET 瓶、鋁罐、軟袋各式包材，直接詢價。",
    intro: "台灣飲料工廠涵蓋機能飲料、茶飲、果汁、咖啡、氣泡飲及機能水等多元品類，多數廠商通過 HACCP 或 ISO 22000 食品安全認證，具備無菌充填（熱充填、冷充填、UHT）及各式包材（PET 瓶、鋁罐、鋁箔包、玻璃瓶、軟袋）的充填封蓋能力。台灣飲料 OEM 廠商普遍具備配方研發能力，能依品牌需求調整口味、甜度、功能性成分，協助品牌快速推出差異化產品。",
    applications: "飲料代工常見應用包含：電商自有品牌機能飲料（美容、運動、能量）、茶飲品牌 OEM（台灣茶、抹茶、花草茶）、冷壓果汁與蔬果汁、精品咖啡液與冷萃咖啡、氣泡飲與調酒基底、健康補給水（電解質水、氫水）、酒精性飲料（精釀啤酒、RTD 酒精飲料），以及寵物機能飲品等。",
    howToChoose: "選擇飲料工廠時，應確認廠商的充填設備類型（熱充填適合茶飲/果汁，冷充填適合含乳/低酸飲料）；HACCP/ISO 22000 認證有效期；最低起訂量；配方保密協議是否完善；以及廠商是否協助申請衛福部查驗登記。建議先進行小量打樣，確認口感、色澤與保存期限後再量產。",
  },
  "packaging/eco-packaging": {
    title: "環保包裝代工｜台灣傳產廠商資源｜OXM",
    description: "在 OXM 尋找台灣環保包裝廠商，FSC 認證紙材、PLA 生物基、紙漿模塑，符合歐美環保採購要求。",
    intro: "台灣環保包裝工廠提供符合國際永續採購標準的包裝解決方案，涵蓋 FSC 認證再生紙盒、PLA 生物基塑膠、蔗渣漿塑模（紙漿模塑）、蜂窩紙緩衝材及可堆肥袋等環保材質。廠商多已取得 FSC 鏈監管認證（COC），能出具材料來源證明，符合歐盟、美國及日本零售通路的環保採購要求，適合品牌商推動 ESG 永續包裝升級。",
    applications: "環保包裝代工常見應用包含：電商出貨減塑紙箱與緩衝包材替換、保養品與食品 FSC 認證紙盒外包裝、農產品紙漿托盤與水果緩衝紙漿模、咖啡杯外帶杯套與可堆肥吸管、品牌禮盒環保改版、服飾品牌無塑包裝、電子配件環保緩衝紙漿模，以及展覽活動環保佈置材料等。",
    howToChoose: "選擇環保包裝工廠時，應確認廠商持有的環保認證（FSC COC、BPI 可堆肥、OK Compost）；是否能提供材料成分報告供品牌 ESG 揭露使用；環保材質的強度與保護性是否符合物流需求；以及成本溢價是否在預算範圍內（環保材質通常比傳統材質貴 15～30%）。建議要求廠商提供替換方案比較，評估環保升級的成本效益。",
  },
  "textile/apparel-manufacturing": {
    title: "成衣服飾代工｜台灣傳產廠商資源｜OXM",
    description: "在 OXM 尋找台灣成衣、服飾 OEM 廠商，打版打樣到量產，品牌自有設計接單，小量 MOQ 可配合。",
    intro: "台灣成衣代工產業具備完整的設計打版、樣品製作到量產的一站式服務能力，部分廠商同時經營 ODM 自主設計開發，能配合品牌商提供獨家款式。台灣成衣廠熟悉國際買家規格（如 Higg Index、WRAP 認證），能處理棉、滌綸、尼龍、萊卡等多種面料，並提供刺繡、印花、水洗等多元後加工服務。",
    applications: "成衣代工常見應用包含：電商自有品牌 T-shirt 與 Polo 衫、運動機能服飾（壓縮褲、瑜伽服）、職業制服與團體服、品牌牛仔褲與休閒褲、外套與防水夾克、嬰幼兒服飾與童裝、精品時裝打樣與小量生產，以及表演服裝與舞台衣等。台灣成衣廠普遍接受小量訂單（如 100～300 件起訂），適合新興品牌市場測試與限量款開發。",
    howToChoose: "選擇成衣工廠時，應確認廠商的打版師資歷與打版費用；是否具備目標認證（WRAP、GOTS 有機棉）；最低起訂量（MOQ）與每款顏色最低數量；面料採購的彈性（是否可客戶提供面料）；以及樣品製作週期與費用。建議先製作 Pre-Production Sample（PP 樣），確認版型、縫工與材質後再下量產訂單。",
  },
};

// ===== 舊子產業 Phase 1 頁（/industry/:industry/:subIndustry）→ 新子產業搜尋頁
// （/factories/:subIndustrySlug）route consolidation（見任務定案「SEO route
// consolidation」）=====
//
// 純由既有資料推導，不是第二套 hardcoded mapping：
// 1. 走訪 SUB_INDUSTRY_SLUG_TO_NAME（Phase 1，13 筆，key 是舊
//    "industrySlug/subSlug"）拿到 label；
// 2. 用 INDUSTRY_SLUG_TO_NAME 把舊 industrySlug 轉成 parentIndustry 中文名；
// 3. 用 SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL（本輪上一次任務新增，
//    parent-aware，可正確處理「塑膠包裝」這種同 label 不同 parent 的情況）
//    以 parentIndustry+label 查回新的 SubIndustrySearchEntry，取其 slug。
// 對不到（理論上不會發生，SUB_INDUSTRY_SLUG_TO_NAME 的 13 筆本來就都在
// SUB_INDUSTRY_SEARCH_ENTRIES 涵蓋範圍內）的組合直接跳過，不猜測、不硬塞。
export const LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [legacyKey, label] of Object.entries(SUB_INDUSTRY_SLUG_TO_NAME)) {
    const industrySlug = legacyKey.slice(0, legacyKey.indexOf("/"));
    const parentIndustry = INDUSTRY_SLUG_TO_NAME[industrySlug];
    if (!parentIndustry) continue;
    const entry = SUB_INDUSTRY_SEARCH_ENTRY_BY_PARENT_AND_LABEL[`${parentIndustry}|||${label}`];
    if (entry) map[legacyKey] = entry.slug;
  }
  return map;
})();

/**
 * 新 slug → 舊 Phase 1 SEO 長文內容（intro／applications／howToChoose）反查表。
 * 直接 reuse SUB_INDUSTRY_SEO_CONTENT 既有物件（不複製、不改寫文案），供
 * /factories/:subIndustrySlug 在工廠結果列表之後顯示補充資訊——只有原本就有
 * Phase 1 內容的 13 個子產業會出現在這裡，其餘子產業查不到、新頁行為不變
 * （見任務定案「若該新子產業沒有舊 SUB_INDUSTRY_SEO_CONTENT：維持現在的新頁
 * 行為即可」）。
 */
export const NEW_SUB_INDUSTRY_SLUG_TO_LEGACY_SEO_CONTENT: Record<string, (typeof SUB_INDUSTRY_SEO_CONTENT)[string]> = (() => {
  const map: Record<string, (typeof SUB_INDUSTRY_SEO_CONTENT)[string]> = {};
  for (const [legacyKey, newSlug] of Object.entries(LEGACY_SUB_INDUSTRY_SLUG_TO_NEW_SLUG)) {
    map[newSlug] = SUB_INDUSTRY_SEO_CONTENT[legacyKey];
  }
  return map;
})();
