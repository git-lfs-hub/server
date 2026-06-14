import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

// dev/entry.ts is the lfs-server entry used by lfs-admin's auxiliary worker in
// dev. Miniflare wraps every Durable Object / Workflow class_name declared in
// wrangler config, looking the class up by its exported name. A class declared
// in config but not re-exported here surfaces only at dev-server startup as
// "Class extends value undefined". This guard catches that drift at test time.

const templateSrc = readFileSync(join(import.meta.dirname, '../wrangler.template.jsonc'), 'utf8');
const entrySrc = readFileSync(join(import.meta.dirname, './entry.ts'), 'utf8');

/** class_names of Durable Objects + Workflows declared in the worker config. */
const declaredClasses = [...templateSrc.matchAll(/"class_name"\s*:\s*"([A-Za-z0-9_]+)"/g)].map(
  (m) => m[1],
);

/** Names re-exported by dev/entry.ts from the real worker module. */
const reExports = new Set(
  [...entrySrc.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]@\/index['"]/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean)
    // `Foo as Bar` re-exports under the name `Bar`.
    .map((s) =>
      s
        .split(/\s+as\s+/)
        .pop()!
        .trim(),
    ),
);

test('sanity: template declares at least one DO/workflow class', () => {
  expect(declaredClasses.length).toBeGreaterThan(0);
});

test.each(declaredClasses)('dev/entry.ts re-exports %s declared in wrangler config', (cls) => {
  expect(reExports).toContain(cls);
});
