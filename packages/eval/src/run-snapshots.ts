import { assertLaunchThresholds, runDetectorEval } from './index.ts';

const summary = runDetectorEval();
assertLaunchThresholds(summary);
console.log(JSON.stringify(summary, null, 2));
