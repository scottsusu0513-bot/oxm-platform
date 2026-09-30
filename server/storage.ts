import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { publicImageUrl } from "./factoryAvatarUrl";

function getClient(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "ap-southeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
}

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
