import { env } from "cloudflare:workers";
import { describe, test, expect, vi, afterEach } from "vitest";
import { lfsApi } from "../../src/lfs/index";
import { Hono } from "hono";
import type { AppEnv } from "../../src/app";

const LFS = {
  Accept: "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
  Authorization: "Basic " + btoa("alice:ghu_test"),
};

const mockState = vi.hoisted(() => ({
  login: "alice",
  push: true,
}));

vi.mock("@git-lfs-hub/lib/github", () => ({
  GithubApi: class {
    constructor(_token: string) {}
    async authenticatedUsername() { return mockState.login; }
    async repoAccess() { return mockState.push ? "write" : "read"; }
  },
}));

afterEach(() => {
  mockState.login = "alice";
  mockState.push = true;
});

describe("lfsApi objects middleware (ObjectsStorage init)", () => {
  test("ObjectsStorage is initialized for objects routes", async () => {
    const res = await lfsApi.request(
      "http://w/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "deadbeef", size: 10 }],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.objects).toHaveLength(1);
  });
});
