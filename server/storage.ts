import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getClient(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "ap-southeast-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });
}

function getPublicUrl(key: string): string {
  const base = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (base) return `${base}/${key}`;
  const bucket = process.env.AWS_S3_BUCKET ?? "";
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
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

/** 產生 S3 presigned URL（預設 5 分鐘有效）。env 未設定時直接 throw，不 fallback 公開 URL。 */
export async function storagePresignedUrl(relKey: string, expiresInSeconds = 300): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set — cannot generate secure download URL");
  const command = new GetObjectCommand({ Bucket: bucket, Key: relKey });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
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
