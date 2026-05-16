import { describe, test, expect } from "vitest";
import { ObjectsStorage } from "./objects";
import { presignR2ObjectUrl } from "./presign";
import { emptyR2Bucket, r2BucketWithHeadSizes } from "../test/r2-bucket-mock";

const S3 = {
  S3_ENDPOINT:          "https://test-account.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID:     "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET_NAME:       "lfs-objects",
  S3_PRESIGN_TTL:       "3600",
} as const;

const ENV = { ...S3, LFS_BUCKET: emptyR2Bucket() };

const KEY = "alice/repo/abc123def456";
const VERIFY_HREF = "https://lfs.example.com/alice/repo/objects/verify";

function parse(raw: string) {
  const url = new URL(raw);
  return {
    protocol: url.protocol,
    host:     url.host,
    pathname: url.pathname,
    params:   url.searchParams,
  };
}

function presignPut(key: string, ttl: string) {
  return presignR2ObjectUrl({
    method: "PUT",
    endpoint: S3.S3_ENDPOINT,
    bucket: S3.S3_BUCKET_NAME,
    key,
    accessKeyId: S3.S3_ACCESS_KEY_ID,
    secretAccessKey: S3.S3_SECRET_ACCESS_KEY,
    expiresSeconds: Number(ttl),
  });
}

// ---------------------------------------------------------------------------

describe("presignR2ObjectUrl (PUT)", () => {
  test("href is an HTTPS URL", async () => {
    expect(parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).protocol).toBe("https:");
  });

  test("href targets the configured S3 endpoint", async () => {
    expect(parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("href path contains bucket name then key", async () => {
    expect(parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });

  test("href uses AWS Signature Version 4", async () => {
    expect(parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  });

  test("href X-Amz-Expires matches S3_PRESIGN_TTL", async () => {
    expect(parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).params.get("X-Amz-Expires")).toBe(S3.S3_PRESIGN_TTL);
  });

  test("href X-Amz-Expires reflects a different S3_PRESIGN_TTL", async () => {
    const href = await presignR2ObjectUrl({
      method: "PUT",
      endpoint: S3.S3_ENDPOINT,
      bucket: S3.S3_BUCKET_NAME,
      key: KEY,
      accessKeyId: S3.S3_ACCESS_KEY_ID,
      secretAccessKey: S3.S3_SECRET_ACCESS_KEY,
      expiresSeconds: 900,
    });
    expect(parse(href).params.get("X-Amz-Expires")).toBe("900");
  });

  test("href credential contains the configured access key ID", async () => {
    const credential = parse(await presignPut(KEY, S3.S3_PRESIGN_TTL)).params.get("X-Amz-Credential") ?? "";
    expect(credential).toMatch(/^test-key-id\//);
  });
});

// ---------------------------------------------------------------------------

describe("presignUpload", () => {
  test("verify.href is the passed verifyHref", async () => {
    const { actions: { verify } } = await new ObjectsStorage(ENV).presignUpload(KEY, VERIFY_HREF) as { actions: { verify: { href: string } } };
    expect(verify.href).toBe(VERIFY_HREF);
  });
});

// ---------------------------------------------------------------------------

describe("presignDownload", () => {
  const envWithObject = {
    ...S3,
    LFS_BUCKET: r2BucketWithHeadSizes({ [KEY]: 1 }),
  };

  test("returns error object when the object does not exist", async () => {
    const result = await new ObjectsStorage(ENV).presignDownload(KEY);
    expect(result).toMatchObject({ error: { code: 404 } });
  });

  test("returns download action when the object exists", async () => {
    const result = await new ObjectsStorage(envWithObject).presignDownload(KEY);
    expect(result).toMatchObject({ actions: { download: { href: expect.any(String) } } });
  });

  test("download href is an HTTPS URL", async () => {
    const result = await new ObjectsStorage(envWithObject).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).protocol).toBe("https:");
  });

  test("download href targets the configured S3 endpoint", async () => {
    const result = await new ObjectsStorage(envWithObject).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("download href path contains bucket name then key", async () => {
    const result = await new ObjectsStorage(envWithObject).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });
});
