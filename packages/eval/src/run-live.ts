import { assertLaunchThresholds, runDetectorEval } from './index.ts';

// Live judge drift detection will layer on top of this deterministic gate once
// ANTHROPIC_API_KEY-backed snapshots are committed.
const summary = runDetectorEval();
assertLaunchThresholds(summary);
console.log(JSON.stringify({ mode: 'deterministic-live-baseline', ...summary }, null, 2));
