import https from "https";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// 先測試最基本的 DNS + TCP 連線
import dns from "dns/promises";
try {
  const addr = await dns.lookup("f7eaa2f67ed11ec37252764006f0c17e.r2.cloudflarestorage.com");
  console.log("[DNS] resolved:", addr.address);
} catch (e) {
  console.error("[DNS] FAILED:", e.message);
}

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({
      maxVersion: "TLSv1.2",
    }),
  }),
});

console.log("[R2] endpoint:", process.env.R2_ENDPOINT);

try {
  const result = await client.send(new ListBucketsCommand({}));
  console.log("R2 OK", JSON.stringify(result.Buckets, null, 2));
} catch (err) {
  console.error("R2 FAILED", err.message);
}
