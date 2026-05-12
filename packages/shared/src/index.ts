import { z } from 'zod';

export const VERSION = '0.0.1';

// Pinned model. Per design doc Open Q #4 + v2-REV1 D7: never use unpinned model aliases.
// Bumping requires re-running the eval harness and committing new snapshots.
export const DEFAULT_MODEL = 'claude-sonnet-4-6' as const;

// Anthropic public pricing at the time of pin (USD per 1M tokens). If Anthropic
// changes pricing, update here and rerun eval snapshots before changing the pin.
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
};

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function computeCostUsd(model: string, usage: AnthropicUsage | undefined): number {
  if (!usage) {
    return 0;
  }
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return 0;
  }
  const input = (usage.input_tokens ?? 0) * pricing.inputPerMTok;
  const output = (usage.output_tokens ?? 0) * pricing.outputPerMTok;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * pricing.cacheWritePerMTok;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * pricing.cacheReadPerMTok;
  return (input + output + cacheWrite + cacheRead) / 1_000_000;
}

export const VerdictSchema = z.enum(['pass', 'warn', 'fail']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ApprovalModeSchema = z.enum(['auto', 'gate-on-warn', 'gate-every-step']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const DetectorIssueSchema = z.object({
  line: z.number().int().nonnegative(),
  failureMode: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  description: z.string().min(1),
});
export type DetectorIssue = z.infer<typeof DetectorIssueSchema>;

export const VerificationResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: VerdictSchema,
  issues: z.array(DetectorIssueSchema),
  costUsd: z.number().nonnegative().optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const StepSchema = z.object({
  id: z.string().min(1),
  intent: z.string().min(1),
  expectedOutputs: z.array(z.string().min(1)).default([]),
  verificationCriteria: z.array(z.string().min(1)).default([]),
});
export type Step = z.infer<typeof StepSchema>;

export const PlanSchema = z.object({
  goal: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  summary: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const StepResultSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(['passed', 'warned', 'failed', 'timed-out', 'skipped']),
  diff: z.string(),
  log: z.string().default(''),
  costUsd: z.number().nonnegative().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const ReplanInputSchema = z.object({
  originalGoal: z.string().min(1),
  plan: PlanSchema,
  failedStep: StepSchema,
  verifierIssues: z.array(DetectorIssueSchema),
  attempts: z.number().int().min(1).max(3),
  lastAcceptedRef: z.string().min(1),
});
export type ReplanInput = z.infer<typeof ReplanInputSchema>;

export const DispatchConfigSchema = z.object({
  approvalMode: ApprovalModeSchema.default('gate-on-warn'),
  docker: z.boolean().default(false),
  model: z.literal(DEFAULT_MODEL).default(DEFAULT_MODEL),
  maxReplansPerStep: z.number().int().min(1).max(3).default(3),
  maxCostUsd: z.number().positive().optional(),
  telemetry: z.boolean().default(false),
});
export type DispatchConfig = z.infer<typeof DispatchConfigSchema>;
