import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'OXM平台 <noreply@yourdomain.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// 懶載入，沒有 API Key 就不初始化
const getResend = () => {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
};

const isEmailEnabled = () => !!RESEND_API_KEY;

// ===== 寄信給工廠：收到新詢問 =====
export async function sendNewInquiryEmail(params: {
  factoryName: string;
  factoryEmail: string;
  userName: string;
  productName?: string;
  message: string;
}) {
  if (!isEmailEnabled()) {
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: "scottsusu0513@gmail.com", // TODO: 測試用，之後要改回真實收件人（params.factoryEmail）
      subject: `【OXM】您有一則新的客戶詢問`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f97316;">您有一則新的客戶詢問</h2>
          <p>親愛的 <strong>${params.factoryName}</strong> 您好，</p>
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

// ===== 寄信給工廠：審核通過 =====
export async function sendFactoryApprovedEmail(params: {
  factoryName: string;
  factoryEmail: string;
}) {
  if (!isEmailEnabled()) {
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
    return;
  }

  try {
    const resend = getResend();
    if (!resend) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: "scottsusu0513@gmail.com", // TODO: 測試用，之後要改回真實收件人（params.factoryEmail）
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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
    console.log('[Email] 未設定 RESEND_API_KEY，跳過寄信');
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