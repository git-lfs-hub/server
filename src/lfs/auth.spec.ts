import { Hono } from 'hono';
import { vi, describe, test, expect, beforeEach } from 'vitest';

import type { AppEnv } from '../app';

// ---------------------------------------------------------------------------
// auth-package mocks — must be set up before auth.ts is imported
// ---------------------------------------------------------------------------

const mockState = {
  authenticated: true,
  hasRepoAccess: true,
  hasWriteAccess: true,
  githubLogin: 'alice' as string | null,
};

const callerAccess = vi.fn();

vi.mock('@git-lfs-hub/lib/github', () => ({
  GithubApi: class {
    constructor(_token: string) {}
    async authenticatedUsername() {
      return mockState.authenticated ? mockState.githubLogin : null;
    }
    async callerAccess(owner: string, repo: string, projectsOrgs?: string[]) {
      callerAccess(owner, repo, projectsOrgs);
      if (!mockState.hasRepoAccess) return null;
      return mockState.hasWriteAccess ? 'write' : 'read';
    }
  },
}));

const { authMiddleware } = await import('./auth');

// ---------------------------------------------------------------------------
// authMiddleware — HTTP-level tests via Hono's app.request()
// ---------------------------------------------------------------------------

const TEST_ENV = {
  GITHUB_ORG: 'TestOrg',
} as unknown as CloudflareBindings;

function makeApp() {
  const hono = new Hono<AppEnv>();
  hono.use('/lfs/:owner/:repo/*', authMiddleware);
  hono.get('/lfs/:owner/:repo/', (c) =>
    c.json({ ok: true, user: c.get('user'), access: c.get('access') }),
  );
  return {
    request: (url: string, init?: RequestInit) => hono.request(url, init, TEST_ENV),
  };
}

const app = makeApp();
const REPO_URL = 'http://w/lfs/alice/repo/';

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    mockState.authenticated = true;
    mockState.hasRepoAccess = true;
    mockState.hasWriteAccess = true;
    mockState.githubLogin = 'alice';
    callerAccess.mockClear();
  });

  describe('401 responses', () => {
    test('rejects requests with no Authorization header', async () => {
      const res = await app.request(REPO_URL);
      expect(res.status).toBe(401);
    });

    test('rejects malformed Basic credentials', async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: 'Basic !!!bad-base64!!!' },
      });
      expect(res.status).toBe(401);
    });

    test('rejects Basic with no colon in decoded value', async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: `Basic ${btoa('nocolon')}` },
      });
      expect(res.status).toBe(401);
    });

    test('rejects when GitHub grants the token no access to the repo', async () => {
      mockState.hasRepoAccess = false;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('alice', 'valid-token') },
      });
      expect(res.status).toBe(401);
    });

    test('401 carries LFS-Authenticate header', async () => {
      const res = await app.request(REPO_URL);
      expect(res.headers.get('LFS-Authenticate')).toBe('Basic realm="Git LFS"');
    });

    test('401 body contains credentials-needed message', async () => {
      const res = await app.request(REPO_URL);
      const body = (await res.json()) as any;
      expect(body.message).toBe('Credentials needed');
    });
  });

  describe('successful authentication', () => {
    test('accepts request when GitHub confirms token and repo access', async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      expect(res.status).toBe(200);
    });

    test('sets user variable to the GitHub login', async () => {
      mockState.githubLogin = 'gh-alice';
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      const body = (await res.json()) as any;
      expect(body.user).toBe('gh-alice');
    });

    test('accepts RemoteAuth scheme when GitHub confirms access', async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: 'RemoteAuth ghp_some_token' },
      });
      expect(res.status).toBe(200);
    });

    test('strips .git from repo name before checking GitHub', async () => {
      const res = await app.request('http://w/lfs/alice/repo.git/', {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      expect(res.status).toBe(200);
    });

    test("sets access to 'write' when user has push permission", async () => {
      mockState.hasWriteAccess = true;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      expect(((await res.json()) as any).access).toBe('write');
    });

    test("sets access to 'read' when user only has pull permission", async () => {
      mockState.hasWriteAccess = false;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      expect(((await res.json()) as any).access).toBe('read');
    });

    test('accepts a machine caller and leaves user null', async () => {
      mockState.githubLogin = null;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic('x-access-token', 'ghs_app_token') },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.user).toBeNull();
      expect(body.access).toBe('write');
    });

    // An LFS upload is the caller pushing its own bytes, so push is the whole bar.
    test('passes the namespace to callerAccess with no projects-org gate', async () => {
      await app.request('http://w/lfs/alice/repo.git/', {
        headers: { Authorization: basic('alice', 'ghp_valid_token') },
      });
      expect(callerAccess).toHaveBeenCalledWith('alice', 'repo', undefined);
    });
  });
});
