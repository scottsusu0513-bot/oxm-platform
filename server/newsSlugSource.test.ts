/**
 * 找消息「自動產生 slug」與「原始消息來源」回歸測試。
 *
 * DB 層走真實本機測試資料庫（受 server/test-db-guard.ts 保護，已套用
 * drizzle/0060_news_source.sql）。router／前端行為採用本專案其他測試已經
 * 在用的原始碼內容斷言手法。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `slugsrc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email)
    VALUES (${openId}, ${`Slug Source Test ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})
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
  await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
}

describe("news slug：未提供時自動產生且唯一，格式 news-YYYYMMDD-xxxxxxxx", () => {
  it("不帶 slug 建立消息，後端自動產生符合格式、且不同兩篇消息 slug 不同", async () => {
    let id1: number | undefined;
    let id2: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const r1 = await db.createNews({ title: "t1", summary: "s1", content: "c1", status: "draft", createdBy: creator });
      const r2 = await db.createNews({ title: "t2", summary: "s2", content: "c2", status: "draft", createdBy: creator });
      id1 = r1.id; id2 = r2.id;

      const row1 = await db.getNewsById(id1);
      const row2 = await db.getNewsById(id2);
      expect(row1?.slug).toMatch(/^news-\d{8}-[a-z0-9]{8}$/);
      expect(row2?.slug).toMatch(/^news-\d{8}-[a-z0-9]{8}$/);
      expect(row1?.slug).not.toBe(row2?.slug);
    } finally {
      await cleanupNews(id1);
      await cleanupNews(id2);
      await deleteTestUser(creator);
    }
  });

  it("空字串 slug 視同未提供，一樣自動產生", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const r = await db.createNews({ slug: "", title: "t", summary: "s", content: "c", status: "draft", createdBy: creator });
      id = r.id;
      const row = await db.getNewsById(id);
      expect(row?.slug).toMatch(/^news-\d{8}-[a-z0-9]{8}$/);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("news slug：自訂合法／非法 slug", () => {
  it("自訂合法 slug（小寫英數字與連字號）建立成功，且照原樣存入", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const customSlug = `custom-slug-${runId}`;
      const r = await db.createNews({ slug: customSlug, title: "t", summary: "s", content: "c", status: "draft", createdBy: creator });
      id = r.id;
      const row = await db.getNewsById(id);
      expect(row?.slug).toBe(customSlug);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("自訂非法 slug（大寫／底線／空白）被拒絕", async () => {
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      await expect(db.createNews({ slug: "Invalid Slug_1", title: "t", summary: "s", content: "c", status: "draft", createdBy: creator }))
        .rejects.toThrow(/無效的網址代稱/);
    } finally {
      await deleteTestUser(creator);
    }
  });

  it("自訂 slug 與既有消息重複時被拒絕", async () => {
    let id1: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const dupSlug = `dup-slug-${runId}`;
      id1 = (await db.createNews({ slug: dupSlug, title: "t1", summary: "s1", content: "c1", status: "draft", createdBy: creator })).id;
      await expect(db.createNews({ slug: dupSlug, title: "t2", summary: "s2", content: "c2", status: "draft", createdBy: creator }))
        .rejects.toThrow(/此網址代稱已被使用/);
    } finally {
      await cleanupNews(id1);
      await deleteTestUser(creator);
    }
  });
});

describe("news slug：第一次發布後不可修改，既有 slug 不受影響", () => {
  it("草稿階段可以自由修改 slug；第一次發布後再嘗試修改會被後端拒絕", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({ title: "t", summary: "s", content: "c", status: "draft", createdBy: creator })).id;

      const newSlugPreDraft = `pre-publish-${runId}`;
      await db.updateNews(id, { slug: newSlugPreDraft });
      expect((await db.getNewsById(id))?.slug).toBe(newSlugPreDraft);

      await db.updateNews(id, { status: "published" });

      await expect(db.updateNews(id, { slug: `after-publish-${runId}` }))
        .rejects.toThrow(/已發布過的消息無法修改網址代稱/);

      // 既有 slug 完全不受影響
      expect((await db.getNewsById(id))?.slug).toBe(newSlugPreDraft);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("下架後重新發布過的消息，slug 依然鎖定（firstPublishedAt 不會因下架清空）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({ title: "t", summary: "s", content: "c", status: "published", createdBy: creator })).id;
      await db.updateNews(id, { status: "withdrawn" });
      await db.updateNews(id, { status: "published" });

      await expect(db.updateNews(id, { slug: `after-republish-${runId}` }))
        .rejects.toThrow(/已發布過的消息無法修改網址代稱/);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("送出跟目前完全相同的 slug（沒有真的改變）即使已發布也不會被當成修改、不會報錯", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const slug = `unchanged-${runId}`;
      id = (await db.createNews({ slug, title: "t", summary: "s", content: "c", status: "published", createdBy: creator })).id;

      await expect(db.updateNews(id, { slug, title: "改過的標題" })).resolves.toBeDefined();
      const row = await db.getNewsById(id);
      expect(row?.slug).toBe(slug);
      expect(row?.title).toBe("改過的標題");
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("news source：CRUD 與交叉驗證", () => {
  it("建立時可以一起設定 sourceName／sourceUrl，公開 API（getPublishedNewsBySlug）會回傳這兩個欄位", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      const slug = `source-crud-${runId}`;
      const r = await db.createNews({
        slug, title: "t", summary: "s", content: "c", status: "published", createdBy: creator,
        sourceName: "經濟部中小及新創企業署", sourceUrl: "https://www.moeasmea.gov.tw/test",
      });
      id = r.id;
      const publicRow = await db.getPublishedNewsBySlug(slug);
      expect(publicRow?.sourceName).toBe("經濟部中小及新創企業署");
      expect(publicRow?.sourceUrl).toBe("https://www.moeasmea.gov.tw/test");
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("sourceUrl 有值但 sourceName 空白時，儲存的 sourceName 是 null（前端會 fallback 顯示「原始消息來源」）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
        sourceUrl: "https://example.com/only-url",
      })).id;
      const row = await db.getNewsById(id);
      expect(row?.sourceName).toBeNull();
      expect(row?.sourceUrl).toBe("https://example.com/only-url");
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("sourceName 有值但 sourceUrl 空白時，建立與更新都被拒絕（不允許「有名稱點不了」）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      await expect(db.createNews({
        title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
        sourceName: "只有名稱沒有網址",
      })).rejects.toThrow(/請填寫原始消息網址/);

      id = (await db.createNews({ title: "t2", summary: "s2", content: "c2", status: "draft", createdBy: creator })).id;
      await expect(db.updateNews(id, { sourceName: "只有名稱沒有網址", sourceUrl: "" }))
        .rejects.toThrow(/請填寫原始消息網址/);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("更新時可以把來源資料清空（兩者都設為空字串）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({
        title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
        sourceName: "來源", sourceUrl: "https://example.com/a",
      })).id;
      await db.updateNews(id, { sourceName: "", sourceUrl: "" });
      const row = await db.getNewsById(id);
      expect(row?.sourceName).toBeNull();
      expect(row?.sourceUrl).toBeNull();
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });

  it("編輯已發布消息的來源資料不會觸發 shouldNotify（不重新寄 Email／Push）", async () => {
    let id: number | undefined;
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      id = (await db.createNews({ title: "t", summary: "s", content: "c", status: "published", createdBy: creator })).id;
      const result = await db.updateNews(id, { sourceName: "後補來源", sourceUrl: "https://example.com/added-later" });
      expect(result.shouldNotify).toBe(false);
    } finally {
      await cleanupNews(id);
      await deleteTestUser(creator);
    }
  });
});

describe("news source：sourceUrl 協定與 CRLF 驗證", () => {
  it("isValidNewsSourceUrl 只接受 http(s)，拒絕 javascript:／data:／相對路徑", () => {
    expect(db.isValidNewsSourceUrl("https://example.com/a")).toBe(true);
    expect(db.isValidNewsSourceUrl("http://example.com/a")).toBe(true);
    expect(db.isValidNewsSourceUrl("javascript:alert(1)")).toBe(false);
    expect(db.isValidNewsSourceUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(db.isValidNewsSourceUrl("/relative/path")).toBe(false);
    expect(db.isValidNewsSourceUrl("not-a-url")).toBe(false);
  });

  it("拒絕含 CRLF／控制字元的 sourceUrl（header injection 防護）", () => {
    expect(db.isValidNewsSourceUrl("https://example.com/a\r\nSet-Cookie: evil=1")).toBe(false);
    expect(db.isValidNewsSourceUrl("https://example.com/a\nX-Injected: 1")).toBe(false);
  });

  it("建立/更新消息時，非法協定的 sourceUrl 會被拒絕", async () => {
    let creator: number | undefined;
    try {
      creator = await createTestUser();
      await expect(db.createNews({
        title: "t", summary: "s", content: "c", status: "draft", createdBy: creator,
        sourceName: "惡意來源", sourceUrl: "javascript:alert(1)",
      })).rejects.toThrow(/原始消息網址格式不正確/);
    } finally {
      await deleteTestUser(creator);
    }
  });
});

describe("news router：source 欄位有掛進 create／update 的 zod schema（原始碼內容斷言）", () => {
  function readNewsRouterBlock(): string {
    const source = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    const start = source.indexOf("news: router({");
    const end = source.indexOf("loginPopup: router({");
    return source.slice(start, end);
  }

  it("create／update 的 input schema 都有 sourceName／sourceUrl", () => {
    const block = readNewsRouterBlock();
    const createStart = block.indexOf("create: adminProcedure");
    const createSection = block.slice(createStart, block.indexOf("update: adminProcedure", createStart));
    expect(createSection).toMatch(/sourceName: z\.string\(\)\.max\(200\)\.nullable\(\)\.optional\(\)/);
    expect(createSection).toMatch(/sourceUrl: z\.string\(\)\.max\(1000\)\.nullable\(\)\.optional\(\)/);

    const updateStart = block.indexOf("update: adminProcedure");
    const updateSection = block.slice(updateStart, block.indexOf("retryNotifications:", updateStart));
    expect(updateSection).toMatch(/sourceName: z\.string\(\)\.max\(200\)\.nullable\(\)\.optional\(\)/);
    expect(updateSection).toMatch(/sourceUrl: z\.string\(\)\.max\(1000\)\.nullable\(\)\.optional\(\)/);
  });

  it("create 的 slug 欄位是 optional（不再強制手動填寫）", () => {
    const block = readNewsRouterBlock();
    const createStart = block.indexOf("create: adminProcedure");
    const createSection = block.slice(createStart, block.indexOf("update: adminProcedure", createStart));
    expect(createSection).toMatch(/slug: z\.string\(\)\.max\(200\)\.optional\(\)/);
  });

  it("create 會回傳最終 slug（可能是後端自動產生的），不是只回傳 id", () => {
    const block = readNewsRouterBlock();
    const createStart = block.indexOf("create: adminProcedure");
    const createSection = block.slice(createStart, block.indexOf("update: adminProcedure", createStart));
    expect(createSection).toMatch(/slug: created\?\.slug \?\? input\.slug \?\? ""/);
  });
});

describe("0060 migration 檔案內容（原始碼內容斷言）", () => {
  it("只有 ALTER TABLE ADD COLUMN，沒有 DROP／TRUNCATE／DELETE／UPDATE／RENAME（只看實際 SQL 陳述式，不算檔案開頭說明用途的註解行）", () => {
    const sqlContent = fs.readFileSync(path.resolve(__dirname, "..", "drizzle", "0060_news_source.sql"), "utf-8");
    const statementsOnly = sqlContent.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
    expect(sqlContent).toMatch(/ALTER TABLE `news` ADD COLUMN `sourceName`/);
    expect(sqlContent).toMatch(/ALTER TABLE `news` ADD COLUMN `sourceUrl`/);
    expect(statementsOnly).not.toMatch(/DROP/i);
    expect(statementsOnly).not.toMatch(/TRUNCATE/i);
    expect(statementsOnly).not.toMatch(/DELETE/i);
    expect(statementsOnly).not.toMatch(/UPDATE `news`/i);
    expect(statementsOnly).not.toMatch(/RENAME/i);
  });

  it("0059 檔案本身沒有被這一輪改動（0060 是獨立新檔案）", () => {
    const sqlContent = fs.readFileSync(path.resolve(__dirname, "..", "drizzle", "0059_news_media_attachments.sql"), "utf-8");
    expect(sqlContent).not.toMatch(/sourceName|sourceUrl/);
  });
});

describe("NewsDetail.tsx：消息來源區塊（原始碼內容斷言）", () => {
  function readSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "NewsDetail.tsx"), "utf-8");
  }

  it("只在 item.sourceUrl 存在時才渲染來源區塊，沒填來源時完全不顯示（不留空白）", () => {
    const source = readSource();
    expect(source).toMatch(/\{item\.sourceUrl && \(/);
  });

  it("sourceName 為空時前端 fallback 顯示「原始消息來源」", () => {
    const source = readSource();
    expect(source).toMatch(/item\.sourceName \|\| "原始消息來源"/);
  });

  it("按鈕文字是「查看原始消息」、帶 ExternalLink icon、用既有 openExternalUrl（Capacitor App 會走原生瀏覽器，Web 會開新分頁＋noopener noreferrer）", () => {
    const source = readSource();
    const start = source.indexOf("item.sourceUrl && (");
    const end = source.indexOf("相關附件：沒有附件時", start);
    const block = source.slice(start, end);
    expect(block).toMatch(/查看原始消息/);
    expect(block).toMatch(/<ExternalLink/);
    expect(block).toMatch(/openExternalUrl\(item\.sourceUrl!\)/);
  });

  it("消息來源區塊在文章內容之後、相關附件區塊之前", () => {
    const source = readSource();
    const contentIdx = source.indexOf("<MarkdownContent content={item.content}");
    const sourceIdx = source.indexOf("item.sourceUrl && (");
    const attachmentsIdx = source.indexOf("item.attachments.length > 0 && (");
    expect(contentIdx).toBeGreaterThan(-1);
    expect(sourceIdx).toBeGreaterThan(contentIdx);
    expect(attachmentsIdx).toBeGreaterThan(sourceIdx);
  });
});

describe("AdminNews.tsx：封面／PDF 兩個獨立上傳區塊（原始碼內容斷言）", () => {
  function readSource(): string {
    return fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "pages", "AdminNews.tsx"), "utf-8");
  }

  it("封面圖片按鈕文字是「從電腦選擇圖片」，accept 限定圖片格式，有 aria-label", () => {
    const source = readSource();
    expect(source).toMatch(/從電腦選擇圖片/);
    expect(source).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
    expect(source).toMatch(/aria-label="從電腦選擇圖片"/);
  });

  it("PDF 按鈕文字是「從電腦選擇 PDF」，accept 是 .pdf/application/pdf 且支援 multiple，有 aria-label", () => {
    const source = readSource();
    expect(source).toMatch(/從電腦選擇 PDF/);
    expect(source).toMatch(/accept="\.pdf,application\/pdf"/);
    const start = source.indexOf('accept=".pdf,application/pdf"');
    const inputBlock = source.slice(start, start + 200);
    expect(inputBlock).toMatch(/multiple/);
    expect(source).toMatch(/aria-label="從電腦選擇 PDF"/);
  });

  it("封面圖片區塊（從標題到 Markdown 工具列之間）完全不出現「PDF」字樣", () => {
    const source = readSource();
    const start = source.indexOf("{/* 4. 封面圖片");
    const end = source.indexOf("{/* 5+6. Markdown");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const coverBlock = source.slice(start, end);
    expect(coverBlock).not.toMatch(/PDF/);
  });

  it("未儲存草稿（沒有 newsId）時選檔只暫存在記憶體，不會提前呼叫上傳 API", () => {
    const source = readSource();
    const start = source.indexOf("const handleCoverFileSelected");
    const end = source.indexOf("const handleRemoveCover");
    const block = source.slice(start, end);
    expect(block).toMatch(/if \(!editingId\) \{/);
    expect(block).toMatch(/setStagedCoverFile\(file\)/);
    expect(block).toMatch(/URL\.createObjectURL\(file\)/);
  });

  it("PDF 多選時暫存陣列、尚未上傳前顯示「待儲存草稿後上傳」", () => {
    const source = readSource();
    expect(source).toMatch(/待儲存草稿後上傳/);
    const start = source.indexOf("const handlePdfFilesSelected");
    const end = source.indexOf("const removeStagedPdf");
    const block = source.slice(start, end);
    expect(block).toMatch(/if \(!editingId\) \{/);
    expect(block).toMatch(/setStagedPdfFiles\(prev => \[\.\.\.prev, \{ localId: newLocalId\(file\), file \}\]\)/);
  });

  it("第一次儲存草稿成功後，依序自動上傳已選封面／PDF（uploadStagedFilesAfterCreate 被 create 與 update 的 onSuccess 呼叫）", () => {
    const source = readSource();
    expect(source).toMatch(/const uploadStagedFilesAfterCreate = async/);
    const handleSaveDraftStart = source.indexOf("const handleSaveDraft = ()");
    const handleSaveDraftEnd = source.indexOf("const handlePublish = ()");
    const handleSaveDraftBlock = source.slice(handleSaveDraftStart, handleSaveDraftEnd);
    const occurrences = handleSaveDraftBlock.match(/uploadStagedFilesAfterCreate\(/g) ?? [];
    expect(occurrences.length).toBe(2); // 一次給既有 editingId 分支、一次給新建立分支
  });

  it("部分附件上傳失敗時：成功的從 stagedPdfFiles 移除、失敗的移到 failedPdfFiles，不會重複上傳成功的檔案", () => {
    const source = readSource();
    const start = source.indexOf("const uploadStagedFilesAfterCreate = async");
    const end = source.indexOf("const reportUploadOutcome");
    const block = source.slice(start, end);
    expect(block).toMatch(/setStagedPdfFiles\(prev => prev\.filter\(f => f\.localId !== queue\[i\]\.localId\)\)/);
    expect(block).toMatch(/setFailedPdfFiles\(prev => \[\.\.\.prev, \{ \.\.\.queue\[i\], error: result\.error \}\]\)/);
  });

  it("重新選擇同一個檔案仍會觸發 change：input 處理完後一律重設 value", () => {
    const source = readSource();
    expect(source).toMatch(/if \(coverInputRef\.current\) coverInputRef\.current\.value = "";/);
    expect(source).toMatch(/const resetInput = \(\) => \{ if \(pdfInputRef\.current\) pdfInputRef\.current\.value = ""; \};/);
  });

  it("上傳期間 disable 儲存／發布／取消按鈕，顯示進度文字", () => {
    const source = readSource();
    expect(source).toMatch(/const isBusy = createMut\.isPending \|\| updateMut\.isPending \|\| savingProgress !== null;/);
    expect(source).toMatch(/disabled=\{isBusy\}/);
  });

  it("進階設定區塊收合 slug 欄位，預設提示「系統將自動產生網址」，發布後鎖定不可修改", () => {
    const source = readSource();
    expect(source).toMatch(/進階設定/);
    expect(source).toMatch(/系統將自動產生網址/);
    expect(source).toMatch(/const slugLocked = !!editingItem\?\.firstPublishedAt;/);
    expect(source).toMatch(/此消息已發布過，網址代稱無法修改。/);
  });

  it("儲存草稿後顯示最後網址預覽與複製按鈕", () => {
    const source = readSource();
    expect(source).toMatch(/savedSlugPreview/);
    expect(source).toMatch(/handleCopySlugUrl/);
    expect(source).toMatch(/navigator\.clipboard\.writeText/);
  });
});
