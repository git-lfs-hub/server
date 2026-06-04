import { vi, describe, test, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";

const { mockOrgRole, mockResolveSession } = vi.hoisted(() => ({
  mockOrgRole: vi.fn(),
  mockResolveSession: vi.fn(),
}));

vi.mock("@git-lfs-hub/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@git-lfs-hub/lib/auth")>()),
  resolveSession: mockResolveSession,
}));

const { webAuthMiddleware } = await import("./web-auth");

const LOGIN_SECRET = "a".repeat(64);
const TEST_ENV = {
  LOGIN_SECRET,
  GITHUB_APP_HOME: "https://example.com",
  GITHUB_ORG: "TestOrg",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
} as unknown as CloudflareBindings;

const mockApi = { orgRole: mockOrgRole };

function resolved(username: string) {
  mockResolveSession.mockResolvedValue({ api: mockApi, username });
}

function makeApp(env = TEST_ENV) {
  const hono = new Hono<AppEnv>();
  hono.get("/*", webAuthMiddleware, (c) =>
    c.json({ ok: true, user: c.get("user") }),
  );
  return (url: string, init: RequestInit = {}) =>
    hono.request(url, { ...init, headers: { ...(init.headers ?? {}) } }, env);
}

const app = makeApp();

describe("webAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolved("alice");
    mockOrgRole.mockResolvedValue("member");
  });

  describe("unauthenticated → redirects to login", () => {
    test("no session returns 302", async () => {
      mockResolveSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.status).toBe(302);
    });

    test("redirect points to /login/oauth/authorize", async () => {
      mockResolveSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.headers.get("Location")).toContain("/login/oauth/authorize");
    });

    test("redirect encodes GITHUB_APP_HOME as redirect_uri", async () => {
      mockResolveSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.headers.get("Location")).toContain(
        encodeURIComponent("https://example.com/"),
      );
    });

    test("redirect requests read:org scope", async () => {
      mockResolveSession.mockResolvedValue(null);
      const res = await app("http://w/");
      const location = new URL(res.headers.get("Location")!, "http://w");
      expect(location.searchParams.get("scope")).toBe("read:org");
    });
  });

  describe("org membership", () => {
    test("non-member returns 403", async () => {
      mockOrgRole.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.status).toBe(403);
    });

    test("403 body names the user and org", async () => {
      resolved("bob");
      mockOrgRole.mockResolvedValue(null);
      const res = await app("http://w/");
      const body = await res.text();
      expect(body).toContain("bob");
      expect(body).toContain("TestOrg");
    });
  });

  describe("GITHUB_ORGS (multi-org)", () => {
    const envOrgs = {
      LOGIN_SECRET,
      GITHUB_APP_HOME: "https://example.com",
      GITHUB_ORGS: "org-a org-b",
    } as unknown as CloudflareBindings;

    test("member of one of two orgs passes", async () => {
      mockOrgRole.mockReset();
      mockOrgRole.mockResolvedValueOnce(null).mockResolvedValueOnce("member");
      const res = await makeApp(envOrgs)("http://w/");
      expect(res.status).toBe(200);
      expect(mockOrgRole).toHaveBeenCalledTimes(2);
    });

    test("member of neither org is denied", async () => {
      mockOrgRole.mockResolvedValue(null);
      const res = await makeApp(envOrgs)("http://w/");
      expect(res.status).toBe(403);
    });
  });

  describe("GITHUB_USER (user mode)", () => {
    const envUser = {
      LOGIN_SECRET,
      GITHUB_APP_HOME: "https://example.com",
      GITHUB_USER: "carol",
    } as unknown as CloudflareBindings;

    test("matching user is allowed without org check", async () => {
      resolved("carol");
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(200);
      expect(mockOrgRole).not.toHaveBeenCalled();
    });

    test("non-matching user is denied", async () => {
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(403);
    });

    test("match is case-insensitive", async () => {
      resolved("Carol");
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(200);
    });
  });

  describe("local-dev bypass", () => {
    test.each(["http://localhost/", "http://127.0.0.1/", "http://[::1]/"])(
      "loopback host %s skips auth entirely",
      async (url) => {
        const res = await app(url);
        expect(res.status).toBe(200);
        expect(mockResolveSession).not.toHaveBeenCalled();
      },
    );

    test("ENV=local skips auth on a non-loopback host", async () => {
      const localEnv = { ...TEST_ENV, ENV: "local" } as unknown as CloudflareBindings;
      const res = await makeApp(localEnv)("http://w/");
      expect(res.status).toBe(200);
      expect(mockResolveSession).not.toHaveBeenCalled();
    });
  });

  describe("successful auth", () => {
    test("active member passes through with 200", async () => {
      const res = await app("http://w/");
      expect(res.status).toBe(200);
    });

    test("sets c.var.user to the GitHub login", async () => {
      resolved("gh-alice");
      const res = await app("http://w/");
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe("gh-alice");
    });

    test("URL with query params redirects to clean pathname", async () => {
      const res = await app("http://w/?code=ephemeral&state=xyz");
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });
});
