import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

// -----------------------------------------------------------------------------
// One-off data migrations, run as a Cloudflare Workflow. Durable execution is
// the guard: an instance runs to completion and stops — no perpetual loop, no
// sentinel. The param selects which migration by target ver (1, 2, …); future
// migrations add a case, not a new workflow/binding. Kicked off from the deploy
// pipeline with a fixed instance id (see scripts/trigger-migration.sh).
// -----------------------------------------------------------------------------

export interface MigrationParams {
  ver: number; // target ver, e.g. 1
}

export class Migration extends WorkflowEntrypoint<CloudflareBindings, MigrationParams> {
  run(event: Readonly<WorkflowEvent<MigrationParams>>, step: WorkflowStep) {
    switch (event.payload.ver) {
      case 1:
        return v1(this.env, step);
      default:
        throw new Error(`unknown migration: ${JSON.stringify(event.payload)}`);
    }
  }
}

// `step.do` is the only piece of the Workflow runtime the migrations touch;
// narrowing to it lets tests drive the logic with a trivial pass-through step.
type Step = Pick<WorkflowStep, "do">;

// -----------------------------------------------------------------------------
// v1 — seed `name` from the real R2 prefix for repos that predate the Repos
// registry, so lazy first-access pinning can't mispin (Caveat 2). Migrates each
// repo to ver 1 — a fixed target, never CURRENT_VER (a later v2 bumps that).
// -----------------------------------------------------------------------------

export async function v1(env: CloudflareBindings, step: Step): Promise<void> {
  const VER = 1;
  const registry = env.REPOS.getByName("global");

  // Each stored prefix is one case of a repo. Pin `name` from it via the same
  // resolveName objects/locks resolve through — first-writer-wins, so a repo
  // already pinned (or seen here in another case) keeps its name. No byte
  // movement: existing objects are addressed by the pinned name, not moved.
  const repos = await step.do("discover", () => discoverRepos(env.LFS_BUCKET));

  for (const { owner, repo } of repos) {
    // One step per prefix: the `ver` stamp is the resume point, so a crash
    // re-walks prefixes but does no work on already-done repos.
    await step.do(`repo:${owner}/${repo}`, async () => {
      const o = owner.toLowerCase();
      const r = repo.toLowerCase();
      if ((await registry.getVer(o, r)) >= VER) return;
      await registry.resolveName(owner, repo);
      await registry.setVer(o, r, VER);
    });
  }
}

// Walk `owner/` then `owner/repo/` delimited prefixes (the scan lfs-admin uses).
// Each distinct prefix is one stored case of a repo, in its real R2 case.
async function discoverRepos(bucket: R2Bucket): Promise<{ owner: string; repo: string }[]> {
  const repos: { owner: string; repo: string }[] = [];
  for (const ownerPrefix of await listDelimited(bucket, "")) {
    for (const repoPrefix of await listDelimited(bucket, ownerPrefix)) {
      const name = repoPrefix.slice(0, -1); // drop trailing "/"
      const slash = name.indexOf("/");
      repos.push({ owner: name.slice(0, slash), repo: name.slice(slash + 1) });
    }
  }
  return repos;
}

async function listDelimited(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const prefixes: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await bucket.list({ prefix, delimiter: "/", cursor });
    prefixes.push(...res.delimitedPrefixes);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return prefixes;
}
