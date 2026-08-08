/**
 * Search Console 軟式 404 修正 — /factory/:id 的真實 HTTP 狀態與 metadata。
 *
 * 背景：修正前 buildFactoryMeta 對「id 格式無效」「查無此工廠」「工廠存在但
 * 非 approved（draft／pending／rejected）」三種情況一律回傳跟正常頁面一樣
 * 的 200 + 通用 fallback title/description，實際請求正式站驗證過（見任務
 * 回報）：這正是 Google Search Console 回報的軟式 404——200 狀態碼，但內容
 * 跟「這裡沒有東西」沒有兩樣。
 *
 * 這裡驗證修正後的行為：id 無效／查無此工廠／工廠存在但非 approved
 * （draft／pending／rejected 三種狀態都要各自驗證到）一律是真正的
 * 404 + noindex——不是 410。理由：factories 只有單一 status 欄位，沒有
 * 任何欄位能可靠回答「這筆資料是否曾經 approved 過」，draft／pending 從來
 * 沒公開過，rejected 也可能從未通過審核；沒有可靠依據時不能用猜的方式
 * 回 410（HTTP 語意上 410 代表「確認曾經公開、現在永久移除」），一律 404
 * 才符合實際資料模型能證明的事實。approved 工廠維持 200、有專屬
 * metadata，且原始 HTML 真的包含工廠名稱（不是全站通用內容）。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { buildFactoryMeta, injectMetaIntoHtml } from "./_core/ogMeta";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

// createTestFactory 只接受 approved/pending/draft（既有 fixture helper 的
// 既有簽章，見 server/_core/financeTestFixtures.ts），rejected 需要另外用
// 原始 SQL 直接寫入，才能涵蓋題目明確列出的第三種非 approved 狀態。
async function createRejectedTestFactory(ownerId: number, name: string): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify(["電子"])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`${name} 測試地址一號`}, "rejected", "normal", FALSE, "[]", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

const BASE_HTML = `<!doctype html>
<html lang="zh-TW">
  <head>
    <meta charset="UTF-8" />
    <title>OXM｜全台最齊全工廠與工作室媒合平台（OEM / ODM）</title>
    <meta name="description" content="找代工不再浪費時間。" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// factories.uq_factory_owner_id 限制「一個使用者最多一間工廠」，這裡每間
// 測試工廠各自用獨立的 owner，不能共用同一個 ownerId 建立多筆。
let ownerIds: number[] = [];
let approvedFactoryId: number;
let pendingFactoryId: number;
let draftFactoryId: number;
let rejectedFactoryId: number;

beforeAll(async () => {
  const approvedOwnerId = await ensureTestUser(`factory-page-status-owner-a-${runId}`, "軟式404測試用擁有者A");
  const pendingOwnerId = await ensureTestUser(`factory-page-status-owner-b-${runId}`, "軟式404測試用擁有者B");
  const draftOwnerId = await ensureTestUser(`factory-page-status-owner-c-${runId}`, "軟式404測試用擁有者C");
  const rejectedOwnerId = await ensureTestUser(`factory-page-status-owner-e-${runId}`, "軟式404測試用擁有者E");
  ownerIds = [approvedOwnerId, pendingOwnerId, draftOwnerId, rejectedOwnerId];

  approvedFactoryId = await createTestFactory(approvedOwnerId, `軟式404測試-已審核-${runId}`, "approved");
  pendingFactoryId = await createTestFactory(pendingOwnerId, `軟式404測試-待審核-${runId}`, "pending");
  draftFactoryId = await createTestFactory(draftOwnerId, `軟式404測試-草稿-${runId}`, "draft");
  rejectedFactoryId = await createRejectedTestFactory(rejectedOwnerId, `軟式404測試-已拒絕-${runId}`);
});

afterAll(async () => {
  await deleteTestFactory(approvedFactoryId);
  await deleteTestFactory(pendingFactoryId);
  await deleteTestFactory(draftFactoryId);
  await deleteTestFactory(rejectedFactoryId);
  for (const id of ownerIds) await deleteTestUser(id);
});

describe("buildFactoryMeta：無效 id 格式 → 404 + noindex", () => {
  it("非數字 id", async () => {
    const meta = await buildFactoryMeta("abc", "/factory/abc");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("id <= 0", async () => {
    const meta = await buildFactoryMeta("0", "/factory/0");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildFactoryMeta：查無此工廠 → 404 + noindex", () => {
  it("一個不存在的極大 id", async () => {
    const meta = await buildFactoryMeta("999999999", "/factory/999999999");
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
    // 通用 fallback 內容，但狀態碼才是 Google 真正判斷的依據——見下方
    // injectMetaIntoHtml 測試，確認 noindex meta 真的有被寫進 HTML。
    expect(meta.title).toContain("OXM");
  });
});

describe("buildFactoryMeta：工廠存在但非 approved → 404 + noindex（不是 410，見檔案頂端說明）", () => {
  it("draft 狀態", async () => {
    const meta = await buildFactoryMeta(String(draftFactoryId), `/factory/${draftFactoryId}`);
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("pending 狀態", async () => {
    const meta = await buildFactoryMeta(String(pendingFactoryId), `/factory/${pendingFactoryId}`);
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });

  it("rejected 狀態", async () => {
    const meta = await buildFactoryMeta(String(rejectedFactoryId), `/factory/${rejectedFactoryId}`);
    expect(meta.status).toBe(404);
    expect(meta.noindex).toBe(true);
  });
});

describe("buildFactoryMeta：approved 工廠 → 200，且 metadata 是這間工廠專屬的內容", () => {
  it("status 為 200、noindex 為 false", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    expect(meta.status).toBe(200);
    expect(meta.noindex).toBe(false);
  });

  it("title 包含真實工廠名稱，不是全站通用 fallback", async () => {
    const meta = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
    expect(meta.title).toContain(`軟式404測試-已審核-${runId}`);
    expect(meta.title).not.toBe("台灣工廠資源媒合｜OXM");
  });

  it("兩間不同的 approved 工廠 title 彼此不同（不會被誤判為重複頁面）", async () => {
    // 兩間 title 一定不同（各自帶公司名稱）；description 則不一定——fixture
    // 工廠沒有填 description 時，buildDescription 是純粹由 industry／region
    // 算出的固定 fallback 公式，兩間 fixture 工廠剛好用同一組 industry／
    // region 時 description 相同屬於正常、預期中的行為，不是重複內容問題
    // （真實工廠幾乎都有自己的 description，見 server/_core/ogMeta.ts
    // buildDescription 的 fromDescription 優先邏輯），這裡不斷言 description。
    const secondOwnerId = await ensureTestUser(`factory-page-status-owner-d-${runId}`, "軟式404測試用擁有者D");
    const secondFactoryId = await createTestFactory(secondOwnerId, `軟式404測試-已審核二-${runId}`, "approved");
    try {
      const metaA = await buildFactoryMeta(String(approvedFactoryId), `/factory/${approvedFactoryId}`);
      const metaB = await buildFactoryMeta(String(secondFactoryId), `/factory/${secondFactoryId}`);
      expect(metaA.title).not.toBe(metaB.title);
    } finally {
      await deleteTestFactory(secondFactoryId);
      await deleteTestUser(secondOwnerId);
    }
  });
});

describe("injectMetaIntoHtml：noindex meta 真的寫進初始 HTML（原始碼層級，不依賴 JS 執行）", () => {
  it("noindex:true 時輸出 <meta name=\"robots\" content=\"noindex\">", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: "台灣工廠資源媒合｜OXM",
      description: "在 OXM 尋找適合您的台灣工廠與工作室資源。",
      image: "https://www.oxmmatch.com/og-image.png",
      url: "https://www.oxmmatch.com/factory/999999999",
      status: 404,
      noindex: true,
    });
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("noindex:false（approved 工廠）時不輸出 robots noindex meta", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: "測試工廠｜OXM",
      description: "測試描述",
      image: "https://www.oxmmatch.com/og-image.png",
      url: "https://www.oxmmatch.com/factory/1",
      status: 200,
      noindex: false,
    });
    expect(html).not.toContain('name="robots"');
  });

  it("即使 noindex，canonical 仍自我指向請求的 URL（不導向首頁）", () => {
    const html = injectMetaIntoHtml(BASE_HTML, {
      title: "台灣工廠資源媒合｜OXM",
      description: "在 OXM 尋找適合您的台灣工廠與工作室資源。",
      image: "https://www.oxmmatch.com/og-image.png",
      url: "https://www.oxmmatch.com/factory/999999999",
      status: 404,
      noindex: true,
    });
    expect(html).toContain('<link rel="canonical" href="https://www.oxmmatch.com/factory/999999999">');
  });
});
