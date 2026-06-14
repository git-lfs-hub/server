import { createHash } from 'crypto';

export function generateContent(seed: string, size: number): Uint8Array {
  const hash = createHash('sha256').update(seed).digest();
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = hash[i % hash.length]!;
  return buf;
}

export function sha256hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function lfsFetch(
  lfsUrl: string,
  auth: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const ct = 'application/vnd.git-lfs+json';
  return fetch(`${lfsUrl}${path}`, {
    method: 'POST',
    headers: { Accept: ct, 'Content-Type': ct, Authorization: auth },
    body: JSON.stringify(body),
  });
}

export async function stubLargeObject(key: string, size: number): Promise<void> {
  // Patch the size in miniflare's R2 SQLite so HEAD returns the declared size
  // instead of the actual stub-body size. R2 HEAD reads from _mf_objects.size,
  // never touches blobs. The `_mf_objects` table lives in the per-bucket DO
  // database (filename is a hash); the sibling `metadata.sqlite` holds only
  // miniflare bookkeeping.
  //
  // Dev R2 state lives under server/.wrangler/state (wrangler default for
  // `bun dev` / `dev/start.ts`; admin's vite dev persists here too). This file
  // is server/dev/seed.lib.ts, so `../` is server/.
  // @ts-expect-error bun:sqlite is provided by the bun runtime, not the worker tsconfig types
  const { Database } = await import('bun:sqlite');
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../.wrangler/state/v3/r2/miniflare-R2BucketObject/', import.meta.url)
    .pathname;
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error(`No per-bucket R2 sqlite found in ${dir}`);
  const db = new Database(`${dir}${file}`);
  db.run('UPDATE _mf_objects SET size = ? WHERE key = ?', [size, key]);
  db.close();
}
