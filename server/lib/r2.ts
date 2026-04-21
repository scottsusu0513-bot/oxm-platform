import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export function isR2Enabled(): boolean {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getClient(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 config missing: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY required");
  }

  return new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function uploadImage(
  fileBuffer: Buffer | Uint8Array,
  fileName: string,
  mimeType: string
): Promise<{ key: string; url: string }> {
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;

  if (!bucket || !endpoint) {
    throw new Error("R2 config missing: R2_BUCKET_NAME, R2_ENDPOINT required");
  }

  console.log("[R2] endpoint:", process.env.R2_ENDPOINT);
  console.log("[R2] bucket:", process.env.R2_BUCKET_NAME);

  const key = `images/${Date.now()}-${fileName}`;

  try {
    await getClient().send(
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
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("R2 config missing: R2_BUCKET_NAME required");
  }

  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );
  } catch (err) {
    console.error("[R2] delete failed:", err);
    throw err;
  }
}
