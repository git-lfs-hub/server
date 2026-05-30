import { Hono } from "hono";
import type { AppEnv } from "../app";
import { decryptSession } from "@git-lfs-hub/lib/auth";
import { githubAccessTokenFetch } from "@git-lfs-hub/lib/github";

export const tokenApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/oauth/access_token, both for OAuth (Browser) and Device flows
// ---------------------------------------------------------------------------
// Browser grant: decrypt the ephemeral code and return the real token.
// Device grant: proxy the polling request to GitHub with our credentials.
tokenApi.post("/access_token", async (c) => {
  const form = await c.req.parseBody();

  const refreshToken = form["refresh_token"];
  if (typeof refreshToken === "string") {
    return githubAccessTokenFetch({
      grant_type: "refresh_token",
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      refresh_token: refreshToken,
    });
  }

  const deviceCode = form["device_code"];
  if (typeof deviceCode === "string") {
    return githubAccessTokenFetch({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      device_code: deviceCode,
    });
  }

  const code = form["code"];
  if (typeof code === "string") {
    const payload = await decryptSession(code, c.env.LOGIN_SECRET);
    if (!payload) return c.json({ error: "invalid_grant" }, 400);
    return c.json({
      access_token: payload.token,
      token_type: "bearer",
      scope: "",
      ...(payload.refresh_token ? { refresh_token: payload.refresh_token } : {}),
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});
