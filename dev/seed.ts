#!/usr/bin/env bun
/**
 * Seed script — populates the dev LFS server with test objects.
 *
 * Full LFS flow for all files (batch → presigned PUT → verify). Large files
 * upload a 64-byte stub body, then patch miniflare's R2 metadata so HEAD
 * reports the declared size (avoids writing real multi-MB blobs).
 *
 * Env:
 *   LFS_URL — server endpoint (default: http://localhost:8787)
 */
import { generateContent, sha256hex, lfsFetch, stubLargeObject } from './seed.lib';

const LFS_URL = process.env.LFS_URL ?? 'http://localhost:8787';
const AUTH = `Basic ${btoa(':dev')}`;
const LARGE_THRESHOLD = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FileSpec {
  seed: string;
  size: number;
}

const FIXTURES: { owner: string; repo: string; files: FileSpec[] }[] = [
  {
    owner: 'acme',
    repo: 'webapp',
    files: [
      { seed: 'readme', size: 1024 },
      { seed: 'logo', size: 2048 },
      { seed: 'font-bold', size: 4096 },
      { seed: 'font-regular', size: 3072 },
      { seed: 'bg-image', size: 8192 },
    ],
  },
  {
    owner: 'acme',
    repo: 'mobile-app',
    files: Array.from({ length: 12 }, (_, i) => ({
      seed: `asset-${i}`,
      size: 1024 * (1 + (i % 8)),
    })),
  },
  {
    owner: 'acme',
    repo: 'design-assets',
    files: [
      ...Array.from({ length: 45 }, (_, i) => ({
        seed: `design-${i}`,
        size: 1024 * (1 + (i % 8)),
      })),
      { seed: 'hero-video', size: 15 * 1024 * 1024 },
      { seed: 'promo-render', size: 25 * 1024 * 1024 },
    ],
  },
  {
    owner: 'acme',
    repo: 'old-project',
    files: [
      { seed: 'data-1', size: 2048 },
      { seed: 'data-2', size: 4096 },
      { seed: 'data-3', size: 1024 },
    ],
  },
  {
    owner: 'acme',
    repo: 'archived-svc',
    files: Array.from({ length: 8 }, (_, i) => ({
      seed: `svc-${i}`,
      size: 1024 * (2 + (i % 4)),
    })),
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

let total = 0;
let stubbed = 0;

for (const { owner, repo, files } of FIXTURES) {
  const objects = files.map((f) => {
    const isLarge = f.size > LARGE_THRESHOLD;
    const content = generateContent(`${owner}/${repo}/${f.seed}`, isLarge ? 64 : f.size);
    return {
      oid: sha256hex(content),
      size: f.size,
      content: content.buffer as ArrayBuffer,
      isLarge,
    };
  });

  const batchRes = await lfsFetch(LFS_URL, AUTH, `/lfs/${owner}/${repo}/objects/batch`, {
    operation: 'upload',
    objects: objects.map(({ oid, size }) => ({ oid, size })),
  });

  if (!batchRes.ok) {
    console.error(`  batch ${owner}/${repo}: ${batchRes.status} ${await batchRes.text()}`);
    continue;
  }

  const { objects: results } = (await batchRes.json()) as {
    objects: {
      oid: string;
      size: number;
      actions?: {
        upload?: { href: string };
        verify?: { href: string };
      };
    }[];
  };

  for (const [i, result] of results.entries()) {
    const obj = objects[i]!;

    if (result.actions?.upload) {
      const putRes = await fetch(result.actions.upload.href, {
        method: 'PUT',
        body: obj.content,
      });
      if (!putRes.ok) {
        console.error(`  upload ${result.oid.slice(0, 12)}: ${putRes.status}`);
        continue;
      }
      if (obj.isLarge) {
        await stubLargeObject(`${owner}/${repo}/${obj.oid}`, obj.size);
        stubbed++;
      }
    }

    if (result.actions?.verify) {
      await lfsFetch(LFS_URL, AUTH, `/lfs/${owner}/${repo}/objects/verify`, {
        oid: result.oid,
        size: result.size,
      });
    }

    total++;
  }

  console.log(`${owner}/${repo}: ${files.length} objects`);
}

console.log(`\nseeded ${FIXTURES.length} repos — ${total} objects (${stubbed} stubbed)`);
