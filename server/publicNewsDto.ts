/**
 * 公開消息的輸出形狀（Production Hardening Batch 3.4）——明確白名單，逐欄建構。
 *
 * db.listPublicNews／getPublishedNewsBySlug 回傳完整 news 資料列（SEO／og meta 與
 * 既有測試仍直接使用），公開 API 只輸出這裡列出的欄位：
 *   - 列表不帶完整正文 content（列表頁只顯示標題／摘要／標籤／日期）
 *   - 列表與詳情都不帶 createdBy（管理員 user id）、emailNotificationSentAt、
 *     coverImageKey（儲存 key）、status（只有已發布的消息會被公開查到）、
 *     createdAt／updatedAt 等內部欄位
 * 附件沿用 db.getNewsAttachmentsPublic 本來就是明確投影的公開形狀。
 */
import type { News } from "../drizzle/schema";

type PublicNewsBase = Pick<News,
  "id" | "slug" | "title" | "summary" | "isImportant" | "isCompetition" | "isExhibition" |
  "isCrossIndustry" | "publishedAt" | "firstPublishedAt">;

export type PublicNewsListItemDTO = PublicNewsBase & { industryNames: string[]; isRead: boolean };

export function toPublicNewsListItem(n: PublicNewsBase & { industryNames: string[]; isRead: boolean }): PublicNewsListItemDTO {
  return {
    id: n.id,
    slug: n.slug,
    title: n.title,
    summary: n.summary,
    isImportant: n.isImportant,
    isCompetition: n.isCompetition,
    isExhibition: n.isExhibition,
    isCrossIndustry: n.isCrossIndustry,
    publishedAt: n.publishedAt,
    firstPublishedAt: n.firstPublishedAt,
    industryNames: n.industryNames,
    isRead: n.isRead,
  };
}

type PublicNewsDetailSource = PublicNewsBase & Pick<News, "content" | "coverImageUrl" | "coverImageAlt" | "sourceName" | "sourceUrl">;

export type PublicNewsDetailDTO<A> = PublicNewsDetailSource & { industryNames: string[]; attachments: A[] };

export function toPublicNewsDetail<A>(n: PublicNewsDetailSource, industryNames: string[], attachments: A[]): PublicNewsDetailDTO<A> {
  return {
    id: n.id,
    slug: n.slug,
    title: n.title,
    summary: n.summary,
    content: n.content,
    isImportant: n.isImportant,
    isCompetition: n.isCompetition,
    isExhibition: n.isExhibition,
    isCrossIndustry: n.isCrossIndustry,
    publishedAt: n.publishedAt,
    firstPublishedAt: n.firstPublishedAt,
    coverImageUrl: n.coverImageUrl,
    coverImageAlt: n.coverImageAlt,
    sourceName: n.sourceName,
    sourceUrl: n.sourceUrl,
    industryNames,
    attachments,
  };
}
