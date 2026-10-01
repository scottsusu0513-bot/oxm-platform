import "dotenv/config";
import { storageDelete, storageListObjectsPage } from "../storage";
import { isPrivateStorageConfigured, privateStorageDeleteObject, privateStorageListObjectsPage } from "../privateStorage";
import {
  DEFAULT_MAX_DELETES,
  collectStorageReferences,
  formatReconcileReport,
  runStorageReconcile,
  type ReconcileDeps,
  type ReconcileReport,
  type StorageBucketName,
} from "../storageReconcile";

/**
 * 儲存空間對帳 CLI（Batch 3.10，見 server/storageReconcile.ts）。
 *
 *   node dist/jobs/reconcileStorageObjects.js --bucket=public                 # dry-run（預設）
 *   node dist/jobs/reconcileStorageObjects.js --bucket=public --apply --approve=<fingerprint> [--max-delete=200]
 *
 * --apply 只會刪除與 dry-run 報告指紋完全相同的候選集合，刪除前再重新確認 DB
 * 引用。輸出只有數量、prefix 與指紋。
 */
export type ReconcileCliArgs = { bucket: StorageBucketName; apply: boolean; approvedFingerprint?: string; maxDeletes: number };

export function parseReconcileArgs(argv: readonly string[]): ReconcileCliArgs {
  const get = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const bucket = get("bucket");
  if (bucket !== "public" && bucket !== "private") throw new Error("必須指定 --bucket=public 或 --bucket=private");
  const apply = argv.includes("--apply");
  const approvedFingerprint = get("approve");
  if (apply && !/^[0-9a-f]{64}$/.test(approvedFingerprint ?? "")) throw new Error("--apply 必須搭配 dry-run 報告的 --approve=<fingerprint>");
  const maxRaw = get("max-delete");
  const maxDeletes = maxRaw === undefined ? DEFAULT_MAX_DELETES : Number(maxRaw);
  if (!Number.isInteger(maxDeletes) || maxDeletes < 0 || maxDeletes > 5000) throw new Error("--max-delete 必須是 0–5000 的整數");
  return { bucket, apply, approvedFingerprint, maxDeletes };
}

export function depsFor(bucket: StorageBucketName): ReconcileDeps {
  if (bucket === "public") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("公開圖片儲存尚未設定");
    return { listPage: storageListObjectsPage, collectReferences: collectStorageReferences, deleteObject: storageDelete };
  }
  if (!isPrivateStorageConfigured()) throw new Error("私有附件儲存尚未設定");
  return {
    listPage: (token, prefix) => {
      if (!prefix) throw new Error("private listing requires an explicit prefix");
      return privateStorageListObjectsPage(prefix, token);
    },
    collectReferences: collectStorageReferences,
    deleteObject: privateStorageDeleteObject,
  };
}

/** dry-run 一律 0；apply 時中止或有刪除失敗為 1。 */
export function decideReconcileExitCode(r: ReconcileReport): number {
  if (r.mode === "dry-run") return 0;
  return r.aborted || r.failed > 0 ? 1 : 0;
}

const invokedDirectly = typeof process.argv[1] === "string" && /reconcileStorageObjects\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const args = parseReconcileArgs(process.argv.slice(2));
    const report = await runStorageReconcile(
      { bucket: args.bucket, apply: args.apply, approvedFingerprint: args.approvedFingerprint, maxDeletes: args.maxDeletes },
      depsFor(args.bucket),
    );
    console.log(formatReconcileReport(report));
    process.exit(decideReconcileExitCode(report));
  })().catch((err: unknown) => {
    // 只印錯誤類型與精簡訊息（例如 AccessDenied），不印 SDK 錯誤全文
    const e = err as { name?: string; message?: string } | null;
    console.error(`[storage-reconcile] failed: ${e?.name ?? "Error"}${e?.name === "Error" && e?.message ? `: ${e.message}` : ""}`);
    process.exit(1);
  });
}
