const { S3Client, ListBucketsCommand } = require("@aws-sdk/client-s3");

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

client.send(new ListBucketsCommand({}))
  .then(result => console.log("R2 OK", JSON.stringify(result, null, 2)))
  .catch(err => console.error("R2 FAILED", err));
