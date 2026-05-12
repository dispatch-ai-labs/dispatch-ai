import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from './state.ts';

test('sqlite run store persists runs, steps, verifications, and replans', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-state-'));
  const dbPath = join(root, 'state.sqlite');

  try {
    const store = await SqliteRunStore.open(dbPath);
    const now = new Date().toISOString();
    store.recordRun({
      id: 'run-1',
      goal: 'test goal',
      status: 'running',
      createdAt: now,
      updatedAt: now,
    });
    store.recordStep(
      'run-1',
      { id: 'step-1', intent: 'edit', expectedOutputs: [], verificationCriteria: [] },
      {
        runId: 'run-1',
        stepId: 'step-1',
        status: 'passed',
        diff: 'diff',
        log: '',
      },
    );
    store.recordVerification('run-1', 'step-1', { score: 100, verdict: 'pass', issues: [] });
    store.recordReplan('run-1', 'step-1', 1, '[]');
    store.updateRunStatus('run-1', 'completed');

    expect(existsSync(dbPath)).toBe(true);

    const reopened = await SqliteRunStore.open(dbPath);
    reopened.updateRunStatus('run-1', 'completed');
    expect(existsSync(dbPath)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
