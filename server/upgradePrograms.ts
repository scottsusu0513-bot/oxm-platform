import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { upgradePrograms, type UpgradeProgram } from "../drizzle/schema";
import {
  UPGRADE_PROGRAM_SEEDS,
  selectVisibleUpgradePrograms,
  type UpgradeProgramSeed,
  type UpgradeProgramVisualKey,
} from "../shared/upgradePrograms";
import { getDb } from "./db";

export type PublicUpgradeProgram = Pick<
  UpgradeProgram,
  | "id"
  | "slug"
  | "title"
  | "shortTitle"
  | "description"
  | "targetAudience"
  | "highlights"
  | "badge"
  | "statusLabel"
  | "visualKey"
  | "maxFundingLabel"
  | "imageUrl"
  | "ctaLabel"
  | "displayOrder"
  | "enabled"
>;

export type UpgradeProgramInput = {
  slug: string;
  title: string;
  shortTitle: string | null;
  description: string;
  targetAudience: string | null;
  highlights: string[];
  badge: string | null;
  statusLabel: string | null;
  visualKey: UpgradeProgramVisualKey;
  maxFundingLabel: string | null;
  imageUrl: string | null;
  ctaLabel: string;
  enabled: boolean;
};

function getErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: string; cause?: unknown };
    if (record.code) return record.code;
    current = record.cause;
  }
  return undefined;
}

export function isUpgradeProgramsTableMissing(error: unknown): boolean {
  return getErrorCode(error) === "ER_NO_SUCH_TABLE";
}

function seedToPublicProgram(seed: UpgradeProgramSeed, index: number): PublicUpgradeProgram {
  return {
    id: -(index + 1),
    slug: seed.slug,
    title: seed.title,
    shortTitle: seed.shortTitle,
    description: seed.description,
    targetAudience: seed.targetAudience,
    highlights: [...seed.highlights],
    badge: seed.badge,
    statusLabel: seed.statusLabel,
    visualKey: seed.visualKey,
    maxFundingLabel: seed.maxFundingLabel,
    imageUrl: seed.imageUrl,
    ctaLabel: seed.ctaLabel,
    displayOrder: seed.displayOrder,
    enabled: seed.enabled,
  };
}

export function getSeededPublicUpgradePrograms(): PublicUpgradeProgram[] {
  const candidates = UPGRADE_PROGRAM_SEEDS.map((seed, index) => ({
    ...seedToPublicProgram(seed, index),
    archivedAt: null,
  }));
  return selectVisibleUpgradePrograms(candidates).map(({ archivedAt: _archivedAt, ...program }) => program);
}

/**
 * Migration 完成後第一次啟動時冪等建立既有五項方案。只新增缺少的 slug，
 * 絕不覆寫管理員已編輯、停用或封存的資料。
 */
export async function ensureUpgradeProgramsSeeded(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select({ slug: upgradePrograms.slug }).from(upgradePrograms)
    .where(inArray(upgradePrograms.slug, UPGRADE_PROGRAM_SEEDS.map((seed) => seed.slug)));
  const existingSlugs = new Set(existing.map((row) => row.slug));
  const missing = UPGRADE_PROGRAM_SEEDS.filter((seed) => !existingSlugs.has(seed.slug));
  if (missing.length === 0) return;

  await db.insert(upgradePrograms).values(missing.map((seed) => ({
    ...seed,
    highlights: [...seed.highlights],
  })));
  console.log(`[upgrade-programs] seeded ${missing.length} program(s)`);
}

/** 公開頁只回傳啟用且未封存的方案，依 displayOrder 排序。 */
export async function listPublicUpgradePrograms(): Promise<PublicUpgradeProgram[]> {
  const db = await getDb();
  if (!db) return getSeededPublicUpgradePrograms();

  try {
    return await db.select({
      id: upgradePrograms.id,
      slug: upgradePrograms.slug,
      title: upgradePrograms.title,
      shortTitle: upgradePrograms.shortTitle,
      description: upgradePrograms.description,
      targetAudience: upgradePrograms.targetAudience,
      highlights: upgradePrograms.highlights,
      badge: upgradePrograms.badge,
      statusLabel: upgradePrograms.statusLabel,
      visualKey: upgradePrograms.visualKey,
      maxFundingLabel: upgradePrograms.maxFundingLabel,
      imageUrl: upgradePrograms.imageUrl,
      ctaLabel: upgradePrograms.ctaLabel,
      displayOrder: upgradePrograms.displayOrder,
      enabled: upgradePrograms.enabled,
    }).from(upgradePrograms)
      .where(and(eq(upgradePrograms.enabled, true), isNull(upgradePrograms.archivedAt)))
      .orderBy(asc(upgradePrograms.displayOrder), asc(upgradePrograms.id));
  } catch (error) {
    // migration 尚未套用的開發環境仍可驗收公開頁；正式建表後不會走此分支。
    if (isUpgradeProgramsTableMissing(error)) return getSeededPublicUpgradePrograms();
    throw error;
  }
}

function unavailableMessage(error?: unknown): Error {
  if (error && isUpgradeProgramsTableMissing(error)) {
    return new Error("方案資料表尚未建立，請先由維運人員套用 0076_upgrade_programs.sql");
  }
  return new Error("資料庫目前無法使用");
}

/** 管理頁包含封存資料，讓停用／封存狀態可稽核與復原。 */
export async function adminListUpgradePrograms(): Promise<UpgradeProgram[]> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  try {
    return await db.select().from(upgradePrograms)
      .orderBy(asc(upgradePrograms.displayOrder), asc(upgradePrograms.id));
  } catch (error) {
    if (isUpgradeProgramsTableMissing(error)) throw unavailableMessage(error);
    throw error;
  }
}

export async function adminCreateUpgradeProgram(input: UpgradeProgramInput): Promise<number> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  const [maxRow] = await db.select({
    max: sql<number>`COALESCE(MAX(${upgradePrograms.displayOrder}), 0)`,
  }).from(upgradePrograms).where(isNull(upgradePrograms.archivedAt));
  const [result] = await db.insert(upgradePrograms).values({
    ...input,
    displayOrder: Number(maxRow?.max ?? 0) + 10,
  });
  return result.insertId;
}

export async function adminUpdateUpgradeProgram(id: number, input: UpgradeProgramInput): Promise<void> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  const [existing] = await db.select({ id: upgradePrograms.id, archivedAt: upgradePrograms.archivedAt })
    .from(upgradePrograms).where(eq(upgradePrograms.id, id)).limit(1);
  if (!existing) throw new Error("找不到此政府補助方案");
  if (existing.archivedAt) throw new Error("封存中的方案需先復原才能編輯");
  await db.update(upgradePrograms).set(input).where(eq(upgradePrograms.id, id));
}

export async function adminSetUpgradeProgramEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  const [existing] = await db.select({ archivedAt: upgradePrograms.archivedAt })
    .from(upgradePrograms).where(eq(upgradePrograms.id, id)).limit(1);
  if (!existing) throw new Error("找不到此政府補助方案");
  if (existing.archivedAt) throw new Error("封存中的方案不能直接啟用");
  await db.update(upgradePrograms).set({ enabled }).where(eq(upgradePrograms.id, id));
}

export async function adminSwapUpgradeProgramOrder(idA: number, idB: number): Promise<void> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  if (idA === idB) return;
  const rows = await db.select({
    id: upgradePrograms.id,
    displayOrder: upgradePrograms.displayOrder,
    archivedAt: upgradePrograms.archivedAt,
  }).from(upgradePrograms).where(inArray(upgradePrograms.id, [idA, idB]));
  if (rows.length !== 2) throw new Error("找不到要調整排序的方案");
  if (rows.some((row) => row.archivedAt)) throw new Error("封存方案不能參與公開排序");
  const [a, b] = rows;
  await db.update(upgradePrograms).set({ displayOrder: b.displayOrder }).where(eq(upgradePrograms.id, a.id));
  await db.update(upgradePrograms).set({ displayOrder: a.displayOrder }).where(eq(upgradePrograms.id, b.id));
}

/** 「刪除」採軟封存：保留資料、立即從公開頁移除。 */
export async function adminArchiveUpgradeProgram(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  await db.update(upgradePrograms).set({ enabled: false, archivedAt: new Date() })
    .where(eq(upgradePrograms.id, id));
}

/** 復原後維持停用，須由管理員再次明確啟用才會公開。 */
export async function adminRestoreUpgradeProgram(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw unavailableMessage();
  await db.update(upgradePrograms).set({ enabled: false, archivedAt: null })
    .where(eq(upgradePrograms.id, id));
}
