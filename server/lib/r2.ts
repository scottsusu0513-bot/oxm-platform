import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.R2_BUCKET_NAME ?? "";
const endpoint = process.env.R2_ENDPOINT ?? "";

function getClient(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
}

export function isR2Enabled(): boolean {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

export async function uploadImage(
  fileBuffer: Buffer | Uint8Array,
  fileName: string,
  mimeType: string
): Promise<{ key: string; url: string }> {
  const key = `images/${Date.now()}-${fileName}`;
  const client = getClient();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
      })
    );
  } catch (err) {
    console.error("[R2] upload failed:", err);
    throw err;
  }

  const url = `${endpoint}/${bucket}/${key}`;
  return { key, url };
}

export async function deleteImage(key: string): Promise<void> {
  const client = getClient();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (err) {
    console.error("[R2] delete failed:", err);
    throw err;
  }
}
