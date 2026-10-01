/**
 * Batch 3.10：儲存空間對帳（server/storageReconcile.ts、server/jobs/reconcileStorageObjects.ts）。
 * S3 一律用假的 listPage／deleteObject；DB 引用掃描用本機測試 DB 的真實資料。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
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

describe("private 對帳：只按三個 prefix 分別 ListObjectsV2（IAM s3:prefix 限制）", () => {
  const P = ["chat-attachments/", "news-attachments/", "certification-evidence/"];
  const chatKey = (c: string) => `chat-attachments/3/${n21(c)}.pdf`;
  const newsKey = (c: string) => `news-attachments/4/${n21(c)}.pdf`;
  const certKey = (c: string) => `certification-evidence/5/${n21(c)}.jpg`;

  it("清單集中定義為三個 prefix，且所有 private 規則、key 產生器都落在其中（避免與 IAM 漂移）", async () => {
    const { PRIVATE_RECONCILE_LIST_PREFIXES } = await import("./storageReconcile");
    const { CERTIFICATION_EVIDENCE_KEY_PREFIX } = await import("../shared/badges");
    const { createChatPdfTmpKey, chatPdfFinalKey } = await import("./chatPdfAttachment");
    const { newsAttachmentPermanentKey } = await import("./newsAttachmentStorage");
    expect([...PRIVATE_RECONCILE_LIST_PREFIXES]).toEqual(P);
    const covered = (k: string) => PRIVATE_RECONCILE_LIST_PREFIXES.some(p => k.startsWith(p));
    for (const r of PRIVATE_RECONCILE_RULES) expect(covered(r.prefix)).toBe(true);
    for (const k of [createChatPdfTmpKey(), chatPdfFinalKey(3, n21("x")), newsAttachmentPermanentKey(4, "news-attachments/tmp/abcdefgh.pdf"), `${CERTIFICATION_EVIDENCE_KEY_PREFIX}/5/x.jpg`, "news-attachments/tmp/abcdefgh.pdf"]) {
      expect(covered(k)).toBe(true);
    }
  });

  function privateDeps(pages: Record<string, ListedObject[][]>, opts: { failPrefix?: string } = {}) {
    const calls: { prefix?: string; token?: string }[] = [];
    const deleted: string[] = [];
    const deps: ReconcileDeps = {
      now: () => NOW,
      listPage: async (token?: string, prefix?: string) => {
        calls.push({ prefix, token });
        if (prefix && prefix === opts.failPrefix) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
        const list = pages[prefix ?? ""] ?? [[]];
        const i = Number(token ?? 0);
        return { objects: list[i] ?? [], nextToken: i + 1 < list.length ? String(i + 1) : undefined };
      },
      collectReferences: async () => ({ refs: new Map([[chatKey("r"), new Set(["CURRENT" as const])]]), tables: 1, columns: 1 }),
      deleteObject: async (k: string) => { deleted.push(k); },
    };
    return { deps, calls, deleted };
  }
  const pages = () => ({
    "chat-attachments/": [[obj(chatKey("r")), obj(chatKey("a"))], [obj(chatKey("b")), obj(chatKey("a"))]],
    "news-attachments/": [[obj(newsKey("a"))], [obj(newsKey("b"))], [obj(newsKey("c"))]],
    "certification-evidence/": [[obj(certKey("a"))], [obj(certKey("b"))]],
  });

  it("每個 request 都帶三個 prefix 之一、各自分頁、合併去重；沒有任何無 Prefix 的請求", async () => {
    const f = privateDeps(pages());
    const r = await runStorageReconcile({ bucket: "private" }, f.deps);
    expect(f.calls.every(c => c.prefix && P.includes(c.prefix))).toBe(true);
    expect(f.calls.filter(c => c.prefix === "chat-attachments/")).toHaveLength(2);
    expect(f.calls.filter(c => c.prefix === "news-attachments/")).toHaveLength(3);
    expect(f.calls.filter(c => c.prefix === "certification-evidence/")).toHaveLength(2);
    expect(r).toMatchObject({ listed: 8, listingComplete: true }); // 3＋3＋2；chatKey("a") 出現兩次只算一次
    expect(r.perPrefix["chat-attachments/"]).toMatchObject({ total: 3, referenced: 1, candidates: 2 });
    expect(r.candidateCount).toBe(2 + 3 + 2);
  });

  it.each(P)("%s 列出失敗 → 整個對帳拋出（fail closed），不刪任何物件", async (failPrefix) => {
    const f = privateDeps(pages(), { failPrefix });
    const all = Array.from(new Set(Object.values(pages()).flat(2).map(o => o.key)));
    await expect(runStorageReconcile({ bucket: "private", apply: true, approvedFingerprint: candidateFingerprint(all.filter(k => k !== chatKey("r"))) }, f.deps)).rejects.toMatchObject({ name: "AccessDenied" });
    expect(f.deleted).toEqual([]);
  });

  it("某個 prefix 回傳不屬於它的 key → 拋出，不刪任何物件", async () => {
    const p = pages();
    p["news-attachments/"][0].push(obj(chatKey("z")));
    const f = privateDeps(p);
    await expect(runStorageReconcile({ bucket: "private" }, f.deps)).rejects.toThrow(/outside the requested prefix/);
    expect(f.deleted).toEqual([]);
  });

  it("任一 prefix 超過頁數上限 → listing_complete=false，apply 中止", async () => {
    const f = privateDeps(pages());
    const orig = f.deps.listPage;
    f.deps.listPage = async (token, prefix) => prefix === "certification-evidence/" ? { objects: [], nextToken: "again" } : orig(token, prefix);
    const r = await runStorageReconcile({ bucket: "private", apply: true, approvedFingerprint: "0".repeat(64) }, f.deps);
    expect(r).toMatchObject({ listingComplete: false, aborted: "listing_incomplete", deleted: 0 });
  });

  it("真實 S3 client 接線：private 只送出帶 Prefix 的 ListObjectsV2；public 維持不帶 Prefix 列整個 bucket", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const { depsFor } = await import("./jobs/reconcileStorageObjects");
    const sent: { bucket: string; prefix?: string; token?: string }[] = [];
    const spy = vi.spyOn(S3Client.prototype, "send").mockImplementation(async (cmd: any) => {
      const i = cmd.input;
      sent.push({ bucket: i.Bucket, prefix: i.Prefix, token: i.ContinuationToken });
      return (i.ContinuationToken ? { Contents: [], IsTruncated: false } : { Contents: [], IsTruncated: true, NextContinuationToken: "p2" }) as never;
    });
    vi.stubEnv("AWS_PRIVATE_FILES_BUCKET", "priv-bucket-test");
    vi.stubEnv("AWS_PRIVATE_FILES_REGION", "ap-southeast-2");
    vi.stubEnv("AWS_PRIVATE_FILES_ACCESS_KEY_ID", "AKIAEXAMPLEEXAMPLE00");
    vi.stubEnv("AWS_PRIVATE_FILES_SECRET_ACCESS_KEY", "x".repeat(40));
    vi.stubEnv("AWS_S3_BUCKET", "pub-bucket-test");
    try {
      const fakeRefs = async () => ({ refs: new Map(), tables: 0, columns: 0 });
      await runStorageReconcile({ bucket: "private" }, { ...depsFor("private"), collectReferences: fakeRefs });
      const priv = sent.filter(s => s.bucket === "priv-bucket-test");
      expect(priv).toHaveLength(6); // 3 prefix × 2 頁
      expect(priv.every(s => typeof s.prefix === "string" && P.includes(s.prefix))).toBe(true);
      expect(new Set(priv.map(s => s.prefix))).toEqual(new Set(P));
      sent.length = 0;
      await runStorageReconcile({ bucket: "public" }, { ...depsFor("public"), collectReferences: fakeRefs });
      expect(sent).toEqual([{ bucket: "pub-bucket-test", prefix: undefined, token: undefined }, { bucket: "pub-bucket-test", prefix: undefined, token: "p2" }]);
      const { privateStorageListObjectsPage } = await import("./privateStorage");
      for (const bad of ["", "chat-attachments", "../", "a/b/"]) await expect(privateStorageListObjectsPage(bad)).rejects.toThrow(/explicit top-level prefix/);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
