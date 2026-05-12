#!/usr/bin/env node
import {
  DEFAULT_MODEL,
  VERSION,
  parseRunArgs,
  recordAutoConsent,
  validateSafety,
} from './index.ts';
import { createLiveDispatchOptions, maybeCreateRunPullRequest } from './live.ts';
import { runDispatch } from './orchestrator.ts';

const args = process.argv.slice(2);
const abortController = new AbortController();
process.once('SIGINT', () => {
  abortController.abort();
  console.error('Interrupted. Halting dispatch run and preserving state...');
});

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`dispatch v${VERSION}

Usage:
  dispatch run "<goal>" [--gate-on-warn] [--gate-every-step]
  dispatch run "<goal>" --auto --docker
  dispatch consent-auto

Default model: ${DEFAULT_MODEL}
Default approval mode: --gate-on-warn`);
  process.exit(0);
}

try {
  if (args[0] === 'consent-auto') {
    const input = await readStdin();
    if (!recordAutoConsent(input)) {
      throw new Error('Consent not recorded. Type exactly: I accept');
    }
    console.log('Auto-mode consent recorded.');
    process.exit(0);
  }

  const options = parseRunArgs(args);
  validateSafety(options);

  if (process.env.DISPATCH_FAKE_RUN === '1') {
    const summary = await runDispatch({
      goal: options.goal,
      approvalMode: options.approvalMode,
      override: options.override,
      signal: abortController.signal,
      ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}),
      artifactDir: process.cwd(),
      planner: {
        async createPlan(goal) {
          return {
            goal,
            steps: [
              {
                id: '1',
                intent: 'fake CI step',
                expectedOutputs: ['diff'],
                verificationCriteria: ['pass verifier'],
              },
            ],
          };
        },
      },
      executor: {
        async execute(step) {
          return {
            stepId: step.id,
            status: 'passed',
            diff: 'diff --git a/app.py b/app.py\n@@ -1,1 +1,2 @@\n+print("ok")\n',
            log: '',
          };
        },
      },
      verifier: {
        async verify() {
          return { score: 100, verdict: 'pass', issues: [] };
        },
      },
      replanner: {
        async replan() {
          return 'abort';
        },
      },
    });
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.status === 'completed' ? 0 : 1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for live dispatch runs. Set DISPATCH_FAKE_RUN=1 for CI.',
    );
  }

  const liveOptions = await createLiveDispatchOptions({
    apiKey: process.env.ANTHROPIC_API_KEY,
    repoRoot: process.cwd(),
    runOptions: options,
    signal: abortController.signal,
  });
  const summary = await runDispatch(liveOptions);
  const prUrl = await maybeCreateRunPullRequest(
    summary.status === 'completed',
    {
      async run(command, commandArgs) {
        const { spawnSync } = await import('node:child_process');
        const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
        return {
          exitCode: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        };
      },
    },
    `dispatch.ai run: ${options.goal}`,
    `Verifier run ${summary.runId} completed with ${summary.completedSteps} step(s).`,
  );
  console.log(JSON.stringify({ ...summary, prUrl }, null, 2));
  process.exit(summary.status === 'completed' ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
