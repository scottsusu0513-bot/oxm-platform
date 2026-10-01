import "dotenv/config";
import { publicImageUrl } from "../factoryAvatarUrl";
import { storageHeadDetailed, storageListObjectsPage, storageRewriteCacheControl } from "../storage";
import { collectStorageReferences } from "../storageReconcile";
import { formatBackfillReport, runCacheControlBackfill, type BackfillDeps, type BackfillReport } from "../publicCacheControlBackfill";

/**
 * 既有公開物件補寫 Cache-Control CLI（見 server/publicCacheControlBackfill.ts）。
 *
 *   node dist/jobs/backfillPublicCacheControl.js                                      # dry-run（預設）
 *   node dist/jobs/backfillPublicCacheControl.js --apply --approve=<fingerprint> [--max-batch=25] [--exclude-factory=<id>]
 *
 * 工廠 #26（owner 測試工廠）永遠排除。
 */
export type BackfillCliArgs = { apply: boolean; approvedFingerprint?: string; maxBatch: number; excludeFactoryIds: number[] };

export function parseBackfillArgs(argv: readonly string[]): BackfillCliArgs {
  const values = (name: string) => argv.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
  const apply = argv.includes("--apply");
  const approvedFingerprint = values("approve")[0];
  if (apply && !/^[0-9a-f]{64}$/.test(approvedFingerprint ?? "")) throw new Error("--apply 必須搭配 dry-run 報告的 --approve=<fingerprint>");
  const rawBatch = values("max-batch")[0];
  const maxBatch = rawBatch === undefined ? 25 : Number(rawBatch);
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > 200) throw new Error("--max-batch 必須是 1–200 的整數");
  const excludeFactoryIds = values("exclude-factory").map(Number);
  if (excludeFactoryIds.some(n => !Number.isInteger(n) || n <= 0)) throw new Error("--exclude-factory 必須是正整數");
  return { apply, approvedFingerprint, maxBatch, excludeFactoryIds };
}

export function defaultBackfillDeps(): BackfillDeps {
  if (!process.env.AWS_S3_BUCKET) throw new Error("公開圖片儲存尚未設定");
  return {
    listPage: storageListObjectsPage,
    collectReferences: collectStorageReferences,
    head: storageHeadDetailed,
    rewrite: storageRewriteCacheControl,
    publicHead: async (key: string) => {
      const r = await fetch(publicImageUrl(key.split("/").map(encodeURIComponent).join("/")), { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      return { status: r.status, cacheControl: r.headers.get("cache-control") };
    },
  };
}

export function decideBackfillExitCode(r: BackfillReport): number {
  if (r.mode === "dry-run") return 0;
  return r.aborted || r.failed > 0 ? 1 : 0;
}

const invokedDirectly = typeof process.argv[1] === "string" && /backfillPublicCacheControl\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const args = parseBackfillArgs(process.argv.slice(2));
    const report = await runCacheControlBackfill(
      { apply: args.apply, approvedFingerprint: args.approvedFingerprint, maxBatch: args.maxBatch, protectedFactoryIds: args.excludeFactoryIds },
      defaultBackfillDeps(),
    );
    console.log(formatBackfillReport(report));
    process.exit(decideBackfillExitCode(report));
  })().catch((err: unknown) => {
    const e = err as { name?: string; message?: string } | null;
    console.error(`[cache-control-backfill] failed: ${e?.name ?? "Error"}${e?.name === "Error" && e?.message ? `: ${e.message}` : ""}`);
    process.exit(1);
  });
}
