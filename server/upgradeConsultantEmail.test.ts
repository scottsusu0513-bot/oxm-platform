/**
 * 顧問 Email fallback 回歸測試。
 *
 * 背景：LINE／Apple 登入的使用者 users.email 可能永遠是 null（只有 Google 登入
 * 才會在建帳號當下自動寫入 email，見 server/_core/oauthHelpers.ts），實際可聯絡
 * 的信箱是使用者自行完成驗證的 primaryEmail。修正前，顧問卡片顯示、新案件通知信、
 * 舊案件補派通知信這三處都只讀 users.email，導致這類使用者顯示「Email：—」且完全
 * 收不到通知信。修正方式統一沿用專案既有慣例 primaryEmail ?? email。
 *
 * listAllConsultants 走真實 DB（沿用 loginPopup.test.ts 已驗證過的原生 SQL 建立
 * 測試使用者的模式，避開 db.upsertUser 對 schema 全欄位的假設）；新案件通知與
 * 補派通知兩處因為是包在 fire-and-forget mutation 內、且會觸發真實寄信/推播模組，
 * 完整走 tRPC router + mock email 模組成本過高，改用原始碼內容斷言（與
 * server/factoryContactLogin.test.ts、server/navbarMobileAccordion.test.ts 相同
 * 手法），精確驗證兩處都使用 primaryEmail ?? email ?? null 且不再單獨用
 * consultantUser?.email 當作「有沒有信箱」的判斷依據。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { getDb } from "./db";

const runId = `uce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function createTestUserWithPrimaryEmailOnly(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  const primaryEmail = `${runId}@example.test`;
  // email 刻意留 NULL，模擬 LINE／Apple 登入、email 欄位未被自動寫入的帳號；
  // primaryEmail 模擬使用者已自行驗證過的主要信箱。
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt)
    VALUES (${openId}, ${`Consultant Test ${runId}`}, NULL, ${primaryEmail}, NOW())
  `);
  const [rows] = await conn.execute(
    sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`
  ) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

async function deleteTestUser(userId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

/**
 * 建立一筆完全屬於本測試自己的 upgradeConsultants fixture（不依賴、不觸碰任何
 * 既有的 north／central／south 顧問列）。regionKey 雖然有 UNIQUE 索引，但這裡
 * 用測試自建、測試自刪的獨立列，不會與既有資料或其他測試互相干擾——即使本機
 * 測試資料庫（oxm_test）一開始完全沒有任何顧問 seed 資料，這個測試也能正常
 * 執行；反過來說，即使本機 oxm 已經有真實的 north/central/south 顧問，這裡
 * 建立的也是「另一筆獨立的顧問紀錄」，不會覆蓋或修改既有那三筆。
 */
async function createTestConsultant(regionKey: "north" | "central" | "south", userId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO upgradeConsultants (name, regionKey, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${`Email 測試顧問 ${runId}`}, ${regionKey}, ${userId}, ${JSON.stringify(["測試服務區"])}, true, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function deleteTestConsultant(consultantId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM upgradeConsultants WHERE id = ${consultantId}`);
}

describe("listAllConsultants: boundUser.email 使用 COALESCE(primaryEmail, email)", () => {
  it("使用者 email=null、primaryEmail 有值時，boundUser.email 回傳 primaryEmail 而非 null", async () => {
    let testUserId: number | undefined;
    let testConsultantId: number | undefined;

    try {
      testUserId = await createTestUserWithPrimaryEmailOnly();
      // regionKey 用 "north" 只是任取一個合法 enum 值，這是測試自建的獨立列，
      // 不是既有共用的 north 顧問（沒有唯一索引衝突：一次只建立這一筆）。
      testConsultantId = await createTestConsultant("north", testUserId);

      const all = await db.listAllConsultants();
      const row = all.find(c => c.id === testConsultantId);

      expect(row, "找不到剛建立的測試顧問紀錄").toBeDefined();
      expect(row!.boundUser).not.toBeNull();
      expect(row!.boundUser!.email).toBe(`${runId}@example.test`);
      expect(row!.boundUser!.email).not.toBeNull();
    } finally {
      // 只清理本測試自己建立、且已確認建立成功的 fixture；不觸碰任何既有顧問列。
      if (testConsultantId) {
        await deleteTestConsultant(testConsultantId);
      }
      if (testUserId) {
        await deleteTestUser(testUserId);
      }
    }
  });
});

describe("server/routers.ts: 顧問通知信 email fallback（原始碼內容斷言）", () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");

  it("新案件通知（upgradeCenter.submitApplication）使用 primaryEmail ?? email ?? null，且不再單獨用 consultantUser?.email 判斷", () => {
    const blockMatch = source.match(
      /void db\.getUserById\(notifyConsultant\.userId!\)\.then\(async \(consultantUser\) => \{[\s\S]*?\}\)\.catch/
    );
    expect(blockMatch, "找不到新案件通知的 fire-and-forget 區塊").not.toBeNull();
    const block = blockMatch![0];

    expect(block).toMatch(
      /const consultantEmail = consultantUser\?\.primaryEmail \?\? consultantUser\?\.email \?\? null;/
    );
    expect(block).toMatch(/if \(!consultantEmail\) \{/);
    expect(block).toMatch(/consultantEmail,\s/); // sendUpgradeNewCaseConsultantEmail 呼叫改用簡寫變數
    // 不能再有「單獨檢查 consultantUser?.email」這種舊寫法殘留
    expect(block).not.toMatch(/if \(!consultantUser\?\.email\)/);
    expect(block).not.toMatch(/consultantEmail: consultantUser\.email/);
  });

  it("補派通知（upgradeConsultant.adminBindUser）使用 primaryEmail ?? email ?? null，且不再單獨用 consultantUser?.email 判斷", () => {
    const blockMatch = source.match(
      /void db\.getUserById\(input\.userId\)\.then\(async \(consultantUser\) => \{[\s\S]*?\n {8}\}\);/
    );
    expect(blockMatch, "找不到補派通知的 fire-and-forget 區塊").not.toBeNull();
    const block = blockMatch![0];

    expect(block).toMatch(
      /const consultantEmail = consultantUser\?\.primaryEmail \?\? consultantUser\?\.email \?\? null;/
    );
    expect(block).toMatch(/if \(!consultantEmail\) \{/);
    expect(block).toMatch(/consultantEmail,\s/);
    expect(block).not.toMatch(/if \(!consultantUser\?\.email\)/);
    expect(block).not.toMatch(/consultantEmail: consultantUser\.email/);
  });

  it("信箱優先順序固定是 primaryEmail 優先、email 其次，不是反過來", () => {
    const occurrences = source.match(/consultantUser\?\.primaryEmail \?\? consultantUser\?\.email \?\? null/g) ?? [];
    expect(occurrences.length).toBe(2); // 新案件通知 + 補派通知，各一次
    expect(source).not.toMatch(/consultantUser\?\.email \?\? consultantUser\?\.primaryEmail/);
  });
});

describe("server/db.ts: listAllConsultants 原始碼內容斷言", () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "db.ts"), "utf-8");

  it("boundUser.email 的 SELECT 使用 COALESCE(primaryEmail, email)，不再單獨 select users.email", () => {
    const fnMatch = source.match(
      /export async function listAllConsultants\(\)[\s\S]*?\n\}/
    );
    expect(fnMatch, "找不到 listAllConsultants 函式").not.toBeNull();
    const fn = fnMatch![0];

    expect(fn).toMatch(/COALESCE\(\$\{users\.primaryEmail\}, \$\{users\.email\}\)/);
    expect(fn).not.toMatch(/email: users\.email,/);
  });
});
