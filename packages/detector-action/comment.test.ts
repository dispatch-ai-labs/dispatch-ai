import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatDetectorComment } = require('./comment.cjs') as {
  formatDetectorComment: (result: {
    score: number;
    verdict: string;
    issues: Array<{ line: number; failureMode: number; description: string }>;
  }) => string;
};

test('formats detector action comment with suspect-line table', () => {
  const body = formatDetectorComment({
    score: 0,
    verdict: 'fail',
    issues: [{ line: 4, failureMode: 1, description: 'TODO placeholder' }],
  });

  expect(body).toContain('Verdict: **fail**');
  expect(body).toContain('Score: **0**');
  expect(body).toContain('| 4 | 1 | TODO placeholder |');
});

test('formats detector action comment for clean diffs', () => {
  const body = formatDetectorComment({ score: 100, verdict: 'pass', issues: [] });

  expect(body).toContain('Verdict: **pass**');
  expect(body).toContain('| - | - | No suspect lines. |');
});
