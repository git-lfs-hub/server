import { test, expect } from "vitest";
import app from "../src/index";

test("sentry middleware is NOT registered when SENTRY_DSN is absent", () => {
  const hasSentry = app.routes.some(
    (r) => r.handler.name === "sentryTracedMiddleware",
  );
  expect(hasSentry).toBe(false);
});
