/**
 * Batch 3.10：儲存空間對帳（server/storageReconcile.ts、server/jobs/reconcileStorageObjects.ts）。
 * S3 一律用假的 listPage／deleteObject；DB 引用掃描用本機測試 DB 的真實資料。
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import {
  PRIVATE_RECONCILE_RULES,
  PUBLIC_RECONCILE_RULES,
  candidateFingerprint,
  collectStorageReferences,
  decideObject,
  extractStorageKeys,
  runStorageReconcile,
  type ListedObject,
  type ReconcileDeps,
  type StorageReferences,
} from "./storageReconcile";
import { decideReconcileExitCode, parseReconcileArgs } from "./jobs/reconcileStorageObjects";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const NOW = new Date("2026-10-01T00:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);
const BASE = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/";
const n21 = (c: string) => c.repeat(21).slice(0, 21);
const obj = (key: string, ageDays = 40, size = 100): ListedObject => ({ key, size, lastModified: daysAgo(ageDays) });

describe("extractStorageKeys：任何格式的引用都能被辨識", () => {
  it("完整網址、URL 編碼、JSON、純 key、私有 key、帶 query 的網址", () => {
    const keys = extractStorageKeys(JSON.stringify({
      a: `${BASE}factory-photos/12/${n21("a")}.jpg`,
      b: `${BASE}product-images%2F7%2F${n21("b")}.webp`,
      c: [`${BASE}factory-avatars-temp/3/${n21("c")}.png?X-Amz-Signature=x`],
      d: `chat-attachments/9/${n21("d")}.pdf`,
      e: { imageKeys: [`certification-evidence/4/${n21("e")}.jpg`] },
    }));
    expect(keys).toEqual(new Set([
      `factory-photos/12/${n21("a")}.jpg`,
      `product-images/7/${n21("b")}.webp`,
      `factory-avatars-temp/3/${n21("c")}.png`,
      `chat-attachments/9/${n21("d")}.pdf`,
      `certification-evidence/4/${n21("e")}.jpg`,
    ]));
  });
  it("factory-avatars-temp 不會被誤判成 factory-avatars", () => {
    expect(extractStorageKeys(`${BASE}factory-avatars-temp/1/${n21("x")}.jpg`)).toEqual(new Set([`factory-avatars-temp/1/${n21("x")}.jpg`]));
  });
  it("null／無關文字回傳空集合", () => {
    expect(extractStorageKeys(null).size).toBe(0);
    expect(extractStorageKeys("hello world").size).toBe(0);
  });
});

describe("decideObject：只有「格式正確＋沒有任何引用＋超過寬限期」才是候選", () => {
  const key = `factory-photos/12/${n21("p")}.jpg`;
  const ref = (kind: "CURRENT" | "REVISION_PENDING" | "REVISION_HISTORY" | "SOFT_DELETED" | "BACKUP"): StorageReferences => new Map([[key, new Set([kind])]]);
  it.each(["CURRENT", "REVISION_PENDING", "REVISION_HISTORY", "SOFT_DELETED", "BACKUP"] as const)("被 %s 引用 → 保留", kind => {
    expect(decideObject(obj(key), ref(kind), PUBLIC_RECONCILE_RULES, NOW)).toMatchObject({ reason: "referenced", candidate: false });
  });
  it("沒有引用但在寬限期內（上傳後尚未儲存）→ 保留", () => {
    expect(decideObject(obj(key, 3), new Map(), PUBLIC_RECONCILE_RULES, NOW)).toMatchObject({ reason: "within_grace", candidate: false });
  });
  it("暫存頭貼寬限 30 天", () => {
    const t = `factory-avatars-temp/5/${n21("t")}.jpg`;
    expect(decideObject(obj(t, 20), new Map(), PUBLIC_RECONCILE_RULES, NOW).candidate).toBe(false);
    expect(decideObject(obj(t, 31), new Map(), PUBLIC_RECONCILE_RULES, NOW).candidate).toBe(true);
  });
  it.each([
    ["未知 prefix", "weird/1/abcdefgh.jpg"],
    ["檔名不符", "factory-photos/12/bad name.jpg"],
    ["路徑跳脫", "factory-photos/12/../x.jpg"],
    ["多層路徑", "factory-photos/12/a/abcdefgh.jpg"],
    ["非數字 id", "factory-photos/abc/abcdefgh.jpg"],
    ["副檔名不符", "factory-photos/12/abcdefgh.svg"],
    ["私有 prefix 出現在公開 bucket", `chat-attachments/1/${n21("c")}.pdf`],
  ])("%s → unrecognized，保留不刪", (_l, k) => {
    expect(decideObject(obj(k), new Map(), PUBLIC_RECONCILE_RULES, NOW)).toMatchObject({ reason: "unrecognized_key", candidate: false });
  });
  it("私有 bucket 規則：tmp 寬限 2 天、正式 7 天、認證證明 30 天", () => {
    const empty = new Map();
    expect(decideObject(obj(`chat-attachments/tmp/${n21("a")}.pdf`, 3), empty, PRIVATE_RECONCILE_RULES, NOW).candidate).toBe(true);
    expect(decideObject(obj(`chat-attachments/12/${n21("a")}.pdf`, 3), empty, PRIVATE_RECONCILE_RULES, NOW).candidate).toBe(false);
    expect(decideObject(obj(`news-attachments/5/${n21("a")}.pdf`, 8), empty, PRIVATE_RECONCILE_RULES, NOW).candidate).toBe(true);
    expect(decideObject(obj(`certification-evidence/5/${n21("a")}.jpg`, 20), empty, PRIVATE_RECONCILE_RULES, NOW).candidate).toBe(false);
    expect(decideObject(obj(`factory-photos/5/${n21("a")}.jpg`, 90), empty, PRIVATE_RECONCILE_RULES, NOW).reason).toBe("unrecognized_key");
  });
});

function fakeDeps(objects: ListedObject[], refsSeq: StorageReferences[], opts: { failKeys?: Set<string>; notFoundKeys?: Set<string>; pages?: number } = {}) {
  const store = new Map(objects.map(o => [o.key, o]));
  const deleted: string[] = [];
  let scans = 0;
  const deps: ReconcileDeps = {
    now: () => NOW,
    listPage: async (token?: string) => {
      const all = Array.from(store.values());
      const page = Number(token ?? 0);
      const size = Math.ceil(all.length / (opts.pages ?? 1)) || 1;
      const slice = all.slice(page * size, (page + 1) * size);
      return { objects: slice, nextToken: (page + 1) * size < all.length ? String(page + 1) : undefined };
    },
    collectReferences: async () => {
      const refs = refsSeq[Math.min(scans, refsSeq.length - 1)];
      scans++;
      return { refs, tables: 1, columns: 1 };
    },
    deleteObject: async (key: string) => {
      if (opts.failKeys?.has(key)) throw Object.assign(new Error("boom"), { name: "InternalError" });
      if (opts.notFoundKeys?.has(key)) throw Object.assign(new Error("gone"), { name: "NoSuchKey" });
      store.delete(key);
      deleted.push(key);
    },
  };
  return { deps, deleted, store, scans: () => scans };
}

describe("runStorageReconcile：dry-run 預設、核准指紋、刪除前重新確認", () => {
  const live = `factory-photos/1/${n21("l")}.jpg`;
  const orphanA = `factory-photos/1/${n21("a")}.jpg`;
  const orphanB = `product-images/1/${n21("b")}.jpg`;
  const fresh = `product-images/1/${n21("f")}.jpg`;
  const objects = () => [obj(live), obj(orphanA, 40, 300), obj(orphanB, 40, 200), obj(fresh, 1)];
  const refs: StorageReferences = new Map([[live, new Set(["CURRENT" as const])]]);

  it("dry-run：只報告，不刪任何物件；指紋＝候選 key 的 SHA-256", async () => {
    const f = fakeDeps(objects(), [refs]);
    const r = await runStorageReconcile({ bucket: "public" }, f.deps);
    expect(f.deleted).toEqual([]);
    expect(r).toMatchObject({ mode: "dry-run", listed: 4, candidateCount: 2, candidateBytes: 500, aborted: null });
    expect(r.fingerprint).toBe(candidateFingerprint([orphanA, orphanB]));
    expect(r.perPrefix["factory-photos/"]).toMatchObject({ total: 2, referenced: 1, candidates: 1 });
    expect(r.perPrefix["product-images/"]).toMatchObject({ total: 2, withinGrace: 1, candidates: 1 });
    expect(decideReconcileExitCode(r)).toBe(0);
  });

  it("apply 沒有指紋或指紋不符 → 中止，不刪任何物件", async () => {
    for (const fp of [undefined, "0".repeat(64)]) {
      const f = fakeDeps(objects(), [refs]);
      const r = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: fp }, f.deps);
      expect(r.aborted).toBe("approval_mismatch");
      expect(f.deleted).toEqual([]);
      expect(decideReconcileExitCode(r)).toBe(1);
    }
  });

  it("apply 指紋相符 → 只刪核准的候選；引用中、寬限期內的物件保留；再次執行冪等（0 候選）", async () => {
    const f = fakeDeps(objects(), [refs]);
    const fp = candidateFingerprint([orphanA, orphanB]);
    const r = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: fp }, f.deps);
    expect(r).toMatchObject({ aborted: null, deleted: 2, failed: 0 });
    expect(f.deleted.sort()).toEqual([orphanA, orphanB].sort());
    expect(Array.from(f.store.keys()).sort()).toEqual([live, fresh].sort());
    const again = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: candidateFingerprint([]) }, f.deps);
    expect(again).toMatchObject({ candidateCount: 0, deleted: 0, aborted: null });
  });

  it("dry-run 與 apply 之間候選被引用 → 刪除前的重新掃描中止整批，不刪任何物件", async () => {
    const nowReferenced: StorageReferences = new Map([...refs, [orphanA, new Set(["REVISION_PENDING" as const])]]);
    const f = fakeDeps(objects(), [refs, nowReferenced]);
    const r = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: candidateFingerprint([orphanA, orphanB]) }, f.deps);
    expect(r.aborted).toBe("references_changed");
    expect(f.deleted).toEqual([]);
    expect(f.scans()).toBe(2);
  });

  it("單筆刪除失敗只計數，其他照常；NoSuchKey 視同已刪除", async () => {
    const f = fakeDeps(objects(), [refs], { failKeys: new Set([orphanA]), notFoundKeys: new Set([orphanB]) });
    const r = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: candidateFingerprint([orphanA, orphanB]) }, f.deps);
    expect(r).toMatchObject({ deleted: 1, failed: 1 });
    expect(decideReconcileExitCode(r)).toBe(1);
  });

  it("候選超過 maxDeletes → 中止", async () => {
    const f = fakeDeps(objects(), [refs]);
    const r = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: candidateFingerprint([orphanA, orphanB]), maxDeletes: 1 }, f.deps);
    expect(r.aborted).toBe("too_many_candidates");
    expect(f.deleted).toEqual([]);
  });

  it("多頁 listing 會完整列出", async () => {
    const f = fakeDeps(objects(), [refs], { pages: 4 });
    const r = await runStorageReconcile({ bucket: "public" }, f.deps);
    expect(r.listed).toBe(4);
    expect(r.listingComplete).toBe(true);
  });
});

describe("CLI 參數", () => {
  it("必須指定 bucket；--apply 必須帶 64 字元指紋；max-delete 有範圍", () => {
    expect(() => parseReconcileArgs([])).toThrow(/--bucket/);
    expect(parseReconcileArgs(["--bucket=public"])).toMatchObject({ bucket: "public", apply: false, maxDeletes: 200 });
    expect(() => parseReconcileArgs(["--bucket=public", "--apply"])).toThrow(/--approve/);
    expect(() => parseReconcileArgs(["--bucket=public", "--apply", "--approve=abc"])).toThrow(/--approve/);
    expect(parseReconcileArgs(["--bucket=private", "--apply", `--approve=${"a".repeat(64)}`, "--max-delete=5"])).toMatchObject({ bucket: "private", apply: true, maxDeletes: 5 });
    expect(() => parseReconcileArgs(["--bucket=public", "--max-delete=-1"])).toThrow(/max-delete/);
  });
});

describe("collectStorageReferences（本機測試 DB）：現行、修改申請、軟刪除、備份表的引用都會保護物件", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const userIds: number[] = [];
  const factoryIds: number[] = [];
  const backupTable = `factories_backup_sr310_${runId.replace(/[^a-z0-9_]/gi, "")}`;
  const run = async (q: ReturnType<typeof sql>) => ((await (await db.getDb())!.execute(q)) as unknown as [any, unknown])[0];

  afterAll(async () => {
    await run(sql`DROP TABLE IF EXISTS ${sql.identifier(backupTable)}`);
    for (const f of factoryIds) {
      await run(sql`DELETE FROM factoryRevisions WHERE factoryId = ${f}`);
      await run(sql`DELETE FROM factoryPhotos WHERE factoryId = ${f}`);
      await run(sql`DELETE FROM products WHERE factoryId = ${f}`);
      await deleteTestFactory(f);
    }
    for (const u of userIds) await deleteTestUser(u);
  }, 60000);

  it("每一種引用都被辨識；只有完全沒被引用的物件成為候選", async () => {
    const owner = await ensureTestUser(`sr310-${runId}`, "SR310");
    const owner2 = await ensureTestUser(`sr310b-${runId}`, "SR310b");
    userIds.push(owner, owner2);
    const live = await createTestFactory(owner, `SR310 live ${runId}`);
    factoryIds.push(live);
    const gone = await createTestFactory(owner2, `SR310 gone ${runId}`);
    factoryIds.push(gone);
    const k = (prefix: string, fid: number, c: string) => `${prefix}/${fid}/${n21(c)}.jpg`;
    const K = {
      avatar: k("factory-avatars", live, "a"),
      photo: k("factory-photos", live, "p"),
      product: k("product-images", live, "r"),
      pendingTemp: k("factory-avatars-temp", live, "n"),
      historyTemp: k("factory-avatars-temp", live, "h"),
      softDeletedPhoto: k("factory-photos", gone, "s"),
      backup: k("factory-avatars", live, "b"),
      orphan: k("factory-photos", live, "o"),
    };
    await run(sql`UPDATE factories SET avatarUrl = ${BASE + K.avatar} WHERE id = ${live}`);
    await run(sql`INSERT INTO factoryPhotos (factoryId, url) VALUES (${live}, ${BASE + K.photo}), (${gone}, ${BASE + K.softDeletedPhoto})`);
    await run(sql`UPDATE factories SET deletedAt = NOW() WHERE id = ${gone}`);
    await run(sql`INSERT INTO products (factoryId, name, images) VALUES (${live}, 'SR310', ${JSON.stringify([BASE + K.product])})`);
    await run(sql`INSERT INTO factoryRevisions (factoryId, submittedBy, status, originalData, proposedData) VALUES
      (${live}, ${owner}, 'pending', '{}', ${JSON.stringify({ avatarUrl: BASE + K.pendingTemp })})`);
    await run(sql`INSERT INTO factoryRevisions (factoryId, submittedBy, status, originalData, proposedData) VALUES
      (${live}, ${owner}, 'approved', '{}', ${JSON.stringify({ avatarUrl: BASE + K.historyTemp })})`);
    await run(sql`CREATE TABLE ${sql.identifier(backupTable)} (id INT PRIMARY KEY, avatarUrl TEXT)`);
    await run(sql`INSERT INTO ${sql.identifier(backupTable)} (id, avatarUrl) VALUES (1, ${BASE + K.backup})`);

    const { refs } = await collectStorageReferences();
    expect(refs.get(K.avatar)).toEqual(new Set(["CURRENT"]));
    expect(refs.get(K.photo)).toEqual(new Set(["CURRENT"]));
    expect(refs.get(K.product)).toEqual(new Set(["CURRENT"]));
    expect(refs.get(K.pendingTemp)).toEqual(new Set(["REVISION_PENDING"]));
    expect(refs.get(K.historyTemp)).toEqual(new Set(["REVISION_HISTORY"]));
    expect(refs.get(K.softDeletedPhoto)).toEqual(new Set(["SOFT_DELETED"]));
    expect(refs.get(K.backup)).toEqual(new Set(["BACKUP"]));
    expect(refs.has(K.orphan)).toBe(false);

    const f = fakeDeps(Object.values(K).map(key => obj(key, 60)), [refs]);
    f.deps.collectReferences = collectStorageReferences;
    const dry = await runStorageReconcile({ bucket: "public" }, f.deps);
    expect(dry.candidateCount).toBe(1);
    expect(dry.fingerprint).toBe(candidateFingerprint([K.orphan]));
    const applied = await runStorageReconcile({ bucket: "public", apply: true, approvedFingerprint: dry.fingerprint }, f.deps);
    expect(applied).toMatchObject({ deleted: 1, failed: 0, aborted: null });
    expect(f.deleted).toEqual([K.orphan]);
  }, 60000);
});
