// ===== OXM 徽章系統：固定 30 種認證／標章清單 =====
// id、排序為穩定值，新增徽章必須加在陣列末端並延續 sortOrder，不可插入或重排既有項目
// （會影響已儲存在 factories.certificationBadges 的舊資料排序與相容性）。
// sprite 來源：client/public/badges/oxm-certification-badges.svg（Codex 製作，禁止改動）

export type BadgeCategory = "bni" | "company" | "product";

export interface CertificationBadgeDef {
  id: string;
  name: string;
  category: BadgeCategory;
  description: string;
  spriteId: string;
  sortOrder: number;
}

export const BADGE_CATEGORY_LABELS: Record<BadgeCategory, string> = {
  bni: "商務引薦組織",
  company: "企業／工廠認證",
  product: "產品認證／標章",
};

export const CERTIFICATION_BADGES: readonly CertificationBadgeDef[] = [
  { id: "bni", name: "BNI 認證", category: "bni", description: "獲國際商務引薦平台 BNI（Business Network International）認可之會員企業。", spriteId: "bni", sortOrder: 0 },

  { id: "iso-9001", name: "ISO 9001 品質管理系統", category: "company", description: "國際標準化組織品質管理系統認證，確保產品與服務品質穩定一致。", spriteId: "iso-9001", sortOrder: 1 },
  { id: "iso-14001", name: "ISO 14001 環境管理系統", category: "company", description: "落實企業環境管理制度，降低營運過程對環境造成的衝擊。", spriteId: "iso-14001", sortOrder: 2 },
  { id: "iso-45001", name: "ISO 45001 職業安全衛生管理系統", category: "company", description: "建立職業安全衛生管理制度，保障員工工作場所安全與健康。", spriteId: "iso-45001", sortOrder: 3 },
  { id: "iso-14064-1", name: "ISO 14064-1 溫室氣體盤查", category: "company", description: "完成組織溫室氣體排放量盤查與第三方查證。", spriteId: "iso-14064-1", sortOrder: 4 },
  { id: "iso-50001", name: "ISO 50001 能源管理系統", category: "company", description: "建立能源管理制度，持續提升能源使用效率。", spriteId: "iso-50001", sortOrder: 5 },
  { id: "iatf-16949", name: "IATF 16949 汽車業品質管理系統", category: "company", description: "汽車產業供應鏈專用之品質管理系統認證。", spriteId: "iatf-16949", sortOrder: 6 },
  { id: "iso-13485", name: "ISO 13485 醫療器材品質管理系統", category: "company", description: "醫療器材產業專用之品質管理系統認證。", spriteId: "iso-13485", sortOrder: 7 },
  { id: "as9100", name: "AS9100 航太業品質管理系統", category: "company", description: "航太產業供應鏈專用之品質管理系統認證。", spriteId: "as9100", sortOrder: 8 },
  { id: "iso-3834", name: "ISO 3834 金屬熔接品質要求", category: "company", description: "金屬材料熔接製程之國際品質管理要求認證。", spriteId: "iso-3834", sortOrder: 9 },
  { id: "haccp", name: "HACCP 食品安全管制系統", category: "company", description: "危害分析重要管制點（HACCP）食品安全管理制度。", spriteId: "haccp", sortOrder: 10 },
  { id: "iso-22000", name: "ISO 22000 食品安全管理系統", category: "company", description: "國際標準化之食品安全管理系統認證。", spriteId: "iso-22000", sortOrder: 11 },
  { id: "fssc-22000", name: "FSSC 22000 食品安全系統認證", category: "company", description: "全球食品安全倡議（GFSI）認可之食品安全管理系統。", spriteId: "fssc-22000", sortOrder: 12 },
  { id: "brcgs", name: "BRCGS 全球食品安全標準", category: "company", description: "英國零售商協會（BRC）全球食品安全標準認證。", spriteId: "brcgs", sortOrder: 13 },
  { id: "iso-22716", name: "ISO 22716 化妝品優良製造規範", category: "company", description: "化妝品產業優良製造規範（GMP）認證。", spriteId: "iso-22716", sortOrder: 14 },
  { id: "oeko-tex", name: "OEKO-TEX 紡織品環保認證", category: "company", description: "紡織品有害物質檢測與生產環保認證。", spriteId: "oeko-tex", sortOrder: 15 },
  { id: "gots", name: "GOTS 全球有機紡織品標準", category: "company", description: "有機纖維紡織品之全球認證標準，涵蓋生產與加工流程。", spriteId: "gots", sortOrder: 16 },
  { id: "grs", name: "GRS 全球回收標準", category: "company", description: "回收材料含量與供應鏈可追溯性之驗證標準。", spriteId: "grs", sortOrder: 17 },
  { id: "fsc", name: "FSC 森林管理委員會認證", category: "company", description: "永續林業經營與木製品來源之驗證認證。", spriteId: "fsc", sortOrder: 18 },
  { id: "tqf", name: "TQF 台灣優良食品驗證", category: "company", description: "台灣優良食品發展協會食品安全管理驗證方案，驗證食品業者製程與品質管理。", spriteId: "tqf", sortOrder: 19 },
  { id: "halal", name: "Halal 清真認證", category: "company", description: "符合伊斯蘭教規範之清真（Halal）產品認證。", spriteId: "halal", sortOrder: 20 },
  { id: "organic", name: "有機驗證", category: "company", description: "農產品或加工品之有機生產驗證。", spriteId: "organic", sortOrder: 21 },

  { id: "iso-14067", name: "ISO 14067 產品碳足跡", category: "product", description: "產品生命週期溫室氣體排放量化之國際標準。", spriteId: "iso-14067", sortOrder: 22 },
  { id: "product-carbon-footprint", name: "產品碳足跡標籤", category: "product", description: "標示產品生命週期碳排放量之標章。", spriteId: "product-carbon-footprint", sortOrder: 23 },
  { id: "product-carbon-reduction", name: "產品碳足跡減量標籤", category: "product", description: "產品碳排放量較基準年顯著減少之標章。", spriteId: "product-carbon-reduction", sortOrder: 24 },
  { id: "bsmi", name: "BSMI 商品檢驗標識", category: "product", description: "經濟部標準檢驗局商品安全檢驗合格標識。", spriteId: "bsmi", sortOrder: 25 },
  { id: "cns", name: "CNS 正字標記", category: "product", description: "符合中華民國國家標準（CNS）之正字標記認證。", spriteId: "cns", sortOrder: 26 },
  { id: "ce", name: "CE 歐盟符合性認證", category: "product", description: "產品符合歐盟安全、健康與環保法規要求之標識。", spriteId: "ce", sortOrder: 27 },
  { id: "ul", name: "UL 安全認證", category: "product", description: "美國保險商實驗室（UL）產品安全測試認證。", spriteId: "ul", sortOrder: 28 },
  { id: "rohs", name: "RoHS 有害物質限用指令", category: "product", description: "電子電機產品有害物質限用合規認證。", spriteId: "rohs", sortOrder: 29 },
] as const;

export const CERTIFICATION_BADGE_IDS: readonly string[] = CERTIFICATION_BADGES.map(b => b.id);
export const CERTIFICATION_BADGE_ID_SET: ReadonlySet<string> = new Set(CERTIFICATION_BADGE_IDS);
export const CERTIFICATION_BADGE_MAP: Readonly<Record<string, CertificationBadgeDef>> =
  Object.fromEntries(CERTIFICATION_BADGES.map(b => [b.id, b]));

export const BNI_BADGE_ID = "bni" as const;

/** 依固定排序（BNI 永遠第一）過濾並排序徽章 id 陣列，未知 id 一律捨棄。 */
export function sortBadgeIds(ids: readonly string[]): string[] {
  const unique = Array.from(new Set(ids));
  return unique
    .filter(id => CERTIFICATION_BADGE_ID_SET.has(id))
    .sort((a, b) => CERTIFICATION_BADGE_MAP[a].sortOrder - CERTIFICATION_BADGE_MAP[b].sortOrder);
}

export function isValidBadgeId(id: unknown): id is string {
  return typeof id === "string" && CERTIFICATION_BADGE_ID_SET.has(id);
}

export const MAX_EVIDENCE_IMAGES_PER_BADGE = 5;
export const MAX_EVIDENCE_IMAGES_TOTAL = 30;
export const MAX_EVIDENCE_DESCRIPTION_LENGTH = 500;

export interface CertificationEvidenceEntry {
  badgeId: string;
  description: string;
  imageUrls: string[];
}

/**
 * 白名單清洗 evidence 陣列：只保留合法 badgeId 且該 id 有在目前選擇的
 * badges 清單中（避免殘留已移除徽章的證明資料）、去重、裁切數量與長度上限、
 * 圖片 URL 只接受 http(s)。用於 server 端寫入前的最終防線，也是可離線
 * 執行的純函式（不連線 DB），供安全測試直接驗證。
 */
export function sanitizeCertificationEvidence(
  evidence: unknown,
  selectedBadgeIds: readonly string[],
): CertificationEvidenceEntry[] {
  if (!Array.isArray(evidence)) return [];
  const selectedSet = new Set(selectedBadgeIds);
  const seen = new Set<string>();
  const result: CertificationEvidenceEntry[] = [];
  let totalImages = 0;

  for (const raw of evidence) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const badgeId = entry.badgeId;
    if (typeof badgeId !== "string" || !isValidBadgeId(badgeId)) continue;
    if (!selectedSet.has(badgeId)) continue;
    if (seen.has(badgeId)) continue;
    seen.add(badgeId);

    const description = typeof entry.description === "string"
      ? entry.description.slice(0, MAX_EVIDENCE_DESCRIPTION_LENGTH)
      : "";

    const rawImages = Array.isArray(entry.imageUrls) ? entry.imageUrls : [];
    const imageUrls: string[] = [];
    for (const url of rawImages) {
      if (imageUrls.length >= MAX_EVIDENCE_IMAGES_PER_BADGE) break;
      if (totalImages >= MAX_EVIDENCE_IMAGES_TOTAL) break;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
      imageUrls.push(url);
      totalImages++;
    }

    result.push({ badgeId, description, imageUrls });
  }

  return result;
}

/**
 * badges + evidence 一律成對清洗的共用進入點：db.updateFactory()（draft／rejected
 * 直接儲存）與 approveRevisionAtomic()（核准修改申請時套用）都呼叫這個函式，
 * 避免兩處各自實作、行為漂移。純函式，不連線 DB，安全測試可直接驗證。
 */
export function sanitizeBadgeAssignment(
  badgeIds: unknown,
  evidence: unknown,
): { certificationBadges: string[]; certificationEvidence: CertificationEvidenceEntry[] } {
  const certificationBadges = sortBadgeIds(Array.isArray(badgeIds) ? (badgeIds as string[]) : []);
  const certificationEvidence = sanitizeCertificationEvidence(evidence, certificationBadges);
  return { certificationBadges, certificationEvidence };
}

/**
 * certificationEvidence（工廠私密證明說明＋圖片 URL）只供 owner／有效共管者／
 * admin 審核使用。任何公開 tRPC 回應（搜尋結果、公開工廠詳情、廣告輪播）
 * 一律透過這個 helper 移除，只保留公開的 certificationBadges id 清單。
 */
export function stripCertificationEvidence<T extends Record<string, any>>(factory: T): Omit<T, "certificationEvidence"> {
  const { certificationEvidence, ...rest } = factory;
  return rest;
}
