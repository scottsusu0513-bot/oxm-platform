import { Resend } from 'resend';
import { renderAnnouncementEmailHtml } from './announcementMarkdown';
import { ENV } from './_core/env';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.FROM_EMAIL ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// 懶載入，沒有 API Key 就不初始化
const getResend = () => {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
};

/**
 * 三層寄信安全規則（見對話中「一、Email：Vitest 防護正確，但 dev browser
 * 仍然不安全」）：
 * - test（Vitest）：一律禁止真實寄信，不管 .env 裡是否真的有 RESEND_API_KEY。
 *   process.env.VITEST 是 Vitest 執行期間自動設定的旗標，不需要每個測試檔案
 *   自己記得 mock server/email.ts。
 * - production（NODE_ENV=production，沿用既有 ENV.isProduction，見
 *   server/_core/env.ts、package.json 的 `start` script）：只要有
 *   RESEND_API_KEY 就正常寄，維持既有正式環境行為不變。
 * - development（`pnpm dev`，NODE_ENV=development，本機手動用瀏覽器測試）：
 *   預設也禁止真實寄信——即使 .env 裡剛好留著一組真實可用的 RESEND_API_KEY
 *   （例如同一把 key 給正式環境與本機共用），本機開發環境不能因為這樣就
 *   自動真的寄出付費信件。只有明確在 .env 加上 ALLOW_DEV_EMAIL=true 這個
 *   opt-in 旗標，才會在本機開發環境真的寄信（例如真的要驗收信件內容/版型
 *   時才手動打開，平常應該保持關閉）。
 */
// 見對話中「Email Safety Regression」：對外 export 只是為了讓
// server/email.test.ts 能直接對這個純函式做隔離單元測試（見那裡的
// CASE E1～E5），不改變任何行為——三層規則本身仍然只在這個檔案內部生效，
// 呼叫端（所有 sendXxxEmail）一律透過 isEmailEnabled()，不會有第二套邏輯。
export function getEmailDisabledReason(): string | null {
  if (!RESEND_API_KEY) return '未設定 RESEND_API_KEY';
  if (process.env.VITEST) return '自動化測試（Vitest）環境已停用外部寄信';
  if (!ENV.isProduction && process.env.ALLOW_DEV_EMAIL !== 'true') {
    return '開發環境預設停用外部寄信（如需在本機測試真實寄信，請在 .env 設定 ALLOW_DEV_EMAIL=true）';
  }
  return null;
}

const isEmailEnabled = () => getEmailDisabledReason() === null;

// ===== 寄信給工廠：收到新詢問 =====
export async function sendNewInquiryEmail(params: {
  factoryName: string;
  factoryEmail: string;
  userName: string;
  productName?: string;
  message: string;
  inquiryType?: "normal" | "batch";
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  const isBatch = params.inquiryType === "batch";
  const subject = isBatch
    ? `【OXM】您在 OXM 收到一則一鍵詢價`
    : `【OXM】您有一則新的客戶詢問`;
  const batchBadge = isBatch
    ? `<p style="background: #eef2ff; color: #4f46e5; padding: 8px 12px; border-radius: 6px; display: inline-block; font-size: 13px; margin: 0 0 12px;">此為 OXM 一鍵詢價功能送出的詢問，買家同時聯繫了多間工廠</p>`
    : '';

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.factoryEmail,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">${isBatch ? '您收到一則一鍵詢價' : '您有一則新的客戶詢問'}</h2>
          <p>親愛的 <strong>${params.factoryName}</strong> 您好，</p>
          ${batchBadge}
          <p>您在 OXM 平台收到一則來自 <strong>${params.userName}</strong> 的詢問訊息。</p>
          ${params.productName ? `<p>詢問產品：<strong>${params.productName}</strong></p>` : ''}
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;">${params.message}</p>
          </div>
          <p>請登入 OXM 平台查看並回覆：</p>
          <a href="${process.env.VITE_APP_URL ?? 'http://localhost:3000'}/messages"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看訊息
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送新詢問通知給 ${params.factoryEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給工廠：審核退回 =====
export async function sendFactoryRejectedEmail(params: {
  factoryName: string;
  factoryEmail: string;
  reason?: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.factoryEmail,
      subject: `【OXM】您的工廠審核未通過`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您的工廠審核未通過</h2>
          <p>親愛的 <strong>${params.factoryName}</strong> 您好，</p>
          <p>感謝您在 OXM 平台送出工廠審核申請，經審核後目前您的工廠資料尚未通過審核。</p>
          ${params.reason ? `
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">退回原因：</p>
            <p style="margin: 8px 0 0;">${params.reason}</p>
          </div>` : ''}
          <p>請登入 OXM 平台修改工廠資料，修改完成後可重新送出審核。</p>
          <a href="${process.env.VITE_APP_URL ?? 'http://localhost:3000'}/dashboard"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往修改工廠資料
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送審核退回通知給 ${params.factoryEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給工廠：審核通過 =====
export async function sendFactoryApprovedEmail(params: {
  factoryName: string;
  factoryEmail: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.factoryEmail,
      subject: `【OXM】您的工廠已通過審核`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">恭喜！您的工廠已通過審核</h2>
          <p>親愛的 <strong>${params.factoryName}</strong> 您好，</p>
          <p>您的工廠已通過 OXM 平台審核，即日起買家可以在搜尋頁找到您！</p>
          <a href="${process.env.VITE_APP_URL ?? 'http://localhost:3000'}/dashboard"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往工廠後台
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送審核通過通知給 ${params.factoryEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給管理員：有工廠送出審核 =====
export async function sendFactorySubmittedEmail(params: {
  factoryName: string;
  factoryId: number;
  ownerName: string;
  ownerEmail?: string | null;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL is not set, skipping admin notification');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【OXM】新工廠待審核：${params.factoryName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">有新工廠送出審核申請</h2>
          <p>工廠名稱：<strong>${params.factoryName}</strong></p>
          <p>負責人：<strong>${params.ownerName}</strong>${params.ownerEmail ? `（${params.ownerEmail}）` : ''}</p>
          <a href="${appUrl}/admin/factories/${params.factoryId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往審核
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送工廠送審通知給管理員`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給管理員：有人檢舉工廠 =====
export async function sendReportEmail(params: {
  reporterName: string;
  factoryName: string;
  factoryId: number;
  reason: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL is not set, skipping admin notification');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【OXM】收到工廠檢舉：${params.factoryName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">收到新的工廠檢舉</h2>
          <p>檢舉者：<strong>${params.reporterName}</strong></p>
          <p>被檢舉工廠：<strong>${params.factoryName}</strong></p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">檢舉原因：</p>
            <p style="margin: 8px 0 0;">${params.reason}</p>
          </div>
          <a href="${appUrl}/admin/factories/${params.factoryId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看工廠
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送工廠檢舉通知給管理員`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給管理員：有人聯繫客服 =====
export async function sendSupportTicketEmail(params: {
  userName: string;
  userEmail?: string | null;
  type: string;
  subject: string;
  description: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL is not set, skipping admin notification');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【OXM】客服投訴：${params.subject}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">收到新的客服投訴</h2>
          <p>提交者：<strong>${params.userName}</strong>${params.userEmail ? `（${params.userEmail}）` : ''}</p>
          <p>問題類型：<strong>${params.type}</strong></p>
          <p>主旨：<strong>${params.subject}</strong></p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">詳細描述：</p>
            <p style="margin: 8px 0 0;">${params.description}</p>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送客服投訴通知給管理員`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給使用者：工廠回覆了你的評價 =====
export async function sendReviewReplyEmail(params: {
  userEmail: string;
  userName: string;
  factoryName: string;
  originalComment: string;
  replyContent: string;
  factoryId: number;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.userEmail,
      subject: `【OXM】${params.factoryName} 回覆了您的評價`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">${params.factoryName} 回覆了您的評價</h2>
          <p>親愛的 <strong>${params.userName}</strong> 您好，</p>
          <p>您對 <strong>${params.factoryName}</strong> 的評價已收到工廠回覆。</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-size: 12px; color: #666;">您的評價</p>
            <p style="margin: 8px 0 0;">${params.originalComment}</p>
          </div>
          <div style="background: #fff7ed; border-left: 4px solid #f97316; padding: 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
            <p style="margin: 0; font-size: 12px; color: #666;">工廠回覆</p>
            <p style="margin: 8px 0 0;">${params.replyContent}</p>
          </div>
          <a href="${appUrl}/factory/${params.factoryId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送評價回覆通知給 ${params.userEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給使用者：詢價有新訊息（工廠回覆） =====
export async function sendNewMessageNotificationEmail(params: {
  userEmail: string;
  userName: string;
  factoryName: string;
  messagePreview: string;
  conversationId: number;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.userEmail,
      subject: `【OXM】${params.factoryName} 回覆了您的詢問`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">${params.factoryName} 回覆了您的詢問</h2>
          <p>親愛的 <strong>${params.userName}</strong> 您好，</p>
          <p>您在 OXM 平台的詢問收到了來自 <strong>${params.factoryName}</strong> 的回覆。</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;">${params.messagePreview}</p>
          </div>
          <a href="${appUrl}/messages/${params.conversationId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看訊息
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送新訊息通知給 ${params.userEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending: '已寄出',
  received: '已收到',
  reviewing: '審查中',
  processing: '處理中',
  resolved: '已處理',
};

// ===== 寄信給使用者：檢舉狀態更新 =====
export async function sendReportStatusUpdateEmail(params: {
  userEmail: string;
  userName: string;
  factoryName: string;
  status: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    const statusLabel = REPORT_STATUS_LABELS[params.status] ?? params.status;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.userEmail,
      subject: `【OXM】您的檢舉案件狀態已更新：${statusLabel}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您的檢舉案件狀態已更新</h2>
          <p>親愛的 <strong>${params.userName}</strong> 您好，</p>
          <p>您對 <strong>${params.factoryName}</strong> 的檢舉案件狀態已更新為：</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center;">
            <strong style="font-size: 18px; color: #f97316;">${statusLabel}</strong>
          </div>
          <a href="${appUrl}/member#reports"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看檢舉狀態
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送檢舉狀態更新通知給 ${params.userEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給使用者：客服投訴狀態更新 =====
export async function sendTicketStatusUpdateEmail(params: {
  userEmail: string;
  userName: string;
  subject: string;
  status: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    const statusLabel = REPORT_STATUS_LABELS[params.status] ?? params.status;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.userEmail,
      subject: `【OXM】您的客服投訴狀態已更新：${statusLabel}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您的客服投訴狀態已更新</h2>
          <p>親愛的 <strong>${params.userName}</strong> 您好，</p>
          <p>您提交的客服投訴「<strong>${params.subject}</strong>」狀態已更新為：</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center;">
            <strong style="font-size: 18px; color: #f97316;">${statusLabel}</strong>
          </div>
          <a href="${appUrl}/member#support"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看投訴狀態
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送客服投訴狀態更新通知給 ${params.userEmail}`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄信給管理員：使用者回覆了站內信 =====
export async function sendMessageReplyNotificationEmail(params: {
  userName: string;
  userEmail?: string;
  campaignTitle: string;
  replyContent: string;
  campaignId: number;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL is not set, skipping admin notification');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【OXM】站內信回覆：${params.campaignTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">使用者回覆了站內信</h2>
          <p>站內信主題：<strong>${params.campaignTitle}</strong></p>
          <p>回覆者：<strong>${params.userName}</strong>${params.userEmail ? `（${params.userEmail}）` : ''}</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">回覆內容：</p>
            <p style="margin: 8px 0 0;">${params.replyContent}</p>
          </div>
          <a href="${appUrl}/admin?tab=messages&campaignId=${params.campaignId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看對話
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送站內信回覆通知給管理員`);
  } catch (error) {
    console.error('[Email] 寄信失敗:', error);
  }
}

// ===== 寄送站內信廣播 Email =====
export async function sendAdminBroadcastEmail(params: {
  toEmail: string;
  toName: string | null;
  campaignTitle: string;
  campaignContent: string;
  campaignId: number;
}) {
  if (!isEmailEnabled()) throw new Error(`[Email] ${getEmailDisabledReason()}，無法寄送站內信廣播信`);
  if (!FROM_EMAIL) throw new Error('[Email] 未設定 FROM_EMAIL，無法寄送 Email');
  const resend = getResend()!;
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.toEmail,
      subject: `【OXM 站內信】${params.campaignTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您有一封來自 OXM 平台的站內信</h2>
          <p>親愛的 ${params.toName ?? '用戶'}，您好：</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; white-space: pre-wrap;">
            ${params.campaignContent.replace(/\n/g, '<br>')}
          </div>
          <a href="${appUrl}/messages?campaignId=${params.campaignId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往查看站內信
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆此信件，如需回覆請至平台站內信功能。</p>
        </div>
      `,
    });
  } catch (error) {
    // Re-throw so the caller (routers.ts) can log and count failures
    throw error;
  }
}

// ===== 寄送 Email 驗證信 =====
export async function sendEmailVerificationEmail(params: {
  toEmail: string;
  userName: string | null;
  verifyUrl: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄送驗證信`);
    return;
  }
  const resend = getResend();
  if (!resend) return;
  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.toEmail,
    subject: `【OXM】請驗證您的電子郵件地址`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f97316;">驗證您的電子郵件</h2>
        <p>親愛的 ${params.userName ? `<strong>${params.userName}</strong>` : '用戶'} 您好，</p>
        <p>感謝您使用 OXM 製造業媒合平台。請點擊下方按鈕驗證您的電子郵件地址：</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${params.verifyUrl}"
             style="background: #f97316; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold;">
            驗證電子郵件
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">此連結將在 24 小時後失效。若您未申請驗證，請忽略此信。</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">OXM 製造業媒合平台 | <a href="https://www.oxmmatch.com">www.oxmmatch.com</a></p>
      </div>
    `,
  });
  console.log('[Email] 已寄送驗證信到:', params.toEmail);
}

// ===== 工廠基本資料修改申請 Email =====

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendRevisionSubmittedEmail(params: {
  factoryName: string;
  factoryId: number;
  submitterName: string | null;
  revisionReason?: string | null;
}) {
  if (!isEmailEnabled() || !ADMIN_EMAIL) return;
  const resend = getResend();
  if (!resend) return;
  const adminUrl = `${process.env.OAUTH_SERVER_URL || 'https://www.oxmmatch.com'}/admin`;
  const safeName = escapeHtml(params.factoryName);
  const safeSubmitter = escapeHtml(params.submitterName ?? '未知');
  const safeReason = params.revisionReason ? escapeHtml(params.revisionReason) : null;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【OXM 後台】工廠「${params.factoryName}」提交基本資料修改申請`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">工廠基本資料修改申請</h2>
          <p>工廠「<strong>${safeName}</strong>」（ID: ${params.factoryId}）的管理者 <strong>${safeSubmitter}</strong> 提交了一筆基本資料修改申請。</p>
          ${safeReason ? `<p>申請原因：${safeReason}</p>` : ''}
          <div style="text-align: center; margin: 32px 0;">
            <a href="${adminUrl}" style="background: #f97316; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">前往後台審核</a>
          </div>
          <p style="color: #999; font-size: 12px;">OXM 製造業媒合平台</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] sendRevisionSubmittedEmail failed:', err);
  }
}

// recipientName: the individual recipient's display name (owner or co-manager)
export async function sendRevisionApprovedEmail(params: {
  factoryName: string;
  factoryEmail: string | null;
  recipientName: string | null;
}) {
  if (!isEmailEnabled() || !params.factoryEmail) return;
  const resend = getResend();
  if (!resend) return;
  const safeName = escapeHtml(params.factoryName);
  const safeRecipient = escapeHtml(params.recipientName ?? params.factoryName);
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.factoryEmail,
      subject: `【OXM】您的工廠資料修改申請已通過`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #16a34a;">資料修改申請通過</h2>
          <p>親愛的 <strong>${safeRecipient}</strong> 您好，</p>
          <p>您為工廠「<strong>${safeName}</strong>」提交的基本資料修改申請已通過審核，最新資料已正式更新至公開頁面。</p>
          <p>感謝您維護正確的工廠資訊！</p>
          <p style="color: #999; font-size: 12px;">OXM 製造業媒合平台 | <a href="https://www.oxmmatch.com">www.oxmmatch.com</a></p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] sendRevisionApprovedEmail failed:', err);
  }
}

// recipientName: the individual recipient's display name (owner or co-manager)
export async function sendRevisionRejectedEmail(params: {
  factoryName: string;
  factoryEmail: string | null;
  recipientName: string | null;
  reason: string;
}) {
  if (!isEmailEnabled() || !params.factoryEmail) return;
  const resend = getResend();
  if (!resend) return;
  const safeName = escapeHtml(params.factoryName);
  const safeRecipient = escapeHtml(params.recipientName ?? params.factoryName);
  const safeReason = escapeHtml(params.reason);
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.factoryEmail,
      subject: `【OXM】您的工廠資料修改申請未通過`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">資料修改申請未通過</h2>
          <p>親愛的 <strong>${safeRecipient}</strong> 您好，</p>
          <p>您為工廠「<strong>${safeName}</strong>」提交的基本資料修改申請未通過審核。</p>
          <p>退回原因：<strong>${safeReason}</strong></p>
          <p>您可以修改後重新提交。如有疑問請聯繫客服。</p>
          <p style="color: #999; font-size: 12px;">OXM 製造業媒合平台 | <a href="https://www.oxmmatch.com">www.oxmmatch.com</a></p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] sendRevisionRejectedEmail failed:', err);
  }
}

// ===== 企業升級中心：通知顧問有新案件 =====

const CAPITAL_AMOUNT_LABELS: Record<string, string> = {
  under_500w: "500 萬以下",
  "500w_1000w": "500 萬～1,000 萬",
  "1000w_5000w": "1,000 萬～5,000 萬",
  "5000w_1y": "5,000 萬～1 億",
  over_1y: "1 億以上",
};

export async function sendUpgradeNewCaseConsultantEmail(params: {
  consultantName: string;
  consultantEmail: string;
  companyName: string;
  location: string;
  contactName: string;
  email: string;
  phone: string;
  capitalAmount: string;
  applicationId: number;
  appliedAt: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過顧問新案通知`);
    return;
  }
  const resend = getResend();
  if (!resend) return;
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  const capitalLabel = CAPITAL_AMOUNT_LABELS[params.capitalAmount] ?? params.capitalAmount;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.consultantEmail,
      subject: `OXM 企業升級中心｜您有新的案件待查收`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您有一筆新的企業升級案件待查收</h2>
          <p>親愛的 <strong>${params.consultantName}</strong> 您好，</p>
          <p>您有一筆新的企業升級案件待查收，請登入 OXM 顧問中心查看案件內容並進行後續評估。</p>
          <table style="border-collapse:collapse; width:100%; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">公司名稱</td><td style="padding:8px;">${params.companyName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">所在地區</td><td style="padding:8px;">${params.location}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">聯絡人</td><td style="padding:8px;">${params.contactName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">聯絡 Email</td><td style="padding:8px;">${params.email}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">聯絡電話</td><td style="padding:8px;">${params.phone}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">資本額</td><td style="padding:8px;">${capitalLabel}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">申請時間</td><td style="padding:8px;">${params.appliedAt}</td></tr>
          </table>
          <a href="${appUrl}/upgrade-consultant/cases"
            style="background:#f97316;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
            前往顧問中心查收
          </a>
          <p style="color:#999;font-size:12px;margin-top:24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送新案件通知給顧問 ${params.consultantEmail}`);
  } catch (err) {
    console.warn('[Email] sendUpgradeNewCaseConsultantEmail failed:', err);
  }
}

// ===== 企業升級中心：通知管理員有新申請 =====
export async function sendUpgradeApplicationEmail(params: {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  location: string;
  applicationId: number;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過升級中心通知信`);
    return;
  }
  const resend = getResend();
  if (!resend) return;

  const adminEmail = ADMIN_EMAIL ?? FROM_EMAIL;
  if (!adminEmail) return;

  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: adminEmail,
      subject: `【OXM 企業升級中心】新申請 #${params.applicationId}：${params.companyName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">企業升級中心 — 新申請</h2>
          <p>有一筆新的企業升級評估申請待審核。</p>
          <table style="border-collapse:collapse; width:100%; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">公司名稱</td><td style="padding:8px;">${params.companyName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">聯絡人</td><td style="padding:8px;">${params.contactName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">電話</td><td style="padding:8px;">${params.phone}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">Email</td><td style="padding:8px;">${params.email}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">所在地</td><td style="padding:8px;">${params.location}</td></tr>
          </table>
          <a href="${appUrl}/admin/upgrade-applications"
            style="background:#f97316;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
            前往後台查看
          </a>
          <p style="color:#999;font-size:12px;margin-top:24px;">此信件由 OXM 平台自動發送</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('[Email] sendUpgradeApplicationEmail failed:', err);
  }
}

// ===== 寄送平台公告 Email =====
export async function sendPlatformAnnouncementEmail(params: {
  toEmail: string;
  toName: string | null;
  announcementTitle: string;
  announcementContent: string;
}) {
  if (!isEmailEnabled()) throw new Error(`[Email] ${getEmailDisabledReason()}，無法寄送平台公告信`);
  if (!FROM_EMAIL) throw new Error('[Email] 未設定 FROM_EMAIL，無法寄送 Email');
  const resend = getResend()!;
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  const safeTitle = escapeHtml(params.announcementTitle);
  const safeToName = escapeHtml(params.toName ?? '用戶');
  const contentHtml = renderAnnouncementEmailHtml(params.announcementContent);
  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.toEmail,
    subject: `【OXM 平台公告】${params.announcementTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f97316;">OXM 平台公告</h2>
        <p>親愛的 ${safeToName}，您好：</p>
        <h3 style="color: #1f2937; margin: 16px 0 8px;">${safeTitle}</h3>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          ${contentHtml}
        </div>
        <a href="${appUrl}/announcements"
          style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; margin-top: 8px;">
          前往查看平台公告
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          此信件由 OXM 平台自動發送，請勿直接回覆。<br>
          如不希望收到此類通知，可至 <a href="${appUrl}/member" style="color: #f97316;">會員中心 → 通知設定</a> 關閉「平台公告」Email 通知。
        </p>
      </div>
    `,
  });
}

// ===== 找消息（產業情報／News）Email =====
// 結構刻意與 sendPlatformAnnouncementEmail 一致（品牌識別、標題、CTA 按鈕、
// 退訂資訊），只是 CTA 導向該篇消息的 /news/:slug，並多帶一段摘要。不修改
// sendPlatformAnnouncementEmail 本身、不影響既有平台公告的寄送行為。
export async function sendNewsEmail(params: {
  toEmail: string;
  toName: string | null;
  newsTitle: string;
  newsSummary: string;
  newsSlug: string;
}) {
  if (!isEmailEnabled()) throw new Error(`[Email] ${getEmailDisabledReason()}，無法寄送找消息通知信`);
  if (!FROM_EMAIL) throw new Error('[Email] 未設定 FROM_EMAIL，無法寄送 Email');
  const resend = getResend()!;
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  const safeTitle = escapeHtml(params.newsTitle);
  const safeSummary = escapeHtml(params.newsSummary);
  const safeToName = escapeHtml(params.toName ?? '用戶');
  const articleUrl = `${appUrl}/news/${params.newsSlug}`;
  await resend.emails.send({
    from: FROM_EMAIL,
    to: params.toEmail,
    subject: `【OXM 產業情報中心】${params.newsTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f97316;">OXM 產業情報中心</h2>
        <p>親愛的 ${safeToName}，您好：</p>
        <h3 style="color: #1f2937; margin: 16px 0 8px;">${safeTitle}</h3>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; color: #4b5563;">
          ${safeSummary}
        </div>
        <a href="${articleUrl}"
          style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; margin-top: 8px;">
          查看完整內容
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          此信件由 OXM 平台自動發送，請勿直接回覆。<br>
          如不希望收到此類通知，可至 <a href="${appUrl}/member" style="color: #f97316;">會員中心 → 通知設定</a> 關閉「產業情報中心」Email 通知。
        </p>
      </div>
    `,
  });
}

// ===== Phase 4C: 訂單日期節點逾期通知 =====
export async function sendOrderOverdueEmail(params: {
  to: string;
  recipientName: string | null | undefined;
  projectName: string;
  factoryName: string;
  dateLabel: string;
  dueDate: string;
  orderId: number;
  side: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過訂單逾期通知`);
    return;
  }
  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    const greeting = params.recipientName ? `親愛的 <strong>${params.recipientName}</strong> 您好，` : '您好，';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: `【OXM 訂單提醒】訂單日期已逾期：${params.projectName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">訂單日期節點已逾期</h2>
          <p>${greeting}</p>
          <p>您在 OXM 平台的合作訂單有一個日期節點已逾期，請盡快確認進度。</p>
          <table style="border-collapse:collapse; width:100%; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold; width:40%;">訂單名稱</td><td style="padding:8px;">${params.projectName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">供應工廠</td><td style="padding:8px;">${params.factoryName}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">逾期節點</td><td style="padding:8px; color:#dc2626; font-weight:bold;">${params.dateLabel}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">原定日期</td><td style="padding:8px; color:#dc2626;">${params.dueDate}</td></tr>
            <tr><td style="padding:8px; background:#f5f5f5; font-weight:bold;">您的角色</td><td style="padding:8px;">${params.side}</td></tr>
          </table>
          <p>請雙方盡快進入 OXM 訂單詳情確認進度，若有日期調整需求，供應工廠可透過訂單詳情提出日期修改申請。</p>
          <a href="${appUrl}/orders/${params.orderId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; margin-top: 8px;">
            前往查看訂單
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送訂單逾期通知 orderId=${params.orderId} field=${params.dateLabel} to=${params.to}`);
  } catch (error) {
    console.error('[Email] sendOrderOverdueEmail 失敗:', error);
    throw error; // re-throw so caller can track failures
  }
}

// ===== 首次聯繫通知（任一方向首次私訊接觸時寄出）=====
export async function sendFirstContactEmail(params: {
  toEmail: string;
  toName: string | null;
  conversationId: number;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過首次聯繫通知`);
    return;
  }
  try {
    const resend = getResend();
    if (!resend) return;
    const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.toEmail,
      subject: `【OXM】有新的使用者透過 OXM 聯繫你`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">有新的使用者透過 OXM 聯繫你</h2>
          <p>您好${params.toName ? `，<strong>${params.toName}</strong>` : ''}，</p>
          <p>您在 OXM 收到一位新使用者的聯繫。</p>
          <p>對方已透過平台向您發送訊息，這可能是新的詢價、合作需求或媒合機會。</p>
          <p>請回到 OXM 查看並回覆，避免錯過新的合作機會。</p>
          <a href="${appUrl}/messages/${params.conversationId}"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; margin-top: 8px;">
            前往查看訊息
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">
            此信件由 OXM 平台自動發送，請勿直接回覆。<br>
            如不希望收到此類通知，可至 <a href="${appUrl}/member" style="color: #f97316;">會員中心 → 通知設定</a> 關閉「詢價有新訊息」Email 通知。
          </p>
        </div>
      `,
    });
    console.log(`[Email] 首次聯繫通知已寄送至 ${params.toEmail}`);
  } catch (error) {
    console.error('[Email] sendFirstContactEmail 失敗:', error);
  }
}
// 產業新增需求：送出後給會員的確認信（回信給使用者，不含任何管理員內部備註）。
export async function sendIndustryRequestReceivedEmail(params: {
  userName: string;
  userEmail?: string | null;
  description: string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!params.userEmail) return;
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.userEmail,
      subject: '【OXM】已收到您的產業新增需求',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">已收到您的產業新增需求</h2>
          <p>您好${params.userName ? `，<strong>${escapeHtml(params.userName)}</strong>` : ''}，</p>
          <p>我們已收到您提出的產業新增需求，OXM 會進一步評估平台分類需求，後續有結果會再通知您。</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">您填寫的需求說明：</p>
            <p style="margin: 8px 0 0; white-space: pre-wrap;">${escapeHtml(params.description)}</p>
          </div>
          <a href="${appUrl}/"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; margin-top: 8px;">
            回到 OXM
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送，請勿直接回覆。</p>
        </div>
      `,
    });
    console.log(`[Email] 產業新增需求確認信已寄送至 ${params.userEmail}`);
  } catch (error) {
    console.error('[Email] sendIndustryRequestReceivedEmail 失敗:', error);
  }
}

// 產業新增需求：建案成功時寄給 OXM 平台管理端的案件通知（沿用工廠檢舉
// sendReportEmail / 客服投訴 sendSupportTicketEmail 同一套收件設定 ADMIN_EMAIL，
// 以及同一套 error 處理：內部 try/catch 吞掉錯誤、絕不 throw，寄信失敗不影響
// 案件建立）。信件為管理端案件通知，內容含需求 snapshot，但不含 adminNote /
// openId / OWNER_OPEN_ID 等內部識別資料。
export async function sendIndustryRequestAdminEmail(params: {
  requestId: number;
  userName: string;
  userEmail: string;
  userPhone?: string | null;
  description: string;
  createdAt: Date | string;
}) {
  if (!isEmailEnabled()) {
    console.log(`[Email] ${getEmailDisabledReason()}，跳過寄信`);
    return;
  }
  if (!ADMIN_EMAIL) {
    console.warn('[Email] ADMIN_EMAIL is not set, skipping admin notification');
    return;
  }
  const appUrl = process.env.VITE_APP_URL ?? 'http://localhost:3000';
  const submittedAt = new Date(params.createdAt).toLocaleString('zh-TW');
  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: '【OXM】收到新的產業新增需求',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">收到新的產業新增需求</h2>
          <p>案件 ID：<strong>#${params.requestId}</strong></p>
          <p>提出會員：<strong>${escapeHtml(params.userName)}</strong></p>
          <p>Email：<strong>${escapeHtml(params.userEmail)}</strong></p>
          ${params.userPhone ? `<p>電話：<strong>${escapeHtml(params.userPhone)}</strong></p>` : ''}
          <p>提出時間：${escapeHtml(submittedAt)}</p>
          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0; font-weight: bold;">需求說明：</p>
            <p style="margin: 8px 0 0; white-space: pre-wrap;">${escapeHtml(params.description)}</p>
          </div>
          <a href="${appUrl}/admin/support"
            style="background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            前往客服中心「產業要求」
          </a>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">此信件由 OXM 平台自動發送。</p>
        </div>
      `,
    });
    console.log(`[Email] 已寄送產業新增需求通知給管理員（#${params.requestId}）`);
  } catch (error) {
    console.error('[Email] sendIndustryRequestAdminEmail 失敗:', error);
  }
}
