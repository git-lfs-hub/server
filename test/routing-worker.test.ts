import { describe, test, expect } from "vitest";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import app from "../src/app";

const LFS_CT = "application/vnd.git-lfs+json";
const PROBE = "http://w/lfs/alice/repo/locks";

describe("worker entry (test/main)", () => {
  test("routes LFS requests through the worker fetch handler", async () => {
    const res = await exports.default.fetch(
      new Request(PROBE, { headers: { Accept: LFS_CT } }),
    );
    expect(res.status).toBe(401);
  });
});

describe("/:owner/:repo/* shim with GITHUB_OWNERS", () => {
  // GITHUB_OWNERS is routing-only; GITHUB_USERS provides access control (required alongside GITHUB_OWNERS)
  const ownersEnv = { ...env, GITHUB_OWNERS: "Test-Org", GITHUB_ORG: "", GITHUB_ORGS: "", GITHUB_USERS: "test-user" };

  test("rewrites matching owner to /lfs and returns LFS 401", async () => {
    const res = await app.fetch(
      new Request("http://w/Test-Org/repo/info/lfs", { headers: { Accept: LFS_CT } }),
      ownersEnv,
    );
    expect(res.status).toBe(401);
  });

  test("does not rewrite non-matching owner", async () => {
    const res = await app.fetch(
      new Request("http://w/other-org/repo/info/lfs", {
        headers: { Accept: LFS_CT },
        redirect: "manual",
      }),
      ownersEnv,
    );
    expect(res.status).not.toBe(401);
  });
});

describe("/:owner/:repo/* shim with GITHUB_ORGS (no GITHUB_ORG)", () => {
  const orgsEnv = { ...env, GITHUB_ORGS: "Test-Org", GITHUB_ORG: "" };

  test("rewrites matching owner to /lfs and returns LFS 401", async () => {
    const res = await app.fetch(
      new Request("http://w/Test-Org/repo/info/lfs", { headers: { Accept: LFS_CT } }),
      orgsEnv,
    );
    expect(res.status).toBe(401);
  });

  test("does not rewrite non-matching owner", async () => {
    const res = await app.fetch(
      new Request("http://w/other-org/repo/info/lfs", {
        headers: { Accept: LFS_CT },
        redirect: "manual",
      }),
      orgsEnv,
    );
    expect(res.status).not.toBe(401);
  });
});

describe("/:owner/:repo/* shim (test/wrangler GITHUB_ORG=Test-Org)", () => {
  test("rewrites matching owner to /lfs and returns LFS 401", async () => {
    // Test-Org matches effectiveOwners from GITHUB_ORG=Test-Org in test/wrangler.jsonc
    const res = await exports.default.fetch(
      new Request("http://w/Test-Org/repo/info/lfs", { headers: { Accept: LFS_CT } }),
    );
    expect(res.status).toBe(401); // LFS auth required — confirms the rewrite happened
  });

  test("does not rewrite non-matching owner", async () => {
    // other-org is not in effectiveOwners — falls through to web auth redirect
    const res = await exports.default.fetch(
      new Request("http://w/other-org/repo/info/lfs", {
        headers: { Accept: LFS_CT },
        redirect: "manual",
      }),
    );
    expect(res.status).not.toBe(401); // Not an LFS response
  });
});
