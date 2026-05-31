import type { MiddlewareHandler } from "hono";

import { GithubApi } from "@git-lfs-hub/lib/github";
import { authHeaderToken } from "@git-lfs-hub/lib/auth";

import type { AppEnv } from "../app";

const DENY = { message: "Credentials needed" };
const DENY_HEADERS = { "LFS-Authenticate": 'Basic realm="Git LFS"' } as const;

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header) return c.json(DENY, 401, DENY_HEADERS);

  const headerAuth = authHeaderToken(header);
  if (!headerAuth) return c.json(DENY, 401, DENY_HEADERS);

  const owner = c.req.param("owner");
  const repo = c.req.param("repo")?.replace(/\.git$/, "");
  if (!owner || !repo) {
    // istanbul ignore next -- defensive: guaranteed by /:owner/:repo/* route pattern
    return c.json(DENY, 401, DENY_HEADERS);
  }

  const api = new GithubApi(headerAuth.token, c.env.GITHUB_CACHE);
  const username = await api.authenticatedUsername();
  if (!username) return c.json(DENY, 401, DENY_HEADERS);

  const access = await api.repoAccess(owner, repo);
  if (!access) return c.json(DENY, 401, DENY_HEADERS);

  c.set("user", username);
  c.set("access", access);

  await next();
};
