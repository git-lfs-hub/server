import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// The node `unit` project can't resolve the `cloudflare:workers` virtual module,
// so modules that extend its base classes (DOs, entrypoints) fail to import. Alias
// it to a no-op stub for import-only unit tests; workers-pool projects are unaffected.
const here = dirname(fileURLToPath(import.meta.url));
const workersStub = resolve(here, 'src/test/cloudflare-workers-stub.ts');

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: { 'cloudflare:workers': workersStub },
        },
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'dev/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './test/wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          exclude: ['test/sentry/**'],
          // vitest-pool-workers cold-starts can exceed 5s on the first fetches.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './test/sentry/wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'integration-sentry',
          include: ['test/sentry/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'scripts',
          include: ['scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'istanbul', // v8 isn't supported by vitest-pool-workers
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'lcov'],
      exclude: ['test'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 90,
        lines: 95,
      },
    },
  },
});
