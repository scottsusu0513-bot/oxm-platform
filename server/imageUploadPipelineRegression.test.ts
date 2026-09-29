/**
 * 正常圖片上傳 pipeline 迴歸（Production Hardening Batch 3.1.1 Phase 2）。
 *
 * legacy data: URL 防護（shared/persistentImageUrl.ts）加在 updateFactory／
 * submitRevision／approveRevisionAtomic；這裡確認正常上傳完全不受影響：
 *   H. uploadAvatar：draft 直接寫入 S3 URL＋crop；approved 走 factory-avatars-temp/、不寫入正式欄位
 *   I. uploadCoverImage：寫入 S3 URL＋crop
 *   J. product.uploadImage：回傳 S3 URL
 * S3 以 vi.mock 取代（不打外部服務），驗證送進 storagePut 的 bytes 與上傳內容逐位元相同、
 * key 前綴不變。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const puts = vi.hoisted(() => [] as { key: string; bytes: Buffer; contentType: string }[]);
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storagePut: vi.fn(async (key: string, data: Buffer, contentType: string) => {
      puts.push({ key, bytes: Buffer.from(data), contentType });
      return { key, url: `https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/${key}` };
    }),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// 最小合法 JPEG 開頭（validateImageUpload 只檢查 magic bytes）
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`oxm-${runId}`)]);
const JPEG_B64 = `data:image/jpeg;base64,${JPEG.toString("base64")}`;
const ownerIds: number[] = [];
const factoryIds: number[] = [];

beforeEach(() => { puts.length = 0; });
afterAll(async () => {
  for (const id of factoryIds) await deleteTestFactory(id);
  for (const id of ownerIds) await deleteTestUser(id);
}, 60000);

async function setup(label: string, status: "approved" | "draft") {
  const ownerId = await ensureTestUser(`iupr-${label}-${runId}`, `上傳迴歸 ${label}`);
  ownerIds.push(ownerId);
  const id = await createTestFactory(ownerId, `上傳迴歸-${label}-${runId}`, status);
  factoryIds.push(id);
  const user = await db.getUserById(ownerId);
  const ctx = {
    user: { ...user!, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
  return { id, caller: appRouter.createCaller(ctx) };
}

describe("正常上傳 pipeline 不受 legacy data URL 防護影響", () => {
  it("H：draft 工廠上傳頭貼 → factory-avatars/ S3 URL＋crop 寫入正式欄位，bytes 逐位元相同", async () => {
    const { id, caller } = await setup("h-draft", "draft");
    const crop = { zoom: 1.5, posX: 30, posY: 70 };
    const r = await caller.factory.uploadAvatar({ base64: JPEG_B64, mimeType: "image/jpeg", factoryId: id, crop });
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toMatch(new RegExp(`^factory-avatars/${id}/[^/]+\\.jpg$`));
    expect(puts[0].bytes.equals(JPEG)).toBe(true);
    expect(puts[0].contentType).toBe("image/jpeg");
    const f = (await db.getFactoryById(id))!;
    expect(f.avatarUrl).toBe(r.url);
    expect(f.avatarUrl).toMatch(/^https:\/\//);
    expect(f.avatarCrop).toEqual(crop);
  });

  it("H：approved 工廠上傳頭貼 → factory-avatars-temp/，正式欄位不變（等修改申請）", async () => {
    const { id, caller } = await setup("h-approved", "approved");
    const before = (await db.getFactoryById(id))!.avatarUrl;
    const r = await caller.factory.uploadAvatar({ base64: JPEG_B64, mimeType: "image/jpeg", factoryId: id });
    expect(puts[0].key).toMatch(new RegExp(`^factory-avatars-temp/${id}/`));
    expect(r).toMatchObject({ savedToDb: false });
    expect((await db.getFactoryById(id))!.avatarUrl).toBe(before);
  });

  it("I：上傳封面 → factory-covers/ S3 URL＋crop 寫入", async () => {
    const { id, caller } = await setup("i", "draft");
    const crop = { zoom: 1, posX: 50, posY: 50 };
    const r = await caller.factory.uploadCoverImage({ base64: JPEG_B64, factoryId: id, crop });
    expect(puts[0].key).toMatch(new RegExp(`^factory-covers/${id}/`));
    expect(puts[0].bytes.equals(JPEG)).toBe(true);
    const f = (await db.getFactoryById(id))!;
    expect(f.coverImageUrl).toBe(r.url);
    expect(f.coverCrop).toEqual(crop);
  });

  it("J：商品圖片上傳 → product-images/ S3 URL", async () => {
    const { id, caller } = await setup("j", "draft");
    const r = await caller.product.uploadImage({ factoryId: id, base64: JPEG_B64, mimeType: "image/jpeg" });
    expect(puts[0].key).toMatch(new RegExp(`^product-images/${id}/`));
    expect(puts[0].bytes.equals(JPEG)).toBe(true);
    expect(r.url).toMatch(/^https:\/\/.*product-images\//);
  });
});

