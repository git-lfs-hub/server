import { env } from "process";
if (env.SENTRY_DSN) {
  const sentry = await import("@sentry/hono/node");
  sentry.init({
    dsn: env.SENTRY_DSN,
    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
}
