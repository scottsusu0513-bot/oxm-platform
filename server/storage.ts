import { isR2Enabled, uploadImage, deleteImage } from "./lib/r2";

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  if (!isR2Enabled()) {
    throw new Error(
      "R2 storage not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."
    );
  }
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const fileName = relKey.split("/").pop() ?? relKey;
  return uploadImage(buffer, fileName, contentType);
}

export async function storageDelete(relKey: string): Promise<void> {
  if (!isR2Enabled()) return;
  await deleteImage(relKey);
}

// storageGet is not used for R2 (URLs are public and returned directly on upload)
export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const endpoint = process.env.R2_ENDPOINT ?? "";
  const bucket = process.env.R2_BUCKET_NAME ?? "";
  return {
    key: relKey,
    url: `${endpoint}/${bucket}/${relKey}`,
  };
}
