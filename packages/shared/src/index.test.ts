import { expect, test } from 'bun:test';
import {
  DEFAULT_MODEL,
  DispatchConfigSchema,
  PlanSchema,
  VERSION,
  VerificationResultSchema,
} from './index.ts';

test('VERSION matches package.json', async () => {
  const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json();
  expect(VERSION).toBe(pkg.version);
});

test('DEFAULT_MODEL is pinned and not an alias', () => {
  // Never use unpinned model aliases (Open Q #4 / v2-REV1).
  // Pinned form is "claude-sonnet-<major>-<minor>", not "claude-sonnet" / "claude-latest".
  expect(DEFAULT_MODEL).toMatch(/^claude-sonnet-\d+-\d+$/);
});

test('PlanSchema validates structured LLM plan output', () => {
  const plan = PlanSchema.parse({
    goal: 'add caching',
    steps: [{ id: '1', intent: 'add cache map' }],
  });

  expect(plan.steps[0]?.expectedOutputs).toEqual([]);
  expect(plan.steps[0]?.verificationCriteria).toEqual([]);
});

test('VerificationResultSchema rejects out-of-range scores', () => {
  expect(() =>
    VerificationResultSchema.parse({
      score: 101,
      verdict: 'pass',
      issues: [],
    }),
  ).toThrow();
});

test('DispatchConfigSchema defaults to gate-on-warn', () => {
  expect(DispatchConfigSchema.parse({})).toEqual({
    approvalMode: 'gate-on-warn',
    docker: false,
    maxReplansPerStep: 3,
    model: DEFAULT_MODEL,
    telemetry: false,
  });
});

test('DispatchConfigSchema accepts optional cost budget', () => {
  expect(DispatchConfigSchema.parse({ maxCostUsd: 2 }).maxCostUsd).toBe(2);
  expect(() => DispatchConfigSchema.parse({ maxCostUsd: 0 })).toThrow();
});
