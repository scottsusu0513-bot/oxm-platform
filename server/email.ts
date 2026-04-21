import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'OXM平台 <noreply@yourdomain.com>';

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