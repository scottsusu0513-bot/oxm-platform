import { COOKIE_NAME, THIRTY_DAYS_MS, COMMUNITY_FEATURE_STATUS, PLATFORM_NOTIFICATION_TYPES, COMMUNITY_PUBLIC_ENTRY_ENABLED, ADVISOR_DISPLAY_NAME } from "@shared/const";
import { validateOrderDateChain } from "@shared/orderDateChain";
import { COLLABORATION_ORDER_STAGE_LABELS, isStageTransitionEarly } from "@shared/collaborationOrderStage";
import { sdk } from "./_core/sdk";
import { enhanceSearchKeyword, getSearchIntent } from './semantic-search';
import { sendNewInquiryEmail, sendFactoryApprovedEmail, sendFactoryRejectedEmail, sendFactorySubmittedEmail, sendReportEmail, sendSupportTicketEmail, sendReviewReplyEmail, sendNewMessageNotificationEmail, sendReportStatusUpdateEmail, sendTicketStatusUpdateEmail, sendMessageReplyNotificationEmail, sendEmailVerificationEmail, sendAdminBroadcastEmail, sendRevisionSubmittedEmail, sendRevisionApprovedEmail, sendRevisionRejectedEmail, sendUpgradeApplicationEmail, sendUpgradeNewCaseConsultantEmail, sendPlatformAnnouncementEmail, sendFirstContactEmail, sendNewsEmail } from './email';
import { sha256Hex, generateRawToken } from './_core/oauthHelpers';
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, badgeEvidenceUploadProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { notifyOwner } from "./_core/notification";
import { storagePut, storagePresignedUrl, storageDelete } from "./storage";
import { validateImageUpload } from "./_core/security";
import { INDUSTRY_OPTIONS, TAIWAN_REGIONS, CAPITAL_OPTIONS, INDUSTRY_SLUGS } from "../shared/constants";
import { SHORT_VIDEO_SERVICE_KEYS, SHORT_VIDEO_GOAL_KEYS, SHORT_VIDEO_PLATFORM_KEYS, SHORT_VIDEO_STATUS_TRANSITIONS, SHORT_VIDEO_STATUS_LABELS } from "../shared/shortVideoMarketing";
import { CERTIFICATION_STATUS_TRANSITIONS, CERTIFICATION_STATUS_LABELS } from "../shared/certificationCase";
import { ERP_NEED_TYPE_KEYS, ERP_STATUS_TRANSITIONS, ERP_STATUS_LABELS } from "../shared/erpOptimization";
import { clampImageCrop } from "../shared/imageCrop";
import { stripCertificationEvidence, stripCertificationEvidenceFromRevision, stripHiddenBadgesForPublic, isValidCertificationEvidenceKey, isValidBadgeId, CERTIFICATION_EVIDENCE_KEY_PREFIX, applyCertificationEvidenceDescriptions, summarizeCertificationEvidenceForOwner, sortBadgeIds } from "../shared/badges";
import { nanoid } from "nanoid";
import { factories, conversations, reviews, reports, factoryCoManagers, users, upgradeConsultants, type Factory } from "../drizzle/schema";
import { desc, eq, and, sql, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { sendPushToUser, sendPushToRecipients, toPlainPushSummary, toPlainNotificationText } from "./push";
import { createPlatformNotifications } from "./notifications";
import { notifyUser, notifyFactoryMembers, notifyAdmins } from "./notifyHelper";
import { runCollaborationOrderOverdueEmailCheck } from "./orderOverdueCheck";
import {
  isPrivateStorageConfigured,
  privateStorageCreateUploadUrl,
  privateStorageHeadObject,
  privateStorageReadHeadBytes,
  privateStorageDeleteObject,
  privateStorageCopyObject,
  privateStorageCreateDownloadUrl,
  privateStoragePutObject,
  privateStorageCreateViewUrl,
} from "./privateStorage";

// 徽章證明圖片 presigned 檢視網址有效秒數：10 分鐘，落在建議的 10～15 分鐘區間內。
const CERTIFICATION_EVIDENCE_VIEW_URL_TTL_SECONDS = 600;

function requireVerifiedEmail(user: { primaryEmailVerifiedAt: Date | null }): void {
  if (!user.primaryEmailVerifiedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "UNVERIFIED_EMAIL" });
  }
}

// 全站共用「圖片顯示範圍」輸入驗證：所有接受 crop 的 mutation 都用同一個
// schema，並在寫入前一律再跑一次 clampImageCrop()——不只信任前端夾好的值，
// 避免竄改過的 request 直接把不合理數值存進資料庫（見 shared/imageCrop.ts）。
const imageCropObjectSchema = z.object({
  zoom: z.number(),
  posX: z.number(),
  posY: z.number(),
});
const imageCropInputSchema = imageCropObjectSchema.nullable().optional()
  .transform(v => (v === undefined ? undefined : v === null ? null : clampImageCrop(v)));
// 陣列裡的每一格永遠存在（只是可能是 null），不能是 undefined——供
// products.imageCrops 這種「與圖片陣列順序對齊」的欄位使用，跟上面允許
// 整個欄位省略的 imageCropInputSchema 分開。
const imageCropArrayItemSchema = imageCropObjectSchema.nullable()
  .transform(v => (v === null ? null : clampImageCrop(v)));

// ── chat.send 與「首次送出」原子 mutation 共用的通知邏輯 ─────────────────
// 抽出來讓 chat.send（買家傳給已存在對話）與新的 chat.sendFirstMessage
// （買家開新對話時的原子首次送出）共用同一套「首次聯繫 Email 對象判斷」與
// 「通知工廠端」邏輯，避免兩套程式碼各自維護、日後行為漂移。
type FirstContactEntry = { email: string; name: string | null };

async function collectUserToFactoryFirstContactEmails(
  senderUserId: number,
  senderEmail: string | null | undefined,
  factory: Factory,
): Promise<FirstContactEntry[]> {
  const entries: FirstContactEntry[] = [];
  const [owner, coMgrs] = await Promise.all([
    db.getUserById(factory.ownerId),
    db.getFactoryCoManagersFullProfile(factory.id),
  ]);
  if (owner) {
    const alreadyContacted = await db.hasContactBetweenUsers(senderUserId, factory.ownerId);
    if (!alreadyContacted) {
      const s = (owner.notificationSettings as Record<string, boolean> | null) ?? {};
      const emailDest = factory.contactEmail || owner.email;
      if (emailDest && s.newMessage !== false) {
        entries.push({ email: emailDest, name: owner.name });
      }
    }
  }
  for (const cm of coMgrs) {
    if (!cm.email || cm.email === senderEmail) continue;
    const alreadyContacted = await db.hasContactBetweenUsers(senderUserId, cm.userId);
    if (!alreadyContacted) {
      const s = (cm.notificationSettings as Record<string, boolean> | null) ?? {};
      if (s.newMessage !== false) {
        entries.push({ email: cm.email, name: cm.name ?? null });
      }
    }
  }
  return entries;
}

// 副作用（管理員監控信、推播、站內通知）一律在呼叫端確認 DB 寫入（transaction
// commit）成功之後才呼叫，避免 rollback 後仍誤發通知。函式內部全部是
// fire-and-forget，本身不 throw、不需要呼叫端 await。
function notifyFactoryOfNewUserMessage(params: {
  senderUserId: number;
  senderName: string | null | undefined;
  senderEmail: string | null | undefined;
  factory: Factory;
  conversationId: number;
  content: string;
  isAdvisorConv: boolean;
  productName?: string | null;
}): void {
  const { senderUserId, senderName, senderEmail, factory, conversationId, content, isAdvisorConv, productName } = params;

  notifyOwner({
    title: `[OXM] 新客戶詢問 - ${factory.name ?? "工廠"}`,
    content: [
      `工廠名稱：${factory.name}`,
      factory.contactEmail ? `工廠信箱：${factory.contactEmail}` : null,
      productName ? `詢問產品：${productName}` : null,
      `客戶名稱：${senderName ?? "匿名"}`,
      `客戶信箱：${senderEmail ?? "未提供"}`,
      ``,
      `訊息內容：`,
      `「${content.substring(0, 500)}」`,
      ``,
      `請登入 OXM 平台回覆客戶。`,
    ].filter(Boolean).join("\n"),
  }).catch((e) => { console.warn("[chat] notifyOwner 失敗（非嚴重）", e); });

  Promise.all([
    db.getUserById(factory.ownerId),
    db.getFactoryCoManagerUserIdsWithPreferences(factory.id),
  ]).then(([owner, coMgrs]) => {
    const pushIds: number[] = [];
    const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
    if (owner && ownerSettings.pushNewMessage !== false) pushIds.push(factory.ownerId);
    for (const { userId, notificationSettings } of coMgrs) {
      const s = (notificationSettings as Record<string, boolean> | null) ?? {};
      if (s.pushNewMessage !== false) pushIds.push(userId);
    }
    console.log(`[Push:chat] user→factory convId=${conversationId} pushIds=[${pushIds.join(",")}] excludeSenderId=${senderUserId} ownerPushNewMessage=${ownerSettings.pushNewMessage ?? "unset(default:send)"}`);
    return sendPushToRecipients({
      userIds: pushIds,
      excludeUserId: senderUserId,
      title: "OXM 有新的詢問訊息",
      body: `${isAdvisorConv ? ADVISOR_DISPLAY_NAME : (senderName ?? "客戶")} 傳來一則新訊息`,
      data: {
        type: "chat_message",
        conversationId: String(conversationId),
        targetPath: `/chat/${conversationId}`,
      },
    });
  }).catch((e) => { console.warn("[Push] chat.send factory push error", e); });

  Promise.all([
    Promise.resolve(factory.ownerId),
    db.getActiveCoManagerUserIds(factory.id),
  ]).then(([ownerId, coMgrIds]) => {
    const recipientIds = Array.from(new Set([ownerId, ...coMgrIds])).filter(id => id !== senderUserId);
    if (recipientIds.length === 0) return;
    return createPlatformNotifications(recipientIds.map(uid => ({
      recipientUserId: uid,
      actorUserId: senderUserId,
      actorName: isAdvisorConv ? ADVISOR_DISPLAY_NAME : (senderName ?? senderEmail ?? ""),
      eventType: "chat_message",
      eventGroup: "chat",
      message: `${isAdvisorConv ? ADVISOR_DISPLAY_NAME : (senderName ?? "客戶")} 傳了一則新詢問訊息`,
      actionUrl: `/chat/${conversationId}`,
      dedupeKey: `chat_message:conv:${conversationId}:r:${uid}:ts:${Date.now()}`,
    })));
  }).catch(() => {});
}

/**
 * 找消息分眾通知的實際寄送入口：蒐集去重後的收件人 → 三層分別處理：
 *   1) 站內通知（communityNotifications）：只要看板訂閱資格符合就一律建立，
 *      不受 news／pushNews 開關影響，同步 await 完成（單純批次 insert，很快）。
 *   2) Email：news!==false 的人才建立 pending 紀錄並寄送。
 *   3) Push：pushNews!==false 的人才建立 pending 紀錄並發送。
 * Email／Push 各自 fire-and-forget、互不阻塞，單一使用者寄送失敗不會中斷
 * 整批（loop 內 try/catch，見下方）。呼叫端只在「這次更新真的是第一次
 * draft→published」時才會呼叫這個函式（見 db.createNews／db.updateNews 的
 * shouldNotify）。一律不把 Email 位址／Push token 印進 console，只印 userId。
 */
export async function dispatchNewsNotifications(params: {
  newsId: number;
  title: string;
  summary: string;
  slug: string;
  isImportant: boolean;
  isCompetition: boolean;
  isExhibition: boolean;
  isCrossIndustry: boolean;
  industryNames: string[];
  // 只有 news.create 在「首次建立即發布」時，依管理員勾選的「同時發送
  // Email 通知」checkbox 決定這個值；news.update 觸發的分眾通知（例如草稿
  // 之後才被編輯發布）一律固定傳 false，不會寄送 Email，也不會補寫
  // emailNotificationSentAt——只控制下方 Email 這一段分支，站內通知／Push
  // 完全不受影響，一律照舊執行。
  sendEmail: boolean;
}): Promise<void> {
  const recipients = await db.gatherNewsRecipients({
    isImportant: params.isImportant,
    isCompetition: params.isCompetition,
    isExhibition: params.isExhibition,
    isCrossIndustry: params.isCrossIndustry,
    industryNames: params.industryNames,
  });
  if (recipients.length === 0) {
    console.log(`[news] notify skipped newsId=${params.newsId}: no eligible recipients`);
    return;
  }

  // 通知標題一律清成純文字再送出（Email 主旨、Push 標題、站內通知
  // titleSnapshot 三個管道共用同一份，只算一次、不各自呼叫），避免 APP 系統
  // 推播／站內通知中心不解析 Markdown、把 **粗體** 這類格式符號原樣顯示給
  // 使用者。這裡刻意不修改 params.title 本身（news.title 原始資料不受影響），
  // plainTitle 只是這次 dispatch 過程中用來產生通知內容的暫時衍生值。
  const plainTitle = toPlainNotificationText(params.title);

  // 站內通知：看板訂閱資格 = 收件資格本身，不看 news／pushNews。dedupeKey
  // 確保同一篇消息＋同一使用者最多一筆，即便 recipients 因為 bug 出現重複
  // 或這支函式被重試也不會建立第二筆（communityNotifications 的 dedupeKey
  // 唯一索引擋下，createPlatformNotifications 內部撞到會 no-op）。
  try {
    await createPlatformNotifications(recipients.map(r => ({
      recipientUserId: r.id,
      eventType: "news",
      eventGroup: "news",
      message: "產業情報中心有新消息",
      titleSnapshot: plainTitle,
      actionUrl: `/news/${params.slug}`,
      dedupeKey: `news:${params.newsId}:user:${r.id}`,
    })));
  } catch (err) {
    console.error(`[news] in-app notification batch failed newsId=${params.newsId}`, err instanceof Error ? err.message : err);
  }

  const emailRecipients = recipients.filter(r => r.email);
  const pushRecipients = recipients.filter(r => r.pushEnabled);

  // Email：只有管理員在「新增產業消息」勾選「同時發送 Email 通知」時
  // （params.sendEmail）才會執行這整段——沒勾選就直接跳過，連
  // createPendingNewsNotifications／sendNewsEmail 都不會被呼叫到，不會建立
  // 任何 pending 紀錄。沿用 announcement 廣播既有的節流／重試模式。
  if (params.sendEmail) (async () => {
    if (emailRecipients.length === 0) return;
    const created = await db.createPendingNewsNotifications(params.newsId, emailRecipients.map(r => r.id), "email");
    if (created.length === 0) return;
    // 已經成功排入既有寄送機制（建立出至少一筆 pending 紀錄）——這裡就標記
    // emailNotificationSentAt，不等下面逐一寄送迴圈全部跑完；個別收件人日後
    // 寄送失敗只會反映在 newsNotifications 各自的 status，不會回頭清掉這個
    // 「這則消息當初確實排入過 Email 通知」的紀錄。
    await db.markNewsEmailNotificationSent(params.newsId);
    const createdMap = new Map(created.map(c => [c.userId, c.id]));
    const INTER_EMAIL_DELAY_MS = 500;
    const RETRY_DELAYS_MS = [1500, 3000, 5000];
    const isRateLimitError = (err: unknown): boolean => {
      if (!err || typeof err !== 'object') return false;
      const e = err as Record<string, unknown>;
      const status = e['statusCode'] ?? e['status'] ?? (e['response'] as Record<string, unknown>)?.['status'];
      return status === 429;
    };

    let successCount = 0, failCount = 0;
    for (const r of emailRecipients) {
      const notifId = createdMap.get(r.id);
      if (notifId == null || !r.email) continue;
      let sent = false, lastErr: unknown;
      for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
          await sendNewsEmail({ toEmail: r.email, toName: r.name, newsTitle: plainTitle, newsSummary: params.summary, newsSlug: params.slug });
          sent = true;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt <= RETRY_DELAYS_MS.length && isRateLimitError(err)) {
            await new Promise(res => setTimeout(res, RETRY_DELAYS_MS[attempt - 1]));
          } else {
            break;
          }
        }
      }
      if (sent) {
        successCount++;
        await db.markNewsNotificationSent(notifId);
      } else {
        failCount++;
        await db.markNewsNotificationFailed(notifId, lastErr instanceof Error ? lastErr.message : String(lastErr));
        console.error(`[news] email failed newsId=${params.newsId} userId=${r.id}`);
      }
      await new Promise(res => setTimeout(res, INTER_EMAIL_DELAY_MS));
    }
    console.log(`[news] email queue done newsId=${params.newsId} success=${successCount} failed=${failCount}`);
  })();

  // Push：逐一寄送以取得每個使用者各自的成功/失敗狀態（sendPushToRecipients
  // 只回傳整批彙總數字，無法對應回各自的通知紀錄），單一使用者失敗不影響其他人。
  (async () => {
    if (pushRecipients.length === 0) return;
    const created = await db.createPendingNewsNotifications(params.newsId, pushRecipients.map(r => r.id), "push");
    if (created.length === 0) return;
    const createdMap = new Map(created.map(c => [c.userId, c.id]));
    const bodyText = toPlainPushSummary(params.summary);

    let successCount = 0, failCount = 0;
    for (const r of pushRecipients) {
      const notifId = createdMap.get(r.id);
      if (notifId == null) continue;
      try {
        const result = await sendPushToUser(r.id, {
          title: plainTitle,
          body: bodyText,
          data: { type: "news", newsId: String(params.newsId), targetPath: `/news/${params.slug}` },
        });
        if (result.status === "sent" && result.successCount > 0) {
          successCount++;
          await db.markNewsNotificationSent(notifId);
        } else if (result.status === "skipped") {
          // 沒有有效裝置 token，視為「無需寄送」而非失敗，避免下次發布流程重跑時無限重試。
          await db.markNewsNotificationSent(notifId);
        } else {
          failCount++;
          await db.markNewsNotificationFailed(notifId, result.status === "error" ? result.message : "push failed");
        }
      } catch (err) {
        failCount++;
        await db.markNewsNotificationFailed(notifId, err instanceof Error ? err.message : String(err));
        console.error(`[news] push failed newsId=${params.newsId} userId=${r.id}`);
      }
    }
    console.log(`[news] push queue done newsId=${params.newsId} success=${successCount} failed=${failCount}`);
  })();
}

/**
 * 管理員限定的「重試本篇失敗通知」：只處理既有 newsNotifications 紀錄裡狀態
 * 是 pending／failed 的那些（db.getRetryableNewsNotifications 的查詢條件本身
 * 就排除了 status='sent'，不需要在這裡另外判斷「是否已寄過」）。涵蓋兩種
 * 情境：pending 紀錄建立後程序中斷、從未真正寄出；以及先前寄送失敗的紀錄。
 * 每個收件人重試前重新讀一次目前的 notificationSettings／email——建立通知
 * 紀錄之後使用者可能才退訂，重試不應該無視這個變化硬寄。單一收件人失敗只
 * 標記那一筆為 failed，不中斷其他人的重試。這個函式不建立任何新的
 * newsNotifications 紀錄，只處理既有紀錄，所以不會因為呼叫這支函式而讓
 * 「編輯已發布消息」意外變成再次通知全體會員。
 */
async function retryNewsNotifications(newsId: number): Promise<{ emailRetried: number; pushRetried: number; total: number }> {
  const item = await db.getNewsById(newsId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息" });

  const retryable = await db.getRetryableNewsNotifications(newsId);
  let emailRetried = 0;
  let pushRetried = 0;
  // 跟 dispatchNewsNotifications 用同一支 helper、同一份清理規則，重試寄送
  // 的標題不會跟第一次寄送的標題不一致。
  const plainTitle = toPlainNotificationText(item.title);

  for (const row of retryable) {
    const user = await db.getUserById(row.userId);
    if (!user || user.deletedAt) {
      await db.markNewsNotificationFailed(row.id, "使用者不存在或已刪除帳號");
      continue;
    }
    const settings = (user.notificationSettings as Record<string, boolean> | null) ?? {};

    if (row.channel === "email") {
      const email = user.primaryEmail ?? user.email;
      if (!email || settings['news'] === false) {
        await db.markNewsNotificationFailed(row.id, !email ? "使用者無 email" : "使用者已退訂找消息 Email");
        continue;
      }
      try {
        await sendNewsEmail({ toEmail: email, toName: user.name, newsTitle: plainTitle, newsSummary: item.summary, newsSlug: item.slug });
        await db.markNewsNotificationSent(row.id);
        emailRetried++;
      } catch (err) {
        await db.markNewsNotificationFailed(row.id, err instanceof Error ? err.message : String(err));
        console.error(`[news] retry email failed newsId=${newsId} userId=${row.userId}`);
      }
    } else {
      if (settings['pushNews'] === false) {
        await db.markNewsNotificationFailed(row.id, "使用者已退訂找消息推播");
        continue;
      }
      try {
        const result = await sendPushToUser(row.userId, {
          title: plainTitle,
          body: toPlainPushSummary(item.summary),
          data: { type: "news", newsId: String(newsId), targetPath: `/news/${item.slug}` },
        });
        if (result.status === "sent" && result.successCount > 0) {
          await db.markNewsNotificationSent(row.id);
          pushRetried++;
        } else if (result.status === "skipped") {
          await db.markNewsNotificationSent(row.id);
        } else {
          await db.markNewsNotificationFailed(row.id, result.status === "error" ? result.message : "push failed");
        }
      } catch (err) {
        await db.markNewsNotificationFailed(row.id, err instanceof Error ? err.message : String(err));
        console.error(`[news] retry push failed newsId=${newsId} userId=${row.userId}`);
      }
    }
  }

  return { emailRetried, pushRetried, total: retryable.length };
}

// Returns null (no filter) for admin or when community is public; otherwise restricts to platform-only types.
function getVisibleTypesForUser(role: string): string[] | null {
  return (role === "admin" || COMMUNITY_PUBLIC_ENTRY_ENABLED)
    ? null
    : Array.from(PLATFORM_NOTIFICATION_TYPES);
}

async function assertFactoryManager(factoryId: number, userId: number) {
  const factory = await db.getFactoryById(factoryId);
  if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
  if (factory.ownerId !== userId) {
    const isCoMgr = await db.isActiveCoManager(factory.id, userId);
    if (!isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限操作此工廠" });
  }
  return factory;
}

// Validates proposedData field types — enforces correct types at submission and approve time.
// All fields are partial since proposedData only includes the fields being changed.
const FactoryBasicDataSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.array(z.string()),
  subIndustry: z.array(z.string()),
  mfgModes: z.array(z.string()),
  region: z.string(),
  description: z.string().nullable(),
  capitalLevel: z.string(),
  foundedYear: z.number().int().nullable(),
  ownerName: z.string().nullable(),
  contactPersonName: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  contactEmail: z.string().nullable(),
  address: z.string(),
  operationStatus: z.enum(["normal", "busy", "full"]),
  weekdayHours: z.string().nullable(),
  weekendHours: z.string().nullable(),
  businessNote: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  avatarCrop: z.object({ zoom: z.number(), posX: z.number(), posY: z.number() }).nullable(),
  certificationBadges: z.array(z.string()).max(30),
  // imageKeys 刻意不在這裡開放：圖片 object key 全程只存在伺服器端（見
  // shared/badges.ts 的 appendCertificationEvidenceImage／
  // applyCertificationEvidenceDescriptions），工廠端只能透過 update／
  // submitRevision 編輯每個徽章的說明文字，即使夾帶 imageKeys 也會被
  // zod 直接忽略（object schema 預設 strip 未知欄位）。
  certificationEvidence: z.array(z.object({
    badgeId: z.string(),
    description: z.string().max(500),
  })).max(30),
}).partial();

// ===== 商案討論區 helpers =====
// Valid space codes: 12 industry slugs + "cross-industry"
const COMMUNITY_CROSS_INDUSTRY_SLUG = "cross-industry" as const;

// Returns the expected URL prefix for community post images uploaded via uploadPostImage.
// The key pattern is community-posts/{userId}/{nanoid}.{ext}
// If S3 is not configured, returns null and validation is skipped (dev/test env).
function getCommunityImageUrlPrefix(userId: number): string | null {
  const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "")
    ?? (process.env.AWS_S3_BUCKET
      ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-southeast-1"}.amazonaws.com`
      : null);
  if (!base) return null;
  return `${base}/community-posts/${userId}/`;
}

function assertCommunityImagesOwned(images: string[], userId: number): void {
  if (images.length === 0) return;
  const s3Bucket = process.env.AWS_S3_BUCKET;
  const s3Region = process.env.AWS_REGION ?? "ap-southeast-1";
  const s3PublicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!s3Bucket && !s3PublicBase) {
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "圖片儲存服務未設定，無法提交圖片" });
    }
    return; // dev/test only: S3 not configured, skip validation
  }
  const expectedOrigin = s3PublicBase
    ? new URL(s3PublicBase).origin
    : `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`;
  const expectedPathPrefix = `/community-posts/${userId}/`;
  for (const urlStr of images) {
    let parsed: URL;
    try { parsed = new URL(urlStr); } catch {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
    if (parsed.origin !== expectedOrigin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath.includes("/..") || !decodedPath.startsWith(expectedPathPrefix)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能使用透過平台上傳的圖片" });
    }
  }
}
const VALID_SPACE_CODES = new Set<string>([
  ...Object.values(INDUSTRY_SLUGS),
  COMMUNITY_CROSS_INDUSTRY_SLUG,
]);

// Reverse mapping: slug → display name (for notifications)
const SPACE_CODE_TO_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INDUSTRY_SLUGS).map(([name, slug]) => [slug, name])),
  [COMMUNITY_CROSS_INDUSTRY_SLUG]: "跨產業交流區",
};
function getSpaceName(spaceCode: string): string {
  return SPACE_CODE_TO_NAME[spaceCode] ?? spaceCode;
}

type TrpcUserCtx = { role: "user" | "admin"; id: number } | null | undefined;

function checkCommunityRead(user: TrpcUserCtx): void {
  if (COMMUNITY_FEATURE_STATUS === "coming_soon" || COMMUNITY_FEATURE_STATUS === "maintenance") {
    throw new TRPCError({ code: "FORBIDDEN", message: "商案討論區尚未開放" });
  }
  if (COMMUNITY_FEATURE_STATUS === "beta" && user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "此功能目前僅限管理員內測使用" });
  }
}

function checkCommunityWrite(user: TrpcUserCtx): void {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  checkCommunityRead(user);
}

function assertValidSpaceCode(spaceCode: string): void {
  if (!VALID_SPACE_CODES.has(spaceCode)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "無效的討論區代碼" });
  }
}

/**
 * 從 mysql2 錯誤中取出 code（例如 "ER_DUP_ENTRY"）。drizzle-orm 透過
 * query builder（.insert()／.update()／.execute()）執行時，不論是否包在
 * db.transaction() 裡，都會把底層 mysql2 錯誤包成新的 Error，並把原始錯誤
 * 的 .code 移到 .cause.code，而不是保留在最外層的 .code——只檢查
 * err.code 會永遠比對不到，讓「攔截 ER_DUP_ENTRY 轉成安全訊息」的分支
 * 形同虛設。這裡同時檢查兩個位置，不論 drizzle 版本或呼叫方式改變都能正確
 * 判斷。
 */
function extractMysqlErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e.code === "string") return e.code;
  if (e.cause && typeof e.cause === "object" && typeof e.cause.code === "string") return e.cause.code;
  return undefined;
}

/**
 * ISO 與低碳認證專區服務項目的 badgeCode 輸入驗證：空白字串一律視為
 * null（「無對應徽章」），非 null 時必須是 shared/badges.ts 既有的穩定
 * 徽章代碼（isValidBadgeId，即 CERTIFICATION_BADGE_ID_SET 成員）——伺服器端
 * 驗證，不只是前端下拉選單限制；不合法直接讓 zod parse 失敗，tRPC 預設就會
 * 把輸入驗證失敗包成 BAD_REQUEST，不需要另外 catch。刻意不建立 DB 外鍵或
 * 第二套徽章資料表，徽章清單本來就是程式碼常數而非資料表，這裡只是唯讀
 * 參照。
 */
const certificationServiceBadgeCodeSchema = z.preprocess(
  (val) => (typeof val === "string" && val.trim() === "" ? null : val),
  z.string().trim().max(50).nullable(),
).refine(
  (val) => val === null || isValidBadgeId(val),
  { message: "無效的徽章代碼：必須是既有徽章清單中的代碼，或選擇「無對應徽章」" },
);

/**
 * 短影音與品牌內容行銷專區申請表 zod schema：獨立宣告成頂層 const 再傳入
 * .input()，而不是寫成 .input(z.object({...})).refine(...)——tRPC 的
 * ProcedureBuilder.input() 回傳值本身沒有 .refine() 方法，.refine() 必須在
 * 呼叫 .input() 之前，直接鏈在 z.object({...}) 這個 ZodObject 上。
 */
const shortVideoApplicationSchema = z.object({
  factoryId: z.number().int().positive(),
  contactName: z.string().min(1).max(100),
  phone: z.string().min(7).max(30).regex(/^[\d\-+() ]{7,20}$/, "電話格式不正確"),
  contactTime: z.string().min(1).max(100),
  servicesWanted: z.array(z.enum(SHORT_VIDEO_SERVICE_KEYS)).max(5),
  isUnsure: z.boolean(),
  primaryGoal: z.enum(SHORT_VIDEO_GOAL_KEYS),
  platforms: z.array(z.enum(SHORT_VIDEO_PLATFORM_KEYS)).max(4),
  noPlatformYet: z.boolean(),
  additionalNotes: z.string().max(2000).optional(),
  consentAgreed: z.literal(true),
})
  // 「不確定」與五項明確服務互斥：isUnsure=true 時 servicesWanted 必須是
  // 空陣列；isUnsure=false 時至少要選一項，不能兩者都空白送出。
  .refine(v => v.isUnsure ? v.servicesWanted.length === 0 : v.servicesWanted.length >= 1, {
    message: "請選擇至少一項服務，或勾選「不確定，希望由顧問協助判斷」",
    path: ["servicesWanted"],
  })
  // 「尚未經營」與其他平台互斥，理由同上。
  .refine(v => v.noPlatformYet ? v.platforms.length === 0 : v.platforms.length >= 1, {
    message: "請選擇目前經營的平台，或勾選「尚未經營」",
    path: ["platforms"],
  });

/**
 * ISO 與低碳認證專區申請表 zod schema：同樣獨立宣告成頂層 const（理由同
 * shortVideoApplicationSchema），servicesWanted 的實際合法值集合是動態的
 * （現有已上架認證服務目錄），這裡只驗證陣列型別與長度，真正的白名單比對
 * 在 mutation 內對 db.listPublicCertificationServices() 即時查詢比對。
 */
const certificationApplicationSchema = z.object({
  factoryId: z.number().int().positive(),
  contactName: z.string().min(1).max(100),
  phone: z.string().min(7).max(30).regex(/^[\d\-+() ]{7,20}$/, "電話格式不正確"),
  contactTime: z.string().min(1).max(100),
  servicesWanted: z.array(z.string().min(1).max(50)).max(20),
  isUnsure: z.boolean(),
  additionalNotes: z.string().max(2000).optional(),
  consentAgreed: z.literal(true),
}).refine(v => v.isUnsure ? v.servicesWanted.length === 0 : v.servicesWanted.length >= 1, {
  message: "請選擇至少一項認證服務，或勾選「不確定，希望由顧問協助判斷」",
  path: ["servicesWanted"],
});

export const appRouter = router({
  system: systemRouter,

  analytics: router({
    record: publicProcedure.input(z.object({ visitorId: z.string().regex(/^[a-zA-Z0-9\-_]+$/).min(1).max(64) })).mutation(async ({ input }) => {
      await db.recordPageView(input.visitorId);
    }),
    getStats: adminProcedure.query(async () => {
      return db.getPageViewStats();
    }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const isLocal = ["localhost", "127.0.0.1", "::1"].includes(ctx.req.hostname);
      const secureFlag = isLocal ? "" : "; Secure";
      ctx.res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`);
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),

    // 設定主要信箱（未驗證，之後再寄驗證信）
    setPrimaryEmail: protectedProcedure.input(z.object({
      email: z.string().email().max(320),
    })).mutation(async ({ ctx, input }) => {
      if (input.email.toLowerCase().endsWith("@privaterelay.appleid.com")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不可使用 Apple 隱藏信箱作為主要信箱" });
      }
      await db.setPrimaryEmail(ctx.user.id, input.email);
      return { success: true };
    }),

    // 寄送驗證信（寄到 primaryEmail）
    sendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user?.primaryEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先設定主要信箱" });
      }
      if (user.primaryEmailVerifiedAt) {
        return { success: true, alreadyVerified: true };
      }
      // Cooldown: prevent re-sending within 5 minutes
      const recent = await db.getLatestEmailVerificationToken(user.id, user.primaryEmail);
      if (recent && recent.createdAt > new Date(Date.now() - 5 * 60 * 1000)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "驗證信已寄出，請稍後再試" });
      }
      const rawToken = generateRawToken();
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.createEmailVerificationToken({ userId: user.id, tokenHash, email: user.primaryEmail, expiresAt });
      const baseUrl = process.env.OAUTH_SERVER_URL || "https://www.oxmmatch.com";
      const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}`;
      try {
        await sendEmailVerificationEmail({
          toEmail: user.primaryEmail,
          userName: user.name,
          verifyUrl,
        });
      } catch (err) {
        console.error("[auth] sendVerificationEmail failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "驗證信寄送失敗，請稍後再試" });
      }
      return { success: true };
    }),

    // 驗證信箱 token（從 email 點連結後呼叫）
    verifyEmail: publicProcedure.input(z.object({
      token: z.string().min(1).max(128),
    })).mutation(async ({ input, ctx }) => {
      const tokenHash = sha256Hex(input.token);
      const result = await db.consumeEmailVerificationToken(tokenHash);
      if (!result.valid || !result.userId || !result.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "TOKEN_INVALID_OR_EXPIRED" });
      }

      // 主帳號制：查是否已有其他 user 驗證同一個 primaryEmail
      const existingVerified = await db.getUserByPrimaryEmail(result.email);

      if (!existingVerified || existingVerified.id === result.userId) {
        // 無衝突：一般流程
        await db.setPrimaryEmailVerified(result.userId, result.email);
        return { success: true, merged: false };
      }

      // 已有主帳號 — 執行綁定合併
      // 安全檢查：暫時 user 是否已有重要資料
      const hasActivity = await db.userHasImportantActivity(result.userId);
      if (hasActivity) {
        throw new TRPCError({ code: "CONFLICT", message: "此帳號已有使用紀錄，請聯繫客服協助合併帳號。" });
      }

      // 取得暫時 user 的所有 provider auth accounts
      const tempAccounts = await db.getAuthAccountsByUserId(result.userId);

      // 檢查主帳號是否已有相同 provider（避免覆蓋）
      for (const acc of tempAccounts) {
        const conflict = await db.getAuthAccountByProviderForUser(existingVerified.id, acc.provider);
        if (conflict) {
          throw new TRPCError({ code: "CONFLICT", message: "此登入方式已綁定到您的既有帳號，請直接使用原登入方式登入。" });
        }
      }

      // 改綁所有 auth accounts 到主帳號，清空暫時 user 的 primaryEmail
      for (const acc of tempAccounts) {
        await db.reassignAuthAccountToUser(acc.id, existingVerified.id);
      }
      await db.clearPrimaryEmail(result.userId);

      // 切換 session 到主帳號（與 OAuth 登入完全一致的 cookie 設定）
      const sessionToken = await sdk.createSessionToken(existingVerified.openId, { expiresInMs: THIRTY_DAYS_MS });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });

      return { success: true, merged: true };
    }),

    // 查目前登入 user 已綁定的 provider 列表
    myLinkedProviders: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await db.getAuthAccountsByUserId(ctx.user.id);
      return accounts.map(a => ({ provider: a.provider, providerEmail: a.providerEmail ?? null }));
    }),
  }),

  // ===== 會員中心 =====
  user: router({
    updateProfile: protectedProcedure.input(z.object({
      name: z.string().min(1).max(100).optional(),
      phone: z.string().max(30).optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.updateUserProfile(ctx.user.id, input);
      return { success: true };
    }),
    updateNotificationSettings: protectedProcedure.input(z.object({
      settings: z.record(z.string(), z.boolean()),
    })).mutation(async ({ ctx, input }) => {
      await db.updateUserNotificationSettings(ctx.user.id, input.settings as Record<string, boolean>);
      return { success: true };
    }),
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      await db.softDeleteUser(ctx.user.id);
      const isLocalReq = ["localhost", "127.0.0.1", "::1"].includes(ctx.req.hostname);
      ctx.res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isLocalReq ? "" : "; Secure"}`);
      return { success: true };
    }),
  }),

  // ===== 客服工單 =====
  support: router({
    create: protectedProcedure.input(z.object({
      type: z.string().min(1).max(50),
      subject: z.string().min(1).max(200),
      description: z.string().min(1).max(5000),
    })).mutation(async ({ ctx, input }) => {
      await db.createSupportTicket({ ...input, userId: ctx.user.id });
      sendSupportTicketEmail({
        userName: ctx.user.name ?? '未知用戶',
        userEmail: ctx.user.email,
        type: input.type,
        subject: input.subject,
        description: input.description,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),
    myTickets: protectedProcedure.query(async ({ ctx }) => {
      return db.getMySupportTickets(ctx.user.id);
    }),
    myTicketHistory: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const myTickets = await db.getMySupportTickets(ctx.user.id);
      if (!myTickets.find(t => t.id === input.id)) throw new Error("無權限");
      return db.getTicketHistory(input.id);
    }),
  }),

  // ===== 工廠 =====
  factory: router({
    getById: publicProcedure.input(z.object({
      id: z.number(),
      // Pass true from FactoryDashboard to include latestRevision without a separate query.
      // Omit (or false) for public browsing to avoid the extra DB round-trip.
      includeRevision: z.boolean().optional().default(false),
    })).query(async ({ input, ctx }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) return null;
      const authedUser = ctx.user;
      let isAuthorized = false;
      // Non-approved factories are only visible to their owner, co-managers, and admins
      if (factory.status !== "approved") {
        if (!authedUser) return null;
        if (authedUser.isAdmin) {
          isAuthorized = true;
        } else {
          const isOwner = factory.ownerId === authedUser.id;
          if (isOwner) {
            isAuthorized = true;
          } else {
            const isCoMgr = await db.isActiveCoManager(factory.id, authedUser.id);
            if (!isCoMgr) return null;
            isAuthorized = true;
          }
        }
      } else if (input.includeRevision && authedUser) {
        // Approved factory: only fetch revision info when explicitly requested by an authorized user
        if (authedUser.isAdmin || factory.ownerId === authedUser.id) {
          isAuthorized = true;
        } else {
          isAuthorized = await db.isActiveCoManager(factory.id, authedUser.id);
        }
      }
      const [prods, latestRevision] = await Promise.all([
        db.getProductsByFactoryId(input.id),
        isAuthorized && input.includeRevision ? db.getLatestRevisionByFactory(input.id) : Promise.resolve(null),
      ]);
      // 徽章證明圖片的實際 object key 只供管理員審核用的專屬 API 讀取（見
      // getCertificationEvidenceViewUrls 改成 admin-only）。factory.getById
      // 從未是管理員審核管道（管理員審核走 admin.getFactoryDetail／
      // admin.getPendingRevisions），即使呼叫者是工廠 owner／共管者本人，
      // certificationEvidence 原始欄位（含 imageKeys）也一律移除；改為
      // 只在有權限查看這筆工廠時，額外附上消毒後的 certificationEvidenceStatus
      // 摘要（只有 badgeId／說明文字／是否已上傳／張數，不含任何 key）。
      // 非授權（一般公開瀏覽）視角：certificationBadges（已獲得徽章完整清單，
      // 可能含工廠自己隱藏的徽章）一律不可見，只留 certificationBadgesVisible。
      // 有權限管理這筆工廠時才能看到完整的 certificationBadges（管理頁需要
      // 用它跟 certificationBadgesVisible 比對，畫出「已獲得徽章」勾選清單）。
      const publicSafeFactory = isAuthorized
        ? stripCertificationEvidence(factory)
        : stripHiddenBadgesForPublic(stripCertificationEvidence(factory));
      const safeLatestRevision = latestRevision ? stripCertificationEvidenceFromRevision(latestRevision) : null;
      const result: Record<string, any> = { ...publicSafeFactory, products: prods, latestRevision: safeLatestRevision };
      if (isAuthorized) {
        result.certificationEvidenceStatus = summarizeCertificationEvidenceForOwner(factory.certificationEvidence);
      }
      return result;
    }),

    getMine: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) return null;
      const [prods, latestRevision] = await Promise.all([
        db.getProductsByFactoryId(factory.id),
        db.getLatestRevisionByFactory(factory.id),
      ]);
      // 同 factory.getById：certificationEvidence 原始欄位對工廠本人也一律
      // 不可見，只回傳消毒後的摘要（certificationEvidenceStatus）。
      const safeLatestRevision = latestRevision ? stripCertificationEvidenceFromRevision(latestRevision) : null;
      return {
        ...stripCertificationEvidence(factory),
        products: prods,
        latestRevision: safeLatestRevision,
        certificationEvidenceStatus: summarizeCertificationEvidenceForOwner(factory.certificationEvidence),
      };
    }),

    // Phase 3C: 取得目前登入者可代表接受訂單的工廠清單（approved + owner/active co-manager）
    myApprovedFactories: protectedProcedure.query(async ({ ctx }) => {
      return db.getApprovedFactoriesForUser(ctx.user.id);
    }),

    create: protectedProcedure.input(z.object({
      name: z.string().min(1).max(200),
      industry: z.array(z.string()).min(1),
      subIndustry: z.array(z.string()).optional(),
      mfgModes: z.array(z.string()).min(1),
      region: z.string(),
      description: z.string().optional(),
      capitalLevel: z.string(),
      address: z.string().min(1),
      foundedYear: z.number().min(1800).max(2100).optional().nullable(),
      avatarUrl: z.string().regex(/^https?:\/\//, "avatarUrl 必須為 http/https URL").optional().nullable(),
      businessType: z.enum(["factory", "studio"]).default("factory"),
      ownerName: z.string().optional(),
      contactPersonName: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().email().optional().or(z.literal("")),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      try {
        // createFactoryAtomic 使用 transaction + users row lock
        // admin 亦受同一規則約束：無法繞過一人一間工廠限制
        const factoryId = await db.createFactoryAtomic(ctx.user.id, input);
        return { id: factoryId };
      } catch (err: any) {
        const BAD = ["您已擁有工廠，無法再次建立工廠", "您已隸屬其他工廠，無法建立新的工廠"];
        if (BAD.includes(err?.message)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        console.error('[factory.create] DB error:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '建立工廠失敗，請稍後再試' });
      }
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      industry: z.array(z.string()).min(1).optional(),
      subIndustry: z.array(z.string()).optional(),
      mfgModes: z.array(z.string()).optional(),
      region: z.string().optional(),
      description: z.string().optional(),
      capitalLevel: z.string().optional(),
      foundedYear: z.number().min(1800).max(2100).optional().nullable(),
      ownerName: z.string().optional(),
      contactPersonName: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().optional(),
      contactEmail: z.string().optional(),
      businessType: z.enum(["factory", "studio"]).optional(),
      avatarUrl: z.string().regex(/^https?:\/\//, "avatarUrl 必須為 http/https URL").optional(),
      avatarCrop: imageCropInputSchema,
      address: z.string().optional(),
      operationStatus: z.enum(["normal", "busy", "full"]).optional(),
      weekdayHours: z.string().max(50).optional(),
      weekendHours: z.string().max(50).optional(),
      businessNote: z.string().max(500).optional(),
      certificationBadges: z.array(z.string().max(50)).max(30).optional(),
      // imageKeys 刻意不接受：圖片 object key 全程只存在伺服器端，工廠端
      // 只能編輯每個徽章的說明文字（見 shared/badges.ts 的
      // applyCertificationEvidenceDescriptions）。
      certificationEvidence: z.array(z.object({
        badgeId: z.string().max(50),
        description: z.string().max(500).optional().default(""),
      })).max(30).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const { id, ...data } = input;
      const factory = await db.getFactoryById(id);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '工廠不存在' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限修改此工廠' });

      // Status-based routing
      if (factory.status === 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '首次申請審核中，請等待審核完成後再修改資料' });
      }
      if (factory.status === 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '已上線工廠的基本資料需透過「修改申請」流程更改，請使用提交修改申請功能' });
      }

      // 徽章證明圖片的 object key 全程只存在伺服器端，工廠端送出的
      // certificationEvidence 只可能帶 { badgeId, description }（imageKeys
      // 已從 zod schema 移除）。這裡把工廠端的說明文字跟資料庫目前實際存的
      // imageKeys 合併，不能直接拿工廠端送來的內容整個覆蓋，否則會把已透過
      // uploadBadgeEvidence 綁定的圖片洗掉。
      const mergedData: Record<string, any> = { ...data };
      if ("certificationBadges" in data || "certificationEvidence" in data) {
        const certificationBadges = sortBadgeIds(Array.isArray((data as any).certificationBadges) ? (data as any).certificationBadges : []);
        mergedData.certificationBadges = certificationBadges;
        mergedData.certificationEvidence = applyCertificationEvidenceDescriptions(
          factory.certificationEvidence,
          (data as any).certificationEvidence,
          certificationBadges,
        );
      }

      // draft / rejected → allow direct update
      try {
        await db.updateFactory(id, isOwner ? ctx.user.id : -1, mergedData as any);
      } catch (err: any) {
        console.error('[factory.update] DB error:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '更新工廠失敗，請稍後再試' });
      }
      return { success: true };
    }),

    // 徽章「公開顯示」切換：只能在「已獲得徽章」的子集合裡切換，完全不經過
    // 基本資料修改申請審核——這是刻意的設計，擁有權（certificationBadges）
    // 跟公開顯示（certificationBadgesVisible）本來就是兩件事，取消顯示不能
    // 也不應該建立修改申請、不能要求重新上傳證明或重新送審。伺服器端在
    // db.updateVisibleBadges 內會再次驗證只保留已擁有的徽章 id，不相信前端
    // 傳入的陣列已經是合法子集合。
    updateVisibleBadges: protectedProcedure.input(z.object({
      factoryId: z.number(),
      visibleBadgeIds: z.array(z.string().max(50)).max(30),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限修改此工廠的徽章顯示設定' });
      const visible = await db.updateVisibleBadges(input.factoryId, input.visibleBadgeIds);
      return { certificationBadgesVisible: visible };
    }),

    submitRevision: protectedProcedure.input(z.object({
      factoryId: z.number(),
      proposedData: z.record(z.string(), z.any()),
      revisionReason: z.string().trim().min(2, "修改原因至少 2 個字").max(200, "修改原因最多 200 個字"),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });

      // Only owner or active co-manager may submit a revision
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '無權限提交此工廠的修改申請' });
      }

      if (factory.status !== 'approved') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '只有已上線的工廠才能提交修改申請' });
      }

      // Application-layer duplicate check (DB unique index is the final safety net)
      const existing = await db.getPendingRevisionByFactory(factory.id);
      if (existing) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '已有一筆審核中的修改申請，請等待審核完成後再提交新申請' });
      }

      // Read original data from DB — never trust the frontend for originalData
      const originalData = db.extractBasicData(factory);

      // Whitelist: strip any fields not in BASIC_DATA_FIELDS
      const allowedSet = new Set(db.BASIC_DATA_FIELDS as readonly string[]);
      const proposedData: Record<string, any> = {};
      for (const key of Object.keys(input.proposedData)) {
        if (allowedSet.has(key)) {
          proposedData[key] = input.proposedData[key];
        }
      }

      if (Object.keys(proposedData).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請必須包含至少一個欄位' });
      }

      // Runtime type validation: reject incorrect field value types (e.g. string where array expected)
      const typeCheck = FactoryBasicDataSchema.safeParse(proposedData);
      if (!typeCheck.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請包含無效欄位值，請重新整理頁面後再試' });
      }

      // 徽章系統：白名單清洗必須在寫入 factoryRevisions 之前就完成，不能只靠
      // approve 時的 defense-in-depth —— 否則有人可以直接呼叫這支 API，把未知
      // badge id 寫進 pending revision，在管理員審核畫面上顯示未經清洗的內容。
      // imageKeys 已從輸入 schema 移除，proposedData.certificationEvidence
      // 只可能帶說明文字，必須跟目前線上工廠實際存的 imageKeys 合併，不能
      // 直接整個覆蓋，否則會把已透過 uploadBadgeEvidence 綁定的圖片洗掉。
      //
      // 徽章「擁有權」不得透過一般修改申請被竄改：這裡一律用「目前已擁有的
      // 徽章」聯集「這次申請新增的徽章」，工廠端無論送了什麼內容都不可能讓
      // certificationBadges 比目前實際擁有的還少——真正的「取消顯示」走
      // 完全獨立、不需審核的 factory.updateVisibleBadges，不會經過這裡。
      if ("certificationBadges" in proposedData || "certificationEvidence" in proposedData) {
        const existingOwned = Array.isArray(factory.certificationBadges) ? factory.certificationBadges as string[] : [];
        const requested = Array.isArray(proposedData.certificationBadges) ? proposedData.certificationBadges : [];
        const certificationBadges = sortBadgeIds([...existingOwned, ...requested]);
        proposedData.certificationBadges = certificationBadges;
        proposedData.certificationEvidence = applyCertificationEvidenceDescriptions(
          factory.certificationEvidence,
          proposedData.certificationEvidence,
          certificationBadges,
        );
      }

      let revisionId: number;
      try {
        revisionId = await db.createRevision(
          factory.id,
          ctx.user.id,
          originalData,
          proposedData,
          input.revisionReason,
        );
      } catch (err: any) {
        if (err?.message === 'DUPLICATE_PENDING_REVISION') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '已有一筆基本資料修改申請正在審核中' });
        }
        throw err;
      }

      // Notify admin (fire-and-forget)
      sendRevisionSubmittedEmail({
        factoryName: factory.name,
        factoryId: factory.id,
        submitterName: ctx.user.name ?? null,
        revisionReason: input.revisionReason,
      }).catch(err => console.error('[Email] sendRevisionSubmittedEmail failed:', err));

      return { success: true, revisionId };
    }),

    search: publicProcedure.input(z.object({
  industry: z.array(z.string().max(50)).max(15).optional(),
  subIndustry: z.array(z.string().max(50)).max(20).optional(),
  region: z.array(z.string().max(20)).max(25).optional(),
  capitalLevel: z.array(z.string().max(30)).max(10).optional(),
  mfgMode: z.string().max(10).optional(),
  keyword: z.string().max(100).optional(),
  businessType: z.string().max(20).optional(),
  sortBy: z.enum(["rating", "reviews", "response", "newest"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
})).query(async ({ input }) => {
  const industry      = input.industry     && input.industry.length > 0     ? input.industry     : undefined;
  const subIndustry   = input.subIndustry  && input.subIndustry.length > 0  ? input.subIndustry  : undefined;
  const region        = input.region       && input.region.length > 0       ? input.region       : undefined;
  const capitalLevel  = input.capitalLevel && input.capitalLevel.length > 0 ? input.capitalLevel : undefined;
  const businessType  = input.businessType && input.businessType !== 'all'  ? input.businessType : undefined;

  // 使用者是否有手動選主產業（影響 AI matchTier 計算範圍）
  const userHasSelectedIndustry = !!(industry && industry.length > 0);

  // 取得 AI 搜尋意圖（keyword 有值時嘗試；有 industry 時仍呼叫，用於 productKeywords 加權）
  const intent = input.keyword ? await getSearchIntent(input.keyword) : null;

  // fallback keyword：intent 無法使用時沿用舊有 enhanceSearchKeyword
  const keyword = input.keyword
    ? (intent ? input.keyword : await enhanceSearchKeyword(input.keyword))
    : undefined;

  const result = await db.searchFactories({
    ...input,
    industry, subIndustry, region, capitalLevel, businessType,
    keyword,
    intent,
    userHasSelectedIndustry,
  });
  let ads: Awaited<ReturnType<typeof db.getActiveAds>> = [];

  if (input.page === 1) {
    ads = await db.getActiveAds({ industry: input.industry?.[0], capitalLevel: input.capitalLevel?.[0], region: input.region?.[0] });
    const adFactoryIds = new Set(ads.slice(0, 5).map(a => a.factoryId));
    const promoted = result.items.filter(f => adFactoryIds.has(f.id));
    const regular = result.items.filter(f => !adFactoryIds.has(f.id));
    result.items = [...promoted, ...regular];
  }

  // 廣告資料一起回傳，前端不需要再打一支 ad.getActive
  // 公開搜尋結果一律不含 certificationEvidence（工廠私密證明資料），徽章也
  // 一律只保留 certificationBadgesVisible（工廠選擇公開顯示的子集合），不得
  // 洩漏擁有但隱藏的徽章（certificationBadges）。
  const stripForSearch = (f: any) => stripHiddenBadgesForPublic(stripCertificationEvidence(f));
  return {
    ...result,
    items: result.items.map(stripForSearch),
    ads: ads.map(ad => ad.factory ? { ...ad, factory: stripForSearch(ad.factory) } : ad),
  };
}),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限刪除此工廠");
      await db.deleteFactory(input.id, ctx.user.id);
      await db.setFactoryOwner(ctx.user.id, false);
      return { success: true };
    }),

    uploadAvatar: protectedProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      // Optional: pass factoryId to support co-managers; falls back to owner lookup when omitted.
      factoryId: z.number().optional(),
      // 工廠頭貼／Logo 的顯示範圍（見 shared/imageCrop.ts）。可省略／null——
      // 既有呼叫端（尚未升級的舊版前端）不帶這個欄位時，avatarCrop 維持
      // 不變或 fallback 成置中顯示，不影響既有行為。
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      let factory: Awaited<ReturnType<typeof db.getFactoryByOwnerId>>;
      if (input.factoryId) {
        factory = await db.getFactoryById(input.factoryId);
        if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
        const isOwner = factory.ownerId === ctx.user.id;
        const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
        if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限上傳此工廠大頭貼' });
      } else {
        factory = await db.getFactoryByOwnerId(ctx.user.id);
        if (!factory) throw new Error("找不到工廠");
      }
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const crop = input.crop ?? null;

      switch (factory.status) {
        case 'draft':
        case 'rejected': {
          // Direct update: upload and save to DB
          const key = `factory-avatars/${factory.id}/${nanoid()}.${ext}`;
          const { url } = await storagePut(key, buffer, input.mimeType);
          await db.updateFactory(factory.id, ctx.user.id, { avatarUrl: url, avatarCrop: crop });
          return { url, crop, savedToDb: true };
        }
        case 'pending': {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '首次申請審核中，不可更換大頭貼' });
        }
        case 'approved': {
          // Upload to a separate temp prefix. factories.avatarUrl is NOT updated here.
          // The URL is staged on the client and included in proposedData upon revision submission.
          // If the user abandons without submitting, the object is orphaned under factory-avatars-temp/.
          // A S3 lifecycle rule on the factory-avatars-temp/ prefix (e.g., expire after 30 days)
          // can be applied to clean up abandoned temp objects without affecting production avatars.
          // avatarCrop 跟 avatarUrl 一樣只暫存在前端，等 submitRevision 時一併
          // 帶入 proposedData（見 BASIC_DATA_FIELDS／FactoryBasicDataSchema）。
          const key = `factory-avatars-temp/${factory.id}/${nanoid()}.${ext}`;
          const { url } = await storagePut(key, buffer, input.mimeType);
          return { url, crop, savedToDb: false };
        }
        default:
          throw new Error("未知的工廠狀態");
      }
    }),

    // 重新調整既有工廠頭貼／Logo 的顯示範圍，不重新上傳圖片本體。draft／
    // rejected／admin 直接寫入；approved 狀態下沿用跟 uploadAvatar 相同的
    // 「不可直接更換大頭貼」規則（此時應該走 submitRevision）。
    updateAvatarCrop: protectedProcedure.input(z.object({
      factoryId: z.number(),
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isAdmin = ctx.user.role === 'admin';
      if (!isOwner && !isCoMgr && !isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限調整此工廠大頭貼顯示範圍' });
      if (factory.status === 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '首次申請審核中，不可調整大頭貼顯示範圍' });
      }
      await db.updateFactory(factory.id, isAdmin ? -1 : factory.ownerId, { avatarCrop: input.crop ?? null });
      return { crop: input.crop ?? null };
    }),

    uploadCoverImage: protectedProcedure.input(z.object({
      base64: z.string().max(20 * 1024 * 1024),
      factoryId: z.number(),
      // 封面的顯示範圍。省略／null 時 fallback 成置中顯示。
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isAdmin = ctx.user.role === 'admin';
      if (!isOwner && !isCoMgr && !isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限上傳此工廠封面' });
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const key = `factory-covers/${factory.id}/${nanoid()}.jpg`;
      const { url } = await storagePut(key, buffer, "image/jpeg");
      const crop = input.crop ?? null;
      await db.updateFactory(factory.id, isAdmin ? -1 : factory.ownerId, { coverImageUrl: url, coverCrop: crop });
      return { url, crop };
    }),

    // 重新調整既有封面的顯示範圍，不重新上傳圖片本體——保留原圖，只更新中繼
    // 資料，滿足「已上傳圖片可以再次編輯顯示範圍」的需求。
    updateCoverCrop: protectedProcedure.input(z.object({
      factoryId: z.number(),
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isAdmin = ctx.user.role === 'admin';
      if (!isOwner && !isCoMgr && !isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限調整此工廠封面顯示範圍' });
      await db.updateFactory(factory.id, isAdmin ? -1 : factory.ownerId, { coverCrop: input.crop ?? null });
      return { crop: input.crop ?? null };
    }),

    // 徽章證明圖片走私有儲存（server/privateStorage.ts），與大頭貼／封面／照片／
    // 商品圖片使用的公開 storage.ts 完全分開——證明圖片只供管理員審核使用，
    // 絕不對外公開，回傳值只有私有 object key，不回傳任何網址（包含短效
    // 網址）。工廠端上傳前的縮圖預覽一律用瀏覽器本機 blob URL（見
    // BadgeEvidenceEditor.tsx），上傳成功後即捨棄，不透過伺服器重新取得；
    // 送出後工廠主／共管者不能再用任何 API 查看這張圖片，只有管理員能透過
    // 下方 getCertificationEvidenceViewUrls（僅限管理員身份）換發短效網址。
    //
    // 限流：用 badgeEvidenceUploadProcedure（server/_core/trpc.ts），依已驗證
    // 的 ctx.user.id 計算，每人每小時 20 次，與一般圖片上傳的 uploadLimiter
    // （10 次/小時、以 IP 計算）完全獨立分離——不可疊加使用 protectedProcedure
    // 讓這支 API 又被 Express 層的 uploadLimiter 攔截到（見
    // server/_core/index.ts 的 uploadLimiter 比對規則已移除這支路徑）。
    uploadBadgeEvidence: badgeEvidenceUploadProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      factoryId: z.number(),
      badgeId: z.string().max(50),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: 'FORBIDDEN', message: '無權限上傳此工廠的徽章證明圖片' });
      if (factory.status === 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: '審核期間無法上傳徽章證明圖片' });
      if (!isValidBadgeId(input.badgeId)) throw new TRPCError({ code: 'BAD_REQUEST', message: '不明的認證項目' });
      if (!isPrivateStorageConfigured()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '證明圖片私有儲存尚未設定，請聯繫管理員' });
      }
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      // key 只用 factoryId（純數字）與亂數字串組成，不使用任何徽章／認證名稱，
      // 格式必須符合 shared/badges.ts 的 isValidCertificationEvidenceKey。
      const key = `${CERTIFICATION_EVIDENCE_KEY_PREFIX}/${factory.id}/${nanoid()}.${ext}`;
      // privateStoragePutObject 本身失敗（拋出例外）時，執行不會走到下面任何一行——
      // 不會呼叫 DB 綁定，也不需要呼叫刪除（根本沒有東西寫進 S3）。
      await privateStoragePutObject(key, buffer, input.mimeType);

      // object key 從產生到綁定全程只存在伺服器端：上傳成功「當下」就直接用
      // row lock 附加進 certificationEvidence（見 db.appendFactoryCertificationEvidenceImage），
      // 不透過回傳值把 key 交給工廠端暫存、等到 factory.update／submitRevision
      // 時才送回來合併——工廠端從頭到尾都拿不到、也不需要拿到這個 key。
      //
      // S3 已經寫入成功之後，若 DB 綁定失敗（單一徽章達 5 張／全部達 30 張、
      // transaction 失敗、其他 DB 錯誤，或併發上傳被上限擋下），剛剛寫入的
      // S3 物件就沒有任何 DB 紀錄引用，會變成孤兒檔案——這裡在拋出錯誤前，
      // 一定先嘗試刪除「這一次 request 剛建立」的 key（絕不會是任何既有認證
      // 圖片的 key，因為 key 是這行以上才剛用 nanoid() 產生的區域變數）。
      // 清理本身若也失敗，只記錄在伺服器 log（不可把 key／網址／內部路徑透過
      // 錯誤訊息外流給前端），且不能讓清理失敗蓋掉原本要回傳給前端的錯誤——
      // 兩個 catch 各自吞掉自己的例外，最後一定還是拋出原本的錯誤。
      let bindResult: Awaited<ReturnType<typeof db.appendFactoryCertificationEvidenceImage>>;
      try {
        bindResult = await db.appendFactoryCertificationEvidenceImage(factory.id, input.badgeId, key);
      } catch (err: any) {
        await privateStorageDeleteObject(key).catch((cleanupErr: any) => {
          console.error('[factory.uploadBadgeEvidence] 清理孤兒 S3 物件失敗:', cleanupErr?.message, 'key=', key);
        });
        console.error('[factory.uploadBadgeEvidence] DB 綁定發生例外:', err?.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '圖片綁定失敗，請稍後再試' });
      }
      if (!bindResult.ok) {
        await privateStorageDeleteObject(key).catch((cleanupErr: any) => {
          console.error('[factory.uploadBadgeEvidence] 清理孤兒 S3 物件失敗:', cleanupErr?.message, 'key=', key);
        });
        const message = bindResult.reason === "PER_BADGE_LIMIT"
          ? "此認證項目的證明圖片已達上限"
          : bindResult.reason === "TOTAL_LIMIT"
          ? "證明圖片總數已達上限"
          : "圖片綁定失敗，請稍後再試";
        throw new TRPCError({ code: 'BAD_REQUEST', message });
      }

      // DB 綁定一旦成功（走到這裡），不論之後回應傳輸是否發生問題，都不會、
      // 也不能再刪除已成功綁定的圖片——下面只是單純回傳，沒有任何會觸發刪除
      // 的後續邏輯。只回傳安全結果：不含 key、imageKeys、永久 URL 或 presigned URL。
      return { uploaded: true, hasEvidence: true, imageCount: bindResult.imageCount, badgeId: input.badgeId };
    }),

    // 只有管理員能取得徽章證明圖片的短效 presigned 檢視網址。
    // 用 protectedProcedure（而非 adminProcedure）當基底，是刻意要讓「訪客
    // （未登入）」與「已登入但非管理員（含工廠 owner／共管者／其他一般會員）」
    // 回傳不同的錯誤碼：訪客在 protectedProcedure 的 requireUser middleware
    // 就會被擋下、回傳 UNAUTHORIZED；已登入但非管理員的則在下面明確拋出
    // FORBIDDEN——單用 adminProcedure 兩種情況都只會是 FORBIDDEN，不符合
    // 「訪客要拿到 UNAUTHORIZED」的要求。
    //
    // 絕不接受前端傳入的 object key：input 只有 factoryId（與選填的
    // revisionId，用於審核修改申請 diff 畫面），key 一律從資料庫目前實際
    // 存的 certificationEvidence／revision 的 originalData／proposedData
    // 讀出，不相信、也不查詢任何呼叫端自己夾帶的 key 字串。expectedPrefix
    // 比對是多一層 defense-in-depth（理論上從 DB 讀出的 key 不會是別的工廠
    // 的，但仍防止未來重構不慎混入其他來源時被拿去換取簽章）。
    getCertificationEvidenceViewUrls: protectedProcedure.input(z.object({
      factoryId: z.number(),
      revisionId: z.number().optional(),
    })).query(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: '只有管理員能查看徽章證明圖片' });
      }
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });

      const collectedKeys = new Set<string>();
      const collectFrom = (evidence: unknown) => {
        if (!Array.isArray(evidence)) return;
        for (const entry of evidence) {
          const keys = (entry as any)?.imageKeys;
          if (!Array.isArray(keys)) continue;
          for (const key of keys) if (typeof key === "string") collectedKeys.add(key);
        }
      };
      collectFrom((factory as any).certificationEvidence);

      if (input.revisionId) {
        const revision = await db.getRevisionById(input.revisionId);
        if (revision && revision.factoryId === input.factoryId) {
          collectFrom((revision.originalData as any)?.certificationEvidence);
          collectFrom((revision.proposedData as any)?.certificationEvidence);
        }
      }

      if (!isPrivateStorageConfigured()) return { urls: {} as Record<string, string> };
      const expectedPrefix = `${CERTIFICATION_EVIDENCE_KEY_PREFIX}/${factory.id}/`;
      const urls: Record<string, string> = {};
      for (const key of Array.from(collectedKeys)) {
        if (!isValidCertificationEvidenceKey(key) || !key.startsWith(expectedPrefix)) continue;
        urls[key] = await privateStorageCreateViewUrl(key, CERTIFICATION_EVIDENCE_VIEW_URL_TTL_SECONDS);
      }
      return { urls };
    }),

    submitForReview: protectedProcedure.mutation(async ({ ctx }) => {
      requireVerifiedEmail(ctx.user);
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      if (factory.status !== 'draft' && factory.status !== 'rejected') throw new Error("只有未送審或已拒絕的工廠才能送出審核");
      // 管理員不受產品數量限制
      if (ctx.user.role !== 'admin') {
        const products = await db.getProductsByFactoryId(factory.id);
        if (products.length === 0) throw new Error("請至少新增一項產品後再送出審核");
      }
      await db.updateFactory(factory.id, ctx.user.id, { status: 'pending', submittedAt: new Date() });
      sendFactorySubmittedEmail({
        factoryName: factory.name ?? '未命名工廠',
        factoryId: factory.id,
        ownerName: ctx.user.name ?? '未知用戶',
        ownerEmail: ctx.user.email,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),

    getPhotos: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getPhotosByFactoryId(input.factoryId);
    }),

    uploadPhoto: protectedProcedure.input(z.object({
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      caption: z.string().max(200).optional(),
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `factory-photos/${factory.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      const id = await db.addFactoryPhoto(factory.id, url, input.caption, input.crop ?? null);
      return { id, url, crop: input.crop ?? null };
    }),

    deletePhoto: protectedProcedure.input(z.object({ photoId: z.number() })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.deleteFactoryPhoto(input.photoId, factory.id);
      return { success: true };
    }),

    updatePhotoCaption: protectedProcedure.input(z.object({
      photoId: z.number(),
      caption: z.string().max(200),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.updateFactoryPhotoCaption(input.photoId, factory.id, input.caption);
      return { success: true };
    }),

    // 重新調整既有相簿照片的顯示範圍，不重新上傳圖片本體。
    updatePhotoCrop: protectedProcedure.input(z.object({
      photoId: z.number(),
      crop: imageCropInputSchema,
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("找不到工廠");
      await db.updateFactoryPhotoCrop(input.photoId, factory.id, input.crop ?? null);
      return { success: true, crop: input.crop ?? null };
    }),

    reviewHistory: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
      return [] as { id: number; action: string; createdAt: Date; submitCountSnapshot?: number; note?: string; rejectReason?: string }[];
    }),

    // ===== 共同管理者 =====
    inviteCoManager: protectedProcedure.input(z.object({
      email: z.string().email(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");

      const invitee = await db.getUserByEmail(input.email);
      // Don't reveal whether email is registered — prevents enumeration
      if (!invitee) return { success: true as const, conversationId: null as number | null };
      if (invitee.id === ctx.user.id) throw new Error("不能邀請自己");

      // 跨廠唯一性預檢：被邀請人是否已有工廠角色
      // 注意：此預檢不能取代 acceptInvitation 內的正式鎖定檢查
      const inviteeAffil = await db.getActiveFactoryAffiliation(invitee.id);
      if (inviteeAffil) {
        if (inviteeAffil.factoryId === factory.id && inviteeAffil.role === "co_manager") {
          throw new Error("此用戶已是本工廠的次管理者");
        }
        throw new Error("此使用者已擁有或管理其他工廠，無法邀請");
      }

      const hasPending = await db.hasPendingInvitation(factory.id, invitee.id);
      if (hasPending) throw new Error("已有一筆待處理的邀請，請等對方回應後再試");

      const count = await db.getActiveCoManagerCount(factory.id);
      if (count >= 6) throw new Error("次管理者已達 6 人上限");

      // conversation 建立/取得、邀請紀錄、邀請訊息三步驟包在同一個 DB
      // transaction 內（見 db.createCoManagerInvitationWithMessage），避免
      // 中途失敗留下「有邀請但無訊息」或「有訊息但無邀請」的不一致狀態。
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const content = `您好，我是【${factory.name}】的主管理者 ${ctx.user.name ?? ctx.user.email}，誠摯邀請您成為本工廠的次管理者，共同管理工廠後台。\n\n邀請有效期限：7 天\n\n請點選下方按鈕確認是否接受。`;
      const { conversation: conv, invitationId } = await db.createCoManagerInvitationWithMessage({
        factoryId: factory.id,
        inviterUserId: ctx.user.id,
        inviteeUserId: invitee.id,
        expiresAt,
        messageContent: content,
      });

      // 站內通知：通知被邀請人
      createPlatformNotifications([{
        recipientUserId: invitee.id,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "",
        actorFactoryId: factory.id,
        actorFactoryName: factory.name,
        eventType: "co_manager_invitation",
        eventGroup: "co_manager",
        message: `「${factory.name}」邀請你成為次管理者，請到對話頁面確認`,
        actionUrl: `/chat/${conv.id}`,
        dedupeKey: `co_manager_invitation:${invitationId}`,
      }]).catch(() => {});
      // Push 通知被邀請人
      sendPushToRecipients({
        userIds: [invitee.id],
        title: "OXM 次管理者邀請",
        body: `「${factory.name}」邀請你成為次管理者`,
        data: { type: "co_manager_invitation", targetPath: `/chat/${conv.id}` },
      }).catch((err) => { console.error("[Push] co_manager_invitation failed:", err instanceof Error ? err.message : String(err)); });

      return { success: true, conversationId: conv.id };
    }),

    respondToInvitation: protectedProcedure.input(z.object({
      invitationId: z.number(),
      action: z.enum(["accept", "decline"]),
    })).mutation(async ({ ctx, input }) => {
      if (input.action === "accept") requireVerifiedEmail(ctx.user);
      // Fetch invitation before mutating so we can send a notification
      const inv = await db.getInvitationById(input.invitationId);
      if (input.action === "accept") {
        await db.acceptInvitation(input.invitationId, ctx.user.id);
      } else {
        await db.declineInvitation(input.invitationId, ctx.user.id);
      }
      // 站內通知：通知邀請人（工廠主管理者），fire-and-forget 避免阻塞回應
      if (inv) {
        void (async () => {
          try {
            const [factory, invitee] = await Promise.all([
              db.getFactoryById(inv.factoryId),
              db.getUserById(ctx.user.id),
            ]);
            const inviteeName = invitee?.name ?? invitee?.email ?? "使用者";
            const factoryName = factory?.name ?? "工廠";
            await createPlatformNotifications([{
              recipientUserId: inv.inviterUserId,
              actorUserId: ctx.user.id,
              actorName: inviteeName,
              actorFactoryId: factory?.id ?? null,
              actorFactoryName: factoryName,
              eventType: input.action === "accept"
                ? "co_manager_invitation_accepted"
                : "co_manager_invitation_rejected",
              eventGroup: "co_manager",
              message: input.action === "accept"
                ? `${inviteeName} 已接受邀請，加入「${factoryName}」成為次管理者`
                : `${inviteeName} 婉拒了次管理者邀請`,
              actionUrl: "/dashboard",
              dedupeKey: `co_manager_respond:${input.invitationId}:${input.action}`,
            }]);
            // Push 通知工廠主管理者
            await sendPushToRecipients({
              userIds: [inv.inviterUserId],
              title: input.action === "accept" ? "OXM 次管理者邀請已接受" : "OXM 次管理者邀請已婉拒",
              body: input.action === "accept"
                ? `${inviteeName} 已加入「${factoryName}」成為次管理者`
                : `${inviteeName} 婉拒了次管理者邀請`,
              data: { type: "co_manager_respond", targetPath: "/dashboard" },
            });
          } catch (e) {
            console.warn("[respondToInvitation] notification failed", e);
          }
        })();
      }
      return { success: true };
    }),

    removeCoManager: protectedProcedure.input(z.object({
      userId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");
      if (input.userId === ctx.user.id) throw new Error("無法移除自己");
      await db.removeCoManager(factory.id, input.userId);
      // 通知被移除的次管理者
      notifyUser(
        input.userId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: ctx.user.name ?? ctx.user.email ?? "工廠主管理者",
          eventType: "co_manager_removed",
          eventGroup: "co_manager",
          message: `您已被移出「${factory.name}」的次管理者名單`,
          actionUrl: "/member",
          dedupeKey: `co_manager_removed:${factory.id}:${input.userId}:${Date.now()}`,
        },
        {
          title: "OXM 次管理者資格異動",
          body: `您已被移出「${factory.name}」的次管理者名單`,
          data: { type: "co_manager_removed", targetPath: "/member" },
        }
      );
      return { success: true };
    }),

    getCoManagers: protectedProcedure.query(async ({ ctx }) => {
      const factory = await db.getFactoryByOwnerId(ctx.user.id);
      if (!factory) throw new Error("您尚未擁有工廠");
      const [coManagers, pending] = await Promise.all([
        db.getCoManagersByFactory(factory.id),
        db.getPendingInvitationsByFactory(factory.id),
      ]);
      return { coManagers, pending };
    }),

    getCoManagedFactories: protectedProcedure.query(async ({ ctx }) => {
      return db.getCoManagedFactories(ctx.user.id);
    }),
  }),

  // ===== 產品分類 =====
  category: router({
    getByFactory: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getCategoriesByFactoryId(input.factoryId);
    }),

    create: protectedProcedure.input(z.object({
      name: z.string().min(1).max(100),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      const id = await db.createCategory(factory.id, input.name.trim());
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.updateCategory(input.id, factory.id, input.name.trim());
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.deleteCategory(input.id, factory.id);
      return { success: true };
    }),

    assignProduct: protectedProcedure.input(z.object({
      productId: z.number(),
      categoryId: z.number().nullable(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.updateProductCategory(input.productId, factory.id, input.categoryId);
      return { success: true };
    }),
  }),

  // ===== 產品 =====
  product: router({
    getByFactory: publicProcedure.input(z.object({ factoryId: z.number() })).query(async ({ input }) => {
      return db.getProductsByFactoryId(input.factoryId);
    }),

    getById: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getProductById(input.id);
    }),

    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      name: z.string().min(1).max(200),
      categoryId: z.number().nullable().optional(),
      priceMin: z.string().optional(),
      priceMax: z.string().optional(),
      priceType: z.enum(["range", "fixed", "market"]).optional(),
      acceptSmallOrder: z.boolean().default(false),
      provideSample: z.boolean().default(false),
      description: z.string().optional(),
      images: z.array(z.string()).max(3).optional(),
      // 與 images 陣列順序對齊的顯示範圍，見 shared/imageCrop.ts。
      imageCrops: z.array(imageCropArrayItemSchema).max(3).optional(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      if (input.categoryId != null) {
        const cats = await db.getCategoriesByFactoryId(input.factoryId);
        if (!cats.some((c) => c.id === input.categoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分類不屬於此工廠" });
        }
      }
      const id = await db.createProduct(input);
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
      name: z.string().min(1).max(200).optional(),
      categoryId: z.number().nullable().optional(),
      priceMin: z.string().optional(),
      priceMax: z.string().optional(),
      priceType: z.enum(["range", "fixed", "market"]).optional(),
      acceptSmallOrder: z.boolean().optional(),
      provideSample: z.boolean().optional(),
      description: z.string().optional(),
      images: z.array(z.string()).max(3).optional(),
      imageCrops: z.array(imageCropArrayItemSchema).max(3).optional(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      const { id, factoryId, ...data } = input;
      if (data.categoryId != null) {
        const cats = await db.getCategoriesByFactoryId(factoryId);
        if (!cats.some((c) => c.id === data.categoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "分類不屬於此工廠" });
        }
      }
      await db.updateProduct(id, factoryId, data);
      return { success: true };
    }),

    delete: protectedProcedure.input(z.object({
      id: z.number(),
      factoryId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await assertFactoryManager(input.factoryId, ctx.user.id);
      await db.deleteProduct(input.id, input.factoryId);
      return { success: true };
    }),

    // 上傳產品圖片（base64）
    uploadImage: protectedProcedure.input(z.object({
      factoryId: z.number(),
      base64: z.string().max(10 * 1024 * 1024),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
    })).mutation(async ({ ctx, input }) => {
      const factory = await assertFactoryManager(input.factoryId, ctx.user.id);
      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer);
      if (!validation.valid) throw new Error(validation.error ?? "圖片格式不正確");
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `product-images/${factory.id}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),
  }),

  // ===== 聊天 =====
  chat: router({
    getOrCreate: protectedProcedure.input(z.object({
      factoryId: z.number(),
      productId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const conv = await db.getOrCreateConversation(ctx.user.id, input.factoryId, input.productId);
      return conv;
    }),

    // 只查詢已存在的對話，不建立（供「聯繫工廠」按鈕跳轉前使用）
    getExisting: protectedProcedure.input(z.object({
      factoryId: z.number(),
      productId: z.number().optional(),
    })).query(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) return null;
      const conditions = [
        eq(conversations.userId, ctx.user.id),
        eq(conversations.factoryId, input.factoryId),
      ];
      if (input.productId) conditions.push(eq(conversations.productId, input.productId));
      else conditions.push(sql`${conversations.productId} IS NULL`);
      const existing = await db_.select().from(conversations).where(and(...conditions)).limit(1);
      return existing.length > 0 ? existing[0] : null;
    }),

    // 取得使用者的一般對話（排除一鍵詢價批次建立的對話）+ 站內信
    myConversations: protectedProcedure.query(async ({ ctx }) => {
      const all = await db.getConversationsByUserWithDetails(ctx.user.id);
      let batchConvIds = new Set<number>();
      try {
        batchConvIds = await db.getInquiryBatchConversationIdsByUser(ctx.user.id);
      } catch {
        // inquiry 資料表尚未建立時不影響一般訊息
      }
      const regularConvs = all.map(c => ({ ...c, isAdminMessage: false as const, hasInquiry: batchConvIds.has(c.id) }));

      let adminMsgs: any[] = [];
      try {
        const campaigns = await db.getAdminMessagesForUser(ctx.user.id);
        adminMsgs = campaigns.map(c => ({
          id: -c.campaignId,
          isAdminMessage: true as const,
          adminCampaignId: c.campaignId,
          factoryName: "★ 平台管理員",
          productName: null,
          lastMessage: c.content.substring(0, 60),
          lastSenderRole: "admin",
          lastMessageAt: c.createdAt,
          unreadCount: c.isRead ? 0 : 1,
          senderIsAdmin: true,
          title: c.title,
        }));
      } catch {
        // 站內信資料表尚未建立時不影響一般訊息
      }

      const merged = [...regularConvs, ...adminMsgs];
      merged.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      return merged;
    }),

    getAdminMessage: protectedProcedure.input(z.object({ campaignId: z.number() })).query(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      return campaign;
    }),

    getAdminMessageThread: protectedProcedure.input(z.object({ campaignId: z.number() })).query(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      return db.getMessageThread(input.campaignId, ctx.user.id);
    }),

    replyToAdminMessage: protectedProcedure.input(z.object({
      campaignId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      const campaign = await db.getMessageCampaignById(input.campaignId, ctx.user.id);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此訊息' });
      await db.createMessageReply({
        campaignId: input.campaignId,
        userId: ctx.user.id,
        content: input.content,
        senderRole: "user",
      });
      sendMessageReplyNotificationEmail({
        userName: ctx.user.name ?? '使用者',
        userEmail: ctx.user.email ?? undefined,
        campaignTitle: campaign.title,
        replyContent: input.content,
        campaignId: input.campaignId,
      });
      return { success: true };
    }),

    markAdminMessageRead: protectedProcedure.input(z.object({ campaignId: z.number() })).mutation(async ({ ctx, input }) => {
      await db.markAdminMessageAsRead(input.campaignId, ctx.user.id);
      return { success: true };
    }),

    // 取得工廠的所有對話（含未讀計數與最後訊息）
    factoryConversations: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new Error("工廠不存在");
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(input.factoryId, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new Error("無權限");
      return db.getConversationsByFactoryWithDetails(input.factoryId, ctx.user.id);
    }),

    getMessages: protectedProcedure.input(z.object({
      conversationId: z.number(),
      page: z.number().int().min(1).default(1),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (conv.userId !== ctx.user.id && !isFactoryOwner && !isCoMgr && ctx.user.role !== 'admin') throw new Error("無權限");
      try {
        return await db.getMessagesByConversation(input.conversationId, input.page);
      } catch (error) {
        console.error("[getMessages] DB query failed", {
          conversationId: input.conversationId,
          userId: ctx.user.id,
          error,
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '訊息載入失敗，請稍後再試' });
      }
    }),

    // Explicit mark-read mutation — replaces the former side-effect inside getMessages.
    // Idempotent: marking an already-read conversation is a no-op.
    markConversationRead: protectedProcedure.input(z.object({
      conversationId: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: 'NOT_FOUND', message: '對話不存在' });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (conv.userId !== ctx.user.id && !isFactoryOwner && !isCoMgr) {
        throw new TRPCError({ code: 'FORBIDDEN', message: '無法標記此對話已讀' });
      }
      await db.markMessagesAsRead(input.conversationId, ctx.user.id);
      return { conversationId: input.conversationId };
    }),

    // 取得對話的 metadata（工廠名稱、產品名稱，用於 ChatPage 預填）
    getConversationMeta: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) return null;
      const factory = await db.getFactoryById(conv.factoryId);
      const product = conv.productId ? await db.getProductById(conv.productId) : null;
      const isConvUser = conv.userId === ctx.user.id;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isConvUser && !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isConvUser && !isFactoryOwner && !isCoMgr && ctx.user.role !== 'admin') return null;
      // 取得買家姓名與工廠身分（供工廠端顯示詢問者身分用）
      const [buyer, buyerAffiliation, isAdvisorConv] = await Promise.all([
        db.getUserById(conv.userId),
        db.getActiveFactoryAffiliationDetail(conv.userId),
        db.isAdvisorConversation(conv.userId, conv.factoryId),
      ]);
      // 政府補助顧問案件對話：工廠端（案件申請人）看到的對方身分一律匿名化為
      // OXM政府補助顧問，不顯示顧問真實姓名；顧問本人與管理員仍看得到真實資料。
      const anonymizeForViewer = isAdvisorConv && (isFactoryOwner || isCoMgr);
      return {
        factoryName: factory?.name ?? "未知工廠",
        productName: product?.name ?? null,
        factoryId: conv.factoryId,
        productId: conv.productId,
        userId: conv.userId,
        factoryOwnerId: factory?.ownerId ?? null,
        isCoMgr,
        buyerName: anonymizeForViewer ? ADVISOR_DISPLAY_NAME : (buyer?.name ?? null),
        buyerAffiliation: anonymizeForViewer ? null : (buyerAffiliation
          ? { factoryId: buyerAffiliation.factoryId, factoryName: buyerAffiliation.factoryName, factoryStatus: buyerAffiliation.factoryStatus, role: buyerAffiliation.role }
          : null),
      };
    }),

    send: protectedProcedure.input(z.object({
      conversationId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isUser = conv.userId === ctx.user.id;
      if (!isFactoryOwner && !isCoMgr && !isUser) throw new Error("無權限");
      const senderRole = (isFactoryOwner || isCoMgr) ? "factory" as const : "user" as const;
      // 政府補助顧問案件對話：往工廠端（案件申請人）的通知一律隱藏顧問真實姓名
      const isAdvisorConv = senderRole === "user" && await db.isAdvisorConversation(conv.userId, conv.factoryId);

      // ── 首次聯繫判斷（必須在 saveMessage 前完成，避免新訊息被誤判為歷史紀錄）
      // 判斷邏輯：以 senderUserId / recipientUserId 為核心，與角色、factoryId、conversationId 無關
      const senderUserId = ctx.user.id;
      const firstContactEntries: FirstContactEntry[] = [];

      // 預先取得買家資料（factory→buyer 路徑複用，避免重複查詢）
      const buyerForNotif = senderRole === "factory" ? await db.getUserById(conv.userId) : null;

      if (senderRole === "factory" && buyerForNotif?.email) {
        const alreadyContacted = await db.hasContactBetweenUsers(senderUserId, conv.userId);
        if (!alreadyContacted) {
          const s = (buyerForNotif.notificationSettings as Record<string, boolean> | null) ?? {};
          if (s.newMessage !== false) {
            firstContactEntries.push({ email: buyerForNotif.email, name: buyerForNotif.name });
          }
        }
      } else if (senderRole === "user" && factory) {
        firstContactEntries.push(...await collectUserToFactoryFirstContactEmails(senderUserId, ctx.user.email, factory));
      }

      await db.saveMessage(input.conversationId, ctx.user.id, senderRole, input.content);

      // ── 首次聯繫 Email（fire-and-forget）
      for (const { email, name } of firstContactEntries) {
        sendFirstContactEmail({ toEmail: email, toName: name, conversationId: input.conversationId }).catch(() => {});
      }

      // ── 工廠回覆：push + 站內通知（buyerForNotif 已在首次判斷時預取，不重複查詢）
      if (senderRole === "factory" && buyerForNotif) {
        const settings = (buyerForNotif.notificationSettings as Record<string, boolean> | null) ?? {};
        const pushNewMsg = settings.pushNewMessage;
        console.log(`[Push:chat] factory→user convId=${input.conversationId} recipientId=${conv.userId} pushNewMessage=${pushNewMsg ?? "unset(default:send)"} pushEnabled=${settings.pushEnabled ?? "unset"}`);
        if (settings.pushNewMessage !== false) {
          sendPushToRecipients({
            userIds: [conv.userId],
            excludeUserId: ctx.user.id,
            title: "OXM 有新的訊息",
            body: `${factory?.name ?? "工廠"} 傳來一則新訊息`,
            data: {
              type: "chat_message",
              conversationId: String(input.conversationId),
              targetPath: `/chat/${input.conversationId}`,
            },
          }).catch((err) => { console.error("[Push] chat_message (factory→user) failed:", err instanceof Error ? err.message : String(err)); });
        }
        createPlatformNotifications([{
          recipientUserId: conv.userId,
          actorUserId: ctx.user.id,
          actorFactoryId: factory?.id ?? null,
          actorFactoryName: factory?.name ?? null,
          actorName: factory?.name ?? "",
          eventType: "chat_message",
          eventGroup: "chat",
          message: `${factory?.name ?? "工廠"} 傳了一則新訊息`,
          actionUrl: `/chat/${input.conversationId}`,
          dedupeKey: `chat_message:conv:${input.conversationId}:ts:${Date.now()}`,
        }]).catch(() => {});
      }

      if (senderRole === "user" && factory) {
        const productInfo = conv.productId ? await db.getProductById(conv.productId) : null;
        notifyFactoryOfNewUserMessage({
          senderUserId: ctx.user.id,
          senderName: ctx.user.name,
          senderEmail: ctx.user.email,
          factory,
          conversationId: input.conversationId,
          content: input.content,
          isAdvisorConv,
          productName: productInfo?.name ?? null,
        });
      }
      return { success: true };
    }),

    // 原子化「開新對話 + 送出第一則訊息」：conversation 建立/取得、message
    // 儲存、lastMessageAt 更新皆包在同一個 DB transaction 內（見
    // db.createConversationAndSendFirstMessage），任一步失敗即整體 rollback，
    // 不會留下 messages=0 的新 conversation。前端 ChatPage 開新對話（/chat/new）
    // 第一次送出時只呼叫這支 mutation，不再由前端依序呼叫 getOrCreate + send。
    // 若當下已存在對話（例如使用者剛好在 getExisting 查詢完成前送出），會直接
    // 沿用既有 conversation 並附加這則訊息，不會建立重複列。
    sendFirstMessage: protectedProcedure.input(z.object({
      factoryId: z.number(),
      productId: z.number().optional(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "工廠不存在" });

      const senderUserId = ctx.user.id;
      // 必須在寫入訊息前完成（否則這則訊息本身會讓 hasContactBetweenUsers 誤判為已聯繫過）
      const firstContactEntries = await collectUserToFactoryFirstContactEmails(senderUserId, ctx.user.email, factory);

      const { conversation, isNewConversation } = await db.createConversationAndSendFirstMessage(
        senderUserId,
        input.factoryId,
        input.content,
        input.productId,
      );

      for (const { email, name } of firstContactEntries) {
        sendFirstContactEmail({ toEmail: email, toName: name, conversationId: conversation.id }).catch(() => {});
      }

      const [isAdvisorConv, productInfo] = await Promise.all([
        db.isAdvisorConversation(senderUserId, input.factoryId),
        input.productId ? db.getProductById(input.productId) : Promise.resolve(null),
      ]);

      notifyFactoryOfNewUserMessage({
        senderUserId,
        senderName: ctx.user.name,
        senderEmail: ctx.user.email,
        factory,
        conversationId: conversation.id,
        content: input.content,
        isAdvisorConv,
        productName: productInfo?.name ?? null,
      });

      return { conversationId: conversation.id, isNewConversation };
    }),

    // 查詢工廠可傳送的商品（工廠 owner 或 co-manager 可呼叫）
    getFactoryProducts: protectedProcedure.input(z.object({ conversationId: z.number() })).query(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可存取" });
      return db.getProductsByFactoryId(factory!.id);
    }),

    // 傳送商品附件訊息
    sendProduct: protectedProcedure.input(z.object({
      conversationId: z.number(),
      productIds: z.array(z.number().int()).min(1).max(10),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwnerSP = factory?.ownerId === ctx.user.id;
      const isCoMgrSP = !isFactoryOwnerSP && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwnerSP && !isCoMgrSP) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可傳送商品" });

      const factoryProducts = await db.getProductsByFactoryId(factory.id);
      const factoryProductMap = new Map(factoryProducts.map(p => [p.id, p]));
      if (!input.productIds.every(id => factoryProductMap.has(id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "包含不屬於此工廠的商品" });
      }

      const snapshot = input.productIds.map(id => {
        const p = factoryProductMap.get(id)!;
        return {
          id: p.id,
          name: p.name,
          imageUrl: ((p.images as string[] | null)?.[0]) ?? null,
          description: p.description ? p.description.substring(0, 100) : null,
          factoryId: factory.id,
          detailUrl: `/factory/${factory.id}`,
        };
      });

      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "", "product", {
        productIds: input.productIds,
        snapshot,
      });
      return { success: true };
    }),

    // 上傳 PDF 型錄並傳送訊息
    sendPdf: protectedProcedure.input(z.object({
      conversationId: z.number(),
      fileData: z.string().min(1),
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().min(1).max(10 * 1024 * 1024),
      mimeType: z.literal("application/pdf"),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwnerPdf = factory?.ownerId === ctx.user.id;
      const isCoMgrPdf = !isFactoryOwnerPdf && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwnerPdf && !isCoMgrPdf) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可上傳型錄" });

      // Strip path traversal and dangerous chars; allow spaces and CJK
      let safeName = input.fileName
        .replace(/\.\./g, "_")
        .replace(/[/\\<>"'&]/g, "_")
        .replace(/[\x00-\x1f\x7f]/g, "_")
        .substring(0, 100)
        .trim();
      if (!safeName || safeName === ".pdf") safeName = "catalog.pdf";
      if (!safeName.toLowerCase().endsWith(".pdf")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只允許上傳 PDF 檔案" });
      }

      const base64Data = input.fileData.replace(/^data:application\/pdf;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "檔案大小不可超過 10MB" });
      }
      if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "檔案格式不正確，請上傳 PDF" });
      }

      const fileKey = `chat-pdfs/${factory.id}/${nanoid()}.pdf`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, "application/pdf");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "", "pdf", {
        fileUrl,
        fileKey,
        fileName: safeName,
        fileSize: buffer.length,
        expiresAt,
      });
      return { success: true };
    }),

    // 取得 PDF 下載 URL（需通過權限+過期驗證，回傳 5 分鐘有效的 presigned URL）
    getPdfDownloadUrl: protectedProcedure.input(z.object({ messageId: z.number() })).mutation(async ({ ctx, input }) => {
      const msg = await db.getMessageById(input.messageId);
      if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "訊息不存在" });
      if (msg.type !== "pdf") throw new TRPCError({ code: "BAD_REQUEST", message: "此訊息不是 PDF 附件" });

      // 驗證對話存取權限（使用者本人、工廠 owner、active co-manager、admin）
      const conv = await db.getConversationById(msg.conversationId);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "對話不存在" });
      const factory = await db.getFactoryById(conv.factoryId);
      const isConvUser = conv.userId === ctx.user.id;
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgrPdf = !isConvUser && !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isConvUser && !isFactoryOwner && !isCoMgrPdf && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權存取此檔案" });
      }

      const attachment = (msg.attachmentData ?? {}) as {
        fileKey?: string; fileUrl?: string; expiresAt?: string; deleted?: boolean;
      };
      if (attachment.deleted) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此型錄已被刪除" });
      if (!attachment.expiresAt || new Date(attachment.expiresAt) < new Date()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此型錄已逾期，無法下載" });
      }

      // 優先 presigned URL（5 分鐘），fallback 到 fileUrl
      if (attachment.fileKey) {
        const url = await storagePresignedUrl(attachment.fileKey, 300);
        return { url };
      }
      if (attachment.fileUrl) return { url: attachment.fileUrl };
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到檔案" });
    }),

    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const [regularCount, adminCount] = await Promise.all([
        db.getUnreadCount(ctx.user.id),
        db.getUnreadAdminMessageCount(ctx.user.id),
      ]);
      const userCount = regularCount + adminCount;
      const factoryCount = await db.getUnreadCountForUser(ctx.user.id);
      return { userCount, factoryCount };
    }),

    // 刪除對話
    deleteConversation: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const conv = await db.getConversationById(input.conversationId);
      if (!conv) throw new Error("對話不存在");
      const factory = await db.getFactoryById(conv.factoryId);
      const isFactoryOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isFactoryOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isFactoryOwner && !isCoMgr) throw new Error("無權限刪除此對話");
      // 傳 factory.ownerId 讓 DB 層的 owner 檢查通過（co-manager 已在上方驗過）
      await db.deleteConversation(input.conversationId, factory!.ownerId);
      return { success: true };
    }),
  }),

  // ===== 合作確認單 =====
  collaborationOrder: router({
    create: protectedProcedure.input(z.object({
      conversationId: z.number(),
      productId: z.number().nullable().optional(),
      projectName: z.string().min(1).max(200),
      description: z.string().min(1),
      // note: requireVerifiedEmail checked below
      depositDueDate: z.string().max(10).nullable().optional(),
      productionStartDate: z.string().max(10).nullable().optional(),
      expectedCompletionDate: z.string().max(10).nullable().optional(),
      expectedShipmentDate: z.string().max(10).nullable().optional(),
      finalPaymentDueDate: z.string().max(10).nullable().optional(),
      note: z.string().max(2000).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      const [conv] = await db_.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "找不到對話" });
      const factory = await db.getFactoryById(conv.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "僅工廠管理者可建立合作確認單" });
      // 若帶 productId，確認屬於同一工廠
      if (input.productId) {
        const prod = await db.getProductById(input.productId);
        if (!prod || prod.factoryId !== factory.id) throw new TRPCError({ code: "BAD_REQUEST", message: "指定商品不屬於此工廠" });
      }
      const dateOrderError = validateOrderDateChain({
        depositDueDate: input.depositDueDate,
        productionStartDate: input.productionStartDate,
        expectedCompletionDate: input.expectedCompletionDate,
        expectedShipmentDate: input.expectedShipmentDate,
        finalPaymentDueDate: input.finalPaymentDueDate,
      });
      if (dateOrderError) throw new TRPCError({ code: "BAD_REQUEST", message: dateOrderError });
      const orderId = await db.createCollaborationOrder({
        conversationId: input.conversationId,
        factoryId: factory.id,
        buyerUserId: conv.userId,
        createdByUserId: ctx.user.id,
        productId: input.productId ?? null,
        projectName: input.projectName,
        description: input.description,
        depositDueDate: input.depositDueDate ?? null,
        productionStartDate: input.productionStartDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        expectedShipmentDate: input.expectedShipmentDate ?? null,
        finalPaymentDueDate: input.finalPaymentDueDate ?? null,
        note: input.note ?? null,
      });
      await db.saveMessage(input.conversationId, ctx.user.id, "factory", "合作確認單", "collaboration_order", {
        orderId,
        projectName: input.projectName,
        description: input.description,
        depositDueDate: input.depositDueDate ?? null,
        productionStartDate: input.productionStartDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        expectedShipmentDate: input.expectedShipmentDate ?? null,
        finalPaymentDueDate: input.finalPaymentDueDate ?? null,
        note: input.note ?? null,
      });
      // 通知買家：工廠傳來合作確認單
      notifyUser(
        conv.userId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_created",
          eventGroup: "collab_order",
          message: `「${factory.name}」傳來一份合作確認單「${input.projectName}」，請確認`,
          actionUrl: `/chat/${input.conversationId}`,
          titleSnapshot: input.projectName,
          dedupeKey: `collab_order_created:${orderId}`,
        },
        {
          title: "OXM 新合作確認單",
          body: `「${factory.name}」傳來合作確認單「${input.projectName}」，請確認`,
          data: { type: "collab_order", targetPath: `/chat/${input.conversationId}` },
        }
      );
      return { orderId };
    }),

    respond: protectedProcedure.input(z.object({
      orderId: z.number(),
      action: z.enum(["accepted", "rejected"]),
      // Phase 3C: 選填，前端尚未傳時預設 'user'，不破壞現有流程
      acceptedAsType: z.enum(["user", "factory"]).optional(),
      acceptedAsFactoryId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.buyerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅需求方可回應" });
      if (order.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單已不是待回應狀態" });

      // 決定接受方身分（只在 action=accepted 時有意義）
      let acceptedAs: Parameters<typeof db.respondCollaborationOrder>[2];
      if (input.action === "accepted") {
        // 防呆：acceptedAsFactoryId 有值但 acceptedAsType 不是 factory → 矛盾
        if (input.acceptedAsFactoryId && input.acceptedAsType !== "factory") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "acceptedAsFactoryId requires acceptedAsType=factory" });
        }
        const asType = input.acceptedAsType ?? "user";
        let asFactoryId: number | null = null;
        if (asType === "factory") {
          if (!input.acceptedAsFactoryId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "以工廠身分接受時需提供 acceptedAsFactoryId" });
          }
          const factory = await db.getFactoryById(input.acceptedAsFactoryId);
          if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到指定工廠" });
          const isOwner = factory.ownerId === ctx.user.id;
          const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
          if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權代表此工廠接受訂單" });
          asFactoryId = factory.id;
        }
        acceptedAs = { acceptedByUserId: ctx.user.id, acceptedAsType: asType, acceptedAsFactoryId: asFactoryId };
      }

      await db.respondCollaborationOrder(order.id, input.action, acceptedAs);
      const sysMsg = input.action === "accepted"
        ? "需求方已同意合作確認單，本筆合作已成立"
        : "需求方已拒絕此合作確認單";
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        if (conv) await db.saveMessage(order.conversationId, conv.userId, "user", sysMsg, "text");
      }
      // 通知工廠方：買家回應結果
      notifyFactoryMembers(
        order.factoryId,
        {
          actorUserId: ctx.user.id,
          actorName: ctx.user.name ?? ctx.user.email ?? "需求方",
          eventType: input.action === "accepted" ? "collab_order_accepted" : "collab_order_rejected",
          eventGroup: "collab_order",
          message: input.action === "accepted"
            ? `${ctx.user.name ?? "需求方"} 已接受合作確認單「${order.projectName}」`
            : `${ctx.user.name ?? "需求方"} 拒絕了合作確認單「${order.projectName}」`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_order_respond:${order.id}:${input.action}`,
        },
        {
          title: input.action === "accepted" ? "合作確認單已接受" : "合作確認單已拒絕",
          body: input.action === "accepted"
            ? `${ctx.user.name ?? "需求方"} 接受了「${order.projectName}」`
            : `${ctx.user.name ?? "需求方"} 拒絕了「${order.projectName}」`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        },
        { excludeUserId: ctx.user.id }
      );
      return { success: true };
    }),

    updateStatus: protectedProcedure.input(z.object({
      orderId: z.number(),
      status: z.enum(["in_progress", "shipped", "completed"]),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status === "cancelled" || order.status === "cancel_requested") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單已取消或正在取消申請中" });
      }
      if (order.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "已完成的合作確認單不可再更新" });
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      const allowedFrom: Record<string, string[]> = {
        in_progress: ["accepted"],
        shipped: ["in_progress"],
        completed: ["shipped"],
      };
      if (!allowedFrom[input.status]?.includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `無法從「${order.status}」改為「${input.status}」` });
      }
      await db.updateCollaborationOrderStatus(order.id, input.status);
      // 通知買家：訂單進度更新
      const statusLabels: Record<string, string> = {
        in_progress: "已開始製作",
        shipped: "已出貨",
        completed: "已完成",
      };
      notifyUser(
        order.buyerUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: `collab_order_status_${input.status}`,
          eventGroup: "collab_order",
          message: `「${order.projectName}」${statusLabels[input.status] ?? input.status}`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_order_status:${order.id}:${input.status}`,
        },
        {
          title: "OXM 訂單進度更新",
          body: `「${order.projectName}」${statusLabels[input.status] ?? input.status}`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true };
    }),

    requestCancel: protectedProcedure.input(z.object({
      orderId: z.number(),
      reason: z.string().min(1).max(500),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      const allowedStatuses = ["pending", "accepted", "in_progress", "shipped"];
      if (!allowedStatuses.includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此狀態不可申請取消" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = order.buyerUserId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      await db.requestCancelCollaborationOrder(order.id, ctx.user.id, input.reason, order.status);
      const isFactorySide = isOwner || isCoMgr;
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        const senderId = conv?.userId ?? ctx.user.id;
        const senderRole = isFactorySide ? "factory" : "user";
        await db.saveMessage(order.conversationId, senderId, senderRole, "取消合作申請", "collaboration_order", {
          subType: "cancel_request",
          orderId: order.id,
          projectName: order.projectName,
          reason: input.reason,
          requestedByUserId: ctx.user.id,
          requestedByRole: isFactorySide ? "factory" : "buyer",
        });
      }
      // 通知另一方：有人申請取消
      const cancelRequesterName = ctx.user.name ?? (isFactorySide ? factory.name : "需求方");
      if (isFactorySide) {
        // 工廠申請取消 → 通知買家
        notifyUser(
          order.buyerUserId,
          {
            actorUserId: ctx.user.id,
            actorFactoryId: factory.id,
            actorFactoryName: factory.name,
            actorName: factory.name,
            eventType: "collab_order_cancel_request",
            eventGroup: "collab_order",
            message: `「${factory.name}」申請取消合作確認單「${order.projectName}」`,
            actionUrl: `/orders/${order.id}`,
            titleSnapshot: order.projectName,
            dedupeKey: `collab_cancel_req:${order.id}:${Date.now()}`,
          },
          {
            title: "OXM 取消申請",
            body: `「${factory.name}」申請取消「${order.projectName}」`,
            data: { type: "collab_order", targetPath: `/orders/${order.id}` },
          }
        );
      } else {
        // 買家申請取消 → 通知工廠
        notifyFactoryMembers(
          factory.id,
          {
            actorUserId: ctx.user.id,
            actorName: cancelRequesterName,
            eventType: "collab_order_cancel_request",
            eventGroup: "collab_order",
            message: `${cancelRequesterName} 申請取消合作確認單「${order.projectName}」`,
            actionUrl: `/orders/${order.id}`,
            titleSnapshot: order.projectName,
            dedupeKey: `collab_cancel_req:${order.id}:${Date.now()}`,
          },
          {
            title: "OXM 取消申請",
            body: `${cancelRequesterName} 申請取消「${order.projectName}」`,
            data: { type: "collab_order", targetPath: `/orders/${order.id}` },
          },
          { excludeUserId: ctx.user.id }
        );
      }
      return { success: true };
    }),

    respondCancel: protectedProcedure.input(z.object({
      orderId: z.number(),
      action: z.enum(["accept", "reject"]),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status !== "cancel_requested") throw new TRPCError({ code: "BAD_REQUEST", message: "此合作確認單不在取消申請狀態" });
      if (order.cancelRequestedByUserId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "不能回應自己提出的取消申請" });
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = order.buyerUserId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      await db.respondCancelCollaborationOrder(order.id, input.action);
      const sysMsg = input.action === "accept"
        ? "對方已同意取消，合作確認單已取消"
        : "對方已拒絕取消，合作確認單維持原狀態";
      const db_ = await getDb();
      if (db_) {
        const [conv] = await db_.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, order.conversationId)).limit(1);
        if (conv) await db.saveMessage(order.conversationId, conv.userId, "user", sysMsg, "text");
      }
      // 通知取消申請方：對方的回應
      if (order.cancelRequestedByUserId) {
        const responderName = ctx.user.name ?? (isBuyer ? "需求方" : factory.name);
        const cancelLabel = input.action === "accept" ? "同意取消" : "拒絕取消";
        notifyUser(
          order.cancelRequestedByUserId,
          {
            actorUserId: ctx.user.id,
            actorName: responderName,
            eventType: `collab_order_cancel_${input.action}ed`,
            eventGroup: "collab_order",
            message: `對方${cancelLabel}了「${order.projectName}」的取消申請`,
            actionUrl: `/orders/${order.id}`,
            titleSnapshot: order.projectName,
            dedupeKey: `collab_cancel_respond:${order.id}:${input.action}`,
          },
          {
            title: `OXM 取消申請${input.action === "accept" ? "已同意" : "已拒絕"}`,
            body: `對方${cancelLabel}了「${order.projectName}」`,
            data: { type: "collab_order", targetPath: `/orders/${order.id}` },
          }
        );
      }
      return { success: true };
    }),

    listForFactory: protectedProcedure.input(z.object({
      factoryId: z.number(),
    })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      return db.listFactoryCollaborationOrders(input.factoryId);
    }),

    // Phase 3D: 工廠「下訂訂單」（以工廠身分接受的對外合作確認單）
    listPlacedByFactory: protectedProcedure.input(z.object({
      factoryId: z.number(),
    })).query(async ({ ctx, input }) => {
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無權限" });
      return db.listFactoryPlacedCollaborationOrders(input.factoryId);
    }),

    // Phase 3E: 使用者「個人訂單」（acceptedAsType='user' 或 NULL）
    listPersonal: protectedProcedure.query(async ({ ctx }) => {
      return db.listUserPersonalCollaborationOrders(ctx.user.id);
    }),

    // Phase 4A/4B: 單筆訂單詳情（含權限旗標 + 日期修改申請資料）
    getById: protectedProcedure.input(z.object({
      orderId: z.number(),
    })).query(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderDetail(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到訂單" });

      const uid = ctx.user.id;
      const isBuyer = order.buyerUserId === uid;
      const isCreator = order.createdByUserId === uid;

      const sellerFactory = await db.getFactoryById(order.factoryId);
      const isSellerOwner = sellerFactory?.ownerId === uid;
      const isSellerCoMgr = !isSellerOwner && !!sellerFactory && await db.isActiveCoManager(sellerFactory.id, uid);
      const isSellerMember = isSellerOwner || isSellerCoMgr;

      let isPlacedFactoryMember = false;
      if (order.acceptedAsFactoryId) {
        const placedFactory = await db.getFactoryById(order.acceptedAsFactoryId);
        const isPlacedOwner = placedFactory?.ownerId === uid;
        const isPlacedCoMgr = !isPlacedOwner && !!placedFactory && await db.isActiveCoManager(order.acceptedAsFactoryId, uid);
        isPlacedFactoryMember = isPlacedOwner || isPlacedCoMgr;
      }

      if (!isBuyer && !isCreator && !isSellerMember && !isPlacedFactoryMember) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權限查看此訂單" });
      }

      // Phase 4B 權限旗標
      const canRequestDateChange = isSellerMember;
      const canRespondDateChange =
        order.acceptedAsType === "factory" ? isPlacedFactoryMember : isBuyer;

      const canComplete =
        isSellerMember && ["accepted", "in_progress", "shipped"].includes(order.status);

      const canEarlyComplete =
        isSellerMember &&
        ["accepted", "in_progress"].includes(order.status) &&
        !order.earlyCompletedAt;

      const canEarlyShip =
        isSellerMember &&
        ["accepted", "in_progress"].includes(order.status) &&
        !order.earlyShippedAt;

      // 手動推進階段權限旗標＋下一階段（只有供應工廠方、且訂單仍在 accepted 期間可推進；
      // currentStage 可能為 null——舊資料或尚未初始化階段時不允許推進）
      const nextStage = order.currentStage ? db.COLLABORATION_ORDER_NEXT_STAGE[order.currentStage] : undefined;
      const canAdvanceStage = isSellerMember && order.status === "accepted" && !!nextStage;
      const stageDateField = order.currentStage ? db.COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD[order.currentStage] : undefined;
      const currentStageExpectedDate = stageDateField ? ((order as any)[stageDateField] as string | null) : null;
      const isCurrentStageOverdue = !!currentStageExpectedDate && db.twDateStr() >= currentStageExpectedDate;

      // Resolve completedByName if available
      let completedByName: string | null = null;
      if (order.completedByUserId) {
        const db_ = await getDb();
        if (db_) {
          const [cbUser] = await db_.select({ name: users.name })
            .from(users)
            .where(eq(users.id, order.completedByUserId))
            .limit(1);
          completedByName = cbUser?.name ?? null;
        }
      }

      const [pendingChangeRequest, acceptedChangeHistory, stageHistory] = await Promise.all([
        db.getPendingCollaborationOrderChangeRequest(input.orderId),
        db.listAcceptedCollaborationOrderChangeRequests(input.orderId),
        db.getCollaborationOrderStageHistory(input.orderId),
      ]);

      return {
        ...order,
        completedByName,
        canComplete,
        canEarlyComplete,
        canEarlyShip,
        canRequestDateChange,
        canRespondDateChange,
        canAdvanceStage,
        nextStage,
        currentStageExpectedDate,
        isCurrentStageOverdue,
        pendingChangeRequest,
        acceptedChangeHistory,
        stageHistory,
      };
    }),

    // Phase 4B: 工廠方提出日期修改申請
    requestDateChange: protectedProcedure.input(z.object({
      orderId: z.number(),
      reason: z.string().max(500).optional(),
      dates: z.object({
        depositDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        productionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        expectedCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        expectedShipmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        finalPaymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    })).mutation(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到訂單" });
      if (!["accepted", "in_progress", "shipped"].includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單狀態不允許修改日期" });
      }
      const sellerFactory = await db.getFactoryById(order.factoryId);
      const isOwner = sellerFactory?.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && !!sellerFactory && await db.isActiveCoManager(order.factoryId, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可提出日期修改申請" });

      const oldValues: Record<string, string | null> = {
        depositDueDate: order.depositDueDate ?? null,
        productionStartDate: order.productionStartDate ?? null,
        expectedCompletionDate: order.expectedCompletionDate ?? null,
        expectedShipmentDate: order.expectedShipmentDate ?? null,
        finalPaymentDueDate: order.finalPaymentDueDate ?? null,
      };
      const d = input.dates;
      const newValues: Record<string, string | null> = {
        depositDueDate: d.depositDueDate ?? oldValues.depositDueDate,
        productionStartDate: d.productionStartDate ?? oldValues.productionStartDate,
        expectedCompletionDate: d.expectedCompletionDate ?? oldValues.expectedCompletionDate,
        expectedShipmentDate: d.expectedShipmentDate ?? oldValues.expectedShipmentDate,
        finalPaymentDueDate: d.finalPaymentDueDate ?? oldValues.finalPaymentDueDate,
      };
      const hasChange = Object.keys(oldValues).some(k => oldValues[k] !== newValues[k]);
      if (!hasChange) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有任何日期發生變更" });

      // 用「合併後的完整日期集合」驗證順序，避免前端只清空表單欄位（=沿用舊值）卻讓
      // 舊值相對新填的日期變得不合法時繞過驗證
      const dateOrderError = validateOrderDateChain(newValues as any);
      if (dateOrderError) throw new TRPCError({ code: "BAD_REQUEST", message: dateOrderError });

      try {
        await db.createCollaborationOrderChangeRequest({
          orderId: input.orderId,
          requestedByUserId: ctx.user.id,
          reason: input.reason,
          oldValues,
          newValues,
        });
      } catch (e: any) {
        if (e?.message === "PENDING_EXISTS") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "目前已有待確認的日期修改申請，請等對方回應後再提出" });
        }
        throw e;
      }
      // 通知需求方：工廠申請修改日期
      if (order.acceptedAsType === "factory" && order.acceptedAsFactoryId) {
        notifyFactoryMembers(
          order.acceptedAsFactoryId,
          {
            actorUserId: ctx.user.id,
            actorFactoryId: sellerFactory?.id ?? null,
            actorFactoryName: sellerFactory?.name ?? null,
            actorName: sellerFactory?.name ?? ctx.user.name ?? "工廠",
            eventType: "collab_order_date_change_request",
            eventGroup: "collab_order",
            message: `「${order.projectName}」有日期修改申請，請確認`,
            actionUrl: `/orders/${order.id}`,
            titleSnapshot: order.projectName,
            dedupeKey: `collab_date_req:${order.id}:${Date.now()}`,
          },
          {
            title: "OXM 日期修改申請",
            body: `「${order.projectName}」有日期修改申請，請確認`,
            data: { type: "collab_order", targetPath: `/orders/${order.id}` },
          },
          { excludeUserId: ctx.user.id }
        );
      } else {
        notifyUser(
          order.buyerUserId,
          {
            actorUserId: ctx.user.id,
            actorFactoryId: sellerFactory?.id ?? null,
            actorFactoryName: sellerFactory?.name ?? null,
            actorName: sellerFactory?.name ?? ctx.user.name ?? "工廠",
            eventType: "collab_order_date_change_request",
            eventGroup: "collab_order",
            message: `「${order.projectName}」有日期修改申請，請確認`,
            actionUrl: `/orders/${order.id}`,
            titleSnapshot: order.projectName,
            dedupeKey: `collab_date_req:${order.id}:${Date.now()}`,
          },
          {
            title: "OXM 日期修改申請",
            body: `「${order.projectName}」有日期修改申請，請確認`,
            data: { type: "collab_order", targetPath: `/orders/${order.id}` },
          }
        );
      }
      return { success: true };
    }),

    // Phase 4B: 需求方確認或拒絕日期修改申請
    respondDateChange: protectedProcedure.input(z.object({
      requestId: z.number(),
      action: z.enum(["accepted", "rejected"]),
    })).mutation(async ({ ctx, input }) => {
      const changeReq = await db.getCollaborationOrderChangeRequestById(input.requestId);
      if (!changeReq) throw new TRPCError({ code: "NOT_FOUND", message: "找不到日期修改申請" });
      if (changeReq.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此申請已非待確認狀態" });

      const order = await db.getCollaborationOrderById(changeReq.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到訂單" });

      const uid = ctx.user.id;
      let canRespond = false;
      if (order.acceptedAsType === "factory" && order.acceptedAsFactoryId) {
        const placedFactory = await db.getFactoryById(order.acceptedAsFactoryId);
        const isOwner = placedFactory?.ownerId === uid;
        const isCoMgr = !isOwner && !!placedFactory && await db.isActiveCoManager(order.acceptedAsFactoryId, uid);
        canRespond = isOwner || isCoMgr;
      } else {
        canRespond = order.buyerUserId === uid;
      }
      if (!canRespond) throw new TRPCError({ code: "FORBIDDEN", message: "只有需求方可確認日期修改" });

      try {
        await db.respondCollaborationOrderChangeRequest(input.requestId, input.action);
      } catch (e: any) {
        if (e?.message === "NOT_PENDING") throw new TRPCError({ code: "BAD_REQUEST", message: "此申請已非待確認狀態" });
        throw e;
      }
      // 通知原始日期修改申請者（而非整個工廠），告知需求方的回應
      notifyUser(
        changeReq.requestedByUserId,
        {
          actorUserId: ctx.user.id,
          actorName: ctx.user.name ?? "需求方",
          eventType: `collab_order_date_change_${input.action}`,
          eventGroup: "collab_order",
          message: input.action === "accepted"
            ? `${ctx.user.name ?? "需求方"} 同意了「${order.projectName}」的日期修改申請`
            : `${ctx.user.name ?? "需求方"} 拒絕了「${order.projectName}」的日期修改申請`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_date_respond:${input.requestId}:${input.action}`,
        },
        {
          title: `OXM 日期修改${input.action === "accepted" ? "已通過" : "被拒絕"}`,
          body: input.action === "accepted"
            ? `「${order.projectName}」日期修改已通過`
            : `「${order.projectName}」日期修改被拒絕`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true };
    }),

    markCompleted: protectedProcedure.input(z.object({
      orderId: z.number(),
      completionNote: z.string().max(2000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "訂單已完成" });
      if (!["accepted", "in_progress", "shipped"].includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單狀態無法完成" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可完成訂單" });
      // 不可跳階：訂單若已有 currentStage 紀錄（本次新增的製作階段機制），必須先手動推進到
      // 「待結款」才能完成訂單，避免這裡（既有完成訂單流程）繞過 advanceStage 的不可跳階保證。
      // 舊資料 currentStage 為 null（migration 對 pending/rejected/legacy 狀態不回填）時不擋，
      // 沿用完成訂單原本以日期／提早出貨旗標為準的既有邏輯。
      if (order.currentStage && order.currentStage !== "awaiting_final_payment") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請先使用「進入下一階段」推進到「待結款」才能完成訂單" });
      }
      const hasEarlyShipped = !!order.earlyShippedAt;
      if (!hasEarlyShipped) {
        if (!order.finalPaymentDueDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "尚未設定尾款日期，無法完成訂單" });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(order.finalPaymentDueDate + "T00:00:00");
        if (dueDate > today) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "尾款日期尚未到，暫時無法完成訂單" });
        }
      }
      const note = input.completionNote?.trim() || null;
      try {
        await db.markCollaborationOrderComplete(
          order.id, ctx.user.id, note,
          ctx.user.name ?? ctx.user.email ?? "",
          factory.name,
          hasEarlyShipped,
          order.finalPaymentDueDate ?? null,
        );
      } catch (e: any) {
        if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
        throw e;
      }
      // 通知買家：訂單已完成
      notifyUser(
        order.buyerUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_completed",
          eventGroup: "collab_order",
          message: `「${order.projectName}」已完成，感謝此次合作`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_order_completed:${order.id}`,
        },
        {
          title: "OXM 訂單已完成",
          body: `「${order.projectName}」已完成，感謝此次合作`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true };
    }),

    // 手動推進訂單製作階段（Phase：階段性註記＋timeline）。日期抵達不會自動觸發，
    // 一律要求供應工廠方明確按下「進入下一階段」才會改變 currentStage。
    advanceStage: protectedProcedure.input(z.object({
      orderId: z.number(),
      note: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status !== "accepted") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單狀態無法推進階段" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可推進訂單階段" });

      const currentStage = order.currentStage;
      if (!currentStage) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單尚未設定製作階段，無法推進" });
      }
      const nextStage = db.COLLABORATION_ORDER_NEXT_STAGE[currentStage];
      if (!nextStage) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `無法從「${currentStage}」推進到下一階段` });
      }

      // 提早判斷：以「目前階段離開時」對應的預計日期節點跟今天比較（YYYY-MM-DD 字串比較，不轉 UTC）
      const dateField = db.COLLABORATION_ORDER_STAGE_TRANSITION_DATE_FIELD[currentStage];
      const expectedDate = dateField ? ((order as any)[dateField] as string | null) : null;
      const todayStr = db.twDateStr();
      const isEarly = isStageTransitionEarly(todayStr, expectedDate);

      const note = input.note?.trim() || null;
      try {
        await db.advanceCollaborationOrderStage({
          orderId: order.id,
          expectedCurrentStage: currentStage,
          nextStage,
          actorUserId: ctx.user.id,
          actorNameSnapshot: ctx.user.name ?? ctx.user.email ?? "",
          actorFactoryNameSnapshot: factory.name,
          note,
          isEarly,
          expectedDateAtTransition: expectedDate,
        });
      } catch (e: any) {
        if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
        throw e;
      }

      const nextStageLabel = COLLABORATION_ORDER_STAGE_LABELS[nextStage as keyof typeof COLLABORATION_ORDER_STAGE_LABELS] ?? nextStage;
      notifyUser(
        order.buyerUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_stage_advanced",
          eventGroup: "collab_order",
          message: `「${order.projectName}」已進入「${nextStageLabel}」`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_order_stage:${order.id}:${nextStage}`,
        },
        {
          title: "OXM 訂單階段更新",
          body: `「${order.projectName}」已進入「${nextStageLabel}」`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true, nextStage };
    }),

    earlyComplete: protectedProcedure.input(z.object({
      orderId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (!["accepted", "in_progress"].includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單狀態無法提早完工" });
      }
      if (order.earlyCompletedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已記錄提早完工" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可操作" });
      await db.earlyCompleteOrder(order.id, ctx.user.id);
      // 通知買家：提早完工
      notifyUser(
        order.buyerUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_early_complete",
          eventGroup: "collab_order",
          message: `「${order.projectName}」已提早完工`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_early_complete:${order.id}`,
        },
        {
          title: "OXM 提早完工",
          body: `「${order.projectName}」已提早完工`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true };
    }),

    earlyShip: protectedProcedure.input(z.object({
      orderId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (!["accepted", "in_progress"].includes(order.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此訂單狀態無法提早出貨" });
      }
      if (order.earlyShippedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "已記錄提早出貨" });
      }
      const factory = await db.getFactoryById(order.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可操作" });
      await db.earlyShipOrder(order.id, ctx.user.id);
      // 通知買家：提早出貨
      notifyUser(
        order.buyerUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_early_ship",
          eventGroup: "collab_order",
          message: `「${order.projectName}」已提早出貨`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_early_ship:${order.id}`,
        },
        {
          title: "OXM 提早出貨",
          body: `「${order.projectName}」已提早出貨`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        }
      );
      return { success: true };
    }),

    requestRepeat: protectedProcedure.input(z.object({
      orderId: z.number(),
      asFactoryId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const order = await db.getCollaborationOrderById(input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "只有已完成的訂單可重複下訂" });

      if (input.asFactoryId) {
        const factory = await db.getFactoryById(input.asFactoryId);
        if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
        const isOwner = factory.ownerId === ctx.user.id;
        const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
        if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "無此工廠權限" });
        if (order.acceptedAsFactoryId !== input.asFactoryId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "工廠身分不符" });
        }
      } else {
        if (order.buyerUserId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有原需求方可重複下訂" });
        }
      }

      const requestId = await db.createRepeatOrderRequest({
        originalOrderId: order.id,
        conversationId: order.conversationId,
        requestedByUserId: ctx.user.id,
        requestedAsFactoryId: input.asFactoryId ?? null,
      });

      await db.saveMessage(
        order.conversationId,
        ctx.user.id,
        input.asFactoryId ? "factory" : "user",
        "重複下訂申請",
        "collaboration_order",
        {
          subType: "repeat_order_request",
          requestId,
          orderId: order.id,
          projectName: order.projectName,
          description: order.description,
          requestedByUserId: ctx.user.id,
          requestedAsFactoryId: input.asFactoryId ?? null,
        }
      );

      // 通知供應工廠：有重複下訂申請
      notifyFactoryMembers(
        order.factoryId,
        {
          actorUserId: ctx.user.id,
          actorName: ctx.user.name ?? "需求方",
          eventType: "collab_order_repeat_request",
          eventGroup: "collab_order",
          message: `${ctx.user.name ?? "需求方"} 申請重複下訂「${order.projectName}」`,
          actionUrl: `/orders/${order.id}`,
          titleSnapshot: order.projectName,
          dedupeKey: `collab_repeat_req:${requestId}`,
        },
        {
          title: "OXM 重複下訂申請",
          body: `${ctx.user.name ?? "需求方"} 申請重複下訂「${order.projectName}」`,
          data: { type: "collab_order", targetPath: `/orders/${order.id}` },
        },
        { excludeUserId: ctx.user.id }
      );

      return { success: true, requestId };
    }),

    respondRepeatRequest: protectedProcedure.input(z.object({
      requestId: z.number(),
      action: z.enum(["accept", "reject"]),
      projectName: z.string().min(1).max(200).optional(),
      description: z.string().min(1).optional(),
      depositDueDate: z.string().nullable().optional(),
      productionStartDate: z.string().nullable().optional(),
      expectedCompletionDate: z.string().nullable().optional(),
      expectedShipmentDate: z.string().nullable().optional(),
      finalPaymentDueDate: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const request = await db.getRepeatOrderRequest(input.requestId);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "找不到重複下訂申請" });
      if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "此申請已處理" });

      const originalOrder = await db.getCollaborationOrderById(request.originalOrderId);
      if (!originalOrder) throw new TRPCError({ code: "NOT_FOUND", message: "找不到原始訂單" });

      const factory = await db.getFactoryById(originalOrder.factoryId);
      if (!factory) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工廠" });
      const isOwner = factory.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && await db.isActiveCoManager(factory.id, ctx.user.id);
      if (!isOwner && !isCoMgr) throw new TRPCError({ code: "FORBIDDEN", message: "只有供應工廠方可回覆" });

      if (input.action === "reject") {
        await db.respondRepeatOrderRequest(input.requestId, "rejected");
        // 通知申請方：被拒絕
        notifyUser(
          request.requestedByUserId,
          {
            actorUserId: ctx.user.id,
            actorFactoryId: factory.id,
            actorFactoryName: factory.name,
            actorName: factory.name,
            eventType: "collab_order_repeat_rejected",
            eventGroup: "collab_order",
            message: `「${factory.name}」拒絕了重複下訂「${originalOrder.projectName}」的申請`,
            actionUrl: `/orders/${originalOrder.id}`,
            titleSnapshot: originalOrder.projectName,
            dedupeKey: `collab_repeat_rejected:${input.requestId}`,
          },
          {
            title: "OXM 重複下訂遭拒",
            body: `「${factory.name}」拒絕了重複下訂「${originalOrder.projectName}」`,
            data: { type: "collab_order", targetPath: `/orders/${originalOrder.id}` },
          }
        );
        return { success: true };
      }

      // Accept: create new order with status=accepted
      if (!input.projectName || !input.description) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "請填寫合作項目名稱與描述" });
      }
      const dateOrderError = validateOrderDateChain({
        depositDueDate: input.depositDueDate,
        productionStartDate: input.productionStartDate,
        expectedCompletionDate: input.expectedCompletionDate,
        expectedShipmentDate: input.expectedShipmentDate,
        finalPaymentDueDate: input.finalPaymentDueDate,
      });
      if (dateOrderError) throw new TRPCError({ code: "BAD_REQUEST", message: dateOrderError });

      const newOrderId = await db.createCollaborationOrder({
        conversationId: originalOrder.conversationId,
        factoryId: originalOrder.factoryId,
        buyerUserId: request.requestedByUserId,
        createdByUserId: ctx.user.id,
        productId: null,
        projectName: input.projectName.trim(),
        description: input.description.trim(),
        depositDueDate: input.depositDueDate ?? null,
        productionStartDate: input.productionStartDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        expectedShipmentDate: input.expectedShipmentDate ?? null,
        finalPaymentDueDate: input.finalPaymentDueDate ?? null,
        note: input.note?.trim() ?? null,
      });

      // Set accepted directly
      await db.respondCollaborationOrder(newOrderId, "accepted", {
        acceptedAsType: request.requestedAsFactoryId ? "factory" : "user",
        acceptedAsFactoryId: request.requestedAsFactoryId ?? null,
        acceptedByUserId: request.requestedByUserId,
      });

      await db.respondRepeatOrderRequest(input.requestId, "accepted");

      await db.saveMessage(
        originalOrder.conversationId,
        ctx.user.id,
        "factory",
        "已同意重複下訂，新合作確認單已建立",
        "collaboration_order",
        {
          subType: "repeat_order_accepted",
          requestId: input.requestId,
          newOrderId,
          projectName: input.projectName.trim(),
        }
      );

      // 通知申請方：重複下訂已接受，新訂單已建立
      notifyUser(
        request.requestedByUserId,
        {
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "collab_order_repeat_accepted",
          eventGroup: "collab_order",
          message: `「${factory.name}」接受了重複下訂，新合作確認單已建立`,
          actionUrl: `/orders/${newOrderId}`,
          titleSnapshot: input.projectName.trim(),
          dedupeKey: `collab_repeat_accepted:${input.requestId}`,
        },
        {
          title: "OXM 重複下訂已接受",
          body: `「${factory.name}」接受了重複下訂，新合作確認單已建立`,
          data: { type: "collab_order", targetPath: `/orders/${newOrderId}` },
        }
      );

      return { success: true, newOrderId };
    }),

    getForConversation: protectedProcedure.input(z.object({
      conversationId: z.number(),
    })).query(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) return [];
      const [conv] = await db_.select().from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
      if (!conv) return [];
      const factory = await db.getFactoryById(conv.factoryId);
      const isOwner = factory?.ownerId === ctx.user.id;
      const isCoMgr = !isOwner && !!factory && await db.isActiveCoManager(factory.id, ctx.user.id);
      const isBuyer = conv.userId === ctx.user.id;
      if (!isOwner && !isCoMgr && !isBuyer) return [];
      return db.getCollaborationOrdersForConversation(input.conversationId);
    }),

    createVerifiedReview: protectedProcedure.input(z.object({
      collaborationOrderId: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const order = await db.getCollaborationOrderById(input.collaborationOrderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "找不到合作確認單" });
      if (order.buyerUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "僅該合作需求方可留下評價" });
      if (order.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "合作尚未完成" });
      await db.createVerifiedOrderReview({
        factoryId: order.factoryId,
        userId: ctx.user.id,
        collaborationOrderId: order.id,
        rating: input.rating,
        comment: input.comment,
      });
      return { success: true };
    }),
  }),

  // ===== 評價 =====
  review: router({
    getByFactory: publicProcedure.input(z.object({
      factoryId: z.number(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getReviewsByFactory(input.factoryId, input.page, input.pageSize);
    }),

    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const existing = await db.getReviewByUserAndFactory(ctx.user.id, input.factoryId);
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "您已為此工廠留過評價" });
      await db.createReview({ ...input, userId: ctx.user.id });
      return { success: true };
    }),

    myReviews: protectedProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ ctx, input }) => {
      return db.getReviewsByUser(ctx.user.id, input.page, input.pageSize);
    }),
    getMyReviewForFactory: protectedProcedure.input(z.object({
      factoryId: z.number(),
    })).query(async ({ ctx, input }) => {
      return db.getReviewByUserAndFactory(ctx.user.id, input.factoryId);
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      rating: z.number().min(1).max(5),
      comment: z.string().max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateReview(id, ctx.user.id, data);
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({
      id: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await db.deleteReview(input.id, ctx.user.id);
      return { success: true };
    }),
    unreadCount: protectedProcedure
      .input(z.object({ since: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const factory = await db.getFactoryByOwnerId(ctx.user.id);
        if (!factory) return { count: 0 };
        const since = input?.since ? new Date(input.since) : undefined;
        return db.countNewReviewsSince(factory.id, since);
      }),

    reply: protectedProcedure.input(z.object({
      reviewId: z.number(),
      reply: z.string().max(1000),
    })).mutation(async ({ ctx, input }) => {
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      const [review] = await db_.select().from(reviews).where(eq(reviews.id, input.reviewId)).limit(1);
      if (!review) throw new Error("評價不存在");
      const factory = await db.getFactoryById(review.factoryId);
      if (!factory || factory.ownerId !== ctx.user.id) throw new Error("無權限");
      await db_.update(reviews).set({
        reply: input.reply,
        repliedAt: new Date(),
      }).where(eq(reviews.id, input.reviewId));

      // 通知評價者（若有開啟 reviewReply 通知設定）
      db.getUserById(review.userId).then((reviewer) => {
        const settings = (reviewer?.notificationSettings as Record<string, boolean> | null) ?? {};
        if (reviewer?.email && settings.reviewReply !== false) {
          sendReviewReplyEmail({
            userEmail: reviewer.email,
            userName: reviewer.name ?? '您',
            factoryName: factory.name,
            originalComment: review.comment ?? '',
            replyContent: input.reply,
            factoryId: factory.id,
          }).catch(() => {});
        }
        if (settings.pushReviewReply !== false) {
          sendPushToRecipients({
            userIds: [review.userId],
            excludeUserId: ctx.user.id,
            title: "OXM 工廠回覆了你的評價",
            body: `${factory.name} 回覆了你的評價`,
            data: {
              type: "review_reply",
              factoryId: String(factory.id),
              targetPath: `/factory/${factory.id}`,
            },
          }).catch((err) => { console.error("[Push] review_reply failed:", err instanceof Error ? err.message : String(err)); });
        }
        // 站內通知
        createPlatformNotifications([{
          recipientUserId: review.userId,
          actorUserId: ctx.user.id,
          actorFactoryId: factory.id,
          actorFactoryName: factory.name,
          actorName: factory.name,
          eventType: "review_reply",
          eventGroup: "review",
          message: `${factory.name} 回覆了你的評價`,
          actionUrl: `/factory/${factory.id}#reviews`,
          dedupeKey: `review_reply:${input.reviewId}`,
        }]).catch(() => {});
      }).catch(() => {});

      return { success: true };
    }),
  }),

  // ===== 工廠收藏 =====
  favorite: router({
  toggle: protectedProcedure.input(z.object({ factoryId: z.number() })).mutation(async ({ ctx, input }) => {
    const isFavorited = await db.toggleFavorite(ctx.user.id, input.factoryId);
    return { isFavorited };
  }),

  isLiked: protectedProcedure.input(z.object({ factoryId: z.number() })).query(async ({ ctx, input }) => {
    const isFavorited = await db.isFavorited(ctx.user.id, input.factoryId);
    return { isFavorited };
  }),

  batchIsLiked: protectedProcedure
    .input(z.object({ factoryIds: z.array(z.number()).max(100) }))
    .query(async ({ ctx, input }) => {
      const favoritedSet = await db.getFavoritedFactoryIds(ctx.user.id, input.factoryIds);
      const result: Record<number, boolean> = {};
      for (const id of input.factoryIds) {
        result[id] = favoritedSet.has(id);
      }
      return result;
    }),

  getByUser: protectedProcedure.input(z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })).query(async ({ ctx, input }) => {
    const result = await db.getFavoritesByUser(ctx.user.id, input.page, input.pageSize);
    // 收藏清單裡的工廠對這位使用者來說只是一般會員視角，不是 owner／共管者／admin，
    // 一律不得看到 certificationEvidence，徽章也只能看到公開顯示的子集合。
    return { ...result, items: result.items.map(f => stripHiddenBadgesForPublic(stripCertificationEvidence(f))) };
  }),
}),

  // ===== 管理員儀表板 =====
  admin: router({
    getStats: adminProcedure.query(async () => {
      return db.getAdminStats();
    }),
    getPendingCount: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') return { count: 0, factoryCount: 0, revisionCount: 0 };
      const [factoryCount, revisionCount] = await Promise.all([
        (async () => {
          const db_ = await getDb();
          if (!db_) return 0;
          const [result] = await db_.select({ count: sql<number>`COUNT(*)` })
            .from(factories).where(eq(factories.status, 'pending'));
          return Number(result?.count ?? 0);
        })(),
        db.getPendingRevisionCount(),
      ]);
      return { count: factoryCount + revisionCount, factoryCount, revisionCount };
    }),

    getAdminNotifications: adminProcedure.query(async () => {
      return db.getAdminPendingNotifications();
    }),

    getFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      status: z.enum(['approved', 'pending', 'rejected']).optional(),
      region: z.string().trim().min(1).optional(),
      industry: z.string().trim().min(1).optional(),
    })).query(async ({ input }) => {
      return db.getAdminFactories(input.page, input.pageSize, input.search, input.status, input.region, input.industry);
    }),

    getUsers: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    })).query(async ({ input }) => {
      return db.getAdminUsers(input.page, input.pageSize, input.search);
    }),

    getAds: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminAds(input.page, input.pageSize);
    }),

    getReviews: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminReviews(input.page, input.pageSize);
    }),

    getFactoryDetail: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const factory = await db.getFactoryById(input.id);
      if (!factory) return null;
      const owner = await db.getUserById(factory.ownerId);
      const drizzle = await getDb();
      let coManagers: Array<{ userId: number; name: string | null; email: string | null }> = [];
      if (drizzle) {
        const cmRows = await drizzle
          .select({
            userId: factoryCoManagers.userId,
            name: users.name,
            primaryEmail: users.primaryEmail,
            email: users.email,
          })
          .from(factoryCoManagers)
          .innerJoin(users, eq(factoryCoManagers.userId, users.id))
          .where(and(
            eq(factoryCoManagers.factoryId, input.id),
            isNull(factoryCoManagers.removedAt),
          ));
        coManagers = cmRows.map(r => ({ userId: r.userId, name: r.name, email: r.primaryEmail ?? r.email }));
      }
      return { ...factory, ownerAccountName: owner?.name ?? null, ownerAccountEmail: owner?.email ?? null, coManagers };
    }),

    approveFactory: adminProcedure.input(z.object({ factoryId: z.number() })).mutation(async ({ input }) => {
  await db.approveFactoryWithBadgeSync(input.factoryId);
  const factory = await db.getFactoryById(input.factoryId);
  if (factory?.contactEmail) {
    await sendFactoryApprovedEmail({
      factoryName: factory.name,
      factoryEmail: factory.contactEmail,
    });
  }
  if (factory) {
    sendPushToRecipients({
      userIds: [factory.ownerId],
      title: "OXM 工廠審核通過",
      body: `「${factory.name}」已通過審核，現已正式上架`,
      data: { type: "factory_approved", targetPath: "/dashboard" },
    }).catch((err) => { console.error("[Push] factory_approved failed:", err instanceof Error ? err.message : String(err)); });
    createPlatformNotifications([{
      recipientUserId: factory.ownerId,
      eventType: "factory_approved",
      eventGroup: "factory",
      message: `「${factory.name}」已通過審核，現已正式上架`,
      actionUrl: "/dashboard",
      dedupeKey: `factory_approved:${factory.id}:${Date.now()}`,
    }]).catch(() => {});
  }
  return { success: true };
}),

    rejectFactory: adminProcedure.input(z.object({ factoryId: z.number(), reason: z.string() })).mutation(async ({ input }) => {
      await db.updateFactory(input.factoryId, -1, { status: 'rejected', rejectionReason: input.reason });
      const rejectedFactory = await db.getFactoryById(input.factoryId);
      if (rejectedFactory?.contactEmail) {
        sendFactoryRejectedEmail({
          factoryName: rejectedFactory.name,
          factoryEmail: rejectedFactory.contactEmail,
          reason: input.reason || undefined,
        }).catch((err) => { console.error('[Email] 審核退回通知寄送失敗:', err); });
      }
      if (rejectedFactory) {
        sendPushToRecipients({
          userIds: [rejectedFactory.ownerId],
          title: "OXM 工廠審核結果",
          body: `「${rejectedFactory.name}」審核未通過，請修改後重新送審`,
          data: { type: "factory_rejected", targetPath: "/dashboard" },
        }).catch((err) => { console.error("[Push] factory_rejected failed:", err instanceof Error ? err.message : String(err)); });
        createPlatformNotifications([{
          recipientUserId: rejectedFactory.ownerId,
          eventType: "factory_rejected",
          eventGroup: "factory",
          message: `「${rejectedFactory.name}」審核未通過，請修改後重新送審`,
          actionUrl: "/dashboard",
          dedupeKey: `factory_rejected:${rejectedFactory.id}:${Date.now()}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),

    getPendingFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminPendingFactories(input.page, input.pageSize);
    }),

    getPendingRevisions: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminPendingRevisions(input.page, input.pageSize);
    }),

    // 「檢視詳情」導頁用：直接以 revisionId 取得單筆修改申請完整內容，
    // 讓 FactoryReviewDetail.tsx 不需要先載入整份待審清單。
    getRevisionDetail: adminProcedure.input(z.object({ revisionId: z.number() })).query(async ({ input }) => {
      const revision = await db.getAdminRevisionDetail(input.revisionId);
      if (!revision) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此修改申請' });
      return revision;
    }),

    approveRevision: adminProcedure.input(z.object({ revisionId: z.number() })).mutation(async ({ ctx, input }) => {
      // Pre-validate proposedData types before applying (defense-in-depth; submitRevision also validates)
      const revision = await db.getRevisionById(input.revisionId);
      if (revision && revision.status === 'pending') {
        const proposed = typeof revision.proposedData === 'string'
          ? JSON.parse(revision.proposedData as string)
          : revision.proposedData;
        const check = FactoryBasicDataSchema.safeParse(proposed);
        if (!check.success) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '修改申請資料格式有誤，無法套用，請要求工廠重新提交' });
        }
      }
      const result = await db.approveRevisionAtomic(input.revisionId, ctx.user!.id);
      // Notifications to owner + all active co-managers — fire-and-forget after successful transaction
      db.getCoManagersByFactory(result.factoryId).then(coMgrs => {
        // Email: deduplicated recipients (avoid Map/Set iteration; use array + includes check)
        const seenEmails: string[] = [];
        const recipients: Array<{ email: string; name: string | null }> = [];
        const addEmailRecipient = (email: string | null | undefined, name: string | null) => {
          if (!email || seenEmails.includes(email)) return;
          seenEmails.push(email);
          recipients.push({ email, name });
        };
        addEmailRecipient(result.ownerEmail, result.ownerName);
        for (const mgr of coMgrs) addEmailRecipient(mgr.email, mgr.name ?? null);
        for (const { email, name } of recipients) {
          sendRevisionApprovedEmail({
            factoryName: result.factoryName,
            factoryEmail: email,
            recipientName: name,
          }).catch(err => console.error('[Email] sendRevisionApprovedEmail failed:', err));
        }
        // Push: deduplicated userIds
        const pushIds: number[] = result.ownerId ? [result.ownerId] : [];
        for (const mgr of coMgrs) {
          if (mgr.userId && !pushIds.includes(mgr.userId)) pushIds.push(mgr.userId);
        }
        if (pushIds.length > 0) {
          sendPushToRecipients({
            userIds: pushIds,
            title: "OXM 資料修改申請通過",
            body: `「${result.factoryName}」的基本資料修改申請已通過`,
            data: { type: "revision_approved", targetPath: "/dashboard" },
          }).catch((err) => { console.error("[Push] revision_approved failed:", err instanceof Error ? err.message : String(err)); });
        }
        // 站內通知
        if (pushIds.length > 0) {
          createPlatformNotifications(pushIds.map(uid => ({
            recipientUserId: uid,
            eventType: "revision_approved",
            eventGroup: "factory",
            message: `「${result.factoryName}」的基本資料修改申請已通過`,
            actionUrl: "/dashboard",
            titleSnapshot: result.factoryName,
            dedupeKey: `revision_approved:${input.revisionId}:u${uid}`,
          }))).catch(() => {});
        }
      }).catch(() => {});
      return { success: true };
    }),

    rejectRevision: adminProcedure.input(z.object({
      revisionId: z.number(),
      reason: z.string().trim().min(1, "請填寫拒絕原因").max(500),
    })).mutation(async ({ ctx, input }) => {
      const result = await db.rejectRevisionAtomic(input.revisionId, ctx.user!.id, input.reason);
      // Notifications to owner + all active co-managers — fire-and-forget after successful transaction
      db.getCoManagersByFactory(result.factoryId).then(coMgrs => {
        const seenEmails: string[] = [];
        const recipients: Array<{ email: string; name: string | null }> = [];
        const addEmailRecipient = (email: string | null | undefined, name: string | null) => {
          if (!email || seenEmails.includes(email)) return;
          seenEmails.push(email);
          recipients.push({ email, name });
        };
        addEmailRecipient(result.ownerEmail, result.ownerName);
        for (const mgr of coMgrs) addEmailRecipient(mgr.email, mgr.name ?? null);
        for (const { email, name } of recipients) {
          sendRevisionRejectedEmail({
            factoryName: result.factoryName,
            factoryEmail: email,
            recipientName: name,
            reason: input.reason,
          }).catch(err => console.error('[Email] sendRevisionRejectedEmail failed:', err));
        }
        const pushIds: number[] = result.ownerId ? [result.ownerId] : [];
        for (const mgr of coMgrs) {
          if (mgr.userId && !pushIds.includes(mgr.userId)) pushIds.push(mgr.userId);
        }
        if (pushIds.length > 0) {
          sendPushToRecipients({
            userIds: pushIds,
            title: "OXM 資料修改申請結果",
            body: `「${result.factoryName}」的基本資料修改申請未通過，請確認原因後重新申請`,
            data: { type: "revision_rejected", targetPath: "/dashboard" },
          }).catch((err) => { console.error("[Push] revision_rejected failed:", err instanceof Error ? err.message : String(err)); });
        }
        // 站內通知
        if (pushIds.length > 0) {
          createPlatformNotifications(pushIds.map(uid => ({
            recipientUserId: uid,
            eventType: "revision_rejected",
            eventGroup: "factory",
            message: `「${result.factoryName}」的基本資料修改申請未通過，請確認原因後重新申請`,
            actionUrl: "/dashboard",
            titleSnapshot: result.factoryName,
            dedupeKey: `revision_rejected:${input.revisionId}:u${uid}`,
          }))).catch(() => {});
        }
      }).catch(() => {});
      return { success: true };
    }),

    getApprovedFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminApprovedFactories(input.page, input.pageSize);
    }),

    getRejectedFactories: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    })).query(async ({ input }) => {
      return db.getAdminRejectedFactories(input.page, input.pageSize);
    }),

    updateFactoryIndustry: adminProcedure.input(z.object({
      factoryId: z.number(),
      industry: z.array(z.string()).min(1, "請至少選擇一個產業分類"),
    })).mutation(async ({ input }) => {
      const invalid = input.industry.filter(v => !(INDUSTRY_OPTIONS as readonly string[]).includes(v));
      if (invalid.length > 0) throw new TRPCError({ code: 'BAD_REQUEST', message: `非合法產業值：${invalid.join('、')}` });
      const factory = await db.getFactoryById(input.factoryId);
      if (!factory) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到工廠' });
      await db.updateFactory(input.factoryId, -1, { industry: input.industry as any });
      return { success: true };
    }),

    getProducts: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      industry: z.string().optional(),
    })).query(async ({ input }) => {
      return db.getAdminProducts(input.page, input.pageSize, input.search, input.industry);
    }),

    getConversations: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      factoryId: z.number().optional(),
    })).query(async ({ input }) => {
      return db.getAdminConversations(input.page, input.pageSize, input.search, input.factoryId);
    }),

    getReviewsWithFilter: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      rating: z.number().optional(),
    })).query(async ({ input }) => {
      return db.getAdminReviews(input.page, input.pageSize);
    }),

    getReports: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      excludeResolved: z.boolean().optional(),
    })).query(async ({ input }) => {
      return db.getAdminReports(input.page, input.pageSize, input.status, input.excludeResolved);
    }),

    updateReportStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(['pending', 'received', 'reviewing', 'processing', 'resolved']),
      adminNote: z.string().optional(),
    })).mutation(async ({ input }) => {
      const report = await db.getReportById(input.id);
      await db.updateReportStatus(input.id, input.status, input.adminNote);
      // 通知檢舉者（Email + 站內通知）
      if (report?.userId) {
        const settings = (report.notificationSettings as Record<string, boolean> | null) ?? {};
        if (report.userEmail && settings.reportUpdate !== false) {
          sendReportStatusUpdateEmail({
            userEmail: report.userEmail,
            userName: report.userName ?? '您',
            factoryName: report.factoryName ?? '工廠',
            status: input.status,
          }).catch(() => {});
        }
        createPlatformNotifications([{
          recipientUserId: report.userId,
          eventType: "report_status_changed",
          eventGroup: "report",
          message: `您對「${report.factoryName ?? "工廠"}」的檢舉狀態已更新`,
          actionUrl: "/member",
          dedupeKey: `report_status:${input.id}:${input.status}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),
    getReportHistory: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getReportHistory(input.id);
    }),

    getSupportTickets: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
      excludeResolved: z.boolean().optional(),
    })).query(async ({ input }) => {
      return db.getAdminSupportTickets(input.page, input.pageSize, input.status, input.excludeResolved);
    }),

    updateTicketStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(['pending', 'received', 'reviewing', 'processing', 'resolved']),
      adminNote: z.string().optional(),
    })).mutation(async ({ input }) => {
      const ticket = await db.getSupportTicketById(input.id);
      await db.updateSupportTicketStatus(input.id, input.status, input.adminNote);
      // 通知投訴者（Email + 站內通知）
      if (ticket?.userId) {
        const settings = (ticket.notificationSettings as Record<string, boolean> | null) ?? {};
        if (ticket.userEmail && settings.ticketUpdate !== false) {
          sendTicketStatusUpdateEmail({
            userEmail: ticket.userEmail,
            userName: ticket.userName ?? '您',
            subject: ticket.subject,
            status: input.status,
          }).catch(() => {});
        }
        createPlatformNotifications([{
          recipientUserId: ticket.userId,
          eventType: "support_ticket_updated",
          eventGroup: "support",
          message: `您的客服投訴案件「${ticket.subject}」狀態已更新`,
          actionUrl: "/member",
          dedupeKey: `ticket_status:${input.id}:${input.status}`,
        }]).catch(() => {});
      }
      return { success: true };
    }),
    getTicketHistory: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getTicketHistory(input.id);
    }),

    getMessageCampaigns: adminProcedure.input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    })).query(async ({ input }) => {
      return db.getAdminMessageCampaigns(input.page, input.pageSize);
    }),

    createAdminMessage: adminProcedure.input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      targetType: z.enum(['all_users', 'all_factory_managers', 'single']),
      receiverIds: z.array(z.number().int()).optional(),
    })).mutation(async ({ ctx, input }) => {
      const campaignId = await db.createMessageCampaign({
        title: input.title,
        content: input.content,
        senderId: ctx.user!.id,
        targetType: input.targetType,
      });
      let receiverIds: number[] = [];
      if (input.targetType === 'all_users') {
        receiverIds = await db.getAllActiveUserIds();
      } else if (input.targetType === 'all_factory_managers') {
        receiverIds = await db.getFactoryManagerIds();
      } else if (input.targetType === 'single') {
        receiverIds = input.receiverIds ?? [];
      }
      await db.createMessageRecipients(campaignId, receiverIds);

      // 站內通知：通知所有收件人，fire-and-forget
      (async () => {
        try {
          if (receiverIds.length > 0) {
            const titleSnap = input.title.length > 100 ? input.title.slice(0, 97) + "..." : input.title;
            await createPlatformNotifications(receiverIds.map(uid => ({
              recipientUserId: uid,
              eventType: "admin_announcement",
              eventGroup: "platform",
              message: `平台通知：${titleSnap}`,
              actionUrl: `/admin-message/${campaignId}`,
              titleSnapshot: titleSnap,
              dedupeKey: `admin_announcement:${campaignId}:r:${uid}`,
            })));
          }
        } catch (err) {
          console.warn("[notification] admin_announcement station error:", err instanceof Error ? err.message : String(err));
        }
      })();

      // 手機推播：只推給 announcement === true 的使用者，fire-and-forget
      (async () => {
        try {
          const recipients = await db.getRecipientsWithEmails(campaignId);
          const pushIds = recipients
            .filter(r => ((r.notificationSettings as Record<string, boolean> | null) ?? {}).pushAnnouncement === true)
            .map(r => r.userId);
          if (pushIds.length > 0) {
            const bodyText = input.title.length > 100 ? input.title.slice(0, 97) + "..." : input.title;
            await sendPushToRecipients({
              userIds: pushIds,
              title: "OXM 平台通知",
              body: bodyText,
              data: {
                type: "admin_announcement",
                campaignId: String(campaignId),
                targetPath: "/messages",
              },
            });
          }
        } catch (err) {
          console.warn("[Push] campaign push error:", err instanceof Error ? err.message : String(err));
        }
      })();

      // 非同步寄信，不阻塞 response；sequential queue 避免 Resend 429
      (async () => {
        const INTER_EMAIL_DELAY_MS = 500;
        const RETRY_DELAYS_MS = [1500, 3000, 5000];

        const isRateLimitError = (err: unknown): boolean => {
          if (!err || typeof err !== 'object') return false;
          const e = err as Record<string, unknown>;
          const status = e['statusCode'] ?? e['status'] ?? (e['response'] as any)?.status;
          return status === 429;
        };

        try {
          const recipients = await db.getRecipientsWithEmails(campaignId);
          // announcement 預設 false（opt-in），只有明確設為 true 才寄
          const withEmail = recipients.filter(r => {
            if (!r.email) return false;
            const s = (r.notificationSettings as Record<string, boolean> | null) ?? {};
            return s['announcement'] !== false;
          });
          const skipped = recipients.length - withEmail.length;
          console.log(`[adminMessage] email queue start campaignId=${campaignId} total=${recipients.length} withEmail=${withEmail.length} skipped=${skipped}`);

          let successCount = 0;
          let failCount = 0;

          for (const r of withEmail) {
            let lastErr: unknown;
            let sent = false;

            for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
              try {
                await sendAdminBroadcastEmail({
                  toEmail: r.email!,
                  toName: r.name,
                  campaignTitle: input.title,
                  campaignContent: input.content,
                  campaignId,
                });
                console.log(`[adminMessage] email sent success campaignId=${campaignId} email=${r.email} attempt=${attempt}`);
                successCount++;
                sent = true;
                break;
              } catch (err) {
                lastErr = err;
                if (attempt <= RETRY_DELAYS_MS.length && isRateLimitError(err)) {
                  const wait = RETRY_DELAYS_MS[attempt - 1];
                  console.warn(`[adminMessage] email retry campaignId=${campaignId} email=${r.email} attempt=${attempt + 1} reason=429 waitMs=${wait}`);
                  await new Promise(res => setTimeout(res, wait));
                } else {
                  break;
                }
              }
            }

            if (!sent) {
              failCount++;
              console.error(`[adminMessage] email failed campaignId=${campaignId} email=${r.email} attempts=${RETRY_DELAYS_MS.length + 1} error=`, lastErr);
            }

            // 每封之間固定間隔，避免 rate limit
            await new Promise(res => setTimeout(res, INTER_EMAIL_DELAY_MS));
          }

          console.log(`[adminMessage] email queue done campaignId=${campaignId} success=${successCount} failed=${failCount} skipped=${skipped}`);
        } catch (err) {
          console.error(`[adminMessage] getRecipientsWithEmails failed for campaignId=${campaignId}:`, err);
        }
      })();
      return { campaignId, recipientCount: receiverIds.length };
    }),

    searchMessageReceivers: adminProcedure.input(z.object({
      query: z.string().min(1),
    })).query(async ({ input }) => {
      return db.searchUsersForMessage(input.query);
    }),

    previewMessageRecipientCount: adminProcedure.input(z.object({
      targetType: z.enum(['all_users', 'all_factory_managers', 'single']),
    })).query(async ({ input }) => {
      if (input.targetType === 'all_users') {
        const ids = await db.getAllActiveUserIds();
        return { count: ids.length };
      }
      if (input.targetType === 'all_factory_managers') {
        const ids = await db.getFactoryManagerIds();
        return { count: ids.length };
      }
      return { count: 1 };
    }),

    getMessageCampaignDetail: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      const campaign = await db.getAdminMessageCampaignById(input.campaignId);
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到此站內信' });
      return campaign;
    }),

    getCampaignAllRecipients: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      return db.getCampaignAllRecipients(input.campaignId);
    }),

    getCampaignReplyingUsers: adminProcedure.input(z.object({ campaignId: z.number() })).query(async ({ input }) => {
      return db.getCampaignReplyingUsers(input.campaignId);
    }),

    getCampaignThread: adminProcedure.input(z.object({
      campaignId: z.number(),
      userId: z.number(),
    })).query(async ({ input }) => {
      return db.getMessageThread(input.campaignId, input.userId);
    }),

    replyToUser: adminProcedure.input(z.object({
      campaignId: z.number(),
      userId: z.number(),
      content: z.string().min(1).max(2000),
    })).mutation(async ({ input }) => {
      await db.createMessageReply({
        campaignId: input.campaignId,
        userId: input.userId,
        content: input.content,
        senderRole: "admin",
      });
      return { success: true };
    }),

    markCampaignRecipientViewed: adminProcedure.input(z.object({
      campaignId: z.number().int(),
      recipientUserId: z.number().int(),
    })).mutation(async ({ input }) => {
      await db.markCampaignRecipientViewed(input.campaignId, input.recipientUserId);
      return { success: true };
    }),

    getAdminMessageCampaignUnreadStats: adminProcedure.query(async () => {
      return db.getCampaignsWithUnreadReplies();
    }),

    retractAdminMessage: adminProcedure.input(z.object({
      campaignId: z.number().int(),
      reason: z.string().max(500).default(''),
    })).mutation(async ({ ctx, input }) => {
      console.log(`[adminMessage] retract campaignId=${input.campaignId} by adminId=${ctx.user!.id} reason=${input.reason}`);
      await db.retractAdminMessageCampaign(input.campaignId, ctx.user!.id, input.reason);
      return { success: true };
    }),

    // 測試推播（admin only — 不輸出完整 token，只回傳統計數字）
    sendTestPushNotification: adminProcedure.input(z.object({
      userId: z.number().int().positive().optional(),
      title: z.string().max(100).optional(),
      body: z.string().max(200).optional(),
    })).mutation(async ({ ctx, input }) => {
      const targetUserId = input.userId ?? ctx.user!.id;
      const result = await sendPushToUser(targetUserId, {
        title: input.title ?? "OXM 測試通知",
        body: input.body ?? "你的手機推播通知已設定成功",
      });
      return { targetUserId, ...result };
    }),

    // Phase 4C：手動觸發訂單日期逾期 Email 檢查
    runOrderOverdueEmailCheck: adminProcedure.mutation(async () => {
      const result = await runCollaborationOrderOverdueEmailCheck();
      console.log(`[admin] runOrderOverdueEmailCheck:`, result);
      return result;
    }),

    // ===== 商案討論區後台管理 =====
    community: router({
      hidePost: adminProcedure
        .input(z.object({ postId: z.number().int(), hidden: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isHidden: input.hidden });
          return { success: true };
        }),

      lockPost: adminProcedure
        .input(z.object({ postId: z.number().int(), locked: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isLocked: input.locked });
          return { success: true };
        }),

      pinPost: adminProcedure
        .input(z.object({ postId: z.number().int(), pinned: z.boolean() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminSetCommunityPostFlags(input.postId, { isPinned: input.pinned });
          return { success: true };
        }),

      hideComment: adminProcedure
        .input(z.object({ commentId: z.number().int(), hidden: z.boolean() }))
        .mutation(async ({ input }) => {
          const comment = await db.getCommunityCommentById(input.commentId);
          if (!comment) throw new TRPCError({ code: "NOT_FOUND", message: "找不到留言" });
          await db.adminSetCommunityCommentHidden(input.commentId, input.hidden);
          return { success: true };
        }),

      deletePost: adminProcedure
        .input(z.object({ postId: z.number().int() }))
        .mutation(async ({ input }) => {
          const post = await db.getCommunityPostById(input.postId);
          if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到貼文" });
          await db.adminHardDeleteCommunityPost(input.postId);
          return { success: true };
        }),

      listPendingBids: adminProcedure
        .input(z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(50).default(20),
        }))
        .query(async ({ input }) => {
          return db.listCommunityBids({ status: "pending_review", page: input.page, pageSize: input.pageSize });
        }),

      approveBid: adminProcedure
        .input(z.object({ bidId: z.number().int() }))
        .mutation(async ({ ctx, input }) => {
          const bid = await db.getCommunityBidById(input.bidId);
          if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
          if (bid.status !== "pending_review") {
            throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核狀態可以通過審核" });
          }
          // Re-validate completeness before approving
          if (!bid.title?.trim() || !bid.description?.trim()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "需求缺少必填欄位（標題或說明），無法通過審核" });
          }
          await db.approveCommunityBid(input.bidId, ctx.user!.id, ctx.user!.name ?? "管理員");
          // Notify author
          if (bid.authorUserId != null) {
            try {
              await db.createCommunityNotificationsBatch([{
                recipientUserId: bid.authorUserId,
                actorUserId: ctx.user!.id,
                actorFactoryId: null,
                eventType: "bid_review_approved",
                eventGroup: "bid_review",
                postId: null,
                commentId: null,
                spaceCode: bid.spaceCode,
                titleSnapshot: bid.title,
                actorNameSnapshot: "管理員",
                actorFactoryNameSnapshot: null,
                message: `您的需求「${bid.title}」已通過審核，現在開放廠商接案`,
                dedupeKey: `bid:${bid.id}:approved:r:${bid.authorUserId}`,
              }]);
            } catch { /* best-effort */ }
          }
          return { success: true };
        }),

      rejectBid: adminProcedure
        .input(z.object({ bidId: z.number().int(), reason: z.string().min(1).max(1000).trim() }))
        .mutation(async ({ ctx, input }) => {
          const bid = await db.getCommunityBidById(input.bidId);
          if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
          if (bid.status !== "pending_review") {
            throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核狀態可以退回" });
          }
          await db.rejectCommunityBid(input.bidId, ctx.user!.id, ctx.user!.name ?? "管理員", input.reason);
          // Notify author
          if (bid.authorUserId != null) {
            try {
              await db.createCommunityNotificationsBatch([{
                recipientUserId: bid.authorUserId,
                actorUserId: ctx.user!.id,
                actorFactoryId: null,
                eventType: "bid_review_rejected",
                eventGroup: "bid_review",
                postId: null,
                commentId: null,
                spaceCode: bid.spaceCode,
                titleSnapshot: bid.title,
                actorNameSnapshot: "管理員",
                actorFactoryNameSnapshot: null,
                message: `您的需求「${bid.title}」審核未通過：${input.reason}`,
                dedupeKey: `bid:${bid.id}:rejected:r:${bid.authorUserId}`,
              }]);
            } catch { /* best-effort */ }
          }
          return { success: true };
        }),
    }),

    // ===== ISO 與低碳認證專區：認證服務管理（僅管理員） =====
    // 與既有徽章系統（factory.updateVisibleBadges／approveFactory 等）完全
    // 獨立，這裡只管理「認證服務」行銷／諮詢入口資料，不觸碰任何工廠已獲得
    // 徽章的擁有權資料。
    certificationServices: router({
      listCategories: adminProcedure.query(async () => {
        return db.adminListCertificationCategories();
      }),

      createCategory: adminProcedure.input(z.object({
        code: z.string().trim().min(1).max(50).regex(/^[a-z0-9-]+$/, "代碼只能包含小寫英文、數字與連字號"),
        name: z.string().trim().min(1).max(100),
      })).mutation(async ({ input }) => {
        try {
          const id = await db.adminCreateCertificationCategory(input);
          return { id };
        } catch (err: unknown) {
          if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "此分類代碼已存在" });
          }
          throw err;
        }
      }),

      updateCategory: adminProcedure.input(z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
      })).mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.adminUpdateCertificationCategory(id, data);
        return { success: true };
      }),

      moveCategory: adminProcedure.input(z.object({
        idA: z.number().int().positive(),
        idB: z.number().int().positive(),
      })).mutation(async ({ input }) => {
        await db.adminSwapCertificationCategoryOrder(input.idA, input.idB);
        return { success: true };
      }),

      listItems: adminProcedure.query(async () => {
        return db.adminListCertificationServiceItems();
      }),

      createItem: adminProcedure.input(z.object({
        code: z.string().trim().min(1).max(50).regex(/^[a-z0-9-]+$/, "代碼只能包含小寫英文、數字與連字號"),
        badgeCode: certificationServiceBadgeCodeSchema,
        categoryId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200),
        type: z.string().trim().min(1).max(50),
        shortDescription: z.string().trim().min(1).max(2000),
        applicableNeeds: z.array(z.string().max(50)).max(20),
        applicableIndustries: z.array(z.string().max(50)).max(20),
        versionNote: z.string().trim().max(300).nullable(),
        iconKey: z.string().trim().max(100).nullable().optional(),
        serviceEnabled: z.boolean(),
        consultEnabled: z.boolean(),
      })).mutation(async ({ input }) => {
        try {
          const id = await db.adminCreateCertificationServiceItem({ ...input, iconKey: input.iconKey ?? null });
          return { id };
        } catch (err: unknown) {
          if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "此服務項目代碼已存在" });
          }
          throw err;
        }
      }),

      updateItem: adminProcedure.input(z.object({
        id: z.number().int().positive(),
        badgeCode: certificationServiceBadgeCodeSchema.optional(),
        categoryId: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(200).optional(),
        type: z.string().trim().min(1).max(50).optional(),
        shortDescription: z.string().trim().min(1).max(2000).optional(),
        applicableNeeds: z.array(z.string().max(50)).max(20).optional(),
        applicableIndustries: z.array(z.string().max(50)).max(20).optional(),
        versionNote: z.string().trim().max(300).nullable().optional(),
        iconKey: z.string().trim().max(100).nullable().optional(),
        serviceEnabled: z.boolean().optional(),
        consultEnabled: z.boolean().optional(),
      })).mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.adminUpdateCertificationServiceItem(id, data);
        return { success: true };
      }),

      // 複製：讀取既有項目，另建一筆新草稿，代碼加上不重複的 -copy 後綴，
      // 不影響原項目的狀態或資料。
      duplicateItem: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
        const source = await db.getCertificationServiceItemById(input.id);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此服務項目" });
        const existing = await db.adminListCertificationServiceItems();
        const existingCodes = new Set(existing.map(i => i.code));
        let suffix = 1;
        let newCode = `${source.code}-copy`;
        while (existingCodes.has(newCode)) {
          suffix += 1;
          newCode = `${source.code}-copy-${suffix}`;
        }
        const id = await db.adminCreateCertificationServiceItem({
          code: newCode,
          badgeCode: source.badgeCode,
          categoryId: source.categoryId,
          name: `${source.name}（複製）`,
          type: source.type,
          shortDescription: source.shortDescription,
          applicableNeeds: (source.applicableNeeds ?? []) as string[],
          applicableIndustries: (source.applicableIndustries ?? []) as string[],
          versionNote: source.versionNote,
          iconKey: source.iconKey,
          serviceEnabled: source.serviceEnabled,
          consultEnabled: source.consultEnabled,
        });
        return { id };
      }),

      moveItem: adminProcedure.input(z.object({
        idA: z.number().int().positive(),
        idB: z.number().int().positive(),
      })).mutation(async ({ input }) => {
        await db.adminSwapCertificationServiceItemOrder(input.idA, input.idB);
        return { success: true };
      }),

      setStatus: adminProcedure.input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["draft", "published", "unpublished", "archived"]),
      })).mutation(async ({ input }) => {
        try {
          await db.adminSetCertificationServiceItemStatus(input.id, input.status);
          return { success: true };
        } catch (err: unknown) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "狀態更新失敗" });
        }
      }),

      // 只有草稿狀態可永久刪除，其餘狀態一律拒絕（見 db.adminDeleteCertificationServiceItem）。
      deleteItem: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
        try {
          await db.adminDeleteCertificationServiceItem(input.id);
          return { success: true };
        } catch (err: unknown) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "刪除失敗" });
        }
      }),
    }),
  }),

  // ===== 廣告 =====
  ad: router({
    getActive: publicProcedure.input(z.object({
      industry: z.string().optional(),
      capitalLevel: z.string().optional(),
      region: z.string().optional(),
    })).query(async ({ input }) => {
      const ads = await db.getActiveAds(input);
      return ads.slice(0, 5).map(ad => ad.factory ? { ...ad, factory: stripHiddenBadgesForPublic(stripCertificationEvidence(ad.factory)) } : ad);
    }),

    create: adminProcedure.input(z.object({
      factoryId: z.number(),
      industry: z.string(),
      capitalLevel: z.string(),
      region: z.string(),
      extraRegions: z.array(z.string()).optional(),
      startDate: z.date(),
      endDate: z.date(),
    })).mutation(async ({ input }) => {
      await db.createAd(input);
      return { success: true };
    }),
  }),

  // ===== 平台公告 =====
  announcement: router({
    list: publicProcedure.input(z.object({ limit: z.number().default(20) })).query(async ({ input }) => {
      return db.getAnnouncements(input.limit);
    }),
    create: adminProcedure.input(z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1),
      type: z.enum(["update", "maintenance", "news"]).default("news"),
      isPinned: z.boolean().default(false),
      // 只有 type === "news" 才會實際被存下來；格式驗證與「非 news 一律 null」
      // 這條規則的真正落地保證在 db.ts 的 normalizeAnnouncementActionUrl，
      // 這裡只是把值傳過去，不在 Router 層另外維護一份規則。
      actionUrl: z.string().max(500).nullable().optional(),
      // 一次性的發布選項：是否同步寄送 Email。不是公告本身的資料，因此不會
      // 進入 announcementData（見下方拆解），也不會寫入 announcements 資料表。
      sendEmail: z.boolean().default(false),
    })).mutation(async ({ input }) => {
      // sendEmail 只是這次發布動作的選項，明確與公告資料拆開，避免被當成
      // 公告欄位誤傳進 db.createAnnouncement／寫入資料庫。
      const { sendEmail, ...announcementData } = input;
      let announcementId: number;
      try {
        announcementId = await db.createAnnouncement(announcementData);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "建立公告失敗" });
      }
      const titleSnap = input.title.length > 100 ? input.title.slice(0, 97) + "..." : input.title;

      // 站內通知：發給所有 active users，fire-and-forget，獨立於 push/email
      (async () => {
        try {
          const allUsers = await db.getActiveUsersForAnnouncement();
          const allIds = allUsers.map(u => u.id);
          if (allIds.length > 0) {
            await createPlatformNotifications(allIds.map(uid => ({
              recipientUserId: uid,
              eventType: "admin_announcement",
              eventGroup: "platform",
              message: `平台公告：${titleSnap}`,
              actionUrl: `/announcements`,
              titleSnapshot: titleSnap,
              dedupeKey: `platform_announcement:${announcementId}:${uid}`,
            })));
          }
        } catch (err) {
          console.warn("[announcement] notification error:", err instanceof Error ? err.message : String(err));
        }
      })();

      // 手機推播：只推給 pushAnnouncement === true 的使用者，fire-and-forget，獨立於站內通知/email
      (async () => {
        try {
          const allUsers = await db.getActiveUsersForAnnouncement();
          const pushIds = allUsers
            .filter(u => ((u.notificationSettings as Record<string, boolean> | null) ?? {}).pushAnnouncement === true)
            .map(u => u.id);

          if (pushIds.length === 0) {
            console.log(`[announcement] push skipped id=${announcementId}: no users with pushAnnouncement enabled`);
            return;
          }

          const bodyText = toPlainPushSummary(input.content);
          const result = await sendPushToRecipients({
            userIds: pushIds,
            title: titleSnap,
            body: bodyText,
            data: {
              type: "admin_announcement",
              announcementId: String(announcementId),
              targetPath: "/announcements",
            },
          });
          console.log(`[announcement] push done id=${announcementId} targetUsers=${result.targetUserCount} tokens=${result.tokenCount} success=${result.successCount} failed=${result.failureCount}`);
        } catch (err) {
          console.error(`[announcement] push failed id=${announcementId}:`, err instanceof Error ? err.message : String(err));
        }
      })();

      // Email 廣播：一次性選項，只有管理員這次勾選 sendEmail 才會啟動；
      // 預設不勾選／舊版前端未傳此欄位時完全不會進到這個區塊，也就不會查詢
      // 收件人或呼叫 sendPlatformAnnouncementEmail()。與上面的站內通知／APP
      // 推播各自獨立的 fire-and-forget 區塊完全無關，不受這個條件影響。
      if (!sendEmail) {
        console.log(`[announcement] email skipped id=${announcementId}: not selected by admin`);
      } else {
      (async () => {
        const INTER_EMAIL_DELAY_MS = 500;
        const RETRY_DELAYS_MS = [1500, 3000, 5000];
        const isRateLimitError = (err: unknown): boolean => {
          if (!err || typeof err !== 'object') return false;
          const e = err as Record<string, unknown>;
          const status = e['statusCode'] ?? e['status'] ?? (e['response'] as Record<string, unknown>)?.['status'];
          return status === 429;
        };

        try {
          const allUsers = await db.getActiveUsersForAnnouncement();

          // Email：opt-out，notificationSettings.announcement !== false 就寄
          const withEmail = allUsers.filter(u => {
            if (!u.email) return false;
            const s = (u.notificationSettings as Record<string, boolean> | null) ?? {};
            return s['announcement'] !== false;
          });
          const skipped = allUsers.length - withEmail.length;
          console.log(`[announcement] email queue start id=${announcementId} total=${allUsers.length} withEmail=${withEmail.length} skipped=${skipped}`);

          let successCount = 0;
          let failCount = 0;

          for (const u of withEmail) {
            let lastErr: unknown;
            let sent = false;

            for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
              try {
                await sendPlatformAnnouncementEmail({
                  toEmail: u.email!,
                  toName: u.name,
                  announcementTitle: input.title,
                  announcementContent: input.content,
                });
                successCount++;
                sent = true;
                break;
              } catch (err) {
                lastErr = err;
                if (attempt <= RETRY_DELAYS_MS.length && isRateLimitError(err)) {
                  const wait = RETRY_DELAYS_MS[attempt - 1];
                  console.warn(`[announcement] email retry id=${announcementId} email=${u.email} attempt=${attempt + 1} waitMs=${wait}`);
                  await new Promise(res => setTimeout(res, wait));
                } else {
                  break;
                }
              }
            }

            if (!sent) {
              failCount++;
              console.error(`[announcement] email failed id=${announcementId} email=${u.email}`, lastErr);
            }

            await new Promise(res => setTimeout(res, INTER_EMAIL_DELAY_MS));
          }

          console.log(`[announcement] email queue done id=${announcementId} success=${successCount} failed=${failCount} skipped=${skipped}`);
        } catch (err) {
          console.error(`[announcement] broadcast failed id=${announcementId}:`, err);
        }
      })();
      }

      return { success: true };
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      title: z.string().min(1).max(200).optional(),
      content: z.string().min(1).optional(),
      type: z.enum(["update", "maintenance", "news"]).optional(),
      isPinned: z.boolean().optional(),
      // .nullable() 讓「明確傳 null 清空」與「完全沒帶這個欄位」在 db.ts 那邊
      // 可以被精確區分（用 "actionUrl" in data 判斷有沒有帶，而不是看值本身）。
      actionUrl: z.string().max(500).nullable().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      try {
        await db.updateAnnouncement(id, data);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "更新公告失敗" });
      }
      return { success: true };
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteAnnouncement(input.id);
      return { success: true };
    }),
  }),

  // ===== 找消息（產業情報／News）=====
  // 獨立於 announcement router 之外，見 server/db.ts news 相關函式的註解。
  news: router({
    // ---- 公開頁 ----
    list: publicProcedure.input(z.object({
      category: z.enum(["all", "important", "competition", "exhibition", "cross-industry", "industry"]).default("all"),
      industryName: z.string().max(50).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    })).query(async ({ input, ctx }) => {
      return db.listPublicNews({ ...input, userId: ctx.user?.id });
    }),
    getBySlug: publicProcedure.input(z.object({ slug: z.string().min(1).max(200) })).query(async ({ input }) => {
      const item = await db.getPublishedNewsBySlug(input.slug);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息" });
      const [industryNames, attachments] = await Promise.all([
        db.getNewsIndustryNames(item.id),
        db.getNewsAttachmentsPublic(item.id),
      ]);
      return { ...item, industryNames, attachments };
    }),
    // 分類清單側欄／手機版 Select 的 NEW 徽章：一次回傳所有分類的 NEW 狀態，
    // 前端不需要為每個分類各自發一次查詢，也不能只看目前已載入的第一頁資料。
    // 已登入會員的已讀狀態由後端查 newsReads 表；訪客沒有 session，只能相信
    // 前端從 localStorage 傳進來的 excludeIds（有 userId 時 excludeIds 會被忽略）。
    getNewCategorySummary: publicProcedure.input(z.object({
      excludeIds: z.array(z.number().int()).max(500).optional(),
    }).optional()).query(async ({ input, ctx }) => {
      return db.getNewCategorySummary({ userId: ctx.user?.id, excludeIds: input?.excludeIds });
    }),
    // 標記一篇消息為已讀（登入會員專用）——NEW 徽章「已讀就消失」的唯一寫入點。
    // 訪客的已讀狀態純粹存在瀏覽器 localStorage，不呼叫這支 API。
    markRead: protectedProcedure.input(z.object({ newsId: z.number().int() })).mutation(async ({ input, ctx }) => {
      await db.markNewsAsRead(ctx.user!.id, input.newsId);
      return { success: true };
    }),

    // 看板訂閱按鈕顯示用：回傳這個 boardKey 目前對這個使用者的有效訂閱狀態
    // （明確覆寫優先於動態預設，跟收件人聚合共用同一套規則 db.getEffectiveBoardSubscription）。
    // 未登入訪客固定回傳 isSubscribed=false + requiresLogin=true，前端據此開 LoginDialog，
    // 不在後端猜測訪客的訂閱意向、也不寫入任何資料。
    getBoardSubscriptionState: publicProcedure.input(z.object({
      boardKey: z.string().min(1).max(100),
    })).query(async ({ input, ctx }) => {
      if (!db.isValidNewsBoardKey(input.boardKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "無效的看板" });
      }
      if (!ctx.user) return { boardKey: input.boardKey, isSubscribed: false, requiresLogin: true };
      const isSubscribed = await db.getEffectiveBoardSubscription(ctx.user.id, input.boardKey);
      return { boardKey: input.boardKey, isSubscribed, requiresLogin: false };
    }),
    // 使用者明確訂閱／取消訂閱一個看板。一律用 ctx.user.id，不接受前端傳
    // userId；只影響未來新發布消息（見 db.setNewsBoardSubscription 的
    // doc comment），這支 mutation 本身完全不觸碰 newsNotifications 或
    // communityNotifications，不會因為訂閱操作觸發任何通知。
    setBoardSubscription: protectedProcedure.input(z.object({
      boardKey: z.string().min(1).max(100),
      isSubscribed: z.boolean(),
    })).mutation(async ({ input, ctx }) => {
      if (!db.isValidNewsBoardKey(input.boardKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "無效的看板" });
      }
      await db.setNewsBoardSubscription(ctx.user!.id, input.boardKey, input.isSubscribed);
      return { boardKey: input.boardKey, isSubscribed: input.isSubscribed };
    }),

    // ---- 管理員後台 ----
    adminList: adminProcedure.query(async () => {
      const items = await db.getAdminNewsList();
      const industryMap = await db.getNewsIndustryNamesBatch(items.map(i => i.id));
      return items.map(item => ({ ...item, industryNames: industryMap.get(item.id) ?? [] }));
    }),
    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getNewsById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息" });
      const industryNames = await db.getNewsIndustryNames(item.id);
      return { ...item, industryNames };
    }),
    // 發布確認彈窗用：預估這次分類設定會通知到多少去重後的會員，純讀取、不
    // 建立任何紀錄（不寫 newsNotifications、不寫 communityNotifications）。
    // 站內通知人數＝看板訂閱資格本身，不受 news／pushNews 開關影響；
    // Email／Push 人數則是同一份收件人清單再各自套用開關過濾後的子集。
    estimateRecipients: adminProcedure.input(z.object({
      isImportant: z.boolean(),
      isCompetition: z.boolean().default(false),
      isExhibition: z.boolean().default(false),
      isCrossIndustry: z.boolean().default(false),
      industryNames: z.array(z.string().max(50)).max(20).default([]),
    })).query(async ({ input }) => {
      const recipients = await db.gatherNewsRecipients(input);
      return {
        count: recipients.length,
        inAppCount: recipients.length,
        emailCount: recipients.filter(r => r.email).length,
        pushCount: recipients.filter(r => r.pushEnabled).length,
      };
    }),
    create: adminProcedure.input(z.object({
      // 不填（或空字串）→ 後端自動產生 news-YYYYMMDD-xxxxxxxx 格式的 slug，
      // 見 server/db.ts 的 createNews／generateUniqueNewsSlug。
      slug: z.string().max(200).optional(),
      title: z.string().min(1).max(200),
      summary: z.string().min(1).max(500),
      content: z.string().min(1),
      status: z.enum(["draft", "published"]).default("draft"),
      isImportant: z.boolean().default(false),
      isCompetition: z.boolean().default(false),
      isExhibition: z.boolean().default(false),
      isCrossIndustry: z.boolean().default(false),
      industryNames: z.array(z.string().max(50)).max(20).default([]),
      sourceName: z.string().max(200).nullable().optional(),
      sourceUrl: z.string().max(1000).nullable().optional(),
      // 「同時發送 Email 通知」checkbox，只有新增消息表單會帶這個欄位（見
      // client/src/pages/AdminNews.tsx）。optional 且伺服器端一律用
      // `=== true` 明確判斷，不依賴前端一定會帶入 false——沒收到這個欄位
      // （undefined）一律視同未勾選。news.update 完全不接受這個欄位，見下方
      // update 的 input schema 沒有這一項。
      sendEmailNotification: z.boolean().optional(),
    })).mutation(async ({ input, ctx }) => {
      let result: { id: number; shouldNotify: boolean };
      try {
        result = await db.createNews({ ...input, slug: input.slug || undefined, createdBy: ctx.user!.id });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "建立消息失敗" });
      }
      // slug 可能是後端自動產生的，input.slug 不一定等於最終值，一律重新讀一次
      // 拿確定正確的 slug——通知連結需要，前端「儲存草稿後顯示網址預覽」也
      // 需要，所以不只在 shouldNotify 分支才查。
      const created = await db.getNewsById(result.id);
      if (result.shouldNotify) {
        void dispatchNewsNotifications({
          newsId: result.id,
          title: input.title,
          summary: input.summary,
          slug: created?.slug ?? input.slug ?? "",
          isImportant: input.isImportant,
          isCompetition: input.isCompetition,
          isExhibition: input.isExhibition,
          isCrossIndustry: input.isCrossIndustry,
          industryNames: input.industryNames,
          sendEmail: input.sendEmailNotification === true,
        });
      }
      return { success: true, id: result.id, slug: created?.slug ?? input.slug ?? "" };
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      slug: z.string().min(1).max(200).optional(),
      title: z.string().min(1).max(200).optional(),
      summary: z.string().min(1).max(500).optional(),
      content: z.string().min(1).optional(),
      status: z.enum(["draft", "published", "withdrawn"]).optional(),
      isImportant: z.boolean().optional(),
      isCompetition: z.boolean().optional(),
      isExhibition: z.boolean().optional(),
      isCrossIndustry: z.boolean().optional(),
      industryNames: z.array(z.string().max(50)).max(20).optional(),
      sourceName: z.string().max(200).nullable().optional(),
      sourceUrl: z.string().max(1000).nullable().optional(),
      // 「同時發送 Email 通知」checkbox。從未發布過的草稿（firstPublishedAt
      // 仍是 NULL）在編輯畫面也會顯示這個 checkbox，本次更新若剛好是「第一次
      // 發布」（db.updateNews 回傳 shouldNotify === true）才會生效；已經發布
      // 過的消息即使前端沒攔下、被人手動塞 true 進來，下面也只看
      // result.shouldNotify，不會因為這個欄位而補寄。這裡刻意先從 input
      // 明確拆出，絕不讓它流進 db.updateNews() 當成資料庫欄位。
      sendEmailNotification: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const { id, sendEmailNotification, ...data } = input;
      let result: { shouldNotify: boolean };
      try {
        result = await db.updateNews(id, data);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "更新消息失敗" });
      }
      if (result.shouldNotify) {
        const [item, industryNames] = await Promise.all([db.getNewsById(id), db.getNewsIndustryNames(id)]);
        if (item) {
          void dispatchNewsNotifications({
            newsId: id,
            title: item.title,
            summary: item.summary,
            slug: item.slug,
            isImportant: item.isImportant,
            isCompetition: item.isCompetition,
            isExhibition: item.isExhibition,
            isCrossIndustry: item.isCrossIndustry,
            industryNames,
            // 進到這裡代表 db.updateNews() 已經確認這是「第一次發布」
            // （shouldNotify），三個條件（shouldNotify、確實首次發布、
            // sendEmailNotification===true）同時成立才會是 true——已發布過
            // 的消息這個 if 區塊本身就不會進來，天生擋掉補寄。
            sendEmail: sendEmailNotification === true,
          });
        }
      }
      return { success: true };
    }),
    // 管理員限定：重試這則消息目前狀態是 pending／failed 的通知紀錄，不會建立
    // 新紀錄、也不會影響已經 sent 的紀錄，因此重複點擊或編輯後再點擊都是安全的。
    retryNotifications: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      return retryNewsNotifications(input.id);
    }),

    // ---- 封面圖片／內文圖片：公開內容，沿用既有 storagePut 慣例（回傳公開
    // URL），不像 PDF 附件需要登入保護。base64 in、URL out，跟工廠大頭貼／
    // 產品圖片上傳是同一套既有模式，不另外發明第二套上傳流程。 ----
    uploadCoverImage: adminProcedure.input(z.object({
      newsId: z.number(),
      base64: z.string(),
      mimeType: z.string(),
      altText: z.string().max(200).optional(),
    })).mutation(async ({ input }) => {
      const item = await db.getNewsById(input.newsId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息，請先儲存草稿" });

      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer, 10 * 1024 * 1024);
      if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error ?? "圖片格式不正確" });

      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `news-covers/${input.newsId}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      const { previousKey } = await db.setNewsCover(input.newsId, { key, url, alt: input.altText?.trim() || null });
      if (previousKey && previousKey !== key) {
        await storageDelete(previousKey).catch(err => console.warn(`[news] failed to delete old cover key for newsId=${input.newsId}:`, err instanceof Error ? err.message : err));
      }
      return { url };
    }),

    removeCoverImage: adminProcedure.input(z.object({ newsId: z.number() })).mutation(async ({ input }) => {
      const { previousKey } = await db.clearNewsCover(input.newsId);
      if (previousKey) {
        await storageDelete(previousKey).catch(err => console.warn(`[news] failed to delete cover key for newsId=${input.newsId}:`, err instanceof Error ? err.message : err));
      }
      return { success: true };
    }),

    uploadContentImage: adminProcedure.input(z.object({
      newsId: z.number(),
      base64: z.string(),
      mimeType: z.string(),
      fileName: z.string().max(200).optional(),
    })).mutation(async ({ input }) => {
      const item = await db.getNewsById(input.newsId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息，請先儲存草稿" });

      const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
      const buffer = Buffer.from(base64Data, "base64");
      const validation = await validateImageUpload(buffer, 10 * 1024 * 1024);
      if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error ?? "圖片格式不正確" });

      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const key = `news-content/${input.newsId}/${nanoid()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);

      const altText = input.fileName ? input.fileName.replace(/\.[^.]+$/, "") : "";
      return { url, altText };
    }),

    // ---- PDF 附件：獨立私有 bucket，presigned 直傳 + finalize 二次驗證 ----
    // 25MB PDF 轉 base64 會膨脹到約 33MB，超過既有 tRPC body limit（圖片路由
    // 15MB／其餘 100kb），因此不比照封面/內文圖片的 base64-over-tRPC，改用
    // 前端直傳私有 S3 的 presigned URL 流程。

    // 管理員後台附件列表：刻意不回傳 storageKey，前端不需要也不該拿到內部路徑。
    getAdminAttachments: adminProcedure.input(z.object({ newsId: z.number() })).query(async ({ input }) => {
      const rows = await db.getNewsAttachmentsForAdmin(input.newsId);
      return rows.map(({ storageKey: _storageKey, ...rest }) => ({
        ...rest,
        ...db.computeNewsAttachmentStatus({
          expirationType: rest.expirationType as db.NewsAttachmentExpirationType,
          downloadExpiresAt: rest.downloadExpiresAt,
          storageDeletedAt: rest.storageDeletedAt,
        }),
      }));
    }),

    // 第一步：建立上傳工作階段。只回傳一次性、限定單一 UUID key 的 presigned
    // PUT 網址，不回傳 AWS 憑證，網址本身不記錄到 log。
    createPdfUploadSession: adminProcedure.input(z.object({
      newsId: z.number(),
      fileName: z.string().min(1).max(200),
      declaredMimeType: z.string(),
      declaredSizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
    })).mutation(async ({ input }) => {
      if (!isPrivateStorageConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "私有附件儲存尚未設定" });
      }
      const item = await db.getNewsById(input.newsId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息，請先儲存草稿" });
      if (input.declaredMimeType !== "application/pdf") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只允許上傳 PDF 檔案" });
      }
      const currentCount = await db.getNewsAttachmentCount(input.newsId);
      if (currentCount >= db.MAX_NEWS_ATTACHMENTS_PER_NEWS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `每篇消息最多只能有 ${db.MAX_NEWS_ATTACHMENTS_PER_NEWS} 份附件` });
      }

      const storageKey = `news-attachments/tmp/${nanoid()}.pdf`;
      const uploadUrl = await privateStorageCreateUploadUrl(storageKey, "application/pdf", 600);
      return { uploadUrl, storageKey, expiresInSeconds: 600 };
    }),

    // 第二步：前端直傳私有 S3 完成後呼叫。重新用 HeadObject／Range GET 驗證
    // 實際檔案大小、型別、magic bytes，不信任前端宣稱的值；驗證失敗會刪掉剛
    // 上傳的物件，不建立 metadata。驗證通過後把物件從 tmp 前綴搬到正式附件
    // 的永久 key，再交給 db.createNewsAttachment（在 transaction 裡原子性地
    // 檢查 5 份上限、算出到期時間）。
    finalizePdfUpload: adminProcedure.input(z.object({
      newsId: z.number(),
      storageKey: z.string().regex(/^news-attachments\/tmp\/[A-Za-z0-9_-]{6,64}\.pdf$/, "無效的暫存檔案路徑"),
      displayName: z.string().min(1).max(200),
      originalFileName: z.string().min(1).max(200),
      expirationType: z.enum(["after_publish_30d", "custom", "never"]).default("after_publish_30d"),
      customDownloadExpiresAt: z.string().datetime().optional(),
    })).mutation(async ({ ctx, input }) => {
      if (!isPrivateStorageConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "私有附件儲存尚未設定" });
      }
      const item = await db.getNewsById(input.newsId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則消息" });
      if (input.expirationType === "custom" && !input.customDownloadExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "自訂到期時間為必填" });
      }

      const cleanupTmpAndThrow = async (message: string): Promise<never> => {
        await privateStorageDeleteObject(input.storageKey).catch(err =>
          console.warn(`[news] failed to delete invalid tmp attachment ${input.storageKey}:`, err instanceof Error ? err.message : err));
        throw new TRPCError({ code: "BAD_REQUEST", message });
      };

      const meta = await privateStorageHeadObject(input.storageKey);
      if (!meta.exists) return cleanupTmpAndThrow("找不到已上傳的檔案，請重新上傳");
      if (meta.sizeBytes <= 0 || meta.sizeBytes > 25 * 1024 * 1024) return cleanupTmpAndThrow("檔案大小不符合限制（上限 25MB）");
      if (meta.contentType && !meta.contentType.includes("pdf") && meta.contentType !== "application/octet-stream") {
        return cleanupTmpAndThrow("檔案類型不正確，請上傳 PDF");
      }

      const head = await privateStorageReadHeadBytes(input.storageKey, 5);
      const isPdfMagic = head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
      if (!isPdfMagic) return cleanupTmpAndThrow("檔案內容不是有效的 PDF");

      const permanentKey = `news-attachments/${input.newsId}/${nanoid()}.pdf`;
      await privateStorageCopyObject(input.storageKey, permanentKey);
      await privateStorageDeleteObject(input.storageKey).catch(err =>
        console.warn(`[news] failed to delete tmp attachment after copy ${input.storageKey}:`, err instanceof Error ? err.message : err));

      let attachmentId: number;
      try {
        attachmentId = await db.createNewsAttachment({
          newsId: input.newsId,
          displayName: input.displayName,
          originalFileName: input.originalFileName,
          storageKey: permanentKey,
          mimeType: "application/pdf",
          sizeBytes: meta.sizeBytes,
          uploadedBy: ctx.user!.id,
          expirationType: input.expirationType,
          customDownloadExpiresAt: input.customDownloadExpiresAt ? new Date(input.customDownloadExpiresAt) : null,
        });
      } catch (err) {
        await privateStorageDeleteObject(permanentKey).catch(delErr =>
          console.warn(`[news] failed to delete orphaned permanent attachment ${permanentKey}:`, delErr instanceof Error ? delErr.message : delErr));
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "建立附件失敗" });
      }
      return { success: true, id: attachmentId };
    }),

    updateAttachmentExpiration: adminProcedure.input(z.object({
      id: z.number(),
      expirationType: z.enum(["after_publish_30d", "custom", "never"]),
      customDownloadExpiresAt: z.string().datetime().optional(),
    })).mutation(async ({ input }) => {
      try {
        await db.updateNewsAttachmentExpiration(input.id, {
          expirationType: input.expirationType,
          downloadExpiresAt: input.customDownloadExpiresAt ? new Date(input.customDownloadExpiresAt) : null,
        });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "更新到期規則失敗" });
      }
      return { success: true };
    }),

    renameAttachment: adminProcedure.input(z.object({
      id: z.number(),
      displayName: z.string().min(1).max(200),
    })).mutation(async ({ input }) => {
      await db.renameNewsAttachment(input.id, input.displayName);
      return { success: true };
    }),

    deleteAttachment: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const deleted = await db.deleteNewsAttachment(input.id);
      if (deleted?.storageKey) {
        await privateStorageDeleteObject(deleted.storageKey).catch(err =>
          console.warn(`[news] failed to delete attachment storage key=${deleted.storageKey}:`, err instanceof Error ? err.message : err));
      }
      return { success: true };
    }),

    // 會員下載連結：每次呼叫都重新驗證登入／狀態／過期／實體檔案是否存在，
    // 不信任前端傳入的任何時間。一般會員只能下載已發布消息的附件；管理員
    // 可以下載草稿附件，也可以預覽「已過期但實體檔案尚未被排程清除」的附件
    // （因為檔案客觀上還存在，屬於資訊安全的產品決策，已於完成報告中說明）——
    // 但即使是管理員，只要 storageDeletedAt 已經有值，一律不允許再取得下載連結。
    getPdfDownloadUrl: protectedProcedure.input(z.object({ attachmentId: z.number() })).mutation(async ({ ctx, input }) => {
      const attachment = await db.getNewsAttachmentById(input.attachmentId);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此附件" });
      const newsItem = await db.getNewsById(attachment.newsId);
      if (!newsItem) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此附件" });

      const isAdmin = ctx.user.role === "admin";
      if (newsItem.status !== "published" && !isAdmin) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此附件" });
      }
      if (attachment.storageDeletedAt != null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已超過下載期限，如有需要請聯繫管理員。" });
      }

      const { isExpired } = db.computeNewsAttachmentStatus(attachment);
      if (isExpired && !isAdmin) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已超過下載期限，如有需要請聯繫管理員。" });
      }

      if (!isPrivateStorageConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "私有附件儲存尚未設定" });
      }
      const meta = await privateStorageHeadObject(attachment.storageKey);
      if (!meta.exists) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已超過下載期限，如有需要請聯繫管理員。" });
      }

      let ttlSeconds = 300;
      if (!isExpired && attachment.expirationType !== "never" && attachment.downloadExpiresAt) {
        const secondsUntilExpiry = Math.floor((attachment.downloadExpiresAt.getTime() - Date.now()) / 1000);
        ttlSeconds = Math.min(300, secondsUntilExpiry);
      }
      if (ttlSeconds <= 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已超過下載期限，如有需要請聯繫管理員。" });
      }

      const url = await privateStorageCreateDownloadUrl(attachment.storageKey, attachment.displayName, ttlSeconds);
      return { url, expiresInSeconds: ttlSeconds };
    }),
  }),

  // ===== 登入彈窗（綁定既有「平台消息／版本更新」公告的登入曝光入口）=====
  loginPopup: router({
    // 管理員：列表（含綁定公告是否仍然有效）
    adminList: adminProcedure.query(async () => {
      return db.getLoginPopupsForAdmin();
    }),
    // 管理員：綁定公告選擇器的候選清單——只回傳已發布的「平台消息」與
    // 「版本更新」，不含「停機維護」，不讓前端自己組 announcementId，也不
    // 暴露草稿/其他類型公告。
    announcementOptions: adminProcedure.input(z.object({
      keyword: z.string().max(200).optional(),
    })).query(async ({ input }) => {
      return db.getBindableAnnouncementsForLoginPopupPicker(input.keyword);
    }),
    create: adminProcedure.input(z.object({
      title: z.string().min(1).max(200),
      summary: z.string().min(1).max(500),
      announcementId: z.number().int().positive(),
      isActive: z.boolean().default(false),
    })).mutation(async ({ input }) => {
      try {
        const { id, deactivatedIds } = await db.createLoginPopup(input);
        return { success: true, id, deactivatedCount: deactivatedIds.length };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "建立失敗" });
      }
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      title: z.string().min(1).max(200).optional(),
      summary: z.string().min(1).max(500).optional(),
      announcementId: z.number().int().positive().optional(),
      isActive: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      try {
        const { deactivatedIds } = await db.updateLoginPopup(id, data);
        return { success: true, deactivatedCount: deactivatedIds.length };
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "更新失敗" });
      }
    }),
    // 首頁登入彈窗通知：未登入訪客與已登入會員都可以呼叫，依 ctx.user 是否存在
    // 分流——會員檢查今天是否已完成顯示（查 loginPopupViews），訪客一律直接
    // 回傳目前有效啟用的消息，不查詢也不建立任何觀看紀錄（不用 cookie／
    // localStorage／IP／裝置識別等替代身分）。userId 一律取自 ctx.user.id
    // （session），不相信前端傳入的任何使用者識別資訊。
    toShow: publicProcedure.query(async ({ ctx }) => {
      const items = ctx.user
        ? await db.getLoginPopupsToShowForUser(ctx.user.id)
        : await db.getLoginPopupsToShowForGuest();
      return { items };
    }),
    // 使用者點擊「我知道了」或「點擊進入完整公告」後呼叫，標記今天已完成顯示。
    // 只有已登入會員的前端才會呼叫這個 mutation；維持 protectedProcedure，
    // 未登入呼叫一律 UNAUTHORIZED，不接受前端傳入 userId。
    // idempotent：重複呼叫、網路重試都不會出錯或造成重複紀錄。
    markViewed: protectedProcedure.input(z.object({
      id: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      await db.markLoginPopupViewed(ctx.user.id, input.id);
      return { success: true };
    }),
  }),

  // ===== 一鍵詢價 =====
  inquiryBatch: router({
    createAndSend: protectedProcedure.input(z.object({
      title: z.string().min(1).max(50),
      message: z.string().min(1).max(2000),
      factoryIds: z.array(z.number().int().positive()).min(1).max(20),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const uniqueIds = Array.from(new Set(input.factoryIds));

      // 驗證每間工廠
      const factoryList = await Promise.all(uniqueIds.map(id => db.getFactoryById(id)));
      for (let i = 0; i < uniqueIds.length; i++) {
        const f = factoryList[i];
        if (!f) throw new TRPCError({ code: "BAD_REQUEST", message: `工廠 #${uniqueIds[i]} 不存在` });
        if (f.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: `工廠「${f.name}」尚未上架` });
        if (f.ownerId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: `不可對自己的工廠送一鍵詢價` });
      }

      // 建立批次，逐一建立 conversation 並送訊息
      const batchId = await db.createInquiryBatch(ctx.user.id, input.title, input.message);
      let successCount = 0;

      for (let i = 0; i < uniqueIds.length; i++) {
        const factoryId = uniqueIds[i];
        const factory = factoryList[i]!;
        try {
          // conversation 建立/取得、message 儲存、批次項目紀錄三步驟包在
          // 同一個 DB transaction 內（見 db.createConversationSendMessageAndBatchItem），
          // 任一步失敗即整體 rollback，不會留下零訊息的 conversation。
          const { conversation: conv } = await db.createConversationSendMessageAndBatchItem(
            ctx.user.id, factoryId, input.message, batchId,
          );
          successCount++;

          // 手機推播：通知工廠端
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagerUserIdsWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const pushIds: number[] = [];
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (owner && ownerSettings.pushNewMessage !== false) pushIds.push(factory.ownerId);
            for (const { userId, notificationSettings } of coMgrs) {
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.pushNewMessage !== false) pushIds.push(userId);
            }
            return sendPushToRecipients({
              userIds: pushIds,
              excludeUserId: ctx.user.id,
              title: "OXM 有新的詢價需求",
              body: "你收到一筆新的合作詢價",
              data: {
                type: "inquiry_batch",
                conversationId: String(conv.id),
                inquiryBatchId: String(batchId),
                targetPath: "/dashboard?tab=messages",
              },
            });
          }).catch((e) => { console.warn(`[Push] inquiryBatch factory #${factoryId} push error`, e); });

          // 通知工廠端：factory.contactEmail 受 owner 的 newMessage 設定控制，co-manager 各自判斷
          Promise.all([
            db.getUserById(factory.ownerId),
            db.getFactoryCoManagersWithPreferences(factory.id),
          ]).then(([owner, coMgrs]) => {
            const recipients = new Set<string>();
            const ownerSettings = (owner?.notificationSettings as Record<string, boolean> | null) ?? {};
            if (factory.contactEmail && ownerSettings.newMessage !== false) {
              recipients.add(factory.contactEmail);
            }
            for (const { email, notificationSettings } of coMgrs) {
              if (email === ctx.user.email) continue;
              const s = (notificationSettings as Record<string, boolean> | null) ?? {};
              if (s.newMessage !== false) recipients.add(email);
            }
            recipients.forEach((email) => {
              sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? "匿名",
                message: input.message,
                inquiryType: "batch",
              }).catch(() => {});
            });
          }).catch((e) => {
            console.warn(`[inquiryBatch.createAndSend] factory #${factory.id} 通知設定查詢失敗，fallback 寄送所有收件人`, e);
            const fallback = new Set<string>();
            if (factory.contactEmail) fallback.add(factory.contactEmail);
            db.getFactoryCoManagerEmails(factory.id).then((emails) => {
              emails.forEach(e => { if (e && e !== ctx.user.email) fallback.add(e); });
              fallback.forEach(email => sendNewInquiryEmail({
                factoryName: factory.name,
                factoryEmail: email,
                userName: ctx.user.name ?? "匿名",
                message: input.message,
                inquiryType: "batch",
              }).catch(() => {}));
            }).catch(() => {});
          });
        } catch (err) {
          console.error(`[inquiryBatch.createAndSend] factory #${factoryId} failed:`, err);
        }
      }

      return { batchId, successCount };
    }),

    listMine: protectedProcedure.query(async ({ ctx }) => {
      return db.getInquiryBatchesByUser(ctx.user.id);
    }),

    getDetail: protectedProcedure.input(z.object({
      batchId: z.number().int().positive(),
    })).query(async ({ ctx, input }) => {
      const detail = await db.getInquiryBatchDetail(input.batchId, ctx.user.id);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "批次不存在或無權限" });
      return detail;
    }),

    updateTitle: protectedProcedure.input(z.object({
      batchId: z.number().int().positive(),
      title: z.string().min(1).max(50),
    })).mutation(async ({ ctx, input }) => {
      await db.updateInquiryBatchTitle(input.batchId, ctx.user.id, input.title);
      return { success: true };
    }),
  }),

  // ===== 檢舉 =====
  report: router({
    create: protectedProcedure.input(z.object({
      factoryId: z.number(),
      reason: z.string().min(1).max(1000),
    })).mutation(async ({ ctx, input }) => {
      requireVerifiedEmail(ctx.user);
      const db_ = await getDb();
      if (!db_) throw new Error("DB not available");
      await db_.insert(reports).values({ factoryId: input.factoryId, userId: ctx.user.id, reason: input.reason });
      const reportedFactory = await db.getFactoryById(input.factoryId);
      sendReportEmail({
        reporterName: ctx.user.name ?? '未知用戶',
        factoryName: reportedFactory?.name ?? `工廠 #${input.factoryId}`,
        factoryId: input.factoryId,
        reason: input.reason,
      }).catch((err) => {
        console.error("[Email] admin notification failed:", err);
      });
      return { success: true };
    }),
    myReports: protectedProcedure.query(async ({ ctx }) => {
      return db.getReportsByUser(ctx.user.id);
    }),
    myReportHistory: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const userReports = await db.getReportsByUser(ctx.user.id);
      if (!userReports.find(r => r.id === input.id)) throw new Error("無權限");
      return db.getReportHistory(input.id);
    }),
  }),

  // ===== Push Notification Tokens =====
  notification: router({
    registerPushToken: protectedProcedure.input(z.object({
      token: z.string().min(1).max(512),
      platform: z.enum(["android", "ios", "unknown"]),
      deviceId: z.string().max(100).optional(),
      appVersion: z.string().max(50).optional(),
    })).mutation(async ({ ctx, input }) => {
      await db.upsertPushNotificationToken(ctx.user.id, input);
      return { success: true };
    }),

    unregisterPushToken: protectedProcedure.input(z.object({
      token: z.string().min(1).max(512),
    })).mutation(async ({ ctx, input }) => {
      await db.disablePushNotificationToken(ctx.user.id, input.token);
      return { success: true };
    }),

    // 開發用：回傳 token 遮罩清單（不完整輸出 token）
    getMyPushTokens: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getEnabledPushTokensByUserId(ctx.user.id);
      return rows.map(r => ({
        id: r.id,
        platform: r.platform,
        deviceId: r.deviceId,
        appVersion: r.appVersion,
        enabled: r.enabled,
        lastSeenAt: r.lastSeenAt,
        createdAt: r.createdAt,
        // token 僅回傳前 8 碼 + 後 6 碼，避免完整暴露
        tokenPreview: r.token.length > 14
          ? `${r.token.substring(0, 8)}...${r.token.substring(r.token.length - 6)}`
          : r.token.substring(0, 4) + '****',
      }));
    }),

    // App badge count — 彙整所有紅點來源，沿用 Navbar 相同邏輯
    getAppBadgeCount: protectedProcedure
      .input(z.object({ reviewSince: z.number().int().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // 使用者未讀：chat 訊息 + 管理員站內信
        const [regularCount, adminMsgCount] = await Promise.all([
          db.getUnreadCount(userId),
          db.getUnreadAdminMessageCount(userId),
        ]);
        const userUnread = regularCount + adminMsgCount;

        // 工廠方未讀：客戶詢問 + 新評價（工廠業主才有）
        let factoryUnread = 0;
        let reviewUnread = 0;
        const factory = await db.getFactoryByOwnerId(userId);
        if (factory) {
          factoryUnread = await db.getUnreadCountForFactory(factory.id);
          const since = (input?.reviewSince ?? 0) > 0 ? new Date(input!.reviewSince!) : undefined;
          const { count } = await db.countNewReviewsSince(factory.id, since);
          reviewUnread = count;
        }

        // 管理員：待審工廠數 + 管理員通知
        let pendingAdminCount = 0;
        if (ctx.user.role === 'admin') {
          const db_ = await getDb();
          if (db_) {
            const [result] = await db_
              .select({ count: sql<number>`COUNT(*)` })
              .from(factories)
              .where(eq(factories.status, 'pending'));
            pendingAdminCount = Number(result?.count ?? 0);
          }
          const { hasMessageReplies, hasSupportPending } = await db.getAdminPendingNotifications();
          if (hasMessageReplies) pendingAdminCount += 1;
          if (hasSupportPending) pendingAdminCount += 1;
        }

        const total = Math.max(0, userUnread + factoryUnread + reviewUnread + pendingAdminCount);
        return {
          total,
          breakdown: { userUnread, factoryUnread, reviewUnread, pendingAdminCount },
        };
      }),
  }),

  // ===== 商案討論區 =====
  community: router({
    // Space list with post counts (13 spaces)
    getSpaces: publicProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const slugToName: Record<string, string> = {};
      for (const [name, slug] of Object.entries(INDUSTRY_SLUGS)) {
        slugToName[slug] = name;
      }
      const allSpaceCodes = [COMMUNITY_CROSS_INDUSTRY_SLUG, ...Object.values(INDUSTRY_SLUGS)];
      const stats = await db.getCommunitySpaceStats(allSpaceCodes);
      return allSpaceCodes.map((code) => ({
        code,
        name: code === COMMUNITY_CROSS_INDUSTRY_SLUG ? "跨產業交流區" : (slugToName[code] ?? code),
        postCount: stats[code] ?? 0,
      }));
    }),

    // Paginated posts for a space
    listPosts: publicProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        return db.listCommunityPosts(input.spaceCode, input.page, input.pageSize);
      }),

    // Single post with comments
    getPost: publicProcedure
      .input(z.object({ postId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        // Non-admins cannot see hidden or deleted posts
        if (ctx.user?.role !== "admin") {
          if (post.isHidden || post.deletedAt) {
            throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
          }
        }
        const comments = await db.getCommunityCommentsByPost(input.postId);
        const pinnedProductIds = (post.pinnedProductIds ?? []) as number[];
        const pinnedProducts = await db.getProductsByIds(pinnedProductIds);
        const mentionRows = await db.getMentionsBySource("post", input.postId);
        const postMentions = mentionRows.map(m => ({
          type: m.mentionedUserId != null ? ("user" as const) : ("factory" as const),
          id: (m.mentionedUserId ?? m.mentionedFactoryId)!,
        }));
        return { post, comments, pinnedProducts, postMentions };
      }),

    // Author identity options (user + any owned/co-managed approved factories)
    getMyIdentityOptions: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const factories = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
      return { identities: factories };
    }),

    // Returns the personalised default spaceCode for the /community entry redirect.
    // Uses the user's first approved factory's first valid industry (owner > co-manager, stable by id ASC).
    // Falls back to cross-industry if no qualifying factory or industry is found.
    getDefaultSpace: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      const spaceCode = await db.getUserDefaultCommunitySpace(ctx.user.id);
      return { spaceCode };
    }),

    // Upload post image (max 8 MB, max 6 per post enforced on frontend)
    uploadPostImage: protectedProcedure
      .input(z.object({
        base64: z.string().max(12 * 1024 * 1024),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const base64Data = input.base64.includes(",") ? input.base64.split(",")[1] : input.base64;
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.byteLength > 8 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "圖片不得超過 8MB" });
        }
        const validation = await validateImageUpload(buffer);
        if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.error ?? "圖片格式不正確" });
        const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
        const key = `community-posts/${ctx.user.id}/${nanoid()}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),

    // Create a post
    createPost: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        title: z.string().min(1).max(200).trim(),
        content: z.string().min(1).max(10000).trim(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
        commentsEnabled: z.boolean().default(true),
        authorFactoryId: z.number().int().positive().optional(),
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(10).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        assertCommunityImagesOwned(input.images, ctx.user.id);

        // Enforce author identity rules: resolve which factoryId to actually use
        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;

        let resolvedFactoryId: number | null = null;

        if (factoryOptions.length === 0) {
          // No qualified factories → must post as personal
          if (input.authorFactoryId != null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "您目前沒有符合資格的工廠，只能以個人身分發文" });
          }
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          // Exactly 1 qualified factory → auto-assign, input is ignored but validated if provided
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          // Multiple qualified factories → must specify one; no personal option
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        // Validate pinnedProductIds: personal post cannot have products; products must belong to resolvedFactoryId
        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          if (resolvedFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "個人貼文不能附加工廠商品" });
          }
          const factoryProducts = await db.getProductsByFactoryId(resolvedFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const postId = await db.createCommunityPost({
          spaceCode: input.spaceCode,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          title: input.title,
          content: input.content,
          images: input.images,
          pinnedProductIds: dedupedProductIds,
          commentsEnabled: input.commentsEnabled,
        });

        // Fan-out: follow notifications + mention notifications (best-effort)
        try {
          // 1. Save mention relations
          const dedupedMentions = Array.from(
            new Map(input.mentions.map(m => [`${m.type}:${m.id}`, m])).values(),
          );
          if (dedupedMentions.length > 0) {
            await db.createMentions(
              "post", postId,
              dedupedMentions.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );
          }

          // 2. Board+factory follower notifications
          const followNotifInputs = await db.buildNewPostNotifications({
            postId,
            spaceCode: input.spaceCode,
            spaceName: getSpaceName(input.spaceCode),
            authorUserId: ctx.user.id,
            authorFactoryId: resolvedFactoryId,
            titleSnapshot: input.title,
            actorNameSnapshot: ctx.user.name ?? "",
            actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          });
          await db.createCommunityNotificationsBatch(followNotifInputs);

          // 3. Mention notifications
          if (dedupedMentions.length > 0) {
            const actorName = resolvedFactory?.label ?? ctx.user.name ?? "";
            type CommunityEventType = "community_mention";
            const mentionNotifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];

            // Collect all candidate recipient IDs from user + factory mentions
            const candidateMap = new Map<number, CommunityEventType>();
            for (const m of dedupedMentions) {
              if (m.type === "user") {
                if (m.id !== ctx.user.id) candidateMap.set(m.id, "community_mention");
              } else {
                const factory = await db.getFactoryById(m.id);
                if (!factory || factory.status !== "approved") continue;
                const ownerIds = factory.ownerId != null ? [factory.ownerId] : [];
                const coManagerIds = await db.getActiveCoManagerUserIds(m.id);
                for (const uid of [...ownerIds, ...coManagerIds]) {
                  if (uid !== ctx.user.id) candidateMap.set(uid, "community_mention");
                }
              }
            }

            const eligibleIds = await db.filterCommunityEligibleRecipientIds(
              Array.from(candidateMap.keys()), ctx.user.id,
            );
            for (const recipientUserId of eligibleIds) {
              mentionNotifInputs.push({
                recipientUserId,
                actorUserId: ctx.user.id,
                actorFactoryId: resolvedFactoryId ?? null,
                eventType: "community_mention",
                eventGroup: "mention",
                postId,
                spaceCode: input.spaceCode,
                titleSnapshot: input.title,
                actorNameSnapshot: ctx.user.name ?? "",
                actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
                message: `${actorName} 在貼文中提及了您`,
                dedupeKey: `mention:post:${postId}:r:${recipientUserId}`,
              });
            }
            await db.createCommunityNotificationsBatch(mentionNotifInputs);
          }
        } catch (err) {
          console.error("[community.createPost] notification fan-out error", err);
        }

        return { postId };
      }),

    // Edit a post (author only; cannot change spaceCode, authorUserId, authorFactoryId)
    updatePost: protectedProcedure
      .input(z.object({
        postId: z.number().int(),
        title: z.string().min(1).max(200).trim().optional(),
        content: z.string().min(1).max(10000).trim().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
        commentsEnabled: z.boolean().optional(),
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(10).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        if (post.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此貼文" });
        }
        if (post.isLocked && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "此貼文已鎖定，無法編輯" });
        }
        if (input.images !== undefined) {
          assertCommunityImagesOwned(input.images, ctx.user.id);
        }

        // Validate pinnedProductIds if being updated
        if (input.pinnedProductIds !== undefined) {
          const dedupedIds = Array.from(new Set(input.pinnedProductIds));
          if (dedupedIds.length > 0) {
            if (post.authorFactoryId == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "個人貼文不能附加工廠商品" });
            }
            const factoryProducts = await db.getProductsByFactoryId(post.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            const invalid = dedupedIds.find(id => !validIds.has(id));
            if (invalid != null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
            }
            input = { ...input, pinnedProductIds: dedupedIds };
          }
        }

        const { postId, mentions, ...updates } = input;
        if (Object.keys(updates).length > 0) {
          await db.updateCommunityPost(postId, updates);
        }

        // Sync mentions and notify only newly-added ones (best-effort)
        if (mentions !== undefined) {
          try {
            const dedupedNew = Array.from(
              new Map(mentions.map(m => [`${m.type}:${m.id}`, m])).values(),
            );
            const addedMentions = await db.syncMentionsBySource(
              "post", postId,
              dedupedNew.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );

            if (addedMentions.length > 0) {
              const actorName = post.authorFactoryNameSnapshot ?? ctx.user.name ?? "";
              const mentionNotifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];
              const candidateMap = new Map<number, true>();

              for (const m of addedMentions) {
                if (m.userId != null) {
                  if (m.userId !== ctx.user.id) candidateMap.set(m.userId, true);
                } else if (m.factoryId != null) {
                  const factory = await db.getFactoryById(m.factoryId);
                  if (!factory || factory.status !== "approved") continue;
                  const ownerIds = factory.ownerId != null ? [factory.ownerId] : [];
                  const coManagerIds = await db.getActiveCoManagerUserIds(m.factoryId);
                  for (const uid of [...ownerIds, ...coManagerIds]) {
                    if (uid !== ctx.user.id) candidateMap.set(uid, true);
                  }
                }
              }

              const eligibleIds = await db.filterCommunityEligibleRecipientIds(
                Array.from(candidateMap.keys()), ctx.user.id,
              );
              for (const recipientUserId of eligibleIds) {
                mentionNotifInputs.push({
                  recipientUserId,
                  actorUserId: ctx.user.id,
                  actorFactoryId: post.authorFactoryId ?? null,
                  eventType: "community_mention",
                  eventGroup: "mention",
                  postId,
                  spaceCode: post.spaceCode,
                  titleSnapshot: post.title,
                  actorNameSnapshot: ctx.user.name ?? "",
                  actorFactoryNameSnapshot: post.authorFactoryNameSnapshot ?? null,
                  message: `${actorName} 在貼文中提及了您`,
                  dedupeKey: `mention:post:${postId}:edit:r:${recipientUserId}`,
                });
              }
              await db.createCommunityNotificationsBatch(mentionNotifInputs);
            }
          } catch (err) {
            console.error("[community.updatePost] mention sync error", err);
          }
        }

        return { success: true };
      }),

    // Soft delete a post (author only)
    deletePost: protectedProcedure
      .input(z.object({ postId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        if (post.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此貼文" });
        }
        await db.softDeleteCommunityPost(input.postId);
        return { success: true };
      }),

    // Create a comment or a reply
    createComment: protectedProcedure
      .input(z.object({
        postId: z.number().int(),
        content: z.string().min(1).max(5000).trim(),
        parentCommentId: z.number().int().positive().optional(),
        replyToUserId: z.number().int().positive().optional(),
        // Front-end passes the auto-resolved or user-selected factoryId
        authorFactoryId: z.number().int().positive().optional(),
        // Mentions extracted from content (max 5)
        mentions: z.array(z.object({
          type: z.enum(["user", "factory"]),
          id: z.number().int().positive(),
        })).max(5).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const post = await db.getCommunityPostById(input.postId);
        if (!post || post.deletedAt || post.isHidden) {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此貼文" });
        }
        if (post.isLocked && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "此貼文已鎖定，無法留言" });
        }
        if (!post.commentsEnabled && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "作者已關閉此貼文的留言功能" });
        }

        // Enforce 2-layer depth limit
        if (input.parentCommentId != null) {
          const parent = await db.getCommunityCommentById(input.parentCommentId);
          if (!parent || parent.postId !== input.postId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "無效的父留言" });
          }
          if (parent.parentCommentId != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "只允許兩層留言結構，不可回覆第二層留言" });
          }
        }

        // Enforce author identity rules (same as createPost)
        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;

        let resolvedFactoryId: number | null = null;
        if (factoryOptions.length === 0) {
          if (input.authorFactoryId != null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "您目前沒有符合資格的工廠" });
          }
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const commentId = await db.createCommunityComment({
          postId: input.postId,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          content: input.content,
          parentCommentId: input.parentCommentId ?? null,
          replyToUserId: input.replyToUserId ?? null,
        });

        // Post-comment side-effects (best-effort, never fail comment creation)
        try {
          // 1. Save mentions
          if (input.mentions.length > 0) {
            await db.createMentions(
              "comment",
              commentId,
              input.mentions.map(m => m.type === "user" ? { userId: m.id } : { factoryId: m.id }),
            );
          }

          // 2. Auto-follow the post content for the commenter
          await db.followContent(ctx.user.id, "discussion", input.postId);

          // 3. Build reply + mention notifications
          const actorName = resolvedFactory?.label ?? ctx.user.name ?? "";
          const mentionedUserIds = new Set(
            input.mentions.filter(m => m.type === "user").map(m => m.id),
          );

          type CommunityEventType = "community_post_reply" | "community_comment_reply" | "community_mention" | "community_reply_and_mention";
          // Notification recipients map: userId → eventType
          const notifMap = new Map<number, CommunityEventType>();

          // Reply notification: post author (if not the commenter themselves)
          if (post.authorUserId != null && post.authorUserId !== ctx.user.id) {
            const isMentioned = mentionedUserIds.has(post.authorUserId);
            notifMap.set(
              post.authorUserId,
              isMentioned ? "community_reply_and_mention" : "community_post_reply",
            );
          }

          // Reply notification: parent comment author (if this is a nested reply)
          if (input.parentCommentId != null) {
            const parentComment = await db.getCommunityCommentById(input.parentCommentId);
            if (parentComment?.authorUserId != null && parentComment.authorUserId !== ctx.user.id) {
              const isMentioned = mentionedUserIds.has(parentComment.authorUserId);
              const current = notifMap.get(parentComment.authorUserId);
              if (!current || current === "community_post_reply") {
                notifMap.set(
                  parentComment.authorUserId,
                  isMentioned ? "community_reply_and_mention" : "community_comment_reply",
                );
              }
            }
          }

          // Mention-only notifications for directly mentioned users not already covered
          for (const mentionedUserId of Array.from(mentionedUserIds)) {
            if (mentionedUserId === ctx.user.id) continue;
            if (!notifMap.has(mentionedUserId)) {
              notifMap.set(mentionedUserId, "community_mention");
            }
          }

          // Factory mentions → notify factory owner + active co-managers (deduplicated)
          const mentionedFactoryIds = new Set(
            input.mentions.filter(m => m.type === "factory").map(m => m.id),
          );
          for (const factoryId of Array.from(mentionedFactoryIds)) {
            // Get factory owner
            const factory = await db.getFactoryById(factoryId);
            const factoryOwnerIds = factory?.ownerId != null ? [factory.ownerId] : [];
            // Get active co-managers
            const coManagerIds = await db.getActiveCoManagerUserIds(factoryId);
            const candidateIds = Array.from(new Set([...factoryOwnerIds, ...coManagerIds]));
            for (const candidateId of candidateIds) {
              if (candidateId === ctx.user.id) continue; // don't notify self
              if (!notifMap.has(candidateId)) {
                notifMap.set(candidateId, "community_mention");
              } else {
                // Upgrade reply to reply_and_mention
                const current = notifMap.get(candidateId);
                if (current === "community_post_reply" || current === "community_comment_reply") {
                  notifMap.set(candidateId, "community_reply_and_mention");
                }
              }
            }
          }

          // Filter all recipients through beta/live eligibility gate
          const eligibleRecipientIds = await db.filterCommunityEligibleRecipientIds(
            Array.from(notifMap.keys()), ctx.user.id,
          );
          const eligibleSet = new Set(eligibleRecipientIds);

          // Build notification inputs
          const notifInputs: Parameters<typeof db.createCommunityNotificationsBatch>[0] = [];
          for (const [recipientUserId, eventType] of Array.from(notifMap.entries())) {
            if (!eligibleSet.has(recipientUserId)) continue;
            const isReply = eventType === "community_post_reply" || eventType === "community_comment_reply" || eventType === "community_reply_and_mention";
            const isMention = eventType === "community_mention" || eventType === "community_reply_and_mention";
            let message: string;
            if (eventType === "community_reply_and_mention") {
              message = `${actorName} 在討論中回覆並提及了您`;
            } else if (eventType === "community_mention") {
              message = `${actorName} 在討論中提及了您`;
            } else if (eventType === "community_comment_reply") {
              message = `${actorName} 回覆了您的留言`;
            } else {
              message = `${actorName} 在您的討論中留言`;
            }
            const dedupeKey = (eventType === "community_reply_and_mention" || eventType === "community_mention")
              ? (isReply ? `rmention:c:${commentId}:r:${recipientUserId}` : `mention:comment:${commentId}:r:${recipientUserId}`)
              : `reply:c:${commentId}:r:${recipientUserId}`;
            notifInputs.push({
              recipientUserId,
              actorUserId: ctx.user.id,
              actorFactoryId: resolvedFactoryId ?? null,
              eventType,
              eventGroup: isMention ? "mention" : "reply",
              postId: input.postId,
              commentId,
              spaceCode: post.spaceCode,
              titleSnapshot: post.title,
              actorNameSnapshot: actorName,
              actorFactoryNameSnapshot: resolvedFactory?.label ?? null,
              message,
              dedupeKey,
            });
          }
          await db.createCommunityNotificationsBatch(notifInputs);
        } catch (err) {
          console.error("[community.createComment] post-comment side-effects error", err);
        }

        return { commentId };
      }),

    // Edit a comment (author only)
    updateComment: protectedProcedure
      .input(z.object({
        commentId: z.number().int(),
        content: z.string().min(1).max(5000).trim(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const comment = await db.getCommunityCommentById(input.commentId);
        if (!comment || comment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此留言" });
        if (comment.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此留言" });
        }
        await db.updateCommunityComment(input.commentId, input.content);
        return { success: true };
      }),

    // Soft delete a comment (author only)
    deleteComment: protectedProcedure
      .input(z.object({ commentId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const comment = await db.getCommunityCommentById(input.commentId);
        if (!comment || comment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此留言" });
        if (comment.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此留言" });
        }
        await db.softDeleteCommunityComment(input.commentId);
        return { success: true };
      }),

    // ===== Phase 2A: Board follows =====

    boardFollowStatus: protectedProcedure
      .input(z.object({ spaceCode: z.string().min(1).max(60) }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        const row = await db.getBoardFollowStatus(ctx.user.id, input.spaceCode);
        return { following: !!row, notifyNewDiscussions: row?.notifyNewDiscussions ?? true };
      }),

    followBoard: protectedProcedure
      .input(z.object({ spaceCode: z.string(), notifyNewDiscussions: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        await db.followBoard(ctx.user.id, input.spaceCode, input.notifyNewDiscussions);
        return { success: true };
      }),

    unfollowBoard: protectedProcedure
      .input(z.object({ spaceCode: z.string() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowBoard(ctx.user.id, input.spaceCode);
        return { success: true };
      }),

    // ===== Phase 2A: Factory follows =====

    factoryFollowStatus: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const row = await db.getFactoryFollowStatus(ctx.user.id, input.factoryId);
        return { following: !!row, notifyNewDiscussions: row?.notifyNewDiscussions ?? true };
      }),

    followFactory: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive(), notifyNewDiscussions: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const factory = await db.getFactoryById(input.factoryId);
        if (!factory || factory.status !== "approved") {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此工廠" });
        }
        await db.followFactory(ctx.user.id, input.factoryId, input.notifyNewDiscussions);
        return { success: true };
      }),

    unfollowFactory: protectedProcedure
      .input(z.object({ factoryId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowFactory(ctx.user.id, input.factoryId);
        return { success: true };
      }),

    // ===== Phase 2A: Content follows =====

    contentFollowStatus: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const row = await db.getContentFollowStatus(ctx.user.id, input.contentType, input.contentId);
        return { following: !!row };
      }),

    followContent: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.followContent(ctx.user.id, input.contentType, input.contentId);
        return { success: true };
      }),

    unfollowContent: protectedProcedure
      .input(z.object({ contentType: z.enum(["discussion", "bid"]), contentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        await db.unfollowContent(ctx.user.id, input.contentType, input.contentId);
        return { success: true };
      }),

    // ===== Phase 2A: Reactions =====

    toggleReaction: protectedProcedure
      .input(z.object({
        targetType: z.enum(["post", "comment"]),
        targetId: z.number().int().positive(),
        reactionType: z.enum(["helpful"]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        if (input.targetType === "post") {
          const post = await db.getCommunityPostById(input.targetId);
          if (!post || post.deletedAt || post.isHidden) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
        } else {
          const comment = await db.getCommunityCommentById(input.targetId);
          if (!comment || comment.deletedAt || comment.isHidden) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
        }
        const result = await db.toggleReaction(ctx.user.id, input.targetType, input.targetId, input.reactionType);
        return result;
      }),

    reactionSummary: publicProcedure
      .input(z.object({
        targetType: z.enum(["post", "comment"]),
        targetId: z.number().int().positive(),
        reactionType: z.enum(["helpful"]),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.getReactionSummary(input.targetType, input.targetId, ctx.user?.id);
      }),

    // ===== Phase 2A: Mention search =====

    searchMentionTargets: protectedProcedure
      .input(z.object({
        query: z.string().min(1).max(50),
        postId: z.number().int().positive().optional(),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.searchMentionTargets(input.query, ctx.user.id, input.postId);
      }),

    // ===== Phase 2A: Notifications =====

    notificationUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      const visibleTypes = getVisibleTypesForUser(ctx.user.role);
      const count = await db.getCommunityNotificationUnreadCount(ctx.user.id, visibleTypes);
      return { count };
    }),

    notificationList: protectedProcedure
      .input(z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        const visibleTypes = getVisibleTypesForUser(ctx.user.role);
        return db.listCommunityNotifications(ctx.user.id, input.page, input.pageSize, visibleTypes);
      }),

    notificationMarkRead: protectedProcedure
      .input(z.object({ notificationId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const visibleTypes = getVisibleTypesForUser(ctx.user.role);
        await db.markCommunityNotificationRead(input.notificationId, ctx.user.id, visibleTypes);
        return { success: true };
      }),

    notificationMarkAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      const visibleTypes = getVisibleTypesForUser(ctx.user.role);
      await db.markAllCommunityNotificationsRead(ctx.user.id, visibleTypes);
      return { success: true };
    }),

    // ===== Phase 3A: Community Bids =====

    // 1 ≤ durationHours ≤ 168 (7 days)
    createBid: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        title: z.string().min(1).max(200).trim(),
        description: z.string().min(1).max(10000).trim(),
        quantity: z.string().max(200).trim().nullable().optional(),
        material: z.string().max(200).trim().nullable().optional(),
        specifications: z.string().max(5000).trim().nullable().optional(),
        sampleRequired: z.boolean().default(false),
        desiredDeliveryDate: z.string().max(100).trim().nullable().optional(),
        deliveryLocation: z.string().max(200).trim().nullable().optional(),
        budgetMin: z.number().int().positive().nullable().optional(),
        budgetMax: z.number().int().positive().nullable().optional(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
        durationHours: z.number().int().min(1).max(168),
        authorFactoryId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        assertCommunityImagesOwned(input.images, ctx.user.id);
        if (input.budgetMin != null && input.budgetMax != null && input.budgetMin > input.budgetMax) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "預算下限不可高於上限" });
        }

        const identityOptions = await db.getCommunityAuthorIdentityOptions(ctx.user.id);
        const factoryOptions = identityOptions.filter(o => o.type === "factory") as
          Array<{ type: "factory"; factoryId: number; label: string; role: string }>;
        let resolvedFactoryId: number | null = null;
        if (factoryOptions.length === 0) {
          resolvedFactoryId = null;
        } else if (factoryOptions.length === 1) {
          const only = factoryOptions[0].factoryId;
          if (input.authorFactoryId != null && input.authorFactoryId !== only) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的工廠身分" });
          }
          resolvedFactoryId = only;
        } else {
          if (input.authorFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇代表工廠" });
          }
          if (!factoryOptions.some(f => f.factoryId === input.authorFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠" });
          }
          resolvedFactoryId = input.authorFactoryId;
        }

        // Validate pinnedProductIds: personal bid cannot have products; must belong to resolved factory
        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          if (resolvedFactoryId == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "個人競標需求不能附加工廠商品" });
          }
          const factoryProducts = await db.getProductsByFactoryId(resolvedFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        const resolvedFactory = factoryOptions.find(f => f.factoryId === resolvedFactoryId);
        const bidId = await db.createCommunityBid({
          spaceCode: input.spaceCode,
          authorUserId: ctx.user.id,
          authorFactoryId: resolvedFactoryId,
          authorNameSnapshot: ctx.user.name ?? "",
          authorFactoryNameSnapshot: resolvedFactory?.label ?? null,
          authorRoleSnapshot: resolvedFactory?.role ?? null,
          title: input.title,
          description: input.description,
          quantity: input.quantity ?? null,
          material: input.material ?? null,
          specifications: input.specifications ?? null,
          sampleRequired: input.sampleRequired,
          desiredDeliveryDate: input.desiredDeliveryDate ?? null,
          deliveryLocation: input.deliveryLocation ?? null,
          budgetMin: input.budgetMin ?? null,
          budgetMax: input.budgetMax ?? null,
          images: input.images,
          pinnedProductIds: dedupedProductIds,
          durationHours: input.durationHours,
        });
        return { bidId };
      }),

    updateBid: protectedProcedure
      .input(z.object({
        bidId: z.number().int(),
        title: z.string().min(1).max(200).trim().optional(),
        description: z.string().min(1).max(10000).trim().optional(),
        quantity: z.string().max(200).trim().nullable().optional(),
        material: z.string().max(200).trim().nullable().optional(),
        specifications: z.string().max(5000).trim().nullable().optional(),
        sampleRequired: z.boolean().optional(),
        desiredDeliveryDate: z.string().max(100).trim().nullable().optional(),
        deliveryLocation: z.string().max(200).trim().nullable().optional(),
        budgetMin: z.number().int().positive().nullable().optional(),
        budgetMax: z.number().int().positive().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
        durationHours: z.number().int().min(1).max(168).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此需求" });
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以編輯" });
        }
        if (input.images !== undefined) {
          assertCommunityImagesOwned(input.images, ctx.user.id);
        }
        if (input.budgetMin != null && input.budgetMax != null && input.budgetMin > input.budgetMax) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "預算下限不可高於上限" });
        }
        // Validate pinnedProductIds update: must belong to bid's authorFactory
        let dedupedUpdatedProductIds: number[] | undefined;
        if (input.pinnedProductIds !== undefined) {
          dedupedUpdatedProductIds = Array.from(new Set(input.pinnedProductIds));
          if (dedupedUpdatedProductIds.length > 0) {
            if (bid.authorFactoryId == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "個人競標需求不能附加工廠商品" });
            }
            const factoryProducts = await db.getProductsByFactoryId(bid.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            const invalid = dedupedUpdatedProductIds.find(id => !validIds.has(id));
            if (invalid != null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
            }
          }
        }
        const { bidId, pinnedProductIds: _pp, ...updates } = input;
        await db.updateCommunityBid(bidId, { ...updates, ...(dedupedUpdatedProductIds !== undefined ? { pinnedProductIds: dedupedUpdatedProductIds } : {}) });
        return { success: true };
      }),

    submitBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        requireVerifiedEmail(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限提交此需求" });
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以提交審核" });
        }
        // Re-validate authorFactoryId still approved
        if (bid.authorFactoryId != null) {
          const factory = await db.getFactoryById(bid.authorFactoryId);
          if (!factory || factory.status !== "approved") {
            throw new TRPCError({ code: "FORBIDDEN", message: "代表工廠不符合條件，請重新建立需求" });
          }
        }
        // Re-validate pinnedProductIds: strip deleted/unavailable products; reject cross-factory ones
        const existingProductIds = (bid.pinnedProductIds ?? []) as number[];
        let removedProductCount = 0;
        if (existingProductIds.length > 0) {
          if (bid.authorFactoryId == null) {
            // Personal bid somehow has products — strip all (shouldn't happen, but guard)
            await db.updateCommunityBid(input.bidId, { pinnedProductIds: [] });
            removedProductCount = existingProductIds.length;
          } else {
            const factoryProducts = await db.getProductsByFactoryId(bid.authorFactoryId);
            const validIds = new Set(factoryProducts.map(p => p.id));
            // Any ID not in factory's product list is either deleted or cross-factory — strip it
            const survivingIds = existingProductIds.filter(id => validIds.has(id));
            removedProductCount = existingProductIds.length - survivingIds.length;
            if (removedProductCount > 0) {
              await db.updateCommunityBid(input.bidId, { pinnedProductIds: survivingIds });
            }
          }
        }
        await db.submitCommunityBidForReview(input.bidId, ctx.user.id, ctx.user.name ?? "");
        return { success: true, removedProductCount };
      }),

    withdrawBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此需求" });
        if (bid.status !== "pending_review") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有待審核中的需求可以撤回" });
        }
        await db.withdrawCommunityBid(input.bidId, ctx.user.id, ctx.user.name ?? "");
        return { success: true };
      }),

    deleteBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限刪除此需求" });
        }
        if (bid.status !== "draft" && bid.status !== "rejected") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有草稿或退回狀態的需求可以刪除" });
        }
        await db.softDeleteCommunityBid(input.bidId);
        return { success: true };
      }),

    cancelBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限取消此需求" });
        }
        if (bid.status !== "active") {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有進行中的需求可以取消" });
        }
        await db.cancelCommunityBid(input.bidId);
        return { success: true };
      }),

    listBids: protectedProcedure
      .input(z.object({
        spaceCode: z.string().min(1).max(60),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        assertValidSpaceCode(input.spaceCode);
        return db.listCommunityBids({ spaceCode: input.spaceCode, status: "active", page: input.page, pageSize: input.pageSize });
      }),

    getMyBids: protectedProcedure
      .input(z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        return db.listCommunityBids({ authorUserId: ctx.user.id, page: input.page, pageSize: input.pageSize });
      }),

    getBid: protectedProcedure
      .input(z.object({ bidId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const isOwner = bid.authorUserId === ctx.user.id;
        const isAdmin = ctx.user.role === "admin";
        // Only owner or admin can see non-active states
        if (!isOwner && !isAdmin && bid.status !== "active") {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        }
        const targetIndustries = await db.getCommunityBidIndustries(input.bidId);
        const reviewHistory = isAdmin ? await db.listCommunityBidReviewHistory(input.bidId) : [];
        const pinnedProductIdsArr = (bid.pinnedProductIds ?? []) as number[];
        const pinnedProducts = pinnedProductIdsArr.length > 0 ? await db.getProductsByIds(pinnedProductIdsArr) : [];
        return { bid, targetIndustries, reviewHistory, pinnedProducts };
      }),

    pendingBidCount: protectedProcedure.query(async ({ ctx }) => {
      checkCommunityRead(ctx.user);
      if (ctx.user.role !== "admin") return { count: 0 };
      const count = await db.countPendingCommunityBids();
      return { count };
    }),

    // ===== Phase 3B: 廠商投標報價 =====

    createBidOffer: protectedProcedure
      .input(z.object({
        bidId: z.number().int().positive(),
        bidderFactoryId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        currency: z.string().max(10).default("TWD"),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().default(false),
        proposal: z.string().min(1).max(5000).trim(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).default([]),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);
        requireVerifiedEmail(ctx.user);

        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        if (bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法投標" });
        }
        if (bid.authorUserId === ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "不可對自己的需求投標" });
        }

        const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
        if (myFactories.length === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "需以已審核工廠身分參與投標" });
        }
        const selectedFactory = myFactories.find(f => f.factoryId === input.bidderFactoryId);
        if (!selectedFactory) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無效的代表工廠，或工廠尚未審核通過" });
        }

        assertCommunityImagesOwned(input.images, ctx.user.id);

        const dedupedProductIds = Array.from(new Set(input.pinnedProductIds));
        if (dedupedProductIds.length > 0) {
          const factoryProducts = await db.getProductsByFactoryId(input.bidderFactoryId);
          const validIds = new Set(factoryProducts.map(p => p.id));
          const invalid = dedupedProductIds.find(id => !validIds.has(id));
          if (invalid != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${invalid} 不存在或不屬於此工廠` });
          }
        }

        let offerId: number;
        try {
          offerId = await db.createCommunityBidOffer({
            bidId: input.bidId,
            bidderUserId: ctx.user.id,
            bidderFactoryId: input.bidderFactoryId,
            bidderNameSnapshot: ctx.user.name ?? "",
            bidderFactoryNameSnapshot: selectedFactory.factoryName,
            bidderRoleSnapshot: selectedFactory.role,
            amount: input.amount ?? null,
            currency: input.currency,
            deliveryDays: input.deliveryDays ?? null,
            moq: input.moq ?? null,
            sampleAvailable: input.sampleAvailable,
            proposal: input.proposal,
            commercialTerms: input.commercialTerms ?? null,
            images: input.images,
            pinnedProductIds: dedupedProductIds,
          });
        } catch (e: any) {
          if (e?.code === "CONFLICT") {
            throw new TRPCError({ code: "CONFLICT", message: "此工廠已有投標紀錄" });
          }
          if (e?.code === "BID_UNAVAILABLE") {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          throw e;
        }

        // Notify bid author of new offer (station + push)
        if (bid.authorUserId) {
          await db.createCommunityNotificationsBatch([{
            recipientUserId: bid.authorUserId,
            actorUserId: ctx.user.id,
            actorFactoryId: input.bidderFactoryId,
            eventType: "bid_new_offer",
            eventGroup: `bid:${input.bidId}`,
            titleSnapshot: bid.title,
            actorNameSnapshot: ctx.user.name ?? "",
            actorFactoryNameSnapshot: selectedFactory.factoryName,
            message: `您的需求「${bid.title}」收到新投標`,
            dedupeKey: `bid:${input.bidId}:new-offer:factory:${input.bidderFactoryId}`,
          }]);
          sendPushToRecipients({
            userIds: [bid.authorUserId],
            excludeUserId: ctx.user.id,
            title: "OXM 需求收到新投標",
            body: `「${bid.title}」收到來自「${selectedFactory.factoryName}」的投標`,
            data: { type: "bid_new_offer", targetPath: "/notifications" },
          }).catch((err) => { console.error("[Push] bid_new_offer failed:", err instanceof Error ? err.message : String(err)); });
        }

        return { offerId };
      }),

    updateBidOffer: protectedProcedure
      .input(z.object({
        offerId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().optional(),
        proposal: z.string().min(1).max(5000).trim().optional(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const { offerId, ...fields } = input;
        const offerRow = await db.getCommunityBidOfferById(offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "只有進行中的投標可以編輯" });

        // bidderFactoryId=null means factory was deleted; no one can update such an offer
        if (offerRow.bidderFactoryId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "工廠已失效，無法更新此投標" });
        }

        // Access: original bidder OR active co-manager of bidder factory
        if (offerRow.bidderUserId !== ctx.user.id) {
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          if (!myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限編輯此投標" });
          }
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (!bid || bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標修改" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法修改投標" });
        }

        if (fields.images !== undefined) {
          assertCommunityImagesOwned(fields.images, ctx.user.id);
        }

        let removedProductCount = 0;
        {
          // Validate pinnedProductIds: soft-skip deleted, hard-reject cross-factory
          const rawIds = fields.pinnedProductIds !== undefined
            ? Array.from(new Set(fields.pinnedProductIds))
            : ((offerRow.pinnedProductIds as number[]) ?? []);
          const userChangedProducts = fields.pinnedProductIds !== undefined;
          if (rawIds.length > 0) {
            const foundProducts = await db.getProductsByIds(rawIds);
            const foundById = new Map(foundProducts.map(p => [p.id, p]));
            const validPinned: number[] = [];
            for (const id of rawIds) {
              const product = foundById.get(id);
              if (!product) {
                removedProductCount++;
              } else if (product.factoryId !== offerRow.bidderFactoryId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${id} 不屬於此工廠` });
              } else {
                validPinned.push(id);
              }
            }
            if (userChangedProducts || removedProductCount > 0) {
              fields.pinnedProductIds = validPinned;
            } else {
              delete fields.pinnedProductIds;
            }
          } else if (userChangedProducts) {
            fields.pinnedProductIds = [];
          }
        }

        try {
          await db.updateCommunityBidOfferSafe(offerId, fields, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true, removedProductCount };
      }),

    withdrawBidOffer: protectedProcedure
      .input(z.object({ offerId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const offerRow = await db.getCommunityBidOfferById(input.offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "只有進行中的投標可以撤回" });

        // Access: original bidder OR active co-manager of bidder factory
        // (null bidderFactoryId: factory deleted; only original bidder can withdraw)
        if (offerRow.bidderUserId !== ctx.user.id) {
          if (offerRow.bidderFactoryId == null) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此投標" });
          }
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          if (!myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "無權限撤回此投標" });
          }
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (bid && bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法撤回投標" });
        }

        try {
          await db.withdrawCommunityBidOffer(input.offerId, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true };
      }),

    resubmitBidOffer: protectedProcedure
      .input(z.object({
        offerId: z.number().int().positive(),
        amount: z.number().int().min(1).max(999999999999).nullable().optional(),
        deliveryDays: z.number().int().min(1).max(3650).nullable().optional(),
        moq: z.number().int().min(1).nullable().optional(),
        sampleAvailable: z.boolean().optional(),
        proposal: z.string().min(1).max(5000).trim().optional(),
        commercialTerms: z.string().max(5000).trim().nullable().optional(),
        images: z.array(z.string().url()).max(6).optional(),
        pinnedProductIds: z.array(z.number().int().positive()).max(5).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        checkCommunityWrite(ctx.user);

        const { offerId, ...fields } = input;
        const offerRow = await db.getCommunityBidOfferById(offerId);
        if (!offerRow || offerRow.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此投標" });
        if (offerRow.status !== "withdrawn") throw new TRPCError({ code: "BAD_REQUEST", message: "只有已撤回的投標可以重新投標" });

        // null bidderFactoryId = factory was deleted; cannot resubmit
        if (offerRow.bidderFactoryId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "工廠已失效，無法重新投標" });
        }

        // Access: original bidder OR active co-manager; also validates factory still approved
        const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
        const hasAccess = offerRow.bidderUserId === ctx.user.id
          ? myFactories.some(f => f.factoryId === offerRow.bidderFactoryId)  // original bidder: also re-validate factory
          : myFactories.some(f => f.factoryId === offerRow.bidderFactoryId); // co-manager check
        if (!hasAccess) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權限重新投標，或代表工廠已失效" });
        }

        const bid = await db.getCommunityBidById(offerRow.bidId);
        if (!bid || bid.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此需求目前不開放投標" });
        if (bid.deadline && new Date() > bid.deadline) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此需求已截止，無法重新投標" });
        }

        if (fields.images !== undefined) {
          assertCommunityImagesOwned(fields.images, ctx.user.id);
        }

        let removedProductCount = 0;
        if (fields.pinnedProductIds !== undefined) {
          const dedupedIds = Array.from(new Set(fields.pinnedProductIds));
          if (dedupedIds.length > 0) {
            const foundProducts = await db.getProductsByIds(dedupedIds);
            const foundById = new Map(foundProducts.map(p => [p.id, p]));
            const validPinned: number[] = [];
            for (const id of dedupedIds) {
              const product = foundById.get(id);
              if (!product) {
                removedProductCount++;
              } else if (product.factoryId !== offerRow.bidderFactoryId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `商品 ID ${id} 不屬於此工廠` });
              } else {
                validPinned.push(id);
              }
            }
            fields.pinnedProductIds = validPinned;
          } else {
            fields.pinnedProductIds = [];
          }
        }

        try {
          await db.resubmitCommunityBidOffer(offerId, fields, ctx.user.id, ctx.user.name ?? "");
        } catch (e: any) {
          if (e?.code === "CONFLICT") throw new TRPCError({ code: "CONFLICT", message: e.message });
          if (e?.code === "BID_UNAVAILABLE") throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          throw e;
        }
        return { success: true, removedProductCount };
      }),

    getMyBidOffer: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);

        // Try userId-based lookup first (original bidder)
        let offer = await db.getCommunityBidOfferByUser(input.bidId, ctx.user.id);

        // Fallback: factory-based lookup for co-managers
        if (!offer) {
          const myFactories = await db.getApprovedFactoriesForUser(ctx.user.id);
          for (const f of myFactories) {
            const factoryOffer = await db.getCommunityBidOfferByFactory(input.bidId, f.factoryId);
            if (factoryOffer) { offer = factoryOffer; break; }
          }
        }

        if (!offer) return { offer: null, pinnedProducts: [] };
        const pinnedProducts = await db.getProductsByIds((offer.pinnedProductIds as number[]) ?? []);
        return { offer, pinnedProducts };
      }),

    getBidOfferCount: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const count = await db.getCommunityBidOfferCount(input.bidId);
        return { count };
      }),

    listBidOffersForOwner: protectedProcedure
      .input(z.object({ bidId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        checkCommunityRead(ctx.user);
        const bid = await db.getCommunityBidById(input.bidId);
        if (!bid || bid.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此需求" });
        const isOwner = bid.authorUserId === ctx.user.id;
        const isAdmin = ctx.user.role === "admin";
        if (!isOwner && !isAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只有發包者或管理員可以查看所有投標" });
        }
        const offers = await db.listCommunityBidOffersForOwner(input.bidId);

        // Batch-fetch all products pinned across all offers (deduped)
        const allPinnedIds = Array.from(new Set(offers.flatMap(o => (o.pinnedProductIds as number[]) ?? [])));
        const allProducts = await db.getProductsByIds(allPinnedIds);

        return { offers, allProducts, isAdmin };
      }),
  }),

  // ===== 企業升級中心 =====
  upgradeCenter: router({
    submitApplication: protectedProcedure.input(z.object({
      companyName: z.string().min(1).max(200),
      contactName: z.string().min(1).max(100),
      phone: z.string().min(7).max(30),
      email: z.string().email().max(320),
      location: z.string().min(1).max(100),
      capitalAmount: z.string().min(1).max(30),
      annualRevenue: z.string().min(1).max(30),
      employeeCount: z.string().min(1).max(30),
      factoryType: z.string().min(1).max(30),
      isEnterpriseFirm: z.boolean(),
      hasGovernmentProject: z.boolean(),
      governmentProjectName: z.string().max(200).optional(),
      hasAppliedForGovernmentSubsidy: z.boolean(),
      hasPatent: z.boolean(),
      patentCount: z.number().int().min(1).max(9999).optional(),
      exportStatus: z.string().min(1).max(30),
      notes: z.string().max(2000).optional(),
      consentAgreed: z.literal(true),
      factoryId: z.number().int().positive(),
    })).mutation(async ({ input, ctx }) => {
      // Validate factoryId belongs to this user and is approved
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const isOwner = owned?.id === input.factoryId;
      const coManagedFactory = coManaged.find(f => f.factoryId === input.factoryId);
      const isCoManaged = !!coManagedFactory;
      if (!isOwner && !isCoManaged) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無法代表此工廠送出申請" });
      }
      const factoryStatus = isOwner ? owned?.status : coManagedFactory?.status;
      if (factoryStatus !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "工廠通過審核後才能申請企業升級評估" });
      }
      const isDuplicate = await db.findRecentUpgradeApplication(input.email, input.phone);
      if (isDuplicate) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "您已在 10 分鐘內送出過申請，請稍後再試。",
        });
      }
      // Auto-assign to regional consultant
      const regionKey = db.resolveRegionKey(input.location);
      let assignedConsultantId: number | null = null;
      let status: "new" | "unassigned" = "unassigned";
      let assignedConsultant: Awaited<ReturnType<typeof db.getConsultantByRegion>> = undefined;
      if (regionKey) {
        const consultant = await db.getConsultantByRegion(regionKey);
        if (consultant) {
          assignedConsultantId = consultant.id;
          status = "new";
          assignedConsultant = consultant;
        }
      }
      const id = await db.createUpgradeApplication({
        companyName: input.companyName,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        location: input.location,
        capitalAmount: input.capitalAmount,
        annualRevenue: input.annualRevenue,
        employeeCount: input.employeeCount,
        factoryType: input.factoryType,
        isEnterpriseFirm: input.isEnterpriseFirm,
        hasGovernmentProject: input.hasGovernmentProject,
        governmentProjectName: input.governmentProjectName ?? null,
        hasAppliedForGovernmentSubsidy: input.hasAppliedForGovernmentSubsidy,
        hasPatent: input.hasPatent,
        patentCount: input.patentCount ?? null,
        exportStatus: input.exportStatus,
        notes: input.notes ?? null,
        factoryId: input.factoryId ?? null,
        consentAgreed: true,
        status,
        assignedConsultantId,
        statusTimeline: { [status]: new Date().toISOString() },
      });
      // Notify admin (fire-and-forget)
      sendUpgradeApplicationEmail({
        companyName: input.companyName,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        location: input.location,
        applicationId: id,
      }).catch((err) => {
        console.error("[Email] upgrade center notification failed:", err);
      });
      // Notify assigned consultant (fire-and-forget, only when status=new)
      console.log(`[UpgradeApp #${id}] status=${status} regionKey=${regionKey} consultant=${assignedConsultant ? `id=${assignedConsultant.id} userId=${assignedConsultant.userId} isActive=${assignedConsultant.isActive}` : "null"}`);
      if (status === "new" && assignedConsultant?.isActive && assignedConsultant.userId) {
        const notifyConsultant = assignedConsultant;
        void db.getUserById(notifyConsultant.userId!).then(async (consultantUser) => {
          // LINE／Apple 登入的顧問帳號 users.email 可能是 null，實際可聯絡信箱是
          // 已驗證的 primaryEmail；統一 primaryEmail ?? email，與專案其他讀信箱
          // 邏輯一致。
          const consultantEmail = consultantUser?.primaryEmail ?? consultantUser?.email ?? null;
          if (!consultantEmail) {
            console.warn(`[Email] Consultant #${notifyConsultant.id} userId=${notifyConsultant.userId} has no email — skipping new-case notification for app #${id}`);
            return;
          }
          console.log(`[Email] Sending new-case email to consultant #${notifyConsultant.id} userId=${notifyConsultant.userId} for app #${id}`);
          await sendUpgradeNewCaseConsultantEmail({
            consultantName: notifyConsultant.name,
            consultantEmail,
            companyName: input.companyName,
            location: input.location,
            contactName: input.contactName,
            email: input.email,
            phone: input.phone,
            capitalAmount: input.capitalAmount,
            applicationId: id,
            appliedAt: new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
          });
          console.log(`[Email] New-case email sent to consultant #${notifyConsultant.id} userId=${notifyConsultant.userId} for app #${id}`);
          // 通知中心 + Push 通知顧問
          notifyUser(
            notifyConsultant.userId!,
            {
              eventType: "upgrade_new_case",
              eventGroup: "upgrade",
              message: `新案件「${input.companyName}」已分派給您，請儘速查收`,
              actionUrl: "/upgrade-consultant/cases",
              titleSnapshot: input.companyName,
              dedupeKey: `upgrade_new_case:${id}`,
            },
            {
              title: "OXM 新企業升級案件",
              body: `新案件「${input.companyName}」已分派給您`,
              data: { type: "upgrade_new_case", targetPath: "/upgrade-consultant/cases" },
            }
          );
        }).catch((err) => {
          console.warn(`[Email] New-case notification FAILED for app #${id} consultant #${notifyConsultant.id}:`, err);
        });
      } else if (status === "new") {
        console.warn(`[Email] Skipping consultant email for app #${id}: consultant=${assignedConsultant ? `id=${assignedConsultant.id} userId=${assignedConsultant.userId} isActive=${assignedConsultant.isActive}` : "null"}`);
      } else if (status === "unassigned") {
        // 無顧問地區：通知中心 + Push 通知所有管理員
        notifyAdmins(
          {
            eventType: "upgrade_unassigned",
            eventGroup: "upgrade",
            message: `新企業升級申請「${input.companyName}」無顧問覆蓋地區（${input.location}），請儘速手動分派`,
            actionUrl: "/admin/upgrade-applications",
            titleSnapshot: input.companyName,
            dedupeKey: `upgrade_unassigned:${id}`,
          },
          {
            title: "OXM 無顧問地區升級申請",
            body: `「${input.companyName}」（${input.location}）無顧問，請手動分派`,
            data: { type: "upgrade_unassigned", targetPath: "/admin/upgrade-applications" },
          }
        );
      }
      return { success: true, id };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new","evaluating","ineligible","deferred","accepted","submitted","rejected","approved","transforming","completed","unassigned","archived","viewed","contacted","consulting"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listUpgradeApplications({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countUpgradeApplications(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getUpgradeApplicationById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到申請案件" });
      return item;
    }),

    adminUpdateStatus: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["new","evaluating","ineligible","deferred","accepted","submitted","rejected","approved","transforming","completed","unassigned","archived","viewed","contacted","consulting"]),
    })).mutation(async ({ ctx, input }) => {
      await db.updateUpgradeApplicationStatus(input.id, input.status, { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) });
      return { success: true };
    }),

    myApplicationProgress: protectedProcedure.query(async ({ ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const factoryIds: number[] = [];
      if (owned?.id) factoryIds.push(owned.id);
      for (const f of coManaged) {
        if (!factoryIds.includes(f.factoryId)) factoryIds.push(f.factoryId);
      }
      if (factoryIds.length === 0) {
        return { hasFactory: false, applications: [] };
      }
      const applications = await db.getUpgradeApplicationsByFactoryIds(factoryIds);
      return { hasFactory: true, applications };
    }),

    publicStats: publicProcedure.query(async () => {
      return await db.getUpgradePublicStats();
    }),
  }),

  // ===== 顧問案件管理 =====
  upgradeConsultant: router({
    // 取得目前登入者的顧問身份
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getConsultantsByUserId(ctx.user.id);
    }),

    // 顧問查看自己地區的案件（admin 可看全部）
    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new","evaluating","ineligible","deferred","accepted","submitted","rejected","approved","transforming","completed","unassigned","archived","viewed","contacted","consulting"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ ctx, input }) => {
      const consultants = await db.getConsultantsByUserId(ctx.user.id);
      // Admin bypass: see all cases regardless of consultant assignment
      if (ctx.user.isAdmin) {
        const [items, total] = await Promise.all([
          db.listUpgradeApplications({ status: input.status, limit: input.limit, offset: input.offset }),
          db.countUpgradeApplications(input.status),
        ]);
        return { items, total, consultants };
      }
      const activeConsultants = consultants.filter(c => c.isActive);
      if (activeConsultants.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
      // 依「顧問帳號所屬區域」過濾，而非 assignedConsultantId：確保同區尚未
      // 分派、或資料不一致的案件不會被漏掉（見 db.findConsultantForApplicationRegion）。
      const regionKeys = activeConsultants.map(c => c.regionKey);
      const [items, total] = await Promise.all([
        db.listUpgradeApplicationsByRegions(regionKeys, { status: input.status, limit: input.limit, offset: input.offset }),
        db.countUpgradeApplicationsByRegions(regionKeys, input.status),
      ]);
      return { items, total, consultants };
    }),

    // 顧問查收案件（admin bypass：視同顧問）
    acknowledge: protectedProcedure.input(z.object({
      applicationId: z.number(),
    })).mutation(async ({ ctx, input }) => {
      const app = await db.getUpgradeApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (app.status !== "new") throw new TRPCError({ code: "BAD_REQUEST", message: "此案件已查收或狀態不符" });
      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };

      if (ctx.user.isAdmin) {
        // Admin 視同顧問：若案件已分派則用 assignedConsultantId，否則直接改狀態
        if (app.assignedConsultantId) {
          await db.acknowledgeUpgradeApplication(app.id, app.assignedConsultantId, ctx.user.id, updatedBy);
        } else {
          await db.updateUpgradeApplicationStatus(app.id, "evaluating", updatedBy);
        }
        if (app.factoryId) {
          notifyFactoryMembers(app.factoryId, {
            eventType: "upgrade_acknowledged",
            eventGroup: "upgrade",
            message: `「${app.companyName}」的企業升級申請已進入評估中`,
            actionUrl: "/upgrade-center",
            titleSnapshot: app.companyName,
            dedupeKey: `upgrade_ack:${app.id}`,
          });
        }
        return { success: true };
      }

      const consultants = await db.getConsultantsByUserId(ctx.user.id);
      if (consultants.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
      // 依「案件所屬區域」比對「顧問目前的有效區域身分」，不只看 assignedConsultantId。
      const myConsultant = db.findConsultantForApplicationRegion(consultants.filter(c => c.isActive), app);
      if (!myConsultant) throw new TRPCError({ code: "FORBIDDEN", message: "此案件不屬於您的地區" });
      const result = await db.acknowledgeUpgradeApplication(app.id, myConsultant.id, ctx.user.id, updatedBy);
      if (!result.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "查收失敗，請重試" });
      // 通知工廠：申請已進入評估中
      if (app.factoryId) {
        notifyFactoryMembers(app.factoryId, {
          eventType: "upgrade_acknowledged",
          eventGroup: "upgrade",
          message: `「${app.companyName}」的企業升級申請已進入評估中`,
          actionUrl: "/upgrade-center",
          titleSnapshot: app.companyName,
          dedupeKey: `upgrade_ack:${app.id}`,
        }, {
          title: "OXM 企業升級申請更新",
          body: `「${app.companyName}」的申請已進入評估中`,
          data: { type: "upgrade", targetPath: "/upgrade-center" },
        });
      }
      return { success: true };
    }),

    // 顧問推進案件狀態（嚴格 transition，不含 new→evaluating，由 acknowledge 處理）
    updateCaseStatus: protectedProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      nextStatus: z.enum(["evaluating", "ineligible", "deferred", "accepted", "submitted", "rejected", "transforming", "completed"]),
    })).mutation(async ({ ctx, input }) => {
      const app = await db.getUpgradeApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getConsultantsByUserId(ctx.user.id);
        const active = consultants.filter(c => c.isActive);
        if (active.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
        // 依「案件所屬區域」比對「顧問目前的有效區域身分」，不只看 assignedConsultantId。
        if (!db.findConsultantForApplicationRegion(active, app))
          throw new TRPCError({ code: "FORBIDDEN", message: "此案件不屬於您的地區" });
      }
      // 嚴格 transition 驗證（含舊狀態 backward compat）
      const ALLOWED: Record<string, string[]> = {
        evaluating:  ["ineligible", "deferred", "accepted"],
        // 緩追區：可重新評估（回到 evaluating），也可比照評估中直接轉為已立案／資格不符。
        deferred:    ["evaluating", "accepted", "ineligible"],
        accepted:    ["submitted"],
        submitted:   ["rejected", "transforming"],  // 政府通過後直接進企業轉型中
        rejected:    ["submitted"],                  // 政府駁回後可補件重新送審
        approved:    ["transforming", "completed"],   // backward compat：舊 approved 資料可推進至轉型或直接結案
        transforming:["completed"],
        // Legacy backward compat
        viewed:      ["ineligible", "deferred", "accepted"],
        contacted:   ["ineligible", "deferred", "accepted"],
        consulting:  ["submitted", "ineligible", "accepted"],
      };
      if (!ALLOWED[app.status]?.includes(input.nextStatus)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `目前狀態「${app.status}」不能推進至「${input.nextStatus}」`,
        });
      }
      // 政府通過進入轉型期前：必須已填寫實際過案金額、顧問服務費、OXM 收入、送審補助方案
      if (input.nextStatus === "transforming" && (app.status === "submitted" || app.status === "approved")) {
        if (!app.approvedSubsidyAmount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請先填寫並儲存實際過案金額，再進行案件通過" });
        }
        if (!app.consultantFeeMode || !app.consultantFeeAmount || !app.oxmCommissionAmount) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請先填寫並儲存顧問服務費，再進行案件通過" });
        }
        if (!app.submittedSubsidyProgram) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇送審補助方案，再進行案件通過" });
        }
        if (app.submittedSubsidyProgram === "其他" && !app.submittedSubsidyProgramOther?.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "補助方案選擇「其他」時，請填寫實際方案名稱" });
        }
      }
      // 政府駁回：清除實際過案金額與顧問服務費，避免語意矛盾
      if (input.nextStatus === "rejected") {
        await db.clearApprovalAndFeeData(input.applicationId);
      }
      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };
      await db.updateUpgradeApplicationStatus(input.applicationId, input.nextStatus, updatedBy);
      // 通知工廠：案件狀態更新
      if (app.factoryId) {
        const upgradeStatusLabels: Record<string, string> = {
          evaluating: "重新進入評估",
          ineligible: "不符申請資格",
          deferred: "暫時移至緩追區，等待合適補助方案",
          accepted: "通過評估，準備送件",
          submitted: "已送件政府審核",
          rejected: "政府審核未通過",
          transforming: "已通過，進入企業轉型期",
          completed: "案件已結案",
        };
        const statusLabel = upgradeStatusLabels[input.nextStatus] ?? input.nextStatus;
        notifyFactoryMembers(app.factoryId, {
          eventType: `upgrade_status_${input.nextStatus}`,
          eventGroup: "upgrade",
          message: `「${app.companyName}」企業升級申請狀態更新：${statusLabel}`,
          actionUrl: "/upgrade-center",
          titleSnapshot: app.companyName,
          dedupeKey: `upgrade_status:${app.id}:${input.nextStatus}`,
        }, {
          title: "OXM 企業升級申請更新",
          body: `申請狀態更新：${statusLabel}`,
          data: { type: "upgrade", targetPath: "/upgrade-center" },
        });
      }
      return { success: true };
    }),

    // 顧問更新案件備註
    updateCaseNotes: protectedProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      notes: z.string().max(5000),
    })).mutation(async ({ ctx, input }) => {
      const app = await db.getUpgradeApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getConsultantsByUserId(ctx.user.id);
        const active = consultants.filter(c => c.isActive);
        if (active.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
        if (!db.findConsultantForApplicationRegion(active, app))
          throw new TRPCError({ code: "FORBIDDEN", message: "此案件不屬於您的地區" });
      }
      await db.updateUpgradeCaseNotes(input.applicationId, input.notes || null, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    // 顧問更新金額欄位（預計送審金額 / 實際過案金額 / 顧問服務費 / 送審補助方案）
    updateCaseAmounts: protectedProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      plannedSubsidyAmount: z.number().int().positive().max(100_000_000).nullable().optional(),
      approvedSubsidyAmount: z.number().int().positive().max(100_000_000).nullable().optional(),
      // 顧問服務費
      consultantFeeMode: z.enum(["percentage", "fixed"]).nullable().optional(),
      consultantFeePercentage: z.number().min(0).max(100).nullable().optional(),
      consultantFeeAmount: z.number().int().min(0).max(100_000_000).nullable().optional(),
      // 送審補助方案
      submittedSubsidyProgram: z.enum(["SBIR","CITD","SIIR","研發轉型補助","海外通路計畫","其他"]).nullable().optional(),
      submittedSubsidyProgramOther: z.string().max(100).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const app = await db.getUpgradeApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getConsultantsByUserId(ctx.user.id);
        const active = consultants.filter(c => c.isActive);
        if (active.length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "您不是顧問" });
        if (!db.findConsultantForApplicationRegion(active, app))
          throw new TRPCError({ code: "FORBIDDEN", message: "此案件不屬於您的地區" });
      }

      // ── 後端計算顧問服務費與 OXM 收入 ────────────────────────────────────────
      const OXM_RATE = 10; // 固定 10%，存入 DB 以便歷史保存
      let derivedFeeAmount: number | undefined;
      let derivedOxmAmount: number | undefined;

      if (input.consultantFeeMode === "percentage") {
        if (input.consultantFeePercentage == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "百分比模式需要填寫服務費成數" });
        }
        const approvedAmt = input.approvedSubsidyAmount ?? app.approvedSubsidyAmount;
        if (!approvedAmt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請先填寫並儲存政府實際過案金額，再填寫百分比服務費" });
        }
        derivedFeeAmount = Math.round(approvedAmt * input.consultantFeePercentage / 100);
        derivedOxmAmount = Math.round(derivedFeeAmount * OXM_RATE / 100);
      } else if (input.consultantFeeMode === "fixed") {
        if (input.consultantFeeAmount == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "固定金額模式需要填寫服務費金額" });
        }
        derivedFeeAmount = input.consultantFeeAmount;
        derivedOxmAmount = Math.round(derivedFeeAmount * OXM_RATE / 100);
      } else if (input.consultantFeeMode === null) {
        // 清除
        derivedFeeAmount = undefined; // handled via explicit null in payload
      }

      // ── 送審補助方案驗證 ──────────────────────────────────────────────────────
      if (input.submittedSubsidyProgram !== undefined) {
        if (input.submittedSubsidyProgram === "其他") {
          const otherTrimmed = input.submittedSubsidyProgramOther?.trim();
          if (!otherTrimmed) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "補助方案選擇「其他」時，請填寫實際方案名稱" });
          }
        }
      }
      // 非「其他」時 programOther 強制清空
      const programOtherValue = input.submittedSubsidyProgram !== undefined
        ? (input.submittedSubsidyProgram === "其他"
          ? (input.submittedSubsidyProgramOther?.trim() ?? null)
          : null)
        : undefined;

      await db.updateCaseAmounts(input.applicationId, {
        ...(input.plannedSubsidyAmount !== undefined  ? { plannedSubsidyAmount: input.plannedSubsidyAmount }   : {}),
        ...(input.approvedSubsidyAmount !== undefined ? { approvedSubsidyAmount: input.approvedSubsidyAmount } : {}),
        ...(input.consultantFeeMode !== undefined     ? { consultantFeeMode: input.consultantFeeMode }         : {}),
        ...(input.consultantFeePercentage !== undefined
          ? { consultantFeePercentage: input.consultantFeePercentage != null ? String(input.consultantFeePercentage) : null }
          : {}),
        ...(derivedFeeAmount !== undefined ? { consultantFeeAmount: derivedFeeAmount } : {}),
        ...(derivedOxmAmount !== undefined ? { oxmCommissionRate: String(OXM_RATE), oxmCommissionAmount: derivedOxmAmount } : {}),
        ...(input.submittedSubsidyProgram !== undefined ? { submittedSubsidyProgram: input.submittedSubsidyProgram } : {}),
        ...(programOtherValue !== undefined             ? { submittedSubsidyProgramOther: programOtherValue }           : {}),
      }, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    // 管理員：查看所有顧問設定
    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllConsultants();
    }),

    // 管理員：綁定 / 解除顧問 userId，綁定後自動補派舊 unassigned 案件
    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ input }) => {
      try {
        await db.bindConsultantUser(input.consultantId, input.userId);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "綁定失敗" });
      }

      // 解除綁定：不補派
      if (input.userId == null) {
        return { success: true, backfilledCount: 0, backfilledApplicationIds: [] as number[] };
      }

      const consultant = await db.getConsultantById(input.consultantId);
      // inactive 顧問不補派
      if (!consultant?.isActive) {
        return { success: true, backfilledCount: 0, backfilledApplicationIds: [] as number[] };
      }

      const { backfilledIds, backfilledApps } = await db.backfillUnassignedCasesToConsultant(
        consultant.id,
        consultant.regionKey,
      );

      // Fire-and-forget: 每筆補派案件各寄一封新案件通知給顧問
      if (backfilledApps.length > 0) {
        const consultantSnapshot = consultant;
        void db.getUserById(input.userId).then(async (consultantUser) => {
          // 同新案件通知：統一 primaryEmail ?? email，避免 LINE／Apple 登入且
          // 只設定 primaryEmail 的顧問收不到補派通知。
          const consultantEmail = consultantUser?.primaryEmail ?? consultantUser?.email ?? null;
          if (!consultantEmail) {
            console.warn("[Email] backfill: consultant user has no email, skipping");
            return;
          }
          for (const app of backfilledApps) {
            try {
              await sendUpgradeNewCaseConsultantEmail({
                consultantName: consultantSnapshot.name,
                consultantEmail,
                companyName: app.companyName,
                location: app.location,
                contactName: app.contactName,
                email: app.email,
                phone: app.phone,
                capitalAmount: app.capitalAmount,
                applicationId: app.id,
                appliedAt: new Date(app.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }),
              });
            } catch (err) {
              console.warn(`[Email] backfill notification failed for app ${app.id}:`, err);
            }
          }
        });
      }

      return {
        success: true,
        backfilledCount: backfilledIds.length,
        backfilledApplicationIds: backfilledIds,
      };
    }),

    // 管理員：統計
    adminStats: adminProcedure.query(async () => {
      return db.adminGetUpgradeStats();
    }),
  }),

  // ===== 企業財務優化 =====
  // 與企業升級中心（upgradeCenter/upgradeConsultant）完全獨立的資料模型與權限：
  // 顧問授權只看 financeConsultants 是否有一筆該 userId 的有效紀錄，不使用固定
  // email／userId／前端條件；既有政府補助顧問資料不受影響。
  financeCenter: router({
    submitApplication: protectedProcedure.input(z.object({
      contactName: z.string().min(1).max(100),
      phone: z.string().min(7).max(30).regex(/^[\d\-+() ]{7,20}$/, "電話格式不正確"),
      contactTime: z.string().min(1).max(100),
      consentAgreed: z.literal(true),
      factoryId: z.number().int().positive(),
    })).mutation(async ({ input, ctx }) => {
      // 只能替自己有權管理（owner 或 co-manager）且已通過審核的工廠送出申請，
      // 與 upgradeCenter.submitApplication 相同的驗證方式，伺服器端強制檢查，
      // 不信任前端傳入的 factoryId 之外的任何工廠資料。
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const isOwner = owned?.id === input.factoryId;
      const coManagedFactory = coManaged.find(f => f.factoryId === input.factoryId);
      const isCoManaged = !!coManagedFactory;
      if (!isOwner && !isCoManaged) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無法代表此工廠送出申請" });
      }
      const factory = isOwner ? owned : await db.getFactoryById(input.factoryId);
      if (!factory || factory.status !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "工廠通過審核後才能申請企業財務健檢" });
      }

      // 重複申請防護：同一工廠若已有新案件／評估中／緩追區的未結案案件，不得
      // 再次建立。這裡先做一次友善的預先檢查；真正可靠的防線是 migration
      // 0068 建立的 fa_open_factory_uq（VIRTUAL generated column + UNIQUE INDEX），
      // 即使高併發下同時送出多筆也不會產生重複的未結案案件。
      if (await db.hasOpenFinanceApplication(input.factoryId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的企業財務優化案件，請至企業財務優化專區查看目前進度" });
      }

      // 候選顧問查詢與案件寫入必須是同一個 transaction（內部對候選顧問列
      // 加上 FOR UPDATE row lock），否則會出現「查詢時還有一位啟用中顧問，
      // 顧問卻在查詢完成、案件寫入前被停用」的競態，導致新案件指派給一個
      // 已經停用的顧問。詳見 db.createFinanceApplicationWithAutoAssign 註解。
      let id: number;
      let consultant: Awaited<ReturnType<typeof db.createFinanceApplicationWithAutoAssign>>["assignedConsultant"];
      try {
        const result = await db.createFinanceApplicationWithAutoAssign({
          factoryId: input.factoryId,
          // 公司名稱／地址由 server 依 factoryId 重新讀取工廠資料寫入，不信任前端傳入值。
          companyNameSnapshot: factory.name,
          companyAddressSnapshot: factory.address,
          contactName: input.contactName,
          phone: input.phone,
          contactTime: input.contactTime,
          consentAgreed: true,
          status: "new",
          statusTimeline: { new: new Date().toISOString() },
        });
        id = result.id;
        consultant = result.assignedConsultant;
      } catch (err: unknown) {
        // 高併發下兩個請求同時通過上方預先檢查時，由 DB 唯一索引擋下第二筆。
        if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的企業財務優化案件，請至企業財務優化專區查看目前進度" });
        }
        throw err;
      }

      // 站內通知申請人：已收到申請
      notifyUser(ctx.user.id, {
        eventType: "finance_application_submitted",
        eventGroup: "finance",
        message: `「${factory.name}」的企業財務優化健檢申請已送出`,
        actionUrl: "/finance-optimization",
        titleSnapshot: factory.name,
        dedupeKey: `finance_submitted:${id}`,
      });

      if (consultant?.userId) {
        // 指派到有效顧問：站內通知該顧問（不寄送 Email／Push，沿用現有通知機制）
        notifyUser(consultant.userId, {
          eventType: "finance_new_case",
          eventGroup: "finance",
          message: `新企業財務優化案件「${factory.name}」已分派給您，請儘速查收`,
          actionUrl: "/finance-consultant/cases",
          titleSnapshot: factory.name,
          dedupeKey: `finance_new_case:${id}`,
        });
      } else {
        // 尚未設定／找不到單一啟用中顧問：通知管理員手動指派，案件仍安全建立
        notifyAdmins({
          eventType: "finance_unassigned",
          eventGroup: "finance",
          message: `新企業財務優化申請「${factory.name}」尚未指派顧問，請至財務優化案件區手動分派`,
          actionUrl: "/admin/finance-applications",
          titleSnapshot: factory.name,
          dedupeKey: `finance_unassigned:${id}`,
        });
      }

      return { success: true, id };
    }),

    // 申請進度查詢：回傳目前使用者名下工廠的財務優化案件，且刻意不回傳
    // notes（顧問內部備註），避免洩漏給一般申請人。
    myApplicationProgress: protectedProcedure.query(async ({ ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const factoryIds: number[] = [];
      if (owned?.id) factoryIds.push(owned.id);
      for (const f of coManaged) {
        if (!factoryIds.includes(f.factoryId)) factoryIds.push(f.factoryId);
      }
      if (factoryIds.length === 0) return { hasFactory: false, applications: [] };
      const applications = await db.getFinanceApplicationsByFactoryIds(factoryIds);
      // 明確欄位白名單（而非排除 notes 的黑名單）：只回傳申請人本來就知道、
      // 自己填寫過的欄位，杜絕日後在 financeApplications 加欄位時，這裡因為
      // 忘記排除而意外外洩顧問內部資訊（notes／assignedConsultantId／
      // lastUpdatedByUserId／lastUpdatedByNameSnapshot 一律不回傳）。
      const sanitized = applications.map((a) => ({
        id: a.id,
        factoryId: a.factoryId,
        companyNameSnapshot: a.companyNameSnapshot,
        companyAddressSnapshot: a.companyAddressSnapshot,
        contactName: a.contactName,
        phone: a.phone,
        contactTime: a.contactTime,
        consentAgreed: a.consentAgreed,
        status: a.status,
        statusTimeline: a.statusTimeline,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));
      return { hasFactory: true, applications: sanitized };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "deferred", "not_interested", "won"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listFinanceApplications({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countFinanceApplications(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getFinanceApplicationById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      return item;
    }),
  }),

  // ===== 財務優化顧問案件管理 =====
  financeConsultant: router({
    // 目前登入者的財務顧問身份（空陣列＝不是財務顧問）
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getFinanceConsultantsByUserId(ctx.user.id);
    }),

    // 顧問／管理員查看案件：目前只有單一顧問池，沒有地區區分，任一位有效
    // 財務顧問可查看全部財務案件；管理員一律可查看全部。
    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "deferred", "not_interested", "won"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ ctx, input }) => {
      if (!ctx.user.isAdmin) {
        const consultants = await db.getFinanceConsultantsByUserId(ctx.user.id);
        if (!consultants.some(c => c.isActive)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是財務優化顧問" });
        }
      }
      const [items, total] = await Promise.all([
        db.listFinanceApplications({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countFinanceApplications(input.status),
      ]);
      return { items, total };
    }),

    // 合法流程：new→evaluating；evaluating→deferred/not_interested/won；
    // deferred→evaluating/not_interested/won；not_interested/won 為結案狀態。
    updateCaseStatus: protectedProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      nextStatus: z.enum(["evaluating", "deferred", "not_interested", "won"]),
    })).mutation(async ({ ctx, input }) => {
      if (!ctx.user.isAdmin) {
        const consultants = await db.getFinanceConsultantsByUserId(ctx.user.id);
        if (!consultants.some(c => c.isActive)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是財務優化顧問" });
        }
      }
      const app = await db.getFinanceApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });

      const FINANCE_ALLOWED: Record<string, string[]> = {
        new: ["evaluating"],
        evaluating: ["deferred", "not_interested", "won"],
        deferred: ["evaluating", "not_interested", "won"],
      };
      if (!FINANCE_ALLOWED[app.status]?.includes(input.nextStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `目前狀態「${app.status}」不能推進至「${input.nextStatus}」` });
      }

      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };
      await db.updateFinanceApplicationStatus(input.applicationId, input.nextStatus, updatedBy);

      const FINANCE_STATUS_LABELS: Record<string, string> = {
        evaluating: "進入評估中",
        deferred: "暫時移至緩追區",
        not_interested: "客戶暫無意願",
        won: "已完成媒合",
      };
      notifyFactoryMembers(app.factoryId, {
        eventType: `finance_status_${input.nextStatus}`,
        eventGroup: "finance",
        message: `「${app.companyNameSnapshot}」企業財務優化案件狀態更新：${FINANCE_STATUS_LABELS[input.nextStatus] ?? input.nextStatus}`,
        actionUrl: "/finance-optimization",
        titleSnapshot: app.companyNameSnapshot,
        dedupeKey: `finance_status:${app.id}:${input.nextStatus}`,
      });
      return { success: true };
    }),

    // 顧問內部備註：僅授權顧問／管理員可讀寫，不回傳給一般申請人（見
    // financeCenter.myApplicationProgress 已排除 notes 欄位）。
    updateCaseNotes: protectedProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      notes: z.string().max(5000),
    })).mutation(async ({ ctx, input }) => {
      if (!ctx.user.isAdmin) {
        const consultants = await db.getFinanceConsultantsByUserId(ctx.user.id);
        if (!consultants.some(c => c.isActive)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是財務優化顧問" });
        }
      }
      const app = await db.getFinanceApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      await db.updateFinanceCaseNotes(input.applicationId, input.notes || null, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    // 管理員：手動指派／改派承辦顧問（含補派尚未指派顧問時建立的案件）。
    // Server 一律拒絕指派給停用中、尚未綁定使用者帳號或不存在的顧問——這裡
    // 是給前端明確的 TRPCError code；db.adminAssignFinanceConsultant 內還有
    // 一層 defense-in-depth 的相同驗證。
    adminAssignConsultant: adminProcedure.input(z.object({
      applicationId: z.number().int().positive(),
      consultantId: z.number().int().positive().nullable(),
    })).mutation(async ({ ctx, input }) => {
      const app = await db.getFinanceApplicationById(input.applicationId);
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (input.consultantId != null) {
        const consultant = await db.getFinanceConsultantById(input.consultantId);
        if (!consultant) throw new TRPCError({ code: "NOT_FOUND", message: "找不到顧問" });
        if (!consultant.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問目前已停用，無法指派承辦" });
        if (consultant.userId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問尚未綁定使用者帳號，無法指派承辦" });
      }
      // 上面只是提早給出人類可讀錯誤訊息的預檢查；真正的競態保護是
      // db.adminAssignFinanceConsultant 內部的 transaction + FOR UPDATE
      // 重新驗證。極端情況下（預檢查通過後、寫入前，顧問被另一個請求停用／
      // 解除綁定），這裡的 catch 把該情境轉成友善的 BAD_REQUEST，而不是外洩
      // 未預期的 500 錯誤。
      try {
        await db.adminAssignFinanceConsultant(input.applicationId, input.consultantId, { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "指派失敗" });
      }
      return { success: true };
    }),

    // 管理員：顧問設定管理（目前只有一位合作顧問，未來可擴充多位）
    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllFinanceConsultants();
    }),

    adminCreateConsultant: adminProcedure.input(z.object({
      name: z.string().min(1).max(100),
    })).mutation(async ({ input }) => {
      const id = await db.adminCreateFinanceConsultant(input.name);
      return { success: true, id };
    }),

    // 解除綁定（userId=null）時，該顧問名下未結案案件會安全改為未指派
    // （db.adminBindFinanceConsultantUser 內同一 transaction 完成），這裡負責
    // 通知管理員有案件需要重新指派。pre-check 通過後仍可能在高併發下遇到
    // fc_user_id_uq UNIQUE INDEX 競態，一律攔截 ER_DUP_ENTRY 轉成固定、安全
    // 的 BAD_REQUEST 訊息，不回傳原始 SQL 錯誤。
    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ ctx, input }) => {
      let reassignedCases: Awaited<ReturnType<typeof db.adminBindFinanceConsultantUser>>["reassignedCases"] = [];
      try {
        const result = await db.adminBindFinanceConsultantUser(
          input.consultantId,
          input.userId,
          { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
        );
        reassignedCases = result.reassignedCases;
      } catch (err) {
        if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此使用者已綁定其他財務優化顧問，一個帳號同時只能擔任一位財務優化顧問" });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "綁定失敗" });
      }
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "finance_cases_unassigned_cascade",
          eventGroup: "finance",
          message: `解除財務優化顧問綁定後，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/admin/finance-applications",
          titleSnapshot: "財務優化顧問解除綁定",
          dedupeKey: `finance_cascade_unbind:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),

    // 停用顧問（isActive=false）時，同理安全改為未指派並通知管理員。
    adminSetActive: adminProcedure.input(z.object({
      consultantId: z.number(),
      isActive: z.boolean(),
    })).mutation(async ({ ctx, input }) => {
      const { reassignedCases } = await db.adminSetFinanceConsultantActive(
        input.consultantId,
        input.isActive,
        { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
      );
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "finance_cases_unassigned_cascade",
          eventGroup: "finance",
          message: `財務優化顧問已停用，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/admin/finance-applications",
          titleSnapshot: "財務優化顧問停用",
          dedupeKey: `finance_cascade_deactivate:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),
  }),

  // ===== 短影音與品牌內容行銷專區 =====
  // 隱藏預覽頁 /short-video-marketing 專用 API，與企業升級中心／企業財務
  // 優化／ISO 認證完全獨立的資料模型與權限。短影音案件不得混入其他服務
  // 的看板或統計，見 shared/shortVideoMarketing.ts 狀態機。
  shortVideoCenter: router({
    submitApplication: protectedProcedure.input(shortVideoApplicationSchema)
      .mutation(async ({ input, ctx }) => {
        // 只能替自己有權管理（owner 或 co-manager）且已通過審核的工廠送出
        // 申請，與 financeCenter.submitApplication 相同的驗證方式，伺服器端
        // 強制檢查，不信任前端傳入的 factoryId 之外的任何工廠資料。
        const [owned, coManaged] = await Promise.all([
          db.getFactoryByOwnerId(ctx.user.id),
          db.getCoManagedFactories(ctx.user.id),
        ]);
        const isOwner = owned?.id === input.factoryId;
        const coManagedFactory = coManaged.find(f => f.factoryId === input.factoryId);
        const isCoManaged = !!coManagedFactory;
        if (!isOwner && !isCoManaged) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無法代表此工廠送出申請" });
        }
        const factory = isOwner ? owned : await db.getFactoryById(input.factoryId);
        if (!factory || factory.status !== "approved") {
          throw new TRPCError({ code: "FORBIDDEN", message: "工廠通過審核後才能申請短影音與品牌內容行銷服務" });
        }

        // 重複申請防護：同一工廠若已有未結案的短影音案件，不得再次建立。這裡
        // 先做一次友善的預先檢查；真正可靠的防線是 migration 0073 建立的
        // svcase_open_factory_uq（VIRTUAL generated column + UNIQUE INDEX）。
        if (await db.hasOpenShortVideoCase(input.factoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的短影音與品牌內容行銷案件，請至短影音專區查看目前進度" });
        }

        let id: number;
        let consultant: Awaited<ReturnType<typeof db.createShortVideoCaseWithAutoAssign>>["assignedConsultant"];
        try {
          const result = await db.createShortVideoCaseWithAutoAssign({
            factoryId: input.factoryId,
            // 公司名稱／地址由 server 依 factoryId 重新讀取工廠資料寫入，不信任前端傳入值。
            companyNameSnapshot: factory.name,
            companyAddressSnapshot: factory.address,
            contactName: input.contactName,
            phone: input.phone,
            contactTime: input.contactTime,
            servicesWanted: input.servicesWanted,
            isUnsure: input.isUnsure,
            primaryGoal: input.primaryGoal,
            platforms: input.platforms,
            noPlatformYet: input.noPlatformYet,
            additionalNotes: input.additionalNotes || null,
            consentAgreed: true,
            statusTimeline: { new: new Date().toISOString() },
          });
          id = result.id;
          consultant = result.assignedConsultant;
        } catch (err: unknown) {
          if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的短影音與品牌內容行銷案件，請至短影音專區查看目前進度" });
          }
          throw err;
        }

        // 站內通知申請人：已收到申請（不寄送 Email／Push，沿用現有通知機制）
        notifyUser(ctx.user.id, {
          eventType: "short_video_application_submitted",
          eventGroup: "short_video",
          message: `「${factory.name}」的短影音與品牌內容行銷免費初步諮詢申請已送出`,
          actionUrl: "/short-video-marketing",
          titleSnapshot: factory.name,
          dedupeKey: `short_video_submitted:${id}`,
        });

        if (consultant?.userId) {
          notifyUser(consultant.userId, {
            eventType: "short_video_new_case",
            eventGroup: "short_video",
            message: `新短影音與品牌內容行銷案件「${factory.name}」已分派給您，請儘速查收`,
            actionUrl: "/short-video-consultant/cases",
            titleSnapshot: factory.name,
            dedupeKey: `short_video_new_case:${id}`,
          });
        } else {
          notifyAdmins({
            eventType: "short_video_unassigned",
            eventGroup: "short_video",
            message: `新短影音與品牌內容行銷申請「${factory.name}」尚未指派顧問，請手動分派`,
            actionUrl: "/short-video-consultant/cases",
            titleSnapshot: factory.name,
            dedupeKey: `short_video_unassigned:${id}`,
          });
        }

        return { success: true, id };
      }),

    // 申請進度查詢：回傳目前使用者名下工廠的短影音案件，刻意不回傳 notes
    // （顧問內部備註），避免洩漏給一般申請人。
    myApplicationProgress: protectedProcedure.query(async ({ ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const factoryIds: number[] = [];
      if (owned?.id) factoryIds.push(owned.id);
      for (const f of coManaged) {
        if (!factoryIds.includes(f.factoryId)) factoryIds.push(f.factoryId);
      }
      if (factoryIds.length === 0) return { hasFactory: false, applications: [] };
      const applications = await db.getShortVideoCasesByFactoryIds(factoryIds);
      const sanitized = applications.map((a) => ({
        id: a.id,
        factoryId: a.factoryId,
        companyNameSnapshot: a.companyNameSnapshot,
        companyAddressSnapshot: a.companyAddressSnapshot,
        contactName: a.contactName,
        phone: a.phone,
        contactTime: a.contactTime,
        servicesWanted: a.servicesWanted,
        isUnsure: a.isUnsure,
        primaryGoal: a.primaryGoal,
        platforms: a.platforms,
        noPlatformYet: a.noPlatformYet,
        additionalNotes: a.additionalNotes,
        consentAgreed: a.consentAgreed,
        status: a.status,
        statusTimeline: a.statusTimeline,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));
      return { hasFactory: true, applications: sanitized };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listShortVideoCasesAdmin({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countShortVideoCases(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getShortVideoCaseById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      return item;
    }),
  }),

  // ===== 短影音顧問案件管理 =====
  shortVideoConsultant: router({
    // 目前登入者的短影音顧問身份（空陣列＝不是短影音顧問）
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getShortVideoConsultantsByUserId(ctx.user.id);
    }),

    // 顧問只能看見指派給自己的案件——依服務資格與（自動指派時比對的）
    // serviceAreas 分派結果決定案件歸屬，不同顧問之間彼此看不到對方的案件；
    // 管理員一律可查看全部（見 shortVideoCenter.adminList）。
    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
    })).query(async ({ ctx, input }) => {
      if (ctx.user.isAdmin) {
        return db.listShortVideoCasesAdmin({ status: input.status });
      }
      const consultants = await db.getShortVideoConsultantsByUserId(ctx.user.id);
      const activeIds = consultants.filter(c => c.isActive).map(c => c.id);
      if (activeIds.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您不是短影音顧問" });
      }
      return db.listShortVideoCasesForConsultant(activeIds, input.status);
    }),

    updateCaseStatus: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      nextStatus: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getShortVideoCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getShortVideoConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      if (!SHORT_VIDEO_STATUS_TRANSITIONS[item.status]?.includes(input.nextStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `目前狀態「${item.status}」不能推進至「${input.nextStatus}」` });
      }
      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };
      await db.updateShortVideoCaseStatus(input.caseId, input.nextStatus, updatedBy);

      notifyFactoryMembers(item.factoryId, {
        eventType: `short_video_status_${input.nextStatus}`,
        eventGroup: "short_video",
        message: `「${item.companyNameSnapshot}」短影音與品牌內容行銷案件狀態更新：${SHORT_VIDEO_STATUS_LABELS[input.nextStatus] ?? input.nextStatus}`,
        actionUrl: "/short-video-marketing",
        titleSnapshot: item.companyNameSnapshot,
        dedupeKey: `short_video_status:${item.id}:${input.nextStatus}`,
      });
      return { success: true };
    }),

    // 顧問內部備註：僅授權顧問／管理員可讀寫，不回傳給一般申請人（見
    // shortVideoCenter.myApplicationProgress 已排除 notes 欄位）。
    updateCaseNotes: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      notes: z.string().max(5000),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getShortVideoCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getShortVideoConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      await db.updateShortVideoCaseNotes(input.caseId, input.notes || null, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    // 管理員：手動指派／改派承辦顧問（含補派尚未指派顧問時建立的案件）。
    adminAssignConsultant: adminProcedure.input(z.object({
      caseId: z.number().int().positive(),
      consultantId: z.number().int().positive().nullable(),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getShortVideoCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (input.consultantId != null) {
        const consultant = await db.getShortVideoConsultantById(input.consultantId);
        if (!consultant) throw new TRPCError({ code: "NOT_FOUND", message: "找不到顧問" });
        if (!consultant.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問目前已停用，無法指派承辦" });
        if (consultant.userId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問尚未綁定使用者帳號，無法指派承辦" });
      }
      try {
        await db.adminAssignShortVideoConsultant(input.caseId, input.consultantId, { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "指派失敗" });
      }
      return { success: true };
    }),

    // 管理員：顧問設定管理
    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllShortVideoConsultants();
    }),

    adminCreateConsultant: adminProcedure.input(z.object({
      name: z.string().min(1).max(100),
      serviceAreas: z.array(z.enum(SHORT_VIDEO_SERVICE_KEYS)).max(5).default([]),
    })).mutation(async ({ input }) => {
      const id = await db.adminCreateShortVideoConsultant(input.name, input.serviceAreas);
      return { success: true, id };
    }),

    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ ctx, input }) => {
      let reassignedCases: Awaited<ReturnType<typeof db.adminBindShortVideoConsultantUser>>["reassignedCases"] = [];
      try {
        const result = await db.adminBindShortVideoConsultantUser(
          input.consultantId,
          input.userId,
          { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
        );
        reassignedCases = result.reassignedCases;
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "綁定失敗" });
      }
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "short_video_cases_unassigned_cascade",
          eventGroup: "short_video",
          message: `解除短影音顧問綁定後，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/short-video-consultant/cases",
          titleSnapshot: "短影音顧問解除綁定",
          dedupeKey: `short_video_cascade_unbind:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),

    adminSetActive: adminProcedure.input(z.object({
      consultantId: z.number(),
      isActive: z.boolean(),
    })).mutation(async ({ ctx, input }) => {
      const { reassignedCases } = await db.adminSetShortVideoConsultantActive(
        input.consultantId,
        input.isActive,
        { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
      );
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "short_video_cases_unassigned_cascade",
          eventGroup: "short_video",
          message: `短影音顧問已停用，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/short-video-consultant/cases",
          titleSnapshot: "短影音顧問停用",
          dedupeKey: `short_video_cascade_deactivate:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),
  }),

  // ===== ISO 與低碳認證專區：公開查詢 =====
  // 隱藏預覽頁專用 API——刻意不含任何「送出諮詢」或建立案件的 mutation，
  // 本輪只有唯讀查詢。回傳資料一律只包含分類已啟用、項目狀態為 published
  // 且 serviceEnabled=true 的服務項目（見 db.listPublicCertificationServices
  // 內的 where 條件），draft／unpublished／archived 或已停用的項目絕不會
  // 出現在這裡的回傳結果。
  certificationCenter: router({
    listCategories: publicProcedure.query(async () => {
      return db.listPublicCertificationCategories();
    }),
    listServices: publicProcedure.query(async () => {
      return db.listPublicCertificationServices();
    }),

    submitApplication: protectedProcedure.input(certificationApplicationSchema)
      .mutation(async ({ input, ctx }) => {
        const [owned, coManaged] = await Promise.all([
          db.getFactoryByOwnerId(ctx.user.id),
          db.getCoManagedFactories(ctx.user.id),
        ]);
        const isOwner = owned?.id === input.factoryId;
        const coManagedFactory = coManaged.find(f => f.factoryId === input.factoryId);
        const isCoManaged = !!coManagedFactory;
        if (!isOwner && !isCoManaged) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無法代表此工廠送出申請" });
        }
        const factory = isOwner ? owned : await db.getFactoryById(input.factoryId);
        if (!factory || factory.status !== "approved") {
          throw new TRPCError({ code: "FORBIDDEN", message: "工廠通過審核後才能申請 ISO 與低碳認證服務" });
        }

        // servicesWanted 必須是目前實際上架（published + serviceEnabled）的
        // 認證服務代碼，伺服器端重新查詢目錄驗證，不信任前端傳入值本身。
        if (input.servicesWanted.length > 0) {
          const catalog = await db.listPublicCertificationServices();
          const validCodes = new Set(catalog.map(s => s.code));
          const invalid = input.servicesWanted.filter(code => !validCodes.has(code));
          if (invalid.length > 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `以下服務目前不存在或已下架：${invalid.join("、")}` });
          }
        }

        if (await db.hasOpenCertificationCase(input.factoryId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的 ISO 與低碳認證案件，請至認證專區查看目前進度" });
        }

        let id: number;
        let consultant: Awaited<ReturnType<typeof db.createCertificationCaseWithAutoAssign>>["assignedConsultant"];
        try {
          const result = await db.createCertificationCaseWithAutoAssign({
            factoryId: input.factoryId,
            companyNameSnapshot: factory.name,
            companyAddressSnapshot: factory.address,
            contactName: input.contactName,
            phone: input.phone,
            contactTime: input.contactTime,
            servicesWanted: input.servicesWanted,
            isUnsure: input.isUnsure,
            additionalNotes: input.additionalNotes || null,
            consentAgreed: true,
            statusTimeline: { new: new Date().toISOString() },
          });
          id = result.id;
          consultant = result.assignedConsultant;
        } catch (err: unknown) {
          if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的 ISO 與低碳認證案件，請至認證專區查看目前進度" });
          }
          throw err;
        }

        notifyUser(ctx.user.id, {
          eventType: "certification_application_submitted",
          eventGroup: "certification",
          message: `「${factory.name}」的 ISO 與低碳認證免費初步諮詢申請已送出`,
          actionUrl: "/certification-center",
          titleSnapshot: factory.name,
          dedupeKey: `certification_submitted:${id}`,
        });

        if (consultant?.userId) {
          notifyUser(consultant.userId, {
            eventType: "certification_new_case",
            eventGroup: "certification",
            message: `新 ISO 與低碳認證案件「${factory.name}」已分派給您，請儘速查收`,
            actionUrl: "/certification-consultant/cases",
            titleSnapshot: factory.name,
            dedupeKey: `certification_new_case:${id}`,
          });
        } else {
          notifyAdmins({
            eventType: "certification_unassigned",
            eventGroup: "certification",
            message: `新 ISO 與低碳認證申請「${factory.name}」尚未指派顧問，請手動分派`,
            actionUrl: "/certification-consultant/cases",
            titleSnapshot: factory.name,
            dedupeKey: `certification_unassigned:${id}`,
          });
        }

        return { success: true, id };
      }),

    myApplicationProgress: protectedProcedure.query(async ({ ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const factoryIds: number[] = [];
      if (owned?.id) factoryIds.push(owned.id);
      for (const f of coManaged) {
        if (!factoryIds.includes(f.factoryId)) factoryIds.push(f.factoryId);
      }
      if (factoryIds.length === 0) return { hasFactory: false, applications: [] };
      const applications = await db.getCertificationCasesByFactoryIds(factoryIds);
      const sanitized = applications.map((a) => ({
        id: a.id,
        factoryId: a.factoryId,
        companyNameSnapshot: a.companyNameSnapshot,
        companyAddressSnapshot: a.companyAddressSnapshot,
        contactName: a.contactName,
        phone: a.phone,
        contactTime: a.contactTime,
        servicesWanted: a.servicesWanted,
        isUnsure: a.isUnsure,
        additionalNotes: a.additionalNotes,
        consentAgreed: a.consentAgreed,
        status: a.status,
        statusTimeline: a.statusTimeline,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));
      return { hasFactory: true, applications: sanitized };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listCertificationCasesAdmin({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countCertificationCases(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getCertificationCaseById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      return item;
    }),
  }),

  // ===== ISO 與低碳認證顧問案件管理 =====
  certificationConsultant: router({
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getCertificationConsultantsByUserId(ctx.user.id);
    }),

    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
    })).query(async ({ ctx, input }) => {
      if (ctx.user.isAdmin) {
        return db.listCertificationCasesAdmin({ status: input.status });
      }
      const consultants = await db.getCertificationConsultantsByUserId(ctx.user.id);
      const activeIds = consultants.filter(c => c.isActive).map(c => c.id);
      if (activeIds.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您不是 ISO 認證顧問" });
      }
      return db.listCertificationCasesForConsultant(activeIds, input.status);
    }),

    updateCaseStatus: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      nextStatus: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getCertificationCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getCertificationConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      if (!CERTIFICATION_STATUS_TRANSITIONS[item.status]?.includes(input.nextStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `目前狀態「${item.status}」不能推進至「${input.nextStatus}」` });
      }
      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };
      await db.updateCertificationCaseStatus(input.caseId, input.nextStatus, updatedBy);

      notifyFactoryMembers(item.factoryId, {
        eventType: `certification_status_${input.nextStatus}`,
        eventGroup: "certification",
        message: `「${item.companyNameSnapshot}」ISO 與低碳認證案件狀態更新：${CERTIFICATION_STATUS_LABELS[input.nextStatus] ?? input.nextStatus}`,
        actionUrl: "/certification-center",
        titleSnapshot: item.companyNameSnapshot,
        dedupeKey: `certification_status:${item.id}:${input.nextStatus}`,
      });
      return { success: true };
    }),

    updateCaseNotes: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      notes: z.string().max(5000),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getCertificationCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getCertificationConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      await db.updateCertificationCaseNotes(input.caseId, input.notes || null, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    adminAssignConsultant: adminProcedure.input(z.object({
      caseId: z.number().int().positive(),
      consultantId: z.number().int().positive().nullable(),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getCertificationCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (input.consultantId != null) {
        const consultant = await db.getCertificationConsultantById(input.consultantId);
        if (!consultant) throw new TRPCError({ code: "NOT_FOUND", message: "找不到顧問" });
        if (!consultant.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問目前已停用，無法指派承辦" });
        if (consultant.userId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問尚未綁定使用者帳號，無法指派承辦" });
      }
      try {
        await db.adminAssignCertificationConsultant(input.caseId, input.consultantId, { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "指派失敗" });
      }
      return { success: true };
    }),

    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllCertificationConsultants();
    }),

    adminCreateConsultant: adminProcedure.input(z.object({
      name: z.string().min(1).max(100),
      serviceAreas: z.array(z.string().max(50)).max(20).default([]),
    })).mutation(async ({ input }) => {
      const id = await db.adminCreateCertificationConsultant(input.name, input.serviceAreas);
      return { success: true, id };
    }),

    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ ctx, input }) => {
      let reassignedCases: Awaited<ReturnType<typeof db.adminBindCertificationConsultantUser>>["reassignedCases"] = [];
      try {
        const result = await db.adminBindCertificationConsultantUser(
          input.consultantId,
          input.userId,
          { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
        );
        reassignedCases = result.reassignedCases;
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "綁定失敗" });
      }
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "certification_cases_unassigned_cascade",
          eventGroup: "certification",
          message: `解除 ISO 認證顧問綁定後，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/certification-consultant/cases",
          titleSnapshot: "ISO 認證顧問解除綁定",
          dedupeKey: `certification_cascade_unbind:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),

    adminSetActive: adminProcedure.input(z.object({
      consultantId: z.number(),
      isActive: z.boolean(),
    })).mutation(async ({ ctx, input }) => {
      const { reassignedCases } = await db.adminSetCertificationConsultantActive(
        input.consultantId,
        input.isActive,
        { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
      );
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "certification_cases_unassigned_cascade",
          eventGroup: "certification",
          message: `ISO 認證顧問已停用，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/certification-consultant/cases",
          titleSnapshot: "ISO 認證顧問停用",
          dedupeKey: `certification_cascade_deactivate:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),
  }),

  // ===== ERP 與產線優化專區 =====
  // 隱藏預覽頁 /erp-optimization 專用 API，與其他服務完全獨立的資料模型與權限。
  erpOptimization: router({
    submitApplication: protectedProcedure.input(z.object({
      factoryId: z.number().int().positive(),
      contactName: z.string().min(1).max(100),
      phone: z.string().min(7).max(30).regex(/^[\d\-+() ]{7,20}$/, "電話格式不正確"),
      contactTime: z.string().min(1).max(100),
      needType: z.enum(ERP_NEED_TYPE_KEYS),
      additionalNotes: z.string().max(2000).optional(),
      consentAgreed: z.literal(true),
    })).mutation(async ({ input, ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const isOwner = owned?.id === input.factoryId;
      const coManagedFactory = coManaged.find(f => f.factoryId === input.factoryId);
      const isCoManaged = !!coManagedFactory;
      if (!isOwner && !isCoManaged) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無法代表此工廠送出申請" });
      }
      const factory = isOwner ? owned : await db.getFactoryById(input.factoryId);
      if (!factory || factory.status !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "工廠通過審核後才能申請 ERP 與產線優化服務" });
      }

      if (await db.hasOpenErpCase(input.factoryId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的 ERP 與產線優化案件，請至 ERP 專區查看目前進度" });
      }

      let id: number;
      let consultant: Awaited<ReturnType<typeof db.createErpCaseWithAutoAssign>>["assignedConsultant"];
      try {
        const result = await db.createErpCaseWithAutoAssign({
          factoryId: input.factoryId,
          companyNameSnapshot: factory.name,
          companyAddressSnapshot: factory.address,
          contactName: input.contactName,
          phone: input.phone,
          contactTime: input.contactTime,
          needType: input.needType,
          additionalNotes: input.additionalNotes || null,
          consentAgreed: true,
          statusTimeline: { new: new Date().toISOString() },
        });
        id = result.id;
        consultant = result.assignedConsultant;
      } catch (err: unknown) {
        if (extractMysqlErrorCode(err) === "ER_DUP_ENTRY") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "此工廠已有進行中的 ERP 與產線優化案件，請至 ERP 專區查看目前進度" });
        }
        throw err;
      }

      notifyUser(ctx.user.id, {
        eventType: "erp_application_submitted",
        eventGroup: "erp",
        message: `「${factory.name}」的 ERP 與產線優化免費初步諮詢申請已送出`,
        actionUrl: "/erp-optimization",
        titleSnapshot: factory.name,
        dedupeKey: `erp_submitted:${id}`,
      });

      if (consultant?.userId) {
        notifyUser(consultant.userId, {
          eventType: "erp_new_case",
          eventGroup: "erp",
          message: `新 ERP 與產線優化案件「${factory.name}」已分派給您，請儘速查收`,
          actionUrl: "/erp-consultant/cases",
          titleSnapshot: factory.name,
          dedupeKey: `erp_new_case:${id}`,
        });
      } else {
        notifyAdmins({
          eventType: "erp_unassigned",
          eventGroup: "erp",
          message: `新 ERP 與產線優化申請「${factory.name}」尚未指派顧問，請手動分派`,
          actionUrl: "/erp-consultant/cases",
          titleSnapshot: factory.name,
          dedupeKey: `erp_unassigned:${id}`,
        });
      }

      return { success: true, id };
    }),

    myApplicationProgress: protectedProcedure.query(async ({ ctx }) => {
      const [owned, coManaged] = await Promise.all([
        db.getFactoryByOwnerId(ctx.user.id),
        db.getCoManagedFactories(ctx.user.id),
      ]);
      const factoryIds: number[] = [];
      if (owned?.id) factoryIds.push(owned.id);
      for (const f of coManaged) {
        if (!factoryIds.includes(f.factoryId)) factoryIds.push(f.factoryId);
      }
      if (factoryIds.length === 0) return { hasFactory: false, applications: [] };
      const applications = await db.getErpCasesByFactoryIds(factoryIds);
      const sanitized = applications.map((a) => ({
        id: a.id,
        factoryId: a.factoryId,
        companyNameSnapshot: a.companyNameSnapshot,
        companyAddressSnapshot: a.companyAddressSnapshot,
        contactName: a.contactName,
        phone: a.phone,
        contactTime: a.contactTime,
        needType: a.needType,
        additionalNotes: a.additionalNotes,
        consentAgreed: a.consentAgreed,
        status: a.status,
        statusTimeline: a.statusTimeline,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));
      return { hasFactory: true, applications: sanitized };
    }),

    adminList: adminProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    })).query(async ({ input }) => {
      const [items, total] = await Promise.all([
        db.listErpCasesAdmin({ status: input.status, limit: input.limit, offset: input.offset }),
        db.countErpCases(input.status),
      ]);
      return { items, total };
    }),

    adminGet: adminProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const item = await db.getErpCaseById(input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      return item;
    }),
  }),

  // ===== ERP 顧問案件管理 =====
  erpConsultant: router({
    myProfiles: protectedProcedure.query(async ({ ctx }) => {
      return db.getErpConsultantsByUserId(ctx.user.id);
    }),

    myCases: protectedProcedure.input(z.object({
      status: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]).optional(),
    })).query(async ({ ctx, input }) => {
      if (ctx.user.isAdmin) {
        return db.listErpCasesAdmin({ status: input.status });
      }
      const consultants = await db.getErpConsultantsByUserId(ctx.user.id);
      const activeIds = consultants.filter(c => c.isActive).map(c => c.id);
      if (activeIds.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您不是 ERP 顧問" });
      }
      return db.listErpCasesForConsultant(activeIds, input.status);
    }),

    updateCaseStatus: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      nextStatus: z.enum(["new", "evaluating", "proposal", "in_progress", "completed", "deferred", "no_interest", "archived", "unassigned"]),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getErpCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getErpConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      if (!ERP_STATUS_TRANSITIONS[item.status]?.includes(input.nextStatus)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `目前狀態「${item.status}」不能推進至「${input.nextStatus}」` });
      }
      const updatedBy = { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) };
      await db.updateErpCaseStatus(input.caseId, input.nextStatus, updatedBy);

      notifyFactoryMembers(item.factoryId, {
        eventType: `erp_status_${input.nextStatus}`,
        eventGroup: "erp",
        message: `「${item.companyNameSnapshot}」ERP 與產線優化案件狀態更新：${ERP_STATUS_LABELS[input.nextStatus] ?? input.nextStatus}`,
        actionUrl: "/erp-optimization",
        titleSnapshot: item.companyNameSnapshot,
        dedupeKey: `erp_status:${item.id}:${input.nextStatus}`,
      });
      return { success: true };
    }),

    updateCaseNotes: protectedProcedure.input(z.object({
      caseId: z.number().int().positive(),
      notes: z.string().max(5000),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getErpCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (!ctx.user.isAdmin) {
        const consultants = await db.getErpConsultantsByUserId(ctx.user.id);
        const isAssignedToMe = consultants.some(c => c.isActive && c.id === item.assignedConsultantId);
        if (!isAssignedToMe) {
          throw new TRPCError({ code: "FORBIDDEN", message: "您不是此案件的承辦顧問" });
        }
      }
      await db.updateErpCaseNotes(input.caseId, input.notes || null, { userId: ctx.user.id, name: db.resolveActorNameSnapshot(ctx.user) });
      return { success: true };
    }),

    adminAssignConsultant: adminProcedure.input(z.object({
      caseId: z.number().int().positive(),
      consultantId: z.number().int().positive().nullable(),
    })).mutation(async ({ ctx, input }) => {
      const item = await db.getErpCaseById(input.caseId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "找不到案件" });
      if (input.consultantId != null) {
        const consultant = await db.getErpConsultantById(input.consultantId);
        if (!consultant) throw new TRPCError({ code: "NOT_FOUND", message: "找不到顧問" });
        if (!consultant.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問目前已停用，無法指派承辦" });
        if (consultant.userId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "此顧問尚未綁定使用者帳號，無法指派承辦" });
      }
      try {
        await db.adminAssignErpConsultant(input.caseId, input.consultantId, { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) });
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "指派失敗" });
      }
      return { success: true };
    }),

    adminListConsultants: adminProcedure.query(async () => {
      return db.listAllErpConsultants();
    }),

    adminCreateConsultant: adminProcedure.input(z.object({
      name: z.string().min(1).max(100),
      serviceAreas: z.array(z.enum(ERP_NEED_TYPE_KEYS)).max(4).default([]),
    })).mutation(async ({ input }) => {
      const id = await db.adminCreateErpConsultant(input.name, input.serviceAreas);
      return { success: true, id };
    }),

    adminBindUser: adminProcedure.input(z.object({
      consultantId: z.number(),
      userId: z.number().nullable(),
    })).mutation(async ({ ctx, input }) => {
      let reassignedCases: Awaited<ReturnType<typeof db.adminBindErpConsultantUser>>["reassignedCases"] = [];
      try {
        const result = await db.adminBindErpConsultantUser(
          input.consultantId,
          input.userId,
          { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
        );
        reassignedCases = result.reassignedCases;
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "綁定失敗" });
      }
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "erp_cases_unassigned_cascade",
          eventGroup: "erp",
          message: `解除 ERP 顧問綁定後，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/erp-consultant/cases",
          titleSnapshot: "ERP 顧問解除綁定",
          dedupeKey: `erp_cascade_unbind:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),

    adminSetActive: adminProcedure.input(z.object({
      consultantId: z.number(),
      isActive: z.boolean(),
    })).mutation(async ({ ctx, input }) => {
      const { reassignedCases } = await db.adminSetErpConsultantActive(
        input.consultantId,
        input.isActive,
        { userId: ctx.user!.id, name: db.resolveActorNameSnapshot(ctx.user!) },
      );
      if (reassignedCases.length > 0) {
        notifyAdmins({
          eventType: "erp_cases_unassigned_cascade",
          eventGroup: "erp",
          message: `ERP 顧問已停用，${reassignedCases.length} 筆案件已安全改為未指派，請重新分派`,
          actionUrl: "/erp-consultant/cases",
          titleSnapshot: "ERP 顧問停用",
          dedupeKey: `erp_cascade_deactivate:${input.consultantId}:${Date.now()}`,
        });
      }
      return { success: true };
    }),
  }),

});

export type AppRouter = typeof appRouter;
