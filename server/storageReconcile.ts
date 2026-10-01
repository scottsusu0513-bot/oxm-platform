/**
 * 儲存空間對帳（Production Hardening Batch 3.10）。
 *
 * 背景：刪相簿照片、刪商品、更新商品圖片、換封面／頭貼、上傳後沒有儲存（商品圖、
 * 社群圖、找消息內文圖）、取消徽章、刪對話／附件時 S3 刪除失敗、finalize 後 DB
 * 寫入失敗——這些路徑都只改 DB，S3 物件留下來。公開物件因此「刪除後仍可用原網址
 * 公開存取」；正式站 Phase 1 精確對帳有 92 個沒有任何 DB 引用的公開物件。
 *
 * 為什麼不在每個請求裡直接刪 S3：同一個物件可能同時被其他地方引用（修改申請的
 * 原始／提案資料、軟刪除的紀錄、備份表…），請求當下逐一確認所有引用既昂貴又容易
 * 漏；刪錯一個仍在使用的物件會直接讓公開頁面破圖。改由這個對帳流程統一處理：
 *
 *   1. ListObjectsV2 列出整個 bucket（有頁數上限；列不完整就不刪任何東西）
 *   2. 掃描 DB「所有資料表的所有文字／JSON 欄位」，收集任何出現過的 storage key
 *      ——不依賴固定欄位清單，新增的欄位、修改申請歷史、軟刪除紀錄、備份表都會被
 *      保護（只要 key 還出現在任何地方，就不是刪除候選）
 *   3. 只有同時符合：key 格式完全符合已知規則、沒有任何引用、建立時間超過該
 *      prefix 的寬限期，才列為候選
 *   4. 預設只產生報告（dry-run）。要真的刪除必須帶 --apply，並提供 dry-run 報告的
 *      候選集合指紋（--approve），集合有任何變化就整批中止
 *   5. 刪除前立刻重新掃描一次 DB；任何候選在這期間被引用，整批中止、不刪任何物件
 *   6. 逐一刪除（一次一個），失敗只計數、不影響其他物件，S3 DeleteObject 本身冪等
 *
 * 報告與 log 只有數量、prefix 與指紋，不含任何 key、檔名、網址或憑證。
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { CERTIFICATION_EVIDENCE_KEY_PREFIX } from "../shared/badges";

export type StorageBucketName = "public" | "private";

export type ReconcileRule = {
  /** 含結尾斜線 */
  prefix: string;
  /** 完整 key 必須符合；不符合的物件一律保留（unrecognized），不會被刪 */
  keyPattern: RegExp;
  /** 物件建立（LastModified）未滿這個天數一律保留：涵蓋「已上傳、尚未儲存」的流程 */
  graceDays: number;
};

const NAME = "[A-Za-z0-9_-]{6,64}";
const IMG = "\\.(?:jpg|jpeg|png|webp)";
const ID = "[1-9][0-9]{0,9}";
const imgRule = (prefix: string, graceDays: number): ReconcileRule => ({
  prefix: `${prefix}/`,
  keyPattern: new RegExp(`^${prefix}/${ID}/${NAME}${IMG}$`),
  graceDays,
});

export const PUBLIC_RECONCILE_RULES: readonly ReconcileRule[] = [
  // 暫存頭貼：修改申請待審期間由 revision 引用；未送出的上傳較長寬限
  imgRule("factory-avatars-temp", 30),
  imgRule("factory-avatars", 7),
  imgRule("factory-covers", 7),
  imgRule("factory-photos", 7),
  imgRule("product-images", 7),
  imgRule("news-covers", 7),
  imgRule("news-content", 7),
  imgRule("community-posts", 7),
];

export const PRIVATE_RECONCILE_RULES: readonly ReconcileRule[] = [
  { prefix: "chat-attachments/tmp/", keyPattern: /^chat-attachments\/tmp\/[A-Za-z0-9_-]{21}\.pdf$/, graceDays: 2 },
  { prefix: "chat-attachments/", keyPattern: new RegExp(`^chat-attachments/${ID}/[A-Za-z0-9_-]{21}\\.pdf$`), graceDays: 7 },
  { prefix: "news-attachments/tmp/", keyPattern: new RegExp(`^news-attachments/tmp/${NAME}\\.pdf$`), graceDays: 2 },
  { prefix: "news-attachments/", keyPattern: new RegExp(`^news-attachments/${ID}/${NAME}\\.pdf$`), graceDays: 7 },
  // 認證證明綁定審核流程，寬限較長
  imgRule("certification-evidence", 30),
];

/**
 * private bucket 對帳只列出這三個頂層 prefix（每個 ListObjectsV2 都明確帶 Prefix），
 * 不對整個 bucket 做無 Prefix 的列出。IAM 的 s3:ListBucket 條件（s3:prefix）必須與
 * 這份清單一致——見 docs/storage.md。PRIVATE_RECONCILE_RULES 的每條規則都必須落在
 * 其中一個 prefix 底下（storageReconcile310 測試會檢查）。
 */
export const PRIVATE_RECONCILE_LIST_PREFIXES: readonly string[] = [
  "chat-attachments/",
  "news-attachments/",
  `${CERTIFICATION_EVIDENCE_KEY_PREFIX}/`,
];

export function rulesFor(bucket: StorageBucketName): readonly ReconcileRule[] {
  return bucket === "public" ? PUBLIC_RECONCILE_RULES : PRIVATE_RECONCILE_RULES;
}

/** DB 掃描時要找的所有 key prefix（公開＋私有，與 bucket 無關，一律收集）。 */
export const STORAGE_KEY_PREFIXES = [
  "factory-avatars-temp", "factory-avatars", "factory-covers", "factory-photos", "product-images",
  "news-covers", "news-content", "community-posts",
  "chat-attachments", "news-attachments", "certification-evidence",
] as const;

const KEY_TOKEN_RE = new RegExp(`(?:${STORAGE_KEY_PREFIXES.join("|")})/[A-Za-z0-9_.%/-]+`, "g");

/** 從任意欄位值（純 key、完整網址、URL 編碼、JSON）取出所有 storage key。 */
export function extractStorageKeys(value: unknown): Set<string> {
  const out = new Set<string>();
  if (value == null) return out;
  const s = typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : JSON.stringify(value);
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* 保留原字串 */ }
  for (const variant of [s, decoded]) {
    for (const m of Array.from(variant.matchAll(KEY_TOKEN_RE))) {
      let k = m[0].replace(/[./]+$/, "");
      try { k = decodeURIComponent(k); } catch { /* 保留 */ }
      out.add(k);
    }
  }
  return out;
}

export type ReferenceKind = "CURRENT" | "REVISION_PENDING" | "REVISION_HISTORY" | "SOFT_DELETED" | "BACKUP";
export type StorageReferences = Map<string, Set<ReferenceKind>>;

const STRING_TYPES = new Set(["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "json"]);

/**
 * 掃描整個資料庫（只讀 SELECT）：所有資料表的所有文字／JSON 欄位。先用 LIKE 只取
 * 含已知 prefix 的列，再在程式端精確解析 key。kind 只用於報告，任何 kind 的引用
 * 都會讓物件被保留。
 */
export async function collectStorageReferences(): Promise<{ refs: StorageReferences; tables: number; columns: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const run = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as [any[], unknown])[0];

  const cols = await run(sql`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS dt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const byTable = new Map<string, { c: string; dt: string }[]>();
  for (const r of cols) {
    const list = byTable.get(r.t) ?? [];
    list.push({ c: r.c, dt: String(r.dt).toLowerCase() });
    byTable.set(r.t, list);
  }
  const factoryDeleted = new Map<number, boolean>();
  for (const r of await run(sql`SELECT id, deletedAt FROM factories`)) factoryDeleted.set(Number(r.id), r.deletedAt != null);

  const refs: StorageReferences = new Map();
  let columns = 0;
  const likeTerms = STORAGE_KEY_PREFIXES.map(p => `%${p}/%`);
  for (const [table, tcols] of Array.from(byTable.entries())) {
    const names = new Set(tcols.map(c => c.c));
    // lower_case_table_names 在不同平台不同（Windows 本機為小寫），比較一律不分大小寫
    const tableLc = table.toLowerCase();
    const ctxCols = ["status", "deletedAt", "factoryId"].filter(n => names.has(n));
    for (const { c: col, dt } of tcols) {
      if (!STRING_TYPES.has(dt)) continue;
      columns++;
      const select = sql.join([col, ...ctxCols.filter(n => n !== col)].map(n => sql.identifier(n)), sql`, `);
      const where = sql.join(likeTerms.map(term => sql`CAST(${sql.identifier(col)} AS CHAR) LIKE ${term}`), sql` OR `);
      const rows = await run(sql`SELECT ${select} FROM ${sql.identifier(table)} WHERE ${where}`);
      for (const row of rows) {
        const keys = extractStorageKeys(row[col]);
        if (keys.size === 0) continue;
        let kind: ReferenceKind;
        if (/backup/i.test(table)) kind = "BACKUP";
        else if (tableLc === "factoryrevisions") kind = row.status === "pending" ? "REVISION_PENDING" : "REVISION_HISTORY";
        else if (names.has("deletedAt") && row.deletedAt != null) kind = "SOFT_DELETED";
        else if (tableLc !== "factories" && names.has("factoryId") && factoryDeleted.get(Number(row.factoryId)) === true) kind = "SOFT_DELETED";
        else kind = "CURRENT";
        for (const k of Array.from(keys)) {
          const set = refs.get(k) ?? new Set<ReferenceKind>();
          set.add(kind);
          refs.set(k, set);
        }
      }
    }
  }
  return { refs, tables: byTable.size, columns };
}

export type ListedObject = { key: string; size: number; lastModified: Date };
export type DecisionReason = "referenced" | "within_grace" | "unrecognized_key" | "unreferenced";
export type ObjectDecision = { key: string; size: number; prefix: string; reason: DecisionReason; candidate: boolean };

export function ruleForKey(key: string, rules: readonly ReconcileRule[]): ReconcileRule | null {
  // 規則依序比對；tmp 等較具體的 prefix 排在前面
  for (const r of rules) if (key.startsWith(r.prefix)) return r.keyPattern.test(key) ? r : null;
  return null;
}

export function decideObject(o: ListedObject, refs: StorageReferences, rules: readonly ReconcileRule[], now: Date): ObjectDecision {
  const matchedPrefix = rules.find(r => o.key.startsWith(r.prefix))?.prefix ?? "(unknown)/";
  const base = { key: o.key, size: o.size, prefix: matchedPrefix };
  if (refs.has(o.key)) return { ...base, reason: "referenced", candidate: false };
  const rule = ruleForKey(o.key, rules);
  if (!rule) return { ...base, reason: "unrecognized_key", candidate: false };
  const ageMs = now.getTime() - o.lastModified.getTime();
  if (!(ageMs > rule.graceDays * 86_400_000)) return { ...base, reason: "within_grace", candidate: false };
  return { ...base, reason: "unreferenced", candidate: true };
}

/** 候選集合指紋：排序後的 key 以換行串接的 SHA-256。報告只印這個，不印 key。 */
export function candidateFingerprint(keys: readonly string[]): string {
  return createHash("sha256").update([...keys].sort().join("\n")).digest("hex");
}

export type ReconcileDeps = {
  /** public：prefix 一律 undefined（列整個 bucket，行為不變）；private：一律帶 PRIVATE_RECONCILE_LIST_PREFIXES 其中之一 */
  listPage: (continuationToken?: string, prefix?: string) => Promise<{ objects: ListedObject[]; nextToken?: string }>;
  collectReferences: () => Promise<{ refs: StorageReferences; tables: number; columns: number }>;
  deleteObject: (key: string) => Promise<void>;
  now?: () => Date;
};

export type PrefixSummary = { total: number; referenced: number; withinGrace: number; unrecognized: number; candidates: number; candidateBytes: number };

export type ReconcileReport = {
  bucket: StorageBucketName;
  mode: "dry-run" | "apply";
  listed: number;
  listingComplete: boolean;
  dbTables: number;
  dbColumns: number;
  referencedKeys: number;
  perPrefix: Record<string, PrefixSummary>;
  candidateCount: number;
  candidateBytes: number;
  fingerprint: string;
  deleted: number;
  failed: number;
  aborted: null | "listing_incomplete" | "approval_mismatch" | "too_many_candidates" | "references_changed";
};

export const DEFAULT_MAX_DELETES = 200;
const MAX_LIST_PAGES = 500;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export async function runStorageReconcile(
  opts: { bucket: StorageBucketName; apply?: boolean; approvedFingerprint?: string; maxDeletes?: number },
  deps: ReconcileDeps,
): Promise<ReconcileReport> {
  const rules = rulesFor(opts.bucket);
  const now = deps.now?.() ?? new Date();

  // 任何一頁列出失敗都直接拋出（不刪任何東西）；頁數超過上限則標為列不完整，apply 會中止
  const { objects, listingComplete } = await listBucketObjects(opts.bucket, deps);

  const scan = await deps.collectReferences();
  const decisions = objects.map(o => decideObject(o, scan.refs, rules, now));
  const perPrefix: Record<string, PrefixSummary> = {};
  for (const d of decisions) {
    const s = (perPrefix[d.prefix] ??= { total: 0, referenced: 0, withinGrace: 0, unrecognized: 0, candidates: 0, candidateBytes: 0 });
    s.total++;
    if (d.reason === "referenced") s.referenced++;
    else if (d.reason === "within_grace") s.withinGrace++;
    else if (d.reason === "unrecognized_key") s.unrecognized++;
    else { s.candidates++; s.candidateBytes += d.size; }
  }
  const candidates = decisions.filter(d => d.candidate);
  const report: ReconcileReport = {
    bucket: opts.bucket,
    mode: opts.apply ? "apply" : "dry-run",
    listed: objects.length,
    listingComplete,
    dbTables: scan.tables,
    dbColumns: scan.columns,
    referencedKeys: scan.refs.size,
    perPrefix,
    candidateCount: candidates.length,
    candidateBytes: candidates.reduce((a, d) => a + d.size, 0),
    fingerprint: candidateFingerprint(candidates.map(d => d.key)),
    deleted: 0,
    failed: 0,
    aborted: null,
  };
  if (!opts.apply) return report;

  if (!listingComplete) return { ...report, aborted: "listing_incomplete" };
  if (!opts.approvedFingerprint || opts.approvedFingerprint !== report.fingerprint) return { ...report, aborted: "approval_mismatch" };
  if (candidates.length > (opts.maxDeletes ?? DEFAULT_MAX_DELETES)) return { ...report, aborted: "too_many_candidates" };

  // 刪除前立刻重新掃描 DB：任何候選在這期間被引用，整批中止
  const recheck = await deps.collectReferences();
  if (candidates.some(d => recheck.refs.has(d.key))) return { ...report, aborted: "references_changed" };

  let deleted = 0, failed = 0;
  for (const d of candidates) {
    try {
      await deps.deleteObject(d.key);
      deleted++;
    } catch (err) {
      if (isNotFound(err)) deleted++;
      else failed++;
    }
  }
  return { ...report, deleted, failed };
}

async function listPrefix(deps: ReconcileDeps, prefix: string | undefined): Promise<{ objects: ListedObject[]; complete: boolean }> {
  const objects: ListedObject[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await deps.listPage(token, prefix);
    objects.push(...page.objects);
    token = page.nextToken;
    pages++;
  } while (token && pages < MAX_LIST_PAGES);
  return { objects, complete: !token };
}

/**
 * public：與原本相同，列整個 bucket。private（Batch 3.10）：逐一列出
 * PRIVATE_RECONCILE_LIST_PREFIXES，每個 prefix 各自處理分頁，再依 key 去重合併；
 * 任一 prefix 回傳不屬於該 prefix 的 key 視為列表異常，直接拋出（fail closed）。
 */
export async function listBucketObjects(bucket: StorageBucketName, deps: ReconcileDeps): Promise<{ objects: ListedObject[]; listingComplete: boolean }> {
  if (bucket === "public") {
    const r = await listPrefix(deps, undefined);
    return { objects: r.objects, listingComplete: r.complete };
  }
  const byKey = new Map<string, ListedObject>();
  let listingComplete = true;
  for (const prefix of PRIVATE_RECONCILE_LIST_PREFIXES) {
    const r = await listPrefix(deps, prefix);
    for (const o of r.objects) {
      if (!o.key.startsWith(prefix)) throw new Error("private listing returned a key outside the requested prefix");
      byKey.set(o.key, o);
    }
    if (!r.complete) listingComplete = false;
  }
  return { objects: Array.from(byKey.values()), listingComplete };
}

/** 報告輸出：只有數量、prefix 與指紋。 */
export function formatReconcileReport(r: ReconcileReport): string {
  const lines = [
    `[storage-reconcile] bucket=${r.bucket} mode=${r.mode} listed=${r.listed} listing_complete=${r.listingComplete} db_tables=${r.dbTables} db_columns=${r.dbColumns} referenced_keys=${r.referencedKeys}`,
  ];
  for (const [p, s] of Object.entries(r.perPrefix).sort()) {
    lines.push(`[storage-reconcile]   ${p}* total=${s.total} referenced=${s.referenced} within_grace=${s.withinGrace} unrecognized=${s.unrecognized} candidates=${s.candidates} candidate_bytes=${s.candidateBytes}`);
  }
  lines.push(`[storage-reconcile] candidates=${r.candidateCount} candidate_bytes=${r.candidateBytes} fingerprint=${r.fingerprint}`);
  if (r.mode === "apply") lines.push(`[storage-reconcile] deleted=${r.deleted} failed=${r.failed} aborted=${r.aborted ?? "no"}`);
  return lines.join("\n");
}
