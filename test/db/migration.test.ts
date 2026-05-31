import { env, WorkflowStep } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, test } from "vitest";

import { Migration, v1 } from "../../src/db/migration";

afterEach(async () => {
  await reset();
});

// Pass-through step: the migration logic is the same whether the Workflow
// runtime memoizes each step or (here) just runs it once.
const step = {
  do: <T,>(_name: string, fn: () => Promise<T>) => fn(),
} as unknown as WorkflowStep;

const OID = "a".repeat(64);

function registry() {
  return env.REPOS.getByName("global");
}

async function keys(prefix: string): Promise<string[]> {
  const { objects } = await env.LFS_BUCKET.list({ prefix });
  return objects.map((o) => o.key);
}

// ---------------------------------------------------------------------------
// v1 — seed `name` from the real prefix, no byte movement
// ---------------------------------------------------------------------------

describe("v1", () => {
  test("seeds name from the real prefix without moving bytes", async () => {
    await env.LFS_BUCKET.put(`Alice/Repo/${OID}`, "payload");

    await v1(env, step);

    expect(await registry().resolveName("alice", "repo")).toBe("Alice/Repo");
    expect(await registry().getVer("alice", "repo")).toBe(1);
    expect(await keys("Alice/Repo/")).toEqual([`Alice/Repo/${OID}`]);
  });

  test("skips a repo already at the target version", async () => {
    // Pin lowercase first (born at CURRENT_VER), then add objects under a
    // mixed-case prefix. The guard must leave the pinned name untouched.
    await registry().resolveName("alice", "repo");
    await env.LFS_BUCKET.put(`Alice/Repo/${OID}`, "payload");

    await v1(env, step);

    expect(await registry().resolveName("alice", "repo")).toBe("alice/repo");
    expect(await keys("Alice/Repo/")).toEqual([`Alice/Repo/${OID}`]);
  });

  test("a case-split repo pins one name; the other variant's bytes stay put", async () => {
    await env.LFS_BUCKET.put(`Alice/Repo/${OID}`, "one");
    await env.LFS_BUCKET.put(`alice/repo/${"c".repeat(64)}`, "two");

    await v1(env, step);

    // First-writer-wins on the lexicographically-first prefix; no consolidation.
    expect(await registry().resolveName("alice", "repo")).toBe("Alice/Repo");
    expect(await keys("Alice/Repo/")).toEqual([`Alice/Repo/${OID}`]);
    expect(await keys("alice/repo/")).toEqual([`alice/repo/${"c".repeat(64)}`]);
  });

  test("is idempotent: a second run does no work and corrupts nothing", async () => {
    await env.LFS_BUCKET.put(`Alice/Repo/${OID}`, "payload");
    await v1(env, step);
    await v1(env, step);

    expect(await registry().resolveName("alice", "repo")).toBe("Alice/Repo");
    expect(await keys("Alice/Repo/")).toEqual([`Alice/Repo/${OID}`]);
  });
});

// ---------------------------------------------------------------------------
// Migration.run — version dispatch off the event payload
// ---------------------------------------------------------------------------

// The WorkflowEntrypoint constructor rejects a synthetic ctx, and `run` only
// reads `this.env` — so invoke it via the prototype with a minimal `this`.
function run(ver: number) {
  const event = { payload: { ver }, timestamp: new Date(0), instanceId: "test" };
  return Migration.prototype.run.call({ env } as unknown as Migration, event, step);
}

describe("Migration.run", () => {
  test("dispatches ver 1 off the event payload", async () => {
    await env.LFS_BUCKET.put(`Alice/Repo/${OID}`, "payload");

    // Reads event.payload (not .params) and routes ver 1 to the v1 migration.
    await run(1);

    expect(await registry().getVer("alice", "repo")).toBe(1);
  });

  test("throws on an unknown migration", () => {
    expect(() => run(9)).toThrow('unknown migration: {"ver":9}');
  });
});
