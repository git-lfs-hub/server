import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { loginApi } from "./index";

const BASE = {
  GITHUB_APP_HOME: "https://example.com",
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  LOGIN_SECRET: "a".repeat(64),
} as unknown as CloudflareBindings;

function request(env: Partial<CloudflareBindings>) {
  const app = new Hono<AppEnv>();
  app.route("/", loginApi);
  return app.request("/api/v3/meta", {}, { ...BASE, ...env } as unknown as CloudflareBindings);
}

describe("login config validation", () => {
  test("GITHUB_OWNERS alone throws — no access control", async () => {
    const res = await request({ GITHUB_OWNERS: "my-org" } as any);
    expect(res.status).toBe(500);
  });

  test("GITHUB_ORGS alone is valid", async () => {
    const res = await request({ GITHUB_ORGS: "my-org" } as any);
    expect(res.status).not.toBe(500);
  });

  test("GITHUB_ORG alone is valid", async () => {
    const res = await request({ GITHUB_ORG: "my-org" } as any);
    expect(res.status).not.toBe(500);
  });

  test("GITHUB_USERS + GITHUB_OWNERS is valid", async () => {
    const res = await request({ GITHUB_USERS: "alice", GITHUB_OWNERS: "alice" } as any);
    expect(res.status).not.toBe(500);
  });

  test("GITHUB_USERS alone throws — no routing owners configured", async () => {
    const res = await request({ GITHUB_USERS: "alice" } as any);
    expect(res.status).toBe(500);
  });

  test("neither GITHUB_ORGS nor GITHUB_USERS nor GITHUB_OWNERS throws", async () => {
    const res = await request({} as any);
    expect(res.status).toBe(500);
  });
});
