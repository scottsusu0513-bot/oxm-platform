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
import type { Factory, Product } from "../drizzle/schema";
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

// ─────────────────────────────────────────────────────────────────────────
// Batch 3.4：小型明確白名單 DTO（不是通用框架）。一律逐欄建構，不展開 row、不用
// Omit<DBRow>——schema 以後新增的欄位不會自動跑進 client response。
// ─────────────────────────────────────────────────────────────────────────

/**
 * 工廠「卡片」形狀：詳情頁底部相關工廠（RelatedFactoryCard／Marquee）與收藏清單
 * （FavoriteFactoriesPanel）實際讀取的 11 個欄位（對應 client 的
 * RelatedFactoryCardData）。刻意不含 ownerId、rejectionReason、submittedAt、
 * updatedAt、adminNote、contactStatus、deletedAt、聯絡資料等任何非卡片欄位。
 */
export type FactoryCardSource = Pick<Factory,
  "id" | "name" | "avatarUrl" | "avatarCrop" | "businessType" | "industry" | "subIndustry" |
  "region" | "mfgModes" | "avgRating" | "reviewCount">;

export type FactoryCardDTO = {
  id: number;
  name: string;
  avatarUrl: string | null;
  avatarCrop: Factory["avatarCrop"];
  businessType: Factory["businessType"];
  industry: Factory["industry"];
  subIndustry: Factory["subIndustry"];
  region: string;
  mfgModes: Factory["mfgModes"];
  avgRating: Factory["avgRating"];
  reviewCount: Factory["reviewCount"];
};

export function toFactoryCardDTO(f: FactoryCardSource): FactoryCardDTO {
  return {
    id: f.id,
    name: f.name,
    avatarUrl: f.avatarUrl,
    avatarCrop: f.avatarCrop,
    businessType: f.businessType,
    industry: f.industry,
    subIndustry: f.subIndustry,
    region: f.region,
    mfgModes: f.mfgModes,
    avgRating: f.avgRating,
    reviewCount: f.reviewCount,
  };
}

/**
 * 公開工廠詳情內嵌的商品：FactoryDetailView／FactoryDetail／ChatPage（新對話帶入
 * 商品名稱）實際讀取的欄位。不含 factoryId（呼叫端本來就知道是哪間工廠）、
 * createdAt、updatedAt。owner／共管者／admin 視角不經過這裡。
 */
export type PublicProductDTO = Pick<Product,
  "id" | "categoryId" | "name" | "priceMin" | "priceMax" | "priceType" |
  "acceptSmallOrder" | "provideSample" | "description" | "images" | "imageCrops">;

export function toPublicProductDTO(p: PublicProductDTO): PublicProductDTO {
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    priceType: p.priceType,
    acceptSmallOrder: p.acceptSmallOrder,
    provideSample: p.provideSample,
    description: p.description,
    images: p.images,
    imageCrops: p.imageCrops,
  };
}

/** db.getReviewsByFactory 的列（含內部欄位，只在 server 端使用）。 */
export type ReviewByFactoryRow = {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: Date;
  userId: number;
  userName: string | null;
  reply: string | null;
  repliedAt: Date | null;
  reviewType: string | null;
  collaborationOrderId: number | null;
  projectName: string | null;
};

/**
 * 公開評價：不公開評價者 userId、合作確認單 id。「這是我的評價」改由 server 依
 * 目前登入者判斷後回傳 isMine（未登入一律 false）。
 */
export type PublicReviewDTO = {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: Date;
  userName: string | null;
  reply: string | null;
  repliedAt: Date | null;
  reviewType: string | null;
  projectName: string | null;
  isMine: boolean;
};

export function toPublicReviewDTO(r: ReviewByFactoryRow, viewerUserId: number | null | undefined): PublicReviewDTO {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    userName: r.userName,
    reply: r.reply,
    repliedAt: r.repliedAt,
    reviewType: r.reviewType,
    projectName: r.projectName,
    isMine: viewerUserId != null && r.userId === viewerUserId,
  };
}
