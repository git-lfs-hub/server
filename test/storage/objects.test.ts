import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ObjectsStorage } from "../../src/storage/objects";

const ENV = {
  S3_ENDPOINT:          "https://test-account.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID:     "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_BUCKET_NAME:       "lfs-objects",
  S3_PRESIGN_TTL:       "3600",
};

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

// ---------------------------------------------------------------------------

describe("presignCommand", () => {
  const bucket = new ObjectsStorage(ENV);
  const cmd = new PutObjectCommand({ Bucket: ENV.S3_BUCKET_NAME, Key: KEY });

  test("href is an HTTPS URL", async () => {
    expect(parse(await bucket.presignCommand(cmd)).protocol).toBe("https:");
  });

  test("href targets the configured S3 endpoint", async () => {
    expect(parse(await bucket.presignCommand(cmd)).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("href path contains bucket name then key", async () => {
    expect(parse(await bucket.presignCommand(cmd)).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });

  test("href uses AWS Signature Version 4", async () => {
    expect(parse(await bucket.presignCommand(cmd)).params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
  });

  test("href X-Amz-Expires matches S3_PRESIGN_TTL", async () => {
    expect(parse(await bucket.presignCommand(cmd)).params.get("X-Amz-Expires")).toBe(ENV.S3_PRESIGN_TTL);
  });

  test("href X-Amz-Expires reflects a different S3_PRESIGN_TTL", async () => {
    const env = { ...ENV, S3_PRESIGN_TTL: "900" };
    const href = await new ObjectsStorage(env).presignCommand(new PutObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: KEY }));
    expect(parse(href).params.get("X-Amz-Expires")).toBe("900");
  });

  test("href credential contains the configured access key ID", async () => {
    const credential = parse(await bucket.presignCommand(cmd)).params.get("X-Amz-Credential") ?? "";
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
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ContentLength: 1 } as any);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test("returns error object when the object does not exist", async () => {
    spy.mockRejectedValue(new Error("Not Found"));
    const result = await new ObjectsStorage(ENV).presignDownload(KEY);
    expect(result).toMatchObject({ error: { code: 404 } });
  });

  test("returns download action when the object exists", async () => {
    const result = await new ObjectsStorage(ENV).presignDownload(KEY);
    expect(result).toMatchObject({ actions: { download: { href: expect.any(String) } } });
  });

  test("download href is an HTTPS URL", async () => {
    const result = await new ObjectsStorage(ENV).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).protocol).toBe("https:");
  });

  test("download href targets the configured S3 endpoint", async () => {
    const result = await new ObjectsStorage(ENV).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).host).toBe("test-account.r2.cloudflarestorage.com");
  });

  test("download href path contains bucket name then key", async () => {
    const result = await new ObjectsStorage(ENV).presignDownload(KEY) as { actions: { download: { href: string } } };
    expect(parse(result.actions.download.href).pathname).toBe("/lfs-objects/alice/repo/abc123def456");
  });
});
