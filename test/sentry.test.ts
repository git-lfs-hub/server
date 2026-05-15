import { test, expect, describe } from "vitest";
import app from "../src/index";

// ---------------------------------------------------------------------------
// Regression: sentry() was guarded by `if (process.env.SENTRY_DSN)` at module
// init. In Cloudflare Workers prod, secrets live in c.env (Worker bindings),
// NOT in process.env, so the guard was always false and Sentry was never set
// up. The fix registers sentry() unconditionally with an options callback that
// reads c.env.SENTRY_DSN per-request.
//
// Observable signal: calling sentry(app, ...) triggers applyPatches(app) which
// (a) patches app.use so registered middleware are wrapped as sentryTracedMiddleware,
// and (b) patches Hono.prototype.route so sub-app handlers are wrapped too.
// When sentry() is never called, no sentryTracedMiddleware appears in app.routes.
// ---------------------------------------------------------------------------

describe("sentry initialization", () => {
  test("sentry() was called — sentryTracedMiddleware is present in app routes", () => {
    // Bug:  if (process.env.SENTRY_DSN) skips sentry() → no sentryTracedMiddleware
    // Fix:  sentry() always called → applyPatches wraps handlers as sentryTracedMiddleware
    const hasSentry = app.routes.some(
      (r) => r.handler.name === "sentryTracedMiddleware",
    );
    expect(hasSentry).toBe(true);
  });
});
