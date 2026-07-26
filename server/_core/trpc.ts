import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { isAdminUser } from "./admin";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!isAdminUser(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// 認證徽章證明圖片上傳限流：每個已登入 userId 每小時最多 20 次，與一般圖片
// 上傳（server/_core/rateLimit.ts 的 uploadLimiter，10 次/小時、以 IP 為
// key）完全獨立分離的配額。
//
// 刻意不用 Express 層的 IP-based rate limit 實作，而是在這裡用 tRPC
// middleware：金鑰必須是「已通過 requireUser 驗證、來自 JWT session 的
// ctx.user.id」，不能是前端可以自行夾帶、偽造的欄位；也不能只用 IP——否則
// 同一間公司 Wi-Fi 的不同使用者會互相排擠額度，而同一使用者換 IP／換網路
// 反而可以無限刷新額度，兩者都不符合「依登入身份、而非依網路位置」計算配額
// 的需求。protectedProcedure 已經保證 ctx.user 一定存在且已驗證，未登入者
// 會在更早的 requireUser middleware 就被擋下（UNAUTHORIZED），不會進到這裡。
//
// 記憶體內計數器、per-process，與 rateLimit.ts 既有八組 IP-based 限流器用的
// express-rate-limit 預設 MemoryStore 屬於同一種架構限制（單一 process 內
// 有效，多副本部署會各自獨立計數）——目前正式站是單一 process 部署，這不是
// 本次新增的限制。丟出的 TRPCError code: 'TOO_MANY_REQUESTS' 會被 tRPC 的
// HTTP adapter 自動對應成標準 429 且走 tRPC 原生的 JSON 錯誤序列化，batch
// 呼叫時陣列長度天生就與呼叫數一致，不需要像 rateLimit.ts 那樣額外手動組
// JSON（那是給 Express 層、還沒進到 tRPC pipeline 之前的請求用的）。
const BADGE_EVIDENCE_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const BADGE_EVIDENCE_UPLOAD_MAX_PER_USER = 20;
const badgeEvidenceUploadBuckets = new Map<number, { count: number; resetAt: number }>();

// 機會性清掉已過期的 bucket，避免長時間運行的 process 累積越來越多不會再
// 用到的使用者項目（每個項目只有一個整數+時間戳，成本極低，這裡只是順手
// 保持乾淨，不是必要的安全機制）。
function sweepExpiredBadgeEvidenceUploadBuckets(now: number) {
  badgeEvidenceUploadBuckets.forEach((bucket, userId) => {
    if (bucket.resetAt <= now) badgeEvidenceUploadBuckets.delete(userId);
  });
}

function consumeBadgeEvidenceUploadQuota(userId: number): boolean {
  const now = Date.now();
  if (badgeEvidenceUploadBuckets.size > 1000) sweepExpiredBadgeEvidenceUploadBuckets(now);

  const bucket = badgeEvidenceUploadBuckets.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    badgeEvidenceUploadBuckets.set(userId, { count: 1, resetAt: now + BADGE_EVIDENCE_UPLOAD_WINDOW_MS });
    return true;
  }
  if (bucket.count >= BADGE_EVIDENCE_UPLOAD_MAX_PER_USER) return false;
  bucket.count++;
  return true;
}

export const badgeEvidenceUploadProcedure = protectedProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    // protectedProcedure 的 requireUser 已經在更早的 middleware 保證 ctx.user
    // 存在，這裡的檢查只是讓 TypeScript 正確窄化型別，執行期不會真的走到
    // 這個分支（未登入者早已在 requireUser 被擋下、回傳 UNAUTHORIZED）。
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    if (!consumeBadgeEvidenceUploadQuota(ctx.user.id)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "請求過於頻繁，請稍後再試" });
    }
    return next();
  }),
);
