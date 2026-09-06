/**
 * 產業新增需求（industryRequest router）server 端整合測試。
 * 架構比照 server/factoryTaxId.test.ts：真實本機測試資料庫 oxm_test、
 * appRouter.createCaller(ctx) 直接呼叫 tRPC procedure。
 *
 * industryRequests / industryRequestStatusHistory 兩張表若尚未存在（測試 DB
 * 未跑過 0098 migration），在 beforeAll 以 CREATE TABLE IF NOT EXISTS 建立，
 * 完全隔離在 oxm_test，afterAll 清掉本測試建立的資料列。
 *
 * 涵蓋 spec 二十二 的：create / active uniqueness / getMine /
 * admin list / admin update / admin authorization / user 不能讀他人 /
 * messageUser thread 綁定 / 官方 sender identity。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const runId = `ir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

async function createTestUser(opts: { admin?: boolean } = {}): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  seq += 1;
  const openId = `${runId}-${seq}`;
  // 管理員：用 .env ADMIN_WHITELIST_EMAILS 內實際設定的白名單 email 讓
  // isAdminUser() 在本機通過（見 server/adminFactoryCrm.test.ts 同樣做法）。
  const email = opts.admin ? "scottsusu0513@gmail.com" : `${openId}@example.test`;
  const name = `IR ${openId}`;
  const phone = "0900123456";
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, phone, createdAt, isFactoryOwner)
    VALUES (${openId}, ${name}, ${email}, ${email}, NOW(), ${phone}, NOW(), FALSE)
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

async function ctxForUserId(userId: number): Promise<TrpcContext> {
  const user = await db.getUserById(userId);
  if (!user) throw new Error("test user not found");
  return {
    user: { ...user, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS industryRequests (
      id int AUTO_INCREMENT PRIMARY KEY NOT NULL,
      userId int NOT NULL,
      name varchar(200) NOT NULL,
      email varchar(320) NOT NULL,
      phone varchar(30),
      description text NOT NULL,
      status enum('pending','reviewing','resolved','rejected') NOT NULL DEFAULT 'pending',
      adminNote text,
      adminMessageCampaignId int,
      activeFlag int GENERATED ALWAYS AS ((CASE WHEN status IN ('pending','reviewing') THEN 1 ELSE NULL END)) STORED,
      createdAt timestamp NOT NULL DEFAULT (now()),
      updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
      CONSTRAINT uq_industry_request_active_user UNIQUE(userId, activeFlag),
      CONSTRAINT fk_industry_request_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_industry_request_campaign FOREIGN KEY (adminMessageCampaignId) REFERENCES messageCampaigns(id) ON DELETE SET NULL
    )
  `));
  await conn.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS industryRequestStatusHistory (
      id int AUTO_INCREMENT PRIMARY KEY NOT NULL,
      requestId int NOT NULL,
      status enum('pending','reviewing','resolved','rejected') NOT NULL,
      adminNote text,
      createdAt timestamp NOT NULL DEFAULT (now())
    )
  `));
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM messageReplies WHERE campaignId IN (SELECT id FROM messageCampaigns WHERE title = '關於您提出的產業新增需求' AND senderId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`}))`);
  await conn.execute(sql`DELETE FROM messageRecipients WHERE receiverId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`})`);
  await conn.execute(sql`DELETE FROM industryRequestStatusHistory WHERE requestId IN (SELECT id FROM industryRequests WHERE userId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`}))`);
  await conn.execute(sql`DELETE FROM industryRequests WHERE userId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`})`);
  await conn.execute(sql`DELETE FROM messageCampaigns WHERE senderId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`})`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`${runId}-%`}`);
});

describe("industryRequest.create + getMine", () => {
  it("建立需求 → created:true、getMine 回傳 active 且為唯讀受理狀態", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const res = await caller.industryRequest.create({
      name: "王小明", email: "wang@example.test", phone: "0912345678",
      description: "我們做寵物用品的智慧餵食器，找不到合適分類",
    });
    expect(res.created).toBe(true);
    expect(res.request.status).toBe("pending");

    const mine = await caller.industryRequest.getMine();
    expect(mine.isActive).toBe(true);
    expect(mine.request?.description).toContain("智慧餵食器");
    // snapshot：帶入的是表單填的姓名，不是 user profile 的名字
    expect(mine.request?.name).toBe("王小明");
  });

  it("需求說明只有空白 → zod 拒絕", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    await expect(caller.industryRequest.create({
      name: "A", email: "a@example.test", description: "   ",
    })).rejects.toBeTruthy();
  });

  it("phone 選填：不帶 phone 也能建立", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const res = await caller.industryRequest.create({
      name: "B", email: "b@example.test", description: "無電話的需求",
    });
    expect(res.created).toBe(true);
    expect(res.request.phone).toBeNull();
  });

  it("尚未提交過 → getMine 回 request:null / isActive:false", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const mine = await caller.industryRequest.getMine();
    expect(mine.request).toBeNull();
    expect(mine.isActive).toBe(false);
  });
});

describe("active request 唯一性", () => {
  it("同一 user 已有 active → 再 create 回既有那筆（created:false），DB 只有 1 筆 active", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const first = await caller.industryRequest.create({ name: "C", email: "c@example.test", description: "第一筆需求" });
    expect(first.created).toBe(true);
    const second = await caller.industryRequest.create({ name: "C2", email: "c2@example.test", description: "想再送一筆" });
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(second.request.description).toBe("第一筆需求"); // 沒有被覆寫

    const conn = await getDb();
    const [rows] = (await conn!.execute(
      sql`SELECT COUNT(*) AS n FROM industryRequests WHERE userId = ${uid} AND status IN ('pending','reviewing')`,
    )) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0].n)).toBe(1);
  });

  it("並發 create（同時 5 個請求）→ 仍只建立 1 筆 active", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        caller.industryRequest.create({ name: `D${i}`, email: `d${i}@example.test`, description: `並發需求 ${i}` }),
      ),
    );
    const fulfilled = results.filter(r => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const createdCount = fulfilled.filter(r => r.value.created).length;
    expect(createdCount).toBe(1);

    const conn = await getDb();
    const [rows] = (await conn!.execute(
      sql`SELECT COUNT(*) AS n FROM industryRequests WHERE userId = ${uid}`,
    )) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0].n)).toBe(1);
  });

  it("結案(resolved)後可再提新的一筆 active", async () => {
    const memberId = await createTestUser();
    const adminId = await createTestUser({ admin: true });
    const memberCaller = appRouter.createCaller(await ctxForUserId(memberId));
    const adminCaller = appRouter.createCaller(await ctxForUserId(adminId));

    const first = await memberCaller.industryRequest.create({ name: "E", email: "e@example.test", description: "舊需求" });
    await adminCaller.industryRequest.admin.updateStatus({ id: first.request.id, status: "resolved" });

    let mine = await memberCaller.industryRequest.getMine();
    expect(mine.isActive).toBe(false); // resolved 不再是 active

    const second = await memberCaller.industryRequest.create({ name: "E2", email: "e2@example.test", description: "結案後的新需求" });
    expect(second.created).toBe(true);
    expect(second.request.id).not.toBe(first.request.id);

    mine = await memberCaller.industryRequest.getMine();
    expect(mine.isActive).toBe(true);
    expect(mine.request?.description).toBe("結案後的新需求");
  });
});

describe("admin 授權與案件操作", () => {
  it("非管理員呼叫 admin.list → 被拒", async () => {
    const uid = await createTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    await expect(caller.industryRequest.admin.list({})).rejects.toBeTruthy();
  });

  it("管理員可 list / get / updateStatus(+history)", async () => {
    const memberId = await createTestUser();
    const adminId = await createTestUser({ admin: true });
    const memberCaller = appRouter.createCaller(await ctxForUserId(memberId));
    const adminCaller = appRouter.createCaller(await ctxForUserId(adminId));

    const created = await memberCaller.industryRequest.create({
      name: "審核用", email: "review@example.test", phone: "0987654321", description: "管理員應該看得到姓名/email/phone/description/userId",
    });

    const list = await adminCaller.industryRequest.admin.list({ status: "pending" });
    const found = list.items.find(x => x.id === created.request.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe("審核用");
    expect(found!.email).toBe("review@example.test");
    expect(found!.phone).toBe("0987654321");
    expect(found!.description).toContain("userId");
    expect(found!.userId).toBe(memberId); // spec 十六：保留 userId 關聯

    const detail = await adminCaller.industryRequest.admin.get({ id: created.request.id });
    expect(detail.userId).toBe(memberId);

    await adminCaller.industryRequest.admin.updateStatus({ id: created.request.id, status: "reviewing", adminNote: "已聯繫，等回覆" });
    const detail2 = await adminCaller.industryRequest.admin.get({ id: created.request.id });
    expect(detail2.status).toBe("reviewing");
    expect(detail2.adminNote).toBe("已聯繫，等回覆");

    const history = await adminCaller.industryRequest.admin.getHistory({ id: created.request.id });
    expect(history.map(h => h.status)).toEqual(["pending", "reviewing"]);
  });

  it("會員的 getMine 只回自己的需求（拿不到別人的）", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const callerA = appRouter.createCaller(await ctxForUserId(userA));
    const callerB = appRouter.createCaller(await ctxForUserId(userB));
    await callerA.industryRequest.create({ name: "A的需求", email: "onlya@example.test", description: "只有 A 該看到" });
    const bMine = await callerB.industryRequest.getMine();
    expect(bMine.request).toBeNull();
  });
});

describe("admin messageUser：綁定 thread、不重建、不改狀態", () => {
  it("第一次 → 建立 campaign 並寫回 request；第二次 → 回同一個 campaignId", async () => {
    const memberId = await createTestUser();
    const adminId = await createTestUser({ admin: true });
    const memberCaller = appRouter.createCaller(await ctxForUserId(memberId));
    const adminCaller = appRouter.createCaller(await ctxForUserId(adminId));

    const created = await memberCaller.industryRequest.create({ name: "私訊用", email: "dm@example.test", description: "測試私訊綁定" });

    const first = await adminCaller.industryRequest.admin.messageUser({ id: created.request.id });
    expect(first.campaignId).toBeGreaterThan(0);

    const detailAfter = await adminCaller.industryRequest.admin.get({ id: created.request.id });
    expect(detailAfter.adminMessageCampaignId).toBe(first.campaignId);
    // messageUser 不動案件狀態
    expect(detailAfter.status).toBe("pending");

    const second = await adminCaller.industryRequest.admin.messageUser({ id: created.request.id });
    expect(second.campaignId).toBe(first.campaignId);

    // 並發點兩次也只有一個 campaign
    const [r3, r4] = await Promise.all([
      adminCaller.industryRequest.admin.messageUser({ id: created.request.id }),
      adminCaller.industryRequest.admin.messageUser({ id: created.request.id }),
    ]);
    expect(r3.campaignId).toBe(first.campaignId);
    expect(r4.campaignId).toBe(first.campaignId);

    // 會員在既有站內信收得到這個 thread
    const msg = await memberCaller.chat.getAdminMessage({ campaignId: first.campaignId });
    expect(msg.title).toBe("關於您提出的產業新增需求");
    expect(msg.content).not.toContain("adminNote");
  });
});

describe("站內信 sender 官方身份（API 回傳 senderIdentity）", () => {
  it("campaign sender 是官方負責人 → senderIdentity 為 OXM負責人｜小鈞 / true；否則 平台管理員 / false", async () => {
    const memberId = await createTestUser();
    const adminId = await createTestUser({ admin: true });
    const memberCaller = appRouter.createCaller(await ctxForUserId(memberId));
    const adminCaller = appRouter.createCaller(await ctxForUserId(adminId));
    const created = await memberCaller.industryRequest.create({ name: "身份用", email: "id@example.test", description: "測試官方身份" });
    const { campaignId } = await adminCaller.industryRequest.admin.messageUser({ id: created.request.id });

    const adminUser = await db.getUserById(adminId);

    // 一般管理員（非 owner）→ 平台管理員
    const savedOwner = process.env.OWNER_OPEN_ID;
    delete process.env.OWNER_OPEN_ID;
    const asPlain = await memberCaller.chat.getAdminMessage({ campaignId });
    expect(asPlain.senderIdentity).toEqual({ displayName: "平台管理員", isOfficialOxmAccount: false });

    // 把 owner 設成這個 admin 的 openId → OXM負責人｜小鈞
    process.env.OWNER_OPEN_ID = adminUser!.openId;
    try {
      const asOfficial = await memberCaller.chat.getAdminMessage({ campaignId });
      expect(asOfficial.senderIdentity).toEqual({ displayName: "OXM負責人｜小鈞", isOfficialOxmAccount: true });
    } finally {
      if (savedOwner === undefined) delete process.env.OWNER_OPEN_ID;
      else process.env.OWNER_OPEN_ID = savedOwner;
    }
  });
});
