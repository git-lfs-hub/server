#!/usr/bin/env bun
/** `bun run dev:seed` — boot the dev server, wait for it, seed it, then leave
 * the dev server running in the foreground. Reuses the `dev` script so the
 * server (and its persist dir) is identical to a plain `bun run dev`.
 */
import { spawn } from 'node:child_process';

const LFS_URL = process.env.LFS_URL ?? 'http://localhost:8787';

// detached: dev gets its own process group so one group-kill on exit tears down
// the whole tree (bun → wrangler → node → workerd), leaving no orphan on 8787.
const dev = spawn('bun', ['run', 'dev'], { stdio: 'inherit', detached: true });

let seed: ReturnType<typeof spawn> | undefined;
let cleanedUp = false;

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
dev.on('exit', (code) => {
  cleanup('SIGTERM');
  process.exit(code ?? 0);
});

function cleanup(sig: NodeJS.Signals): void {
  if (cleanedUp) return;
  cleanedUp = true;
  seed?.kill(sig);
  if (dev.pid) {
    try {
      process.kill(-dev.pid, sig); // negative pid → the whole process group
    } catch {
      // group already gone
    }
  }
}

async function waitReady(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (dev.exitCode !== null) throw new Error('dev server exited before becoming ready');
    try {
      await fetch(LFS_URL);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`dev server not reachable at ${LFS_URL} after 60s`);
}

try {
  await waitReady();
} catch (err) {
  console.error(String(err));
  cleanup('SIGTERM');
  process.exit(1);
}

seed = spawn('bun', ['dev/seed.ts'], { stdio: 'inherit' });
seed.on('exit', (code) => {
  if (code) console.error(`seed exited ${code}`);
});
