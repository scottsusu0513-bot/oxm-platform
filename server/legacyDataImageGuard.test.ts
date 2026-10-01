/**
 * Legacy data: URL 頭貼／封面不得寫回正式工廠資料（Production Hardening
 * Batch 3.1.1 Phase 2）— 整合測試，真的走本機測試資料庫。
 *
 * 風險：工廠 #3／#4 的 Base64 頭貼搬到 S3 後，工廠主若仍開著搬移前載入的
 * 工廠後台，瀏覽器狀態裡的 avatarUrl 還是 data: URL；FactoryDashboard 送修改
 * 申請時會帶上完整基本資料快照，核准後就會把 Base64 寫回正式工廠。
 *
 * 防護（shared/persistentImageUrl.ts）：
 *   - submitRevision：proposedData.avatarUrl 若是 data: URL 直接略過
 *   - approveRevisionAtomic：再次略過 data: URL 的 avatarUrl／coverImageUrl，保留目前值
 *   - updateFactory：拒絕 data: URL
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";
import { isLegacyDataUrl } from "@shared/persistentImageUrl";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DATA_AVATAR = `data:image/jpeg;base64,${"/9j/4AAQ".repeat(50)}`;
const S3_AVATAR = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-avatars/1/legacy-migration-0123456789abcdef.jpg";
const TEMP_AVATAR = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-avatars-temp/1/abcDEF123.jpg";
const COVER = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-covers/1/cover.jpg";

const ownerIds: number[] = [];
const factoryIds: number[] = [];

async function ownerCtx(userId: number): Promise<TrpcContext> {
  const user = await db.getUserById(userId);
  return {
    user: { ...user!, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function mkApprovedFactory(label: string) {
  const ownerId = await ensureTestUser(`ldig-${label}-${runId}`, `頭貼防護 ${label}`);
  ownerIds.push(ownerId);
  await db.setPrimaryEmailVerified(ownerId, `ldig-${label}-${runId}@example.test`);
  const id = await createTestFactory(ownerId, `頭貼防護-${label}-${runId}`, "approved");
  factoryIds.push(id);
  const conn = (await db.getDb())!;
  await conn.execute(sql`UPDATE factories SET avatarUrl = ${S3_AVATAR}, coverImageUrl = ${COVER}, ownerName = '負責人' WHERE id = ${id}`);
  return { id, ownerId };
}

async function latestRevision(factoryId: number) {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT id, status, CAST(proposedData AS CHAR) p FROM factoryRevisions WHERE factoryId = ${factoryId} ORDER BY id DESC LIMIT 1`)) as unknown as [{ id: number; status: string; p: string }[], unknown];
  return rows[0] ? { ...rows[0], proposed: JSON.parse(rows[0].p) } : null;
}

/** 模擬「歷史／過期」的修改申請：直接寫入 DB（繞過 submitRevision 的前端防護）。 */
async function insertRevision(factoryId: number, submittedBy: number, proposed: Record<string, unknown>, status: "pending" | "approved") {
  const conn = (await db.getDb())!;
  const [r] = (await conn.execute(sql`
    INSERT INTO factoryRevisions (factoryId, submittedBy, originalData, proposedData, revisionReason, status, submittedAt)
    VALUES (${factoryId}, ${submittedBy}, ${JSON.stringify({ avatarUrl: DATA_AVATAR })}, ${JSON.stringify(proposed)}, 'legacy', ${status}, NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  return r.insertId;
}

beforeAll(async () => {
  expect(isLegacyDataUrl(DATA_AVATAR)).toBe(true);
  // Batch 3.10：頭貼網址必須是本平台公開 bucket 的物件——讓測試環境的 bucket 設定與
  // 測試用網址（TEMP_AVATAR）一致
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const conn = await db.getDb();
  if (conn) for (const id of factoryIds) await conn.execute(sql`DELETE FROM factoryRevisions WHERE factoryId = ${id}`);
  for (const id of factoryIds) await deleteTestFactory(id);
  for (const id of ownerIds) await deleteTestUser(id);
}, 60000);

describe("isLegacyDataUrl", () => {
  it("只把 data: URL 視為 legacy；S3／temp／null／空字串不受影響", () => {
    for (const v of [DATA_AVATAR, " data:image/png;base64,AAAA", "DATA:image/png;base64,AAAA", "data:text/plain,hi"]) expect(isLegacyDataUrl(v)).toBe(true);
    for (const v of [S3_AVATAR, TEMP_AVATAR, null, undefined, "", "https://example.test/data:image.png"]) expect(isLegacyDataUrl(v)).toBe(false);
  });
});

describe("submitRevision", () => {
  it("A：過期頁面帶著 data: 頭貼＋其他修改 → 頭貼被略過、其他欄位照常送出", async () => {
    const { id, ownerId } = await mkApprovedFactory("a");
    const caller = appRouter.createCaller(await ownerCtx(ownerId));
    await caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: DATA_AVATAR, avatarCrop: null, description: "新簡介" }, revisionReason: "stale tab" });
    const rev = (await latestRevision(id))!;
    expect(rev.status).toBe("pending");
    expect(rev.proposed).not.toHaveProperty("avatarUrl");
    expect(rev.proposed.description).toBe("新簡介");
    expect(rev.p).not.toContain("data:");
  });

  it("A：只有 data: 頭貼 → 等同沒有任何修改，不建立修改申請", async () => {
    const { id, ownerId } = await mkApprovedFactory("a2");
    const caller = appRouter.createCaller(await ownerCtx(ownerId));
    await expect(caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: DATA_AVATAR }, revisionReason: "x" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await latestRevision(id)).toBeNull();
  });

  it("B：封面不在修改申請白名單內（只能走 uploadCoverImage），data: 封面不會進入 proposedData", async () => {
    const { id, ownerId } = await mkApprovedFactory("b");
    const caller = appRouter.createCaller(await ownerCtx(ownerId));
    await expect(caller.factory.submitRevision({ factoryId: id, proposedData: { coverImageUrl: DATA_AVATAR }, revisionReason: "x" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await latestRevision(id)).toBeNull();
  });

  it("C／D：factory-avatars-temp URL 照常送出；核准必須帶暫存→正式的搬移結果，工廠寫入正式網址、申請保留暫存網址（Batch 3.3.1）", async () => {
    const { id, ownerId } = await mkApprovedFactory("cd");
    const tempUrl = TEMP_AVATAR.replace("/factory-avatars-temp/1/", `/factory-avatars-temp/${id}/`);
    const permanentUrl = tempUrl.replace("/factory-avatars-temp/", "/factory-avatars/");
    const caller = appRouter.createCaller(await ownerCtx(ownerId));
    await caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: tempUrl, avatarCrop: { zoom: 1.2, posX: 40, posY: 60 } }, revisionReason: "new logo" });
    const rev = (await latestRevision(id))!;
    expect(rev.proposed.avatarUrl).toBe(tempUrl);
    // 沒有搬移結果就直接核准 → fail closed（暫存網址不能寫進正式資料）
    await expect(db.approveRevisionAtomic(rev.id, -1)).rejects.toThrow(/AVATAR_PROMOTION_MISMATCH/);
    await db.approveRevisionAtomic(rev.id, -1, { avatarPromotion: { factoryId: id, sourceUrl: tempUrl, persistentUrl: permanentUrl } });
    const f = (await db.getFactoryById(id))!;
    expect(f.avatarUrl).toBe(permanentUrl);
    expect(f.avatarCrop).toEqual({ zoom: 1.2, posX: 40, posY: 60 });
    expect((await latestRevision(id))!.proposed.avatarUrl).toBe(tempUrl);
  });
});

describe("approveRevisionAtomic（核准套用層）", () => {
  it("E：待審申請帶 data: 頭貼 → 核准時不寫回，保留目前 S3 頭貼；其他欄位照常套用", async () => {
    const { id, ownerId } = await mkApprovedFactory("e");
    const revId = await insertRevision(id, ownerId, { avatarUrl: DATA_AVATAR, phone: "02-9999-0000" }, "pending");
    await db.approveRevisionAtomic(revId, -1);
    const f = (await db.getFactoryById(id))!;
    expect(f.avatarUrl).toBe(S3_AVATAR);
    expect(f.phone).toBe("02-9999-0000");
  });

  it("F：待審申請帶 data: 封面 → 不寫回，封面維持原值", async () => {
    const { id, ownerId } = await mkApprovedFactory("f");
    const revId = await insertRevision(id, ownerId, { coverImageUrl: DATA_AVATAR, description: "x" }, "pending");
    await db.approveRevisionAtomic(revId, -1);
    const f = (await db.getFactoryById(id))!;
    expect(f.coverImageUrl).toBe(COVER);
    expect(f.description).toBe("x");
  });

  it("E：只有 data: 頭貼的待審申請 → 核准不改任何公開內容（publicContentUpdatedAt 不跳動）", async () => {
    const { id, ownerId } = await mkApprovedFactory("e2");
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE factories SET publicContentUpdatedAt = '2026-01-01 00:00:00' WHERE id = ${id}`);
    const before = (await db.getFactoryById(id))!.publicContentUpdatedAt;
    const revId = await insertRevision(id, ownerId, { avatarUrl: DATA_AVATAR }, "pending");
    await db.approveRevisionAtomic(revId, -1);
    const f = (await db.getFactoryById(id))!;
    expect(f.avatarUrl).toBe(S3_AVATAR);
    expect(f.publicContentUpdatedAt).toEqual(before);
  });
});

describe("歷史紀錄與直接寫入", () => {
  it("G：已核准的歷史申請（含 data: 頭貼）讀取不 crash，也不影響正式資料", async () => {
    const { id, ownerId } = await mkApprovedFactory("g");
    await insertRevision(id, ownerId, { avatarUrl: DATA_AVATAR }, "approved");
    const caller = appRouter.createCaller(await ownerCtx(ownerId));
    const own = (await caller.factory.getById({ id, includeRevision: true }))!;
    expect(own.avatarUrl).toBe(S3_AVATAR);
    expect(own.latestRevision).toBeTruthy();
    expect((await caller.factory.getById({ id }))!.avatarUrl).toBe(S3_AVATAR);
  });

  it("updateFactory：拒絕 data: 頭貼／封面；S3 URL 與 null 照常", async () => {
    const { id } = await mkApprovedFactory("u");
    await expect(db.updateFactory(id, -1, { avatarUrl: DATA_AVATAR })).rejects.toThrow(/data URL/);
    await expect(db.updateFactory(id, -1, { coverImageUrl: DATA_AVATAR })).rejects.toThrow(/data URL/);
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(S3_AVATAR);
    await db.updateFactory(id, -1, { avatarUrl: TEMP_AVATAR });
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(TEMP_AVATAR);
    await db.updateFactory(id, -1, { coverImageUrl: null });
    expect((await db.getFactoryById(id))!.coverImageUrl).toBeNull();
  });
});
