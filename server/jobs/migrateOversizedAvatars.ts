import "dotenv/config";
import { nanoid } from "nanoid";
import * as db from "../db";
import { publicImageUrl } from "../factoryAvatarUrl";
import { storageGetObjectBytes, storageHeadDetailed, storagePut } from "../storage";
import { formatAvatarMigrationReport, rollbackAvatar, runAvatarMigration, sharpImageOps, type AvatarMigrationDeps } from "../avatarMigration";

/**
 * 一次性超大頭貼正規化 CLI（見 server/avatarMigration.ts）。
 *
 *   node dist/jobs/migrateOversizedAvatars.js                                        # dry-run（預設）
 *   node dist/jobs/migrateOversizedAvatars.js --apply --approve=<fingerprint>
 *   node dist/jobs/migrateOversizedAvatars.js --rollback --factory=<id> --from=<newUrl> --to=<oldUrl>
 */
export type AvatarCliArgs =
  | { mode: "plan"; apply: boolean; approvedFingerprint?: string }
  | { mode: "rollback"; factoryId: number; fromUrl: string; toUrl: string };

export function parseAvatarMigrationArgs(argv: readonly string[]): AvatarCliArgs {
  const get = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (argv.includes("--rollback")) {
    const factoryId = Number(get("factory"));
    const fromUrl = get("from");
    const toUrl = get("to");
    if (!Number.isInteger(factoryId) || factoryId <= 0 || !fromUrl || !toUrl) throw new Error("--rollback 需要 --factory=<id> --from=<newUrl> --to=<oldUrl>");
    return { mode: "rollback", factoryId, fromUrl, toUrl };
  }
  const apply = argv.includes("--apply");
  const approvedFingerprint = get("approve");
  if (apply && !/^[0-9a-f]{64}$/.test(approvedFingerprint ?? "")) throw new Error("--apply 必須搭配 dry-run 報告的 --approve=<fingerprint>");
  return { mode: "plan", apply, approvedFingerprint };
}

export async function defaultAvatarMigrationDeps(): Promise<AvatarMigrationDeps> {
  if (!process.env.AWS_S3_BUCKET) throw new Error("公開圖片儲存尚未設定");
  const ops = await sharpImageOps();
  return {
    ...ops,
    getFactoryAvatarUrl: async (id) => {
      const f = await db.getFactoryById(id);
      return { exists: !!f, avatarUrl: f?.avatarUrl ?? null };
    },
    getObject: (key) => storageGetObjectBytes(key, 20 * 1024 * 1024),
    headObject: storageHeadDetailed,
    putObject: async (key, bytes, contentType) => { await storagePut(key, bytes, contentType); },
    publicGet: async (key) => {
      const r = await fetch(publicImageUrl(key.split("/").map(encodeURIComponent).join("/")), { signal: AbortSignal.timeout(15_000) });
      return { status: r.status, bytes: r.ok ? Buffer.from(await r.arrayBuffer()) : null, cacheControl: r.headers.get("cache-control") };
    },
    conditionalUpdate: db.conditionalUpdateFactoryAvatarUrl,
    newId: () => nanoid(),
    publicUrl: publicImageUrl,
  };
}

const invokedDirectly = typeof process.argv[1] === "string" && /migrateOversizedAvatars\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const args = parseAvatarMigrationArgs(process.argv.slice(2));
    const deps = await defaultAvatarMigrationDeps();
    if (args.mode === "rollback") {
      const result = await rollbackAvatar({ factoryId: args.factoryId, fromUrl: args.fromUrl, toUrl: args.toUrl }, deps);
      console.log(`[avatar-migration] rollback factory=${args.factoryId} result=${result}`);
      process.exit(result === "rolled_back" ? 0 : 1);
    }
    const report = await runAvatarMigration({ apply: args.apply, approvedFingerprint: args.approvedFingerprint }, deps);
    console.log(formatAvatarMigrationReport(report));
    const failed = report.aborted || report.results.some(r => r.status !== "migrated");
    process.exit(report.mode === "apply" && failed ? 1 : 0);
  })().catch((err: unknown) => {
    const e = err as { name?: string; message?: string } | null;
    console.error(`[avatar-migration] failed: ${e?.name ?? "Error"}${e?.name === "Error" && e?.message ? `: ${e.message}` : ""}`);
    process.exit(1);
  });
}
