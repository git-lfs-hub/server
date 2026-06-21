import { DurableObject } from 'cloudflare:workers';
import { asc, eq, and, gte, inArray } from 'drizzle-orm';
import { drizzle, DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

import { locks, blocked } from './objects-schema';
import { Repos } from './repos';

export type LockRow = typeof locks.$inferSelect;

// Per-prefix DO (addressed `getByName(prefix)`): owns the prefix's LFS locks and
// its per-object soft-delete blocklist. Every case variant of a repo resolves to
// one canonical prefix, so one DO instance per repo.
export class Objects extends DurableObject {
  // Resolve a repo's canonical prefix (first-writer-wins) and return its DO stub.
  static async resolve(env: CloudflareBindings, owner: string, repo: string) {
    const name = await Repos.global(env).resolveName(owner, repo);
    return env.OBJECTS.getByName(name);
  }

  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS locks (
          id        INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          uuid      TEXT NOT NULL UNIQUE,
          path      TEXT NOT NULL UNIQUE,
          locked_at TEXT NOT NULL,
          owner     TEXT NOT NULL,
          UNIQUE (path)
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS blocked (
          oid TEXT PRIMARY KEY NOT NULL
        )
      `);
    });
  }

  async createLock(owner: string, path: string): Promise<LockRow> {
    const uuid = crypto.randomUUID();
    const locked_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const [row] = await this.db.insert(locks).values({ uuid, path, locked_at, owner }).returning();
    return row;
  }

  async lockByPath(path: string): Promise<LockRow | null> {
    const rows = await this.db.select().from(locks).where(eq(locks.path, path));
    return rows[0];
  }

  async lockById(uuid: string): Promise<LockRow | null> {
    const rows = await this.db.select().from(locks).where(eq(locks.uuid, uuid));
    return rows[0] ?? null;
  }

  async listLocks(opts: {
    uuidFilter: string | null;
    pathFilter: string | null;
    cursor: number | null;
    limit: number;
  }): Promise<LockRow[]> {
    const { pathFilter, uuidFilter, cursor, limit } = opts;

    return await this.db
      .select()
      .from(locks)
      .where(
        and(
          uuidFilter ? eq(locks.uuid, uuidFilter) : undefined,
          pathFilter ? eq(locks.path, pathFilter) : undefined,
          cursor ? gte(locks.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(locks.id))
      .limit(limit);
  }

  async deleteLock(uuid: string): Promise<void> {
    await this.db.delete(locks).where(eq(locks.uuid, uuid));
  }

  // Per-object soft-delete. The prefix is this DO's identity, so callers pass
  // only OIDs. unblock/purgeBlocked are the same row drop, distinct in the contract.
  async block(oids: string[]): Promise<void> {
    if (oids.length === 0) return;
    await this.db
      .insert(blocked)
      .values(oids.map((oid) => ({ oid })))
      .onConflictDoNothing();
  }

  async isBlocked(oid: string): Promise<boolean> {
    const [row] = await this.db.select().from(blocked).where(eq(blocked.oid, oid));
    return !!row;
  }

  async unblock(oids: string[]): Promise<void> {
    await this.removeBlocked(oids);
  }

  async purgeBlocked(oids: string[]): Promise<void> {
    await this.removeBlocked(oids);
  }

  private async removeBlocked(oids: string[]): Promise<void> {
    if (oids.length === 0) return;
    await this.db.delete(blocked).where(inArray(blocked.oid, oids));
  }

  // Destroy the prefix's entire DO (purge cleanup). deleteAll() wipes all storage
  // including the tables; purge is terminal, so we don't recreate the schema — a
  // later access reconstructs it via the constructor. Idempotent.
  async purge(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
