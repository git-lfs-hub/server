import type { Context } from "hono";
import { batchRequestSchema } from "./api-schema";
import type { S3Bucket } from "./s3";
import assert from "assert";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string; s3bucket: S3Bucket };
};

export async function batchHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof batchRequestSchema.parse>;
  try {
    body = batchRequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ message: "Invalid request" }, 422);
  }

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const origin = new URL(c.req.url).origin;
  const { operation, objects } = body;

  const bucket = c.get("s3bucket");
  const results = await Promise.all(
    objects.map(async (obj) => {
      const key = `${owner}/${repo}/${obj.oid}`;
      if (operation === "upload") {
        const verifyHref = `${origin}/${owner}/${repo}/objects/verify`;
        return {
          oid: obj.oid,
          size: obj.size,
          ...(await bucket.presignUpload(key, verifyHref)),
        };
      } else {
        assert(operation === "download");
        return {
          oid: obj.oid,
          size: obj.size,
          ...(await bucket.presignDownload(key)),
        };
      }
    }),
  );

  return c.json({ transfer: "basic", hash_algo: "sha256", objects: results });
}
