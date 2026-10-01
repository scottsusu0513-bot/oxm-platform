/**
 * Batch 3.10 Phase 2：儲存生命週期修正的回歸測試。
 * 公開／私有 S3 一律 mock（不打外部服務）；DB 用本機測試 DB。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const puts = vi.hoisted(() => [] as { key: string; contentType: string }[]);
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storagePut: vi.fn(async (key: string, _data: Buffer, contentType: string) => {
      puts.push({ key, contentType });
      return { key, url: `https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/${key}` };
    }),
  };
});

const priv = vi.hoisted(() => ({
  store: new Map<string, { size: number; contentType: string; head: Buffer }>(),
  uploadCalls: [] as { key: string; contentType: string; contentLength: number; ttl: number }[],
  downloadCalls: [] as { key: string; opts: unknown }[],
  deletes: [] as string[],
}));
vi.mock("./privateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./privateStorage")>();
  return {
    ...actual,
    isPrivateStorageConfigured: () => true,
    privateStorageCreateUploadUrl: async (key: string, contentType: string, contentLength: number, ttl: number) => {
      priv.uploadCalls.push({ key, contentType, contentLength, ttl });
      return `https://private.example.test/${key}`;
    },
    privateStorageHeadObject: async (key: string) => {
      const o = priv.store.get(key);
      return o ? { exists: true, sizeBytes: o.size, contentType: o.contentType, etag: "\"e\"" } : { exists: false, sizeBytes: 0, contentType: null, etag: null };
    },
    privateStorageReadHeadBytes: async (key: string, n: number) => (priv.store.get(key)?.head ?? Buffer.alloc(0)).subarray(0, n),
    privateStorageCopyObject: async (src: string, dest: string) => {
      await new Promise(r => setTimeout(r, 15));
      const o = priv.store.get(src);
      if (!o) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      priv.store.set(dest, { ...o });
    },
    privateStorageDeleteObject: async (key: string) => { priv.deletes.push(key); priv.store.delete(key); },
    privateStorageCreateDownloadUrl: async (key: string, _name: string, _ttl: number, opts: unknown) => {
      priv.downloadCalls.push({ key, opts });
      return "https://private.example.test/download";
    },
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { detectImageMimeType, validateImageUpload } from "./_core/security";
import { isAllowedFactoryAvatarUrl } from "./factoryAvatarUrl";
import { newsAttachmentPermanentKey, NEWS_PDF_DOWNLOAD_CACHE_CONTROL } from "./newsAttachmentStorage";
import { buildPrivateChatPdfAttachment } from "./chatPdfAttachment";
import { runChatPdfAttachmentCleanup } from "./jobs/cleanupExpiredChatPdfAttachments";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const BASE = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg-${runId}`)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png-${runId}`)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1")]);
const WAV = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt ", "latin1")]);
const b64 = (b: Buffer) => b.toString("base64");
const PDF_HEAD = Buffer.from("%PDF-1.7\n", "latin1");

const userIds: number[] = [];
const factoryIds: number[] = [];
const newsIds: number[] = [];
const convIds: number[] = [];
const run = async (q: ReturnType<typeof sql>) => ((await (await db.getDb())!.execute(q)) as unknown as [any, unknown])[0];

async function mkUser(label: string) {
  const id = await ensureTestUser(`sl310-${label}-${runId}`, `SL310 ${label}`);
  await run(sql`UPDATE users SET primaryEmailVerifiedAt = NOW() WHERE id = ${id}`);
  userIds.push(id);
  return id;
}
async function ctxOf(userId: number): Promise<TrpcContext> {
  const u = (await db.getUserById(userId))!;
  return {
    user: { ...u, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}
async function mkFactory(label: string, status: "approved" | "draft") {
  const owner = await mkUser(label);
  const id = await createTestFactory(owner, `SL310 ${label} ${runId}`, status);
  factoryIds.push(id);
  return { owner, id, caller: appRouter.createCaller(await ctxOf(owner)) };
}
let adminCaller: ReturnType<typeof appRouter.createCaller>;
let adminId: number;

beforeAll(async () => {
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
  adminId = await mkUser("admin");
  const admin = (await db.getUserById(adminId))!;
  vi.stubEnv("ADMIN_WHITELIST_OPEN_IDS", JSON.stringify([admin.openId]));
  adminCaller = appRouter.createCaller({ ...(await ctxOf(adminId)), user: { ...admin, role: "admin", isAdmin: true } as TrpcContext["user"] });
}, 60000);

afterEach(() => { puts.length = 0; });

afterAll(async () => {
  for (const id of newsIds) await run(sql`DELETE FROM news WHERE id = ${id}`);
  for (const c of convIds) {
    await run(sql`DELETE FROM messages WHERE conversationId = ${c}`);
    await run(sql`DELETE FROM conversations WHERE id = ${c}`);
  }
  for (const f of factoryIds) {
    await run(sql`DELETE FROM factoryRevisions WHERE factoryId = ${f}`);
    await run(sql`DELETE FROM factoryPhotos WHERE factoryId = ${f}`);
    await deleteTestFactory(f);
  }
  for (const u of userIds) await deleteTestUser(u);
  vi.unstubAllEnvs();
}, 60000);

describe("圖片 signature：以內容判斷格式", () => {
  it("JPEG／PNG／WEBP 正確辨識；只有 RIFF（WAV）、截斷的 PNG、HTML 一律拒絕", async () => {
    expect(detectImageMimeType(JPEG)).toBe("image/jpeg");
    expect(detectImageMimeType(PNG)).toBe("image/png");
    expect(detectImageMimeType(WEBP)).toBe("image/webp");
    expect(detectImageMimeType(WAV)).toBeNull();
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectImageMimeType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(await validateImageUpload(PNG)).toEqual({ valid: true, mimeType: "image/png" });
    expect((await validateImageUpload(WAV)).valid).toBe(false);
  });
});

describe("公開圖片上傳：Content-Type 與副檔名來自檔案內容，不信任前端", () => {
  it("相簿：宣稱 PNG、實際 JPEG → 以 image/jpeg、.jpg 儲存", async () => {
    const { caller } = await mkFactory("photo", "draft");
    await caller.factory.uploadPhoto({ base64: b64(JPEG), mimeType: "image/png" });
    expect(puts).toHaveLength(1);
    expect(puts[0].contentType).toBe("image/jpeg");
    expect(puts[0].key).toMatch(/^factory-photos\/\d+\/[A-Za-z0-9_-]+\.jpg$/);
  });
  it("封面：PNG 內容不再被標成 image/jpeg、.jpg", async () => {
    const { id, caller } = await mkFactory("cover", "draft");
    await caller.factory.uploadCoverImage({ base64: b64(PNG), factoryId: id });
    expect(puts[0]).toMatchObject({ contentType: "image/png" });
    expect(puts[0].key).toMatch(new RegExp(`^factory-covers/${id}/[A-Za-z0-9_-]+\\.png$`));
  });
  it("WAV（RIFF 但不是 WEBP）被拒絕，不會上傳", async () => {
    const { caller } = await mkFactory("wav", "draft");
    await expect(caller.factory.uploadPhoto({ base64: b64(WAV), mimeType: "image/webp" })).rejects.toThrow(/不支持的圖片格式/);
    expect(puts).toHaveLength(0);
  });
  it("找消息內文圖：前端宣稱 text/html，實際 PNG → 以 image/png 儲存", async () => {
    const news = await db.createNews({ slug: `sl310-img-${runId.replace(/_/g, "-")}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: adminId });
    newsIds.push(news.id);
    await adminCaller.news.uploadContentImage({ newsId: news.id, base64: b64(PNG), mimeType: "text/html" });
    expect(puts[0].contentType).toBe("image/png");
    expect(puts[0].key).toMatch(/\.png$/);
  });
});

describe("公開物件 Cache-Control（真實 storagePut，S3 client 被攔截）", () => {
  it("PutObject 帶 public, max-age=31536000, immutable", async () => {
    const actual = await vi.importActual<typeof import("./storage")>("./storage");
    const { S3Client } = await import("@aws-sdk/client-s3");
    const spy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    try {
      await actual.storagePut("factory-photos/1/abcdefgh.jpg", JPEG, "image/jpeg");
      const input = (spy.mock.calls[0][0] as { input: Record<string, unknown> }).input;
      expect(input).toMatchObject({ Key: "factory-photos/1/abcdefgh.jpg", ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("presigned PUT：檔案大小與 Content-Type 都簽進網址（真實 getSignedUrl，假憑證）", () => {
  it("SignedHeaders 包含 content-length 與 content-type；不合法大小直接拒絕", async () => {
    const actual = await vi.importActual<typeof import("./privateStorage")>("./privateStorage");
    vi.stubEnv("AWS_PRIVATE_FILES_BUCKET", "oxm-private-test");
    vi.stubEnv("AWS_PRIVATE_FILES_REGION", "ap-southeast-2");
    vi.stubEnv("AWS_PRIVATE_FILES_ACCESS_KEY_ID", "AKIAEXAMPLEEXAMPLE00");
    vi.stubEnv("AWS_PRIVATE_FILES_SECRET_ACCESS_KEY", "x".repeat(40));
    try {
      const url = new URL(await actual.privateStorageCreateUploadUrl("chat-attachments/tmp/abc.pdf", "application/pdf", 12345, 600));
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(actual.privateStorageCreateUploadUrl("chat-attachments/tmp/abc.pdf", "application/pdf", bad, 600)).rejects.toThrow(/檔案大小/);
      }
    } finally {
      vi.stubEnv("AWS_PRIVATE_FILES_BUCKET", "");
    }
  });
});

describe("工廠頭貼網址：只接受本平台 bucket 內屬於這間工廠的物件", () => {
  const own = (p: string, fid: number) => `${BASE}${p}/${fid}/abcDEF123456.jpg`;
  it("純函式規則", () => {
    const o = { factoryId: 7, currentValue: "https://legacy.example.com/old.png", allowTemporary: false };
    expect(isAllowedFactoryAvatarUrl(null, o)).toBe(true);
    expect(isAllowedFactoryAvatarUrl("https://legacy.example.com/old.png", o)).toBe(true); // 沿用目前值
    expect(isAllowedFactoryAvatarUrl(own("factory-avatars", 7), o)).toBe(true);
    expect(isAllowedFactoryAvatarUrl(own("factory-avatars", 8), o)).toBe(false);
    expect(isAllowedFactoryAvatarUrl(own("factory-avatars-temp", 7), o)).toBe(false);
    expect(isAllowedFactoryAvatarUrl(own("factory-avatars-temp", 7), { ...o, allowTemporary: true })).toBe(true);
    for (const bad of ["https://evil.example.com/a.jpg", own("factory-avatars", 7).replace("https:", "http:"), `${own("factory-avatars", 7)}?x=1`, `${BASE}factory-avatars/7/../8/abcDEF123456.jpg`, `${BASE}product-images/7/abcDEF123456.jpg`]) {
      expect(isAllowedFactoryAvatarUrl(bad, o)).toBe(false);
    }
  });
  it("factory.update（draft）：外部網址、其他工廠的頭貼 → BAD_REQUEST；自己的正式頭貼可以", async () => {
    const { id, caller } = await mkFactory("avd", "draft");
    const invalid = { code: "BAD_REQUEST", message: "頭貼網址無效，請重新上傳頭貼" };
    await expect(caller.factory.update({ id, avatarUrl: "https://evil.example.com/a.jpg" })).rejects.toMatchObject(invalid);
    await expect(caller.factory.update({ id, avatarUrl: own("factory-avatars", id + 1) })).rejects.toMatchObject(invalid);
    await caller.factory.update({ id, avatarUrl: own("factory-avatars", id) });
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(own("factory-avatars", id));
  });
  it("submitRevision（approved）：外部網址、其他工廠的暫存頭貼 → BAD_REQUEST；自己的暫存頭貼可以", async () => {
    const { id, caller } = await mkFactory("avr", "approved");
    await run(sql`UPDATE factories SET ownerName = '負責人' WHERE id = ${id}`);
    const invalid = { code: "BAD_REQUEST", message: "頭貼網址無效，請重新上傳頭貼" };
    await expect(caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: "https://evil.example.com/a.jpg" }, revisionReason: "更換頭貼" })).rejects.toMatchObject(invalid);
    await expect(caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: own("factory-avatars-temp", id + 1) }, revisionReason: "更換頭貼" })).rejects.toMatchObject(invalid);
    await caller.factory.submitRevision({ factoryId: id, proposedData: { avatarUrl: own("factory-avatars-temp", id) }, revisionReason: "更換頭貼" });
  });
  it("核准：修正前就存在、帶外部頭貼的待審申請 → 拒絕核准，工廠資料不變", async () => {
    const { id, owner } = await mkFactory("ava", "approved");
    const before = (await db.getFactoryById(id))!.avatarUrl;
    const r = await run(sql`INSERT INTO factoryRevisions (factoryId, submittedBy, status, originalData, proposedData) VALUES (${id}, ${owner}, 'pending', '{}', ${JSON.stringify({ avatarUrl: "https://evil.example.com/a.jpg" })})`);
    await expect(adminCaller.admin.approveRevision({ revisionId: r.insertId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "修改申請的頭貼網址無效，請要求工廠重新上傳頭貼" });
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(before);
  });
  it("factory.create 帶 avatarUrl → BAD_REQUEST（頭貼一律建立後上傳）", async () => {
    const u = await mkUser("create");
    const caller = appRouter.createCaller(await ctxOf(u));
    await expect(caller.factory.create({
      name: `SL310 create ${runId}`, industry: ["電子"], mfgModes: ["ODM"], region: "新竹市", description: "d", capitalLevel: "<1000萬",
      address: "地址", taxId: "04595257", avatarUrl: "https://evil.example.com/a.jpg",
    } as never)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "頭貼請在建立工廠後上傳" });
  });
});

describe("找消息 PDF：簽入大小、決定性正式 key、重複／併發 finalize 只有一筆、DB 失敗不刪正式物件、下載 no-store", () => {
  let newsId: number;
  beforeAll(async () => {
    const n = await db.createNews({ slug: `sl310-pdf-${runId.replace(/_/g, "-")}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: adminId });
    newsId = n.id;
    newsIds.push(newsId);
  });
  const putTmp = (key: string, size = 1000) => priv.store.set(key, { size, contentType: "application/pdf", head: PDF_HEAD });
  const finalize = (storageKey: string) => adminCaller.news.finalizePdfUpload({ newsId, storageKey, displayName: "d", originalFileName: "d.pdf" });
  const count = async () => Number((await run(sql`SELECT COUNT(*) n FROM newsAttachments WHERE newsId = ${newsId}`))[0].n);

  it("createPdfUploadSession：宣告大小簽進 presigned PUT；超過 25MB 直接拒絕", async () => {
    const s = await adminCaller.news.createPdfUploadSession({ newsId, fileName: "a.pdf", declaredMimeType: "application/pdf", declaredSizeBytes: 4321 });
    expect(priv.uploadCalls.at(-1)).toEqual({ key: s.storageKey, contentType: "application/pdf", contentLength: 4321, ttl: 600 });
    await expect(adminCaller.news.createPdfUploadSession({ newsId, fileName: "a.pdf", declaredMimeType: "application/pdf", declaredSizeBytes: 25 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("finalize：正式 key 由暫存 key 決定；第二次 finalize（暫存已刪）失敗且不新增附件", async () => {
    const tmp = `news-attachments/tmp/seq${runId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
    putTmp(tmp);
    await finalize(tmp);
    const permanent = newsAttachmentPermanentKey(newsId, tmp);
    expect(priv.store.has(permanent)).toBe(true);
    expect(priv.store.has(tmp)).toBe(false);
    const rows = await run(sql`SELECT storageKey FROM newsAttachments WHERE newsId = ${newsId}`);
    expect(rows.map((r: any) => r.storageKey)).toContain(permanent);
    const before = await count();
    await expect(finalize(tmp)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await count()).toBe(before);
  });

  it("同一份上傳併發 finalize 兩次 → 只有一筆附件", async () => {
    const tmp = `news-attachments/tmp/par${runId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
    putTmp(tmp);
    const before = await count();
    const results = await Promise.allSettled([finalize(tmp), finalize(tmp)]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect(await count()).toBe(before + 1);
  });

  it("DB 寫入失敗（已達 5 份上限）→ 回錯誤，但不刪除正式物件（交給對帳在重新確認引用後處理）", async () => {
    while ((await count()) < 5) {
      const t = `news-attachments/tmp/fill${(await count())}${runId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
      putTmp(t);
      await finalize(t);
    }
    const tmp = `news-attachments/tmp/over${runId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
    putTmp(tmp);
    await expect(finalize(tmp)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(priv.store.has(newsAttachmentPermanentKey(newsId, tmp))).toBe(true);
    expect(priv.deletes).not.toContain(newsAttachmentPermanentKey(newsId, tmp));
    expect(await count()).toBe(5);
  });

  it("目標 key 已存在但大小不同 → fail closed，不覆蓋", async () => {
    const tmp = `news-attachments/tmp/col${runId.replace(/[^A-Za-z0-9]/g, "")}.pdf`;
    putTmp(tmp, 1000);
    priv.store.set(newsAttachmentPermanentKey(newsId, tmp), { size: 999, contentType: "application/pdf", head: PDF_HEAD });
    await expect(finalize(tmp)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(priv.store.get(newsAttachmentPermanentKey(newsId, tmp))!.size).toBe(999);
  });

  it("下載連結：attachment＋private, no-store", async () => {
    const [att] = await run(sql`SELECT id, storageKey FROM newsAttachments WHERE newsId = ${newsId} ORDER BY id LIMIT 1`);
    await adminCaller.news.getPdfDownloadUrl({ attachmentId: att.id });
    expect(priv.downloadCalls.at(-1)).toEqual({ key: att.storageKey, opts: { disposition: "attachment", cacheControl: "private, no-store" } });
    expect(NEWS_PDF_DOWNLOAD_CACHE_CONTROL).toBe("private, no-store");
  });

  it("newsAttachmentPermanentKey 拒絕格式不符的暫存 key", () => {
    for (const bad of ["news-attachments/tmp/../x.pdf", "chat-attachments/tmp/abcdefgh.pdf", "news-attachments/tmp/abc.pdf", "news-attachments/12/abcdefgh.pdf"]) {
      expect(() => newsAttachmentPermanentKey(1, bad)).toThrow();
    }
    expect(() => newsAttachmentPermanentKey(0, "news-attachments/tmp/abcdefgh.pdf")).toThrow();
    expect(newsAttachmentPermanentKey(9, "news-attachments/tmp/abcdefgh.pdf")).toBe("news-attachments/9/abcdefgh.pdf");
  });
});

describe("聊天 PDF：同一個 fileKey 只建立一則訊息", () => {
  it("併發 saveChatPdfMessageOnce 兩次 → 只有一則；重複呼叫回傳 created=false", async () => {
    const { owner, id: factoryId } = await mkFactory("chat", "approved");
    const buyer = await mkUser("buyer");
    const r = await run(sql`INSERT INTO conversations (userId, factoryId) VALUES (${buyer}, ${factoryId})`);
    const conv = r.insertId as number;
    convIds.push(conv);
    const attachment = buildPrivateChatPdfAttachment({ fileKey: `chat-attachments/${factoryId}/${"a".repeat(21)}.pdf`, fileName: "x.pdf", fileSize: 10, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const results = await Promise.all([db.saveChatPdfMessageOnce(conv, owner, attachment), db.saveChatPdfMessageOnce(conv, owner, attachment)]);
    expect(results.filter(x => x.created)).toHaveLength(1);
    expect((await db.saveChatPdfMessageOnce(conv, owner, attachment)).created).toBe(false);
    expect(Number((await run(sql`SELECT COUNT(*) n FROM messages WHERE conversationId = ${conv} AND type = 'pdf'`))[0].n)).toBe(1);
  });
});

describe("cleanup 分頁：持續失敗的列不會讓後面的到期附件永遠輪不到", () => {
  it("聊天 PDF：前 4 筆一直刪除失敗、每批 2 筆，後面的第 5、6 筆仍會被處理", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const expired = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const rows = [1, 2, 3, 4, 5, 6].map(id => ({ id, attachmentData: buildPrivateChatPdfAttachment({ fileKey: `chat-attachments/1/${String(id).repeat(21).slice(0, 21)}.pdf`, fileName: "x.pdf", fileSize: 1, expiresAt: expired }) }));
    const deleted: string[] = [];
    const r = await runChatPdfAttachmentCleanup({ now, limit: 2 }, {
      listDue: async (_iso, limit, afterId) => rows.filter(x => x.id > afterId).slice(0, limit),
      deleteObject: async (key) => { if (/\/[1-4]{21}\.pdf$/.test(key)) throw Object.assign(new Error("denied"), { name: "AccessDenied" }); deleted.push(key); },
      markDeleted: async () => true,
    });
    expect(r).toMatchObject({ scanned: 6, deleted: 2, failed: 4 });
    expect(deleted).toHaveLength(2);
  });
  it("找消息附件查詢：依 id 遞增、afterId cursor 生效", async () => {
    const all = await db.getNewsAttachmentsDueForCleanup(1000, 0);
    const ids = all.map(a => a.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    if (ids.length > 0) expect((await db.getNewsAttachmentsDueForCleanup(1000, ids[0])).map(a => a.id)).not.toContain(ids[0]);
  });
});
