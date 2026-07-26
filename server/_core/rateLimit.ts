import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

// tRPC 的 httpBatchLink 一律把呼叫包成 { "0": {...}, "1": {...}, ... } 送出
// （即使實際上只有一筆呼叫也一樣），並預期回應是對應長度的 JSON 陣列。
// express-rate-limit 預設超過限制時是用 res.send(純文字字串) 回應，
// Content-Type 會落成 text/html，tRPC client 端對這個回應做 JSON.parse
// 會直接丟出 SyntaxError（"Unexpected token ... is not valid JSON"）——
// 「請求過於頻繁，請稍後再試」這句原本設計好的訊息因此永遠傳不到使用者眼前，
// 呼叫端只會看到一個無意義的 JSON parse 錯誤，被上層 catch 後顯示成通用的
// 「上傳失敗，請重試」，讓人誤以為是上傳功能本身壞掉，而非只是短暫超過流量限制。
// 例如認證徽章證明圖片上傳，一次完整填寫工廠資料的過程中通常最後才會用到，
// 前面上傳大頭貼／封面／照片／商品圖片已經用掉同一組 uploadLimiter 的額度，
// 導致最後這步最容易踩到上限、又因為上述 parse 錯誤看不出真正原因。
// 這裡改成自訂 handler，依 req.body 實際的 batch 筆數回傳等長的 tRPC 錯誤
// 陣列，client 端才能正確解析並顯示真正的錯誤訊息（而不是 parse crash）。
// 匯出供 rateLimit.test.ts 直接單元測試，不需要真的送滿整組請求配額。
export function getBatchSize(body: unknown): number {
  if (!body || typeof body !== "object") return 1;
  const keys = Object.keys(body as Record<string, unknown>).filter(k => /^\d+$/.test(k));
  return keys.length > 0 ? keys.length : 1;
}

export function rateLimitExceededHandler(message: string) {
  return (req: Request, res: Response) => {
    const size = getBatchSize(req.body);
    const errorItem = {
      error: {
        json: {
          message,
          code: -32029,
          data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
        },
      },
    };
    res.status(429).json(Array.from({ length: size }, () => errorItem));
  };
}

const createLimiter = (windowMs: number, max: number, message = "請求過於頻繁，請稍後再試") => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitExceededHandler(message),
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

// 搜尋 API: 30 次/分鐘（防爬蟲 + 保護 AI 搜尋成本）
export const searchLimiter = createLimiter(60 * 1000, 30);

// 檢舉: 5 次/小時（防濫用）
export const reportLimiter = createLimiter(60 * 60 * 1000, 5);

// 通用 API: 1000 次/小時
export const apiLimiter = createLimiter(60 * 60 * 1000, 1000);
