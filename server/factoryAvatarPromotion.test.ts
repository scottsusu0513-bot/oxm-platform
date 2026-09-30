/**
 * promoteTemporaryFactoryAvatar（Batch 3.3.1）——用記憶體假 S3 決定性驗證每一條分支。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promoteTemporaryFactoryAvatar, FactoryAvatarPromotionError, type FactoryAvatarStorage } from "./factoryAvatarPromotion";
import type { StorageObjectHead } from "./storage";

const BASE = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/";
const SRC_KEY = "factory-avatars-temp/17/eNd28PS8wBpOe8PUV-46g.jpg";
const DST_KEY = "factory-avatars/17/eNd28PS8wBpOe8PUV-46g.jpg";
const SRC_URL = `${BASE}${SRC_KEY}`;
const JPEG: StorageObjectHead = { contentLength: 322519, contentType: "image/jpeg", etag: '"3ea921c89df6e5a940f0bb6f28b35acb"' };

function fakeStorage(initial: Record<string, StorageObjectHead>, opts: { failCopy?: boolean; copyAltersHead?: Partial<StorageObjectHead>; headThrowsFor?: string } = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { copy: [] as [string, string][] };
  const storage: FactoryAvatarStorage = {
    head: async (key) => {
      if (opts.headThrowsFor === key) throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
      return store.get(key) ?? null;
    },
    copy: async (from, to) => {
      calls.copy.push([from, to]);
      if (opts.failCopy) throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
      const src = store.get(from)!;
      store.set(to, { ...src, ...(opts.copyAltersHead ?? {}) });
    },
  };
  return { storage, store, calls };
}
const run = (s: FactoryAvatarStorage, url = SRC_URL, factoryId = 17) => promoteTemporaryFactoryAvatar({ factoryId, temporaryAvatarUrl: url }, s);
const reason = async (p: Promise<unknown>) => { try { await p; return "resolved"; } catch (e) { return e instanceof FactoryAvatarPromotionError ? e.reason : `other:${(e as Error).message}`; } };

beforeEach(() => {
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
});
afterEach(() => vi.unstubAllEnvs());

describe("promoteTemporaryFactoryAvatar", () => {
  it("A：來源存在、目標不存在 → CopyObject → 驗證 → 回傳正式網址（同一個檔名）", async () => {
    const { storage, store, calls } = fakeStorage({ [SRC_KEY]: JPEG });
    expect(await run(storage)).toBe(`${BASE}${DST_KEY}`);
    expect(calls.copy).toEqual([[SRC_KEY, DST_KEY]]);
    expect(store.get(DST_KEY)).toEqual(JPEG);
    expect(store.has(SRC_KEY)).toBe(true); // 來源保留，不刪除
  });

  it("B：目標已存在且大小／ETag／Content-Type 相同 → 不覆蓋，直接沿用（重試冪等）", async () => {
    const { storage, calls } = fakeStorage({ [SRC_KEY]: JPEG, [DST_KEY]: { ...JPEG } });
    expect(await run(storage)).toBe(`${BASE}${DST_KEY}`);
    expect(calls.copy).toHaveLength(0);
  });

  it("C：目標已存在但內容不同 → destination_collision，不覆蓋", async () => {
    for (const other of [{ ...JPEG, etag: '"ffffffffffffffffffffffffffffffff"' }, { ...JPEG, contentLength: 1 }, { ...JPEG, contentType: "image/png" }]) {
      const { storage, calls } = fakeStorage({ [SRC_KEY]: JPEG, [DST_KEY]: other });
      expect(await reason(run(storage))).toBe("destination_collision");
      expect(calls.copy).toHaveLength(0);
    }
  });

  it("C：ETag 無法比較（multipart 形式）時，目標已存在一律 fail closed", async () => {
    const multipart = { ...JPEG, etag: '"abc-2"' };
    const { storage } = fakeStorage({ [SRC_KEY]: multipart, [DST_KEY]: { ...multipart } });
    expect(await reason(run(storage))).toBe("destination_collision");
  });

  it("D：來源不存在 → source_missing，不複製", async () => {
    const { storage, calls } = fakeStorage({});
    expect(await reason(run(storage))).toBe("source_missing");
    expect(calls.copy).toHaveLength(0);
  });

  it("E：來源不是圖片／大小為 0 → 失敗", async () => {
    expect(await reason(run(fakeStorage({ [SRC_KEY]: { ...JPEG, contentType: "application/octet-stream" } }).storage))).toBe("invalid_content_type");
    expect(await reason(run(fakeStorage({ [SRC_KEY]: { ...JPEG, contentType: null } }).storage))).toBe("invalid_content_type");
    expect(await reason(run(fakeStorage({ [SRC_KEY]: { ...JPEG, contentLength: 0 } }).storage))).toBe("invalid_source_object");
  });

  it("F：CopyObject 失敗 → copy_failed", async () => {
    expect(await reason(run(fakeStorage({ [SRC_KEY]: JPEG }, { failCopy: true }).storage))).toBe("copy_failed");
  });

  it("G：HEAD 權限／網路錯誤 → 直接拋出（不當成「不存在」而誤判）", async () => {
    expect(await reason(run(fakeStorage({ [SRC_KEY]: JPEG }, { headThrowsFor: DST_KEY }).storage))).toBe("other:AccessDenied");
  });

  it("H：複製後驗證不符（大小或 Content-Type）→ verification_failed", async () => {
    expect(await reason(run(fakeStorage({ [SRC_KEY]: JPEG }, { copyAltersHead: { contentLength: 5 } }).storage))).toBe("verification_failed");
    expect(await reason(run(fakeStorage({ [SRC_KEY]: JPEG }, { copyAltersHead: { contentType: "application/octet-stream" } }).storage))).toBe("verification_failed");
  });

  it("來源網址不合法（其他工廠／其他 host）→ invalid_source_url，完全不碰 S3", async () => {
    const { storage, calls } = fakeStorage({ [SRC_KEY]: JPEG });
    const headSpy = vi.spyOn(storage, "head");
    expect(await reason(run(storage, SRC_URL, 18))).toBe("invalid_source_url");
    expect(await reason(run(storage, `https://example.com/${SRC_KEY}`))).toBe("invalid_source_url");
    expect(headSpy).not.toHaveBeenCalled();
    expect(calls.copy).toHaveLength(0);
  });
});
