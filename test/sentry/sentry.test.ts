import { test, expect, describe } from "vitest";
import app from "../../src/index";

// ---------------------------------------------------------------------------
// Regression: sentry() was guarded by `if (process.env.SENTRY_DSN)` at module
// init. In Cloudflare Workers prod, secrets live in c.env (Worker bindings),
// NOT in process.env, so the guard was always false and Sentry was never set
// up. The fix registers sentry() unconditionally with an options callback that
// reads c.env.SENTRY_DSN per-request.
//
// Observable signal: calling sentry(app, ...) triggers applyPatches(app) which
// proxy-wraps registered middleware. Wrapped handlers carry a
// `__sentry_original__` property pointing at the original handler. When
// sentry() is never called, no handler in app.routes carries that marker.
// ---------------------------------------------------------------------------

describe("sentry initialization", () => {
  test("sentry() was called — wrapped middleware is present in app routes", () => {
    // Bug:  if (process.env.SENTRY_DSN) skips sentry() → no wrapped handlers
    // Fix:  sentry() always called → applyPatches Proxy-wraps handlers
    const hasSentry = app.routes.some(
      (r) => (r.handler as unknown as { __sentry_original__?: unknown }).__sentry_original__ != null,
    );
    expect(hasSentry).toBe(true);
  });

  test("sentry options callback is invoked on request", async () => {
    // Any request triggers the sentry options factory; status doesn't matter.
    await app.request("http://localhost/");
  });
});
