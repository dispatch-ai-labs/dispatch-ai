import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StepResult } from '@dispatch-ai/shared';

export interface SubprocessOptions {
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface WorkingCopyOptions {
  repoRoot: string;
  prefix?: string;
}

export interface SandboxedSubprocessOptions {
  repoRoot: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runSubprocessStep(
  stepId: string,
  options: SubprocessOptions,
): Promise<StepResult> {
  const startedAt = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? 60_000;

  return await new Promise((resolve) => {
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const abort = () => {
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({
        stepId,
        status: 'failed',
        diff: '',
        log: error.message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({
        stepId,
        status: timedOut
          ? 'timed-out'
          : code === 0 && !options.signal?.aborted
            ? 'passed'
            : 'failed',
        diff: Buffer.concat(stdout).toString('utf8'),
        log: options.signal?.aborted
          ? 'Step interrupted by abort signal.'
          : Buffer.concat(stderr).toString('utf8'),
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
  });
}

export async function runSandboxedSubprocessStep(
  stepId: string,
  options: SandboxedSubprocessOptions,
): Promise<StepResult> {
  return await withSandboxedWorkingCopy({ repoRoot: options.repoRoot }, async (workingCopy) => {
    const subprocessOptions: SubprocessOptions = {
      command: options.command,
      cwd: workingCopy,
    };
    if (options.args) {
      subprocessOptions.args = options.args;
    }
    if (options.timeoutMs !== undefined) {
      subprocessOptions.timeoutMs = options.timeoutMs;
    }
    if (options.signal) {
      subprocessOptions.signal = options.signal;
    }
    return await runSubprocessStep(stepId, subprocessOptions);
  });
}

export async function withSandboxedWorkingCopy<T>(
  options: WorkingCopyOptions,
  fn: (workingCopy: string) => Promise<T>,
): Promise<T> {
  const workingCopy = await mkdtemp(join(tmpdir(), options.prefix ?? 'dispatch-worktree-'));
  try {
    await runCommand('git', ['clone', '--quiet', '--no-hardlinks', options.repoRoot, workingCopy], {
      cwd: options.repoRoot,
    });
    return await fn(workingCopy);
  } finally {
    await rm(workingCopy, { recursive: true, force: true });
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(stderr)}`));
    });
  });
}
