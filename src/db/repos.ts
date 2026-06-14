import { DurableObject } from 'cloudflare:workers';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

import { repos, CURRENT_VER, RepoState } from './repos-schema';

// Singleton registry (addressed `getByName("global")`): one `repos` row per
// repo, keyed by lowercase (owner, repo), pinning a canonical `name` — the R2
// key prefix and LOCKS DO name. Every case variant of a request maps to the
// same row and converges on one prefix / one lock DO.
export class Repos extends DurableObject {
  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS repos (
          owner   TEXT NOT NULL,
          repo    TEXT NOT NULL,
          name    TEXT NOT NULL,
          ver     INTEGER NOT NULL DEFAULT 0,
          state   TEXT NOT NULL DEFAULT 'active',
          PRIMARY KEY (owner, repo)
        )
      `);
      // Backfill `state` on DOs created before block/unblock existed.
      try {
        this.ctx.storage.sql.exec(
          `ALTER TABLE repos ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`,
        );
      } catch {
        // column already exists
      }
    });
  }

  // Pins the canonical `name` on first access (first-writer-wins) and returns it.
  async resolveName(owner: string, repo: string): Promise<string> {
    const candidate = `${owner}/${repo.replace(/\.git$/, '')}`;
    // No-op set keeps the existing name on conflict, but makes RETURNING emit the
    // row in one query (DO NOTHING returns nothing on conflict).
    // New repos are born at CURRENT_VER — created now, they have nothing to
    // migrate, so the backfill skips them. Pre-existing rows (none, or seeded
    // by the backfill) keep the column's 0 floor and get migrated up.
    const [row] = await this.db
      .insert(repos)
      .values({ ...identity(owner, repo), name: candidate, ver: CURRENT_VER })
      .onConflictDoUpdate({
        target: [repos.owner, repos.repo],
        set: { name: sql`${repos.name}` },
      })
      .returning();
    return row.name;
  }

  async getVer(owner: string, repo: string): Promise<number> {
    const [row] = await this.db
      .select()
      .from(repos)
      .where(rowFilter(identity(owner, repo)));
    return row?.ver ?? 0;
  }

  async setVer(owner: string, repo: string, ver: number): Promise<void> {
    await this.db
      .update(repos)
      .set({ ver: ver })
      .where(rowFilter(identity(owner, repo)));
  }

  // Serve/block state. block/unblock/markPurged no-op when the row is absent
  // (first LFS access creates it via resolveName); blocked + purged both serve 404.
  async block(owner: string, repo: string): Promise<void> {
    await this.setState(owner, repo, 'blocked');
  }

  async unblock(owner: string, repo: string): Promise<void> {
    await this.setState(owner, repo, 'active');
  }

  async markPurged(owner: string, repo: string): Promise<void> {
    await this.setState(owner, repo, 'purged');
  }

  async isBlocked(owner: string, repo: string): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(repos)
      .where(rowFilter(identity(owner, repo)));
    return row?.state === 'blocked' || row?.state === 'purged';
  }

  private async setState(owner: string, repo: string, state: RepoState): Promise<void> {
    await this.db
      .update(repos)
      .set({ state })
      .where(rowFilter(identity(owner, repo)));
  }
}

function identity(owner: string, repo: string) {
  return {
    owner: owner.toLowerCase(),
    repo: repo.replace(/\.git$/, '').toLowerCase(),
  };
}

function rowFilter(id: { owner: string; repo: string }) {
  return and(eq(repos.owner, id.owner), eq(repos.repo, id.repo));
}
