import { Hono } from 'hono';

import { lfsApi } from './lfs';
import { loginApi } from './login';
import { ownersFromEnv } from './login/utils';
import { webAuthMiddleware } from './login/web-auth';
import { ObjectsStorage } from './storage/objects';

export type AppEnv = {
  // GITHUB_CACHE is optional: the KV binding is omitted from wrangler.jsonc (and
  // thus CloudflareBindings) when no namespace id is configured — auth cache off.
  // Consumers (GithubApi, resolveSession) already accept an undefined cache.
  Bindings: CloudflareBindings & { GITHUB_CACHE?: KVNamespace };
  Variables: {
    user: string;
    access: 'read' | 'write';
    objects: ObjectsStorage;
  };
};

const app = new Hono<AppEnv>();

app.route('/', loginApi);
app.route('/lfs', lfsApi);

app.all('/:owner/:repo/*', (c, next) => {
  const owner = c.req.param('owner').toLowerCase();
  if (![...ownersFromEnv(c.env)].some((o) => o.toLowerCase() === owner)) return next();
  const url = new URL(c.req.url);
  url.pathname = '/lfs' + url.pathname;
  let ctx;
  try {
    ctx = c.executionCtx;
  } catch {}
  return app.fetch(new Request(url, c.req.raw), c.env, ctx);
});
app.get('/*', webAuthMiddleware, (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
