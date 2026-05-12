import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_MODEL, VERSION, type Verdict } from '@dispatch-ai/shared';

export { DEFAULT_MODEL, VERSION };
export { requestAnthropicJson } from './anthropic.ts';
export {
  runSandboxedSubprocessStep,
  runSubprocessStep,
  withSandboxedWorkingCopy,
} from './executor.ts';
export { createPullRequest } from './github.ts';
export { runDispatch } from './orchestrator.ts';
export { InMemoryRunStore, SqliteRunStore } from './state.ts';

export type ApprovalDecision = 'approve' | 'edit-prompt' | 'reject';
export type RunAction = 'continue' | 'prompt' | 'replan' | 'halt';

export interface RunOptions {
  goal: string;
  approvalMode: 'auto' | 'gate-on-warn' | 'gate-every-step';
  docker: boolean;
  unsafeConsentAccepted: boolean;
  noTelemetry: boolean;
  override: boolean;
  maxCostUsd?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
}

export function parseRunArgs(args: string[], consentPath = defaultConsentPath()): RunOptions {
  if (args[0] !== 'run') {
    throw new Error('Unknown command. Usage: dispatch run "<goal>"');
  }

  const maxCostUsd = readNumberFlag(args, '--max-cost-usd');
  const goal = findGoal(args);
  if (!goal) {
    throw new Error('Missing goal. Usage: dispatch run "<goal>"');
  }

  const approvalMode = args.includes('--auto')
    ? 'auto'
    : args.includes('--gate-every-step')
      ? 'gate-every-step'
      : 'gate-on-warn';

  const parsed: RunOptions = {
    goal,
    approvalMode,
    docker: args.includes('--docker'),
    unsafeConsentAccepted: args.includes('--i-know-what-im-doing') || hasAutoConsent(consentPath),
    noTelemetry: args.includes('--no-telemetry'),
    override: args.includes('--override'),
  };
  if (maxCostUsd !== undefined) {
    parsed.maxCostUsd = maxCostUsd;
  }
  return parsed;
}

function findGoal(args: string[]): string | undefined {
  const flagsWithValues = new Set(['--max-cost-usd']);
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (flagsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      return arg;
    }
  }
  return undefined;
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const raw = args[index + 1];
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number.`);
  }
  return parsed;
}

export function validateSafety(options: RunOptions): void {
  if (options.approvalMode === 'auto' && !options.docker && !options.unsafeConsentAccepted) {
    throw new Error(
      '--auto requires --docker or first-run consent. Re-run with --docker, or type consent with dispatch consent-auto.',
    );
  }
}

export function parseApprovalDecision(input: string): ApprovalDecision {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'approve' || normalized === 'a') {
    return 'approve';
  }
  if (normalized === 'edit-prompt' || normalized === 'edit' || normalized === 'e') {
    return 'edit-prompt';
  }
  if (normalized === 'reject' || normalized === 'r') {
    return 'reject';
  }
  throw new Error('Expected approve, edit-prompt, or reject.');
}

export function nextVerificationAction(
  verdict: Verdict,
  approvalMode: RunOptions['approvalMode'],
  replanAttempts: number,
  override: boolean,
): RunAction {
  if (override) {
    return 'continue';
  }
  if (verdict === 'pass') {
    return approvalMode === 'gate-every-step' ? 'prompt' : 'continue';
  }
  if (verdict === 'warn') {
    return approvalMode === 'auto' ? 'continue' : 'prompt';
  }
  return replanAttempts >= 3 ? 'halt' : 'replan';
}

export async function checkGhCli(runner: ProcessRunner): Promise<void> {
  const version = await runner.run('gh', ['--version']);
  if (version.exitCode !== 0) {
    throw new Error('GitHub CLI not found. Install it from https://cli.github.com/.');
  }

  const auth = await runner.run('gh', ['auth', 'status']);
  if (auth.exitCode !== 0) {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
  }
}

export function hasAutoConsent(path = defaultConsentPath()): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { accepted?: boolean };
    return parsed.accepted === true;
  } catch {
    return false;
  }
}

export function recordAutoConsent(input: string, path = defaultConsentPath()): boolean {
  if (input.trim() !== 'I accept') {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ accepted: true, acceptedAt: new Date().toISOString() }, null, 2),
  );
  return true;
}

export function defaultConsentPath(): string {
  return join(homedir(), '.dispatch', 'consent.json');
}
