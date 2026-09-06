/**
 * 產業新增需求「建案成功也寄一封管理端通知 Email」的行為測試。
 *
 * 真的會打 Resend 的 email function 一律 vi.mock 取代，不寄任何真實 Email
 * （見下方 vi.mock("./email", ...)，比照 server/newsEmailNotification.test.ts）。
 *
 * 涵蓋 spec 七的 Case A–E：
 *  A 第一次建立成功 → 管理員 Email function 被觸發一次
 *  B 同會員已有 active，再次 create（created:false）→ 不再寄管理員 Email
 *  C 管理員 Email 拋錯 → 案件仍建立成功、API 不失敗
 *  D 會員確認 Email 仍正常觸發，且與管理員 Email 各自獨立
 *  E 測試環境寄信安全門仍生效（真實 email function 不會呼叫 Resend）
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const adminEmailMock = vi.fn(async (_p: unknown) => undefined);
const memberEmailMock = vi.fn(async (_p: unknown) => undefined);

vi.mock("./email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./email")>();
  return {
    ...actual,
    sendIndustryRequestAdminEmail: (p: unknown) => adminEmailMock(p),
    sendIndustryRequestReceivedEmail: (p: unknown) => memberEmailMock(p),
  };
});

const { appRouter } = await import("./routers");
const db = await import("./db");
const emailModule = await import("./email");
import type { TrpcContext } from "./_core/context";

const runId = `ir-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;

async function createMember(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  seq += 1;
  const openId = `${runId}-${seq}`;
  const email = `${openId}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, phone, createdAt, isFactoryOwner)
    VALUES (${openId}, ${`IRE ${openId}`}, ${email}, ${email}, NOW(), ${"0900000000"}, NOW(), FALSE)
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [{ id: number }[], unknown];
  return rows[0].id;
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
  await conn.execute(sql`DELETE FROM industryRequestStatusHistory WHERE requestId IN (SELECT id FROM industryRequests WHERE userId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`}))`);
  await conn.execute(sql`DELETE FROM industryRequests WHERE userId IN (SELECT id FROM users WHERE openId LIKE ${`${runId}-%`})`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`${runId}-%`}`);
});

describe("產業需求：建案成功時的管理員通知 Email", () => {
  it("Case A：第一次成功建立 → sendIndustryRequestAdminEmail 觸發一次，帶案件 snapshot（不含 adminNote/openId）", async () => {
    adminEmailMock.mockClear();
    memberEmailMock.mockClear();
    const uid = await createMember();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const res = await caller.industryRequest.create({
      name: "陳大文", email: "chen@example.test", phone: "0911222333",
      description: "我們做無人機農噴設備，找不到分類",
    });
    expect(res.created).toBe(true);

    expect(adminEmailMock).toHaveBeenCalledTimes(1);
    const arg = adminEmailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      requestId: res.request.id,
      userName: "陳大文",
      userEmail: "chen@example.test",
      userPhone: "0911222333",
      description: "我們做無人機農噴設備，找不到分類",
    });
    expect(arg.createdAt).toBeTruthy();
    // 不帶內部識別資料
    expect(Object.keys(arg)).not.toContain("adminNote");
    expect(Object.keys(arg)).not.toContain("openId");
    expect(JSON.stringify(arg)).not.toContain("OWNER_OPEN_ID");
  });

  it("Case B：同會員已有 active，再次 create → created:false，管理員 Email 不再寄", async () => {
    adminEmailMock.mockClear();
    const uid = await createMember();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    const first = await caller.industryRequest.create({ name: "A", email: "a@example.test", description: "第一筆" });
    expect(first.created).toBe(true);
    expect(adminEmailMock).toHaveBeenCalledTimes(1);

    adminEmailMock.mockClear();
    const second = await caller.industryRequest.create({ name: "A2", email: "a2@example.test", description: "想再送一次（retry）" });
    expect(second.created).toBe(false);
    expect(adminEmailMock).not.toHaveBeenCalled();
  });

  it("Case C：管理員 Email function 拋錯 → 案件仍建立成功、API 不失敗、DB 有 record", async () => {
    adminEmailMock.mockClear();
    adminEmailMock.mockRejectedValueOnce(new Error("resend 503 boom"));
    const uid = await createMember();
    const caller = appRouter.createCaller(await ctxForUserId(uid));

    const res = await caller.industryRequest.create({ name: "B", email: "b@example.test", description: "寄信會失敗的那筆" });
    expect(res.created).toBe(true);
    expect(res.request.id).toBeGreaterThan(0);

    const conn = await getDb();
    const [rows] = (await conn!.execute(
      sql`SELECT COUNT(*) AS n FROM industryRequests WHERE userId = ${uid} AND status = 'pending'`,
    )) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0].n)).toBe(1);

    // getMine 也能正常讀回
    const mine = await caller.industryRequest.getMyRequest();
    expect(mine.isActive).toBe(true);
  });

  it("Case D：會員確認 Email 仍正常觸發，且與管理員 Email 各自獨立（不是二選一）", async () => {
    adminEmailMock.mockClear();
    memberEmailMock.mockClear();
    const uid = await createMember();
    const caller = appRouter.createCaller(await ctxForUserId(uid));
    await caller.industryRequest.create({ name: "C", email: "c@example.test", description: "同時要有兩封" });

    expect(adminEmailMock).toHaveBeenCalledTimes(1);
    expect(memberEmailMock).toHaveBeenCalledTimes(1);
    // 會員確認信收件對象是會員填的 email
    const memberArg = memberEmailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(memberArg).toMatchObject({ userEmail: "c@example.test", userName: "C" });
  });

  it("Case E：測試環境寄信安全門仍生效——真實 email function 不會呼叫 Resend", async () => {
    // isEmailEnabled() 在 vitest 環境為 false（見 server/email.ts getEmailDisabledReason）
    expect(emailModule.getEmailDisabledReason()).not.toBeNull();
    // 直接呼叫「未被 mock 的」真實函式（透過 importOriginal 保留在 actual 上）
    const actual = await vi.importActual<typeof import("./email")>("./email");
    await expect(actual.sendIndustryRequestAdminEmail({
      requestId: 1, userName: "x", userEmail: "x@example.test", userPhone: null,
      description: "safety gate 測試", createdAt: new Date(),
    })).resolves.toBeUndefined();
  });
});
