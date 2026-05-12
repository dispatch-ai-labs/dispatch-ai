import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DetectorIssue,
  type Plan,
  PlanSchema,
  type ReplanInput,
  type Step,
  type StepResult,
  type VerificationResult,
} from '@dispatch-ai/shared';
import { type ApprovalDecision, nextVerificationAction, parseApprovalDecision } from './index.ts';
import { InMemoryRunStore, type RunStore } from './state.ts';

export interface Planner {
  createPlan(goal: string): Promise<Plan>;
}

export interface Executor {
  execute(step: Step, signal?: AbortSignal): Promise<StepResult>;
}

export interface Verifier {
  verify(step: Step, result: StepResult, signal?: AbortSignal): Promise<VerificationResult>;
}

export interface Replanner {
  replan(input: ReplanInput): Promise<Step[] | 'abort'>;
}

export interface ApprovalPrompter {
  approvePlan(plan: Plan): Promise<ApprovalDecision>;
  approveWarn(step: Step, verification: VerificationResult): Promise<ApprovalDecision>;
  approveStep(step: Step, result: StepResult): Promise<ApprovalDecision>;
}

export interface DispatchRunOptions {
  goal: string;
  approvalMode: 'auto' | 'gate-on-warn' | 'gate-every-step';
  override: boolean;
  artifactDir: string;
  maxReplansPerStep?: number;
  maxCostUsd?: number;
  signal?: AbortSignal;
  runId?: string;
  planner: Planner;
  executor: Executor;
  verifier: Verifier;
  replanner: Replanner;
  approvals?: ApprovalPrompter;
  store?: RunStore;
  acceptStep?: (step: Step, result: StepResult, verification: VerificationResult) => Promise<void>;
}

export interface DispatchRunSummary {
  runId: string;
  status: 'completed' | 'halted' | 'rejected';
  completedSteps: number;
  costSpentUsd?: number;
  takeoverDir?: string;
}

const defaultApprovals: ApprovalPrompter = {
  async approvePlan() {
    return 'approve';
  },
  async approveWarn() {
    return 'approve';
  },
  async approveStep() {
    return 'approve';
  },
};

export async function runDispatch(options: DispatchRunOptions): Promise<DispatchRunSummary> {
  const runId = options.runId ?? `dispatch-${Date.now()}`;
  const store = options.store ?? new InMemoryRunStore();
  const approvals = options.approvals ?? defaultApprovals;
  const createdAt = new Date().toISOString();

  store.recordRun({
    id: runId,
    goal: options.goal,
    status: 'running',
    createdAt,
    updatedAt: createdAt,
  });
  if (options.signal?.aborted) {
    store.updateRunStatus(runId, 'halted');
    return haltedRunSummary({
      runId,
      completedSteps: 0,
      costSpentUsd: 0,
      artifactDir: options.artifactDir,
      step: {
        id: 'interrupted',
        intent: options.goal,
        expectedOutputs: [],
        verificationCriteria: [],
      },
      plan: { goal: options.goal, steps: [] },
    });
  }

  const plan = PlanSchema.parse(await options.planner.createPlan(options.goal));
  if (options.signal?.aborted) {
    store.updateRunStatus(runId, 'halted');
    return haltedRunSummary({
      runId,
      completedSteps: 0,
      costSpentUsd: 0,
      artifactDir: options.artifactDir,
      step: plan.steps[0],
      plan,
    });
  }
  const planDecision = await approvals.approvePlan(plan);
  if (planDecision === 'reject') {
    store.updateRunStatus(runId, 'rejected');
    return { runId, status: 'rejected', completedSteps: 0, costSpentUsd: 0 };
  }
  if (planDecision === 'edit-prompt') {
    throw new Error('Plan edit requested. Re-run with the edited prompt.');
  }

  const pending = [...plan.steps];
  let completedSteps = 0;
  let costSpentUsd = 0;

  while (pending.length > 0) {
    if (options.signal?.aborted) {
      store.updateRunStatus(runId, 'halted');
      return haltedRunSummary({
        runId,
        completedSteps,
        costSpentUsd,
        artifactDir: options.artifactDir,
        step: pending[0] ?? plan.steps[0],
        plan,
      });
    }
    const step = pending.shift();
    if (!step) {
      break;
    }

    const stepSummary = await runStepWithReplans({
      ...options,
      runId,
      plan,
      step,
      store,
      approvals,
      maxReplansPerStep: options.maxReplansPerStep ?? 3,
      costSpentUsd,
    });
    costSpentUsd = stepSummary.costSpentUsd;

    if (stepSummary.status === 'completed') {
      completedSteps += 1;
      continue;
    }
    if (stepSummary.status === 'replacement-steps') {
      pending.unshift(...stepSummary.steps);
      continue;
    }

    store.updateRunStatus(runId, 'halted');
    return {
      runId,
      status: 'halted',
      completedSteps,
      costSpentUsd,
      takeoverDir: stepSummary.takeoverDir,
    };
  }

  store.updateRunStatus(runId, 'completed');
  return { runId, status: 'completed', completedSteps, costSpentUsd };
}

type StepRunSummary =
  | ({ status: 'completed' } & StepRunCost)
  | ({ status: 'replacement-steps'; steps: Step[] } & StepRunCost)
  | ({ status: 'halted'; takeoverDir: string } & StepRunCost);

interface StepRunCost {
  costSpentUsd: number;
}

async function runStepWithReplans(options: {
  goal: string;
  runId: string;
  plan: Plan;
  step: Step;
  executor: Executor;
  verifier: Verifier;
  replanner: Replanner;
  approvals: ApprovalPrompter;
  store: RunStore;
  artifactDir: string;
  approvalMode: DispatchRunOptions['approvalMode'];
  override: boolean;
  maxReplansPerStep: number;
  maxCostUsd?: number;
  signal?: AbortSignal;
  costSpentUsd: number;
  acceptStep?: DispatchRunOptions['acceptStep'];
}): Promise<StepRunSummary> {
  let attempts = 0;
  let currentStep = options.step;
  let costSpentUsd = options.costSpentUsd;

  while (attempts <= options.maxReplansPerStep) {
    if (options.signal?.aborted) {
      return interruptedStepSummary(options, currentStep, costSpentUsd);
    }

    const result = await options.executor.execute(currentStep, options.signal);
    options.store.recordStep(options.runId, currentStep, {
      runId: options.runId,
      stepId: currentStep.id,
      status: result.status,
      diff: result.diff,
      log: result.log,
    });
    if (options.signal?.aborted) {
      return interruptedStepSummary(options, currentStep, costSpentUsd);
    }

    const verification =
      result.status === 'timed-out'
        ? timeoutVerification()
        : await options.verifier.verify(currentStep, result, options.signal);
    options.store.recordVerification(options.runId, currentStep.id, verification);
    costSpentUsd += (result.costUsd ?? 0) + (verification.costUsd ?? 0);

    if (options.signal?.aborted) {
      return interruptedStepSummary(options, currentStep, costSpentUsd);
    }

    if (options.maxCostUsd !== undefined && costSpentUsd > options.maxCostUsd) {
      return {
        status: 'halted',
        costSpentUsd,
        takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
          step: currentStep,
          issues: verification.issues,
          plan: options.plan,
          reason: `Cost budget exceeded: spent $${costSpentUsd.toFixed(4)} of $${options.maxCostUsd.toFixed(4)}.`,
        }),
      };
    }

    const action = nextVerificationAction(
      verification.verdict,
      options.approvalMode,
      attempts,
      options.override,
    );

    if (action === 'continue') {
      await options.acceptStep?.(currentStep, result, verification);
      return { status: 'completed', costSpentUsd };
    }
    if (action === 'prompt') {
      const decision =
        verification.verdict === 'warn'
          ? await options.approvals.approveWarn(currentStep, verification)
          : await options.approvals.approveStep(currentStep, result);
      if (decision === 'approve') {
        await options.acceptStep?.(currentStep, result, verification);
        return { status: 'completed', costSpentUsd };
      }
      if (decision === 'edit-prompt') {
        const replacement = await replanOrAbort(
          { ...options, step: currentStep },
          attempts + 1,
          verification.issues,
        );
        if (replacement === 'abort') {
          return {
            status: 'halted',
            costSpentUsd,
            takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
              step: currentStep,
              issues: verification.issues,
              plan: options.plan,
              reason: 'Replanner aborted after edit request.',
            }),
          };
        }
        return {
          status: 'replacement-steps',
          costSpentUsd,
          steps: replacement,
        };
      }
      return {
        status: 'halted',
        costSpentUsd,
        takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
          step: currentStep,
          issues: verification.issues,
          plan: options.plan,
          reason: 'User rejected prompted verification.',
        }),
      };
    }
    if (action === 'halt') {
      return {
        status: 'halted',
        costSpentUsd,
        takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
          step: currentStep,
          issues: verification.issues,
          plan: options.plan,
          reason: 'Verifier failed after maximum replan attempts.',
        }),
      };
    }

    attempts += 1;
    const replacement = await replanOrAbort(
      { ...options, step: currentStep },
      attempts,
      verification.issues,
    );
    if (replacement === 'abort') {
      return {
        status: 'halted',
        costSpentUsd,
        takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
          step: currentStep,
          issues: verification.issues,
          plan: options.plan,
          reason: 'Replanner aborted the run.',
        }),
      };
    }
    if (replacement.length === 1) {
      const [nextStep] = replacement;
      if (!nextStep) {
        continue;
      }
      currentStep = nextStep;
      continue;
    }
    if (replacement.length > 1) {
      return { status: 'replacement-steps', steps: replacement, costSpentUsd };
    }
  }

  return {
    status: 'halted',
    costSpentUsd,
    takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
      step: options.step,
      issues: [],
      plan: options.plan,
      reason: 'Run halted after replan loop exhausted.',
    }),
  };
}

function haltedRunSummary(input: {
  runId: string;
  completedSteps: number;
  costSpentUsd: number;
  artifactDir: string;
  step: Step | undefined;
  plan: Plan;
}): DispatchRunSummary {
  return {
    runId: input.runId,
    status: 'halted',
    completedSteps: input.completedSteps,
    costSpentUsd: input.costSpentUsd,
    takeoverDir: writeTakeoverArtifact(input.artifactDir, input.runId, {
      step:
        input.step ??
        ({
          id: 'interrupted',
          intent: input.plan.goal,
          expectedOutputs: [],
          verificationCriteria: [],
        } satisfies Step),
      issues: [],
      plan: input.plan,
      reason: 'Run interrupted by abort signal.',
    }),
  };
}

function interruptedStepSummary(
  options: {
    runId: string;
    plan: Plan;
    artifactDir: string;
  },
  step: Step,
  costSpentUsd: number,
): StepRunSummary {
  return {
    status: 'halted',
    costSpentUsd,
    takeoverDir: writeTakeoverArtifact(options.artifactDir, options.runId, {
      step,
      issues: [],
      plan: options.plan,
      reason: 'Run interrupted by abort signal.',
    }),
  };
}

async function replanOrAbort(
  options: {
    goal: string;
    runId: string;
    plan: Plan;
    step: Step;
    replanner: Replanner;
    store: RunStore;
  },
  attempt: number,
  issues: DetectorIssue[],
): Promise<Step[] | 'abort'> {
  const issuesJson = JSON.stringify(issues);
  options.store.recordReplan(options.runId, options.step.id, attempt, issuesJson);
  const replanned = await options.replanner.replan({
    originalGoal: options.goal,
    plan: options.plan,
    failedStep: options.step,
    verifierIssues: issues,
    attempts: Math.min(attempt, 3),
    lastAcceptedRef: options.runId,
  });

  return replanned;
}

function writeTakeoverArtifact(
  artifactRoot: string,
  runId: string,
  payload: { step: Step; issues: DetectorIssue[]; plan: Plan; reason: string },
): string {
  const dir = join(artifactRoot, `dispatch-run-${runId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manual-takeover.json'),
    JSON.stringify(
      {
        ...payload,
        instructions:
          'Inspect verifier issues, apply a manual fix, then rerun dispatch from this state.',
      },
      null,
      2,
    ),
  );
  return dir;
}

function timeoutVerification(): VerificationResult {
  return {
    score: 0,
    verdict: 'fail',
    issues: [
      {
        line: 0,
        failureMode: 5,
        description: 'Executor timed out and was killed cleanly.',
      },
    ],
  };
}

export function decisionFromTerminalInput(input: string): ApprovalDecision {
  return parseApprovalDecision(input);
}
