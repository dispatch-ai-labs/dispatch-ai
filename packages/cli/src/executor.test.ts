import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runSandboxedSubprocessStep,
  runSubprocessStep,
  withSandboxedWorkingCopy,
} from './executor.ts';

test('subprocess executor captures stdout diff on success', async () => {
  const result = await runSubprocessStep('1', {
    command: process.execPath,
    args: ['-e', 'console.log("diff --git a/a.py b/a.py")'],
    cwd: mkdtempSync(join(tmpdir(), 'dispatch-exec-')),
  });

  expect(result.status).toBe('passed');
  expect(result.diff).toContain('diff --git');
});

test('subprocess executor kills timeout cleanly', async () => {
  const result = await runSubprocessStep('1', {
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10_000)'],
    cwd: mkdtempSync(join(tmpdir(), 'dispatch-exec-')),
    timeoutMs: 25,
  });

  expect(result.status).toBe('timed-out');
});

test('subprocess executor kills child on abort signal', async () => {
  const controller = new AbortController();
  const promise = runSubprocessStep('1', {
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10_000)'],
    cwd: mkdtempSync(join(tmpdir(), 'dispatch-exec-')),
    timeoutMs: 10_000,
    signal: controller.signal,
  });

  controller.abort();
  const result = await promise;

  expect(result.status).toBe('failed');
  expect(result.log).toContain('interrupted');
});

test('sandboxed working copy isolates file writes and cleans up', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dispatch-source-'));
  await Bun.$`git init`.cwd(repo).quiet();
  await Bun.$`git config user.email test@example.com`.cwd(repo).quiet();
  await Bun.$`git config user.name Test`.cwd(repo).quiet();
  writeFileSync(join(repo, 'app.py'), 'print("source")\n');
  await Bun.$`git add app.py`.cwd(repo).quiet();
  await Bun.$`git commit -m init`.cwd(repo).quiet();

  let sandboxPath = '';
  await withSandboxedWorkingCopy({ repoRoot: repo }, async (workingCopy) => {
    sandboxPath = workingCopy;
    writeFileSync(join(workingCopy, 'app.py'), 'print("sandbox")\n');
    expect(readFileSync(join(repo, 'app.py'), 'utf8')).toBe('print("source")\n');
  });

  expect(readFileSync(join(repo, 'app.py'), 'utf8')).toBe('print("source")\n');
  expect(existsSync(sandboxPath)).toBe(false);
});

test('sandboxed subprocess runs inside disposable working copy', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dispatch-source-'));
  await Bun.$`git init`.cwd(repo).quiet();
  await Bun.$`git config user.email test@example.com`.cwd(repo).quiet();
  await Bun.$`git config user.name Test`.cwd(repo).quiet();
  writeFileSync(join(repo, 'app.py'), 'print("source")\n');
  await Bun.$`git add app.py`.cwd(repo).quiet();
  await Bun.$`git commit -m init`.cwd(repo).quiet();

  const result = await runSandboxedSubprocessStep('1', {
    repoRoot: repo,
    command: process.execPath,
    args: ['-e', 'require("fs").writeFileSync("app.py", "changed\\n"); console.log("diff")'],
  });

  expect(result.status).toBe('passed');
  expect(result.diff).toContain('diff');
  expect(readFileSync(join(repo, 'app.py'), 'utf8')).toBe('print("source")\n');
});
