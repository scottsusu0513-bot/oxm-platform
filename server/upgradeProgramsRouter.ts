import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { UPGRADE_PROGRAM_VISUAL_KEYS } from "../shared/upgradePrograms";
import * as programs from "./upgradePrograms";

const nullableText = (max: number) => z.string().trim().max(max).nullable();
const imageUrlSchema = z.string().trim().max(2000).nullable().refine(
  (value) => value == null || value.startsWith("/") || /^https?:\/\//i.test(value),
  "圖片網址必須是 http(s) 網址或站內絕對路徑",
);

const programInputSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "識別代碼只能包含小寫英文、數字與連字號"),
  title: z.string().trim().min(1).max(200),
  shortTitle: nullableText(100),
  description: z.string().trim().min(1).max(2000),
  targetAudience: nullableText(1000),
  highlights: z.array(z.string().trim().min(1).max(80)).max(10),
  badge: nullableText(80),
  statusLabel: nullableText(100),
  visualKey: z.enum(UPGRADE_PROGRAM_VISUAL_KEYS),
  maxFundingLabel: nullableText(100),
  imageUrl: imageUrlSchema,
  ctaLabel: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});

function getErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: string; cause?: unknown };
    if (record.code) return record.code;
    current = record.cause;
  }
  return undefined;
}

function asAdminError(error: unknown, fallback: string): TRPCError {
  if (getErrorCode(error) === "ER_DUP_ENTRY") {
    return new TRPCError({ code: "BAD_REQUEST", message: "此方案識別代碼已存在" });
  }
  return new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : fallback,
  });
}

/**
 * 公開方案目錄與管理 CRUD 的獨立 router。沒有任何 procedure 讀寫補助案件、
 * 顧問、地區分派或案件狀態；管理操作一律使用既有 adminProcedure guard。
 */
export const upgradeProgramsRouter = router({
  listPublic: publicProcedure.query(async () => programs.listPublicUpgradePrograms()),

  adminList: adminProcedure.query(async () => {
    try {
      return await programs.adminListUpgradePrograms();
    } catch (error) {
      throw asAdminError(error, "方案列表載入失敗");
    }
  }),

  create: adminProcedure.input(programInputSchema).mutation(async ({ input }) => {
    try {
      return { id: await programs.adminCreateUpgradeProgram(input) };
    } catch (error) {
      throw asAdminError(error, "新增方案失敗");
    }
  }),

  update: adminProcedure.input(programInputSchema.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      try {
        await programs.adminUpdateUpgradeProgram(id, data);
        return { success: true };
      } catch (error) {
        throw asAdminError(error, "更新方案失敗");
      }
    }),

  setEnabled: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    enabled: z.boolean(),
  })).mutation(async ({ input }) => {
    try {
      await programs.adminSetUpgradeProgramEnabled(input.id, input.enabled);
      return { success: true };
    } catch (error) {
      throw asAdminError(error, "狀態更新失敗");
    }
  }),

  move: adminProcedure.input(z.object({
    idA: z.number().int().positive(),
    idB: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    try {
      await programs.adminSwapUpgradeProgramOrder(input.idA, input.idB);
      return { success: true };
    } catch (error) {
      throw asAdminError(error, "排序更新失敗");
    }
  }),

  archive: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        await programs.adminArchiveUpgradeProgram(input.id);
        return { success: true };
      } catch (error) {
        throw asAdminError(error, "封存方案失敗");
      }
    }),

  restore: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        await programs.adminRestoreUpgradeProgram(input.id);
        return { success: true };
      } catch (error) {
        throw asAdminError(error, "復原方案失敗");
      }
    }),
});
