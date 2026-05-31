import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, afterEach } from "vitest";

afterEach(async () => {
  await reset();
});

function registry() {
  return env.REPOS.getByName("global");
}

// ---------------------------------------------------------------------------
// resolveName — first-writer-wins, case-insensitive identity
// ---------------------------------------------------------------------------

describe("resolveName", () => {
  test("returns the request case on first access", async () => {
    expect(await registry().resolveName("Alice", "Repo")).toBe("Alice/Repo");
  });

  test("later request in a different case reads the pinned name", async () => {
    await registry().resolveName("Alice", "Repo");
    expect(await registry().resolveName("alice", "repo")).toBe("Alice/Repo");
  });

  test("lowercase-first then mixed-case both resolve to one row", async () => {
    expect(await registry().resolveName("alice", "repo")).toBe("alice/repo");
    expect(await registry().resolveName("Alice", "Repo")).toBe("alice/repo");
  });

  test("strips a trailing .git before pinning", async () => {
    expect(await registry().resolveName("Alice", "Repo.git")).toBe(
      "Alice/Repo",
    );
    expect(await registry().resolveName("alice", "repo")).toBe("Alice/Repo");
  });

  test("distinct repos pin independent names", async () => {
    expect(await registry().resolveName("Alice", "One")).toBe("Alice/One");
    expect(await registry().resolveName("Alice", "Two")).toBe("Alice/Two");
  });
});

// ---------------------------------------------------------------------------
// ver (Part B guard)
// ---------------------------------------------------------------------------

describe("migration version", () => {
  test("defaults to 0 for a freshly pinned repo", async () => {
    await registry().resolveName("Alice", "Repo");
    expect(await registry().getVer("alice", "repo")).toBe(0);
  });

  test("setVer stamps a row read back case-insensitively", async () => {
    await registry().resolveName("Alice", "Repo");
    await registry().setVer("Alice", "Repo", 1);
    expect(await registry().getVer("alice", "repo")).toBe(1);
  });

  test("getVer is 0 for an unknown repo", async () => {
    expect(await registry().getVer("ghost", "repo")).toBe(0);
  });
});
