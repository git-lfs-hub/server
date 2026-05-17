import { Hono } from "hono";
import type { AppEnv } from "../app";
import { orgsFromEnv, ownersFromEnv, usersFromEnv } from "./utils";

import { githubProxy } from "./github-proxy";
import { deviceApi } from "./device";
import { oauthApi } from "./oauth";
import { tokenApi } from "./oauth-token";

export const loginApi = new Hono<AppEnv>();

loginApi.use("/*", async (c, next) => {
  if (c.env) {
    const missing = (
      ["GITHUB_APP_HOME", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const
    ).filter((key) => !c.env[key]);
    if (missing.length)
      throw new Error(
        `Missing required vars: ${missing.join(", ")} — set them in .dev.vars (local) or via wrangler secret put (production)`,
      );
    if (orgsFromEnv(c.env).length === 0 && usersFromEnv(c.env).length === 0)
      throw new Error(
        "No access control: set GITHUB_ORG[S] and/or GITHUB_USERS",
      );
    if (orgsFromEnv(c.env).length > 5)
      throw new Error("Too many orgs: GITHUB_ORG[S] must not exceed 5");
    ownersFromEnv(c.env); // throws with a clear message if no owners are configured
  }
  await next();
});

loginApi.route("/api", githubProxy);
loginApi.route("/login/device", deviceApi);
loginApi.route("/login/oauth", oauthApi);
loginApi.route("/login/oauth", tokenApi);
