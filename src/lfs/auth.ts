import type { MiddlewareHandler } from 'hono';

import { authHeaderToken } from '@git-lfs-hub/lib/auth';
import { GithubApi } from '@git-lfs-hub/lib/github';

import type { AppEnv } from '../app';

const DENY = { message: 'Credentials needed' };
const DENY_HEADERS = { 'LFS-Authenticate': 'Basic realm="Git LFS"' } as const;

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header) return c.json(DENY, 401, DENY_HEADERS);

  const headerAuth = authHeaderToken(header);
  if (!headerAuth) return c.json(DENY, 401, DENY_HEADERS);

  const owner = c.req.param('owner');
  const repo = c.req.param('repo')?.replace(/\.git$/, '');
  // istanbul ignore next -- defensive: guaranteed by /:owner/:repo/* route pattern
  if (!owner || !repo) {
    return c.json(DENY, 401, DENY_HEADERS);
  }

  // The path segments are an LFS namespace, not the repo's location — `callerAccess` resolves
  // them through GitHub, and a machine caller has no `GET /user` identity to gate on.
  const api = new GithubApi(headerAuth.token, c.env.GITHUB_CACHE);
  const access = await api.callerAccess(owner, repo);
  if (!access) return c.json(DENY, 401, DENY_HEADERS);

  c.set('user', await api.authenticatedUsername());
  c.set('access', access);

  await next();
};
