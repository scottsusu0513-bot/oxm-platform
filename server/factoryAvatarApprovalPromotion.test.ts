/**
 * 已上線工廠頭貼修改申請的「暫存 → 正式」核准流程（Production Hardening Batch 3.3.1）
 * — 整合測試：真的走本機測試資料庫與 tRPC router；S3 以記憶體假物件取代。
 *
 * 新規則：approved 工廠的頭貼修改申請核准後，factories.avatarUrl 一定指向
 * factory-avatars/{factoryId}/…（正式），不會再是 factory-avatars-temp/；
 * factoryRevisions.proposedData 保持原本的暫存網址（歷史紀錄），暫存檔保留。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

type Obj = { contentLength: number; contentType: string; etag: string };
const s3 = vi.hoisted(() => ({
  store: new Map<string, Obj>(),
  copies: [] as [string, string][],
  failCopy: false,
  onCopy: null as null | (() => Promise<void>),
}));
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  const { publicImageUrl } = await import("./factoryAvatarUrl");
  const { createHash } = await import("node:crypto");
  return {
    ...actual,
    storagePut: vi.fn(async (key: string, data: Buffer, contentType: string) => {
      s3.store.set(key, { contentLength: data.length, contentType, etag: `"${createHash("md5").update(data).digest("hex")}"` });
      return { key, url: publicImageUrl(key) };
    }),
    storageHead: vi.fn(async (key: string) => s3.store.get(key) ?? null),
    storageCopy: vi.fn(async (from: string, to: string) => {
      s3.copies.push([from, to]);
      if (s3.failCopy) throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
      if (s3.onCopy) await s3.onCopy();
      const src = s3.store.get(from);
      if (!src) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      s3.store.set(to, { ...src });
    }),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const BASE = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/";
const PERMANENT = (fid: number, f = "existing.png") => `${BASE}factory-avatars/${fid}/${f}`;
const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`oxm-avatar-${runId}`)]);
const ownerIds: number[] = [];
const factoryIds: number[] = [];

const ctxFor = async (userId: number): Promise<TrpcContext> => {
  const user = await db.getUserById(userId);
  return { user: { ...user!, isAdmin: false }, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext;
};
const adminCtx = (): TrpcContext => ({
  user: { id: ownerIds[0] ?? 1, openId: `avatar-admin-${runId}`, email: "avatar-promotion-admin@example.test", name: "admin", role: "admin", isAdmin: true },
  req: { protocol: "https", headers: {} }, res: { clearCookie() {} },
} as unknown as TrpcContext);

async function mkApproved(label: string, avatar: string | null = null) {
  const ownerId = await ensureTestUser(`fap-${label}-${runId}`, `頭貼搬移 ${label}`);
  ownerIds.push(ownerId);
  await db.setPrimaryEmailVerified(ownerId, `fap-${label}-${runId}@example.test`);
  const id = await createTestFactory(ownerId, `頭貼搬移-${label}-${runId}`, "approved");
  factoryIds.push(id);
  const conn = (await db.getDb())!;
  await conn.execute(sql`UPDATE factories SET ownerName = '負責人', avatarUrl = ${avatar ?? PERMANENT(id)}, coverImageUrl = ${`${BASE}factory-covers/${id}/c.jpg`} WHERE id = ${id}`);
  return { id, ownerId, owner: appRouter.createCaller(await ctxFor(ownerId)), admin: appRouter.createCaller(adminCtx()) };
}
/** 工廠主真的走 uploadAvatar（approved → factory-avatars-temp/）＋ submitRevision。 */
async function ownerUploadsAndSubmits(f: Awaited<ReturnType<typeof mkApproved>>, crop = { zoom: 1.3, posX: 40, posY: 60 }) {
  const up = await f.owner.factory.uploadAvatar({ base64: `data:image/jpeg;base64,${JPEG.toString("base64")}`, mimeType: "image/jpeg", factoryId: f.id, crop });
  expect(up.url).toMatch(new RegExp(`^${BASE}factory-avatars-temp/${f.id}/[A-Za-z0-9_-]+\\.jpg$`));
  await f.owner.factory.submitRevision({ factoryId: f.id, proposedData: { avatarUrl: up.url, avatarCrop: crop }, revisionReason: "換頭貼" });
  return { tempUrl: up.url, revisionId: (await latestRevision(f.id))!.id, crop };
}
async function latestRevision(factoryId: number) {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT id, status, CAST(proposedData AS CHAR) p FROM factoryRevisions WHERE factoryId = ${factoryId} ORDER BY id DESC LIMIT 1`)) as unknown as [{ id: number; status: string; p: string }[], unknown];
  return rows[0] ? { id: rows[0].id, status: rows[0].status, proposed: JSON.parse(rows[0].p) } : null;
}
const tempKey = (url: string) => url.slice(BASE.length);
const permFromTemp = (url: string) => url.replace("/factory-avatars-temp/", "/factory-avatars/");

beforeAll(() => {
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
  vi.stubEnv("ADMIN_WHITELIST_EMAILS", JSON.stringify(["avatar-promotion-admin@example.test"]));
});
beforeEach(() => { s3.store.clear(); s3.copies.length = 0; s3.failCopy = false; s3.onCopy = null; });
afterAll(async () => {
  const conn = await db.getDb();
  if (conn) for (const id of factoryIds) await conn.execute(sql`DELETE FROM factoryRevisions WHERE factoryId = ${id}`);
  for (const id of factoryIds) await deleteTestFactory(id);
  for (const id of ownerIds) await deleteTestUser(id);
  vi.unstubAllEnvs();
}, 60000);

describe("核准：暫存頭貼 → 正式頭貼", () => {
  it("I／J＋本機完整流程：上傳暫存頭貼 → 送審 → 核准 → 工廠頭貼是 factory-avatars/，申請仍記錄暫存網址，暫存檔保留，crop 不變", async () => {
    const f = await mkApproved("i");
    const { tempUrl, revisionId, crop } = await ownerUploadsAndSubmits(f);
    const before = (await db.getFactoryById(f.id))!;
    await f.admin.admin.approveRevision({ revisionId });
    const after = (await db.getFactoryById(f.id))!;
    expect(after.avatarUrl).toBe(permFromTemp(tempUrl));
    expect(after.avatarUrl).toMatch(new RegExp(`^${BASE}factory-avatars/${f.id}/`));
    expect(after.avatarCrop).toEqual(crop);
    expect(after.coverImageUrl).toBe(before.coverImageUrl);
    expect(s3.copies).toEqual([[tempKey(tempUrl), tempKey(permFromTemp(tempUrl))]]);
    expect(s3.store.has(tempKey(tempUrl))).toBe(true);
    const rev = (await latestRevision(f.id))!;
    expect(rev.status).toBe("approved");
    expect(rev.proposed.avatarUrl).toBe(tempUrl);
  });

  it("K：申請的頭貼本來就是正式網址 → 不複製，照原本方式核准", async () => {
    const f = await mkApproved("k");
    await f.owner.factory.submitRevision({ factoryId: f.id, proposedData: { avatarUrl: PERMANENT(f.id, "other.png") }, revisionReason: "測試修改" });
    await f.admin.admin.approveRevision({ revisionId: (await latestRevision(f.id))!.id });
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id, "other.png"));
    expect(s3.copies).toHaveLength(0);
  });

  it("L：申請沒有改頭貼 → 不複製，頭貼不變", async () => {
    const f = await mkApproved("l");
    await f.owner.factory.submitRevision({ factoryId: f.id, proposedData: { description: "新簡介" }, revisionReason: "測試修改" });
    await f.admin.admin.approveRevision({ revisionId: (await latestRevision(f.id))!.id });
    const after = (await db.getFactoryById(f.id))!;
    expect(after.avatarUrl).toBe(PERMANENT(f.id));
    expect(after.description).toBe("新簡介");
    expect(s3.copies).toHaveLength(0);
  });

  it("M：申請被退件 → 不複製，工廠資料不變", async () => {
    const f = await mkApproved("m");
    const { revisionId } = await ownerUploadsAndSubmits(f);
    await f.admin.admin.rejectRevision({ revisionId, reason: "圖片不清楚" });
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
    expect(s3.copies).toHaveLength(0);
  });

  it("N：legacy data: 頭貼仍被擋下（Batch 3.1.1 防護不受影響）——route 預檢直接拒絕，工廠不變、不複製", async () => {
    const f = await mkApproved("n");
    const conn = (await db.getDb())!;
    await conn.execute(sql`INSERT INTO factoryRevisions (factoryId, submittedBy, originalData, proposedData, revisionReason, status, submittedAt)
      VALUES (${f.id}, ${f.ownerId}, '{}', ${JSON.stringify({ avatarUrl: "data:image/jpeg;base64,AAAA", phone: "02-1111-2222" })}, 'legacy', 'pending', NOW())`);
    const revisionId = (await latestRevision(f.id))!.id;
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
    expect(s3.copies).toHaveLength(0);
    // 即使繞過 route 直接套用，approveRevisionAtomic 仍會略過 data: 頭貼、只套用其他欄位
    await db.approveRevisionAtomic(revisionId, 1);
    const after = (await db.getFactoryById(f.id))!;
    expect(after.avatarUrl).toBe(PERMANENT(f.id));
    expect(after.phone).toBe("02-1111-2222");
  });
});

describe("失敗與原子性", () => {
  it("S：CopyObject 失敗 → 核准失敗、申請維持待審、工廠資料不變", async () => {
    const f = await mkApproved("s");
    const { revisionId } = await ownerUploadsAndSubmits(f);
    s3.failCopy = true;
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect((await latestRevision(f.id))!.status).toBe("pending");
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
  });

  it("T：複製成功但 DB 核准失敗 → 工廠不變、正式檔成為安全孤兒；重試時沿用同一個正式檔（不再複製）", async () => {
    const f = await mkApproved("t");
    const { tempUrl, revisionId } = await ownerUploadsAndSubmits(f);
    const conn = (await db.getDb())!;
    // 模擬「複製完成的同時，申請被別的管理員處理掉」→ transaction 內找不到 pending 申請
    s3.onCopy = async () => { await conn.execute(sql`UPDATE factoryRevisions SET status = 'rejected' WHERE id = ${revisionId}`); };
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toThrow();
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
    expect(s3.store.has(tempKey(permFromTemp(tempUrl)))).toBe(true);
    // 恢復成 pending 後重試：目標已存在且內容一致 → 直接沿用
    s3.onCopy = null;
    await conn.execute(sql`UPDATE factoryRevisions SET status = 'pending' WHERE id = ${revisionId}`);
    await f.admin.admin.approveRevision({ revisionId });
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(permFromTemp(tempUrl));
    expect(s3.copies).toHaveLength(1);
  });

  it("TOCTOU：複製期間申請的頭貼被換掉 → transaction 內比對不符，不核准、工廠不變", async () => {
    const f = await mkApproved("toctou");
    const { revisionId } = await ownerUploadsAndSubmits(f);
    const conn = (await db.getDb())!;
    const swapped = `${BASE}factory-avatars-temp/${f.id}/SwappedAfterPromotion01.jpg`;
    s3.onCopy = async () => {
      await conn.execute(sql`UPDATE factoryRevisions SET proposedData = JSON_SET(proposedData, '$.avatarUrl', ${swapped}) WHERE id = ${revisionId}`);
    };
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toThrow(/AVATAR_PROMOTION_MISMATCH/);
    expect((await latestRevision(f.id))!.status).toBe("pending");
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
  });

  it("U：正式 key 已存在但內容不同 → 不覆蓋、不核准、工廠不變", async () => {
    const f = await mkApproved("u");
    const { tempUrl, revisionId } = await ownerUploadsAndSubmits(f);
    s3.store.set(tempKey(permFromTemp(tempUrl)), { contentLength: 1, contentType: "image/jpeg", etag: '"deadbeefdeadbeefdeadbeefdeadbeef"' });
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(s3.copies).toHaveLength(0);
    expect(s3.store.get(tempKey(permFromTemp(tempUrl)))!.contentLength).toBe(1);
    expect((await latestRevision(f.id))!.status).toBe("pending");
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
  });

  it("暫存檔不存在 → BAD_REQUEST，不核准", async () => {
    const f = await mkApproved("missing");
    const { tempUrl, revisionId } = await ownerUploadsAndSubmits(f);
    s3.store.delete(tempKey(tempUrl));
    await expect(f.admin.admin.approveRevision({ revisionId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await latestRevision(f.id))!.status).toBe("pending");
  });

  it("繞過防護：直接呼叫 db.approveRevisionAtomic 核准含暫存頭貼的申請（沒有搬移結果）→ fail closed", async () => {
    const f = await mkApproved("bypass");
    const { revisionId } = await ownerUploadsAndSubmits(f);
    await expect(db.approveRevisionAtomic(revisionId, 1)).rejects.toThrow(/AVATAR_PROMOTION_MISMATCH/);
    await expect(db.approveRevisionAtomic(revisionId, 1, {
      avatarPromotion: { factoryId: f.id + 1, sourceUrl: "x", persistentUrl: PERMANENT(f.id, "y.jpg") },
    })).rejects.toThrow(/AVATAR_PROMOTION_MISMATCH/);
    expect((await latestRevision(f.id))!.status).toBe("pending");
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(PERMANENT(f.id));
  });
});

describe("並發", () => {
  it("V：兩個管理員同時核准同一筆 → 只有一個成功；工廠頭貼是正式網址、正式檔內容一致", async () => {
    const f = await mkApproved("v");
    const { tempUrl, revisionId } = await ownerUploadsAndSubmits(f);
    const second = appRouter.createCaller(adminCtx());
    const results = await Promise.allSettled([f.admin.admin.approveRevision({ revisionId }), second.admin.approveRevision({ revisionId })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await db.getFactoryById(f.id))!.avatarUrl).toBe(permFromTemp(tempUrl));
    expect(s3.store.get(tempKey(permFromTemp(tempUrl)))).toEqual(s3.store.get(tempKey(tempUrl)));
    const conn = (await db.getDb())!;
    const [rows] = (await conn.execute(sql`SELECT COUNT(*) n FROM factoryRevisions WHERE factoryId = ${f.id} AND status = 'approved'`)) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0].n)).toBe(1);
  });
});
