import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessRunner } from './index.ts';
import {
  applyVerifiedDiff,
  createExecutor,
  createPlanner,
  createReplanner,
  dockerApplyArgs,
  maybeCreateRunPullRequest,
} from './live.ts';

test('live planner parses Anthropic plan JSON through PlanSchema', async () => {
  const planner = createPlanner(
    'key',
    'repo context',
    fakeJsonFetch({
      goal: 'add cache',
      steps: [{ id: '1', intent: 'edit file', expectedOutputs: [], verificationCriteria: [] }],
    }),
  );

  const plan = await planner.createPlan('add cache');
  expect(plan.steps[0]?.id).toBe('1');
});

test('live executor parses Anthropic StepResult JSON', async () => {
  const executor = createExecutor(
    'key',
    'repo context',
    fakeJsonFetch({ stepId: '1', status: 'passed', diff: 'diff --git a/a.py b/a.py', log: '' }),
  );

  const result = await executor.execute({
    id: '1',
    intent: 'edit file',
    expectedOutputs: [],
    verificationCriteria: [],
  });
  expect(result.status).toBe('passed');
  expect(result.diff).toContain('diff --git');
});

test('live replanner can return replacement steps or abort', async () => {
  const replanner = createReplanner(
    'key',
    'repo context',
    fakeJsonFetch({
      steps: [
        {
          id: '1a',
          intent: 'retry without placeholder',
          expectedOutputs: [],
          verificationCriteria: [],
        },
      ],
    }),
  );
  const steps = await replanner.replan({
    originalGoal: 'goal',
    plan: {
      goal: 'goal',
      steps: [{ id: '1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] }],
    },
    failedStep: { id: '1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] },
    verifierIssues: [{ line: 1, failureMode: 1, description: 'placeholder' }],
    attempts: 1,
    lastAcceptedRef: 'run',
  });

  expect(steps).not.toBe('abort');
  if (steps === 'abort') {
    throw new Error('Expected replacement steps.');
  }
  expect(steps[0]?.id).toBe('1a');

  const aborting = createReplanner('key', 'repo context', fakeJsonFetch({ abort: true }));
  await expect(
    aborting.replan({
      originalGoal: 'goal',
      plan: {
        goal: 'goal',
        steps: [{ id: '1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] }],
      },
      failedStep: { id: '1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] },
      verifierIssues: [],
      attempts: 1,
      lastAcceptedRef: 'run',
    }),
  ).resolves.toBe('abort');
});

test('maybeCreateRunPullRequest skips or invokes gh helper', async () => {
  let calls = 0;
  const runner: ProcessRunner = {
    async run(_command, args) {
      calls += 1;
      if (args[0] === '--version' || args[0] === 'auth') {
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      }
      return { exitCode: 0, stdout: 'https://github.com/o/r/pull/2\n', stderr: '' };
    },
  };

  await expect(maybeCreateRunPullRequest(false, runner, 'title', 'body')).resolves.toBeNull();
  await expect(maybeCreateRunPullRequest(true, runner, 'title', 'body')).resolves.toBe(
    'https://github.com/o/r/pull/2',
  );
  expect(calls).toBe(3);
});

test('live planner prompt includes repo context manifests', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dispatch-live-'));
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture"}');
  let body = '';
  const planner = createPlanner(
    'key',
    `Repo root: ${repo}\n--- package.json ---\n{"name":"fixture"}`,
    async (_url, init) => {
      body = String(init?.body ?? '');
      return jsonResponse({
        goal: 'goal',
        steps: [{ id: '1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] }],
      });
    },
  );

  await planner.createPlan('goal');
  expect(body).toContain('package.json');
  expect(body).toContain('fixture');
});

test('applyVerifiedDiff checks and applies a unified diff', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dispatch-apply-'));
  await Bun.$`git init`.cwd(repo).quiet();
  await Bun.$`git config user.email test@example.com`.cwd(repo).quiet();
  await Bun.$`git config user.name Test`.cwd(repo).quiet();
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.py'), 'print("old")\n');
  await Bun.$`git add src/app.py`.cwd(repo).quiet();
  await Bun.$`git commit -m init`.cwd(repo).quiet();

  await applyVerifiedDiff(
    repo,
    `diff --git a/src/app.py b/src/app.py
--- a/src/app.py
+++ b/src/app.py
@@ -1 +1 @@
-print("old")
+print("new")
`,
  );

  expect(readFileSync(join(repo, 'src', 'app.py'), 'utf8')).toBe('print("new")\n');
});

test('dockerApplyArgs mounts repo and runs git apply in sandbox image', () => {
  expect(dockerApplyArgs('/repo', ['apply', '--check', '-'])).toEqual([
    'run',
    '--rm',
    '-i',
    '-v',
    '/repo:/workspace',
    '-w',
    '/workspace',
    'ghcr.io/dispatch-ai-labs/dispatch-sandbox:latest',
    'git',
    'apply',
    '--check',
    '-',
  ]);
});

function fakeJsonFetch(payload: unknown) {
  return async () => jsonResponse(payload);
}

function jsonResponse(payload: unknown) {
  return new Response(
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    { status: 200 },
  );
}
