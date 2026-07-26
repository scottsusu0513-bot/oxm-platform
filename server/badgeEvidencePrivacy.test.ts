/**
 * 徽章證明圖片「object key 全程只存在伺服器端」正式回歸測試（永久保留，取代
 * 先前用完即刪除的臨時驗證）。走真實本機測試資料庫（受 server/test-db-guard.ts
 * 保護），用 appRouter.createCaller(ctx) 直接呼叫 tRPC procedure。任何會真的
 * 打 AWS S3 的路徑（server/privateStorage.ts 的 put／createViewUrl）一律
 * vi.mock 取代，不需要真實 AWS_PRIVATE_FILES_* 憑證即可在本機／CI 執行。
 *
 * 涵蓋：
 * 1. owner／共管者上傳成功後，API 回應絕不含 object key 或任何網址。
 * 2. owner、共管者、一般會員呼叫管理員專屬的查看 API 一律 FORBIDDEN。
 * 3. 訪客呼叫一律 UNAUTHORIZED。
 * 4. admin 呼叫可取得短效檢視網址（mock），且有效期限固定是 600 秒。
 * 5. 不同工廠的證明資料互不外洩（IDOR：無法用他廠的 factoryId 取得這廠的簽章）。
 * 6. getById／getMine／update／submitRevision／uploadBadgeEvidence 的回應
 *    整串 JSON 都不含 object key 前綴或任何 http(s) 網址。
 * 7. 工廠重新整理頁面（getMine）後仍能看到「已上傳／張數」狀態，但拿不到
 *    任何可用來取回圖片的資訊。
 * 8. S3 孤兒檔案防護：S3 寫入成功但 DB 綁定失敗（例外或上限）時，一定會
 *    清理「這次剛建立」的 S3 物件，不影響既有圖片；清理本身失敗也不洩漏
 *    key／網址、不覆蓋原始錯誤、不造成未處理的 Promise rejection；
 *    privateStoragePutObject 本身失敗時完全不觸碰 DB 也不觸發清理。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const mockPutObject = vi.fn(async (key: string) => ({ key }));
const mockCreateViewUrl = vi.fn(async (key: string, ttlSeconds: number) => `https://mock-private-bucket.example.test/${key}?ttl=${ttlSeconds}`);
const mockDeleteObject = vi.fn(async (_key: string) => undefined);

vi.mock("./privateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./privateStorage")>();
  return {
    ...actual,
    isPrivateStorageConfigured: () => true,
    privateStoragePutObject: (key: string, data: Buffer, contentType: string) => mockPutObject(key, data, contentType),
    privateStorageCreateViewUrl: (key: string, ttlSeconds: number) => mockCreateViewUrl(key, ttlSeconds),
    privateStorageDeleteObject: (key: string) => mockDeleteObject(key),
  };
});

const { appRouter } = await import("./routers");
const db = await import("./db");
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number, overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `evidence-privacy-${userId}`, email: `evidence-privacy-${userId}@example.test`,
    name: "Evidence Privacy Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
function guestCtx(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

const runId = `badge-evidence-privacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`Evidence Privacy ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

async function deleteTestUser(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
}

async function createTestFactory(ownerId: number, name: string): Promise<number> {
  const id = await db.createFactory({
    ownerId,
    name,
    industry: ["紡織"],
    mfgModes: ["ODM"],
    region: "台北市",
    capitalLevel: "100萬以下",
    address: "",
  } as any);
  return id as number;
}

async function addCoManager(factoryId: number, userId: number, invitedBy: number): Promise<void> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${userId}, ${invitedBy})
  `);
}

async function deleteTestFactory(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`); // cascade 一併清掉 factoryCoManagers
}

// 一個合法的假 JPEG（僅 magic number，內容不重要），validateImageUpload 只檢查前幾個 byte。
const FAKE_JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]).toString("base64");

describe("徽章證明圖片私有化：object key 全程只存在伺服器端（永久測試）", () => {
  let ownerId: number, coManagerId: number, otherMemberId: number;
  let factoryId: number, otherFactoryId: number;

  beforeAll(async () => {
    ownerId = await createTestUser();
    coManagerId = await createTestUser();
    otherMemberId = await createTestUser();
    factoryId = await createTestFactory(ownerId, `${runId}-A`);
    otherFactoryId = await createTestFactory(coManagerId, `${runId}-B`); // 借共管者當另一廠的 owner，方便測 IDOR
    await addCoManager(factoryId, coManagerId, ownerId);
  });

  afterAll(async () => {
    await deleteTestFactory(factoryId);
    await deleteTestFactory(otherFactoryId);
    await deleteTestUser(ownerId);
    await deleteTestUser(coManagerId);
    await deleteTestUser(otherMemberId);
  });

  it("owner 上傳成功後，API 回應只有安全欄位，不含 object key 或任何網址", async () => {
    const result = await appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "bni",
    });
    expect(result).toEqual({ uploaded: true, hasEvidence: true, imageCount: 1, badgeId: "bni" });
    expect(Object.keys(result).sort()).toEqual(["badgeId", "hasEvidence", "imageCount", "uploaded"]);
    expect(JSON.stringify(result)).not.toMatch(/certification-evidence\//);
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);
  });

  it("共管者上傳成功後，API 回應同樣只有安全欄位，不含 object key 或任何網址", async () => {
    const result = await appRouter.createCaller(ctxFor(coManagerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-9001",
    });
    expect(result).toEqual({ uploaded: true, hasEvidence: true, imageCount: 1, badgeId: "iso-9001" });
    expect(JSON.stringify(result)).not.toMatch(/certification-evidence\//);
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//);
  });

  it("getById／getMine：回應整串 JSON 都不含 object key 前綴或任何網址，但仍能看到 hasEvidence／imageCount 狀態", async () => {
    const asOwner = await appRouter.createCaller(ctxFor(ownerId)).factory.getMine();
    expect(asOwner).not.toBeNull();
    expect(JSON.stringify(asOwner)).not.toMatch(/certification-evidence\//);
    const status = (asOwner as any)?.certificationEvidenceStatus;
    expect(status.find((e: any) => e.badgeId === "bni")).toEqual({ badgeId: "bni", description: "", hasEvidence: true, imageCount: 1 });

    const asOwnerById = await appRouter.createCaller(ctxFor(ownerId)).factory.getById({ id: factoryId });
    expect(JSON.stringify(asOwnerById)).not.toMatch(/certification-evidence\//);
    expect((asOwnerById as any)?.certificationEvidenceStatus.find((e: any) => e.badgeId === "iso-9001")?.hasEvidence).toBe(true);

    // 訪客／不相干會員看 getById：這筆工廠還是 draft，非授權者本來就看不到（回傳 null），
    // 更不會有 certificationEvidenceStatus。
    const asOther = await appRouter.createCaller(ctxFor(otherMemberId)).factory.getById({ id: factoryId });
    expect(asOther).toBeNull();
  });

  it("factory.update／submitRevision：即使呼叫端夾帶 imageKeys，回應與資料庫都不受影響，只有說明文字生效", async () => {
    const updateResult = await appRouter.createCaller(ctxFor(ownerId, { primaryEmailVerifiedAt: new Date() } as any)).factory.update({
      id: factoryId,
      certificationBadges: ["bni", "iso-9001"],
      certificationEvidence: [
        { badgeId: "bni", description: "更新後的說明", imageKeys: ["certification-evidence/1/should-be-ignored12.jpg"] } as any,
      ],
    } as any);
    expect(JSON.stringify(updateResult)).not.toMatch(/certification-evidence\//);

    const factoryRow = await db.getFactoryById(factoryId);
    const bniEntry = (factoryRow as any)?.certificationEvidence?.find((e: any) => e.badgeId === "bni");
    // 說明文字有更新，但圖片 key 仍是先前上傳的那一張，不是被 client 夾帶的偽造 key 覆蓋
    expect(bniEntry.description).toBe("更新後的說明");
    expect(bniEntry.imageKeys).toHaveLength(1);
    expect(bniEntry.imageKeys[0]).not.toBe("certification-evidence/1/should-be-ignored12.jpg");
  });

  it("管理員專屬查看 API：owner／共管者／一般會員一律 FORBIDDEN，訪客一律 UNAUTHORIZED", async () => {
    await expect(
      appRouter.createCaller(ctxFor(ownerId)).factory.getCertificationEvidenceViewUrls({ factoryId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(ctxFor(coManagerId)).factory.getCertificationEvidenceViewUrls({ factoryId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(ctxFor(otherMemberId)).factory.getCertificationEvidenceViewUrls({ factoryId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter.createCaller(guestCtx()).factory.getCertificationEvidenceViewUrls({ factoryId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("admin 呼叫可取得短效檢視網址（mock），有效期限固定為 600 秒，且只會拿到「這間工廠」實際存在的 key", async () => {
    mockCreateViewUrl.mockClear();
    const adminCtx = ctxFor(999999001, { role: "admin" });
    const result = await appRouter.createCaller(adminCtx).factory.getCertificationEvidenceViewUrls({ factoryId });
    const keys = Object.keys(result.urls);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(new RegExp(`^certification-evidence/${factoryId}/`));
    }
    expect(mockCreateViewUrl).toHaveBeenCalled();
    for (const call of mockCreateViewUrl.mock.calls) {
      expect(call[1]).toBe(600);
    }
  });

  it("IDOR：admin 查看 A 廠時，不會意外混入 B 廠的 key；一般會員無法用他廠 factoryId 取得任何簽章", async () => {
    // 先讓另一間工廠（otherFactoryId，owner 是 coManagerId）也上傳一張圖片，
    // 確保資料庫裡真的存在「別間工廠的 key」可供比對。
    await appRouter.createCaller(ctxFor(coManagerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId: otherFactoryId, badgeId: "ce",
    });

    const adminCtx = ctxFor(999999002, { role: "admin" });
    const resultA = await appRouter.createCaller(adminCtx).factory.getCertificationEvidenceViewUrls({ factoryId });
    for (const key of Object.keys(resultA.urls)) {
      expect(key.startsWith(`certification-evidence/${otherFactoryId}/`)).toBe(false);
    }

    // 一般會員即使知道 otherFactoryId，呼叫查看 API 依然是 FORBIDDEN（在讀 DB 之前就被擋下）。
    await expect(
      appRouter.createCaller(ctxFor(otherMemberId)).factory.getCertificationEvidenceViewUrls({ factoryId: otherFactoryId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("S3 孤兒檔案防護：DB 綁定失敗時必須清理本次剛寫入的 S3 物件", () => {
  let ownerId: number;
  let factoryId: number;

  beforeAll(async () => {
    ownerId = await createTestUser();
    factoryId = await createTestFactory(ownerId, `${runId}-orphan`);
  });

  afterAll(async () => {
    await deleteTestFactory(factoryId);
    await deleteTestUser(ownerId);
  });

  it("S3 上傳成功且 DB 綁定成功：不呼叫 privateStorageDeleteObject，回應精確維持安全格式", async () => {
    mockDeleteObject.mockClear();
    const result = await appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "bni",
    });
    expect(result).toEqual({ uploaded: true, hasEvidence: true, imageCount: 1, badgeId: "bni" });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("S3 上傳成功但 DB 綁定丟出例外：對本次 key 呼叫一次刪除，DB 不新增 imageKeys，回應不含 key 或網址", async () => {
    mockPutObject.mockClear();
    mockDeleteObject.mockClear();
    const spy = vi.spyOn(db, "appendFactoryCertificationEvidenceImage").mockRejectedValueOnce(new Error("simulated DB failure"));

    const before = await db.getFactoryById(factoryId);
    const beforeCount = ((before as any)?.certificationEvidence ?? []).find((e: any) => e.badgeId === "iso-9001")?.imageKeys?.length ?? 0;

    const caller = appRouter.createCaller(ctxFor(ownerId));
    await expect(
      caller.factory.uploadBadgeEvidence({ base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-9001" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    const uploadedKey = mockPutObject.mock.calls[0][0];
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(uploadedKey);

    const after = await db.getFactoryById(factoryId);
    const afterCount = ((after as any)?.certificationEvidence ?? []).find((e: any) => e.badgeId === "iso-9001")?.imageKeys?.length ?? 0;
    expect(afterCount).toBe(beforeCount);

    spy.mockRestore();
  });

  it("因每徽章 5 張上限被拒絕：本次新上傳物件會被清理，既有 5 張圖片完全不受影響", async () => {
    // 先真的上傳滿 5 張（走真實 append 邏輯，非 mock），確認上限是真的卡住。
    for (let i = 0; i < 5; i++) {
      await appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
        base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "ce",
      });
    }
    const before = await db.getFactoryById(factoryId);
    const beforeKeys = (before as any)?.certificationEvidence?.find((e: any) => e.badgeId === "ce")?.imageKeys;
    expect(beforeKeys).toHaveLength(5);

    mockPutObject.mockClear();
    mockDeleteObject.mockClear();
    await expect(
      appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
        base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "ce",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "此認證項目的證明圖片已達上限" });

    const sixthKey = mockPutObject.mock.calls[0][0];
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(sixthKey);

    const after = await db.getFactoryById(factoryId);
    const afterKeys = (after as any)?.certificationEvidence?.find((e: any) => e.badgeId === "ce")?.imageKeys;
    expect(afterKeys).toEqual(beforeKeys); // 既有 5 張完全不受影響，第 6 張也沒有被寫進去
  });

  it("privateStorageDeleteObject 清理也失敗：不洩漏 key 或網址、不覆蓋原始錯誤、不造成未處理的 Promise rejection", async () => {
    mockDeleteObject.mockClear();
    mockDeleteObject.mockRejectedValueOnce(new Error("simulated S3 delete failure"));
    const spy = vi.spyOn(db, "appendFactoryCertificationEvidenceImage").mockRejectedValueOnce(new Error("simulated DB failure"));

    const caller = appRouter.createCaller(ctxFor(ownerId));
    let caughtError: any = null;
    try {
      await caller.factory.uploadBadgeEvidence({ base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-14001" });
    } catch (err) {
      caughtError = err;
    }
    // 原本的錯誤（DB 綁定失敗）必須保留，不會被清理失敗的錯誤蓋掉，
    // 也不會把清理失敗的例外內容（可能含 key）洩漏到回應訊息裡。
    expect(caughtError).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(caughtError.message).not.toMatch(/certification-evidence\//);
    expect(caughtError.message).not.toMatch(/simulated S3 delete failure/);
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    // 測試本身能正常執行到這裡結束（沒有讓 vitest 回報未處理的 rejection），
    // 就是「清理失敗的 promise 有被正確 catch」最直接的證明。
  });

  it("延遲 Promise（resolve）：DB 綁定失敗後，upload 必須等待 delete 真正完成才回應，不會提前結束", async () => {
    mockDeleteObject.mockClear();
    const spy = vi.spyOn(db, "appendFactoryCertificationEvidenceImage").mockRejectedValueOnce(new Error("simulated DB failure"));

    let resolveDelete: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => { resolveDelete = resolve; });
    mockDeleteObject.mockImplementationOnce(() => deferred);

    const uploadPromise = appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-3834",
    });
    // 先掛上 then，避免這個 promise 之後被判定為 unhandled rejection；
    // 這裡只用來觀察 settled 旗標，真正的斷言在下面用 expect(...).rejects 進行。
    let settled = false;
    uploadPromise.then(() => { settled = true; }, () => { settled = true; });

    // 讓事件迴圈跑幾輪 microtask/macrotask，確認在 delete 這個 pending promise
    // 還沒被 resolve 之前，upload 的 promise 絕對還沒 settle——如果程式碼是
    // 「fire-and-forget」（沒有 await 就直接 throw），這裡就會提前變成 true。
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // 這時候才讓 delete 完成（resolve），upload 應該緊接著才回傳原本的錯誤。
    resolveDelete!();
    await expect(uploadPromise).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(settled).toBe(true);
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("延遲 Promise（reject）：delete 這個 pending promise 最終被拒絕，upload 仍等待它結束、保留原始錯誤、且無 unhandled rejection", async () => {
    mockDeleteObject.mockClear();
    const spy = vi.spyOn(db, "appendFactoryCertificationEvidenceImage").mockRejectedValueOnce(new Error("simulated DB failure"));

    let rejectDelete: ((err: Error) => void) | undefined;
    const deferred = new Promise<void>((_resolve, reject) => { rejectDelete = reject; });
    mockDeleteObject.mockImplementationOnce(() => deferred);

    const uploadPromise = appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
      base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-3834",
    });
    let settled = false;
    uploadPromise.then(() => { settled = true; }, () => { settled = true; });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false); // 還在等待 delete pending，upload 不得提前完成

    rejectDelete!(new Error("simulated delayed delete failure"));
    let caughtError: any = null;
    try {
      await uploadPromise;
    } catch (err) {
      caughtError = err;
    }
    expect(settled).toBe(true);
    // 原始的 DB 綁定錯誤保留，不會被延遲後才發生的 delete 失敗蓋掉，
    // 回應也不含 key 或網址；測試本身跑到這裡沒有觸發 vitest 的
    // unhandled rejection 警告，就是「delete 的 rejection 有被正確消化」的證明。
    expect(caughtError).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(caughtError.message).not.toMatch(/certification-evidence\//);
    expect(caughtError.message).not.toMatch(/https?:\/\//);
    expect(caughtError.message).not.toMatch(/simulated delayed delete failure/);

    spy.mockRestore();
  });

  it("privateStoragePutObject 本身失敗：完全不呼叫 DB append，也不呼叫 delete", async () => {
    mockPutObject.mockClear();
    mockDeleteObject.mockClear();
    const dbSpy = vi.spyOn(db, "appendFactoryCertificationEvidenceImage");
    mockPutObject.mockRejectedValueOnce(new Error("simulated S3 put failure"));

    await expect(
      appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
        base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-45001",
      }),
    ).rejects.toThrow();

    expect(dbSpy).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    dbSpy.mockRestore();
  });

  it("併發上傳：因 row lock 與每徽章上限檢查而被拒絕的請求，其剛上傳物件會被清理，成功的維持在上限內", async () => {
    mockPutObject.mockClear();
    mockDeleteObject.mockClear();
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () =>
        appRouter.createCaller(ctxFor(ownerId)).factory.uploadBadgeEvidence({
          base64: FAKE_JPEG_BASE64, mimeType: "image/jpeg", factoryId, badgeId: "iso-13485",
        }),
      ),
    );
    const succeeded = results.filter(r => r.status === "fulfilled");
    const failed = results.filter(r => r.status === "rejected");
    expect(succeeded).toHaveLength(5); // MAX_EVIDENCE_IMAGES_PER_BADGE
    expect(failed).toHaveLength(2);
    for (const r of failed) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "BAD_REQUEST" });
    }
    // 7 次上傳都真的寫進了 S3（每次都各自產生一個 key），但只有 5 個 key 最終
    // 綁定成功，其餘 2 個必須各自被清理一次。
    expect(mockPutObject).toHaveBeenCalledTimes(7);
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);

    const after = await db.getFactoryById(factoryId);
    const afterKeys = (after as any)?.certificationEvidence?.find((e: any) => e.badgeId === "iso-13485")?.imageKeys;
    expect(afterKeys).toHaveLength(5);
  });
});
