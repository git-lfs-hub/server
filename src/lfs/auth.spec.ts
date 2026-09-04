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
  // When set, only these owners grant write — the org-map shape, where prod is denied.
  writeOwners: null as string[] | null,
  lfsLinks: {} as Record<string, string>,
};

const callerAccess = vi.fn();
const declaredLfsPrefix = vi.fn();

vi.mock('@git-lfs-hub/lib/github', () => ({
  GithubApi: class {
    constructor(_token: string) {}
    async authenticatedUsername() {
      return mockState.authenticated ? mockState.githubLogin : null;
    }
    async callerAccess(owner: string, repo: string, projectsOrgs?: string[]) {
      callerAccess(owner, repo, projectsOrgs);
      if (mockState.writeOwners) return mockState.writeOwners.includes(owner) ? 'write' : null;
      if (!mockState.hasRepoAccess) return null;
      return mockState.hasWriteAccess ? 'write' : 'read';
    }
    async declaredLfsPrefix(owner: string, repo: string, host: string) {
      declaredLfsPrefix(owner, repo, host);
      return mockState.lfsLinks[`${owner}/${repo}`] ?? null;
    }
  },
}));

const { authMiddleware } = await import('./auth');

// ---------------------------------------------------------------------------
// authMiddleware — HTTP-level tests via Hono's app.request()
// ---------------------------------------------------------------------------

const TEST_ENV = {
  GITHUB_ORG: 'TestOrg',
  GITHUB_ORGS_MAP: '',
} as unknown as CloudflareBindings;
// `wrangler types` types each var as the literal in wrangler.jsonc; tests need to vary this one.
const testVars = TEST_ENV as unknown as { GITHUB_ORGS_MAP: string };

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
    mockState.writeOwners = null;
    mockState.lfsLinks = {};
    testVars.GITHUB_ORGS_MAP = '';
    callerAccess.mockClear();
    declaredLfsPrefix.mockClear();
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

  // A staging fork whose `.lfsconfig` still names prod, pushing with a staging-only token.
  describe('GITHUB_ORGS_MAP', () => {
    const PROD_URL = 'http://w/lfs/prod/hub/';
    const auth = { headers: { Authorization: basic('x-access-token', 'ghs_staging_token') } };

    function stagingPushesToProd() {
      mockState.writeOwners = ['staging'];
      mockState.lfsLinks = { 'staging/hub': 'prod/hub' };
      testVars.GITHUB_ORGS_MAP = 'staging=prod';
    }

    test('grants write on the target namespace', async () => {
      stagingPushesToProd();
      const res = await app.request(PROD_URL, auth);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).access).toBe('write');
    });

    test('checks the link against the request host', async () => {
      stagingPushesToProd();
      await app.request(PROD_URL, auth);
      expect(declaredLfsPrefix).toHaveBeenCalledWith('staging', 'hub', 'w');
    });

    test('rejects when the map is unset', async () => {
      stagingPushesToProd();
      testVars.GITHUB_ORGS_MAP = '';
      const res = await app.request(PROD_URL, auth);
      expect(res.status).toBe(401);
      expect(declaredLfsPrefix).not.toHaveBeenCalled();
    });

    test('rejects when the source repo has no .lfsconfig', async () => {
      stagingPushesToProd();
      mockState.lfsLinks = {};
      expect((await app.request(PROD_URL, auth)).status).toBe(401);
    });

    test('rejects when the .lfsconfig names another prefix', async () => {
      stagingPushesToProd();
      mockState.lfsLinks = { 'staging/hub': 'prod/other' };
      expect((await app.request(PROD_URL, auth)).status).toBe(401);
    });

    test('rejects when the caller cannot push to the source repo', async () => {
      stagingPushesToProd();
      mockState.writeOwners = [];
      expect((await app.request(PROD_URL, auth)).status).toBe(401);
    });

    test('is one-way: the target org gets no grant in the source namespace', async () => {
      mockState.writeOwners = ['prod'];
      mockState.lfsLinks = { 'prod/hub': 'staging/hub' };
      testVars.GITHUB_ORGS_MAP = 'staging=prod';
      const res = await app.request('http://w/lfs/staging/hub/', {
        headers: { Authorization: basic('x-access-token', 'ghs_prod_token') },
      });
      expect(res.status).toBe(401);
      expect(declaredLfsPrefix).not.toHaveBeenCalled();
    });

    test('ignores entries pointing at another target', async () => {
      stagingPushesToProd();
      testVars.GITHUB_ORGS_MAP = 'staging=elsewhere';
      const res = await app.request(PROD_URL, auth);
      expect(res.status).toBe(401);
      expect(declaredLfsPrefix).not.toHaveBeenCalled();
    });

    test('ignores an entry mapping an org to itself', async () => {
      stagingPushesToProd();
      testVars.GITHUB_ORGS_MAP = 'prod=prod';
      const res = await app.request(PROD_URL, auth);
      expect(res.status).toBe(401);
      expect(declaredLfsPrefix).not.toHaveBeenCalled();
    });

    test('costs nothing when the caller already has push on the target', async () => {
      stagingPushesToProd();
      mockState.writeOwners = ['prod', 'staging'];
      const res = await app.request(PROD_URL, auth);
      expect(res.status).toBe(200);
      expect(declaredLfsPrefix).not.toHaveBeenCalled();
    });

    // The grouped map is memoized per isolate, keyed by the raw var.
    test('picks up a changed map without a restart', async () => {
      stagingPushesToProd();
      expect((await app.request(PROD_URL, auth)).status).toBe(200);
      testVars.GITHUB_ORGS_MAP = 'staging=elsewhere';
      expect((await app.request(PROD_URL, auth)).status).toBe(401);
    });

    test('throws on more than five map entries', async () => {
      stagingPushesToProd();
      testVars.GITHUB_ORGS_MAP = 'a=prod b=prod c=prod d=prod e=prod f=prod';
      expect((await app.request(PROD_URL, auth)).status).toBe(500);
    });
  });
});
