import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { resolveSession } from "@git-lfs-hub/lib/auth";
import { orgsFromEnv } from "./utils";

export const webAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).hostname === "localhost") return next();

  const loginUrl = `/login/oauth/authorize?redirect_uri=${encodeURIComponent(c.env.GITHUB_APP_HOME + "/")}&scope=read%3Aorg`;

  const session = await resolveSession(c, {
    secret: c.env.LOGIN_SECRET,
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    cache: c.env.GITHUB_CACHE,
  });
  if (!session) return c.redirect(loginUrl);
  const { api, username } = session;

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
