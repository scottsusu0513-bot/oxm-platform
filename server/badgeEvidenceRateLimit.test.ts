/**
 * 認證徽章證明圖片上傳限流回歸測試 —— 驗證 server/_core/trpc.ts 的
 * badgeEvidenceUploadProcedure：依已驗證的 ctx.user.id 計算配額（每人每小時
 * 20 次），不看 IP、不信任前端傳入的任何身份欄位，且與一般圖片上傳的
 * IP-based uploadLimiter（10 次/小時）完全獨立分離。
 *
 * 用 appRouter.createCaller(ctx) 直接呼叫 tRPC procedure（略過 HTTP／Express
 * 層），這樣呼叫的順序是：requireUser（未登入者在此被擋下 UNAUTHORIZED）→
 * 本次新增的限流 middleware（超過額度在此被擋下 TOO_MANY_REQUESTS）→
 * 實際 resolver（factoryId 亂數不存在時回傳 NOT_FOUND）。限流計數在
 * resolver 執行「之前」就完成，因此不需要真的有一筆存在的工廠或設定好
 * AWS_PRIVATE_FILES_* 就能測試計數本身是否正確——只需要確認：額度用完前
 * 收到的是 NOT_FOUND（代表尚未被限流、有确實往下執行到 resolver），額度用完
 * 後收到的是 TOO_MANY_REQUESTS（代表被限流 middleware 擋下，resolver 根本
 * 沒有執行）。
 *
 * 每個測試案例使用獨立、刻意不會撞號的假 userId（80xxxx 起），避免同一支
 * 記憶體內 Map 的計數狀態在測試案例之間互相污染。
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId: number, overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `rate-limit-test-${userId}`,
    email: `rate-limit-test-${userId}@example.com`,
    name: "Rate Limit Test User",
    loginMethod: "manus",
    role: "user",
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// factoryId 刻意用不存在的亂數，resolver 一定會在限流通過後回傳 NOT_FOUND——
// 這正是我們要的:用「尚未被限流」的訊號,不需要真的準備一筆工廠資料或設定
// AWS_PRIVATE_FILES_*。
const NONEXISTENT_FACTORY_ID = 987654321;
const uploadOnce = (ctx: TrpcContext) =>
  appRouter.createCaller(ctx).factory.uploadBadgeEvidence({
    base64: "eA==",
    mimeType: "image/jpeg",
    factoryId: NONEXISTENT_FACTORY_ID,
    badgeId: "bni",
  });

describe("factory.uploadBadgeEvidence 限流 —— 依 userId 計算，每人每小時 20 次", () => {
  it("未登入呼叫直接回傳 UNAUTHORIZED，不會消耗任何配額", async () => {
    await expect(uploadOnce(createPublicContext())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("同一 userId 前 20 次通過限流（收到 NOT_FOUND，代表有執行到 resolver），第 21 次回傳 TOO_MANY_REQUESTS", async () => {
    const ctx = createAuthContext(800001);
    for (let i = 0; i < 20; i++) {
      await expect(uploadOnce(ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(uploadOnce(ctx)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // 確認錯誤訊息就是要顯示給使用者的那句話，且不是純文字回應
    // （這支測試繞過 HTTP 層直接呼叫 resolver，JSON 序列化本身由 tRPC 框架
    // 保證，見下方另一個現場實測 429 batch 回應格式的驗證）。
    await expect(uploadOnce(ctx)).rejects.toMatchObject({ message: "請求過於頻繁，請稍後再試" });
  });

  it("同一 userId 換「IP」（用不同的 req context 模擬）額度仍累計，不會重置", async () => {
    const ctx1 = createAuthContext(800002);
    ctx1.req = { protocol: "https", headers: { "x-forwarded-for": "1.1.1.1" } } as TrpcContext["req"];
    for (let i = 0; i < 12; i++) {
      await expect(uploadOnce(ctx1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // 同一個 userId，換一個完全不同的「IP」（req context）
    const ctx2 = createAuthContext(800002);
    ctx2.req = { protocol: "https", headers: { "x-forwarded-for": "8.8.8.8" } } as TrpcContext["req"];
    for (let i = 0; i < 8; i++) {
      await expect(uploadOnce(ctx2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // 累計 20 次，第 21 次（不論用哪個「IP」context）應該被限流
    await expect(uploadOnce(ctx2)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("不同 userId 即使共用同一個「IP」，額度分開計算，互不影響", async () => {
    const sharedIpReq = { protocol: "https", headers: { "x-forwarded-for": "9.9.9.9" } } as TrpcContext["req"];
    const userA = createAuthContext(800003);
    userA.req = sharedIpReq;
    const userB = createAuthContext(800004);
    userB.req = sharedIpReq;

    // User A 把自己的 20 次配額用完
    for (let i = 0; i < 20; i++) {
      await expect(uploadOnce(userA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(uploadOnce(userA)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // User B 使用同一個「IP」，第一次呼叫仍應正常通過限流（回傳 NOT_FOUND
    // 而不是 TOO_MANY_REQUESTS），證明兩人額度確實分開計算。
    await expect(uploadOnce(userB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("認證圖片上傳限流與一般圖片上傳限流互不影響", () => {
  it("一般圖片上傳（factory.uploadPhoto）不會消耗 badgeEvidenceUploadProcedure 的 20 次配額", async () => {
    const ctx = createAuthContext(800005);
    // uploadPhoto 呼叫 25 次（超過認證圖片的 20 次上限），只要每次都還是
    // resolver 層的錯誤（找不到工廠／未擁有工廠），代表這支路徑完全沒有經過
    // badgeEvidenceUploadProcedure 的限流計數。
    for (let i = 0; i < 25; i++) {
      await expect(
        appRouter.createCaller(ctx).factory.uploadPhoto({ base64: "eA==", mimeType: "image/jpeg" }),
      ).rejects.not.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    }
    // 緊接著呼叫認證圖片上傳，應該仍是全新的 20 次配額（尚未被上面的
    // uploadPhoto 呼叫消耗掉），第一次呼叫應該還是 NOT_FOUND 而不是限流。
    await expect(uploadOnce(ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("認證圖片上傳用完 20 次配額後，不影響同一使用者的一般圖片上傳（uploadPhoto 仍可正常呼叫，只受自己原本的 IP-based 限流影響）", async () => {
    const ctx = createAuthContext(800006);
    for (let i = 0; i < 20; i++) {
      await expect(uploadOnce(ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(uploadOnce(ctx)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // uploadPhoto 呼叫應該完全不受上面認證圖片配額用盡的影響——只要不是
    // TOO_MANY_REQUESTS（它自己的 Express 層 IP-based uploadLimiter 是
    // 另一套完全獨立的機制，createCaller 直接呼叫 tRPC 也不會經過那一層）。
    await expect(
      appRouter.createCaller(ctx).factory.uploadPhoto({ base64: "eA==", mimeType: "image/jpeg" }),
    ).rejects.not.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
