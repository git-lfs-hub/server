import type { Context } from "hono";
import { verifyRequestSchema } from "./api-schema";
import type { S3Bucket } from "./s3";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string; s3bucket: S3Bucket };
};

export async function verifyHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof verifyRequestSchema.parse>;
  try {
    body = verifyRequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ message: "Invalid request" }, 422);
  }

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const key = `${owner}/${repo}/${body.oid}`;

  const info = await c.get("s3bucket").verifyObject(key, body.size);
  if ("message" in info) return c.json({ message: info.message }, 422);

  return c.json({});
}
