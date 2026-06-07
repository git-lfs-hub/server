import { Hono } from 'hono';
import { describe, test, expect } from 'vitest';

import type { AppEnv } from '../app';
import { loginApi } from './index';

const BASE = {
  GITHUB_APP_HOME: 'https://example.com',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'secret',
  LOGIN_SECRET: 'a'.repeat(64),
} as unknown as CloudflareBindings;

function request(env: Partial<CloudflareBindings>) {
  const app = new Hono<AppEnv>();
  app.route('/', loginApi);
  return app.request('/api/v3/meta', {}, { ...BASE, ...env } as unknown as CloudflareBindings);
}

describe('login config validation', () => {
  test('GITHUB_ORGS alone is valid', async () => {
    const res = await request({ GITHUB_ORGS: 'my-org' } as any);
    expect(res.status).not.toBe(500);
  });

  test('GITHUB_ORG alone is valid', async () => {
    const res = await request({ GITHUB_ORG: 'my-org' } as any);
    expect(res.status).not.toBe(500);
  });

  test('GITHUB_USER alone is valid', async () => {
    const res = await request({ GITHUB_USER: 'alice' } as any);
    expect(res.status).not.toBe(500);
  });

  test('GITHUB_ORG + GITHUB_USER throws — conflicting config', async () => {
    const res = await request({ GITHUB_ORG: 'my-org', GITHUB_USER: 'alice' } as any);
    expect(res.status).toBe(500);
  });

  test('GITHUB_ORGS + GITHUB_USER throws — conflicting config', async () => {
    const res = await request({ GITHUB_ORGS: 'my-org', GITHUB_USER: 'alice' } as any);
    expect(res.status).toBe(500);
  });

  test('neither GITHUB_ORG[S] nor GITHUB_USER throws', async () => {
    const res = await request({} as any);
    expect(res.status).toBe(500);
  });

  test('missing GITHUB_APP_HOME throws', async () => {
    const app = new Hono<AppEnv>();
    app.route('/', loginApi);
    const env = { ...BASE, GITHUB_ORG: 'my-org' } as any;
    delete env.GITHUB_APP_HOME;
    const res = await app.request('/api/v3/meta', {}, env);
    expect(res.status).toBe(500);
  });

  test('more than 5 orgs throws', async () => {
    const res = await request({
      GITHUB_ORGS: 'a,b,c,d,e,f',
    } as any);
    expect(res.status).toBe(500);
  });
});
