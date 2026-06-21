import { sValidator } from '@hono/standard-validator';
import { Context, Hono } from 'hono';

import type { AppEnv } from '../app';
import { Objects, type LockRow } from '../db/objects';
import { Repos } from '../db/repos';
import { createLockRequestSchema, lockVerifyRequestSchema, unlockRequestSchema } from './_schema';

// -----------------------------------------------------------------------------
// https://github.com/git-lfs/git-lfs/blob/main/docs/api/locking.md
// -----------------------------------------------------------------------------

export const locksApi = new Hono<AppEnv>();

// Soft-deleted / purged repos serve 404 for every locking operation.
locksApi.use('/:owner/:repo/*', async (c, next) => {
  const owner = c.req.param('owner')!;
  const repo = c.req.param('repo')!;
  if (await Repos.global(c.env).isBlocked(owner, repo)) {
    return c.json({ message: 'Not Found' }, 404);
  }
  return next();
});

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks — Create Lock
// ---------------------------------------------------------------------------
locksApi.post(
  '/:owner/:repo/locks',
  sValidator('json', createLockRequestSchema, (r, c) => {
    if (!r.success) return c.json({ message: 'Invalid request' }, 422);
  }),
  async (c) => {
    if (c.get('access') !== 'write') {
      return c.json({ message: 'You must have push access to create a lock' }, 403);
    }
    const body = c.req.valid('json');
    const user = c.get('user');

    const owner = c.req.param('owner')!;
    const repo = c.req.param('repo')!;
    const objects = await Objects.resolve(c.env, owner, repo);

    const existing = await objects.lockByPath(body.path);
    if (existing) {
      return c.json({ lock: toApiLock(existing), message: 'already created lock' }, 409);
    }
    const created = await objects.createLock(user, body.path);
    return c.json({ lock: toApiLock(created) }, 201);
  },
);

// ---------------------------------------------------------------------------
// GET /:owner/:repo/locks — List Locks
// ---------------------------------------------------------------------------
locksApi.get('/:owner/:repo/locks', async (c) => {
  const { page, next_cursor } = await listLocks(c, {
    uuidFilter: c.req.query('id') ?? null,
    pathFilter: c.req.query('path') ?? null,
    cursor: c.req.query('cursor') ?? null,
    limit: parseInt(c.req.query('limit') ?? '0', 10),
  });

  return c.json({ locks: page.map(toApiLock), next_cursor });
});

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks/verify — Verify Locks (pre-push)
// ---------------------------------------------------------------------------
locksApi.post(
  '/:owner/:repo/locks/verify',
  sValidator('json', lockVerifyRequestSchema.catch({})),
  async (c) => {
    if (c.get('access') !== 'write') {
      return c.json({ message: 'You must have push access to verify locks' }, 403);
    }
    const body = c.req.valid('json');
    const user = c.get('user');

    const { page, next_cursor } = await listLocks(c, {
      pathFilter: null,
      uuidFilter: null,
      cursor: body.cursor ?? null,
      limit: body.limit ?? 0,
    });

    return c.json({
      ours: page.filter((r) => r.owner === user).map(toApiLock),
      theirs: page.filter((r) => r.owner !== user).map(toApiLock),
      next_cursor,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks/:id/unlock — Delete Lock
// ---------------------------------------------------------------------------
locksApi.post(
  '/:owner/:repo/locks/:id/unlock',
  sValidator('json', unlockRequestSchema.catch({})),
  async (c) => {
    if (c.get('access') !== 'write') {
      return c.json({ message: 'You must have push access to delete locks' }, 403);
    }
    const body = c.req.valid('json');
    const uuid = c.req.param('id');
    const user = c.get('user');

    const owner = c.req.param('owner')!;
    const repo = c.req.param('repo')!;
    const objects = await Objects.resolve(c.env, owner, repo);

    // istanbul ignore next -- `uuid` is guaranteed by the /:id/unlock route pattern
    const lock = uuid ? await objects.lockById(uuid) : null;
    if (!lock) return c.json({ message: 'Lock not found' }, 404);
    if (lock.owner !== user && !body.force) {
      return c.json({ message: 'You must have push access to delete locks' }, 403);
    }

    await objects.deleteLock(uuid);
    return c.json({ lock: toApiLock(lock) });
  },
);

async function listLocks(
  c: Context<AppEnv>,
  opts: {
    uuidFilter: string | null;
    pathFilter: string | null;
    cursor: string | null;
    limit: number | null;
  },
): Promise<{ page: LockRow[]; next_cursor: string | undefined }> {
  const cursor = opts.cursor ? parseInt(opts.cursor, 10) : null;
  // istanbul ignore next -- both callers coalesce limit to a number, so `?? 0` is dead
  const limit = Math.min(Math.max(opts.limit ?? 0, 0) || 100, 1000);

  const owner = c.req.param('owner')!;
  const repo = c.req.param('repo')!;
  const objects = await Objects.resolve(c.env, owner, repo);

  const results = await objects.listLocks({
    pathFilter: opts.pathFilter,
    uuidFilter: opts.uuidFilter,
    cursor,
    limit: limit + 1,
  });

  const hasMore = results.length > limit;
  return {
    page: hasMore ? results.slice(0, limit) : results,
    next_cursor: hasMore ? String(results[limit].id) : undefined,
  };
}

function toApiLock(row: LockRow) {
  return {
    id: row.uuid,
    path: row.path,
    locked_at: row.locked_at,
    owner: { name: row.owner },
  };
}
