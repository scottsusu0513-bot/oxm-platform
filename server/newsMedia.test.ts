/**
 * 找消息封面圖片／內文圖片／PDF 附件（含下載期限＋自動清理）回歸測試。
 *
 * PDF 附件改用獨立的私有 S3 bucket（server/privateStorage.ts），跟既有公開
 * 圖片 bucket（server/storage.ts，從未對任何物件設定 ACL、getPublicUrl 假設
 * 一律公開可讀）完全分開，避免重蹈既有聊天室 PDF 型錄功能「永久公開 fileUrl
 * fallback」的覆轍。這裡涵蓋：圖片驗證、封面 CRUD、newsAttachments metadata
 * CRUD、到期規則（after_publish_30d／custom／never）語意、第一次發布時設定
 * 期限、公開白名單欄位、排程清理的成功/失敗/重試/冪等、Markdown 工具列共用
 * 元件、MarkdownContent 的 allowImages opt-in。
 *
 * DB 層走真實本機測試資料庫（受 server/test-db-guard.ts 保護）。router／前端
 * 行為採用本檔案其他測試已經在用的原始碼內容斷言手法，不 import 頁面元件
 * 本身、不建立真正的 tRPC caller。任何會呼叫 AWS SDK 的路徑（privateStorage
 * 的 upload/head/delete/download）一律用 vi.mock 取代，不寫入真正的 S3。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql, eq } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";
import { validateImageUpload } from "./_core/security";
import { newsAttachments } from "../drizzle/schema";

// newsAttachments.downloadExpiresAt 是 MySQL timestamp（0 fsp，不含小數秒），
// 寫入時毫秒部分會被四捨五入或捨去（實際行為視 MySQL 版本而定），讀回來跟
// 原本毫秒精度的 Date 比較，一定會有最多 1 秒的落差，屬於欄位精度本身的限制，
// 不是邏輯錯誤——比較時允許最多 1 秒的誤差，而不是要求完全相等。
function expectSameSecond(actual: Date, expected: Date): void {
  const diff = Math.abs(actual.getTime() - expected.getTime());
  expect(diff).toBeLessThanOrEqual(1000);
}

const runId = `newsmedia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`Media Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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

async function cleanupNews(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM news WHERE id = ${id}`); // cascade 一併清掉 newsAttachments
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]); // RIFF
const FAKE_MAGIC = Buffer.from("this is not an image, just renamed", "utf-8");
const PDF_MAGIC = Buffer.from("%PDF-1.4\n...", "utf-8");

describe("validateImageUpload：格式與大小驗證（可自訂 maxBytes，預設行為不變）", () => {
  it("真實 JPEG/PNG/WEBP magic bytes 通過", async () => {
    expect((await validateImageUpload(JPEG_MAGIC)).valid).toBe(true);
    expect((await validateImageUpload(PNG_MAGIC)).valid).toBe(true);
    expect((await validateImageUpload(WEBP_MAGIC)).valid).toBe(true);
  });

  it("偽造副檔名／MIME（內容不是任何已知圖片格式）被拒絕", async () => {
    const result = await validateImageUpload(FAKE_MAGIC);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/不支持的圖片格式/);
  });

  it("偽裝成圖片的 PDF 內容（magic bytes 是 %PDF-）被拒絕，不會被誤判為圖片", async () => {
    const result = await validateImageUpload(PDF_MAGIC);
    expect(result.valid).toBe(false);
  });

  it("預設 5MB 上限不變（既有呼叫端如工廠大頭貼／社群貼文圖片行為不受影響）", async () => {
    const big = Buffer.concat([JPEG_MAGIC, Buffer.alloc(5 * 1024 * 1024)]); // 略超過 5MB
    const result = await validateImageUpload(big);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/5MB/);
  });

  it("找消息用 10MB 上限：6MB 通過、超過 10MB 被拒絕", async () => {
    const sixMb = Buffer.concat([JPEG_MAGIC, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await validateImageUpload(sixMb, 10 * 1024 * 1024)).valid).toBe(true);

    const elevenMb = Buffer.concat([JPEG_MAGIC, Buffer.alloc(11 * 1024 * 1024)]);
    const result = await validateImageUpload(elevenMb, 10 * 1024 * 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/10MB/);
  });
});

describe("news 封面圖片：DB 層 CRUD", () => {
  it("setNewsCover 寫入三個欄位，回傳更新前的 previousKey（第一次是 null）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cover-set-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const result = await db.setNewsCover(newsId, { key: "news-covers/1/a.jpg", url: "https://example-bucket.s3.amazonaws.com/news-covers/1/a.jpg", alt: "封面說明" });
      expect(result.previousKey).toBeNull();

      const row = await db.getNewsById(newsId);
      expect(row?.coverImageKey).toBe("news-covers/1/a.jpg");
      expect(row?.coverImageUrl).toBe("https://example-bucket.s3.amazonaws.com/news-covers/1/a.jpg");
      expect(row?.coverImageAlt).toBe("封面說明");
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("再次 setNewsCover（更換封面）回傳上一張的 key，讓呼叫端可以刪除舊物件", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cover-replace-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.setNewsCover(newsId, { key: "news-covers/1/old.jpg", url: "https://x/old.jpg", alt: null });
      const result = await db.setNewsCover(newsId, { key: "news-covers/1/new.jpg", url: "https://x/new.jpg", alt: null });
      expect(result.previousKey).toBe("news-covers/1/old.jpg");

      const row = await db.getNewsById(newsId);
      expect(row?.coverImageKey).toBe("news-covers/1/new.jpg");
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("clearNewsCover 清空三個欄位並回傳被清空前的 key", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cover-clear-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.setNewsCover(newsId, { key: "news-covers/1/a.jpg", url: "https://x/a.jpg", alt: "alt" });

      const result = await db.clearNewsCover(newsId);
      expect(result.previousKey).toBe("news-covers/1/a.jpg");

      const row = await db.getNewsById(newsId);
      expect(row?.coverImageKey).toBeNull();
      expect(row?.coverImageUrl).toBeNull();
      expect(row?.coverImageAlt).toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("已發布消息設定封面後，公開 getPublishedNewsBySlug 能取得封面資訊", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const created = await db.createNews({
        slug: `cover-public-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      });
      newsId = created.id;
      await db.setNewsCover(newsId, { key: "news-covers/1/a.jpg", url: "https://x/a.jpg", alt: "封面替代文字" });

      const publicRow = await db.getPublishedNewsBySlug(`cover-public-${runId}`);
      expect(publicRow?.coverImageUrl).toBe("https://x/a.jpg");
      expect(publicRow?.coverImageAlt).toBe("封面替代文字");
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("草稿消息即使設了封面，公開 API 一律取不到（getPublishedNewsBySlug 回傳 undefined）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cover-draft-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.setNewsCover(newsId, { key: "news-covers/1/a.jpg", url: "https://x/a.jpg", alt: null });

      const publicRow = await db.getPublishedNewsBySlug(`cover-draft-${runId}`);
      expect(publicRow).toBeUndefined();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("newsAttachments：metadata CRUD（資料層已就緒，尚未接上傳/下載 endpoint）", () => {
  it("createNewsAttachment 依上傳順序遞增 sortOrder", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-order-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const id1 = await db.createNewsAttachment({
        newsId, displayName: "第一份.pdf", originalFileName: "a.pdf", storageKey: "news-attachments/1/a.pdf",
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      const id2 = await db.createNewsAttachment({
        newsId, displayName: "第二份.pdf", originalFileName: "b.pdf", storageKey: "news-attachments/1/b.pdf",
        mimeType: "application/pdf", sizeBytes: 2000, uploadedBy: creator, expirationType: "never",
      });

      const adminRows = await db.getNewsAttachmentsForAdmin(newsId);
      expect(adminRows.map(r => r.id)).toEqual([id1, id2]);
      expect(adminRows[0].sortOrder).toBe(0);
      expect(adminRows[1].sortOrder).toBe(1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("getNewsAttachmentsPublic 只回傳白名單欄位，不含 storageKey／mimeType", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-public-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.createNewsAttachment({
        newsId, displayName: "公開名稱.pdf", originalFileName: "secret-name.pdf", storageKey: "news-attachments/1/secret-key.pdf",
        mimeType: "application/pdf", sizeBytes: 4800000, uploadedBy: creator, expirationType: "never",
      });

      const rows = await db.getNewsAttachmentsPublic(newsId);
      expect(rows.length).toBe(1);
      expect(rows[0].displayName).toBe("公開名稱.pdf");
      expect(rows[0].sizeBytes).toBe(4800000);
      expect(Object.keys(rows[0]).sort()).toEqual(
        ["id", "displayName", "sizeBytes", "sortOrder", "expirationType", "downloadExpiresAt", "isExpired", "isStorageDeleted"].sort(),
      );
      expect(JSON.stringify(rows[0])).not.toMatch(/secret-key|storageKey|application\/pdf/);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("renameNewsAttachment 只改 displayName，不影響 originalFileName／storageKey", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-rename-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "舊名稱.pdf", originalFileName: "orig.pdf", storageKey: "news-attachments/1/x.pdf",
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      await db.renameNewsAttachment(attId, "新的對外顯示名稱.pdf");

      const row = await db.getNewsAttachmentById(attId);
      expect(row?.displayName).toBe("新的對外顯示名稱.pdf");
      expect(row?.originalFileName).toBe("orig.pdf");
      expect(row?.storageKey).toBe("news-attachments/1/x.pdf");
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("deleteNewsAttachment 回傳被刪除那筆的 storageKey、且只刪除該筆，其他附件不受影響", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-delete-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const id1 = await db.createNewsAttachment({
        newsId, displayName: "留下.pdf", originalFileName: "keep.pdf", storageKey: "news-attachments/1/keep.pdf",
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      const id2 = await db.createNewsAttachment({
        newsId, displayName: "刪除.pdf", originalFileName: "gone.pdf", storageKey: "news-attachments/1/gone.pdf",
        mimeType: "application/pdf", sizeBytes: 2000, uploadedBy: creator, expirationType: "never",
      });

      const result = await db.deleteNewsAttachment(id2);
      expect(result?.storageKey).toBe("news-attachments/1/gone.pdf");

      const remaining = await db.getNewsAttachmentsForAdmin(newsId);
      expect(remaining.map(r => r.id)).toEqual([id1]);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("刪除 news 時 newsAttachments 隨 cascade FK 一併清除（不留孤兒 metadata 列）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-cascade-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: "news-attachments/1/x.pdf",
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });

      const conn = await getDb();
      await conn!.execute(sql`DELETE FROM news WHERE id = ${newsId}`);
      newsId = undefined; // 已經手動清掉了，finally 不用再刪一次

      const [rows] = await conn!.execute(sql`SELECT COUNT(*) as n FROM newsAttachments WHERE storageKey = ${"news-attachments/1/x.pdf"}`) as unknown as [{ n: number }[], unknown];
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("newsAttachments：到期規則語意（expirationType 三種模式）", () => {
  it("每篇消息最多 5 份附件，第 6 份在 transaction 內被原子性拒絕", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-max5-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      for (let i = 0; i < 5; i++) {
        await db.createNewsAttachment({
          newsId, displayName: `第${i}.pdf`, originalFileName: `f${i}.pdf`, storageKey: `news-attachments/${runId}/f${i}.pdf`,
          mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
        });
      }
      await expect(db.createNewsAttachment({
        newsId, displayName: "第六.pdf", originalFileName: "f6.pdf", storageKey: `news-attachments/${runId}/f6.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      })).rejects.toThrow(/最多只能有 5 份附件/);

      const rows = await db.getNewsAttachmentsForAdmin(newsId);
      expect(rows.length).toBe(5);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("expirationType=custom 缺少到期時間，或到期時間不是未來時間，一律被拒絕", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-custom-invalid-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const base = {
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/custom.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom" as const,
      };
      await expect(db.createNewsAttachment({ ...base })).rejects.toThrow(/晚於目前時間/);
      await expect(db.createNewsAttachment({ ...base, customDownloadExpiresAt: new Date(Date.now() - 60_000) })).rejects.toThrow(/晚於目前時間/);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("expirationType=after_publish_30d，消息還是草稿時 downloadExpiresAt 維持 null（等第一次發布才設定）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-draft-30d-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/draft30d.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "after_publish_30d",
      });
      const row = await db.getNewsAttachmentById(attId);
      expect(row?.downloadExpiresAt).toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("expirationType=after_publish_30d，消息已經發布過才補上傳，downloadExpiresAt 直接從上傳完成時間起算 30 天", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-postpublish-30d-${runId}`, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
      })).id;
      const before = Date.now();
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/postpublish30d.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "after_publish_30d",
      });
      const row = await db.getNewsAttachmentById(attId);
      expect(row?.downloadExpiresAt).not.toBeNull();
      const diffDays = (row!.downloadExpiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThan(29.9);
      expect(diffDays).toBeLessThan(30.1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("computeNewsAttachmentStatus：never 一律不算過期；custom 過了時間才算過期；storageDeletedAt 有值才算已刪除", () => {
    expect(db.computeNewsAttachmentStatus({ expirationType: "never", downloadExpiresAt: new Date(Date.now() - 1000), storageDeletedAt: null }).isExpired).toBe(false);
    expect(db.computeNewsAttachmentStatus({ expirationType: "custom", downloadExpiresAt: new Date(Date.now() - 1000), storageDeletedAt: null }).isExpired).toBe(true);
    expect(db.computeNewsAttachmentStatus({ expirationType: "custom", downloadExpiresAt: new Date(Date.now() + 60_000), storageDeletedAt: null }).isExpired).toBe(false);
    expect(db.computeNewsAttachmentStatus({ expirationType: "never", downloadExpiresAt: null, storageDeletedAt: new Date() }).isStorageDeleted).toBe(true);
  });

  it("updateNewsAttachmentExpiration：storageDeletedAt 已有值時拒絕修改，要求重新上傳", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-deleted-revive-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/revive.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      await db.markNewsAttachmentStorageDeleted(attId);

      await expect(db.updateNewsAttachmentExpiration(attId, { expirationType: "never" }))
        .rejects.toThrow(/請重新上傳/);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("updateNewsAttachmentExpiration：改成 never 會清空 downloadExpiresAt；改成 custom 需要未來時間", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-update-exp-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/updateexp.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator,
        expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 60_000),
      });

      await db.updateNewsAttachmentExpiration(attId, { expirationType: "never" });
      let row = await db.getNewsAttachmentById(attId);
      expect(row?.expirationType).toBe("never");
      expect(row?.downloadExpiresAt).toBeNull();

      await expect(db.updateNewsAttachmentExpiration(attId, { expirationType: "custom", downloadExpiresAt: new Date(Date.now() - 1000) }))
        .rejects.toThrow(/晚於目前時間/);

      const future = new Date(Date.now() + 3600_000);
      await db.updateNewsAttachmentExpiration(attId, { expirationType: "custom", downloadExpiresAt: future });
      row = await db.getNewsAttachmentById(attId);
      expect(row?.expirationType).toBe("custom");
      expectSameSecond(row!.downloadExpiresAt!, future);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("newsAttachments：第一次發布時設定期限（整合進 updateNews 既有的原子 transaction）", () => {
  it("草稿階段上傳的 after_publish_30d 附件，第一次發布時被設定為 firstPublishedAt + 30 天", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-firstpublish-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/firstpublish.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "after_publish_30d",
      });

      const before = Date.now();
      await db.updateNews(newsId, { status: "published" });
      const row = await db.getNewsAttachmentById(attId);
      expect(row?.downloadExpiresAt).not.toBeNull();
      const diffDays = (row!.downloadExpiresAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThan(29.9);
      expect(diffDays).toBeLessThan(30.1);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("編輯已發布消息、或下架後重新發布，都不會重置已經設定好的 downloadExpiresAt", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-no-reset-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/noreset.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "after_publish_30d",
      });
      await db.updateNews(newsId, { status: "published" });
      const firstExpiry = (await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime();
      expect(firstExpiry).toBeTypeOf("number");

      // 編輯內容（不改狀態）
      await db.updateNews(newsId, { title: "改過的標題" });
      expect((await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime()).toBe(firstExpiry);

      // 下架
      await db.updateNews(newsId, { status: "withdrawn" });
      expect((await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime()).toBe(firstExpiry);

      // 重新發布
      await db.updateNews(newsId, { status: "published" });
      expect((await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime()).toBe(firstExpiry);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("expirationType=custom／never 的附件不受第一次發布影響", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-unaffected-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const customExpiry = new Date(Date.now() + 3600_000);
      const customId = await db.createNewsAttachment({
        newsId, displayName: "c.pdf", originalFileName: "c.pdf", storageKey: `news-attachments/${runId}/custom-unaffected.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom", customDownloadExpiresAt: customExpiry,
      });
      const neverId = await db.createNewsAttachment({
        newsId, displayName: "n.pdf", originalFileName: "n.pdf", storageKey: `news-attachments/${runId}/never-unaffected.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });

      await db.updateNews(newsId, { status: "published" });

      const customRow = await db.getNewsAttachmentById(customId);
      expectSameSecond(customRow!.downloadExpiresAt!, customExpiry);
      expect((await db.getNewsAttachmentById(neverId))?.downloadExpiresAt).toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("重試／併發安全：連續呼叫兩次轉為 published，只有第一次真正設定期限（第二次 shouldNotify 為 false，期限不會被再次推算）", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-retry-safe-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/retrysafe.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "after_publish_30d",
      });

      const r1 = await db.updateNews(newsId, { status: "published" });
      expect(r1.shouldNotify).toBe(true);
      const firstExpiry = (await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime();

      await new Promise(resolve => setTimeout(resolve, 20));
      const r2 = await db.updateNews(newsId, { status: "published" });
      expect(r2.shouldNotify).toBe(false);
      expect((await db.getNewsAttachmentById(attId))?.downloadExpiresAt?.getTime()).toBe(firstExpiry);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("newsAttachments：排程清理用的查詢與狀態寫入（不含實際 S3 呼叫，見 server/jobs/cleanupExpiredNewsAttachments.test.ts）", () => {
  // 刻意用 drizzle 的型別化 update API（而不是 raw sql 樣板字串），跟應用程式
  // 本身寫入 downloadExpiresAt 的路徑（db.createNewsAttachment／updateNews／
  // updateNewsAttachmentExpiration）走同一套 mapToDriverValue 序列化。這兩套
  // 路徑對「同一個 JS Date」的序列化方式不同（raw sql 樣板字串走 mysql2 原生
  // Date 序列化，型別化 API 走 drizzle 欄位層的序列化），混用會在 MySQL
  // session time_zone 不是 UTC 時（例如本機常見的 SYSTEM／Asia/Taipei）造成
  // 一個時區 offset 的落差，讓測試資料本身就不一致。
  async function backdateExpiry(id: number, when: Date): Promise<void> {
    const conn = await getDb();
    await conn!.update(newsAttachments).set({ downloadExpiresAt: when }).where(eq(newsAttachments.id, id));
  }

  it("getNewsAttachmentsDueForCleanup 只選到期、非永久、尚未刪除的附件", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-due-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;

      const dueId = await db.createNewsAttachment({
        newsId, displayName: "due.pdf", originalFileName: "due.pdf", storageKey: `news-attachments/${runId}/due.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 60_000),
      });
      await backdateExpiry(dueId, new Date(Date.now() - 60_000));

      const notYetDueId = await db.createNewsAttachment({
        newsId, displayName: "future.pdf", originalFileName: "future.pdf", storageKey: `news-attachments/${runId}/future.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 3600_000),
      });

      const neverId = await db.createNewsAttachment({
        newsId, displayName: "never.pdf", originalFileName: "never.pdf", storageKey: `news-attachments/${runId}/never.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });

      const alreadyDeletedId = await db.createNewsAttachment({
        newsId, displayName: "deleted.pdf", originalFileName: "deleted.pdf", storageKey: `news-attachments/${runId}/deleted.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 60_000),
      });
      await backdateExpiry(alreadyDeletedId, new Date(Date.now() - 60_000));
      await db.markNewsAttachmentStorageDeleted(alreadyDeletedId);

      const due = await db.getNewsAttachmentsDueForCleanup(1000);
      const dueIds = due.map(d => d.id);
      expect(dueIds).toContain(dueId);
      expect(dueIds).not.toContain(notYetDueId);
      expect(dueIds).not.toContain(neverId);
      expect(dueIds).not.toContain(alreadyDeletedId);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("markNewsAttachmentStorageDeleted 設定 storageDeletedAt、清空 deleteFailureReason", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-mark-deleted-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/markdeleted.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      await db.recordNewsAttachmentDeleteFailure(attId, "先前失敗過一次");
      await db.markNewsAttachmentStorageDeleted(attId);

      const row = await db.getNewsAttachmentById(attId);
      expect(row?.storageDeletedAt).not.toBeNull();
      expect(row?.deleteFailureReason).toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("recordNewsAttachmentDeleteFailure 累加 deleteAttempts、截斷過長的失敗原因、不設定 storageDeletedAt", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `attach-record-failure-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const attId = await db.createNewsAttachment({
        newsId, displayName: "x.pdf", originalFileName: "x.pdf", storageKey: `news-attachments/${runId}/recordfailure.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });

      await db.recordNewsAttachmentDeleteFailure(attId, "x".repeat(500));
      let row = await db.getNewsAttachmentById(attId);
      expect(row?.deleteAttempts).toBe(1);
      expect(row?.storageDeletedAt).toBeNull();
      expect((row?.deleteFailureReason?.length ?? 0)).toBeLessThanOrEqual(280);

      await db.recordNewsAttachmentDeleteFailure(attId, "second failure");
      row = await db.getNewsAttachmentById(attId);
      expect(row?.deleteAttempts).toBe(2);
      expect(row?.deleteFailureReason).toBe("second failure");
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("privateStorage：私有 PDF 憑證與公開圖片憑證完全分離、四項缺一律 fail-closed", () => {
  const PRIVATE_ENV_KEYS = [
    "AWS_PRIVATE_FILES_BUCKET",
    "AWS_PRIVATE_FILES_REGION",
    "AWS_PRIVATE_FILES_ACCESS_KEY_ID",
    "AWS_PRIVATE_FILES_SECRET_ACCESS_KEY",
  ] as const;
  const WATCHED_KEYS = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", ...PRIVATE_ENV_KEYS] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(WATCHED_KEYS.map(k => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of WATCHED_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("本機測試環境本來就完全沒有設定任何 AWS 變數：isPrivateStorageConfigured 回傳 false", async () => {
    const { isPrivateStorageConfigured } = await import("./privateStorage");
    expect(isPrivateStorageConfigured()).toBe(false);
  });

  it("upload／head／delete／copy／download 相關 helper 一律 throw，不會 fallback 到公開 bucket 或生出假的公開網址", async () => {
    const ps = await import("./privateStorage");
    await expect(ps.privateStorageCreateUploadUrl("k.pdf", "application/pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
    await expect(ps.privateStorageHeadObject("k.pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
    await expect(ps.privateStorageDeleteObject("k.pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
    await expect(ps.privateStorageCopyObject("a.pdf", "b.pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
    await expect(ps.privateStorageCreateDownloadUrl("k.pdf", "顯示名稱.pdf", 300)).rejects.toThrow(/私有附件儲存尚未設定/);
  });

  it("只有公開圖片憑證（AWS_ACCESS_KEY_ID／AWS_SECRET_ACCESS_KEY）時，私有 PDF 功能仍視為未設定、拒絕執行——不會 fallback 借用公開憑證", async () => {
    process.env.AWS_ACCESS_KEY_ID = "public-fake-access-key-for-test";
    process.env.AWS_SECRET_ACCESS_KEY = "public-fake-secret-key-for-test";
    for (const k of PRIVATE_ENV_KEYS) delete process.env[k];

    const ps = await import("./privateStorage");
    expect(ps.isPrivateStorageConfigured()).toBe(false);
    await expect(ps.privateStorageCreateUploadUrl("k.pdf", "application/pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
    await expect(ps.privateStorageDeleteObject("k.pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
  });

  it("私有四項變數只要缺一項（例如只缺 SECRET_ACCESS_KEY），也視為未設定、一律拒絕", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_PRIVATE_FILES_BUCKET = "test-private-bucket";
    process.env.AWS_PRIVATE_FILES_REGION = "ap-northeast-1";
    process.env.AWS_PRIVATE_FILES_ACCESS_KEY_ID = "fake-private-access-key";
    delete process.env.AWS_PRIVATE_FILES_SECRET_ACCESS_KEY;

    const ps = await import("./privateStorage");
    expect(ps.isPrivateStorageConfigured()).toBe(false);
    await expect(ps.privateStorageDeleteObject("k.pdf")).rejects.toThrow(/私有附件儲存尚未設定/);
  });

  it("四項私有變數齊全時（即使沒有任何公開圖片憑證），isPrivateStorageConfigured 回傳 true，且可以用同一組憑證建立 S3Client 而不 throw", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_PRIVATE_FILES_BUCKET = "test-private-bucket";
    process.env.AWS_PRIVATE_FILES_REGION = "ap-northeast-1";
    process.env.AWS_PRIVATE_FILES_ACCESS_KEY_ID = "fake-private-access-key";
    process.env.AWS_PRIVATE_FILES_SECRET_ACCESS_KEY = "fake-private-secret-key";

    const ps = await import("./privateStorage");
    expect(ps.isPrivateStorageConfigured()).toBe(true);

    // 建立 S3Client 本身只是物件建構，不會發出網路請求；這裡直接用同一組
    // 私有憑證驗證 SDK 建構 client 不會 throw（真正打到 S3 的網路呼叫需要
    // 真實 bucket 才能測，不在本輪範圍內，也不應該在單元測試裡打真正的網路）。
    const { S3Client } = await import("@aws-sdk/client-s3");
    expect(() => new S3Client({
      region: process.env.AWS_PRIVATE_FILES_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_PRIVATE_FILES_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_PRIVATE_FILES_SECRET_ACCESS_KEY!,
      },
    })).not.toThrow();
  });

  it("privateStorage.ts 完全沒有讀取 AWS_ACCESS_KEY_ID／AWS_SECRET_ACCESS_KEY（結構性保證，不共用公開圖片憑證）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "privateStorage.ts"), "utf-8");
    expect(source).not.toMatch(/process\.env\.AWS_ACCESS_KEY_ID/);
    expect(source).not.toMatch(/process\.env\.AWS_SECRET_ACCESS_KEY\b/);
    expect(source).toMatch(/process\.env\.AWS_PRIVATE_FILES_ACCESS_KEY_ID/);
    expect(source).toMatch(/process\.env\.AWS_PRIVATE_FILES_SECRET_ACCESS_KEY/);
    expect(source).toMatch(/process\.env\.AWS_PRIVATE_FILES_BUCKET/);
    expect(source).toMatch(/process\.env\.AWS_PRIVATE_FILES_REGION/);
  });

  it("公開圖片 storage.ts 完全沒有讀取任何 AWS_PRIVATE_FILES_* 變數（結構性保證，不會意外借用私有憑證，公開圖片行為不受影響）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "storage.ts"), "utf-8");
    expect(source).not.toMatch(/AWS_PRIVATE_FILES/);
    // 既有公開圖片變數維持不變
    expect(source).toMatch(/process\.env\.AWS_ACCESS_KEY_ID/);
    expect(source).toMatch(/process\.env\.AWS_SECRET_ACCESS_KEY/);
    expect(source).toMatch(/process\.env\.AWS_S3_BUCKET/);
  });

  it("私有儲存的錯誤訊息只有固定一句話，不會透露缺的是哪一項變數，也不含任何金鑰內容或 URL", async () => {
    for (const k of PRIVATE_ENV_KEYS) delete process.env[k];
    const ps = await import("./privateStorage");
    let caught: unknown;
    try {
      await ps.privateStorageCreateUploadUrl("k.pdf", "application/pdf");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toBe("私有附件儲存尚未設定，PDF 附件功能目前無法使用。");
    expect(msg).not.toMatch(/AWS_PRIVATE_FILES_ACCESS_KEY_ID|AWS_PRIVATE_FILES_SECRET_ACCESS_KEY|AWS_PRIVATE_FILES_BUCKET|AWS_PRIVATE_FILES_REGION/);
    expect(msg).not.toMatch(/https?:\/\//);
  });

  it("privateStorage.ts 沒有提供任何 getPublicUrl 等價函式（結構性保證，不是靠約定）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "privateStorage.ts"), "utf-8");
    expect(source).not.toMatch(/export (async )?function getPublicUrl/);
    expect(source).not.toMatch(/export (async )?function privateStorageGetPublicUrl/);
  });

  it("privateStorage.ts 完全沒有 console.log／console.warn／console.error 會印出簽好的 URL 或憑證（回傳值本身不算 log，這裡只鎖定真的呼叫 console 的地方）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "privateStorage.ts"), "utf-8");
    const consoleCalls = source.match(/console\.(log|warn|error|info|debug)\([^)]*\)/g) ?? [];
    expect(consoleCalls.length).toBe(0);
  });
});

describe("news router：PDF 附件 endpoints 的權限與驗證邏輯（原始碼內容斷言）", () => {
  function readNewsRouterBlock(): string {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    return source.slice(start, end);
  }

  it("createPdfUploadSession／finalizePdfUpload／updateAttachmentExpiration／deleteAttachment／getAdminAttachments 都掛在 adminProcedure，只有 getPdfDownloadUrl 是 protectedProcedure", () => {
    const block = readNewsRouterBlock();
    expect(block).toMatch(/createPdfUploadSession: adminProcedure/);
    expect(block).toMatch(/finalizePdfUpload: adminProcedure/);
    expect(block).toMatch(/updateAttachmentExpiration: adminProcedure/);
    expect(block).toMatch(/deleteAttachment: adminProcedure/);
    expect(block).toMatch(/getAdminAttachments: adminProcedure/);
    expect(block).toMatch(/getPdfDownloadUrl: protectedProcedure/);
  });

  it("finalizePdfUpload 會驗證 PDF magic bytes（%PDF- 的前五個 byte），驗證失敗會刪除剛上傳的暫存物件、不建立附件 metadata", () => {
    const block = readNewsRouterBlock();
    const start = block.indexOf("finalizePdfUpload:");
    const section = block.slice(start, block.indexOf("updateAttachmentExpiration:", start));
    expect(section).toMatch(/0x25.*0x50.*0x44.*0x46.*0x2d/);
    expect(section).toMatch(/cleanupTmpAndThrow/);
    expect(section).toMatch(/privateStorageDeleteObject/);
  });

  it("getPdfDownloadUrl 對一般會員強制檢查已發布狀態與過期狀態，storageDeletedAt 有值時連管理員也一律拒絕", () => {
    const block = readNewsRouterBlock();
    const start = block.indexOf("getPdfDownloadUrl:");
    const section = block.slice(start);
    expect(section).toMatch(/newsItem\.status !== "published" && !isAdmin/);
    expect(section).toMatch(/isExpired && !isAdmin/);
    // storageDeletedAt 檢查必須在 isAdmin 分支之前、且沒有被 isAdmin 條件包住
    const deletedCheckIdx = section.indexOf("attachment.storageDeletedAt != null");
    expect(deletedCheckIdx).toBeGreaterThan(-1);
    const deletedCheckLine = section.slice(deletedCheckIdx - 40, deletedCheckIdx + 10);
    expect(deletedCheckLine).not.toMatch(/isAdmin/);
  });

  it("getPdfDownloadUrl 的簽章有效秒數不超過 300 秒，且取「300 秒」與「距離到期剩餘秒數」的較小值", () => {
    const block = readNewsRouterBlock();
    const start = block.indexOf("getPdfDownloadUrl:");
    const section = block.slice(start);
    expect(section).toMatch(/Math\.min\(300, secondsUntilExpiry\)/);
  });

  it("getBySlug 會把公開附件白名單資料一併回傳（folded into 既有的已發布消息查詢）", () => {
    const block = readNewsRouterBlock();
    const start = block.indexOf("getBySlug:");
    const section = block.slice(start, block.indexOf("adminList:", start));
    expect(section).toMatch(/getNewsAttachmentsPublic/);
    expect(section).toMatch(/attachments/);
  });
});

describe("cleanup-expired-news-attachments 排程：只走 Render Cron 直接執行 CLI，不開放任何 HTTP endpoint（原始碼內容斷言）", () => {
  it("server/_core/index.ts 完全沒有 cleanup-expired-news-attachments 的路由，也沒有殘留的 cron secret 環境變數名稱", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "_core", "index.ts"), "utf-8");
    expect(source).not.toMatch(/\/api\/cron\/cleanup-expired-news-attachments/);
    expect(source).not.toMatch(/NEWS_ATTACHMENT_CLEANUP_CRON_SECRET/);
    expect(source).not.toMatch(/runNewsAttachmentCleanup/);
  });

  it("cleanupExpiredNewsAttachments.ts 有 CLI 直接執行的進入點，exit code 依 decideExitCode(result) 決定（failed>0 才非 0，不是無條件 exit 0）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "jobs", "cleanupExpiredNewsAttachments.ts"), "utf-8");
    expect(source).toMatch(/invokedDirectly/);
    expect(source).toMatch(/process\.exit\(decideExitCode\(result\)\)/);
    expect(source).toMatch(/export function decideExitCode/);
  });

  it("私有儲存未設定、或資料庫連線失敗，都會讓整個 runNewsAttachmentCleanup 直接 throw（CLI 端才能以非 0 結束）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "jobs", "cleanupExpiredNewsAttachments.ts"), "utf-8");
    const bodyStart = source.indexOf("export async function runNewsAttachmentCleanup");
    const bodyEnd = source.indexOf("\nconst invokedDirectly");
    const body = source.slice(bodyStart, bodyEnd);
    expect(body).toMatch(/throw new Error\(.*私有附件儲存尚未設定/);
    expect(body).toMatch(/throw new Error\(.*資料庫連線失敗/);
  });

  it("正式 package script 執行 node dist/jobs/...js（不用 tsx、不現場編譯 TypeScript）；本機開發用的 :dev script 才用 tsx 跑原始碼", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"));
    expect(pkg.scripts["cleanup:expired-news-attachments"]).toBe("node dist/jobs/cleanupExpiredNewsAttachments.js");
    expect(pkg.scripts["cleanup:expired-news-attachments:dev"]).toBe("tsx server/jobs/cleanupExpiredNewsAttachments.ts");
  });

  it("build script會把 cleanup job 獨立 esbuild 成 dist/jobs/cleanupExpiredNewsAttachments.js，跟主服務 dist/index.js 用同一套 esbuild 設定原則（platform=node／bundle／packages=external／format=esm）", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"));
    const build = pkg.scripts.build as string;
    expect(build).toMatch(/esbuild server\/jobs\/cleanupExpiredNewsAttachments\.ts --platform=node --packages=external --bundle --format=esm --outdir=dist\/jobs/);
    // 跟主服務那條 esbuild 指令用同一組旗標順序／組合，不是另外發明一套規則
    const mainEsbuildFlags = build.match(/esbuild server\/_core\/index\.ts (--[^&]+)/)?.[1]?.trim();
    const jobEsbuildFlags = build.match(/esbuild server\/jobs\/cleanupExpiredNewsAttachments\.ts (--[^&]+)/)?.[1]?.trim();
    expect(mainEsbuildFlags?.replace(/--outdir=\S+/, "")).toBe(jobEsbuildFlags?.replace(/--outdir=\S+/, ""));
  });
});

describe("PDF 附件前端 UI：NewsDetail／AdminNews 行為（原始碼內容斷言）", () => {
  it("NewsDetail：沒有附件時整個「相關附件」區塊完全不渲染", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    expect(source).toMatch(/item\.attachments\.length > 0 && \(/);
  });

  it("NewsDetail：未登入點擊下載不會先呼叫下載 API 拿 signed URL，只會打開 LoginDialog", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    const start = source.indexOf("const handleClick = async () => {");
    const end = source.indexOf("};", start);
    const block = source.slice(start, end);
    expect(block).toMatch(/if \(!isAuthenticated\) \{ onRequireLogin\(\); return; \}/);
    // 呼叫下載 API 的那一行必須在「未登入就 return」之後，不能先取得再檢查
    const guardIdx = block.indexOf("if (!isAuthenticated)");
    const mutateIdx = block.indexOf("getDownloadUrlMut.mutateAsync");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mutateIdx).toBeGreaterThan(guardIdx);
  });

  it("NewsDetail：過期或已刪除的附件顯示規定文案，按鈕停用", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    expect(source).toMatch(/已超過下載期限，如有需要請聯繫管理員。/);
    expect(source).toMatch(/disabled=\{downloading\}|disabled\s+className="shrink-0 text-muted-foreground"/);
  });

  it("NewsDetail：LoginDialog 沿用既有共用元件，不是自己重寫一套登入彈窗", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    expect(source).toMatch(/import LoginDialog from "@\/components\/LoginDialog"/);
    expect(source).toMatch(/<LoginDialog open=\{loginDialogOpen\} onOpenChange=\{setLoginDialogOpen\} \/>/);
  });

  it("AdminNews：PDF 上傳走 createPdfUploadSession → 直傳 S3 → finalizePdfUpload，不是把整份 PDF 塞進 base64 tRPC payload", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
    const start = source.indexOf("const handlePdfFileSelected");
    const end = source.indexOf("const handleDeleteAttachment");
    const block = source.slice(start, end);
    expect(block).toMatch(/createPdfUploadSessionMut\.mutateAsync/);
    expect(block).toMatch(/fetch\(session\.uploadUrl/);
    expect(block).toMatch(/method: "PUT"/);
    expect(block).toMatch(/finalizePdfUploadMut\.mutateAsync/);
    expect(block).not.toMatch(/fileToBase64\(file\)/);
  });

  it("AdminNews：前端也有最多 5 份附件與 25MB 大小的客戶端防呆（後端仍是最終防線）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
    expect(source).toMatch(/MAX_ATTACHMENTS = 5/);
    expect(source).toMatch(/MAX_PDF_BYTES = 25 \* 1024 \* 1024/);
  });

  it("AdminNews：「管理員預覽」按鈕只在 isExpired 時出現，storageDeletedAt 有值的附件（isStorageDeleted 分支）不會渲染到這裡", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
    expect(source).toMatch(/handleAdminPreview/);
    expect(source).toMatch(/管理員預覽（5 分鐘有效）/);
    const start = source.indexOf("const handleAdminPreview");
    const end = source.indexOf("const startEditExpiration");
    const block = source.slice(start, end);
    expect(block).toMatch(/getPdfDownloadUrlMut\.mutateAsync/);
    expect(block).toMatch(/openExternalUrl/);
  });
});

describe("news router：封面／內文圖片上傳一律 adminProcedure（原始碼內容斷言）", () => {
  it("uploadCoverImage／removeCoverImage／uploadContentImage 都掛在 adminProcedure", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    const block = source.slice(start, end);
    expect(block).toMatch(/uploadCoverImage: adminProcedure/);
    expect(block).toMatch(/removeCoverImage: adminProcedure/);
    expect(block).toMatch(/uploadContentImage: adminProcedure/);
  });

  it("圖片上傳一律用 validateImageUpload 搭配 10MB 上限，不是自己重新寫一套驗證", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("uploadCoverImage: adminProcedure");
    const end = source.indexOf("uploadContentImage: adminProcedure");
    const block = source.slice(start, end);
    expect(block).toMatch(/validateImageUpload\(buffer, 10 \* 1024 \* 1024\)/);
  });
});

describe("MarkdownContent：allowImages 預設 false，找消息才 opt-in（原始碼內容斷言）", () => {
  function readMarkdownContentSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "components", "MarkdownContent.tsx"), "utf-8");
  }

  it("allowImages 預設 false，平台公告等既有呼叫端行為不變", () => {
    const source = readMarkdownContentSource();
    expect(source).toMatch(/allowImages\s*=\s*false/);
  });

  it("圖片來源限定 https，不允許任意協定（跟連結的 isSafeHref 規則一致）", () => {
    const source = readMarkdownContentSource();
    expect(source).toMatch(/isSafeImgSrc/);
    expect(source).toMatch(/protocol === "https:"/);
  });

  it("NewsDetail 傳入 allowImages，AdminNews 即時預覽也傳入 allowImages", () => {
    const newsDetailSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    expect(newsDetailSource).toMatch(/<MarkdownContent content=\{item\.content\}[^>]*allowImages/);

    const adminNewsSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
    expect(adminNewsSource).toMatch(/<MarkdownContent content=\{form\.content\} allowImages/);
  });

  it("AdminAnnouncements 沒有傳 allowImages，公告內容維持不顯示圖片（既有行為零變更）", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminAnnouncements.tsx"), "utf-8");
    const matches = source.match(/<MarkdownContent[^>]*>/g) ?? [];
    for (const m of matches) {
      expect(m).not.toMatch(/allowImages/);
    }
  });
});

describe("Markdown 工具列共用元件：AdminAnnouncements 與 AdminNews 沿用同一套，沒有第二套語法", () => {
  it("兩邊都從 @/components/MarkdownToolbar import MarkdownToolbar，不是各自定義", () => {
    const announcementsSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminAnnouncements.tsx"), "utf-8");
    const newsSource = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");

    expect(announcementsSource).toMatch(/import \{ MarkdownToolbar \} from "@\/components\/MarkdownToolbar"/);
    expect(newsSource).toMatch(/import \{ MarkdownToolbar,? ?[^}]*\} from "@\/components\/MarkdownToolbar"/);

    // 確認舊的本地 helper 定義已經整個移除，不是留著沒用到的第二份
    expect(announcementsSource).not.toMatch(/^function wrapSelection/m);
    expect(announcementsSource).not.toMatch(/^function insertLink/m);
  });

  it("AdminNews 的上傳圖片按鈕放在 MarkdownToolbar 的 extraButtons，未取得 newsId 前 disabled", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
    const start = source.indexOf("extraButtons={");
    const end = source.indexOf("<Textarea", start);
    const block = source.slice(start, end);
    expect(block).toMatch(/disabled=\{!editingId/);
    expect(block).toMatch(/上傳圖片/);
  });
});

describe("找消息列表頁不顯示封面縮圖，完整內容頁才顯示（原始碼內容斷言）", () => {
  it("News.tsx 的 NewsListItemData／NewsListItem 完全不引用 coverImageUrl", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "News.tsx"), "utf-8");
    expect(source).not.toMatch(/coverImage/);
  });

  it("NewsDetail.tsx 只在 item.coverImageUrl 存在時才渲染封面，沒有就完全不輸出", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
    expect(source).toMatch(/\{item\.coverImageUrl && \(/);
  });
});
