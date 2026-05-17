import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Octokit } from "@octokit/rest";
import type { AppEnv } from "../app";
import { decryptCode, orgsFromEnv, usersFromEnv } from "./utils";

export const SESSION_COOKIE = "gh_session_v2";
export const SESSION_TTL = 86400; // 1 day

const getAuthenticated = (octokit: Octokit) =>
  octokit.rest.users
    .getAuthenticated()
    .then(({ data }) => data.login)
    .catch(() => null);

const ensureAuthenticatedIsMemberOf = (octokit: Octokit, org: string) =>
  octokit.rest.orgs
    .getMembershipForAuthenticatedUser({ org })
    .then(({ data }) => {
      if (data.state !== "active") throw new Error();
      return true as const;
    });

export const webAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).hostname === "localhost") return next();

  const loginUrl = `/login/oauth/authorize?redirect_uri=${encodeURIComponent(c.env.GITHUB_APP_HOME + "/")}&scope=read%3Aorg`;

  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return c.redirect(loginUrl);

  const payload = await decryptCode(cookie, c.env.LOGIN_SECRET);
  if (!payload) return c.redirect(loginUrl);

  const allowUsers = usersFromEnv(c.env);
  const allowOrgs = orgsFromEnv(c.env);
  const octokit = new Octokit({ auth: payload.token });
  const user = await getAuthenticated(octokit);
  if (!user) return c.redirect(loginUrl);

  // GITHUB_USERS gate: if set, user must be in the list.
  if (allowUsers.length > 0) {
    if (!allowUsers.some((u) => u.toLowerCase() === user.toLowerCase())) {
      return c.text(
        `Access denied: ${user} is not in the allowed users list`,
        403,
      );
    }
  }

  // GITHUB_ORGS gate: if set, user must be an active member.
  if (allowOrgs.length > 0) {
    const isMember = await Promise.any(
      allowOrgs.map((slug) => ensureAuthenticatedIsMemberOf(octokit, slug)),
    ).catch(() => false);
    if (!isMember) {
      return c.text(
        `Access denied: ${user} is not an active member of ${allowOrgs.join(", ")}`,
        403,
      );
    }
  }

  c.set("user", user);
  if (new URL(c.req.url).search) return c.redirect(new URL(c.req.url).pathname);
  await next();
};
