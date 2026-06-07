import { WorkerEntrypoint } from 'cloudflare:workers';

import type { LfsServer } from '@git-lfs-hub/lib/contracts';

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
    await this.env.REPOS.getByName('global').block(owner, repo);
  }

  // Undelete: resume normal serving.
  async unblockRepo(owner: string, repo: string): Promise<void> {
    await this.env.REPOS.getByName('global').unblock(owner, repo);
  }

  // Post-R2-purge cleanup: wipe the repo's Locks DO and mark the registry row
  // purged. R2 deletion is owned by the admin worker, not here. Idempotent.
  async purgeRepo(owner: string, repo: string): Promise<void> {
    const registry = this.env.REPOS.getByName('global');
    const name = await registry.resolveName(owner, repo);
    await this.env.LOCKS.getByName(name).purge();
    await registry.markPurged(owner, repo);
  }
}
