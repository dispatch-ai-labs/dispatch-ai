import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Step, VerificationResult } from '@dispatch-ai/shared';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

export interface RunRecord {
  id: string;
  goal: string;
  status: 'running' | 'completed' | 'halted' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface StoredStepResult {
  runId: string;
  stepId: string;
  status: string;
  diff: string;
  log: string;
}

export interface RunStore {
  recordRun(record: RunRecord): void;
  updateRunStatus(runId: string, status: RunRecord['status']): void;
  recordStep(runId: string, step: Step, result: StoredStepResult): void;
  recordVerification(runId: string, stepId: string, verification: VerificationResult): void;
  recordReplan(runId: string, stepId: string, attempt: number, issuesJson: string): void;
}

export class InMemoryRunStore implements RunStore {
  readonly runs: RunRecord[] = [];
  readonly steps: StoredStepResult[] = [];
  readonly verifications: Array<{
    runId: string;
    stepId: string;
    verification: VerificationResult;
  }> = [];
  readonly replans: Array<{ runId: string; stepId: string; attempt: number; issuesJson: string }> =
    [];

  recordRun(record: RunRecord): void {
    this.runs.push(record);
  }

  updateRunStatus(runId: string, status: RunRecord['status']): void {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (run) {
      run.status = status;
      run.updatedAt = new Date().toISOString();
    }
  }

  recordStep(_runId: string, _step: Step, result: StoredStepResult): void {
    this.steps.push(result);
  }

  recordVerification(runId: string, stepId: string, verification: VerificationResult): void {
    this.verifications.push({ runId, stepId, verification });
  }

  recordReplan(runId: string, stepId: string, attempt: number, issuesJson: string): void {
    this.replans.push({ runId, stepId, attempt, issuesJson });
  }
}

export class SqliteRunStore implements RunStore {
  private constructor(
    private readonly db: Database,
    private readonly filePath: string,
  ) {
    this.migrate();
  }

  static async open(filePath: string, SQL?: SqlJsStatic): Promise<SqliteRunStore> {
    const sql = SQL ?? (await initSqlJs());
    mkdirSync(dirname(filePath), { recursive: true });
    const db = existsSync(filePath) ? new sql.Database(readFileSync(filePath)) : new sql.Database();
    return new SqliteRunStore(db, filePath);
  }

  recordRun(record: RunRecord): void {
    this.db.run(
      'insert into runs (id, goal, status, created_at, updated_at) values (?, ?, ?, ?, ?)',
      [record.id, record.goal, record.status, record.createdAt, record.updatedAt],
    );
    this.flush();
  }

  updateRunStatus(runId: string, status: RunRecord['status']): void {
    this.db.run('update runs set status = ?, updated_at = ? where id = ?', [
      status,
      new Date().toISOString(),
      runId,
    ]);
    this.flush();
  }

  recordStep(runId: string, step: Step, result: StoredStepResult): void {
    this.db.run(
      'insert into steps (run_id, step_id, intent, status, diff, log) values (?, ?, ?, ?, ?, ?)',
      [runId, step.id, step.intent, result.status, result.diff, result.log],
    );
    this.flush();
  }

  recordVerification(runId: string, stepId: string, verification: VerificationResult): void {
    this.db.run(
      'insert into verifications (run_id, step_id, verdict, score, issues_json) values (?, ?, ?, ?, ?)',
      [
        runId,
        stepId,
        verification.verdict,
        verification.score,
        JSON.stringify(verification.issues),
      ],
    );
    this.flush();
  }

  recordReplan(runId: string, stepId: string, attempt: number, issuesJson: string): void {
    this.db.run('insert into replans (run_id, step_id, attempt, issues_json) values (?, ?, ?, ?)', [
      runId,
      stepId,
      attempt,
      issuesJson,
    ]);
    this.flush();
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists runs (
        id text primary key,
        goal text not null,
        status text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists steps (
        id integer primary key autoincrement,
        run_id text not null,
        step_id text not null,
        intent text not null,
        status text not null,
        diff text not null,
        log text not null
      );
      create table if not exists verifications (
        id integer primary key autoincrement,
        run_id text not null,
        step_id text not null,
        verdict text not null,
        score integer not null,
        issues_json text not null
      );
      create table if not exists replans (
        id integer primary key autoincrement,
        run_id text not null,
        step_id text not null,
        attempt integer not null,
        issues_json text not null
      );
    `);
    this.flush();
  }

  private flush(): void {
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }
}
