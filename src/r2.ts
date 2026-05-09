import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface R2Env {
  ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  BUCKET_NAME: string;
}

function s3Client(env: R2Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export function presignUpload(env: R2Env, key: string, ttl = 3600): Promise<string> {
  return getSignedUrl(
    s3Client(env),
    new PutObjectCommand({ Bucket: env.BUCKET_NAME, Key: key }),
    { expiresIn: ttl },
  );
}

export function presignDownload(env: R2Env, key: string, ttl = 3600): Promise<string> {
  return getSignedUrl(
    s3Client(env),
    new GetObjectCommand({ Bucket: env.BUCKET_NAME, Key: key }),
    { expiresIn: ttl },
  );
}
