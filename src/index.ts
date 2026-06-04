import { Hono } from "hono";
import { env } from "cloudflare:workers";

import routes, { AppEnv } from "./app";
export type { AppEnv } from "./app";

const app = new Hono<AppEnv>();

if (env?.SENTRY_DSN) {
  const { sentry } = await import("@sentry/hono/cloudflare");
  app.use(sentry(app, (c) => ({
    dsn: c?.SENTRY_DSN,
    release: c?.SENTRY_RELEASE,
    // ENV scopes events + sourcemap resolution per deploy env (empty = prod).
    environment: c?.ENV || "production",
    dist: c?.ENV || undefined,
    sendDefaultPii: true
  })));
}

app.route("/", routes);

export default app;

// required for Wrangler
export { Locks } from "./db/locks";
export { Repos } from "./db/repos";
export { Migration } from "./db/migration";
