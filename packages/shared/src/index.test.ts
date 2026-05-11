import { expect, test } from 'bun:test';
import { DEFAULT_MODEL, VERSION } from './index.ts';

test('VERSION matches package.json', async () => {
  const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json();
  expect(VERSION).toBe(pkg.version);
});

test('DEFAULT_MODEL is pinned and not an alias', () => {
  // Never use unpinned model aliases (Open Q #4 / v2-REV1).
  // Pinned form is "claude-sonnet-<major>-<minor>", not "claude-sonnet" / "claude-latest".
  expect(DEFAULT_MODEL).toMatch(/^claude-sonnet-\d+-\d+$/);
});
