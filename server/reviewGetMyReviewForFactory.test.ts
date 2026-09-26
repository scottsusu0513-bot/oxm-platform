/**
 * review.getMyReviewForFactory 整合測試——走真實本機測試資料庫，用
 * appRouter.createCaller(ctx) 直接呼叫（見對話「FactoryDetail getMyReviewForFactory
 * Query data cannot be undefined」）。
 *
 * 根因：已登入但尚未評價時，db.getReviewByUserAndFactory 回傳 undefined，
 * superjson 把 undefined 原樣序列化到 client，React Query v5 將 undefined
 * query data 視為錯誤。「尚未評價」的 contract 是 null。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;
const PREFIX = "[MY_REVIEW_FOR_FACTORY_TEST]";
const EMAIL_PATTERN = "my_review_for_factory_test_%@oxm.test";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(id: number): TrpcContext {
  const user = {
    id,
    openId: `my-review-for-factory-test-${id}`,
    email: `my_review_for_factory_test_${id}@oxm.test`,
    name: "My Review Test",
    loginMethod: "manus",
    role: "user",
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    primaryEmailVerifiedAt: new Date(),
  } as AuthenticatedUser;
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

let userCounter = 0;
async function mkUser(): Promise<number> {
  userCounter += 1;
  const email = `my_review_for_factory_test_${userCounter}@oxm.test`;
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, email]
  );
  return r.insertId;
}

async function mkFactory(ownerId: number): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'normal', FALSE, ?, NOW(), NOW())",
    [ownerId, `${PREFIX} F${ownerId}`, JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", "[]"]
  );
  return r.insertId;
}

async function cleanup() {
  await conn.execute("DELETE FROM reviews WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", [EMAIL_PATTERN]);
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

describeIfDb("review.getMyReviewForFactory", () => {
  it("guest calls are rejected (the client only enables this query when authenticated)", async () => {
    const owner = await mkUser();
    const factoryId = await mkFactory(owner);
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.review.getMyReviewForFactory({ factoryId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns null — never undefined — when the logged-in user has not reviewed the factory", async () => {
    const owner = await mkUser();
    const factoryId = await mkFactory(owner);
    const userId = await mkUser();
    const result = await appRouter.createCaller(createAuthContext(userId)).review.getMyReviewForFactory({ factoryId });
    expect(result).toBeNull();
  });

  it("returns null for a factoryId that does not exist", async () => {
    const userId = await mkUser();
    const result = await appRouter.createCaller(createAuthContext(userId)).review.getMyReviewForFactory({ factoryId: 2_000_000_000 });
    expect(result).toBeNull();
  });

  it("returns the user's own review unchanged when one exists, and only theirs", async () => {
    const owner = await mkUser();
    const factoryId = await mkFactory(owner);
    const userId = await mkUser();
    const otherId = await mkUser();
    await conn.execute("INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (?, ?, 4, ?)", [factoryId, userId, "mine"]);
    await conn.execute("INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (?, ?, 2, ?)", [factoryId, otherId, "other"]);

    const result = await appRouter.createCaller(createAuthContext(userId)).review.getMyReviewForFactory({ factoryId });
    expect(result).toMatchObject({ factoryId, userId, rating: 4, comment: "mine" });
  });

  it("review.create still blocks a second review (duplicate check treats null as 'no review')", async () => {
    const owner = await mkUser();
    const factoryId = await mkFactory(owner);
    const userId = await mkUser();
    await conn.execute("INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (?, ?, 5, ?)", [factoryId, userId, "first"]);
    const caller = appRouter.createCaller(createAuthContext(userId));
    await expect(caller.review.create({ factoryId, rating: 3 })).rejects.toThrow("您已為此工廠留過評價");
  });
});
