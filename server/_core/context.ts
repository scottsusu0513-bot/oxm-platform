import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { isAdminUser } from "./admin";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User & { isAdmin: boolean }) | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // Batch 3.7：管理員身分唯一依據是白名單（isAdminUser）。程式裡仍有許多
  // `ctx.user.role === "admin"` 判斷，DB 的 role 欄位過去只會升級、不會降級——
  // 已移出白名單的舊管理員會繼續通過這些判斷。這裡讓 role 與 isAdmin 一致。
  const isAdmin = user ? isAdminUser(user) : false;
  const userWithAdmin = user ? { ...user, role: isAdmin ? ("admin" as const) : ("user" as const), isAdmin } : null;

  return {
    req: opts.req,
    res: opts.res,
    user: userWithAdmin,
  };
}