/**
 * Batch 3.10：一次性超大頭貼正規化（server/avatarMigration.ts）。
 * 圖片用 sharp 實際產生／處理；S3 與 DB 存取用 in-memory 假實作，條件式 UPDATE 另以本機測試 DB 驗證。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import * as db from "./db";
import {
  AVATAR_MIGRATION_FACTORY_IDS,
  rollbackAvatar,
  runAvatarMigration,
  sharpImageOps,
  formatAvatarMigrationReport,
  type AvatarMigrationDeps,
} from "./avatarMigration";
import { publicImageUrl } from "./factoryAvatarUrl";
import { PUBLIC_IMMUTABLE_CACHE_CONTROL } from "./storage";
import { parseAvatarMigrationArgs } from "./jobs/migrateOversizedAvatars";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

beforeAll(() => {
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
});
afterAll(() => { vi.unstubAllEnvs(); });

const solid = (w: number, h: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width: w, height: h, channels, background: channels === 4 ? { r: 0, g: 120, b: 200, alpha: 0.4 } : { r: 200, g: 30, b: 30 } } });
// 隨機像素：無法再壓縮（>1MB、尺寸在限制內，重新壓縮也不會明顯變小）
const noisyPng = async (w: number, h: number) => sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

type Obj = { bytes: Buffer; contentType: string; cacheControl: string | null };
async function fixture() {
  const ops = await sharpImageOps();
  const key = (fid: number, name: string, ext: string) => `factory-avatars/${fid}/${name.padEnd(21, "x")}.${ext}`;
  const images: Record<number, { key: string; bytes: Buffer; ct: string }> = {
    46: { key: key(46, "bigjpeg", "jpg"), bytes: await solid(2400, 1600).jpeg().toBuffer(), ct: "image/jpeg" },
    50: { key: key(50, "alphapng", "png"), bytes: await solid(1600, 1600, 4).png().toBuffer(), ct: "image/png" },
    60: { key: key(60, "rotated", "jpg"), bytes: await solid(2000, 1000).jpeg().withMetadata({ orientation: 6 }).toBuffer(), ct: "image/jpeg" },
    47: { key: key(47, "small", "jpg"), bytes: await solid(800, 600).jpeg().toBuffer(), ct: "image/jpeg" },
    37: { key: key(37, "noisy", "png"), bytes: await noisyPng(1000, 1000), ct: "image/png" },
  };
  const factories = new Map<number, string | null>(Object.entries(images).map(([id, v]) => [Number(id), publicImageUrl(v.key)]));
  factories.set(31, "https://external.example.com/a.jpg");
  factories.set(26, publicImageUrl(key(26, "test", "jpg")));
  const objects = new Map<string, Obj>(Object.values(images).map(v => [v.key, { bytes: v.bytes, contentType: v.ct, cacheControl: null }]));
  const originals = new Map(Array.from(objects.entries()).map(([k, o]) => [k, Buffer.from(o.bytes)]));
  const calls = { getFactory: [] as number[], updates: [] as { id: number; from: string; to: string }[], puts: [] as string[] };
  let seq = 0;
  const deps: AvatarMigrationDeps = {
    ...ops,
    getFactoryAvatarUrl: async (id) => { calls.getFactory.push(id); return { exists: factories.has(id), avatarUrl: factories.get(id) ?? null }; },
    getObject: async (k) => objects.get(k)?.bytes ?? null,
    headObject: async (k) => { const o = objects.get(k); return o ? { contentLength: o.bytes.length, contentType: o.contentType, cacheControl: o.cacheControl } : null; },
    putObject: async (k, bytes, ct) => { calls.puts.push(k); objects.set(k, { bytes, contentType: ct, cacheControl: PUBLIC_IMMUTABLE_CACHE_CONTROL }); },
    publicGet: async (k) => { const o = objects.get(k); return o ? { status: 200, bytes: o.bytes, cacheControl: o.cacheControl } : { status: 403, bytes: null, cacheControl: null }; },
    conditionalUpdate: async (id, from, to) => { if (factories.get(id) !== from) return false; factories.set(id, to); calls.updates.push({ id, from, to }); return true; },
    newId: () => `new${String(++seq).padStart(18, "0")}`,
    publicUrl: publicImageUrl,
  };
  return { deps, factories, objects, originals, images, calls };
}
const ids = [46, 50, 60, 47, 37, 31, 26];

describe("目標範圍", () => {
  it("預設只有 Phase 2 確認的 9 間工廠；#26 與只被備份表引用的工廠 1 不在其中", () => {
    expect([...AVATAR_MIGRATION_FACTORY_IDS].sort((a, b) => a - b)).toEqual([15, 30, 31, 37, 46, 47, 50, 51, 60]);
    expect(AVATAR_MIGRATION_FACTORY_IDS).not.toContain(26);
    expect(AVATAR_MIGRATION_FACTORY_IDS).not.toContain(1);
  });
});

describe("dry-run：只規劃，不寫入", () => {
  it("分類正確；#26 硬性排除且完全不讀取；外部網址、已在限制內、壓不下來的都不處理", async () => {
    const f = await fixture();
    const r = await runAvatarMigration({ factoryIds: ids }, f.deps);
    const st = Object.fromEntries(r.plan.map(p => [p.factoryId, p.status]));
    expect(st).toEqual({ 46: "planned", 50: "planned", 60: "planned", 47: "already_within_limits", 37: "no_benefit", 31: "not_platform_avatar", 26: "blocked_test_factory" });
    expect(f.calls.getFactory).not.toContain(26);
    expect(f.calls.puts).toEqual([]);
    expect(f.calls.updates).toEqual([]);
    expect(r.totals.planned).toBe(3);
    expect(formatAvatarMigrationReport(r)).not.toMatch(/amazonaws|factory-avatars\//);
  });
});

describe("apply", () => {
  it("沒有或錯誤的指紋 → 中止，不寫入", async () => {
    const f = await fixture();
    const r = await runAvatarMigration({ factoryIds: ids, apply: true, approvedFingerprint: "0".repeat(64) }, f.deps);
    expect(r.aborted).toBe("approval_mismatch");
    expect(f.calls.puts).toEqual([]);
  });

  it("縮圖到最長邊 1024、維持比例與格式、PNG 保留透明、依 EXIF 轉正；新 key＋immutable；舊物件不動；DB 只切換規劃的工廠", async () => {
    const f = await fixture();
    const fp = (await runAvatarMigration({ factoryIds: ids }, f.deps)).fingerprint;
    const r = await runAvatarMigration({ factoryIds: ids, apply: true, approvedFingerprint: fp }, f.deps);
    expect(r.results.map(x => [x.factoryId, x.status])).toEqual([[46, "migrated"], [50, "migrated"], [60, "migrated"]]);
    for (const x of r.results) {
      const newKey = x.newUrl!.slice(publicImageUrl("").length);
      expect(newKey).toMatch(new RegExp(`^factory-avatars/${x.factoryId}/new[0-9]{18}\\.(jpg|png)$`));
      expect(newKey).not.toBe(f.images[x.factoryId].key);
      expect(f.objects.get(newKey)!.cacheControl).toBe(PUBLIC_IMMUTABLE_CACHE_CONTROL);
      expect(f.factories.get(x.factoryId)).toBe(x.newUrl);
      expect(f.objects.get(f.images[x.factoryId].key)!.bytes.equals(f.originals.get(f.images[x.factoryId].key)!)).toBe(true); // 舊物件逐位元不變
    }
    const meta = async (id: number) => sharp(f.objects.get(f.factories.get(id)!.slice(publicImageUrl("").length))!.bytes).metadata();
    expect(await meta(46)).toMatchObject({ format: "jpeg", width: 1024, height: 683 });
    expect(await meta(50)).toMatchObject({ format: "png", width: 1024, height: 1024, hasAlpha: true });
    expect(await meta(60)).toMatchObject({ format: "jpeg", width: 512, height: 1024 }); // 2000×1000＋orientation 6 → 顯示為 1000×2000
    expect(f.factories.get(47)).toBe(publicImageUrl(f.images[47].key)); // 小圖不放大、不換
    expect(f.factories.get(26)).toBe(publicImageUrl("factory-avatars/26/".concat("test".padEnd(21, "x"), ".jpg")));
    expect(f.calls.updates).toHaveLength(3);
    const out = formatAvatarMigrationReport(r);
    expect(out.match(/^ROLLBACK /gm)).toHaveLength(3);

    // 冪等：再跑一次，已遷移的頭貼都在限制內，沒有新的目標
    const again = await runAvatarMigration({ factoryIds: ids }, f.deps);
    expect(again.totals.planned).toBe(0);
    expect(again.plan.find(p => p.factoryId === 46)!.status).toBe("already_within_limits");
  });

  it("上傳後驗證不通過 → 不切換 DB（新物件留給對帳）", async () => {
    const f = await fixture();
    const fp = (await runAvatarMigration({ factoryIds: [46] }, f.deps)).fingerprint;
    f.deps.putObject = async (k, bytes) => { f.calls.puts.push(k); f.objects.set(k, { bytes, contentType: "application/octet-stream", cacheControl: null }); };
    const r = await runAvatarMigration({ factoryIds: [46], apply: true, approvedFingerprint: fp }, f.deps);
    expect(r.results[0].status).toBe("verify_failed");
    expect(f.calls.updates).toEqual([]);
    expect(f.factories.get(46)).toBe(publicImageUrl(f.images[46].key));
  });

  it("規劃後頭貼被改過 → conflict，不上傳也不切換；條件式 UPDATE 0 列 → conflict", async () => {
    const f = await fixture();
    const fp = (await runAvatarMigration({ factoryIds: [46, 50] }, f.deps)).fingerprint;
    const orig = f.deps.getFactoryAvatarUrl;
    let n46 = 0;
    f.deps.getFactoryAvatarUrl = async (id) => { const v = await orig(id); if (id === 46 && ++n46 >= 2) return { ...v, avatarUrl: "https://changed.example/x.jpg" }; return v; };
    f.deps.conditionalUpdate = async () => false;
    const r = await runAvatarMigration({ factoryIds: [46, 50], apply: true, approvedFingerprint: fp }, f.deps);
    expect(r.results.map(x => [x.factoryId, x.status])).toEqual([[46, "conflict"], [50, "conflict"]]);
    expect(f.calls.puts.filter(k => k.startsWith("factory-avatars/46/"))).toEqual([]);
    expect(f.factories.get(50)).toBe(publicImageUrl(f.images[50].key));
  });

  it("新 key 已存在 → 不覆寫", async () => {
    const f = await fixture();
    const fp = (await runAvatarMigration({ factoryIds: [46] }, f.deps)).fingerprint;
    f.deps.newId = () => "collide".padEnd(21, "z");
    f.objects.set(`factory-avatars/46/${"collide".padEnd(21, "z")}.jpg`, { bytes: Buffer.from("keep"), contentType: "image/jpeg", cacheControl: null });
    const r = await runAvatarMigration({ factoryIds: [46], apply: true, approvedFingerprint: fp }, f.deps);
    expect(r.results[0].status).toBe("key_collision");
    expect(f.objects.get(`factory-avatars/46/${"collide".padEnd(21, "z")}.jpg`)!.bytes.toString()).toBe("keep");
  });
});

describe("回復", () => {
  it("條件式指回舊網址；來源不符 → conflict；#26 → blocked；目標物件不存在或不屬於該工廠 → invalid_target", async () => {
    const f = await fixture();
    const fp = (await runAvatarMigration({ factoryIds: [46] }, f.deps)).fingerprint;
    const r = await runAvatarMigration({ factoryIds: [46], apply: true, approvedFingerprint: fp }, f.deps);
    const { newUrl, oldUrl } = r.results[0];
    expect(await rollbackAvatar({ factoryId: 46, fromUrl: "https://x/y.jpg", toUrl: oldUrl! }, f.deps)).toBe("invalid_target");
    expect(await rollbackAvatar({ factoryId: 46, fromUrl: oldUrl!, toUrl: oldUrl! }, f.deps)).toBe("conflict");
    expect(await rollbackAvatar({ factoryId: 26, fromUrl: newUrl!, toUrl: oldUrl! }, f.deps)).toBe("blocked");
    expect(await rollbackAvatar({ factoryId: 46, fromUrl: newUrl!, toUrl: publicImageUrl("factory-avatars/46/missing0000000000000.jpg") }, f.deps)).toBe("invalid_target");
    expect(await rollbackAvatar({ factoryId: 46, fromUrl: newUrl!, toUrl: oldUrl! }, f.deps)).toBe("rolled_back");
    expect(f.factories.get(46)).toBe(oldUrl);
  });
});

describe("CLI 參數", () => {
  it("dry-run 預設；--apply 需要指紋；--rollback 需要完整參數", () => {
    expect(parseAvatarMigrationArgs([])).toEqual({ mode: "plan", apply: false, approvedFingerprint: undefined });
    expect(() => parseAvatarMigrationArgs(["--apply"])).toThrow(/--approve/);
    expect(() => parseAvatarMigrationArgs(["--rollback", "--factory=46"])).toThrow(/--rollback/);
    expect(parseAvatarMigrationArgs(["--rollback", "--factory=46", "--from=a", "--to=b"])).toEqual({ mode: "rollback", factoryId: 46, fromUrl: "a", toUrl: "b" });
  });
});

describe("conditionalUpdateFactoryAvatarUrl（本機測試 DB）", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const userIds: number[] = [];
  const factoryIds: number[] = [];
  const run = async (q: ReturnType<typeof sql>) => ((await (await db.getDb())!.execute(q)) as unknown as [any, unknown])[0];
  afterAll(async () => {
    for (const f of factoryIds) { await run(sql`DELETE FROM factoryRevisions WHERE factoryId = ${f}`); await deleteTestFactory(f); }
    for (const u of userIds) await deleteTestUser(u);
  }, 60000);

  it("只在 avatarUrl 仍是預期值時更新；不動 avatarCrop、修改申請歷史；#26 拒絕", async () => {
    const owner = await ensureTestUser(`am310-${runId}`, "AM310");
    userIds.push(owner);
    const id = await createTestFactory(owner, `AM310 ${runId}`);
    factoryIds.push(id);
    const oldUrl = `https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-avatars/${id}/old.jpg`;
    const newUrl = `https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-avatars/${id}/new.jpg`;
    await run(sql`UPDATE factories SET avatarUrl = ${oldUrl}, avatarCrop = ${JSON.stringify({ zoom: 1.5, posX: 30, posY: 70 })} WHERE id = ${id}`);
    await run(sql`INSERT INTO factoryRevisions (factoryId, submittedBy, status, originalData, proposedData) VALUES (${id}, ${owner}, 'approved', ${JSON.stringify({ avatarUrl: oldUrl })}, ${JSON.stringify({ avatarUrl: oldUrl })})`);

    expect(await db.conditionalUpdateFactoryAvatarUrl(id, "https://not-current/x.jpg", newUrl)).toBe(false);
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(oldUrl);
    expect(await db.conditionalUpdateFactoryAvatarUrl(id, oldUrl, newUrl)).toBe(true);
    const f = (await db.getFactoryById(id))!;
    expect(f.avatarUrl).toBe(newUrl);
    expect(f.avatarCrop).toEqual({ zoom: 1.5, posX: 30, posY: 70 });
    const [rev] = await run(sql`SELECT proposedData FROM factoryRevisions WHERE factoryId = ${id}`);
    const proposed = typeof rev.proposedData === "string" ? JSON.parse(rev.proposedData) : rev.proposedData;
    expect(proposed.avatarUrl).toBe(oldUrl);
    await expect(db.conditionalUpdateFactoryAvatarUrl(26, oldUrl, newUrl)).rejects.toThrow(/protected/);
  }, 60000);
});
