import { expect, test } from 'bun:test';
import { fixtures } from './fixtures.ts';
import { assertLaunchThresholds, runDetectorEval } from './index.ts';
import { planFixtures, replanFixtures } from './plan-fixtures.ts';

test('detector eval has 30 known-good and 30 known-bad fixtures', () => {
  expect(fixtures.filter((fixture) => fixture.label === 'good')).toHaveLength(30);
  expect(fixtures.filter((fixture) => fixture.label === 'bad')).toHaveLength(30);
});

test('detector eval clears launch recall and precision thresholds', () => {
  const summary = runDetectorEval();
  expect(summary.total).toBe(60);
  expect(summary.recall).toBeGreaterThanOrEqual(0.9);
  expect(summary.precision).toBeGreaterThanOrEqual(0.95);
  expect(() => assertLaunchThresholds(summary)).not.toThrow();
});

test('plan and replan snapshot fixture counts match test plan', () => {
  expect(planFixtures).toHaveLength(10);
  expect(replanFixtures).toHaveLength(5);
});
