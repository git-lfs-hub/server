import { afterEach, describe, expect, test, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  getSessionCookie,
  setSessionCookie,
  ACCESS_COOKIE,
  type SessionTokens,
} from "@git-lfs-hub/lib/auth/session";
import { webAuthMiddleware } from "./web-auth";

const SECRET = "a".repeat(64);
const TEST_ENV = {
  LOGIN_SECRET: SECRET,
  GITHUB_APP_HOME: "https://example.com",
  GITHUB_USER: "alice",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
} as unknown as CloudflareBindings;

function mockFetchSequence(
  handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const handler of handlers) {
    spy.mockImplementationOnce(handler as typeof fetch);
  }
  return spy;
}

function githubUser(login: string) {
  return (_url: string) =>
    new Response(JSON.stringify({ login }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function githubUnauthorized() {
  return (_url: string) => new Response(null, { status: 401 });
}

function oauthRefresh(body: Record<string, string>) {
  return (url: string) => {
    expect(url).toBe("https://github.com/login/oauth/access_token");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function setCookiePairs(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** Encode session tokens into the split-cookie Cookie header the middleware reads. */
async function seedCookie(session: SessionTokens): Promise<string> {
  const a = new Hono();
  a.get("/seed", async (c) => {
    await setSessionCookie(c, session, SECRET);
    return c.text("ok");
  });
  return setCookiePairs(await a.request("/seed"));
}

function sessionRequest(cookie?: string) {
  const hono = new Hono<AppEnv>();
  hono.get("/*", webAuthMiddleware, (c) => c.json({ user: c.get("user") }));
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return hono.request("http://w/", { headers }, TEST_ENV);
}

describe("webAuthMiddleware session cookie", () => {
  afterEach(() => vi.restoreAllMocks());

  test("allows request when access token is valid", async () => {
    const cookie = await seedCookie({ access: "ghu_ok", refresh: "ghr_r" });
    mockFetchSequence([githubUser("alice")]);

    const res = await sessionRequest(cookie);
    expect(res.status).toBe(200);
    expect((await res.json()) as { user: string }).toEqual({ user: "alice" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("refreshes and rewrites cookie when access token is expired", async () => {
    const cookie = await seedCookie({ access: "ghu_stale", refresh: "ghr_old" });
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new", refresh_token: "ghr_new" }),
      githubUser("alice"),
    ]);

    const res = await sessionRequest(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(ACCESS_COOKIE);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("keeps prior refresh when GitHub omits a new one", async () => {
    const cookie = await seedCookie({ access: "ghu_stale", refresh: "ghr_old" });
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new" }),
      githubUser("alice"),
    ]);

    const res = await sessionRequest(cookie);
    expect(res.status).toBe(200);

    const reissued = setCookiePairs(res);
    const a = new Hono();
    a.get("/get", async (c) => c.json(await getSessionCookie(c, SECRET)));
    const getRes = await a.request("/get", { headers: { Cookie: reissued } });
    const tokens = (await getRes.json()) as SessionTokens;
    expect(tokens.access).toBe("ghu_new");
    expect(tokens.refresh).toBe("ghr_old");
  });

  test("redirects when access token is invalid and there is no refresh", async () => {
    const cookie = await seedCookie({ access: "ghu_stale" });
    mockFetchSequence([githubUnauthorized()]);

    const res = await sessionRequest(cookie);
    expect(res.status).toBe(302);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("redirects when refresh grant returns an error", async () => {
    const cookie = await seedCookie({ access: "ghu_stale", refresh: "ghr_old" });
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ error: "bad_refresh" }),
    ]);

    const res = await sessionRequest(cookie);
    expect(res.status).toBe(302);
  });

  test("redirects for invalid cookie", async () => {
    const res = await sessionRequest(`${ACCESS_COOKIE}=not-a-jwe`);
    expect(res.status).toBe(302);
  });
});
