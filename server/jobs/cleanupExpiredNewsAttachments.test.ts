/**
 * 找消息 PDF 附件自動清理排程測試。私有 S3 呼叫（isPrivateStorageConfigured／
 * privateStorageDeleteObject）一律 mock，不寫入真正的 S3；DB 狀態走真實本機
 * 測試資料庫（受 server/test-db-guard.ts 保護），驗證排程對 storageDeletedAt／
 * deleteAttempts／deleteFailureReason 的實際寫入行為。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { newsAttachments } from "../../drizzle/schema";

vi.mock("../privateStorage", () => ({
  isPrivateStorageConfigured: vi.fn(() => true),
  privateStorageDeleteObject: vi.fn(async () => {}),
}));

import { isPrivateStorageConfigured, privateStorageDeleteObject } from "../privateStorage";
import * as db from "../db";
import { getDb } from "../db";
import { runNewsAttachmentCleanup, decideExitCode } from "./cleanupExpiredNewsAttachments";

const runId = `cleanupjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`Cleanup Job Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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

// 用跟應用程式一致的 drizzle 型別化 update API 回填「已到期」的時間，不是走
// mysql2 原生的 raw sql Date 序列化（兩者在 MySQL session time_zone 不是 UTC
// 時，例如本機常見的 SYSTEM／Asia/Taipei，序列化方式不同，混用會讓測試資料
// 本身就有一個時區 offset 的落差）。
async function createExpiredAttachment(newsId: number, creator: number, key: string): Promise<number> {
  const id = await db.createNewsAttachment({
    newsId, displayName: "到期附件.pdf", originalFileName: "x.pdf", storageKey: key,
    mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator,
    expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 60_000),
  });
  const conn = await getDb();
  await conn!.update(newsAttachments).set({ downloadExpiresAt: new Date(Date.now() - 60_000) }).where(eq(newsAttachments.id, id));
  return id;
}

describe("decideExitCode：CLI exit code 決策（純函式，不牽涉 process.exit 本身）", () => {
  it("failed > 0 一律回傳 1，即使同一批次有其他附件刪除成功", () => {
    expect(decideExitCode({ scanned: 5, deleted: 4, failed: 1 })).toBe(1);
  });

  it("全部成功（failed === 0，deleted > 0）回傳 0", () => {
    expect(decideExitCode({ scanned: 3, deleted: 3, failed: 0 })).toBe(0);
  });

  it("無待清理資料（scanned === 0）回傳 0", () => {
    expect(decideExitCode({ scanned: 0, deleted: 0, failed: 0 })).toBe(0);
  });
});

describe("runNewsAttachmentCleanup：私有儲存未設定、或資料庫無法連線，都視為整體設定錯誤直接 throw", () => {
  it("isPrivateStorageConfigured() 回傳 false 時直接 throw，不呼叫 DeleteObject（讓 CLI 進入點以非 0 結束）", async () => {
    vi.mocked(isPrivateStorageConfigured).mockReturnValue(false);
    await expect(runNewsAttachmentCleanup()).rejects.toThrow(/尚未設定/);
    expect(privateStorageDeleteObject).not.toHaveBeenCalled();
  });

  it("getDb() 回傳 null（資料庫連線失敗）時直接 throw，不會被誤判成「掃到 0 筆」", async () => {
    vi.mocked(isPrivateStorageConfigured).mockReturnValue(true);
    const getDbSpy = vi.spyOn(db, "getDb").mockResolvedValue(null as unknown as Awaited<ReturnType<typeof db.getDb>>);
    try {
      await expect(runNewsAttachmentCleanup()).rejects.toThrow(/資料庫連線失敗/);
    } finally {
      getDbSpy.mockRestore();
    }
  });
});

describe("runNewsAttachmentCleanup：成功刪除、失敗重試、冪等（mock 私有 S3）", () => {
  beforeEach(() => {
    vi.mocked(isPrivateStorageConfigured).mockReturnValue(true);
    vi.mocked(privateStorageDeleteObject).mockReset();
  });

  it("到期附件刪除成功後寫入 storageDeletedAt，並清除失敗原因", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-success-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const key = `news-attachments/${runId}/success.pdf`;
      const attId = await createExpiredAttachment(newsId, creator, key);
      vi.mocked(privateStorageDeleteObject).mockResolvedValue(undefined);

      const result = await runNewsAttachmentCleanup();
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);
      expect(decideExitCode(result)).toBe(0);
      expect(privateStorageDeleteObject).toHaveBeenCalledWith(key);

      const row = await db.getNewsAttachmentById(attId);
      expect(row?.storageDeletedAt).not.toBeNull();
      expect(row?.deleteFailureReason).toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("這一批完全沒有到期附件時（無資料）：scanned=0，decideExitCode 回傳 0", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-no-data-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      // 只建立一份「永久有效」附件——不會被 getNewsAttachmentsDueForCleanup() 選到，
      // 確保這次批次確實是「無資料」而不是巧合掃到 0 筆。
      await db.createNewsAttachment({
        newsId, displayName: "永久.pdf", originalFileName: "n.pdf", storageKey: `news-attachments/${runId}/no-data-never.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });

      const result = await runNewsAttachmentCleanup();
      expect(result.scanned).toBe(0);
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
      expect(decideExitCode(result)).toBe(0);
      expect(privateStorageDeleteObject).not.toHaveBeenCalled();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("單筆刪除失敗只影響該筆：累加 deleteAttempts、記錄原因、不設定 storageDeletedAt；其他附件不受影響", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-partial-fail-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const failKey = `news-attachments/${runId}/fail.pdf`;
      const okKey = `news-attachments/${runId}/ok.pdf`;
      const failId = await createExpiredAttachment(newsId, creator, failKey);
      const okId = await createExpiredAttachment(newsId, creator, okKey);

      vi.mocked(privateStorageDeleteObject).mockImplementation(async (key: string) => {
        if (key === failKey) throw new Error("S3 連線逾時");
      });

      const result = await runNewsAttachmentCleanup();
      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      // 整批完成後只要 failed > 0，CLI 就必須決策為非 0——即使同一批次裡
      // 其他附件（okId）已經刪除成功，也不能讓這次執行被誤判成整批成功。
      expect(decideExitCode(result)).toBe(1);

      const failRow = await db.getNewsAttachmentById(failId);
      expect(failRow?.storageDeletedAt).toBeNull();
      expect(failRow?.deleteAttempts).toBe(1);
      expect(failRow?.deleteFailureReason).toMatch(/S3 連線逾時/);

      const okRow = await db.getNewsAttachmentById(okId);
      expect(okRow?.storageDeletedAt).not.toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("部分失敗後，下一次排程仍能依 DB 狀態（storageDeletedAt 仍是 NULL）重新撈到失敗的附件並重試成功", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-retry-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const key = `news-attachments/${runId}/retry-me.pdf`;
      const attId = await createExpiredAttachment(newsId, creator, key);

      vi.mocked(privateStorageDeleteObject).mockImplementation(async (k: string) => {
        if (k === key) throw new Error("暫時性 S3 錯誤");
      });
      const firstRun = await runNewsAttachmentCleanup();
      expect(firstRun.failed).toBe(1);
      expect(decideExitCode(firstRun)).toBe(1);
      const afterFirst = await db.getNewsAttachmentById(attId);
      expect(afterFirst?.storageDeletedAt).toBeNull();
      expect(afterFirst?.deleteAttempts).toBe(1);

      // 模擬下一次排程執行時 S3 已經恢復正常
      vi.mocked(privateStorageDeleteObject).mockReset();
      vi.mocked(privateStorageDeleteObject).mockResolvedValue(undefined);
      const secondRun = await runNewsAttachmentCleanup();
      expect(secondRun.scanned).toBeGreaterThanOrEqual(1);
      expect(secondRun.deleted).toBeGreaterThanOrEqual(1);
      expect(secondRun.failed).toBe(0);
      expect(decideExitCode(secondRun)).toBe(0);

      const afterSecond = await db.getNewsAttachmentById(attId);
      expect(afterSecond?.storageDeletedAt).not.toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("重跑不會重複處理已經成功刪除的附件（冪等）：第二次執行不會再對同一個 key 呼叫 DeleteObject", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-idempotent-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const key = `news-attachments/${runId}/idempotent.pdf`;
      await createExpiredAttachment(newsId, creator, key);
      vi.mocked(privateStorageDeleteObject).mockResolvedValue(undefined);

      await runNewsAttachmentCleanup();
      vi.mocked(privateStorageDeleteObject).mockClear();
      await runNewsAttachmentCleanup();

      const calledKeys = vi.mocked(privateStorageDeleteObject).mock.calls.map(c => c[0]);
      expect(calledKeys).not.toContain(key);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("尚未到期或永久有效的附件不會被排程處理", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-not-due-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const neverId = await db.createNewsAttachment({
        newsId, displayName: "永久.pdf", originalFileName: "n.pdf", storageKey: `news-attachments/${runId}/never.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "never",
      });
      const futureId = await db.createNewsAttachment({
        newsId, displayName: "未到期.pdf", originalFileName: "f.pdf", storageKey: `news-attachments/${runId}/future.pdf`,
        mimeType: "application/pdf", sizeBytes: 1000, uploadedBy: creator, expirationType: "custom", customDownloadExpiresAt: new Date(Date.now() + 3600_000),
      });
      vi.mocked(privateStorageDeleteObject).mockResolvedValue(undefined);

      await runNewsAttachmentCleanup();

      expect((await db.getNewsAttachmentById(neverId))?.storageDeletedAt).toBeNull();
      expect((await db.getNewsAttachmentById(futureId))?.storageDeletedAt).toBeNull();
      expect(privateStorageDeleteObject).not.toHaveBeenCalledWith(`news-attachments/${runId}/never.pdf`);
      expect(privateStorageDeleteObject).not.toHaveBeenCalledWith(`news-attachments/${runId}/future.pdf`);
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });

  it("S3 回報物件已經不存在時（DeleteObject 對不存在的 key 本身就回傳成功），視同刪除成功", async () => {
    let newsId: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      newsId = (await db.createNews({
        slug: `cleanup-already-gone-${runId}`, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
      })).id;
      const key = `news-attachments/${runId}/already-gone.pdf`;
      const attId = await createExpiredAttachment(newsId, creator, key);
      // S3 DeleteObject 對不存在的 key 本身就 resolve（不 throw NotFound），
      // 所以這裡直接 mock 成功即可代表這個情境。
      vi.mocked(privateStorageDeleteObject).mockResolvedValue(undefined);

      await runNewsAttachmentCleanup();
      const row = await db.getNewsAttachmentById(attId);
      expect(row?.storageDeletedAt).not.toBeNull();
    } finally {
      await cleanupNews(newsId);
      await deleteTestUser(creator);
    }
  });
});

describe("cleanupExpiredNewsAttachments.ts：不用 setInterval/setTimeout 做長駐排程（原始碼內容斷言）", () => {
  it("模組原始碼不含 setInterval／setTimeout，改由外部 Cron 觸發", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "cleanupExpiredNewsAttachments.ts"), "utf-8");
    expect(source).not.toMatch(/setInterval\(/);
    expect(source).not.toMatch(/setTimeout\(/);
    expect(source).toMatch(/export async function runNewsAttachmentCleanup/);
  });

  it("CLI console.log 只印 scanned/deleted/failed 統計數字，不含 storageKey／displayName／signed URL 等敏感欄位", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "cleanupExpiredNewsAttachments.ts"), "utf-8");
    const logLineMatch = source.match(/console\.log\(`\[cron\][^`]*`\)/);
    expect(logLineMatch).not.toBeNull();
    const logLine = logLineMatch![0];
    expect(logLine).toMatch(/result\.scanned/);
    expect(logLine).toMatch(/result\.deleted/);
    expect(logLine).toMatch(/result\.failed/);
    expect(logLine).not.toMatch(/storageKey|displayName|signed|url|originalFileName/i);
  });
});
