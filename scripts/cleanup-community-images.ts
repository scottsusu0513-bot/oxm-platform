/**
 * 清理孤兒社群圖片（未被任何貼文或投標引用的 S3 物件）
 * 執行：pnpm cleanup:community-images [--dry-run]
 *
 * 邏輯：
 * 1. 列出 S3 community-posts/ 下的所有物件
 * 2. 查詢 DB 中所有貼文（community_posts.images）和投標
 *    （communityBidOffers.images）的 images 欄位，建立已引用 URL 集合
 * 3. 找出超過 24 小時且未被引用的物件（孤兒圖片）
 * 4. 刪除孤兒圖片（--dry-run 時只列出不刪除）
 *
 * 建議搭配 S3 Lifecycle Rule 作為保險：
 *   Prefix: community-posts/  |  Expiration: 30 days（保底清理）
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const DRY_RUN = process.argv.includes("--dry-run");
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

async function main() {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION ?? "ap-southeast-1";
  const dbUrl = process.env.DATABASE_URL;

  if (!bucket) { console.error("[cleanup] AWS_S3_BUCKET not set"); process.exit(1); }
  if (!dbUrl) { console.error("[cleanup] DATABASE_URL not set"); process.exit(1); }

  if (DRY_RUN) console.log("[cleanup] 乾跑模式 — 不會實際刪除");

  // 1. 列出 S3 物件
  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    },
  });

  const s3Objects: { key: string; lastModified: Date }[] = [];
  let token: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "community-posts/",
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key && obj.LastModified) {
        s3Objects.push({ key: obj.Key, lastModified: obj.LastModified });
      }
    }
    token = resp.NextContinuationToken;
  } while (token);

  console.log(`[cleanup] S3 物件數：${s3Objects.length}`);

  // 2. 查詢 DB 已引用的 URL（貼文 + 投標報價）
  const pool = await mysql.createPool({ uri: dbUrl, connectionLimit: 3 });
  const conn = await pool.getConnection();
  let referencedUrls: Set<string>;
  try {
    referencedUrls = new Set<string>();

    function collectImages(rows: mysql.RowDataPacket[]) {
      for (const row of rows) {
        try {
          const imgs: unknown = typeof row.images === "string"
            ? JSON.parse(row.images)
            : row.images;
          if (Array.isArray(imgs)) {
            imgs.forEach((u) => typeof u === "string" && referencedUrls.add(u));
          }
        } catch { /* malformed JSON, skip */ }
      }
    }

    // community_posts.images
    const [postRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT images FROM community_posts WHERE images IS NOT NULL AND images != '[]'",
    );
    collectImages(postRows);

    // communityBidOffers.images (all statuses, deletedAt IS NULL)
    const [offerRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT images FROM communityBidOffers WHERE images IS NOT NULL AND images != '[]' AND deletedAt IS NULL",
    );
    collectImages(offerRows);
  } finally {
    conn.release();
    await pool.end();
  }

  console.log(`[cleanup] DB 已引用 URL 數：${referencedUrls.size}`);

  // 3. 找孤兒（>24h 且不在 DB）
  const s3Base = (process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, ""))
    ?? `https://${bucket}.s3.${region}.amazonaws.com`;

  const now = Date.now();
  const orphans: string[] = [];
  for (const obj of s3Objects) {
    const url = `${s3Base}/${obj.key}`;
    const ageMs = now - obj.lastModified.getTime();
    if (!referencedUrls.has(url) && ageMs > STALE_AFTER_MS) {
      orphans.push(obj.key);
    }
  }

  console.log(`[cleanup] 孤兒圖片（>24h，未引用）：${orphans.length}`);

  if (orphans.length === 0) {
    console.log("[cleanup] 無需清理。");
    return;
  }

  if (DRY_RUN) {
    console.log("[cleanup] 將會刪除：");
    orphans.forEach((k) => console.log(`  - ${k}`));
    return;
  }

  // 4. 批次刪除（S3 每批最多 1000）
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000);
    const resp = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((k) => ({ Key: k })) },
      }),
    );
    const count = resp.Deleted?.length ?? 0;
    deleted += count;
    console.log(`[cleanup] 已刪除 ${count} 個物件`);
    if (resp.Errors?.length) {
      resp.Errors.forEach((e) =>
        console.error(`  [error] ${e.Key}: ${e.Message}`),
      );
    }
  }

  console.log(`\n[cleanup] 完成。共刪除 ${deleted} 個孤兒圖片。`);
}

main().catch((err) => {
  console.error("[cleanup] 未預期錯誤:", err);
  process.exit(1);
});
