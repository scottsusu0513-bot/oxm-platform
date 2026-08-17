import type { Factory } from "../../drizzle/schema";

/**
 * Phase 6A：AI 找工廠——搜尋結果送進聊天 UI（以及未來若要送進模型摘要時）的
 * 安全白名單投影，比照 server/ai/factoryContext.ts 的 AiFactoryContext 同一種
 * 慣例，但這裡是「搜尋結果卡片」用途（需要 id 才能組出 /factory/:id 連結、
 * 需要 avgRating/reviewCount/certified/operationStatus/avatarUrl 才能顯示卡片），
 * 跟 AiFactoryContext（單一登入使用者「自己公司」的 LLM context）是兩個不同
 * 使用情境，故意分開定義，不要互相借用對方的欄位集合。
 *
 * 明確排除（絕不可出現在這裡）：ownerId、ownerName、contactPersonName、
 * phone、website、contactEmail、certificationBadges（完整持有清單，只給
 * certificationBadgesVisible 這個公開子集）、certificationEvidence、
 * contactStatus、adminNote、rejectionReason、submittedAt、deletedAt、
 * avgResponseHours、weekdayHours/weekendHours、businessNote、
 * avatarCrop/coverCrop/coverImageUrl（顯示用中繼資料，卡片不需要）、
 * createdAt/updatedAt。
 */
export interface AiFactorySearchResultItem {
  id: number;
  companyName: string;
  industry: string[];
  subIndustry: string[];
  region: string;
  businessType: string;
  foundedYear: number | null;
  capitalLevel: string;
  mfgModes: string[];
  description: string;
  avgRating: number;
  reviewCount: number;
  certified: boolean;
  certificationBadgesVisible: string[];
  operationStatus: string;
  avatarUrl: string | null;
}

export function toAiFactorySearchResultItem(f: Factory): AiFactorySearchResultItem {
  return {
    id: f.id,
    companyName: f.name,
    industry: (f.industry as string[] | null) ?? [],
    subIndustry: (f.subIndustry as string[] | null) ?? [],
    region: f.region,
    businessType: f.businessType,
    foundedYear: f.foundedYear ?? null,
    capitalLevel: f.capitalLevel,
    mfgModes: (f.mfgModes as string[] | null) ?? [],
    description: f.description ?? "",
    avgRating: Number(f.avgRating ?? 0),
    reviewCount: f.reviewCount ?? 0,
    certified: f.certified,
    certificationBadgesVisible: (f.certificationBadgesVisible as string[] | null) ?? [],
    operationStatus: f.operationStatus,
    avatarUrl: f.avatarUrl ?? null,
  };
}
