import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  githubOAuthUrl,
  oauthCallback,
  oauthSuccessUrl,
  oauthErrorUrl,
  setSessionCookie,
} from "@git-lfs-hub/lib/auth";

// ---------------------------------------------------------------------------
// OAuth (browser) login flow
// ---------------------------------------------------------------------------

export const oauthApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/oauth/authorize
// ---------------------------------------------------------------------------
// The client's loopback redirect_uri can't be pre-registered on our app, so we
// intercept here, seal it into a signed state token, and redirect GitHub to our
// own /callback URL instead.
oauthApi.get("/authorize", async (c) => {
  const { redirect_uri, scope, state, login } = c.req.query();
  if (!redirect_uri) return c.json({ error: "missing_redirect_uri" }, 400);
  const url = await githubOAuthUrl({
    clientId: c.env.GITHUB_CLIENT_ID,
    callbackUrl: `${c.env.GITHUB_APP_HOME}/login/oauth/callback`,
    secret: c.env.LOGIN_SECRET,
    state: {
      redirect_uri, // client loopback — sealed in state, used by oauthSuccessUrl
      client_state: state ?? "", // client's opaque state
      scopes: scope ?? "",
    },
    login,
  });
  return c.redirect(url, 302);
});

// ---------------------------------------------------------------------------
// GET /login/oauth/callback
// ---------------------------------------------------------------------------
// GitHub delivers the auth code here (our registered callback); we exchange it
// with our credentials, encrypt the real token as a short-lived ephemeral code,
// and redirect the client back to its original loopback URL.
oauthApi.get("/callback", async (c) => {
  const { code, state } = c.req.query();
  const result = await oauthCallback({
    code,
    state,
    secret: c.env.LOGIN_SECRET,
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    callbackUrl: `${c.env.GITHUB_APP_HOME}/login/oauth/callback`,
  })
  if (!result.ok) {
    const errUrl = oauthErrorUrl(result);
    if (errUrl) return c.redirect(errUrl, 302);
    return c.json({ error: result.error }, 400);
  }

  await setSessionCookie(c, result.tokenPayload, c.env.LOGIN_SECRET);

  // Hand ephemeral code to the Git client at its loopback redirect_uri.
  return c.redirect(await oauthSuccessUrl(result, c.env.LOGIN_SECRET), 302);
});
