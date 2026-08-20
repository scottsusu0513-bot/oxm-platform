import { getActiveFactoryAffiliationDetail } from "../db";

/**
 * Phase 8.1（見對話中「一」＋使用者對「Admin 無工廠語境」的最終決議）：
 *
 * - guest：未登入，完全不可用。
 * - no_factory：已登入，但不是任何「已通過審核」工廠的 owner／co-manager。
 * - factory_member：已登入且是某間已通過審核工廠的 owner 或 co-manager——
 *   quota 以這個 factoryId 為 owner（見 aiQuota.ts）。
 * - admin：完全跳過 entitlement 門檻與每日額度限制，即使本身不是任何工廠的
 *   owner／co-manager 也可以使用（多數平台管理員帳號屬此情況）。factoryId
 *   在 admin 本身剛好也是某工廠 owner／co-manager 時才會有值（純粹方便
 *   Admin 後台做用量分析），為 null 時代表這次 admin 使用完全沒有工廠語境。
 *
 * 底層查詢直接重用 getActiveFactoryAffiliationDetail()（server/db.ts）——
 * 這個 helper 本來就只承認 status==='approved' 的工廠，且已經用
 * factory-uniqueness-concurrent.test.ts 證明「一個 user 最多對應一間工廠」
 * 這個不變量是 transaction 層強制保證的，不需要在這裡重新查一次或重新驗證。
 */
export type AiEntitlement =
  | { kind: "guest" }
  | { kind: "no_factory" }
  | { kind: "factory_member"; factoryId: number; factoryName: string; role: "owner" | "co_manager" }
  | { kind: "admin"; factoryId: number | null; factoryName: string | null };

export async function resolveAiEntitlement(
  userId: number | null,
  isAdmin: boolean
): Promise<AiEntitlement> {
  if (userId === null) return { kind: "guest" };

  const affiliation = await getActiveFactoryAffiliationDetail(userId);

  if (isAdmin) {
    return { kind: "admin", factoryId: affiliation?.factoryId ?? null, factoryName: affiliation?.factoryName ?? null };
  }

  if (!affiliation) return { kind: "no_factory" };

  return {
    kind: "factory_member",
    factoryId: affiliation.factoryId,
    factoryName: affiliation.factoryName,
    role: affiliation.role,
  };
}

/** 這次 entitlement 是否允許使用 AI（不代表 quota 一定還沒用完，quota 另外查）。 */
export function isAiUsageAllowed(entitlement: AiEntitlement): boolean {
  return entitlement.kind === "factory_member" || entitlement.kind === "admin";
}
