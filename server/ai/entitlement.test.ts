/**
 * Phase 8.1 AUTH 系列：resolveAiEntitlement 真實 DB 整合測試（見對話中
 * 「一、entitlement 規則」）。直接沿用 factory-uniqueness-concurrent.test.ts
 * 的 fixture 慣例（真實 mysql2 connection＋PREFIX 命名＋beforeAll/afterAll
 * 清理），不 mock getActiveFactoryAffiliationDetail——這個 helper 本身的
 * 正確性已經由既有測試涵蓋，這裡驗證的是 resolveAiEntitlement 疊加在它
 * 上面的判斷邏輯（guest／no_factory／factory_member／admin 四種分類）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { resolveAiEntitlement } from "./entitlement";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;

const PREFIX = "[AUTH_TEST]";

async function mkUser(email: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, email]
  );
  return r.insertId;
}

async function mkFactory(ownerId: number, suffix: string, status: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'normal', FALSE, ?, NOW(), NOW())",
    [ownerId, `${PREFIX} ${suffix}`, JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", status, "[]"]
  );
  return r.insertId;
}

async function mkCoManager(factoryId: number, userId: number, invitedBy: number): Promise<void> {
  await conn.execute(
    "INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, createdAt) VALUES (?, ?, ?, NOW())",
    [factoryId, userId, invitedBy]
  );
}

async function cleanup() {
  await conn.execute("DELETE FROM factoryCoManagers WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["auth_test_%@oxm.test"]);
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = mysql.createPool(DB_URL);
  conn = await pool.getConnection();
  await cleanup();
});

afterAll(async () => {
  if (!DB_URL) return;
  await cleanup();
  conn.release();
  await pool.end();
});

describeIfDb("resolveAiEntitlement（Phase 8.1 AUTH 系列）", () => {
  it("AUTH1：guest（userId 為 null）一律回傳 guest，不查 DB", async () => {
    const result = await resolveAiEntitlement(null, false);
    expect(result).toEqual({ kind: "guest" });
  });

  it("AUTH2：已登入但沒有任何工廠身分 → no_factory", async () => {
    const userId = await mkUser("auth_test_no_factory@oxm.test");
    const result = await resolveAiEntitlement(userId, false);
    expect(result.kind).toBe("no_factory");
  });

  it("AUTH3：已核准工廠的 owner → factory_member / owner", async () => {
    const userId = await mkUser("auth_test_owner@oxm.test");
    const factoryId = await mkFactory(userId, "Owner Factory", "approved");
    const result = await resolveAiEntitlement(userId, false);
    expect(result).toMatchObject({ kind: "factory_member", factoryId, role: "owner" });
  });

  it("AUTH4：已核准工廠的 active co-manager → factory_member / co_manager", async () => {
    const ownerUserId = await mkUser("auth_test_owner2@oxm.test");
    const coManagerUserId = await mkUser("auth_test_comanager@oxm.test");
    const factoryId = await mkFactory(ownerUserId, "CoManaged Factory", "approved");
    await mkCoManager(factoryId, coManagerUserId, ownerUserId);
    const result = await resolveAiEntitlement(coManagerUserId, false);
    expect(result).toMatchObject({ kind: "factory_member", factoryId, role: "co_manager" });
  });

  it("AUTH5：工廠是 owner，但工廠狀態是 draft（尚未審核）→ no_factory", async () => {
    const userId = await mkUser("auth_test_draft_owner@oxm.test");
    await mkFactory(userId, "Draft Factory", "draft");
    const result = await resolveAiEntitlement(userId, false);
    expect(result.kind).toBe("no_factory");
  });

  it("AUTH6：admin 本身也是已核准工廠的 owner → admin，且帶出 factoryId", async () => {
    const userId = await mkUser("auth_test_admin_owner@oxm.test");
    const factoryId = await mkFactory(userId, "Admin Owned Factory", "approved");
    const result = await resolveAiEntitlement(userId, true);
    expect(result).toMatchObject({ kind: "admin", factoryId });
  });

  it("AUTH7：admin 完全沒有工廠身分 → admin，factoryId 為 null（見使用者對「Admin 無工廠語境」的最終決議）", async () => {
    const userId = await mkUser("auth_test_admin_no_factory@oxm.test");
    const result = await resolveAiEntitlement(userId, true);
    expect(result).toEqual({ kind: "admin", factoryId: null, factoryName: null });
  });

  it("AUTH8：admin 身分優先於 factory_member 判斷——即使有已核准工廠也回傳 admin 而不是 factory_member", async () => {
    const userId = await mkUser("auth_test_admin_priority@oxm.test");
    await mkFactory(userId, "Admin Priority Factory", "approved");
    const result = await resolveAiEntitlement(userId, true);
    expect(result.kind).toBe("admin");
  });
});
