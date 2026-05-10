import { describe, test, expect, afterEach } from "vitest";
import { env, reset } from "cloudflare:test";

afterEach(async () => {
  await reset();
});

describe("R2 binding (LFS_BUCKET)", () => {
  test("put stores an object", async () => {
    await env.LFS_BUCKET.put("alice/repo/abc", "hello");
    const obj = await env.LFS_BUCKET.head("alice/repo/abc");
    expect(obj).not.toBeNull();
    expect(obj?.size).toBe(5);
  });

  test("head returns null for missing key", async () => {
    const obj = await env.LFS_BUCKET.head("missing");
    expect(obj).toBeNull();
  });

  test("get returns correct body", async () => {
    await env.LFS_BUCKET.put("alice/repo/abc", "hello");
    const obj = await env.LFS_BUCKET.get("alice/repo/abc");
    expect(obj).not.toBeNull();
    expect(await obj?.text()).toBe("hello");
  });

  test("get returns null for missing key", async () => {
    const obj = await env.LFS_BUCKET.get("missing");
    expect(obj).toBeNull();
  });

  test("list returns all stored keys", async () => {
    await env.LFS_BUCKET.put("alice/repo/aaa", "1");
    await env.LFS_BUCKET.put("alice/repo/bbb", "2");
    const result = await env.LFS_BUCKET.list();
    expect(result.objects.map((o) => o.key).sort()).toEqual([
      "alice/repo/aaa",
      "alice/repo/bbb",
    ]);
  });

  test("delete removes the object", async () => {
    await env.LFS_BUCKET.put("alice/repo/abc", "hello");
    await env.LFS_BUCKET.delete("alice/repo/abc");
    const obj = await env.LFS_BUCKET.head("alice/repo/abc");
    expect(obj).toBeNull();
  });
});
