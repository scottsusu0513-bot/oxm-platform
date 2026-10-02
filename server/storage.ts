import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { publicImageUrl } from "./factoryAvatarUrl";

function getClient(): S3Client {
  return new S3Client({
    // Batch 3.9：S3 連線／請求上限，儲存服務卡住時上傳與下載不會無限等待
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    region: process.env.AWS_REGION ?? "ap-southeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
}

/**
 * 公開圖片的 key 一律是 nanoid 產生、內容永不改寫（換圖就是換新 key），可以讓瀏覽器
 * 與 CDN 長期快取（Batch 3.10；原本完全沒有 Cache-Control）。
 */
export const PUBLIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// 公開網址規則集中在 factoryAvatarUrl.ts（頭貼搬移的 parser 也用同一套），行為不變。
function getPublicUrl(key: string): string {
  return publicImageUrl(key);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");

  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: relKey,
        Body: body,
        ContentType: contentType,
        CacheControl: PUBLIC_IMMUTABLE_CACHE_CONTROL,
      })
    );
  } catch (err) {
    console.error("[S3] upload failed:", err);
    throw err;
  }

  return { key: relKey, url: getPublicUrl(relKey) };
}

export async function storageDelete(relKey: string): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) return;

  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: relKey })
    );
  } catch (err) {
    console.error("[S3] delete failed:", err);
    throw err;
  }
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (bucket) {
    try {
      await getClient().send(
        new HeadObjectCommand({ Bucket: bucket, Key: relKey })
      );
    } catch {
      // object may not exist, return url anyway
    }
  }
  return { key: relKey, url: getPublicUrl(relKey) };
}

export type StorageListedObject = { key: string; size: number; lastModified: Date };

/** ListObjectsV2 一頁（最多 1000 筆）；儲存空間對帳（server/storageReconcile.ts）用，唯讀。 */
export async function storageListObjectsPage(continuationToken?: string): Promise<{ objects: StorageListedObject[]; nextToken?: string }> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  const r = await getClient().send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken, MaxKeys: 1000 }));
  return {
    objects: (r.Contents ?? []).filter(o => o.Key).map(o => ({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) })),
    nextToken: r.IsTruncated ? r.NextContinuationToken : undefined,
  };
}

export type StorageObjectHead = { contentLength: number; contentType: string | null; etag: string | null };

/** HeadObject：物件不存在回傳 null；其他錯誤（權限、網路）照常拋出，不當成「不存在」。 */
export async function storageHead(relKey: string): Promise<StorageObjectHead | null> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  try {
    const h = await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: relKey }));
    return { contentLength: h.ContentLength ?? 0, contentType: h.ContentType ?? null, etag: h.ETag ?? null };
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** 讀取公開 bucket 物件內容（一次性頭貼遷移用）；不存在回傳 null，超過 maxBytes 拋出。 */
export async function storageGetObjectBytes(relKey: string, maxBytes: number): Promise<Buffer | null> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  try {
    const r = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: relKey }));
    if ((r.ContentLength ?? 0) > maxBytes) throw new Error("object too large");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) throw new Error("object too large");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export type StorageObjectDetail = {
  contentLength: number;
  contentType: string | null;
  etag: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  contentEncoding: string | null;
  contentLanguage: string | null;
  metadata: Record<string, string>;
  serverSideEncryption: string | null;
  storageClass: string | null;
  versionId: string | null;
};

/** HeadObject（完整 metadata）：Cache-Control 補寫工具用。物件不存在回傳 null。 */
export async function storageHeadDetailed(relKey: string): Promise<StorageObjectDetail | null> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  try {
    const h = await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: relKey }));
    return {
      contentLength: h.ContentLength ?? 0,
      contentType: h.ContentType ?? null,
      etag: h.ETag ?? null,
      cacheControl: h.CacheControl ?? null,
      contentDisposition: h.ContentDisposition ?? null,
      contentEncoding: h.ContentEncoding ?? null,
      contentLanguage: h.ContentLanguage ?? null,
      metadata: h.Metadata ?? {},
      serverSideEncryption: h.ServerSideEncryption ?? null,
      storageClass: h.StorageClass ?? null,
      versionId: h.VersionId ?? null,
    };
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * 原地改寫 Cache-Control（Batch 3.10 補寫既有公開物件）：同 key CopyObject、
 * MetadataDirective REPLACE，並把 HEAD 讀到的 Content-Type 等 metadata 原樣帶回
 * （REPLACE 不會自動保留）。CopySourceIfMatch 綁定 HEAD 時的 ETag：物件在這期間
 * 被改過就失敗、不會覆寫。bytes 不經過本機，內容逐位元不變。
 */
export async function storageRewriteCacheControl(relKey: string, current: StorageObjectDetail, cacheControl: string): Promise<{ versionId: string | null }> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  if (!current.etag || !current.contentType) throw new Error("missing etag or content-type");
  const encodedSource = relKey.split("/").map(encodeURIComponent).join("/");
  const r = await getClient().send(new CopyObjectCommand({
    Bucket: bucket,
    Key: relKey,
    CopySource: `${bucket}/${encodedSource}`,
    CopySourceIfMatch: current.etag,
    MetadataDirective: "REPLACE",
    ContentType: current.contentType,
    CacheControl: cacheControl,
    ...(current.contentDisposition ? { ContentDisposition: current.contentDisposition } : {}),
    ...(current.contentEncoding ? { ContentEncoding: current.contentEncoding } : {}),
    ...(current.contentLanguage ? { ContentLanguage: current.contentLanguage } : {}),
    Metadata: current.metadata,
    ...(current.serverSideEncryption === "AES256" ? { ServerSideEncryption: "AES256" as const } : {}),
    ...(current.storageClass && current.storageClass !== "STANDARD" ? { StorageClass: current.storageClass as any } : {}),
  }));
  return { versionId: r.VersionId ?? null };
}

/**
 * 同一個 bucket 內的伺服器端複製（bytes 逐位元相同，不經過本機）。
 * MetadataDirective: "COPY"（AWS 預設值，這裡明寫）：Content-Type 與 user metadata
 * 沿用來源物件，不會變成 application/octet-stream，也不額外加 Cache-Control。
 */
export async function storageCopy(sourceKey: string, destinationKey: string): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
  const encodedSource = sourceKey.split("/").map(encodeURIComponent).join("/");
  await getClient().send(new CopyObjectCommand({
    Bucket: bucket,
    Key: destinationKey,
    CopySource: `${bucket}/${encodedSource}`,
    MetadataDirective: "COPY",
  }));
}
