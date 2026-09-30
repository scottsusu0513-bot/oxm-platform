/**
 * 暫存頭貼網址 parser（Batch 3.3.1）——它決定 CopyObject 的來源 key，只能接受
 * 本系統公開圖片 bucket 的 factory-avatars-temp/{同一間工廠}/{檔名}。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  looksLikeTemporaryFactoryAvatarUrl,
  parseTemporaryFactoryAvatarUrl,
  persistentFactoryAvatarKey,
  publicImageUrl,
} from "./factoryAvatarUrl";

const BASE = "https://oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/";

beforeEach(() => {
  vi.stubEnv("AWS_S3_PUBLIC_BASE_URL", "");
  vi.stubEnv("AWS_S3_BUCKET", "oxm-images-prod-2026");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
});
afterEach(() => vi.unstubAllEnvs());

describe("parseTemporaryFactoryAvatarUrl", () => {
  it("合法：本 bucket 的 factory-avatars-temp/{同一間工廠}/{nanoid}.jpg", () => {
    expect(parseTemporaryFactoryAvatarUrl(`${BASE}factory-avatars-temp/17/eNd28PS8wBpOe8PUV-46g.jpg`, 17)).toEqual({
      sourceKey: "factory-avatars-temp/17/eNd28PS8wBpOe8PUV-46g.jpg",
      filename: "eNd28PS8wBpOe8PUV-46g.jpg",
    });
    expect(parseTemporaryFactoryAvatarUrl(`${BASE}factory-avatars-temp/40/C6DjPeYstz1XqoRtr1G6B.png`, 40)?.filename).toBe("C6DjPeYstz1XqoRtr1G6B.png");
  });

  const rejected: [string, string, number][] = [
    ["不同 factoryId", `${BASE}factory-avatars-temp/18/abc.jpg`, 17],
    ["其他 bucket", "https://evil-bucket.s3.ap-southeast-2.amazonaws.com/factory-avatars-temp/17/abc.jpg", 17],
    ["其他 host", "https://example.com/factory-avatars-temp/17/abc.jpg", 17],
    ["http", `${BASE.replace("https", "http")}factory-avatars-temp/17/abc.jpg`, 17],
    ["正式網址", `${BASE}factory-avatars/17/abc.jpg`, 17],
    ["其他 prefix", `${BASE}factory-covers/17/abc.jpg`, 17],
    ["../ traversal", `${BASE}factory-avatars-temp/17/../18/abc.jpg`, 17],
    ["多層路徑", `${BASE}factory-avatars-temp/17/sub/abc.jpg`, 17],
    ["encoded traversal", `${BASE}factory-avatars-temp/17/%2e%2e%2fabc.jpg`, 17],
    ["encoded slash", `${BASE}factory-avatars-temp%2F17%2Fabc.jpg`, 17],
    ["空檔名", `${BASE}factory-avatars-temp/17/`, 17],
    ["query string", `${BASE}factory-avatars-temp/17/abc.jpg?x=1`, 17],
    ["fragment", `${BASE}factory-avatars-temp/17/abc.jpg#x`, 17],
    ["非預期副檔名", `${BASE}factory-avatars-temp/17/abc.svg`, 17],
    ["檔名含非法字元", `${BASE}factory-avatars-temp/17/a b.jpg`, 17],
    ["malformed", "not a url", 17],
    ["帳密 userinfo", "https://user:pw@oxm-images-prod-2026.s3.ap-southeast-2.amazonaws.com/factory-avatars-temp/17/abc.jpg", 17],
    ["factoryId 非法", `${BASE}factory-avatars-temp/0/abc.jpg`, 0],
    ["data URL", "data:image/jpeg;base64,AAAA", 17],
  ];
  it.each(rejected)("拒絕：%s", (_label, url, fid) => {
    expect(parseTemporaryFactoryAvatarUrl(url, fid)).toBeNull();
  });

  it("非字串一律拒絕", () => {
    for (const v of [null, undefined, 17, {}, []]) expect(parseTemporaryFactoryAvatarUrl(v, 17)).toBeNull();
  });
});

describe("looksLikeTemporaryFactoryAvatarUrl（寬鬆偵測，給核准流程 fail closed）", () => {
  it("任何 host／編碼寫法只要指向 factory-avatars-temp 都算", () => {
    for (const v of [`${BASE}factory-avatars-temp/17/a.jpg`, "https://example.com/factory-avatars-temp/1/a.jpg", `${BASE}factory-avatars-temp%2F17%2Fa.jpg`]) {
      expect(looksLikeTemporaryFactoryAvatarUrl(v)).toBe(true);
    }
    for (const v of [`${BASE}factory-avatars/17/a.jpg`, null, "", "data:image/png;base64,AA"]) {
      expect(looksLikeTemporaryFactoryAvatarUrl(v)).toBe(false);
    }
  });
});

describe("正式 key", () => {
  it("同一個檔名搬到 factory-avatars/{factoryId}/，網址與 storage.ts 相同規則", () => {
    expect(persistentFactoryAvatarKey(17, "eNd28PS8wBpOe8PUV-46g.jpg")).toBe("factory-avatars/17/eNd28PS8wBpOe8PUV-46g.jpg");
    expect(publicImageUrl("factory-avatars/17/x.jpg")).toBe(`${BASE}factory-avatars/17/x.jpg`);
  });
});
