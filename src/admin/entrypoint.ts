import { WorkerEntrypoint } from 'cloudflare:workers';

import type { LfsServer } from '@git-lfs-hub/lib/contracts';

import { Objects } from '../db/objects';
import { Repos } from '../db/repos';

// -----------------------------------------------------------------------------
// Service-binding RPC surface for the GC admin worker. No HTTP admin routes on
// lfs-server — humans use the admin worker, which calls these over the
// LFS_SERVER service binding (entrypoint AdminEntrypoint).
//
// `implements LfsServer` ties this to the shared cross-worker contract: a drift
// from what lfs-admin expects fails this worker's compile.
// -----------------------------------------------------------------------------

export class AdminEntrypoint extends WorkerEntrypoint<CloudflareBindings> implements LfsServer {
  // Soft-delete: block all LFS access for the repo (downloads + uploads → 404).
  async blockRepo(owner: string, repo: string): Promise<void> {
    await Repos.global(this.env).block(owner, repo);
  }

  // Undelete: resume normal serving.
  async unblockRepo(owner: string, repo: string): Promise<void> {
    await Repos.global(this.env).unblock(owner, repo);
  }

  // Post-R2-purge cleanup: wipe the repo's Objects DO and mark the registry row
  // purged. R2 deletion is owned by the admin worker, not here. Idempotent.
  async purgeRepo(owner: string, repo: string): Promise<void> {
    await (await Objects.resolve(this.env, owner, repo)).purge();
    await Repos.global(this.env).markPurged(owner, repo);
  }

  // Per-object soft-delete. Resolve (owner, repo) to the canonical prefix here —
  // same as the repo-level RPCs — rather than trusting a caller-supplied prefix.
  async blockObjects(owner: string, repo: string, oids: string[]): Promise<void> {
    await (await Objects.resolve(this.env, owner, repo)).block(oids);
  }

  async unblockObjects(owner: string, repo: string, oids: string[]): Promise<void> {
    await (await Objects.resolve(this.env, owner, repo)).unblock(oids);
  }

  async purgeObjects(owner: string, repo: string, oids: string[]): Promise<void> {
    await (await Objects.resolve(this.env, owner, repo)).purgeBlocked(oids);
  }
}
