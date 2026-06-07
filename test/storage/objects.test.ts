import { env, reset } from 'cloudflare:test';
import { afterEach, describe, expect, test } from 'vitest';

import { ObjectsStorage } from '../../src/storage/objects';

const KEY = 'alice/repo/' + 'a'.repeat(64);

function storage() {
  return new ObjectsStorage(env);
}

describe('ObjectsStorage + R2', () => {
  afterEach(async () => {
    await reset();
  });

  test('verifyObject succeeds when object exists', async () => {
    const body = 'x'.repeat(42);
    await env.LFS_BUCKET.put(KEY, body);

    expect(await storage().verifyObject(KEY)).toEqual({});
    expect(await storage().verifyObject(KEY, 42)).toEqual({});
  });

  test('verifyObject reports size mismatch', async () => {
    await env.LFS_BUCKET.put(KEY, 'hello');
    expect(await storage().verifyObject(KEY, 999)).toEqual({
      message: 'Object size mismatch',
    });
  });

  test('verifyObject reports missing object', async () => {
    expect(await storage().verifyObject('alice/repo/missing')).toEqual({
      message: 'Object not found',
    });
  });

  test('presignDownload returns download action for existing object', async () => {
    await env.LFS_BUCKET.put(KEY, 'payload');
    const result = await storage().presignDownload(KEY);
    expect(result).toMatchObject({
      actions: { download: { href: expect.stringMatching(/^https:/) } },
    });
  });

  test('presignDownload returns 404-shaped error when missing', async () => {
    const result = await storage().presignDownload('alice/repo/nope');
    expect(result).toEqual({
      error: { code: 404, message: 'Object not found' },
    });
  });

  test('presignUpload returns empty actions when object already exists', async () => {
    await env.LFS_BUCKET.put(KEY, 'existing');
    expect(await storage().presignUpload(KEY, 'http://test/verify')).toEqual({});
  });
});
