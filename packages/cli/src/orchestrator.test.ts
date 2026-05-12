import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Step, StepResult, VerificationResult } from '@dispatch-ai/shared';
import {
  type Executor,
  type Planner,
  type Replanner,
  type Verifier,
  runDispatch,
} from './orchestrator.ts';
import { InMemoryRunStore } from './state.ts';

const oneStepPlan: Planner = {
  async createPlan(goal) {
    return {
      goal,
      steps: [step('1', 'change file')],
    };
  },
};

test('happy path executes and verifies all planned steps', async () => {
  const store = new InMemoryRunStore();
  let accepted = false;
  const summary = await runDispatch({
    goal: 'add caching',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: mkdtempSync(join(tmpdir(), 'dispatch-artifacts-')),
    planner: oneStepPlan,
    executor: executor([{ status: 'passed', diff: 'diff --git a/a.py b/a.py', log: '' }]),
    verifier: verifier([{ score: 100, verdict: 'pass', issues: [] }]),
    replanner: noReplan,
    store,
    runId: 'happy',
    acceptStep: async () => {
      accepted = true;
    },
  });

  expect(summary.status).toBe('completed');
  expect(accepted).toBe(true);
  expect(summary.completedSteps).toBe(1);
  expect(store.runs[0]?.status).toBe('completed');
  expect(store.steps).toHaveLength(1);
  expect(store.verifications).toHaveLength(1);
});

test('warn prompts in gate-on-warn and continues when approved', async () => {
  let prompted = false;
  const summary = await runDispatch({
    goal: 'add validation',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: mkdtempSync(join(tmpdir(), 'dispatch-artifacts-')),
    planner: oneStepPlan,
    executor: executor([{ status: 'passed', diff: 'diff --git a/a.py b/a.py', log: '' }]),
    verifier: verifier([{ score: 75, verdict: 'warn', issues: [] }]),
    replanner: noReplan,
    approvals: {
      async approvePlan() {
        return 'approve';
      },
      async approveWarn() {
        prompted = true;
        return 'approve';
      },
      async approveStep() {
        return 'approve';
      },
    },
  });

  expect(prompted).toBe(true);
  expect(summary.status).toBe('completed');
});

test('failed step replans and retries revised step', async () => {
  const store = new InMemoryRunStore();
  const summary = await runDispatch({
    goal: 'recover from placeholder',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: mkdtempSync(join(tmpdir(), 'dispatch-artifacts-')),
    planner: oneStepPlan,
    executor: executor([
      { status: 'passed', diff: 'bad diff', log: '' },
      { status: 'passed', diff: 'good diff', log: '' },
    ]),
    verifier: verifier([
      {
        score: 0,
        verdict: 'fail',
        issues: [{ line: 1, failureMode: 1, description: 'placeholder' }],
      },
      { score: 100, verdict: 'pass', issues: [] },
    ]),
    replanner: {
      async replan() {
        return [step('1-retry', 'replace placeholder')];
      },
    },
    store,
  });

  expect(summary.status).toBe('completed');
  expect(store.replans).toHaveLength(1);
  expect(store.steps.map((step) => step.stepId)).toEqual(['1', '1-retry']);
});

test('hard halt writes manual takeover artifact after replan cap', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'dispatch-artifacts-'));
  const summary = await runDispatch({
    goal: 'keep failing',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: artifactRoot,
    maxReplansPerStep: 1,
    runId: 'halt',
    planner: oneStepPlan,
    executor: executor([
      { status: 'passed', diff: 'bad diff', log: '' },
      { status: 'passed', diff: 'bad diff', log: '' },
    ]),
    verifier: verifier([
      {
        score: 0,
        verdict: 'fail',
        issues: [{ line: 1, failureMode: 1, description: 'placeholder' }],
      },
      {
        score: 0,
        verdict: 'fail',
        issues: [{ line: 1, failureMode: 1, description: 'placeholder again' }],
      },
    ]),
    replanner: {
      async replan(input) {
        return [step(`${input.failedStep.id}-retry`, input.failedStep.intent)];
      },
    },
  });

  expect(summary.status).toBe('halted');
  expect(summary.takeoverDir).toBeDefined();
  const takeover = join(summary.takeoverDir ?? '', 'manual-takeover.json');
  expect(existsSync(takeover)).toBe(true);
  expect(readFileSync(takeover, 'utf8')).toContain('replan loop exhausted');
});

test('max cost budget halts run and writes takeover artifact', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'dispatch-artifacts-'));
  const summary = await runDispatch({
    goal: 'expensive run',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: artifactRoot,
    maxCostUsd: 0.01,
    runId: 'cost',
    planner: oneStepPlan,
    executor: executor([
      { status: 'passed', diff: 'diff --git a/a.py b/a.py', log: '', costUsd: 0.02 },
    ]),
    verifier: verifier([{ score: 100, verdict: 'pass', issues: [], costUsd: 0.01 }]),
    replanner: noReplan,
  });

  expect(summary.status).toBe('halted');
  expect(summary.costSpentUsd).toBeCloseTo(0.03);
  const takeover = join(summary.takeoverDir ?? '', 'manual-takeover.json');
  expect(readFileSync(takeover, 'utf8')).toContain('Cost budget exceeded');
});

test('abort signal halts run with persisted step state and takeover artifact', async () => {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'dispatch-artifacts-'));
  const store = new InMemoryRunStore();
  const controller = new AbortController();
  const summary = await runDispatch({
    goal: 'interrupt run',
    approvalMode: 'gate-on-warn',
    override: false,
    artifactDir: artifactRoot,
    runId: 'interrupt',
    signal: controller.signal,
    planner: oneStepPlan,
    executor: {
      async execute(step, signal) {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return { stepId: step.id, status: 'failed', diff: '', log: 'interrupted' };
      },
    },
    verifier: verifier([{ score: 100, verdict: 'pass', issues: [] }]),
    replanner: noReplan,
    store,
  });

  expect(summary.status).toBe('halted');
  expect(store.runs[0]?.status).toBe('halted');
  expect(store.steps[0]?.status).toBe('failed');
  expect(store.verifications).toHaveLength(0);
  const takeover = join(summary.takeoverDir ?? '', 'manual-takeover.json');
  expect(readFileSync(takeover, 'utf8')).toContain('interrupted');
});

function executor(results: Array<Omit<StepResult, 'stepId'>>): Executor {
  let index = 0;
  return {
    async execute(step) {
      const result = results[index];
      index += 1;
      if (!result) {
        throw new Error('Unexpected execute call.');
      }
      return { stepId: step.id, ...result };
    },
  };
}

function verifier(results: VerificationResult[]): Verifier {
  let index = 0;
  return {
    async verify() {
      const result = results[index];
      index += 1;
      if (!result) {
        throw new Error('Unexpected verify call.');
      }
      return result;
    },
  };
}

const noReplan: Replanner = {
  async replan(): Promise<Step[]> {
    return [];
  },
};

function step(id: string, intent: string): Step {
  return { id, intent, expectedOutputs: [], verificationCriteria: [] };
}
