import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import {
  getSessionCookie,
  setSessionCookie,
  type SessionPayload,
} from "@git-lfs-hub/lib/auth";
import { GithubApi, githubAccessToken } from "@git-lfs-hub/lib/github";
import { orgsFromEnv } from "./utils";

export const webAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).hostname === "localhost") return next();

  const loginUrl = `/login/oauth/authorize?redirect_uri=${encodeURIComponent(c.env.GITHUB_APP_HOME + "/")}&scope=read%3Aorg`;

  const cookie = await getSessionCookie(c, c.env.LOGIN_SECRET);
  if (!cookie) return c.redirect(loginUrl);

  let api = new GithubApi(cookie.token);
  let username = await api.authenticatedUsername();

  if (!username && cookie.refresh_token) {
    const data = await githubAccessToken({
      grant_type: "refresh_token",
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      refresh_token: cookie.refresh_token,
    });
    if (!data.error && data.access_token) {
      const payload: SessionPayload = {
        token: data.access_token,
        refresh_token:
          typeof data.refresh_token === "string"
            ? data.refresh_token
            : cookie.refresh_token,
      };
      api = new GithubApi(payload.token);
      username = await api.authenticatedUsername();
      if (username) await setSessionCookie(c, payload, c.env.LOGIN_SECRET);
    }
  }

  if (!username) return c.redirect(loginUrl);

  const allowUser = c.env.GITHUB_USER?.trim() || null;
  if (allowUser) {
    if (username.toLowerCase() !== allowUser.toLowerCase())
      return c.text(`Access denied: ${username} is not ${allowUser}`, 403);
  } else {
    const allowOrgs = orgsFromEnv(c.env);
    const roles = await Promise.all(allowOrgs.map((slug) => api.orgRole(slug)));
    if (!roles.some((r) => r !== null))
      return c.text(
        `Access denied: ${username} is not an active member of ${allowOrgs.join(", ")}`,
        403,
      );
  }

  c.set("user", username);
  if (new URL(c.req.url).search) return c.redirect(new URL(c.req.url).pathname);
  await next();
};
