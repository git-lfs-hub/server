import { reset, createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, test, expect, vi, afterEach } from 'vitest';

import { lfsApi } from '../../src/lfs/index';

const LFS = {
  Accept: 'application/vnd.git-lfs+json',
  'Content-Type': 'application/vnd.git-lfs+json',
  Authorization: 'Basic ' + btoa('alice:ghu_test'),
};

const mockState = vi.hoisted(() => ({
  login: 'alice',
  push: true,
}));

vi.mock('@git-lfs-hub/lib/github', () => ({
  GithubApi: class {
    constructor(_token: string) {}
    async authenticatedUsername() {
      return mockState.login;
    }
    async repoAccess() {
      return mockState.push ? 'write' : 'read';
    }
  },
}));

afterEach(async () => {
  mockState.login = 'alice';
  mockState.push = true;
  await reset();
});

function batch(path: string, op: 'upload' | 'download', oid: string) {
  return lfsApi.request(
    `http://w/${path}/objects/batch`,
    {
      method: 'POST',
      headers: LFS,
      body: JSON.stringify({ operation: op, objects: [{ oid, size: 3 }] }),
    },
    env,
    createExecutionContext(),
  );
}

describe('lfsApi objects middleware (ObjectsStorage init)', () => {
  test('ObjectsStorage is initialized for objects routes', async () => {
    const res = await lfsApi.request(
      'http://w/alice/repo/objects/batch',
      {
        method: 'POST',
        headers: LFS,
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: 'deadbeef', size: 10 }],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.objects).toHaveLength(1);
  });
});

describe('canonical prefix addressing', () => {
  const oid = 'a'.repeat(64);

  test('download resolves to the case the repo was first seen in', async () => {
    // First access (mixed case) pins name → "Alice/Repo".
    await batch('Alice/Repo', 'upload', oid);
    // Bytes physically live under the pinned prefix.
    await env.LFS_BUCKET.put(`Alice/Repo/${oid}`, 'abc');

    // A later lowercase request must resolve to the same prefix and find it.
    const res = await batch('alice/repo', 'download', oid);
    const body = (await res.json()) as any;
    expect(body.objects[0]).toHaveProperty('actions.download');
    expect(body.objects[0]).not.toHaveProperty('error');
  });

  test('download misses when bytes live under a non-pinned case', async () => {
    await batch('Alice/Repo', 'upload', oid); // pins "Alice/Repo"
    await env.LFS_BUCKET.put(`alice/repo/${oid}`, 'abc'); // wrong (other) case

    const res = await batch('alice/repo', 'download', oid);
    const body = (await res.json()) as any;
    expect(body.objects[0].error.code).toBe(404);
  });
});
