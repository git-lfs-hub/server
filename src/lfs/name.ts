import type { Context } from 'hono';

import type { AppEnv } from '../app';

// Canonical `owner/repo` name for the request — the single source of truth for
// the R2 key prefix and the LOCKS DO name. Passes the raw-case params straight
// to the Repos registry, which lowercases identity, strips `.git`, and pins the
// name first-writer-wins. Every case variant converges on one value.
export function resolveName(c: Context<AppEnv>): Promise<string> {
  // owner/repo are guaranteed by the /:owner/:repo/* route pattern.
  const owner = c.req.param('owner')!;
  const repo = c.req.param('repo')!;
  return c.env.REPOS.getByName('global').resolveName(owner, repo);
}
