/**
 * 公開工廠資料的輸出形狀（Production Hardening Batch 3.1）。
 *
 * - PublicFactorySearchResult：公開搜尋（factory.search 的 items／ads.factory）
 *   與工廠詳情頁「相關工廠」（factory.getSimilar）共用的卡片形狀。明確白名單
 *   （不是「拿完整 row 再刪欄位」）；資料庫層已經只 SELECT 需要的欄位（見
 *   server/db.ts 的 PUBLIC_FACTORY_SEARCH_COLUMNS）。
 * - toPublicFactoryDetail：factory.getById 未授權（公開瀏覽）視角。getFactoryById
 *   同時供 owner／共管者／admin 使用，查詢本身不能縮，這裡只把明顯屬於內部的
 *   欄位從公開輸出拿掉，owner／admin 視角維持原樣。
 */
import type { Factory } from "../drizzle/schema";
import { stripCertificationEvidence, stripHiddenBadgesForPublic } from "../shared/badges";
import type { FactorySearchRow } from "./db";

type SearchCardSource = Pick<FactorySearchRow, Exclude<keyof FactorySearchRow, "updatedAt">>;

export type PublicFactorySearchResult = Omit<SearchCardSource, "certificationBadges" | "certificationBadgesVisible"> & {
  certificationBadgesVisible: string[];
};

export function toPublicFactorySearchResult(f: SearchCardSource): PublicFactorySearchResult {
  const { certificationBadgesVisible } = stripHiddenBadgesForPublic({
    certificationBadges: f.certificationBadges,
    certificationBadgesVisible: f.certificationBadgesVisible,
  });
  return {
    id: f.id,
    name: f.name,
    industry: f.industry,
    subIndustry: f.subIndustry,
    mfgModes: f.mfgModes,
    region: f.region,
    description: f.description,
    capitalLevel: f.capitalLevel,
    foundedYear: f.foundedYear,
    ownerName: f.ownerName,
    contactPersonName: f.contactPersonName,
    phone: f.phone,
    website: f.website,
    address: f.address,
    avgRating: f.avgRating,
    reviewCount: f.reviewCount,
    avatarUrl: f.avatarUrl,
    avatarCrop: f.avatarCrop,
    businessType: f.businessType,
    operationStatus: f.operationStatus,
    certified: f.certified,
    weekdayHours: f.weekdayHours,
    weekendHours: f.weekendHours,
    certificationBadgesVisible,
  };
}

/**
 * 公開詳情頁用不到、且屬於內部／帳號關聯的欄位：
 *   ownerId（使用者帳號 id）、rejectionReason（審核駁回理由，工廠重新通過後
 *   仍可能殘留）、submittedAt（送審時間）、updatedAt（任何後台 CRM／審核操作
 *   都會跳動；公開頁顯示的是 publicContentUpdatedAt）。
 * certificationEvidence／adminNote／contactStatus／deletedAt／隱藏徽章沿用既有
 * stripCertificationEvidence／stripHiddenBadgesForPublic。
 */
export const PUBLIC_DETAIL_OMITTED_FIELDS = ["ownerId", "rejectionReason", "submittedAt", "updatedAt"] as const;

export function toPublicFactoryDetail(factory: Factory) {
  const safe = stripHiddenBadgesForPublic(stripCertificationEvidence(factory));
  const { ownerId, rejectionReason, submittedAt, updatedAt, ...rest } = safe;
  return rest;
}
