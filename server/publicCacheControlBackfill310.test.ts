/**
 * Batch 3.10：既有公開物件 Cache-Control 補寫工具（不打外部服務）。
 */
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_IMMUTABLE_CACHE_CONTROL, type StorageObjectDetail } from "./storage";
import { factoryIdOfKey, planFingerprint, runCacheControlBackfill, type BackfillDeps } from "./publicCacheControlBackfill";
import { decideBackfillExitCode, parseBackfillArgs } from "./jobs/backfillPublicCacheControl";

const n21 = (c: string) => c.repeat(21).slice(0, 21);
const K = {
  a: `factory-photos/3/${n21("a")}.jpg`,
  b: `product-images/4/${n21("b")}.png`,
  c: `factory-avatars/5/${n21("c")}.webp`,
  done: `factory-covers/6/${n21("d")}.jpg`,
  test26: `factory-avatars/26/${n21("t")}.jpg`,
  svg: `factory-photos/7/${n21("s")}.jpg`,
  mpu: `factory-photos/8/${n21("m")}.jpg`,
  unref: `factory-photos/9/${n21("u")}.jpg`,
  odd: `weird/1/${n21("w")}.jpg`,
};

function detail(over: Partial<StorageObjectDetail> = {}): StorageObjectDetail {
  return { contentLength: 100, contentType: "image/jpeg", etag: "\"abc\"", cacheControl: null, contentDisposition: null, contentEncoding: null, contentLanguage: null, metadata: {}, serverSideEncryption: "AES256", storageClass: null, versionId: null, ...over };
}

function setup(opts: { brokenRewrite?: boolean; publicStatus?: number; versioned?: boolean } = {}) {
  const store = new Map<string, StorageObjectDetail>([
    [K.a, detail()], [K.b, detail({ contentType: "image/png", etag: "\"b\"" })], [K.c, detail({ contentType: "image/webp", etag: "\"c\"" })],
    [K.done, detail({ cacheControl: PUBLIC_IMMUTABLE_CACHE_CONTROL, etag: "\"d\"" })],
    [K.test26, detail({ etag: "\"t\"" })], [K.svg, detail({ contentType: "image/svg+xml", etag: "\"s\"" })],
    [K.mpu, detail({ etag: "\"m-2\"" })], [K.unref, detail({ etag: "\"u\"" })], [K.odd, detail({ etag: "\"w\"" })],
  ]);
  const rewrites: string[] = [];
  const deps: BackfillDeps = {
    listPage: async () => ({ objects: Array.from(store.entries()).map(([key, d]) => ({ key, size: d.contentLength, lastModified: new Date(0) })) }),
    collectReferences: async () => ({ refs: new Map(Object.values(K).filter(k => k !== K.unref).map(k => [k, new Set(["CURRENT" as const])])) }),
    head: async (key) => { const d = store.get(key); return d ? { ...d, metadata: { ...d.metadata } } : null; },
    rewrite: async (key, current, cacheControl) => {
      rewrites.push(key);
      store.set(key, { ...current, cacheControl, contentType: opts.brokenRewrite ? "application/octet-stream" : current.contentType });
      return { versionId: opts.versioned ? "v-123" : null };
    },
    publicHead: async (key) => ({ status: opts.publicStatus ?? 200, cacheControl: store.get(key)?.cacheControl ?? null }),
  };
  return { deps, store, rewrites };
}

describe("Cache-Control 補寫：只處理被引用、格式正確、可安全驗證的物件", () => {
  it("dry-run：分類正確、不改任何物件；未被引用與格式不符的 key 不在目標內", async () => {
    const s = setup();
    const r = await runCacheControlBackfill({}, s.deps);
    expect(s.rewrites).toEqual([]);
    expect(r).toMatchObject({ mode: "dry-run", listed: 9, referencedTargets: 7, alreadyDone: 1, pending: 3, pendingBytes: 300 });
    expect(r.excluded).toEqual({ protected_test_factory: 1, unsupported_content_type: 1, multipart_etag: 1 });
    expect(decideBackfillExitCode(r)).toBe(0);
  });

  it("apply 沒有或錯誤的指紋 → 中止、不改寫", async () => {
    for (const fp of [undefined, "0".repeat(64)]) {
      const s = setup();
      const r = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp }, s.deps);
      expect(r.aborted).toBe("approval_mismatch");
      expect(s.rewrites).toEqual([]);
    }
  });

  it("分批：maxBatch 限制每次數量；內容 ETag 不變所以指紋在批次間不變；全部完成後再跑為 no-op（冪等）", async () => {
    const s = setup({ versioned: true });
    const fp = (await runCacheControlBackfill({}, s.deps)).fingerprint;
    const r1 = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 2 }, s.deps);
    expect(r1).toMatchObject({ processed: 2, rewritten: 2, failed: 0, versionIdsReturned: 2 });
    const r2 = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 2 }, s.deps);
    expect(r2).toMatchObject({ fingerprint: fp, pending: 1, processed: 1, rewritten: 1, failed: 0 });
    const r3 = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 2 }, s.deps);
    expect(r3).toMatchObject({ pending: 0, processed: 0, alreadyDone: 4 });
    expect(s.rewrites.sort()).toEqual([K.a, K.b, K.c].sort());
    expect(s.store.get(K.test26)!.cacheControl).toBeNull(); // #26 永遠不碰
    expect(s.store.get(K.unref)!.cacheControl).toBeNull();
    expect(s.store.get(K.b)!.contentType).toBe("image/png");
  });

  it("規劃後物件被改過（ETag 不同）→ 不改寫、記為失敗", async () => {
    const s = setup();
    const fp = (await runCacheControlBackfill({}, s.deps)).fingerprint;
    const orig = s.deps.head;
    let headsOfA = 0;
    // apply 的第一次 HEAD 是規劃、第二次是改寫前的重新確認：讓第二次看到不同的 ETag
    s.deps.head = async (key) => { const d = await orig(key); if (key !== K.a) return d; headsOfA++; return headsOfA >= 2 && d ? { ...d, etag: "\"changed\"" } : d; };
    const r = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 10 }, s.deps);
    expect(r.failureReasons).toMatchObject({ changed_since_plan: 1 });
    expect(s.rewrites).not.toContain(K.a);
    expect(decideBackfillExitCode(r)).toBe(1);
  });

  it("改寫後驗證不符（例如 Content-Type 被重設）→ 記為失敗", async () => {
    const s = setup({ brokenRewrite: true });
    const fp = (await runCacheControlBackfill({}, s.deps)).fingerprint;
    const r = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 10 }, s.deps);
    expect(r).toMatchObject({ rewritten: 0, failed: 3, failureReasons: { post_verify_mismatch: 3 } });
  });

  it("公開網址匿名讀取失敗 → 記為失敗", async () => {
    const s = setup({ publicStatus: 403 });
    const fp = (await runCacheControlBackfill({}, s.deps)).fingerprint;
    const r = await runCacheControlBackfill({ apply: true, approvedFingerprint: fp, maxBatch: 1 }, s.deps);
    expect(r.failureReasons).toEqual({ public_read_check_failed: 1 });
  });

  it("指紋只由 key＋ETag＋大小決定，與順序無關", () => {
    const e = [{ key: "a", etag: "x", size: 1 }, { key: "b", etag: "y", size: 2 }];
    expect(planFingerprint(e)).toBe(planFingerprint([...e].reverse()));
    expect(planFingerprint(e)).not.toBe(planFingerprint([{ ...e[0], etag: "z" }, e[1]]));
  });

  it("factoryIdOfKey 只辨識工廠範圍的 prefix", () => {
    expect(factoryIdOfKey(`factory-avatars/26/x.jpg`)).toBe(26);
    expect(factoryIdOfKey(`product-images/26/x.jpg`)).toBe(26);
    expect(factoryIdOfKey(`community-posts/26/x.jpg`)).toBeNull();
    expect(factoryIdOfKey(`news-covers/26/x.jpg`)).toBeNull();
  });

  it("CLI 參數", () => {
    expect(parseBackfillArgs([])).toMatchObject({ apply: false, maxBatch: 25, excludeFactoryIds: [] });
    expect(() => parseBackfillArgs(["--apply"])).toThrow(/--approve/);
    expect(() => parseBackfillArgs(["--max-batch=0"])).toThrow(/max-batch/);
    expect(() => parseBackfillArgs(["--max-batch=201"])).toThrow(/max-batch/);
    expect(parseBackfillArgs(["--apply", `--approve=${"f".repeat(64)}`, "--max-batch=10", "--exclude-factory=7"])).toMatchObject({ apply: true, maxBatch: 10, excludeFactoryIds: [7] });
  });
});

describe("storageRewriteCacheControl：真實 CopyObject 參數（S3 client 被攔截）", () => {
  it("同 key、REPLACE、綁定 ETag，並帶回 Content-Type／metadata／加密", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const { storageRewriteCacheControl } = await vi.importActual<typeof import("./storage")>("./storage");
    vi.stubEnv("AWS_S3_BUCKET", "pub-bucket-test");
    const spy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ VersionId: "v1" } as never);
    try {
      const r = await storageRewriteCacheControl("factory-photos/3/a b.jpg", detail({ contentType: "image/png", metadata: { origin: "x" }, contentDisposition: "inline" }), PUBLIC_IMMUTABLE_CACHE_CONTROL);
      expect(r).toEqual({ versionId: "v1" });
      const input = (spy.mock.calls[0][0] as { input: Record<string, unknown> }).input;
      expect(input).toMatchObject({
        Bucket: "pub-bucket-test", Key: "factory-photos/3/a b.jpg", CopySource: "pub-bucket-test/factory-photos/3/a%20b.jpg",
        CopySourceIfMatch: "\"abc\"", MetadataDirective: "REPLACE", ContentType: "image/png", CacheControl: PUBLIC_IMMUTABLE_CACHE_CONTROL,
        ContentDisposition: "inline", Metadata: { origin: "x" }, ServerSideEncryption: "AES256",
      });
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
