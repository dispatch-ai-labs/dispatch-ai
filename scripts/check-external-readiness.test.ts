import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('external readiness passes when all machine and manual gates are present', () => {
  const fakeBin = mkdtempSync(join(tmpdir(), 'dispatch-external-'));
  writeExecutable(join(fakeBin, 'docker'), '#!/usr/bin/env sh\nexit 0\n');
  writeExecutable(join(fakeBin, 'gh'), '#!/usr/bin/env sh\nexit 0\n');

  const result = Bun.spawnSync([process.execPath, 'run', 'scripts/check-external-readiness.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      ANTHROPIC_API_KEY: 'test-key',
      HOMEBREW_TAP_PAT: 'test-pat',
      NPM_TRUSTED_PUBLISHING_READY: '1',
      LAUNCH_ACCOUNTS_READY: '1',
      DISPATCH_DOMAIN_READY: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout.toString()) as { ready: boolean };
  expect(parsed.ready).toBe(true);
});

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}
