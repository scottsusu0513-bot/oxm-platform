import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

console.log("[R2] endpoint:", process.env.R2_ENDPOINT);

try {
  const result = await client.send(new ListBucketsCommand({}));
  console.log("R2 OK", JSON.stringify(result.Buckets, null, 2));
} catch (err) {
  console.error("R2 FAILED", err.message);
}
