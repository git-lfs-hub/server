import { reset, createExecutionContext, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, test, expect, afterEach } from 'vitest';

import { AdminEntrypoint } from '../../src/admin/entrypoint';

afterEach(async () => {
  await reset();
});

function entrypoint() {
  return new AdminEntrypoint(createExecutionContext(), env);
}

function registry() {
  return env.REPOS.getByName('global');
}

// ---------------------------------------------------------------------------
// blockRepo / unblockRepo
// ---------------------------------------------------------------------------

describe('blockRepo / unblockRepo', () => {
  test('blockRepo blocks the repo, read case-insensitively', async () => {
    await registry().resolveName('Alice', 'Repo');
    await entrypoint().blockRepo('Alice', 'Repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(true);
  });

  test('unblockRepo resumes serving', async () => {
    await registry().resolveName('Alice', 'Repo');
    await entrypoint().blockRepo('alice', 'repo');
    await entrypoint().unblockRepo('alice', 'repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// purgeRepo
// ---------------------------------------------------------------------------

describe('purgeRepo', () => {
  test('wipes the Locks DO and marks the registry purged', async () => {
    const name = await registry().resolveName('Alice', 'Repo');
    const locks = env.LOCKS.getByName(name);
    await locks.create('alice', 'file.bin');

    await entrypoint().purgeRepo('alice', 'repo');

    // purge deleteAll()s the Locks DO — assert the table is gone, not via the
    // lock methods (which would hit "no such table" on the wiped instance).
    await runInDurableObject(locks, (_instance, state) => {
      const tables = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray();
      expect(tables.some((t) => t.name === 'locks')).toBe(false);
    });
    expect(await registry().isBlocked('alice', 'repo')).toBe(true);
  });

  test('is idempotent', async () => {
    await registry().resolveName('Alice', 'Repo');
    await entrypoint().purgeRepo('alice', 'repo');
    await expect(entrypoint().purgeRepo('alice', 'repo')).resolves.toBeUndefined();
  });
});
