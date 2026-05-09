import { Hono } from "hono";
import { authMiddleware } from "./auth";
import { batchHandler } from "./batch";
import { verifyHandler } from "./verify";
import { createLockHandler, listLocksHandler, verifyLocksHandler, unlockHandler } from "./locks";

const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

type AppEnv = { Bindings: CloudflareBindings; Variables: { user: string } };

const app = new Hono<AppEnv>();

// All LFS API requests must carry Accept: application/vnd.git-lfs+json.
// Strip charset suffix before comparing; wrong Accept → 404 (matches test server).
app.use("/:owner/:repo/*", async (c, next) => {
  const accept = (c.req.header("Accept") ?? "").split(";")[0].trim();
  if (accept !== LFS_CONTENT_TYPE) return c.notFound();
  await next();
});

// Set Content-Type on all LFS API responses.
app.use("/:owner/:repo/*", async (c, next) => {
  await next();
  c.res.headers.set("Content-Type", LFS_CONTENT_TYPE);
});

// Authenticate all LFS routes.
app.use("/:owner/:repo/*", authMiddleware);

// Routes
app.post("/:owner/:repo/objects/batch", batchHandler);
app.post("/:owner/:repo/objects/verify", verifyHandler);
app.post("/:owner/:repo/locks", createLockHandler);
app.get("/:owner/:repo/locks", listLocksHandler);
app.post("/:owner/:repo/locks/verify", verifyLocksHandler);
app.post("/:owner/:repo/locks/:id/unlock", unlockHandler);

export default app;
