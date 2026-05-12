import type { Plan, ReplanInput, Step } from '@dispatch-ai/shared';

function step(id: string, intent: string): Step {
  return { id, intent, expectedOutputs: ['diff'], verificationCriteria: ['detector pass'] };
}

export const planFixtures: Plan[] = Array.from({ length: 10 }, (_, index) => ({
  goal: `plan fixture ${index + 1}`,
  summary: 'Snapshot fixture for plan-shape determinism.',
  steps: [
    step('1', 'inspect target files'),
    step('2', 'implement requested change'),
    step('3', 'run verifier and tests'),
  ],
}));

const fallbackPlan: Plan = {
  goal: 'fallback',
  summary: 'Fallback fixture.',
  steps: [step('1', 'fallback step')],
};

export const replanFixtures: ReplanInput[] = Array.from({ length: 5 }, (_, index) => ({
  originalGoal: `replan fixture ${index + 1}`,
  plan: planFixtures[index] ?? fallbackPlan,
  failedStep: step('2', 'implement requested change'),
  verifierIssues: [
    {
      line: 12,
      failureMode: 1,
      description: 'Placeholder return detected.',
    },
  ],
  attempts: 1,
  lastAcceptedRef: `run-${index + 1}`,
}));
