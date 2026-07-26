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

/** 私有徽章證明圖片在 privateStorage bucket 內的固定前綴。 */
export const CERTIFICATION_EVIDENCE_KEY_PREFIX = "certification-evidence";

/**
 * 徽章證明圖片私有 object key 的合法格式：
 * certification-evidence/{factoryId 純數字}/{nanoid}.{jpg|png|webp}
 * 刻意只允許數字 factoryId 與 URL-safe 亂數字元，不接受任何路徑分隔符號、
 * 空白或徽章名稱／認證名稱（例如「ISO/IEC 27001」）被直接拼進路徑。
 */
const CERTIFICATION_EVIDENCE_KEY_PATTERN =
  /^certification-evidence\/\d+\/[A-Za-z0-9_-]{10,40}\.(jpg|png|webp)$/;

export function isValidCertificationEvidenceKey(key: unknown): key is string {
  return typeof key === "string" && CERTIFICATION_EVIDENCE_KEY_PATTERN.test(key);
}

export interface CertificationEvidenceEntry {
  badgeId: string;
  description: string;
  /** privateStorage 內的私有 object key（見 isValidCertificationEvidenceKey），
   *  絕不是可直接存取的網址——資料庫與任何 API 回應都只會出現 key。 */
  imageKeys: string[];
}

/**
 * 白名單清洗 evidence 陣列：只保留合法 badgeId 且該 id 有在目前選擇的
 * badges 清單中（避免殘留已移除徽章的證明資料）、去重、裁切數量與長度上限、
 * 圖片只接受合法格式的私有 object key（見 isValidCertificationEvidenceKey），
 * 不接受任何 http(s) 網址（避免不慎把公開或 presigned URL 存進資料庫）。
 * 用於 server 端寫入前的最終防線，也是可離線執行的純函式（不連線 DB），
 * 供安全測試直接驗證。
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

    const rawImages = Array.isArray(entry.imageKeys) ? entry.imageKeys : [];
    const imageKeys: string[] = [];
    for (const key of rawImages) {
      if (imageKeys.length >= MAX_EVIDENCE_IMAGES_PER_BADGE) break;
      if (totalImages >= MAX_EVIDENCE_IMAGES_TOTAL) break;
      if (!isValidCertificationEvidenceKey(key)) continue;
      imageKeys.push(key);
      totalImages++;
    }

    result.push({ badgeId, description, imageKeys });
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
 * certificationEvidence（工廠私密證明說明＋私有圖片 object key）只供 admin
 * 審核使用——工廠 owner／共管者送出證明圖片後，同樣不得再透過任何 API 取回
 * 這個欄位（見 server/routers.ts 的 factory.getMine／factory.getById 一律
 * 呼叫這個 helper，不分身份）。任何公開 tRPC 回應（搜尋結果、公開工廠詳情、
 * 廣告輪播）也一律透過這個 helper 移除，只保留公開的 certificationBadges
 * id 清單。
 */
export function stripCertificationEvidence<T extends Record<string, any>>(factory: T): Omit<T, "certificationEvidence"> {
  const { certificationEvidence, ...rest } = factory;
  return rest;
}

/**
 * factoryRevisions 的 originalData／proposedData 兩個 JSON 欄位各自都可能
 * 內嵌 certificationEvidence（若該次修改申請有異動徽章）。factory.getById／
 * factory.getMine 回傳給工廠 owner／共管者的 latestRevision 也必須套用跟
 * stripCertificationEvidence 一樣的規則，否則會變成繞過主要欄位的漏洞，讓
 * 工廠端能從 latestRevision.proposedData.certificationEvidence 讀到不該看到
 * 的 object key。
 */
export function stripCertificationEvidenceFromRevision<
  T extends { originalData?: Record<string, any> | null; proposedData?: Record<string, any> | null },
>(revision: T): T {
  const strip = (data: Record<string, any> | null | undefined) => {
    if (!data || typeof data !== "object") return data;
    if (!("certificationEvidence" in data)) return data;
    const { certificationEvidence, ...rest } = data;
    return rest;
  };
  return {
    ...revision,
    originalData: strip(revision.originalData),
    proposedData: strip(revision.proposedData),
  };
}

/**
 * object key 全程只存在伺服器端：uploadBadgeEvidence 上傳成功「當下」就直接
 * 把 key 綁定進 certificationEvidence（見 server/db.ts 的
 * appendFactoryCertificationEvidenceImage），不再像先前設計依賴工廠端把
 * 上傳後拿到的 key 暫存在瀏覽器、等到 factory.update／submitRevision 儲存
 * 時才送回伺服器合併——工廠端現在完全不會經手任何 key，自然也不需要「合併
 * 工廠端這次新上傳的 key」這一步。
 *
 * 純函式，不連線 DB：真正的讀取＋寫入（含 row lock 避免併發上傳互相覆蓋）
 * 在 server/db.ts 的 appendFactoryCertificationEvidenceImage 完成，這裡只
 * 負責「給定目前已存在的 evidence 陣列＋要附加的 badgeId／key，算出附加後
 * 的新陣列」這個沒有副作用的邏輯，方便安全測試直接驗證邊界情況（上限、
 * 找不到既有 entry 時新建等），不需要真的連 DB。
 */
export type AppendEvidenceImageResult =
  | { ok: true; evidence: CertificationEvidenceEntry[]; imageCount: number }
  | { ok: false; reason: "INVALID_BADGE" | "PER_BADGE_LIMIT" | "TOTAL_LIMIT" };

export function appendCertificationEvidenceImage(
  existingEvidence: unknown,
  badgeId: string,
  newKey: string,
): AppendEvidenceImageResult {
  if (!isValidBadgeId(badgeId)) return { ok: false, reason: "INVALID_BADGE" };

  // 用「全部合法徽章」當作 selectedBadgeIds 傳入 sanitize，單純是為了正規化
  // 既有資料格式（去除非法 key／裁切長度），不因為某個徽章「目前沒被勾選」
  // 就把它既有的證明圖片洗掉——是否保留某徽章的 evidence 是
  // applyCertificationEvidenceDescriptions／factory.update／submitRevision
  // 的職責，不是這裡。
  const normalized = sanitizeCertificationEvidence(existingEvidence, CERTIFICATION_BADGE_IDS);
  const totalImages = normalized.reduce((sum, e) => sum + e.imageKeys.length, 0);
  if (totalImages >= MAX_EVIDENCE_IMAGES_TOTAL) return { ok: false, reason: "TOTAL_LIMIT" };

  const idx = normalized.findIndex(e => e.badgeId === badgeId);
  if (idx === -1) {
    const evidence = [...normalized, { badgeId, description: "", imageKeys: [newKey] }];
    return { ok: true, evidence, imageCount: 1 };
  }
  const entry = normalized[idx];
  if (entry.imageKeys.length >= MAX_EVIDENCE_IMAGES_PER_BADGE) return { ok: false, reason: "PER_BADGE_LIMIT" };
  const imageKeys = [...entry.imageKeys, newKey];
  const evidence = [...normalized];
  evidence[idx] = { ...entry, imageKeys };
  return { ok: true, evidence, imageCount: imageKeys.length };
}

/**
 * 工廠端（owner／共管者）只能編輯每個已選徽章的「說明文字」，圖片一律透過
 * appendCertificationEvidenceImage 在上傳當下直接綁定，不會、也不能再經由
 * factory.update／submitRevision 這條路徑異動 imageKeys——因此這裡的
 * clientDescriptions 只允許帶 { badgeId, description }，即使呼叫端夾帶了
 * imageKeys 也會被忽略（zod 輸入 schema 已經沒有這個欄位，這裡再次確保
 * 就算未來 schema 不慎鬆綁，這個函式本身也不會讀取／採用任何 client 端
 * 傳入的 imageKeys）。既有 key 一律從資料庫目前實際存的內容原封不動帶入。
 * 純函式，不連線 DB，安全測試可直接驗證。
 */
export function applyCertificationEvidenceDescriptions(
  existingEvidence: unknown,
  clientDescriptions: unknown,
  selectedBadgeIds: readonly string[],
): CertificationEvidenceEntry[] {
  const existing = sanitizeCertificationEvidence(existingEvidence, CERTIFICATION_BADGE_IDS);
  const existingByBadge = new Map(existing.map(e => [e.badgeId, e]));

  const descByBadge = new Map<string, string>();
  const rawList = Array.isArray(clientDescriptions) ? clientDescriptions : [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const badgeId = entry.badgeId;
    if (typeof badgeId !== "string" || !isValidBadgeId(badgeId)) continue;
    const description = typeof entry.description === "string"
      ? entry.description.slice(0, MAX_EVIDENCE_DESCRIPTION_LENGTH)
      : "";
    descByBadge.set(badgeId, description);
  }

  const selectedIds = sortBadgeIds(selectedBadgeIds);
  return selectedIds.map(badgeId => {
    const existingEntry = existingByBadge.get(badgeId);
    const description = descByBadge.has(badgeId) ? descByBadge.get(badgeId)! : (existingEntry?.description ?? "");
    return { badgeId, description, imageKeys: existingEntry?.imageKeys ?? [] };
  });
}

/** 工廠端（owner／共管者）可見的「消毒後」證明圖片狀態——只有數量與是否已
 *  上傳，絕不含 imageKeys 或任何網址。用於 factory.getById／getMine 回應，
 *  讓工廠重新整理頁面後仍能看到已上傳狀態與先前填寫的說明文字，但無法取得
 *  或推導出任何 object key。*/
export interface CertificationEvidenceSummaryEntry {
  badgeId: string;
  description: string;
  hasEvidence: boolean;
  imageCount: number;
}

export function summarizeCertificationEvidenceForOwner(evidence: unknown): CertificationEvidenceSummaryEntry[] {
  const normalized = sanitizeCertificationEvidence(evidence, CERTIFICATION_BADGE_IDS);
  return normalized.map(e => ({
    badgeId: e.badgeId,
    description: e.description,
    hasEvidence: e.imageKeys.length > 0,
    imageCount: e.imageKeys.length,
  }));
}
