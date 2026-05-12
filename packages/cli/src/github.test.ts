import { expect, test } from 'bun:test';
import { createPullRequest } from './github.ts';
import type { ProcessRunner } from './index.ts';

test('createPullRequest invokes gh pr create and returns URL', async () => {
  const calls: string[][] = [];
  const runner: ProcessRunner = {
    async run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === '--version' || args[0] === 'auth') {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: 'https://github.com/o/r/pull/1\n', stderr: '' };
    },
  };

  await expect(
    createPullRequest(runner, { title: 'dispatch run', body: 'verifier report', draft: true }),
  ).resolves.toBe('https://github.com/o/r/pull/1');
  expect(calls.at(-1)).toEqual([
    'gh',
    'pr',
    'create',
    '--title',
    'dispatch run',
    '--body',
    'verifier report',
    '--draft',
  ]);
});
