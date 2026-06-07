/**
 * 一人只能隸屬一間工廠 — 併發整合測試
 *
 * 測試方式：使用兩條獨立 MySQL connection，透過 Promise.allSettled 同時發起互相衝突的操作。
 * MySQL 的 FOR UPDATE row lock 確保序列化，最終 DB 狀態必須滿足唯一性規則。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { createFactoryAtomic, acceptInvitation } from "./db";

// 只在有 DATABASE_URL 時執行（Vitest 環境需設定）
const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let setupConn: mysql.PoolConnection;

const PREFIX = "[CONCURRENT_TEST]";

async function mkUser(conn: mysql.PoolConnection, email: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, ?, NOW())",
    [email, email, email, "user"]
  );
  return r.insertId;
}

async function mkFactory(conn: mysql.PoolConnection, ownerId: number, suffix: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, NOW(), NOW())",
    [ownerId, `${PREFIX} ${suffix}`, JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", "draft", "normal", "[]"]
  );
  return r.insertId;
}

async function mkInvitation(conn: mysql.PoolConnection, factoryId: number, inviterUserId: number, inviteeUserId: number): Promise<number> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  // Need conversationId — create a dummy conversation first
  const [convR] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO conversations (userId, factoryId, lastMessageAt, createdAt) VALUES (?, ?, NOW(), NOW())",
    [inviteeUserId, factoryId]
  );
  const convId = convR.insertId;
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factoryCoManagerInvitations (factoryId, inviterUserId, inviteeUserId, status, conversationId, expiresAt, createdAt) VALUES (?, ?, ?, 'pending', ?, ?, NOW())",
    [factoryId, inviterUserId, inviteeUserId, convId, expiresAt]
  );
  return r.insertId;
}

async function cleanup(conn: mysql.PoolConnection) {
  // Delete in dependency order to avoid FK violations
  await conn.execute("DELETE FROM factoryCoManagerInvitations WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factoryCoManagers WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM conversations WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["concurrent_test_%@oxm.test"]);
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = mysql.createPool(DB_URL);
  setupConn = await pool.getConnection();
  await cleanup(setupConn);
});

afterAll(async () => {
  if (!DB_URL) return;
  await cleanup(setupConn);
  setupConn.release();
  await pool.end();
});

describeIfDb("工廠身分唯一性 — 併發情境", () => {
  it("情境 A：同一 userId 同時接受兩間工廠邀請，只能一筆成功", async () => {
    // 準備：兩間不同工廠，各自邀請同一個 userId
    const ownerA = await mkUser(setupConn, "concurrent_test_ownerA@oxm.test");
    const ownerB = await mkUser(setupConn, "concurrent_test_ownerB@oxm.test");
    const invitee = await mkUser(setupConn, "concurrent_test_invitee_A@oxm.test");

    const factoryA = await mkFactory(setupConn, ownerA, "Factory A");
    const factoryB = await mkFactory(setupConn, ownerB, "Factory B");

    const invA = await mkInvitation(setupConn, factoryA, ownerA, invitee);
    const invB = await mkInvitation(setupConn, factoryB, ownerB, invitee);

    // 同時接受兩筆邀請 — Promise.allSettled 讓兩個 async 鏈同時啟動
    // MySQL 的 users row FOR UPDATE 保證只有一筆能完整通過
    const results = await Promise.allSettled([
      acceptInvitation(invA, invitee),
      acceptInvitation(invB, invitee),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    // 必須：恰好一成功、一失敗
    expect(successes.length, "應該恰好一筆接受成功").toBe(1);
    expect(failures.length, "應該恰好一筆被拒絕").toBe(1);

    // 失敗訊息必須來自應用層或 DB constraint
    const failMsg = (failures[0] as PromiseRejectedResult).reason?.message ?? "";
    const validFailMessages = [
      "您已擁有或管理其他工廠，無法加入此工廠",
      "您已是此工廠的次管理者",
      "Duplicate entry",  // DB constraint fallback
    ];
    expect(validFailMessages.some((m) => failMsg.includes(m)), `失敗訊息不符: "${failMsg}"`).toBe(true);

    // 驗證 DB 最終狀態：只有一筆 active co-manager
    const [activeRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM factoryCoManagers WHERE userId = ? AND removedAt IS NULL",
      [invitee]
    );
    expect(activeRows.length, "DB 應只有一筆 active co-manager").toBe(1);

    // 驗證邀請狀態：一 accepted，一 pending（被 transaction rollback 保留）
    const [invRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM factoryCoManagerInvitations WHERE id IN (?, ?) ORDER BY id",
      [invA, invB]
    );
    const statuses = invRows.map((r) => r.status);
    expect(statuses.filter((s) => s === "accepted").length, "應只有一筆 invitation 變成 accepted").toBe(1);
  }, 30000);

  it("情境 B：同一 userId 同時建立兩間工廠，只能一筆成功", async () => {
    const userId = await mkUser(setupConn, "concurrent_test_creator@oxm.test");

    const factoryInput = {
      name: `${PREFIX} Creator Factory`,
      industry: ["電子"] as string[],
      mfgModes: ["ODM"] as string[],
      region: "新竹市",
      capitalLevel: "<1000萬",
      address: "新竹市",
      businessType: "factory" as const,
    };

    // 同時發起兩次建立工廠
    const results = await Promise.allSettled([
      createFactoryAtomic(userId, { ...factoryInput, name: `${PREFIX} Creator Factory 1` }),
      createFactoryAtomic(userId, { ...factoryInput, name: `${PREFIX} Creator Factory 2` }),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length, "應該恰好一筆建立成功").toBe(1);
    expect(failures.length, "應該恰好一筆被拒絕").toBe(1);

    // 失敗訊息應為「已擁有工廠」或 DB ER_DUP_ENTRY
    const failMsg = (failures[0] as PromiseRejectedResult).reason?.message ?? "";
    const valid = failMsg.includes("您已擁有工廠") || failMsg.includes("Duplicate entry");
    expect(valid, `失敗訊息不符: "${failMsg}"`).toBe(true);

    // 驗證 DB：只有一間工廠
    const [factoryRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM factories WHERE ownerId = ?",
      [userId]
    );
    expect(factoryRows.length, "DB 應只有一間工廠").toBe(1);

    // 驗證 users.isFactoryOwner
    const [userRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT isFactoryOwner FROM users WHERE id = ?",
      [userId]
    );
    expect(userRows[0].isFactoryOwner, "users.isFactoryOwner 應為 1").toBe(1);
  }, 30000);

  it("情境 C：建立工廠與接受邀請同時發生，只能一個成功", async () => {
    const targetUser = await mkUser(setupConn, "concurrent_test_target@oxm.test");
    const factoryOwner = await mkUser(setupConn, "concurrent_test_owner_C@oxm.test");
    const existingFactory = await mkFactory(setupConn, factoryOwner, "Existing Factory C");
    const invId = await mkInvitation(setupConn, existingFactory, factoryOwner, targetUser);

    const factoryInput = {
      name: `${PREFIX} Target Own Factory`,
      industry: ["電子"] as string[],
      mfgModes: ["ODM"] as string[],
      region: "新竹市",
      capitalLevel: "<1000萬",
      address: "新竹市",
      businessType: "factory" as const,
    };

    // 同時：targetUser 建立自己的工廠 AND 接受另一間工廠邀請
    const results = await Promise.allSettled([
      createFactoryAtomic(targetUser, factoryInput),
      acceptInvitation(invId, targetUser),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length, "應該恰好一個操作成功").toBe(1);
    expect(failures.length, "應該恰好一個操作被拒絕").toBe(1);

    // 驗證 DB：targetUser 不可能同時是 owner 又是 active co-manager
    const [ownerRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM factories WHERE ownerId = ?",
      [targetUser]
    );
    const [coMgrRows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM factoryCoManagers WHERE userId = ? AND removedAt IS NULL",
      [targetUser]
    );

    // 恰好只有一種身分
    const totalAffiliation = ownerRows.length + coMgrRows.length;
    expect(totalAffiliation, "targetUser 應只有一種有效工廠身分").toBe(1);

    // 不可能兩種身分同時存在
    expect(ownerRows.length === 1 && coMgrRows.length === 1,
      "不應同時身兼 owner 與 active co-manager").toBe(false);
  }, 30000);
});
