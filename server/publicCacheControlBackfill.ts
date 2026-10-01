/**
 * 既有公開物件補寫 Cache-Control（Batch 3.10）。
 *
 * 2bc7f09 之後的新上傳已帶 PUBLIC_IMMUTABLE_CACHE_CONTROL；之前上傳的物件沒有任何
 * Cache-Control。這個工具只處理「目前被 DB 任何地方引用、且 key 格式完全符合公開
 * 規則」的物件，逐一：
 *   1. HEAD 取得完整 metadata（已經是目標值就跳過 → 冪等、可分批續跑）
 *   2. 安全條件不成立（非 jpeg/png/webp、multipart ETag 無法驗證內容、大小與列表
 *      不符、受保護的測試工廠）一律排除，不碰
 *   3. 同 key CopyObject（MetadataDirective REPLACE，帶回原本的 Content-Type 等
 *      metadata；CopySourceIfMatch 綁定 HEAD 時的 ETag）
 *   4. 再次 HEAD：Content-Type、大小、ETag（內容）不變、Cache-Control 為目標值；
 *      並以匿名 HEAD 確認公開網址仍可讀取
 *
 * 預設 dry-run。--apply 必須帶 dry-run 的指紋（涵蓋所有符合條件物件的 key＋ETag＋
 * 大小，已完成的也算在內，所以分批執行時指紋不變），每次最多處理 maxBatch 個。
 * 不寫 DB、不刪任何物件。報告只有數量與指紋。
 */
import { createHash } from "node:crypto";
import { PUBLIC_IMMUTABLE_CACHE_CONTROL, type StorageObjectDetail } from "./storage";
import { PUBLIC_RECONCILE_RULES, ruleForKey, type ListedObject, type StorageReferences } from "./storageReconcile";

/** owner 的測試工廠：任何自動化 metadata 改寫一律排除（使用者指定）。 */
export const PROTECTED_TEST_FACTORY_IDS: readonly number[] = [26];

const FACTORY_SCOPED_PREFIXES = ["factory-avatars", "factory-avatars-temp", "factory-covers", "factory-photos", "product-images"];
const SAFE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function factoryIdOfKey(key: string): number | null {
  const [prefix, id] = key.split("/");
  if (!FACTORY_SCOPED_PREFIXES.includes(prefix) || !/^[1-9][0-9]{0,9}$/.test(id ?? "")) return null;
  return Number(id);
}

export type BackfillDeps = {
  listPage: (continuationToken?: string) => Promise<{ objects: ListedObject[]; nextToken?: string }>;
  collectReferences: () => Promise<{ refs: StorageReferences }>;
  head: (key: string) => Promise<StorageObjectDetail | null>;
  rewrite: (key: string, current: StorageObjectDetail, cacheControl: string) => Promise<{ versionId: string | null }>;
  /** 匿名 HEAD 公開網址：回傳 HTTP 狀態與 Cache-Control header */
  publicHead: (key: string) => Promise<{ status: number; cacheControl: string | null }>;
};

export type ExclusionReason = "protected_test_factory" | "unsupported_content_type" | "multipart_etag" | "size_mismatch" | "missing";

export type BackfillReport = {
  mode: "dry-run" | "apply";
  listed: number;
  listingComplete: boolean;
  referencedTargets: number;
  alreadyDone: number;
  pending: number;
  excluded: Partial<Record<ExclusionReason, number>>;
  pendingBytes: number;
  fingerprint: string;
  processed: number;
  rewritten: number;
  failed: number;
  failureReasons: Record<string, number>;
  versionIdsReturned: number;
  aborted: null | "listing_incomplete" | "approval_mismatch";
};

const MAX_LIST_PAGES = 500;
const isMultipartEtag = (etag: string | null) => !etag || etag.replace(/"/g, "").includes("-");

export function planFingerprint(entries: { key: string; etag: string | null; size: number }[]): string {
  const lines = entries.map(e => `${e.key}\t${e.etag ?? ""}\t${e.size}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export async function runCacheControlBackfill(
  opts: { apply?: boolean; approvedFingerprint?: string; maxBatch?: number; protectedFactoryIds?: readonly number[] },
  deps: BackfillDeps,
): Promise<BackfillReport> {
  const protectedIds = new Set([...PROTECTED_TEST_FACTORY_IDS, ...(opts.protectedFactoryIds ?? [])]);
  const maxBatch = Math.max(0, opts.maxBatch ?? 25);

  const objects: ListedObject[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await deps.listPage(token);
    objects.push(...page.objects);
    token = page.nextToken;
    pages++;
  } while (token && pages < MAX_LIST_PAGES);
  const listingComplete = !token;

  const { refs } = await deps.collectReferences();
  const targets = objects
    .filter(o => refs.has(o.key) && ruleForKey(o.key, PUBLIC_RECONCILE_RULES) !== null)
    .sort((a, b) => (a.key < b.key ? -1 : 1));

  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const exclude = (r: ExclusionReason) => { excluded[r] = (excluded[r] ?? 0) + 1; };
  const eligible: { key: string; size: number; detail: StorageObjectDetail }[] = [];
  let alreadyDone = 0;
  for (const o of targets) {
    const fid = factoryIdOfKey(o.key);
    if (fid !== null && protectedIds.has(fid)) { exclude("protected_test_factory"); continue; }
    const d = await deps.head(o.key);
    if (!d) { exclude("missing"); continue; }
    if (!d.contentType || !SAFE_CONTENT_TYPES.has(d.contentType)) { exclude("unsupported_content_type"); continue; }
    if (isMultipartEtag(d.etag)) { exclude("multipart_etag"); continue; }
    if (d.contentLength !== o.size) { exclude("size_mismatch"); continue; }
    if (d.cacheControl === PUBLIC_IMMUTABLE_CACHE_CONTROL) alreadyDone++;
    eligible.push({ key: o.key, size: o.size, detail: d });
  }
  const pendingList = eligible.filter(e => e.detail.cacheControl !== PUBLIC_IMMUTABLE_CACHE_CONTROL);
  const report: BackfillReport = {
    mode: opts.apply ? "apply" : "dry-run",
    listed: objects.length,
    listingComplete,
    referencedTargets: targets.length,
    alreadyDone,
    pending: pendingList.length,
    excluded,
    pendingBytes: pendingList.reduce((a, e) => a + e.size, 0),
    fingerprint: planFingerprint(eligible.map(e => ({ key: e.key, etag: e.detail.etag, size: e.size }))),
    processed: 0,
    rewritten: 0,
    failed: 0,
    failureReasons: {},
    versionIdsReturned: 0,
    aborted: null,
  };
  if (!opts.apply) return report;
  if (!listingComplete) return { ...report, aborted: "listing_incomplete" };
  if (!opts.approvedFingerprint || opts.approvedFingerprint !== report.fingerprint) return { ...report, aborted: "approval_mismatch" };

  const fail = (reason: string) => { report.failed++; report.failureReasons[reason] = (report.failureReasons[reason] ?? 0) + 1; };
  for (const e of pendingList.slice(0, maxBatch)) {
    report.processed++;
    try {
      const before = await deps.head(e.key);
      if (!before || before.etag !== e.detail.etag || before.contentLength !== e.size || before.contentType !== e.detail.contentType) { fail("changed_since_plan"); continue; }
      if (before.cacheControl === PUBLIC_IMMUTABLE_CACHE_CONTROL) { report.rewritten++; continue; }
      const { versionId } = await deps.rewrite(e.key, before, PUBLIC_IMMUTABLE_CACHE_CONTROL);
      if (versionId) report.versionIdsReturned++;
      const after = await deps.head(e.key);
      if (!after || after.etag !== before.etag || after.contentLength !== before.contentLength || after.contentType !== before.contentType
        || after.cacheControl !== PUBLIC_IMMUTABLE_CACHE_CONTROL || after.contentDisposition !== before.contentDisposition
        || after.contentEncoding !== before.contentEncoding || JSON.stringify(after.metadata) !== JSON.stringify(before.metadata)) {
        fail("post_verify_mismatch");
        continue;
      }
      const pub = await deps.publicHead(e.key);
      if (pub.status !== 200 || pub.cacheControl !== PUBLIC_IMMUTABLE_CACHE_CONTROL) { fail("public_read_check_failed"); continue; }
      report.rewritten++;
    } catch (err) {
      fail((err as { name?: string } | null)?.name ?? "Error");
    }
  }
  return report;
}

export function formatBackfillReport(r: BackfillReport): string {
  return [
    `[cache-control-backfill] mode=${r.mode} listed=${r.listed} listing_complete=${r.listingComplete} referenced_targets=${r.referencedTargets}`,
    `[cache-control-backfill] already_done=${r.alreadyDone} pending=${r.pending} pending_bytes=${r.pendingBytes} excluded=${JSON.stringify(r.excluded)}`,
    `[cache-control-backfill] fingerprint=${r.fingerprint}`,
    ...(r.mode === "apply"
      ? [`[cache-control-backfill] processed=${r.processed} rewritten=${r.rewritten} failed=${r.failed} failure_reasons=${JSON.stringify(r.failureReasons)} version_ids_returned=${r.versionIdsReturned} aborted=${r.aborted ?? "no"}`]
      : []),
  ].join("\n");
}
