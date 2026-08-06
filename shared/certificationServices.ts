// ===== ISO 與低碳認證專區：分類／服務項目共用常數 =====
// 與 shared/badges.ts（工廠已獲得徽章的固定 30 種清單）完全獨立——這裡只是
// 認證「服務」的行銷／諮詢入口資料的種子內容與共用選項，不是徽章擁有權資料。
// 第一批只放 9 項，其餘既有徽章（BNI、產業／產品認證等）本輪一律不匯入。

export type CertificationServiceStatus = "draft" | "published" | "unpublished" | "archived";

export const CERTIFICATION_SERVICE_STATUS_LABELS: Record<CertificationServiceStatus, string> = {
  draft: "草稿",
  published: "已上架",
  unpublished: "已下架",
  archived: "已封存",
};

/** 工廠常見需求（公開頁「工廠常見需求」區塊 + 服務項目 applicableNeeds 的共用選項池）。 */
export const CERTIFICATION_NEED_OPTIONS = [
  "客戶要求",
  "投標需求",
  "品質管理",
  "環境管理",
  "職業安全衛生",
  "能源管理",
  "資訊安全",
  "組織碳盤查",
  "產品碳足跡",
  "不確定適合哪一項",
] as const;

export type CertificationNeed = (typeof CERTIFICATION_NEED_OPTIONS)[number];

/** 服務項目卡片的「類型」標籤（與分類是兩個獨立維度，避免九項全部誤稱為同一種「ISO 認證」）。 */
export const CERTIFICATION_SERVICE_TYPE_OPTIONS = [
  "管理系統",
  "盤查與量化",
  "政府標籤",
] as const;

export type CertificationServiceType = (typeof CERTIFICATION_SERVICE_TYPE_OPTIONS)[number];

export interface CertificationServiceCategorySeed {
  code: string;
  name: string;
  sortOrder: number;
}

/** 第一版固定 3 個分類，種子資料。 */
export const CERTIFICATION_SERVICE_CATEGORY_SEEDS: readonly CertificationServiceCategorySeed[] = [
  { code: "iso-management", name: "ISO 管理系統", sortOrder: 0 },
  { code: "carbon-assessment", name: "碳盤查與產品碳足跡", sortOrder: 1 },
  { code: "government-carbon-label", name: "政府碳標籤", sortOrder: 2 },
] as const;

export interface CertificationServiceItemSeed {
  code: string;
  badgeCode: string | null;
  categoryCode: string;
  name: string;
  type: CertificationServiceType;
  shortDescription: string;
  applicableNeeds: readonly CertificationNeed[];
  applicableIndustries: readonly string[];
  versionNote: string | null;
  sortOrder: number;
}

/**
 * 第一批固定 9 項種子資料。舊版 29 項規格作廢，BNI 與其他產業／產品認證
 * （HACCP、FSSC 22000、CE、UL、RoHS、Halal、OEKO-TEX、GOTS、GRS、FSC 等）
 * 本輪一律不建立服務項目。badgeCode 對應 shared/badges.ts 既有穩定代碼，
 * 找不到對應徽章時為 null（例如 ISO/IEC 27001 目前沒有既有徽章）——不因此
 * 新增或修改 shared/badges.ts 既有徽章清單。
 */
export const CERTIFICATION_SERVICE_ITEM_SEEDS: readonly CertificationServiceItemSeed[] = [
  {
    code: "iso-9001",
    badgeCode: "iso-9001",
    categoryCode: "iso-management",
    name: "ISO 9001 品質管理系統",
    type: "管理系統",
    shortDescription: "建立品質管理制度，確保產品與服務品質穩定一致，是最常被客戶或投標要求的基礎管理系統認證。",
    applicableNeeds: ["客戶要求", "投標需求", "品質管理"],
    applicableIndustries: ["製造業", "電子業", "金屬加工", "紡織業"],
    versionNote: null,
    sortOrder: 0,
  },
  {
    code: "iso-14001",
    badgeCode: "iso-14001",
    categoryCode: "iso-management",
    name: "ISO 14001 環境管理系統",
    type: "管理系統",
    shortDescription: "建立企業環境管理制度，系統性降低營運過程對環境造成的衝擊，常與客戶永續採購要求並列。",
    applicableNeeds: ["客戶要求", "投標需求", "環境管理"],
    applicableIndustries: ["製造業", "化工業", "金屬加工"],
    versionNote: null,
    sortOrder: 1,
  },
  {
    code: "iso-45001",
    badgeCode: "iso-45001",
    categoryCode: "iso-management",
    name: "ISO 45001 職業安全衛生管理系統",
    type: "管理系統",
    shortDescription: "建立職業安全衛生管理制度，保障員工工作場所安全與健康，降低職災風險。",
    applicableNeeds: ["職業安全衛生", "投標需求"],
    applicableIndustries: ["製造業", "營建相關供應鏈", "金屬加工"],
    versionNote: null,
    sortOrder: 2,
  },
  {
    code: "iso-50001",
    badgeCode: "iso-50001",
    categoryCode: "iso-management",
    name: "ISO 50001 能源管理系統",
    type: "管理系統",
    shortDescription: "建立能源管理制度，持續提升能源使用效率，為後續碳盤查與減碳行動打好基礎。",
    applicableNeeds: ["能源管理", "環境管理"],
    applicableIndustries: ["製造業", "電子業", "化工業"],
    versionNote: null,
    sortOrder: 3,
  },
  {
    code: "iso-27001",
    badgeCode: null,
    categoryCode: "iso-management",
    name: "ISO/IEC 27001 資訊安全管理系統",
    type: "管理系統",
    shortDescription: "建立資訊安全管理制度，系統性管理資訊資產風險，常見於客戶對供應鏈資安的要求。",
    applicableNeeds: ["客戶要求", "投標需求", "資訊安全"],
    applicableIndustries: ["電子業", "資訊相關製造", "精密製造"],
    versionNote: "現行版本為 ISO/IEC 27001:2022，如企業仍持有 2013 版證書，需留意過渡期限。",
    sortOrder: 4,
  },
  {
    code: "iso-14064-1",
    badgeCode: "iso-14064-1",
    categoryCode: "carbon-assessment",
    name: "ISO 14064-1 組織溫室氣體盤查",
    type: "盤查與量化",
    shortDescription: "完成組織層級溫室氣體排放量盤查與第三方查證，是回應客戶或法規碳盤查要求的第一步。",
    applicableNeeds: ["組織碳盤查", "客戶要求"],
    applicableIndustries: ["製造業", "電子業", "化工業", "金屬加工"],
    versionNote: null,
    sortOrder: 0,
  },
  {
    code: "iso-14067",
    badgeCode: "iso-14067",
    categoryCode: "carbon-assessment",
    name: "ISO 14067 產品碳足跡",
    type: "盤查與量化",
    shortDescription: "依國際標準量化特定產品生命週期的溫室氣體排放量，與組織層級盤查（ISO 14064-1）性質不同。",
    applicableNeeds: ["產品碳足跡", "客戶要求"],
    applicableIndustries: ["製造業", "電子業", "紡織業", "食品業"],
    versionNote: null,
    sortOrder: 1,
  },
  {
    code: "product-carbon-footprint-label",
    badgeCode: "product-carbon-footprint",
    categoryCode: "government-carbon-label",
    name: "產品碳足跡標籤",
    type: "政府標籤",
    shortDescription: "標示產品生命週期碳排放量之政府標籤，需先完成產品碳足跡量化（如 ISO 14067）才能申請。",
    applicableNeeds: ["產品碳足跡"],
    applicableIndustries: ["製造業", "食品業", "消費性產品"],
    versionNote: null,
    sortOrder: 2,
  },
  {
    code: "product-carbon-reduction-label",
    badgeCode: "product-carbon-reduction",
    categoryCode: "government-carbon-label",
    name: "產品碳足跡減量標籤",
    type: "政府標籤",
    shortDescription: "產品碳排放量較基準年顯著減少之政府標籤，需以已取得產品碳足跡標籤為前提申請。",
    applicableNeeds: ["產品碳足跡"],
    applicableIndustries: ["製造業", "食品業", "消費性產品"],
    versionNote: null,
    sortOrder: 3,
  },
] as const;
