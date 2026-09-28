/**
 * 工廠可見性／互動授權的單一規則（Production Hardening Batch 2）。
 *
 * 公開（anonymous／一般買家）：只有 status='approved' 且 deletedAt IS NULL 的
 * 工廠，才能被讀取從屬資料（商品、分類、照片、評價…）與接受新的買方互動
 * （新對話、一鍵詢價、新評價、新收藏／追蹤）。SQL 端的等價條件是
 * server/db.ts 的 publicFactoryCondition()。
 *
 * 管理（owner／active co-manager／admin）：不受公開規則限制，照常讀取自己
 * 工廠（包含 draft／rejected／delisted／已軟刪除）的資料——這裡只負責「讀取」
 * 授權；各管理 mutation 仍沿用既有的 owner／co-manager 檢查。
 *
 * 所有拒絕一律用同一個不透露狀態的結果（空資料或統一訊息），避免從回應差異
 * 推測某個 factoryId 是 draft／rejected／已刪除還是根本不存在。
 */
import { TRPCError } from "@trpc/server";
import type { Factory } from "../drizzle/schema";
import * as db from "./db";

export const FACTORY_UNAVAILABLE_FOR_NEW_INTERACTION = "此工廠目前無法接受新詢問";

type VisibilityFactory = Pick<Factory, "status" | "deletedAt">;
type Viewer = { id: number; isAdmin?: boolean } | null | undefined;

export function isFactoryPubliclyVisible<T extends VisibilityFactory>(
  factory: T | null | undefined,
): factory is T & { status: "approved"; deletedAt: null } {
  return !!factory && factory.status === "approved" && !factory.deletedAt;
}

/** owner／active co-manager／admin（admin 以 context 的白名單判斷 isAdmin 為準）。 */
export async function canManageFactory(factory: Pick<Factory, "id" | "ownerId">, viewer: Viewer): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.isAdmin) return true;
  if (factory.ownerId === viewer.id) return true;
  return db.isActiveCoManager(factory.id, viewer.id);
}

/** 公開可見，或呼叫者可管理這間工廠。 */
export async function canViewFactoryData(factory: Factory | null | undefined, viewer: Viewer): Promise<boolean> {
  if (!factory) return false;
  if (isFactoryPubliclyVisible(factory)) return true;
  return canManageFactory(factory, viewer);
}

export async function canViewFactoryDataById(factoryId: number, viewer: Viewer): Promise<boolean> {
  return canViewFactoryData(await db.getFactoryById(factoryId), viewer);
}

/**
 * 開啟／取得 buyer → factory 對話前的檢查（chat.getOrCreate／
 * chat.sendFirstMessage）：
 *   - 工廠公開可見 → 允許（原本行為）。
 *   - 已經有既有對話 → 允許（歷史對話不因工廠之後下架／刪除而中斷，維持
 *     既有「可繼續傳訊」行為，見 chat.send）。
 *   - admin，或被指派給這間工廠企業升級案件的顧問（isAdvisorConversation）
 *     → 允許（內部／顧問流程可能需要聯繫尚未上架的工廠）。
 *   - 其他（含工廠不存在）→ 統一訊息拒絕，不透露狀態。
 * 回傳工廠本身供呼叫端後續使用。
 */
export async function assertCanOpenBuyerConversation(
  viewer: { id: number; isAdmin?: boolean },
  factoryId: number,
): Promise<Factory> {
  const factory = await db.getFactoryById(factoryId);
  if (factory) {
    if (isFactoryPubliclyVisible(factory)) return factory;
    if (await db.hasConversationBetween(viewer.id, factoryId)) return factory;
    if (viewer.isAdmin || await db.isAdvisorConversation(viewer.id, factoryId)) return factory;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: FACTORY_UNAVAILABLE_FOR_NEW_INTERACTION });
}

/**
 * 建立「新的」買方 → 工廠互動前的檢查（新對話、一鍵詢價、新評價、新收藏／
 * 追蹤）。工廠不存在與非公開回同一個訊息，不透露狀態。
 */
export function assertFactoryAcceptsNewInteraction(factory: VisibilityFactory | null | undefined): asserts factory is VisibilityFactory {
  if (!isFactoryPubliclyVisible(factory)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FACTORY_UNAVAILABLE_FOR_NEW_INTERACTION });
  }
}
