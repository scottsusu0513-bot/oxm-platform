/**
 * General（非 AI）搜尋的 relevance signals／tier（見對話中「General mode
 * relevance ranking」）。
 *
 * 背景：上一輪 audit 用正式站真實資料證實 General mode 目前完全沒有
 * relevance 概念，只靠 `avgRating DESC, reviewCount DESC` 排序——導致
 * subIndustry 精準命中、公司名稱命中這種強訊號的工廠，可能因為評分較低被
 * 排到「description 剛好帶到關鍵字」這種弱訊號工廠後面（真實案例：CNC/
 * 模具/塑膠，見稽核報告）。
 *
 * 這裡只做「所有搜尋都能知道的 literal/basic signals」（factory name／
 * subIndustry／product name／main industry／description 是否命中），刻意
 * **不**加入 AI intent 訊號（synonym／AI 推測的 main／sub industry）——那些
 * 只有 AI mode 才有，繼续留在 `computeMatchTier`（本輪不改）。
 *
 * Normalization 保守：trim、英文轉小寫、連續空白收斂——不做 fuzzy／拼音／
 * 繁簡／錯字校正（跟 server/factory-name-index.ts normalizeFactoryName、
 * shared/subIndustryKeywordMatch.ts 的既有原則一致）。
 */

export interface SearchMatchSignals {
  factoryNameExact: boolean;
  factoryNameContains: boolean;
  subIndustryExact: boolean;
  productNameExact: boolean;
  productNameContains: boolean;
  mainIndustryExact: boolean;
  factoryDescriptionContains: boolean;
  productDescriptionContains: boolean;
}

export interface SearchMatchFactoryInput {
  name: string;
  description?: string | null;
  industry?: string[] | null;
  subIndustry?: string[] | null;
}

export interface SearchMatchProductInput {
  name: string;
  description?: string | null;
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 純函式，不做任何 I/O。給定一間工廠（含其 products）與使用者關鍵字，回傳
 * 這間工廠命中了哪些 literal/basic 訊號。多個 product 只要任一個命中某個
 * 訊號，該訊號就是 true（不累加、不記命中幾次——見對話中「多重命中處理：
 * 取最高 tier，不要把多重命中累加成 score」，這裡對應的是「單一訊號本身只
 * 是 boolean，不是次數」）。
 */
export function computeSearchMatchSignals(
  factory: SearchMatchFactoryInput,
  keyword: string,
  products: readonly SearchMatchProductInput[],
  subIndustryMatches: readonly string[] = [],
): SearchMatchSignals {
  const kw = normalize(keyword);
  const name = normalize(factory.name);
  const description = factory.description ? normalize(factory.description) : "";
  const industry = (factory.industry ?? []).map(normalize);
  const subIndustry = factory.subIndustry ?? [];

  const factoryNameExact = kw.length > 0 && name === kw;
  const factoryNameContains = !factoryNameExact && kw.length > 0 && name.includes(kw);
  const mainIndustryExact = kw.length > 0 && industry.includes(kw);
  const factoryDescriptionContains = kw.length > 0 && description.includes(kw);
  const subIndustryExact = subIndustryMatches.length > 0 && subIndustry.some(s => subIndustryMatches.includes(s));

  let productNameExact = false;
  let productNameContains = false;
  let productDescriptionContains = false;
  if (kw.length > 0) {
    for (const p of products) {
      const pName = normalize(p.name);
      const pDesc = p.description ? normalize(p.description) : "";
      if (pName === kw) productNameExact = true;
      else if (pName.includes(kw)) productNameContains = true;
      if (pDesc.includes(kw)) productDescriptionContains = true;
    }
  }

  return {
    factoryNameExact,
    factoryNameContains,
    subIndustryExact,
    productNameExact,
    productNameContains,
    mainIndustryExact,
    factoryDescriptionContains,
    productDescriptionContains,
  };
}

/**
 * Explicit tier（precedence label，不是 numeric score——見對話中「本輪不要
 * 用 magic numeric score」）。同一工廠命中多個 signal 時取最高 tier，不做
 * 累加。
 *
 *   Tier 6：factory name exact
 *   Tier 5：factory name contains
 *   Tier 4：product name exact，或 subIndustry exact taxonomy match
 *           （兩者視為同一強度——見對話中「product name exact >= subIndustry
 *           exact」的結論：使用者搜尋一個精確的產品名稱／taxonomy 詞，都是
 *           非常明確的意圖訊號，不強行分先後）
 *   Tier 3：product name contains
 *   Tier 2：main industry exact
 *   Tier 1：factory description contains
 *   Tier 0：product description contains，或完全沒有以上訊號（fallback）
 */
export function computeGeneralMatchTier(signals: SearchMatchSignals): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (signals.factoryNameExact) return 6;
  if (signals.factoryNameContains) return 5;
  if (signals.productNameExact || signals.subIndustryExact) return 4;
  if (signals.productNameContains) return 3;
  if (signals.mainIndustryExact) return 2;
  if (signals.factoryDescriptionContains) return 1;
  return 0;
}
