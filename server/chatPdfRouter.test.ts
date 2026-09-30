/**
 * Batch 3.5：聊天 PDF 型錄——真的走本機測試資料庫與 tRPC router；私有 S3 以
 * 記憶體假物件取代（vi.mock ./privateStorage），不打任何網路。
 *
 * 涵蓋：上傳權限、upload session、finalize 驗證與搬移、getMessages 的 metadata-only
 * DTO、下載授權與期限（含管理員寬限期）、刪除對話的物件清理、cleanup job，以及
 * 一條完整的本機端到端流程（>100KB PDF：session → 直傳 → finalize → 對方讀訊息 →
 * 取得簽章連結）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({
  store: new Map<string, { body: Buffer; contentType: string; etag: string }>(),
  uploadCalls: [] as { key: string; contentType: string; ttl: number }[],
  downloadCalls: [] as { key: string; name: string; ttl: number; opts: unknown }[],
  deleted: [] as string[],
  failDelete: new Map<string, string>(),
  failCopy: false,
}));

vi.mock("./privateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./privateStorage")>();
  return {
    ...actual,
    isPrivateStorageConfigured: () => true,
    privateStorageCreateUploadUrl: async (key: string, contentType: string, ttl: number) => {
      h.uploadCalls.push({ key, contentType, ttl });
      return `https://oxm-private-test.s3.ap-northeast-1.amazonaws.com/${key}?test-ttl=${ttl}&test-signature=placeholder`;
    },
    privateStorageHeadObject: async (key: string) => {
      const o = h.store.get(key);
      return o ? { exists: true, sizeBytes: o.body.length, contentType: o.contentType, etag: o.etag } : { exists: false, sizeBytes: 0, contentType: null, etag: null };
    },
    privateStorageReadHeadBytes: async (key: string, n: number) => h.store.get(key)!.body.subarray(0, n),
    privateStorageCopyObject: async (src: string, dst: string) => {
      if (h.failCopy) throw Object.assign(new Error("copy denied"), { name: "AccessDenied" });
      h.store.set(dst, { ...h.store.get(src)! });
    },
    privateStorageDeleteObject: async (key: string) => {
      const fail = h.failDelete.get(key);
      if (fail) throw Object.assign(new Error(fail), { name: fail });
      h.deleted.push(key);
      h.store.delete(key);
    },
    privateStorageCreateDownloadUrl: async (key: string, name: string, ttl: number, opts: unknown) => {
      h.downloadCalls.push({ key, name, ttl, opts });
      return `https://oxm-private-test.s3.ap-northeast-1.amazonaws.com/${key}?test-ttl=${ttl}&test-signature=placeholder`;
    },
  };
});

const { appRouter } = await import("./routers");
const db = await import("./db");
const { ensureTestUser, deleteTestUser } = await import("./_core/financeTestFixtures");
const { buildPrivateChatPdfAttachment, CHAT_PDF_ADMIN_GRACE_MS } = await import("./chatPdfAttachment");
const { buildContentDisposition } = await import("./privateStorage");
const { runChatPdfAttachmentCleanup } = await import("./jobs/cleanupExpiredChatPdfAttachments");
import type { TrpcContext } from "./_core/context";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const DAY = 24 * 60 * 60 * 1000;
const userIds: number[] = [];
const factoryIds: number[] = [];

async function mkUser(label: string) { const id = await ensureTestUser(`cpdf-${label}-${runId}`, `CPDF ${label}`); userIds.push(id); return id; }
async function ctxOf(userId: number, admin = false): Promise<TrpcContext> {
  const u = await db.getUserById(userId);
  return { user: { ...u!, role: admin ? "admin" : u!.role, isAdmin: admin }, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext;
}
const call = async (userId: number, admin = false) => appRouter.createCaller(await ctxOf(userId, admin)).chat;
async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q) as unknown as Promise<[{ insertId: number; affectedRows: number }, unknown]>; }
async function mkFactory(ownerId: number, status = "approved") {
  const [r] = await exec(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, ownerName, phone, contactEmail, address, taxId, avgRating, reviewCount, status, businessType, operationStatus, certified, subIndustry)
    VALUES (${ownerId}, ${`CPDF 工廠 ${runId}`}, '["金屬加工"]', '["OEM"]', '台北市', '描述', '<1000萬', '負責人', '02-1234-5678', 'x@example.test', '地址',
      ${String(Math.floor(10000000 + Math.random() * 89999999))}, '0.00', 0, ${status}, 'factory', 'normal', FALSE, '[]')`);
  factoryIds.push(r.insertId);
  return r.insertId;
}
async function mkConversation(userId: number, factoryId: number) {
  const [r] = await exec(sql`INSERT INTO conversations (userId, factoryId) VALUES (${userId}, ${factoryId})`);
  return r.insertId;
}
async function lastMessageId(conversationId: number) {
  const [rows] = await (await db.getDb())!.execute(sql`SELECT id FROM messages WHERE conversationId = ${conversationId} ORDER BY id DESC LIMIT 1`) as unknown as [{ id: number }[]];
  return rows[0]?.id;
}
async function pdfCount(conversationId: number) {
  const [rows] = await (await db.getDb())!.execute(sql`SELECT COUNT(*) n FROM messages WHERE conversationId = ${conversationId} AND type = 'pdf'`) as unknown as [{ n: number }[]];
  return Number(rows[0].n);
}
/** 直接寫一則 PDF 訊息（期限可自訂），物件同時放進假 S3。 */
async function seedPdf(conversationId: number, senderId: number, factoryId: number, expiresAt: Date, over: Record<string, unknown> = {}) {
  const id = Math.random().toString(36).slice(2).padEnd(21, "x").slice(0, 21).replace(/[^A-Za-z0-9_-]/g, "x");
  const fileKey = `chat-attachments/${factoryId}/${id}.pdf`;
  h.store.set(fileKey, { body: pdfBytes(2000), contentType: "application/pdf", etag: '"e"' });
  const data = { ...buildPrivateChatPdfAttachment({ fileKey, fileName: "型錄.pdf", fileSize: 2000, expiresAt: expiresAt.toISOString() }), ...over };
  await db.saveMessage(conversationId, senderId, "factory", "", "pdf", data);
  return { messageId: (await lastMessageId(conversationId))!, fileKey };
}
const PDF_HEADER = Buffer.from([...Buffer.from("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
const pdfBytes = (size: number) => Buffer.concat([PDF_HEADER, Buffer.alloc(size - PDF_HEADER.length, 0x20)]);
/** 模擬瀏覽器直傳 presigned PUT。 */
const putToStore = (key: string, body: Buffer, contentType = "application/pdf") => h.store.set(key, { body, contentType, etag: '"put-etag"' });

let owner: number, delistedOwner: number, coMgr: number, removedCoMgr: number, buyer: number, stranger: number, admin: number;
let factoryId: number, delistedFactoryId: number, conv: number, delistedConv: number;

beforeAll(async () => {
  owner = await mkUser("owner"); coMgr = await mkUser("comgr"); removedCoMgr = await mkUser("removed");
  buyer = await mkUser("buyer"); stranger = await mkUser("stranger"); admin = await mkUser("admin");
  factoryId = await mkFactory(owner);
  delistedOwner = await mkUser("delowner");
  delistedFactoryId = await mkFactory(delistedOwner, "delisted");
  await exec(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coMgr}, ${owner})`);
  await exec(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, removedAt) VALUES (${factoryId}, ${removedCoMgr}, ${owner}, NOW())`);
  conv = await mkConversation(buyer, factoryId);
  delistedConv = await mkConversation(buyer, delistedFactoryId);
}, 120000);

afterAll(async () => {
  for (const f of factoryIds) {
    await exec(sql`DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE factoryId = ${f})`);
    await exec(sql`DELETE FROM conversations WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM factoryCoManagers WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
  for (const u of userIds) await deleteTestUser(u);
}, 120000);

beforeEach(() => {
  h.uploadCalls.length = 0; h.downloadCalls.length = 0; h.deleted.length = 0;
  h.failDelete.clear(); h.failCopy = false;
});

const session = (over: Record<string, unknown> = {}) => ({ conversationId: conv, fileName: "型錄.pdf", fileSize: 200 * 1024, mimeType: "application/pdf" as const, ...over });

describe("上傳權限（A–F）", () => {
  it("A／B：owner 與 active co-manager 可以建立上傳 session", async () => {
    for (const u of [owner, coMgr]) await expect((await call(u)).createPdfUploadSession(session())).resolves.toHaveProperty("uploadKey");
  });
  it("C／D／F：買方、無關使用者、已移除的 co-manager → FORBIDDEN", async () => {
    for (const u of [buyer, stranger, removedCoMgr]) {
      await expect((await call(u)).createPdfUploadSession(session())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(h.uploadCalls).toHaveLength(0);
  });
  it("E：唯讀對話（工廠已下架）→ FORBIDDEN，沿用 assertConversationWritable", async () => {
    await expect((await call(delistedOwner)).createPdfUploadSession(session({ conversationId: delistedConv }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("對話不存在 → NOT_FOUND", async () => {
    await expect((await call(owner)).createPdfUploadSession(session({ conversationId: 999999999 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("upload session（G–N）", () => {
  it.each([
    ["G 大小 0", { fileSize: 0 }],
    ["G 負數", { fileSize: -1 }],
    ["H 超過 10MB", { fileSize: 10 * 1024 * 1024 + 1 }],
    ["I MIME 不對", { mimeType: "text/html" }],
    ["副檔名不是 .pdf", { fileName: "evil.exe" }],
  ])("%s → BAD_REQUEST", async (_l, over) => {
    await expect((await call(owner)).createPdfUploadSession(session(over) as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("J／K／L／M／N：檔名已清理（含 bidi）、key 由 server 產生在 tmp、PUT 600 秒並綁定 application/pdf、不回傳憑證", async () => {
    const r = await (await call(owner)).createPdfUploadSession(session({ fileName: "報價‮fdp.exe<1>.pdf" }));
    expect(r.fileName).toBe("報價fdp.exe_1_.pdf");
    expect(r.uploadKey).toMatch(/^chat-attachments\/tmp\/[A-Za-z0-9_-]{21}\.pdf$/);
    expect(h.uploadCalls).toEqual([{ key: r.uploadKey, contentType: "application/pdf", ttl: 600 }]);
    expect(r.expiresInSeconds).toBeLessThanOrEqual(600);
    expect(r.contentType).toBe("application/pdf");
    expect(Object.keys(r).sort()).toEqual(["contentType", "expiresInSeconds", "fileName", "uploadKey", "uploadUrl"]);
    expect(JSON.stringify(r)).not.toMatch(/AKIA|SecretAccessKey|AWS_PRIVATE/);
  });
});

describe("finalize（O–Y）", () => {
  it("O：不合法的暫存 key → BAD_REQUEST，不建立訊息", async () => {
    const before = await pdfCount(conv);
    for (const uploadKey of ["chat-attachments/1/x.pdf", "news-attachments/tmp/AbCdEfGhIjKlMnOpQrStU.pdf", "chat-attachments/tmp/../AbCdEfGhIjKlMnOpQrStU.pdf"]) {
      await expect((await call(owner)).finalizePdfUpload({ conversationId: conv, uploadKey, fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await pdfCount(conv)).toBe(before);
  });
  it("finalize 重新驗證權限：買方拿到合法 key 也不能 finalize，物件不被搬動", async () => {
    const { uploadKey } = await (await call(owner)).createPdfUploadSession(session());
    putToStore(uploadKey, pdfBytes(150 * 1024));
    await expect((await call(buyer)).finalizePdfUpload({ conversationId: conv, uploadKey, fileName: "a.pdf" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.store.has(uploadKey)).toBe(true);
  });
  it.each([
    ["P 沒有上傳物件", null],
    ["Q 實際 >10MB", { body: pdfBytes(10 * 1024 * 1024 + 1), contentType: "application/pdf" }],
    ["R Content-Type 錯", { body: pdfBytes(5000), contentType: "binary/octet-stream" }],
    ["S 不是 %PDF-", { body: Buffer.from("<html>not a pdf</html>"), contentType: "application/pdf" }],
  ])("%s → BAD_REQUEST、不建立訊息（W）、暫存已清除", async (_l, obj) => {
    const { uploadKey } = await (await call(owner)).createPdfUploadSession(session());
    if (obj) putToStore(uploadKey, obj.body, obj.contentType);
    const before = await pdfCount(conv);
    await expect((await call(owner)).finalizePdfUpload({ conversationId: conv, uploadKey, fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pdfCount(conv)).toBe(before);
    expect(h.store.has(uploadKey)).toBe(false);
  });
  it("X：CopyObject 失敗 → 不建立訊息", async () => {
    const { uploadKey } = await (await call(owner)).createPdfUploadSession(session());
    putToStore(uploadKey, pdfBytes(5000));
    h.failCopy = true;
    const before = await pdfCount(conv);
    await expect((await call(owner)).finalizePdfUpload({ conversationId: conv, uploadKey, fileName: "a.pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pdfCount(conv)).toBe(before);
  });
  it("T／U／V：合法 PDF → 正式 key 由 factoryId＋同一 id 決定、暫存刪除、DB 只存 metadata", async () => {
    const { uploadKey, fileName } = await (await call(coMgr)).createPdfUploadSession(session({ fileName: "產品型錄.pdf" }));
    putToStore(uploadKey, pdfBytes(300 * 1024));
    await (await call(coMgr)).finalizePdfUpload({ conversationId: conv, uploadKey, fileName });
    const finalKey = `chat-attachments/${factoryId}/${uploadKey.slice("chat-attachments/tmp/".length)}`;
    expect(h.store.has(finalKey)).toBe(true);
    expect(h.store.has(uploadKey)).toBe(false);
    const msg = (await db.getMessageById((await lastMessageId(conv))!))!;
    expect(msg.type).toBe("pdf");
    const data = msg.attachmentData as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["expiresAt", "fileKey", "fileName", "fileSize", "mimeType", "storage"]);
    expect(data).toMatchObject({ storage: "private", fileKey: finalKey, fileName: "產品型錄.pdf", fileSize: 300 * 1024, mimeType: "application/pdf" });
    expect(JSON.stringify(data)).not.toMatch(/https?:|amazonaws|fileUrl/);
    const exp = Date.parse(String(data.expiresAt)) - Date.now();
    expect(exp).toBeGreaterThan(7 * DAY - 60_000);
    expect(exp).toBeLessThanOrEqual(7 * DAY);
  });
});

describe("本機端到端（§61）：>100KB PDF → session → 直傳 → finalize → 對方讀訊息 → 簽章連結", () => {
  it("整條流程成功；PDF bytes 從未進入 tRPC 輸入（輸入只有 metadata）", async () => {
    const fixture = pdfBytes(512 * 1024);
    const input = session({ fileSize: fixture.length, fileName: "E2E 型錄.pdf" });
    expect(JSON.stringify(input).length).toBeLessThan(500); // 遠低於一般 API 的 100kb 上限
    const s = await (await call(owner)).createPdfUploadSession(input);
    putToStore(s.uploadKey, fixture); // 瀏覽器／App 直接 PUT 到 presigned URL
    const finalizeInput = { conversationId: conv, uploadKey: s.uploadKey, fileName: s.fileName };
    expect(JSON.stringify(finalizeInput).length).toBeLessThan(500);
    await (await call(owner)).finalizePdfUpload(finalizeInput);

    const messages = await (await call(buyer)).getMessages({ conversationId: conv });
    const pdfMsg = messages.filter(m => m.type === "pdf").at(-1)!;
    expect(pdfMsg.attachmentData).toEqual({ fileName: "E2E 型錄.pdf", fileSize: fixture.length, mimeType: "application/pdf", expiresAt: expect.any(String), deleted: false });

    const { url, expiresInSeconds } = await (await call(buyer)).getPdfDownloadUrl({ messageId: pdfMsg.id });
    expect(url.startsWith("https://")).toBe(true);
    expect(url).not.toContain("oxm-images-prod-2026");
    expect(expiresInSeconds).toBeLessThanOrEqual(300);
    expect(h.downloadCalls.at(-1)).toMatchObject({ key: expect.stringMatching(new RegExp(`^chat-attachments/${factoryId}/`)), name: "E2E 型錄.pdf" });
  });
});

describe("getMessages DTO（Z–AE）", () => {
  it("PDF 訊息：沒有 fileUrl／fileKey／bucket／amazonaws 網址，metadata 正確；其他訊息類型不變", async () => {
    await seedPdf(conv, owner, factoryId, new Date(Date.now() + DAY));
    await db.saveMessage(conv, owner, "factory", "", "product", { productIds: [1], snapshot: [{ id: 1, name: "p", factoryId }] });
    const messages = await (await call(buyer)).getMessages({ conversationId: conv });
    const text = JSON.stringify(messages.filter(m => m.type === "pdf"));
    expect(text).not.toMatch(/fileUrl|fileKey|chat-attachments|amazonaws|"storage"|https?:\/\//);
    for (const m of messages.filter(m => m.type === "pdf")) {
      expect(Object.keys(m.attachmentData as object).sort()).toEqual(["deleted", "expiresAt", "fileName", "fileSize", "mimeType"]);
    }
    const product = messages.filter(m => m.type === "product").at(-1)!;
    expect(product.attachmentData).toEqual({ productIds: [1], snapshot: [{ id: 1, name: "p", factoryId }] });
  });
});

describe("下載授權與期限（AF–AX）", () => {
  it("AF–AI：期限內買方／owner／co-manager／admin 都可以；inline＋private, no-store＋TTL ≤300（AT／AW／AX）", async () => {
    const { messageId, fileKey } = await seedPdf(conv, owner, factoryId, new Date(Date.now() + DAY));
    for (const [u, isAdmin] of [[buyer, false], [owner, false], [coMgr, false], [admin, true]] as const) {
      const r = await (await call(u, isAdmin)).getPdfDownloadUrl({ messageId });
      expect(r.expiresInSeconds).toBeLessThanOrEqual(300);
    }
    for (const c of h.downloadCalls) {
      expect(c.key).toBe(fileKey);
      expect(c.ttl).toBeLessThanOrEqual(300);
      expect(c.opts).toEqual({ disposition: "inline", cacheControl: "private, no-store" });
    }
  });
  it("AJ／AK：無關使用者、已移除的 co-manager → FORBIDDEN", async () => {
    const { messageId } = await seedPdf(conv, owner, factoryId, new Date(Date.now() + DAY));
    for (const u of [stranger, removedCoMgr]) await expect((await call(u)).getPdfDownloadUrl({ messageId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("AL：已下架工廠的歷史附件（未過期）仍可下載", async () => {
    const { messageId } = await seedPdf(delistedConv, delistedOwner, delistedFactoryId, new Date(Date.now() + DAY));
    await expect((await call(buyer)).getPdfDownloadUrl({ messageId })).resolves.toHaveProperty("url");
  });
  it("AM／AN／AO：一般參與者過期後拒絕；管理員第 8～37 天可以；37 天後管理員也拒絕", async () => {
    const day8 = await seedPdf(conv, owner, factoryId, new Date(Date.now() - DAY));
    for (const u of [buyer, owner, coMgr]) {
      await expect((await call(u)).getPdfDownloadUrl({ messageId: day8.messageId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "此型錄已逾期，無法下載" });
    }
    await expect((await call(admin, true)).getPdfDownloadUrl({ messageId: day8.messageId })).resolves.toHaveProperty("url");
    const day38 = await seedPdf(conv, owner, factoryId, new Date(Date.now() - CHAT_PDF_ADMIN_GRACE_MS - DAY));
    await expect((await call(admin, true)).getPdfDownloadUrl({ messageId: day38.messageId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("AU／AV：TTL 不會超過參與者期限／管理員寬限期", async () => {
    const soon = await seedPdf(conv, owner, factoryId, new Date(Date.now() + 60_000));
    const r = await (await call(buyer)).getPdfDownloadUrl({ messageId: soon.messageId });
    expect(r.expiresInSeconds).toBeLessThanOrEqual(60);
    const graceEnd = await seedPdf(conv, owner, factoryId, new Date(Date.now() - CHAT_PDF_ADMIN_GRACE_MS + 90_000));
    const a = await (await call(admin, true)).getPdfDownloadUrl({ messageId: graceEnd.messageId });
    expect(a.expiresInSeconds).toBeLessThanOrEqual(90);
  });
  it("AP：已刪除附件（deleted／deletedAt）→ 所有人包括管理員都拒絕；物件已不存在也拒絕", async () => {
    const del = await seedPdf(conv, owner, factoryId, new Date(Date.now() + DAY), { deleted: true, deletedAt: new Date().toISOString(), fileKey: null });
    await expect((await call(admin, true)).getPdfDownloadUrl({ messageId: del.messageId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const gone = await seedPdf(conv, owner, factoryId, new Date(Date.now() + DAY));
    h.store.delete(gone.fileKey);
    await expect((await call(buyer)).getPdfDownloadUrl({ messageId: gone.messageId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("AQ：舊格式（公開 fileUrl）一律拒絕，不回傳舊網址", async () => {
    await db.saveMessage(conv, owner, "factory", "", "pdf", {
      fileUrl: "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/chat-pdfs/1/x.pdf",
      fileKey: "chat-pdfs/1/x.pdf", fileName: "old.pdf", fileSize: 10, expiresAt: new Date(Date.now() + DAY).toISOString(),
    });
    const messageId = (await lastMessageId(conv))!;
    const err = await (await call(admin, true)).getPdfDownloadUrl({ messageId }).catch(e => e);
    expect(err).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(JSON.stringify(err)).not.toContain("amazonaws");
    expect(h.downloadCalls).toHaveLength(0);
  });
  it("AR／AS：非 PDF 訊息 BAD_REQUEST；訊息不存在 NOT_FOUND", async () => {
    await db.saveMessage(conv, owner, "factory", "hi", "text");
    await expect((await call(buyer)).getPdfDownloadUrl({ messageId: (await lastMessageId(conv))! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect((await call(buyer)).getPdfDownloadUrl({ messageId: 2147480000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("AW：Content-Disposition inline＋RFC5987；找消息預設仍是 attachment（不 regression）", () => {
    expect(buildContentDisposition("型錄 2026.pdf", "inline")).toBe(`inline; filename="__ 2026.pdf"; filename*=UTF-8''%E5%9E%8B%E9%8C%84%202026.pdf`);
    expect(buildContentDisposition("型錄 2026.pdf")).toBe(`attachment; filename="__ 2026.pdf"; filename*=UTF-8''%E5%9E%8B%E9%8C%84%202026.pdf`);
    expect(buildContentDisposition("a\r\nSet-Cookie: x.pdf", "inline")).not.toMatch(/[\r\n]/);
  });
});

describe("刪除對話（AY–BC）", () => {
  it("AY／AZ：刪 DB 前收集私有 PDF key，刪除後逐一刪除物件", async () => {
    const c = await mkConversation(buyer, factoryId);
    const a = await seedPdf(c, owner, factoryId, new Date(Date.now() + DAY));
    const b = await seedPdf(c, owner, factoryId, new Date(Date.now() - 40 * DAY));
    await db.saveMessage(c, buyer, "user", "hello", "text");
    await (await call(owner)).deleteConversation({ conversationId: c });
    expect(h.deleted.sort()).toEqual([a.fileKey, b.fileKey].sort());
    expect(await db.getConversationById(c)).toBeFalsy();
  });
  it("BA／BB：S3 刪除失敗不影響對話刪除，並記錄 log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = await mkConversation(buyer, factoryId);
    const a = await seedPdf(c, owner, factoryId, new Date(Date.now() + DAY));
    h.failDelete.set(a.fileKey, "InternalError");
    await expect((await call(owner)).deleteConversation({ conversationId: c })).resolves.toEqual({ success: true });
    expect(await db.getConversationById(c)).toBeFalsy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed to delete chat PDF object"), "InternalError");
    warn.mockRestore();
  });
  it("BC：沒有 PDF 的對話刪除不呼叫 S3", async () => {
    const c = await mkConversation(buyer, factoryId);
    await db.saveMessage(c, buyer, "user", "hello", "text");
    await (await call(owner)).deleteConversation({ conversationId: c });
    expect(h.deleted).toEqual([]);
  });
});

describe("cleanup job（BD–BK）", () => {
  async function seedForCleanup() {
    const c = await mkConversation(buyer, factoryId);
    const day36 = await seedPdf(c, owner, factoryId, new Date(Date.now() - 29 * DAY)); // 上傳後第 36 天
    const day38 = await seedPdf(c, owner, factoryId, new Date(Date.now() - 31 * DAY)); // 第 38 天
    const day39 = await seedPdf(c, owner, factoryId, new Date(Date.now() - 32 * DAY));
    const mine = new Set([day36.messageId, day38.messageId, day39.messageId]);
    const deps = {
      listDue: async (before: string, limit: number) => (await db.getChatPdfAttachmentsDueForCleanup(before, limit + 1000)).filter(r => mine.has(r.id)),
      deleteObject: async (key: string) => { const fail = h.failDelete.get(key); if (fail) throw Object.assign(new Error(fail), { name: fail }); h.deleted.push(key); h.store.delete(key); },
      markDeleted: db.markChatPdfAttachmentDeleted,
    };
    return { c, day36, day38, day39, deps };
  }
  const attachmentOf = async (id: number) => (await db.getMessageById(id))!.attachmentData as Record<string, unknown>;

  it("BD／BE／BF／BK：第 37 天前不動；之後刪除物件並標記 deleted、fileKey=null，檔名等保留，聊天仍顯示已逾期卡片", async () => {
    const s = await seedForCleanup();
    const r = await runChatPdfAttachmentCleanup({}, s.deps);
    expect(r).toMatchObject({ scanned: 2, deleted: 2, failed: 0 });
    expect(h.deleted.sort()).toEqual([s.day38.fileKey, s.day39.fileKey].sort());
    expect((await attachmentOf(s.day36.messageId)).fileKey).toBe(s.day36.fileKey);
    const after = await attachmentOf(s.day38.messageId);
    expect(after).toMatchObject({ deleted: true, fileKey: null, fileName: "型錄.pdf", fileSize: 2000, mimeType: "application/pdf", storage: "private" });
    expect(typeof after.deletedAt).toBe("string");
    const dto = (await (await call(buyer)).getMessages({ conversationId: s.c })).find(m => m.id === s.day38.messageId)!;
    expect(dto.attachmentData).toMatchObject({ fileName: "型錄.pdf", deleted: true });
  });
  it("BG／BH：NoSuchKey 視為已刪除並標記；其他 S3 錯誤不標記、計入 failed", async () => {
    const s = await seedForCleanup();
    h.failDelete.set(s.day38.fileKey, "NoSuchKey");
    h.failDelete.set(s.day39.fileKey, "AccessDenied");
    const r = await runChatPdfAttachmentCleanup({}, s.deps);
    expect(r).toMatchObject({ deleted: 1, failed: 1 });
    expect((await attachmentOf(s.day38.messageId)).deleted).toBe(true);
    expect((await attachmentOf(s.day39.messageId)).fileKey).toBe(s.day39.fileKey);
  });
  it("BI／BJ：重跑冪等；兩個排程同時跑也只標記一次、JSON 不損壞、不重新建立 key", async () => {
    const s = await seedForCleanup();
    const [a, b] = await Promise.all([runChatPdfAttachmentCleanup({}, s.deps), runChatPdfAttachmentCleanup({}, s.deps)]);
    expect(a.deleted + b.deleted).toBe(2);
    expect(a.failed + b.failed).toBe(0);
    const again = await runChatPdfAttachmentCleanup({}, s.deps);
    expect(again).toMatchObject({ scanned: 0, deleted: 0, failed: 0 });
    for (const m of [s.day38, s.day39]) {
      const data = await attachmentOf(m.messageId);
      expect(data).toMatchObject({ deleted: true, fileKey: null, fileName: "型錄.pdf" });
      expect(h.store.has(m.fileKey)).toBe(false);
    }
  });
});
