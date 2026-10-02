/**
 * 一次性：既有超大工廠頭貼正規化（Batch 3.10）。
 *
 * 正式站有 9 間工廠目前使用的頭貼超過 1MB（最大 4.7MB、5760×3840），搜尋卡片直接載入。
 * 做法刻意是「新 key＋條件式切換 DB 指標」，不是原地覆寫：
 *   - 公開圖片已帶 immutable Cache-Control，同一個網址的內容永遠不能改變
 *   - 舊物件完全不動（不刪、不覆寫）：修改申請歷史仍引用它，回復時直接指回去
 *   - DB 只做 `UPDATE factories SET avatarUrl = new WHERE id = ? AND avatarUrl = old`；
 *     規劃後頭貼被改過就不動（衝突），新物件留給儲存空間對帳在寬限期後處理
 *   - avatarCrop（百分比）不動：只縮放、不裁切，長寬比不變；先依 EXIF 方向轉正，
 *     顯示方向與原本瀏覽器顯示的一致
 *   - 工廠 #26（owner 測試工廠）硬性排除；只處理明確列出的工廠
 *
 * 預設 dry-run（會實際讀取並在記憶體中試算縮圖結果，但不寫入任何東西）。
 * --apply 必須帶 dry-run 的指紋。輸出只有工廠 id、位元組數、尺寸與回復對照。
 */
import { createHash } from "node:crypto";
import { detectImageMimeType, imageExtensionForMimeType, type DetectedImageMimeType } from "./_core/security";
import { parsePersistentFactoryAvatarUrl } from "./factoryAvatarUrl";
import { PUBLIC_IMMUTABLE_CACHE_CONTROL } from "./storage";

/** Phase 2 唯讀分析確認的目標（目前使用中、>1MB）。工廠 1 只被備份表引用，不在其中。 */
export const AVATAR_MIGRATION_FACTORY_IDS: readonly number[] = [46, 50, 60, 47, 37, 31, 51, 15, 30];
/** 永遠不處理（owner 測試工廠）。即使出現在目標清單也一律拒絕。 */
export const AVATAR_MIGRATION_BLOCKED_FACTORY_IDS: readonly number[] = [26];
export const AVATAR_MAX_EDGE = 1024;
export const AVATAR_OVERSIZE_BYTES = 1_000_000;
const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export type ImageInfo = { mime: DetectedImageMimeType; width: number; height: number };
export type NormalizedImage = ImageInfo & { bytes: Buffer; resized: boolean };

export type AvatarMigrationDeps = {
  getFactoryAvatarUrl: (factoryId: number) => Promise<{ exists: boolean; avatarUrl: string | null }>;
  getObject: (key: string) => Promise<Buffer | null>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null; cacheControl: string | null } | null>;
  putObject: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
  publicGet: (key: string) => Promise<{ status: number; bytes: Buffer | null; cacheControl: string | null }>;
  conditionalUpdate: (factoryId: number, expectedUrl: string, newUrl: string) => Promise<boolean>;
  probe: (bytes: Buffer) => Promise<ImageInfo>;
  normalize: (bytes: Buffer, info: ImageInfo) => Promise<NormalizedImage>;
  newId: () => string;
  publicUrl: (key: string) => string;
};

export type PlanStatus = "planned" | "blocked_test_factory" | "factory_missing" | "not_platform_avatar" | "object_missing" | "invalid_image" | "already_within_limits" | "no_benefit";

export type AvatarPlanItem = {
  factoryId: number;
  status: PlanStatus;
  oldUrl?: string;
  oldKey?: string;
  oldBytes?: number;
  oldDims?: string;
  newBytes?: number;
  newDims?: string;
  mime?: DetectedImageMimeType;
};

export type ApplyResult = {
  factoryId: number;
  status: "migrated" | "conflict" | "verify_failed" | "key_collision" | "error";
  oldBytes?: number;
  newBytes?: number;
  oldUrl?: string;
  newUrl?: string;
  error?: string;
};

export type AvatarMigrationReport = {
  mode: "dry-run" | "apply";
  plan: AvatarPlanItem[];
  fingerprint: string;
  totals: { planned: number; oldBytes: number; newBytes: number };
  results: ApplyResult[];
  aborted: null | "approval_mismatch";
};

/** sharp 實作：只在真正執行遷移時載入（web 服務不依賴 sharp）。 */
export async function sharpImageOps(): Promise<Pick<AvatarMigrationDeps, "probe" | "normalize">> {
  const sharp = (await import("sharp")).default;
  const probe = async (bytes: Buffer): Promise<ImageInfo> => {
    const mime = detectImageMimeType(bytes);
    if (!mime) throw new Error("unsupported image signature");
    const m = await sharp(bytes).metadata();
    // EXIF orientation 5–8 表示顯示時寬高互換
    const swap = (m.orientation ?? 1) >= 5;
    const width = swap ? m.height ?? 0 : m.width ?? 0;
    const height = swap ? m.width ?? 0 : m.height ?? 0;
    if (!width || !height) throw new Error("unreadable dimensions");
    return { mime, width, height };
  };
  const normalize = async (bytes: Buffer, info: ImageInfo): Promise<NormalizedImage> => {
    const resized = Math.max(info.width, info.height) > AVATAR_MAX_EDGE;
    let p = sharp(bytes).rotate().resize({ width: AVATAR_MAX_EDGE, height: AVATAR_MAX_EDGE, fit: "inside", withoutEnlargement: true });
    if (info.mime === "image/jpeg") p = p.jpeg({ quality: 85, mozjpeg: true });
    else if (info.mime === "image/png") p = p.png({ compressionLevel: 9 });
    else p = p.webp({ quality: 85 });
    const out = await p.toBuffer({ resolveWithObject: true });
    return { bytes: out.data, mime: info.mime, width: out.info.width, height: out.info.height, resized };
  };
  return { probe, normalize };
}

function fingerprintOf(items: AvatarPlanItem[]): string {
  const lines = items.filter(i => i.status === "planned").map(i => `${i.factoryId}\t${i.oldUrl}\t${i.oldBytes}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function planOne(factoryId: number, deps: AvatarMigrationDeps): Promise<{ item: AvatarPlanItem; normalized?: NormalizedImage }> {
  if (AVATAR_MIGRATION_BLOCKED_FACTORY_IDS.includes(factoryId)) return { item: { factoryId, status: "blocked_test_factory" } };
  const f = await deps.getFactoryAvatarUrl(factoryId);
  if (!f.exists) return { item: { factoryId, status: "factory_missing" } };
  const parsed = f.avatarUrl ? parsePersistentFactoryAvatarUrl(f.avatarUrl, factoryId) : null;
  if (!f.avatarUrl || !parsed) return { item: { factoryId, status: "not_platform_avatar" } };
  const base = { factoryId, oldUrl: f.avatarUrl, oldKey: parsed.sourceKey };
  const bytes = await deps.getObject(parsed.sourceKey);
  if (!bytes) return { item: { ...base, status: "object_missing" } };
  let info: ImageInfo;
  try { info = await deps.probe(bytes); } catch { return { item: { ...base, status: "invalid_image", oldBytes: bytes.length } }; }
  const oldDims = `${info.width}x${info.height}`;
  const withOld = { ...base, oldBytes: bytes.length, oldDims, mime: info.mime };
  if (bytes.length <= AVATAR_OVERSIZE_BYTES && Math.max(info.width, info.height) <= AVATAR_MAX_EDGE) {
    return { item: { ...withOld, status: "already_within_limits" } };
  }
  const normalized = await deps.normalize(bytes, info);
  const item = { ...withOld, newBytes: normalized.bytes.length, newDims: `${normalized.width}x${normalized.height}` };
  // 沒有縮圖、重新壓縮也沒有明顯變小（<10%）就不換：換了只是多一個物件
  if (!normalized.resized && normalized.bytes.length > bytes.length * 0.9) return { item: { ...item, status: "no_benefit" } };
  return { item: { ...item, status: "planned" }, normalized };
}

export async function runAvatarMigration(
  opts: { apply?: boolean; approvedFingerprint?: string; factoryIds?: readonly number[] },
  deps: AvatarMigrationDeps,
): Promise<AvatarMigrationReport> {
  const ids = Array.from(new Set(opts.factoryIds ?? AVATAR_MIGRATION_FACTORY_IDS));
  const planned: { item: AvatarPlanItem; normalized?: NormalizedImage }[] = [];
  for (const id of ids) planned.push(await planOne(id, deps));
  const plan = planned.map(p => p.item);
  const ok = plan.filter(p => p.status === "planned");
  const report: AvatarMigrationReport = {
    mode: opts.apply ? "apply" : "dry-run",
    plan,
    fingerprint: fingerprintOf(plan),
    totals: { planned: ok.length, oldBytes: ok.reduce((a, p) => a + (p.oldBytes ?? 0), 0), newBytes: ok.reduce((a, p) => a + (p.newBytes ?? 0), 0) },
    results: [],
    aborted: null,
  };
  if (!opts.apply) return report;
  if (!opts.approvedFingerprint || opts.approvedFingerprint !== report.fingerprint) return { ...report, aborted: "approval_mismatch" };

  for (const { item, normalized } of planned) {
    if (item.status !== "planned" || !normalized || !item.oldUrl) continue;
    const r: ApplyResult = { factoryId: item.factoryId, status: "error", oldBytes: item.oldBytes, newBytes: normalized.bytes.length, oldUrl: item.oldUrl };
    try {
      if (AVATAR_MIGRATION_BLOCKED_FACTORY_IDS.includes(item.factoryId)) throw new Error("blocked factory");
      const current = await deps.getFactoryAvatarUrl(item.factoryId);
      if (current.avatarUrl !== item.oldUrl) { report.results.push({ ...r, status: "conflict" }); continue; }
      const newKey = `factory-avatars/${item.factoryId}/${deps.newId()}.${imageExtensionForMimeType(normalized.mime)}`;
      if (await deps.headObject(newKey)) { report.results.push({ ...r, status: "key_collision" }); continue; }
      await deps.putObject(newKey, normalized.bytes, normalized.mime);
      const newUrl = deps.publicUrl(newKey);
      const head = await deps.headObject(newKey);
      const pub = await deps.publicGet(newKey);
      let verified = !!head && head.contentType === normalized.mime && head.contentLength === normalized.bytes.length && head.contentLength > 0
        && head.cacheControl === PUBLIC_IMMUTABLE_CACHE_CONTROL && pub.status === 200 && pub.cacheControl === PUBLIC_IMMUTABLE_CACHE_CONTROL && !!pub.bytes;
      if (verified) {
        const got = await deps.probe(pub.bytes!);
        verified = got.mime === normalized.mime && got.width === normalized.width && got.height === normalized.height;
      }
      if (!verified) { report.results.push({ ...r, status: "verify_failed", newUrl }); continue; }
      const switched = await deps.conditionalUpdate(item.factoryId, item.oldUrl, newUrl);
      report.results.push({ ...r, status: switched ? "migrated" : "conflict", newUrl });
    } catch (err) {
      report.results.push({ ...r, status: "error", error: (err as { name?: string } | null)?.name ?? "Error" });
    }
  }
  return report;
}

/** 回復：條件式把頭貼從新網址指回舊網址（舊網址必須是這間工廠的正式頭貼、且物件仍存在）。 */
export async function rollbackAvatar(
  input: { factoryId: number; fromUrl: string; toUrl: string },
  deps: Pick<AvatarMigrationDeps, "headObject" | "conditionalUpdate">,
): Promise<"rolled_back" | "conflict" | "invalid_target" | "blocked"> {
  if (AVATAR_MIGRATION_BLOCKED_FACTORY_IDS.includes(input.factoryId)) return "blocked";
  const to = parsePersistentFactoryAvatarUrl(input.toUrl, input.factoryId);
  const from = parsePersistentFactoryAvatarUrl(input.fromUrl, input.factoryId);
  if (!to || !from || !(await deps.headObject(to.sourceKey))) return "invalid_target";
  return (await deps.conditionalUpdate(input.factoryId, input.fromUrl, input.toUrl)) ? "rolled_back" : "conflict";
}

export function formatAvatarMigrationReport(r: AvatarMigrationReport): string {
  const lines = [`[avatar-migration] mode=${r.mode} targets=${r.plan.length} planned=${r.totals.planned} old_bytes=${r.totals.oldBytes} new_bytes=${r.totals.newBytes}`];
  for (const p of r.plan) {
    lines.push(`[avatar-migration]   factory=${p.factoryId} status=${p.status}${p.oldBytes !== undefined ? ` old=${p.oldBytes}B ${p.oldDims ?? ""}` : ""}${p.newBytes !== undefined ? ` new=${p.newBytes}B ${p.newDims}` : ""}${p.mime ? ` ${p.mime}` : ""}`);
  }
  lines.push(`[avatar-migration] fingerprint=${r.fingerprint}`);
  if (r.mode === "apply") {
    if (r.aborted) lines.push(`[avatar-migration] aborted=${r.aborted}`);
    for (const x of r.results) {
      lines.push(`[avatar-migration]   result factory=${x.factoryId} status=${x.status} old=${x.oldBytes}B new=${x.newBytes}B${x.error ? ` error=${x.error}` : ""}`);
      if (x.status === "migrated") lines.push(`ROLLBACK ${JSON.stringify({ factoryId: x.factoryId, from: x.newUrl, to: x.oldUrl })}`);
    }
    const migrated = r.results.filter(x => x.status === "migrated");
    lines.push(`[avatar-migration] migrated=${migrated.length} conflict=${r.results.filter(x => x.status === "conflict").length} failed=${r.results.filter(x => !["migrated", "conflict"].includes(x.status)).length} bytes_before=${migrated.reduce((a, x) => a + (x.oldBytes ?? 0), 0)} bytes_after=${migrated.reduce((a, x) => a + (x.newBytes ?? 0), 0)}`);
  }
  return lines.join("\n");
}
