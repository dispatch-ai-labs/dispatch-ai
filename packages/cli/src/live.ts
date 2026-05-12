import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { createAnthropicJudge, detectWithJudge } from '@dispatch-ai/detector';
import {
  DEFAULT_MODEL,
  PlanSchema,
  type ReplanInput,
  StepResultSchema,
  type VerificationResult,
} from '@dispatch-ai/shared';
import { z } from 'zod';
import { requestAnthropicJson } from './anthropic.ts';
import { createPullRequest } from './github.ts';
import { type ProcessRunner, type RunOptions, parseApprovalDecision } from './index.ts';
import type {
  ApprovalPrompter,
  DispatchRunOptions,
  Executor,
  Planner,
  Replanner,
  Verifier,
} from './orchestrator.ts';
import { SqliteRunStore } from './state.ts';

const execFileAsync = promisify(execFile);

export interface LiveAdapterOptions {
  apiKey: string;
  repoRoot: string;
  runOptions: RunOptions;
  fetchImpl?: FetchLike;
  createPr?: boolean;
  signal?: AbortSignal;
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export async function createLiveDispatchOptions(
  options: LiveAdapterOptions,
): Promise<DispatchRunOptions> {
  if (options.runOptions.docker) {
    await ensureDockerSandbox();
  }

  const repoRoot = resolve(options.repoRoot);
  const repoContext = collectRepoContext(repoRoot);
  const store = await SqliteRunStore.open(join(homedir(), '.dispatch', 'state.sqlite'));
  const fetchImpl = options.fetchImpl;
  const planner = createPlanner(options.apiKey, repoContext, fetchImpl, options.signal);
  const executor = createExecutor(options.apiKey, repoContext, fetchImpl, options.signal);
  const verifier = createVerifier(options.apiKey, repoRoot, fetchImpl, options.signal);
  const replanner = createReplanner(options.apiKey, repoContext, fetchImpl, options.signal);

  return {
    goal: options.runOptions.goal,
    approvalMode: options.runOptions.approvalMode,
    override: options.runOptions.override,
    artifactDir: repoRoot,
    ...(options.runOptions.maxCostUsd !== undefined
      ? { maxCostUsd: options.runOptions.maxCostUsd }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    planner,
    executor,
    verifier,
    replanner,
    approvals: createTerminalApprovals(),
    store,
    acceptStep: async (_step, result) => {
      if (options.runOptions.docker) {
        await applyVerifiedDiffInDocker(repoRoot, result.diff);
        return;
      }
      await applyVerifiedDiff(repoRoot, result.diff);
    },
  };
}

export function createPlanner(
  apiKey: string,
  repoContext: string,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Planner {
  return {
    async createPlan(goal) {
      const raw = await requestAnthropicJson<unknown>({
        apiKey,
        repoContext,
        ...(signal ? { signal } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
        systemPrompt:
          'You are dispatch.ai planner. Return JSON only matching {goal, summary?, steps:[{id,intent,expectedOutputs,verificationCriteria}]} with 1-8 concrete steps.',
        userPrompt: `Goal:\n${goal}`,
      });
      return PlanSchema.parse(raw);
    },
  };
}

export function createExecutor(
  apiKey: string,
  repoContext: string,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Executor {
  return {
    async execute(step) {
      const raw = await requestAnthropicJson<unknown>({
        apiKey,
        repoContext,
        ...(signal ? { signal } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
        systemPrompt:
          'You are dispatch.ai step executor. Return JSON only matching {stepId,status,diff,log}. diff must be a unified git diff. Do not include placeholders.',
        userPrompt: `Step id: ${step.id}\nIntent:\n${step.intent}\nExpected outputs:\n${step.expectedOutputs.join('\n')}`,
      });
      return StepResultSchema.parse(raw);
    },
  };
}

export function createVerifier(
  apiKey: string,
  repoRoot: string,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Verifier {
  return {
    async verify(step, result): Promise<VerificationResult> {
      return await detectWithJudge(
        result.diff,
        step.intent,
        createAnthropicJudge({
          apiKey,
          model: DEFAULT_MODEL,
          ...(signal ? { signal } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
        }),
        { repoRoot },
      );
    },
  };
}

export function createReplanner(
  apiKey: string,
  repoContext: string,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Replanner {
  return {
    async replan(input: ReplanInput) {
      const raw = await requestAnthropicJson<unknown>({
        apiKey,
        repoContext,
        ...(signal ? { signal } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
        systemPrompt:
          'You are dispatch.ai replanner. Return JSON only as {"abort":true} or {"steps":[{id,intent,expectedOutputs,verificationCriteria}]}. Do not repeat failed placeholder behavior.',
        userPrompt: JSON.stringify(input),
      });
      const parsed = ReplanResponseSchema.parse(raw);
      return parsed.abort ? 'abort' : parsed.steps;
    },
  };
}

export async function maybeCreateRunPullRequest(
  createPr: boolean,
  runner: ProcessRunner,
  title: string,
  body: string,
): Promise<string | null> {
  if (!createPr) {
    return null;
  }
  return await createPullRequest(runner, { title, body, draft: true });
}

export function createTerminalApprovals(): ApprovalPrompter {
  return {
    async approvePlan(plan) {
      if (!process.stdin.isTTY) {
        return 'approve';
      }
      console.log(JSON.stringify(plan, null, 2));
      return promptDecision('Approve plan? approve/edit-prompt/reject: ');
    },
    async approveWarn(_step, verification) {
      if (!process.stdin.isTTY) {
        return 'reject';
      }
      console.log(JSON.stringify(verification, null, 2));
      return promptDecision('Verifier warned. approve/edit-prompt/reject: ');
    },
    async approveStep(_step, result) {
      if (!process.stdin.isTTY) {
        return 'approve';
      }
      console.log(result.diff);
      return promptDecision('Approve step diff? approve/edit-prompt/reject: ');
    },
  };
}

export async function ensureDockerSandbox(): Promise<void> {
  try {
    await execFileAsync('docker', [
      'image',
      'inspect',
      'ghcr.io/dispatch-ai-labs/dispatch-sandbox:latest',
    ]);
  } catch {
    await execFileAsync('docker', ['pull', 'ghcr.io/dispatch-ai-labs/dispatch-sandbox:latest']);
  }
}

export async function applyVerifiedDiff(repoRoot: string, diff: string): Promise<void> {
  if (diff.trim().length === 0) {
    throw new Error('Cannot apply an empty verified diff.');
  }

  await runGitApply(repoRoot, ['apply', '--check', '-'], diff);
  await runGitApply(repoRoot, ['apply', '-'], diff);
}

export async function applyVerifiedDiffInDocker(repoRoot: string, diff: string): Promise<void> {
  if (diff.trim().length === 0) {
    throw new Error('Cannot apply an empty verified diff.');
  }

  const checkArgs = dockerApplyArgs(repoRoot, ['apply', '--check', '-']);
  const applyArgs = dockerApplyArgs(repoRoot, ['apply', '-']);
  await runDockerGitApply(checkArgs, diff);
  await runDockerGitApply(applyArgs, diff);
}

export function dockerApplyArgs(repoRoot: string, gitArgs: string[]): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '-v',
    `${repoRoot}:/workspace`,
    '-w',
    '/workspace',
    'ghcr.io/dispatch-ai-labs/dispatch-sandbox:latest',
    'git',
    ...gitArgs,
  ];
}

async function runGitApply(repoRoot: string, args: string[], diff: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoRoot, stdio: ['pipe', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Verified diff could not be applied cleanly: ${Buffer.concat(stderr).toString('utf8')}`,
        ),
      );
    });
    child.stdin.end(diff);
  });
}

async function runDockerGitApply(args: string[], diff: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Verified diff could not be applied in Docker: ${Buffer.concat(stderr).toString('utf8')}`,
        ),
      );
    });
    child.stdin.end(diff);
  });
}

function collectRepoContext(repoRoot: string): string {
  const files = listFiles(repoRoot).slice(0, 200);
  const manifestSnippets = ['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py']
    .map((file) => {
      const path = join(repoRoot, file);
      return existsSync(path)
        ? `\n--- ${file} ---\n${readFileSync(path, 'utf8').slice(0, 4000)}`
        : '';
    })
    .join('');

  return `Repo root: ${repoRoot}\nFiles:\n${files.join('\n')}\n${manifestSnippets}`.slice(
    0,
    20_000,
  );
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, root, out);
  return out;
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of safeReadDir(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'dist' || entry === '.dispatch') {
      continue;
    }
    const path = join(dir, entry);
    const stat = safeStat(path);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      walk(root, path, out);
    } else if (stat.isFile()) {
      out.push(relative(root, path));
    }
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

async function promptDecision(prompt: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return parseApprovalDecision(await rl.question(prompt));
  } finally {
    rl.close();
  }
}

const ReplanResponseBaseSchema = z.object({
  abort: z.boolean().optional(),
  steps: PlanSchema.shape.steps.optional(),
});

const ReplanResponseSchema = ReplanResponseBaseSchema.transform(
  (value: z.infer<typeof ReplanResponseBaseSchema>) =>
    value.abort
      ? { abort: true as const, steps: [] }
      : { abort: false as const, steps: value.steps ?? [] },
);
