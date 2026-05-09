import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Miniflare } from "miniflare";
import { readFileSync } from "fs";

// Lock ID generation as specified in the plan (matches lfs-test-server's randomLockId).
function randomLockId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SCHEMA = readFileSync(new URL("../sql/locks.sql", import.meta.url), "utf8");

let mf: Miniflare;
let db: any;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: `export default { fetch: () => new Response("ok") }`,
    d1Databases: ["DB"],
  });
  await mf.ready;
  db = await mf.getD1Database("DB");
  // D1's exec() splits on newlines, so multi-line DDL fails.
  // Split on semicolons and run each statement with prepare().run() instead.
  for (const stmt of SCHEMA.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  await db.prepare("DELETE FROM locks").run();
});

// ---------------------------------------------------------------------------

const NOW = "2024-01-01T00:00:00Z";

function mkLock(overrides: Partial<Record<"id" | "owner" | "path" | "repo" | "locked_at", string>> = {}) {
  return {
    id: randomLockId(),
    owner: "alice",
    path: "assets/large.bin",
    repo: "alice/repo",
    locked_at: NOW,
    ...overrides,
  };
}

async function insertLock(lock: ReturnType<typeof mkLock>) {
  return db
    .prepare("INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, ?, ?)")
    .bind(lock.id, lock.owner, lock.path, lock.repo, lock.locked_at)
    .run();
}

// ---------------------------------------------------------------------------

describe("locks table structure", () => {
  test("table exists after schema init", async () => {
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='locks'")
      .first();
    expect(row?.name).toBe("locks");
  });

  test("has exactly the expected columns", async () => {
    const { results } = await db.prepare("PRAGMA table_info(locks)").all();
    const cols = results.map((r: any) => r.name);
    expect(cols).toEqual(["id", "owner", "path", "repo", "locked_at"]);
  });

  test("all columns are NOT NULL", async () => {
    const { results } = await db.prepare("PRAGMA table_info(locks)").all();
    for (const col of results as any[]) {
      expect({ column: col.name, notnull: col.notnull }).toMatchObject({ notnull: 1 });
    }
  });

  test("id is the primary key", async () => {
    const { results } = await db.prepare("PRAGMA table_info(locks)").all();
    const pk = (results as any[]).find((r) => r.pk === 1);
    expect(pk?.name).toBe("id");
  });

  test("UNIQUE (repo, path) index exists", async () => {
    const { results } = await db.prepare("PRAGMA index_list(locks)").all();
    const unique = (results as any[]).find((r) => r.unique === 1);
    expect(unique).toBeDefined();

    const { results: cols } = await db
      .prepare(`PRAGMA index_info(${unique.name})`)
      .all();
    const indexed = (cols as any[]).map((c) => c.name).sort();
    expect(indexed).toEqual(["path", "repo"]);
  });
});

// ---------------------------------------------------------------------------

describe("locks CRUD", () => {
  test("inserts a valid lock and retrieves all fields", async () => {
    const lock = mkLock();
    await insertLock(lock);

    const row = await db
      .prepare("SELECT * FROM locks WHERE id = ?")
      .bind(lock.id)
      .first();
    expect(row).toMatchObject({
      id: lock.id,
      owner: "alice",
      path: "assets/large.bin",
      repo: "alice/repo",
      locked_at: NOW,
    });
  });

  test("DELETE removes the lock", async () => {
    const lock = mkLock();
    await insertLock(lock);
    await db.prepare("DELETE FROM locks WHERE id = ?").bind(lock.id).run();
    const row = await db
      .prepare("SELECT * FROM locks WHERE id = ?")
      .bind(lock.id)
      .first();
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("locks constraints", () => {
  test("UNIQUE (repo, path) rejects duplicate path in same repo", async () => {
    await insertLock(mkLock());
    await expect(insertLock(mkLock())).rejects.toThrow();
  });

  test("UNIQUE (repo, path) allows same path in different repos", async () => {
    await insertLock(mkLock({ repo: "alice/repo-a" }));
    await insertLock(mkLock({ repo: "alice/repo-b" }));
    const { results } = await db.prepare("SELECT * FROM locks").all();
    expect(results).toHaveLength(2);
  });

  test("PRIMARY KEY rejects duplicate lock ID", async () => {
    const id = randomLockId();
    await insertLock(mkLock({ id, path: "file-a.bin" }));
    await expect(insertLock(mkLock({ id, path: "file-b.bin" }))).rejects.toThrow();
  });

  test.each([
    ["owner",     "INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, NULL, ?, ?, ?)", [randomLockId(), "p.bin", "r/r", NOW]],
    ["path",      "INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, NULL, ?, ?)", [randomLockId(), "alice", "r/r", NOW]],
    ["repo",      "INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, NULL, ?)", [randomLockId(), "alice", "p.bin", NOW]],
    ["locked_at", "INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, ?, NULL)", [randomLockId(), "alice", "p.bin", "r/r"]],
  ])("NOT NULL on %s", async (_col, sql, args) => {
    await expect(db.prepare(sql).bind(...args).run()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("locks ordering", () => {
  test("ORDER BY locked_at, id returns chronological order", async () => {
    const t1 = "2024-01-01T00:00:00Z";
    const t2 = "2024-01-02T00:00:00Z";
    const t3 = "2024-01-03T00:00:00Z";
    // Insert deliberately out of order.
    await insertLock(mkLock({ path: "c.bin", locked_at: t3 }));
    await insertLock(mkLock({ path: "a.bin", locked_at: t1 }));
    await insertLock(mkLock({ path: "b.bin", locked_at: t2 }));

    const { results } = await db
      .prepare("SELECT path FROM locks WHERE repo = ? ORDER BY locked_at, id")
      .bind("alice/repo")
      .all();
    expect((results as any[]).map((r) => r.path)).toEqual(["a.bin", "b.bin", "c.bin"]);
  });
});

// ---------------------------------------------------------------------------

describe("randomLockId", () => {
  test("produces a 40-character lowercase hex string", () => {
    const id = randomLockId();
    expect(id).toHaveLength(40);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  test("produces unique IDs across 1000 calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, randomLockId));
    expect(ids.size).toBe(1000);
  });
});
