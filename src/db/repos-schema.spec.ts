import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, test, expect } from 'vitest';

import { repos } from './repos-schema';

describe('repos table', () => {
  test('declares a composite primary key on (owner, repo)', () => {
    const { primaryKeys } = getTableConfig(repos);
    expect(primaryKeys).toHaveLength(1);
    const cols = primaryKeys[0].columns.map((c) => c.name);
    expect(cols).toEqual(['owner', 'repo']);
  });

  test('ver defaults to 0', () => {
    const { columns } = getTableConfig(repos);
    const ver = columns.find((c) => c.name === 'ver');
    expect(ver?.default).toBe(0);
  });

  test('state defaults to active', () => {
    const { columns } = getTableConfig(repos);
    const state = columns.find((c) => c.name === 'state');
    expect(state?.default).toBe('active');
  });
});
