import { reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, test, expect, afterEach } from 'vitest';

import { CURRENT_VER } from '../../src/db/repos-schema';

afterEach(async () => {
  await reset();
});

function registry() {
  return env.REPOS.getByName('global');
}

// ---------------------------------------------------------------------------
// resolveName — first-writer-wins, case-insensitive identity
// ---------------------------------------------------------------------------

describe('resolveName', () => {
  test('returns the request case on first access', async () => {
    expect(await registry().resolveName('Alice', 'Repo')).toBe('Alice/Repo');
  });

  test('later request in a different case reads the pinned name', async () => {
    await registry().resolveName('Alice', 'Repo');
    expect(await registry().resolveName('alice', 'repo')).toBe('Alice/Repo');
  });

  test('lowercase-first then mixed-case both resolve to one row', async () => {
    expect(await registry().resolveName('alice', 'repo')).toBe('alice/repo');
    expect(await registry().resolveName('Alice', 'Repo')).toBe('alice/repo');
  });

  test('strips a trailing .git before pinning', async () => {
    expect(await registry().resolveName('Alice', 'Repo.git')).toBe('Alice/Repo');
    expect(await registry().resolveName('alice', 'repo')).toBe('Alice/Repo');
  });

  test('distinct repos pin independent names', async () => {
    expect(await registry().resolveName('Alice', 'One')).toBe('Alice/One');
    expect(await registry().resolveName('Alice', 'Two')).toBe('Alice/Two');
  });
});

// ---------------------------------------------------------------------------
// ver (migration guard)
// ---------------------------------------------------------------------------

describe('migration version', () => {
  test('a freshly pinned repo is born at CURRENT_VER', async () => {
    await registry().resolveName('Alice', 'Repo');
    expect(await registry().getVer('alice', 'repo')).toBe(CURRENT_VER);
  });

  test('setVer stamps a row read back case-insensitively', async () => {
    await registry().resolveName('Alice', 'Repo');
    await registry().setVer('Alice', 'Repo', 1);
    expect(await registry().getVer('alice', 'repo')).toBe(1);
  });

  test('getVer is 0 for an unknown repo', async () => {
    expect(await registry().getVer('ghost', 'repo')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// block / unblock / isBlocked / markPurged (serve state)
// ---------------------------------------------------------------------------

describe('block state', () => {
  test('a freshly pinned repo is not blocked', async () => {
    await registry().resolveName('Alice', 'Repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(false);
  });

  test('block flips isBlocked true, read case-insensitively', async () => {
    await registry().resolveName('Alice', 'Repo');
    await registry().block('Alice', 'Repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(true);
  });

  test('unblock clears the block', async () => {
    await registry().resolveName('Alice', 'Repo');
    await registry().block('alice', 'repo');
    await registry().unblock('alice', 'repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(false);
  });

  test('markPurged keeps isBlocked true', async () => {
    await registry().resolveName('Alice', 'Repo');
    await registry().markPurged('alice', 'repo');
    expect(await registry().isBlocked('alice', 'repo')).toBe(true);
  });

  test('isBlocked is false for an unknown repo', async () => {
    expect(await registry().isBlocked('ghost', 'repo')).toBe(false);
  });

  test('block is a no-op when the row is absent', async () => {
    await registry().block('ghost', 'repo');
    expect(await registry().isBlocked('ghost', 'repo')).toBe(false);
  });
});
