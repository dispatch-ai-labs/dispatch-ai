export const VERSION = '0.0.0';

// Pinned model. Per design doc Open Q #4 + v2-REV1 D7: never use unpinned model aliases.
// Bumping requires re-running the eval harness and committing new snapshots.
export const DEFAULT_MODEL = 'claude-sonnet-4-6' as const;

// Week 2 work (D6): replace these stubs with real zod schemas for Plan, Step, StepResult,
// VerificationResult, ReplanInput, DispatchConfig. Schemas double as runtime validation
// of LLM JSON output.
export type Plan = unknown;
export type Step = unknown;
export type StepResult = unknown;
export type VerificationResult = unknown;
export type ReplanInput = unknown;
export type DispatchConfig = unknown;
