import { env } from "cloudflare:workers";
import { describe, test, expect } from "vitest";
import type { AdminEntrypoint } from "../../../gc/src/server/admin-entrypoint";

describe("LFS_GC service binding", () => {
  test("ingest RPC is callable", async () => {
    const admin = env.LFS_GC as unknown as Service<AdminEntrypoint>;
    await expect(
      admin.ingest({ owner: "alice", repo: "repo", oid: "abc123", size: 42, event: "upload" }),
    ).resolves.toBeUndefined();
  });
});
