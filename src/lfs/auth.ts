import type { MiddlewareHandler } from 'hono';

import { authHeaderToken, parseOrgsMap } from '@git-lfs-hub/lib/auth';
import { GithubApi, type RepoAccess } from '@git-lfs-hub/lib/github';

import type { AppEnv } from '../app';

const DENY = { message: 'Credentials needed' };
const DENY_HEADERS = { 'LFS-Authenticate': 'Basic realm="Git LFS"' } as const;
const MAX_ORGS_MAP = 5;

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
  const access = await mappedAccess(api, owner, repo, c.env, new URL(c.req.url).host);
  if (!access) return c.json(DENY, 401, DENY_HEADERS);

  c.set('user', await api.authenticatedUsername());
  c.set('access', access);

  await next();
};

/** `GITHUB_ORGS_MAP` lets a mapped source org push into the target's LFS namespace when its
 *  `.lfsconfig` names it. Write on this server's storage only — no GitHub access to `owner`. */
async function mappedAccess(
  api: GithubApi,
  owner: string,
  repo: string,
  env: AppEnv['Bindings'],
  host: string,
): Promise<RepoAccess | null> {
  const direct = await api.callerAccess(owner, repo);
  if (direct === 'write') return direct;

  const target = owner.toLowerCase();
  const sources = sourcesFor(env.GITHUB_ORGS_MAP, target);
  if (!sources.length) return direct;

  // The link is a repo fact and caches across callers — probe it before the per-token check.
  const want = `${target}/${repo}`.toLowerCase();
  const linked = await Promise.all(
    sources.map((src) =>
      api.declaredLfsPrefix(src, repo, host).then((p) => (p === want ? src : null)),
    ),
  );
  for (const src of linked) {
    if (src && (await api.callerAccess(src, repo)) === 'write') return 'write';
  }
  return direct;
}

let orgsMap: { raw?: string; byTarget: Map<string, string[]> } | null = null;

/** Orgs allowed to claim `target`. The var is fixed per deployment, so group once per isolate. */
function sourcesFor(raw: string | undefined, target: string): string[] {
  if (!orgsMap || orgsMap.raw !== raw) orgsMap = { raw, byTarget: groupByTarget(raw) };
  return orgsMap.byTarget.get(target) ?? [];
}

function groupByTarget(raw: string | undefined): Map<string, string[]> {
  const entries = parseOrgsMap(raw);
  if (entries.length > MAX_ORGS_MAP)
    throw new Error(`Too many orgs: GITHUB_ORGS_MAP must not exceed ${MAX_ORGS_MAP}`);
  const byTarget = new Map<string, string[]>();
  for (const [src, tgt] of entries) {
    if (src === tgt) continue;
    byTarget.set(tgt, [...(byTarget.get(tgt) ?? []), src]);
  }
  return byTarget;
}
