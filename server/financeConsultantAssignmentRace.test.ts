/**
 * 企業財務優化顧問指派 — 真正交錯（interleaved）競態條件回歸測試。
 *
 * 背景：自動指派／手動指派／停用／解除綁定，任兩個操作如果各自查詢
 * financeConsultants 候選人、決定是否寫入，中間存在任何時間差，就有可能
 * 出現「查詢時顧問還有效 → 顧問被停用／解除綁定／改派 → 才真正寫入」的
 * 競態窗口，導致案件被指派給一個已經無法存取的顧問。修正方式：候選人查詢
 * 與寫入必須在同一個 transaction、對候選顧問列加上真正的 row lock
 * （SELECT ... FOR UPDATE）——見 server/db.ts 的
 * createFinanceApplicationWithAutoAssign／adminSetFinanceConsultantActive／
 * adminBindFinanceConsultantUser／adminAssignFinanceConsultant。
 *
 * 這裡不是靠循序呼叫兩個函式碰運氣、也不是靠固定 sleep 讓某一方「看起來」
 * 先執行完，而是用一個獨立於應用程式連線池之外的原生 mysql2 連線，手動對
 * 同一顆 financeConsultants 列先 BEGIN + SELECT ... FOR UPDATE 取得鎖（這正
 * 是被測試的正式函式內部會用的同一種鎖），保留交易不 commit；同時啟動真正
 * 的正式函式呼叫，它會嘗試鎖同一列而被 MySQL 真的擋住（不是模擬）；用
 * Promise.race 搭配短暫 timeout 驗證它「此刻仍未完成」，證明真的被鎖擋住，
 * 而不是恰好先後執行；接著在手動連線內完成「勝出方」該做的事並 commit，
 * 讓被擋住的正式函式繼續執行到底，最後檢查最終結果與事件發生順序。
 *
 * 這個檔案改動 financeConsultants 全域資料，必須獨立執行（與既有專案慣例
 * 相同，例如 pnpm vitest run server/financeConsultantAssignmentRace.test.ts），
 * 不能與其他也會建立「啟用中＋已綁定」財務顧問的測試檔案同時跑，否則
 * autoAssignFinanceConsultant「剛好一位候選人」的判斷會被其他檔案的 fixture
 * 干擾——這與 server/financeOptimization.test.ts 既有的 autoAssignFinanceConsultant
 * 測試（同樣假設當下唯一顧問就是自己 beforeAll 建立的那筆）採用相同慣例。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import mysql from "mysql2/promise";
import * as db from "./db";
import { getDb } from "./db";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PREFIX = `[FIN_RACE_${runId}]`;

async function ensureTestUser(openId: string, name: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO users (openId, name, email) VALUES (${openId}, ${name}, ${`${openId}@example.test`})
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to create test user ${openId}`);
  return id;
}

async function deleteTestUser(userId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

async function createTestFactory(ownerId: number, name: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify(["電子"])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`${name} 測試地址`}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function deleteTestFactory(factoryId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM financeApplications WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
}

async function deleteFinanceConsultant(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM financeConsultants WHERE id = ${id}`);
}

/**
 * 用一個獨立的原生連線手動持有 financeConsultants 目標列的 FOR UPDATE 鎖，
 * 啟動真正競爭中的正式函式呼叫（會被鎖真的擋住），驗證它此刻仍未完成，
 * 接著執行「鎖的持有方該做的工作」並 commit，最後回傳競爭呼叫的結果與
 * 事件發生順序，讓測試斷言真正的交錯執行結果，而不是文字上的假設。
 */
async function raceWithManualLock<T>(opts: {
  consultantId: number;
  competing: () => Promise<T>;
  manualWork: (conn: mysql.Connection) => Promise<void>;
}): Promise<{
  competingResult: { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };
  events: string[];
}> {
  const events: string[] = [];
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    await conn.beginTransaction();
    await conn.execute("SELECT id FROM financeConsultants WHERE id = ? FOR UPDATE", [opts.consultantId]);
    events.push("manual-lock-acquired");

    const competingPromise = opts.competing()
      .then((value) => { events.push("competing-resolved"); return { status: "fulfilled" as const, value }; })
      .catch((reason) => { events.push("competing-resolved"); return { status: "rejected" as const, reason }; });

    // 證明競爭呼叫真的被鎖擋住：短暫等待後，它仍未完成——這不是同步機制本身
    // （真正的同步機制是上面持有的 row lock），只是用來驗證「此刻真的被擋住」
    // 的檢查手段。
    const stillPending = await Promise.race([
      competingPromise.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 400)),
    ]);
    if (!stillPending) {
      throw new Error("測試前提不成立：競爭中的呼叫在手動鎖定期間就完成了，代表沒有真的被 row lock 擋住");
    }

    await opts.manualWork(conn);
    await conn.commit();
    events.push("manual-tx-committed");

    const competingResult = await competingPromise;
    return { competingResult, events };
  } finally {
    await conn.end();
  }
}

// factories.uq_factory_owner_id 限制「一個帳號只能擁有一間工廠」，因此每個
// 情境各自需要獨立的 owner 使用者。
let ownerAId: number;
let ownerBId: number;
let ownerCId: number;
let ownerDId: number;
let factoryA: number; // 情境 (a)
let factoryB: number; // 情境 (b)
let factoryC: number; // 情境 (c)
let factoryD: number; // 情境 (d)

let consultantAUserId: number;
let consultantA: number;
let consultantBUserId: number;
let consultantB: number;
let consultantCUserId: number;
let consultantC: number;
let consultantDUserId: number;
let consultantD: number;

beforeAll(async () => {
  [ownerAId, ownerBId, ownerCId, ownerDId] = await Promise.all([
    ensureTestUser(`test-fin-race-ownerA-${runId}`, "競態測試申請人A"),
    ensureTestUser(`test-fin-race-ownerB-${runId}`, "競態測試申請人B"),
    ensureTestUser(`test-fin-race-ownerC-${runId}`, "競態測試申請人C"),
    ensureTestUser(`test-fin-race-ownerD-${runId}`, "競態測試申請人D"),
  ]);
  [factoryA, factoryB, factoryC, factoryD] = await Promise.all([
    createTestFactory(ownerAId, `${PREFIX} 工廠A`),
    createTestFactory(ownerBId, `${PREFIX} 工廠B`),
    createTestFactory(ownerCId, `${PREFIX} 工廠C`),
    createTestFactory(ownerDId, `${PREFIX} 工廠D`),
  ]);

  [consultantAUserId, consultantBUserId, consultantCUserId, consultantDUserId] = await Promise.all([
    ensureTestUser(`test-fin-race-consultantA-${runId}`, "競態測試顧問A"),
    ensureTestUser(`test-fin-race-consultantB-${runId}`, "競態測試顧問B"),
    ensureTestUser(`test-fin-race-consultantC-${runId}`, "競態測試顧問C"),
    ensureTestUser(`test-fin-race-consultantD-${runId}`, "競態測試顧問D"),
  ]);
  // 注意：financeConsultants 列本身刻意「不」在這裡先建立好——每個情境的
  // it() 各自在開始時建立、結束時刪除自己的顧問列。原因：
  // createFinanceApplicationWithAutoAssign 的候選人查詢是
  // `WHERE isActive=true AND userId IS NOT NULL`（沒有用 id 過濾的多列掃描），
  // 如果同時存在其他情境的「啟用中＋已綁定」顧問列，會讓這裡的 FOR UPDATE
  // 掃描到多顆列、跟其他情境的手動鎖定交易互相持有不同列的鎖，形成真正的
  // MySQL 死結（deadlock）——這是測試資料隔離的問題，不是被測試邏輯本身的
  // 缺陷，所以用「每個情境只在自己執行期間存在自己的顧問列」來避免。
}, 30000);

afterAll(async () => {
  await Promise.all([
    deleteTestFactory(factoryA),
    deleteTestFactory(factoryB),
    deleteTestFactory(factoryC),
    deleteTestFactory(factoryD),
  ]);
  await Promise.all([
    deleteTestUser(consultantAUserId),
    deleteTestUser(consultantBUserId),
    deleteTestUser(consultantCUserId),
    deleteTestUser(consultantDUserId),
    deleteTestUser(ownerAId),
    deleteTestUser(ownerBId),
    deleteTestUser(ownerCId),
    deleteTestUser(ownerDId),
  ]);
}, 30000);

function newAppData(factoryId: number, label: string) {
  return {
    factoryId,
    companyNameSnapshot: `${PREFIX} ${label}`,
    companyAddressSnapshot: "測試地址",
    contactName: "測試聯絡人",
    phone: "0900000000",
    contactTime: "任何時間",
    consentAgreed: true,
    status: "new" as const,
    statusTimeline: { new: new Date().toISOString() },
  };
}

describe("(a) 停用交易先鎖定顧問列：新申請的自動指派必須真的等待，停用完成後新案件不可指派給該顧問", () => {
  it("交錯順序：手動鎖定（模擬停用）→ 自動指派被真的擋住 → 停用完成 commit → 自動指派才繼續，結果未指派", async () => {
    consultantA = await db.adminCreateFinanceConsultant(`${PREFIX} 顧問A`);
    await db.adminBindFinanceConsultantUser(consultantA, consultantAUserId);
    try {
      const { competingResult, events } = await raceWithManualLock({
        consultantId: consultantA,
        competing: () => db.createFinanceApplicationWithAutoAssign(newAppData(factoryA, "情境A案件")),
        manualWork: async (conn) => {
          await conn.execute("UPDATE financeConsultants SET isActive = false WHERE id = ?", [consultantA]);
        },
      });

      expect(events).toEqual(["manual-lock-acquired", "manual-tx-committed", "competing-resolved"]);
      expect(competingResult.status).toBe("fulfilled");
      if (competingResult.status !== "fulfilled") throw new Error("unreachable");

      expect(competingResult.value.assignedConsultant).toBeNull();
      const app = await db.getFinanceApplicationById(competingResult.value.id);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      await deleteFinanceConsultant(consultantA);
    }
  });
});

describe("(b) 新申請先鎖定並建立成功，停用隨後才執行：最終案件必須變成未指派", () => {
  it("交錯順序：手動鎖定＋插入新案件（模擬自動指派勝出）→ 停用被真的擋住 → 新案件 commit → 停用才繼續，級聯把案件改為未指派", async () => {
    consultantB = await db.adminCreateFinanceConsultant(`${PREFIX} 顧問B`);
    await db.adminBindFinanceConsultantUser(consultantB, consultantBUserId);
    try {
      let insertedId: number | undefined;
      const { competingResult, events } = await raceWithManualLock({
        consultantId: consultantB,
        competing: () => db.adminSetFinanceConsultantActive(consultantB, false),
        manualWork: async (conn) => {
          const data = newAppData(factoryB, "情境B案件");
          const [result] = await conn.execute(
            `INSERT INTO financeApplications
               (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime, consentAgreed, status, assignedConsultantId, statusTimeline, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              data.factoryId, data.companyNameSnapshot, data.companyAddressSnapshot,
              data.contactName, data.phone, data.contactTime, data.consentAgreed, data.status,
              consultantB, JSON.stringify(data.statusTimeline),
            ],
          ) as unknown as [{ insertId: number }, unknown];
          insertedId = result.insertId;
        },
      });

      expect(events).toEqual(["manual-lock-acquired", "manual-tx-committed", "competing-resolved"]);
      expect(competingResult.status).toBe("fulfilled");
      if (competingResult.status !== "fulfilled") throw new Error("unreachable");
      expect(insertedId).toBeDefined();

      expect(competingResult.value.reassignedCases.map(c => c.id)).toContain(insertedId);
      const app = await db.getFinanceApplicationById(insertedId!);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      await deleteFinanceConsultant(consultantB);
    }
  });
});

describe("(c) 解除綁定＋新申請併發：不得讓案件停留在指派給已解除綁定顧問的狀態", () => {
  it("交錯順序：手動鎖定（模擬解除綁定）→ 自動指派被真的擋住 → 解除綁定完成 commit → 自動指派才繼續，結果未指派", async () => {
    consultantC = await db.adminCreateFinanceConsultant(`${PREFIX} 顧問C`);
    await db.adminBindFinanceConsultantUser(consultantC, consultantCUserId);
    try {
      const { competingResult, events } = await raceWithManualLock({
        consultantId: consultantC,
        competing: () => db.createFinanceApplicationWithAutoAssign(newAppData(factoryC, "情境C案件")),
        manualWork: async (conn) => {
          await conn.execute("UPDATE financeConsultants SET userId = NULL WHERE id = ?", [consultantC]);
        },
      });

      expect(events).toEqual(["manual-lock-acquired", "manual-tx-committed", "competing-resolved"]);
      expect(competingResult.status).toBe("fulfilled");
      if (competingResult.status !== "fulfilled") throw new Error("unreachable");

      expect(competingResult.value.assignedConsultant).toBeNull();
      const app = await db.getFinanceApplicationById(competingResult.value.id);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      await deleteFinanceConsultant(consultantC);
    }
  });
});

describe("(d) 手動指派＋停用併發：不得讓最終指派結果落在已停用顧問身上", () => {
  it("交錯順序：手動鎖定（模擬停用）→ 手動指派被真的擋住 → 停用完成 commit → 手動指派才繼續，重新驗證後必須拒絕", async () => {
    consultantD = await db.adminCreateFinanceConsultant(`${PREFIX} 顧問D`);
    await db.adminBindFinanceConsultantUser(consultantD, consultantDUserId);
    try {
      const appId = await db.createFinanceApplication(newAppData(factoryD, "情境D案件"));

      const { competingResult, events } = await raceWithManualLock({
        consultantId: consultantD,
        competing: () => db.adminAssignFinanceConsultant(appId, consultantD),
        manualWork: async (conn) => {
          await conn.execute("UPDATE financeConsultants SET isActive = false WHERE id = ?", [consultantD]);
        },
      });

      expect(events).toEqual(["manual-lock-acquired", "manual-tx-committed", "competing-resolved"]);
      // 手動指派必須在鎖釋放、重新讀到「已停用」之後拒絕——不能把案件指派給已停用顧問。
      expect(competingResult.status).toBe("rejected");
      if (competingResult.status !== "rejected") throw new Error("unreachable");
      expect(String((competingResult.reason as Error)?.message ?? competingResult.reason)).toMatch(/已停用/);

      const app = await db.getFinanceApplicationById(appId);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      await deleteFinanceConsultant(consultantD);
    }
  });
});
