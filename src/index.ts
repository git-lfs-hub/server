import { env } from "process";
import { Hono } from "hono";

import { loginApi } from "./login";
import { lfsApi } from "./lfs";
import { webAuthMiddleware } from "./login/web-auth";
import { ObjectsStorage } from "./storage/objects";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    user: string;
    access: "read" | "write";
    objects: ObjectsStorage;
  };
};

const app = new Hono<AppEnv>();

if (env.SENTRY_DSN) {
  const { sentry } = await import("@sentry/hono/cloudflare");
  app.use(
    sentry(app, {
      dsn: env.SENTRY_DSN,
      // Adds request headers and IP for users, for more info visit:
      // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#sendDefaultPii
      sendDefaultPii: true,
    }),
  );
}

app.route("/", loginApi);
app.route("/lfs", lfsApi);
app.get("/", webAuthMiddleware, (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// required for Wrangler
export { Locks } from "./db/locks";
