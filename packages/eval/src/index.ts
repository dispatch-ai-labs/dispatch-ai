import { detect } from '@dispatch-ai/detector';
import { fixtures } from './fixtures.ts';

export interface EvalSummary {
  total: number;
  good: number;
  bad: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  recall: number;
  precision: number;
}

export function runDetectorEval(): EvalSummary {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const fixture of fixtures) {
    const result = detect(fixture.diff);
    const failed = result.verdict === 'fail';

    if (fixture.label === 'bad' && failed) {
      truePositive += 1;
    } else if (fixture.label === 'bad' && !failed) {
      falseNegative += 1;
    } else if (fixture.label === 'good' && failed) {
      falsePositive += 1;
    } else {
      trueNegative += 1;
    }
  }

  const recall = truePositive / (truePositive + falseNegative);
  const precision = trueNegative / (trueNegative + falsePositive);

  return {
    total: fixtures.length,
    good: fixtures.filter((fixture) => fixture.label === 'good').length,
    bad: fixtures.filter((fixture) => fixture.label === 'bad').length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    recall,
    precision,
  };
}

export function assertLaunchThresholds(summary: EvalSummary): void {
  if (summary.recall < 0.9) {
    throw new Error(
      `Detector recall ${summary.recall.toFixed(3)} is below 0.900 launch threshold.`,
    );
  }
  if (summary.precision < 0.95) {
    throw new Error(
      `Detector precision ${summary.precision.toFixed(3)} is below 0.950 launch threshold.`,
    );
  }
}
