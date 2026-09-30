/**
 * Batch 3.5：聊天 PDF 型錄的純邏輯（檔名、暫存 key、metadata schema、DTO、下載
 * 期限、finalize 搬移）。S3 以記憶體假物件取代，不打任何網路。
 */
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_PDF_ACCESS_TTL_MS,
  CHAT_PDF_ADMIN_GRACE_MS,
  CHAT_PDF_MAX_BYTES,
  ChatPdfPromotionError,
  buildPrivateChatPdfAttachment,
  chatPdfFinalKey,
  createChatPdfTmpKey,
  decideChatPdfDownload,
  isChatPdfDueForPhysicalDeletion,
  isS3NotFoundError,
  parseChatPdfTmpKey,
  parsePrivateChatPdfAttachment,
  promoteChatPdfUpload,
  sanitizeChatPdfFileName,
  toChatPdfAttachmentDTO,
  toClientChatMessage,
  type ChatPdfStorage,
} from "./chatPdfAttachment";

const ID = "AbCdEfGhIjKlMnOpQrStU"; // 21 chars
const TMP = `chat-attachments/tmp/${ID}.pdf`;
const DAY = 24 * 60 * 60 * 1000;

describe("檔名清理（J／K）", () => {
  it("路徑、HTML 字元、控制字元、CRLF 換成 _，保留中文與空格", () => {
    expect(sanitizeChatPdfFileName("../../etc/<b>型錄\r\n2026 'x'&\"y\".pdf")).toBe("____etc__b_型錄__2026 _x___y_.pdf");
  });
  it("移除 Unicode 雙向控制字元（U+202A–202E、U+2066–2069）", () => {
    const name = sanitizeChatPdfFileName("invoice‮fdp.exe⁦⁩‪.pdf");
    expect(name).toBe("invoicefdp.exe.pdf");
    expect(name).not.toMatch(/[‪-‮⁦-⁩]/);
  });
  it("不是 .pdf → null；只有副檔名 → catalog.pdf", () => {
    expect(sanitizeChatPdfFileName("evil.exe")).toBeNull();
    expect(sanitizeChatPdfFileName("x.pdf.html")).toBeNull();
    expect(sanitizeChatPdfFileName(".pdf")).toBe("catalog.pdf");
  });
  it("超長檔名截到 100 字元並保留 .pdf（舊版會先截斷再誤判為非 PDF）", () => {
    const name = sanitizeChatPdfFileName("型".repeat(300) + ".pdf")!;
    expect(Array.from(name)).toHaveLength(100);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("暫存 key（L／O）", () => {
  it("server 產生 chat-attachments/tmp/{21 字元}.pdf，且可被解析", () => {
    const key = createChatPdfTmpKey();
    expect(key).toMatch(/^chat-attachments\/tmp\/[A-Za-z0-9_-]{21}\.pdf$/);
    expect(parseChatPdfTmpKey(key)).not.toBeNull();
  });
  it.each([
    `chat-attachments/tmp/../${ID}.pdf`,
    `chat-attachments/tmp/${ID}.pdf?x=1`,
    `chat-attachments/tmp/${ID}.pdf#a`,
    `chat-attachments/tmp/%2e%2e${ID.slice(4)}.pdf`,
    `chat-attachments/tmp/a/${ID}.pdf`,
    `chat-attachments/1/${ID}.pdf`,
    `news-attachments/tmp/${ID}.pdf`,
    `certification-evidence/1/${ID}.png`,
    `chat-attachments/tmp/${ID}.PDF`,
    `chat-attachments/tmp/${ID}.exe`,
    `chat-attachments/tmp/${ID.slice(1)}.pdf`,
    `s3://other-bucket/chat-attachments/tmp/${ID}.pdf`,
    `/chat-attachments/tmp/${ID}.pdf`,
    123,
  ])("拒絕 %s", (key) => {
    expect(parseChatPdfTmpKey(key)).toBeNull();
  });
  it("正式 key 由 factoryId＋同一個 id 決定（U）", () => {
    expect(chatPdfFinalKey(18, ID)).toBe(`chat-attachments/18/${ID}.pdf`);
    expect(() => chatPdfFinalKey(0, ID)).toThrow();
    expect(() => chatPdfFinalKey(1, "../x")).toThrow();
  });
});

const now = new Date("2026-10-01T00:00:00.000Z");
const att = (over: Record<string, unknown> = {}) => ({
  storage: "private", fileKey: `chat-attachments/18/${ID}.pdf`, fileName: "型錄.pdf", fileSize: 1234,
  mimeType: "application/pdf", expiresAt: new Date(now.getTime() + DAY).toISOString(), ...over,
});

describe("attachmentData runtime schema 與 DTO（Z–AE）", () => {
  it("新格式可解析；只存 metadata，沒有任何網址欄位", () => {
    const built = buildPrivateChatPdfAttachment({ fileKey: `chat-attachments/18/${ID}.pdf`, fileName: "a.pdf", fileSize: 10, expiresAt: now.toISOString() });
    expect(Object.keys(built).sort()).toEqual(["expiresAt", "fileKey", "fileName", "fileSize", "mimeType", "storage"]);
    expect(JSON.stringify(built)).not.toMatch(/https?:|amazonaws|fileUrl/);
    expect(parsePrivateChatPdfAttachment(built)).not.toBeNull();
  });
  it.each([
    ["舊格式（公開 fileUrl）", { fileUrl: "https://oxm-images-prod-2026.s3.amazonaws.com/chat-pdfs/1/x.pdf", fileKey: "chat-pdfs/1/x.pdf", fileName: "a.pdf", fileSize: 1, expiresAt: now.toISOString() }],
    ["新格式卻多帶 fileUrl", att({ fileUrl: "https://x" })],
    ["缺 storage", att({ storage: undefined })],
    ["key 指到其他 prefix", att({ fileKey: "news-attachments/1/x.pdf" })],
    ["未刪除卻沒有 key", att({ fileKey: null })],
    ["mimeType 不對", att({ mimeType: "text/html" })],
    ["不是物件", "string"],
    ["null", null],
  ])("%s → null", (_label, raw) => {
    expect(parsePrivateChatPdfAttachment(raw)).toBeNull();
  });
  it("DTO 只有 fileName／fileSize／mimeType／expiresAt／deleted，不含 key、bucket、網址", () => {
    const dto = toChatPdfAttachmentDTO(att());
    expect(Object.keys(dto).sort()).toEqual(["deleted", "expiresAt", "fileName", "fileSize", "mimeType"]);
    expect(JSON.stringify(dto)).not.toMatch(/chat-attachments|amazonaws|https?:|fileKey|storage/);
    expect(dto).toMatchObject({ fileName: "型錄.pdf", fileSize: 1234, deleted: false });
    expect(toChatPdfAttachmentDTO(att({ deleted: true, deletedAt: now.toISOString(), fileKey: null })).deleted).toBe(true);
  });
  it("無法解析的 PDF 附件不會把原始 JSON 帶出去", () => {
    const dto = toChatPdfAttachmentDTO({ fileUrl: "https://leak.example/x.pdf", fileKey: "chat-pdfs/x.pdf", fileName: "x.pdf" });
    expect(JSON.stringify(dto)).not.toMatch(/leak|chat-pdfs/);
    expect(dto.deleted).toBe(true);
  });
  it("toClientChatMessage 只改寫 pdf，其他類型的 attachmentData 原樣回傳（AE）", () => {
    const product = { id: 1, type: "product", attachmentData: { productIds: [1], snapshot: [{ factoryId: 3 }] } };
    const order = { id: 2, type: "collaboration_order", attachmentData: { subType: "cancel_request", orderId: 5 } };
    const invite = { id: 3, type: "co_manager_invite", attachmentData: null };
    for (const m of [product, order, invite]) expect(toClientChatMessage(m)).toBe(m);
    const pdf = toClientChatMessage({ id: 4, type: "pdf", attachmentData: att() as unknown });
    expect(pdf.attachmentData).not.toHaveProperty("fileKey");
  });
});

describe("下載期限（Z／AA／AT–AV）", () => {
  const parsed = (over: Record<string, unknown> = {}) => parsePrivateChatPdfAttachment(att(over));
  it("一般參與者：期限內 OK，TTL ≤ 300 且不超過 expiresAt", () => {
    const d = decideChatPdfDownload(parsed(), { isAdmin: false, now });
    expect(d).toMatchObject({ ok: true, ttlSeconds: 300 });
    const near = decideChatPdfDownload(parsed({ expiresAt: new Date(now.getTime() + 42_000).toISOString() }), { isAdmin: false, now });
    expect(near).toMatchObject({ ok: true, ttlSeconds: 42 });
  });
  it("一般參與者：過期後拒絕（即使仍在寬限期）", () => {
    const d = decideChatPdfDownload(parsed({ expiresAt: new Date(now.getTime() - DAY).toISOString() }), { isAdmin: false, now });
    expect(d).toMatchObject({ ok: false, message: "此型錄已逾期，無法下載" });
  });
  it("管理員：第 8～37 天可以，TTL 不超過寬限期；超過 37 天拒絕", () => {
    const exp = now.getTime() - DAY; // 上傳後第 8 天
    expect(decideChatPdfDownload(parsed({ expiresAt: new Date(exp).toISOString() }), { isAdmin: true, now })).toMatchObject({ ok: true, ttlSeconds: 300 });
    const nearGraceEnd = new Date(now.getTime() - CHAT_PDF_ADMIN_GRACE_MS + 10_000).toISOString();
    expect(decideChatPdfDownload(parsed({ expiresAt: nearGraceEnd }), { isAdmin: true, now })).toMatchObject({ ok: true, ttlSeconds: 10 });
    const past = new Date(now.getTime() - CHAT_PDF_ADMIN_GRACE_MS - 1000).toISOString();
    expect(decideChatPdfDownload(parsed({ expiresAt: past }), { isAdmin: true, now }).ok).toBe(false);
  });
  it("已刪除：所有人（包括管理員）都拒絕；無法解析也拒絕", () => {
    for (const over of [{ deleted: true, fileKey: null }, { deletedAt: now.toISOString(), fileKey: null }]) {
      expect(decideChatPdfDownload(parsed(over), { isAdmin: true, now })).toMatchObject({ ok: false, message: "此型錄已被刪除" });
    }
    expect(decideChatPdfDownload(null, { isAdmin: true, now }).ok).toBe(false);
  });
  it("實體刪除時間點是 expiresAt + 30 天（上傳後第 37 天）", () => {
    const uploaded = now.getTime() - 36 * DAY;
    const a = parsePrivateChatPdfAttachment(att({ expiresAt: new Date(uploaded + CHAT_PDF_ACCESS_TTL_MS).toISOString() }))!;
    expect(isChatPdfDueForPhysicalDeletion(a, now)).toBe(false);
    expect(isChatPdfDueForPhysicalDeletion(a, new Date(now.getTime() + DAY))).toBe(true);
  });
});

// ── finalize：記憶體假 S3 ────────────────────────────────────────────────
type Obj = { body: Buffer; contentType: string; etag: string };
function memoryStorage(initial: Record<string, Obj> = {}) {
  const objects = new Map(Object.entries(initial));
  const calls: string[] = [];
  const storage: ChatPdfStorage = {
    head: async (key) => {
      calls.push(`head:${key}`);
      const o = objects.get(key);
      return o ? { exists: true, sizeBytes: o.body.length, contentType: o.contentType, etag: o.etag } : { exists: false, sizeBytes: 0, contentType: null, etag: null };
    },
    readHeadBytes: async (key, n) => { calls.push(`read:${key}`); return objects.get(key)!.body.subarray(0, n); },
    copy: async (src, dst) => { calls.push(`copy:${src}->${dst}`); objects.set(dst, { ...objects.get(src)! }); },
    delete: async (key) => { calls.push(`delete:${key}`); objects.delete(key); },
  };
  return { storage, objects, calls };
}
const pdf = (size = 150 * 1024) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(size - 9, 0x20)]);
const obj = (body: Buffer, contentType = "application/pdf", etag = '"abc123"'): Obj => ({ body, contentType, etag });

describe("promoteChatPdfUpload（O–Y）", () => {
  it("T／U／V：合法 PDF（>100KB）搬到 chat-attachments/{factoryId}/{同 id}.pdf，暫存刪除，順序正確", async () => {
    const m = memoryStorage({ [TMP]: obj(pdf()) });
    const r = await promoteChatPdfUpload({ uploadKey: TMP, factoryId: 18 }, m.storage);
    expect(r).toEqual({ fileKey: `chat-attachments/18/${ID}.pdf`, sizeBytes: 150 * 1024 });
    expect(m.objects.has(TMP)).toBe(false);
    expect(m.objects.has(r.fileKey)).toBe(true);
    const order = m.calls.map(c => c.split(":")[0]);
    expect(order).toEqual(["head", "read", "head", "copy", "head", "delete"]);
  });
  it("O：不合法 key 直接拒絕，完全不碰 S3", async () => {
    const m = memoryStorage();
    await expect(promoteChatPdfUpload({ uploadKey: "news-attachments/tmp/x.pdf", factoryId: 1 }, m.storage)).rejects.toMatchObject({ reason: "invalid_upload_key" });
    expect(m.calls).toEqual([]);
  });
  it("P：暫存物件不存在", async () => {
    await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, memoryStorage().storage)).rejects.toMatchObject({ reason: "upload_missing" });
  });
  it.each([
    ["Q 實際 >10MB", obj(pdf(CHAT_PDF_MAX_BYTES + 1)), "invalid_size"],
    ["空檔", obj(Buffer.alloc(0)), "invalid_size"],
    ["R Content-Type 不是 application/pdf", obj(pdf(), "application/octet-stream"), "invalid_content_type"],
    ["S 只有 %PDF 沒有 -", obj(Buffer.from("%PDF1.7 not really")), "invalid_pdf"],
    ["S HTML 偽裝", obj(Buffer.from("<html><script>alert(1)</script>")), "invalid_pdf"],
  ])("%s → 拒絕並刪除暫存", async (_l, o, reason) => {
    const m = memoryStorage({ [TMP]: o });
    await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage)).rejects.toMatchObject({ reason });
    expect(m.objects.size).toBe(0);
    expect(m.calls.some(c => c.startsWith("copy"))).toBe(false);
  });
  it("X：copy 失敗 → 拋錯（呼叫端不會寫訊息）", async () => {
    const m = memoryStorage({ [TMP]: obj(pdf()) });
    m.storage.copy = vi.fn().mockRejectedValue(new Error("AccessDenied"));
    await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage)).rejects.toBeInstanceOf(ChatPdfPromotionError);
  });
  it("copy 後驗證失敗（大小不符）→ verification_failed", async () => {
    const m = memoryStorage({ [TMP]: obj(pdf()) });
    m.storage.copy = async (_s, d) => { m.objects.set(d, obj(pdf(1000))); };
    await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage)).rejects.toMatchObject({ reason: "verification_failed" });
  });
  it("20：目標已存在且內容相同（同大小、同 ETag）→ 沿用、不覆蓋；內容不同或 ETag 無法比較 → fail closed", async () => {
    const final = `chat-attachments/1/${ID}.pdf`;
    const same = memoryStorage({ [TMP]: obj(pdf()), [final]: obj(pdf()) });
    await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, same.storage)).resolves.toMatchObject({ fileKey: final });
    expect(same.calls.some(c => c.startsWith("copy"))).toBe(false);
    for (const existing of [obj(pdf(2000)), obj(pdf(), "application/pdf", '"other"'), obj(pdf(), "application/pdf", '"abc-2"')]) {
      const m = memoryStorage({ [TMP]: obj(pdf()), [final]: existing });
      await expect(promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage)).rejects.toMatchObject({ reason: "destination_collision" });
      expect(m.objects.get(final)).toBe(existing);
    }
  });
  it("Y：同一個 upload 重試（上次 copy 成功、DB 失敗）→ 沿用已存在的正式物件，不重複建立", async () => {
    const m = memoryStorage({ [TMP]: obj(pdf()) });
    const first = await promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage);
    m.objects.set(TMP, obj(pdf())); // 使用者重新 finalize 同一個 key（暫存已被刪，這裡模擬仍在）
    const second = await promoteChatPdfUpload({ uploadKey: TMP, factoryId: 1 }, m.storage);
    expect(second.fileKey).toBe(first.fileKey);
  });
});

describe("isS3NotFoundError", () => {
  it("只把 NoSuchKey／NotFound 當成「本來就不存在」", () => {
    expect(isS3NotFoundError({ name: "NoSuchKey" })).toBe(true);
    expect(isS3NotFoundError({ name: "NotFound" })).toBe(true);
    expect(isS3NotFoundError({ name: "AccessDenied" })).toBe(false);
    expect(isS3NotFoundError(new Error("x"))).toBe(false);
  });
});

describe("結構性保證（§39／§59／§58）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, f), "utf-8");
  it("Express JSON body：聊天 PDF 沒有被加進 15mb allowlist，一般 API 維持 100kb", () => {
    const index = read("_core/index.ts");
    const allow = /if \(\/([^/]+)\/\.test\(path\)\)/.exec(index)![1];
    expect(allow).not.toMatch(/pdf|Pdf|chat/i);
    expect(index).toMatch(/express\.json\(\{ limit: "100kb" \}\)/);
  });
  it("聊天 PDF 相關程式不會把簽章網址或 attachmentData 寫進 log", () => {
    const routers = read("routers.ts");
    const chat = routers.slice(routers.indexOf("createPdfUploadSession: protectedProcedure"), routers.indexOf("unreadCount: protectedProcedure"));
    expect(chat).not.toMatch(/console\.(log|warn|error|info)\([^)]*(url|Url|attachment)/);
    for (const f of ["chatPdfAttachment.ts", "jobs/cleanupExpiredChatPdfAttachments.ts"]) {
      expect(read(f)).not.toMatch(/console\.[a-z]+\([^)]*(uploadUrl|downloadUrl|X-Amz|fileKey)/);
    }
  });
  it("舊的公開 bucket 路徑完全移除：沒有 sendPdf、chat-pdfs／、storagePresignedUrl", () => {
    const routers = read("routers.ts");
    expect(routers).not.toMatch(/sendPdf:|chat-pdfs\/|storagePresignedUrl/);
    expect(read("storage.ts")).not.toMatch(/storagePresignedUrl|getSignedUrl/);
    expect(fs.existsSync(path.resolve(__dirname, "../scripts/cleanup-expired-pdfs.ts"))).toBe(false);
  });
});
