import rateLimit from "express-rate-limit";

const createLimiter = (windowMs: number, max: number) => {
  return rateLimit({
    windowMs,
    max,
    message: "請求過於頻繁，請稍後再試",
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// 登入相關 API: 15 次/15 分鐘
export const loginLimiter = createLimiter(15 * 60 * 1000, 15);

// 管理員 API: 100 次/小時
export const adminLimiter = createLimiter(60 * 60 * 1000, 100);

// 工廠送審: 5 次/小時
export const submitReviewLimiter = createLimiter(60 * 60 * 1000, 5);

// 訊息/詢價: 20 次/小時
export const messageLimiter = createLimiter(60 * 60 * 1000, 20);

// 圖片上傳: 10 次/小時
export const uploadLimiter = createLimiter(60 * 60 * 1000, 10);

// 搜尋 API: 120 次/分鐘（防爬蟲）
export const searchLimiter = createLimiter(60 * 1000, 120);

// 檢舉: 5 次/小時（防濫用）
export const reportLimiter = createLimiter(60 * 60 * 1000, 5);

// 通用 API: 1000 次/小時
export const apiLimiter = createLimiter(60 * 60 * 1000, 1000);
