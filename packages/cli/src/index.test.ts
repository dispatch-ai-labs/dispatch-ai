import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestAnthropicJson } from './anthropic.ts';
import {
  type ProcessRunner,
  checkGhCli,
  hasAutoConsent,
  nextVerificationAction,
  parseApprovalDecision,
  parseRunArgs,
  recordAutoConsent,
  validateSafety,
} from './index.ts';

test('--auto refuses without docker or consent', () => {
  const options = parseRunArgs(['run', 'add caching', '--auto'], '/tmp/missing-dispatch-consent');
  expect(() => validateSafety(options)).toThrow('--auto requires --docker');
});

test('--auto is allowed with docker', () => {
  const options = parseRunArgs(['run', 'add caching', '--auto', '--docker']);
  expect(() => validateSafety(options)).not.toThrow();
});

test('parseRunArgs handles flags before goal and max cost budget', () => {
  const options = parseRunArgs(['run', '--max-cost-usd', '2.50', '--gate-every-step', 'add cache']);
  expect(options.goal).toBe('add cache');
  expect(options.approvalMode).toBe('gate-every-step');
  expect(options.maxCostUsd).toBe(2.5);
  expect(() => parseRunArgs(['run', '--max-cost-usd', '0', 'goal'])).toThrow(
    '--max-cost-usd requires a positive number',
  );
});

test('records typed first-run auto consent', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-cli-'));
  const consentPath = join(root, 'consent.json');

  try {
    expect(recordAutoConsent('nope', consentPath)).toBe(false);
    expect(hasAutoConsent(consentPath)).toBe(false);
    expect(recordAutoConsent('I accept', consentPath)).toBe(true);
    expect(hasAutoConsent(consentPath)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approval parser handles approve edit and reject states', () => {
  expect(parseApprovalDecision('approve')).toBe('approve');
  expect(parseApprovalDecision('e')).toBe('edit-prompt');
  expect(parseApprovalDecision('reject')).toBe('reject');
  expect(() => parseApprovalDecision('ship it')).toThrow();
});

test('verification verdict handling matches approval modes and replan cap', () => {
  expect(nextVerificationAction('pass', 'gate-on-warn', 0, false)).toBe('continue');
  expect(nextVerificationAction('pass', 'gate-every-step', 0, false)).toBe('prompt');
  expect(nextVerificationAction('warn', 'gate-on-warn', 0, false)).toBe('prompt');
  expect(nextVerificationAction('fail', 'gate-on-warn', 2, false)).toBe('replan');
  expect(nextVerificationAction('fail', 'gate-on-warn', 3, false)).toBe('halt');
  expect(nextVerificationAction('fail', 'gate-on-warn', 3, true)).toBe('continue');
});

test('gh missing and gh unauthenticated produce actionable errors', async () => {
  const missing: ProcessRunner = {
    async run() {
      return { exitCode: 127, stdout: '', stderr: 'not found' };
    },
  };
  await expect(checkGhCli(missing)).rejects.toThrow('https://cli.github.com/');

  const unauthenticated: ProcessRunner = {
    async run(_command, args) {
      return args[0] === '--version'
        ? { exitCode: 0, stdout: 'gh version', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'not logged in' };
    },
  };
  await expect(checkGhCli(unauthenticated)).rejects.toThrow('gh auth login');
});

test('anthropic helper applies timeout, prompt caching, and parses JSON', async () => {
  const result = await requestAnthropicJson<{ ok: boolean }>({
    apiKey: 'key',
    systemPrompt: 'system',
    repoContext: 'repo',
    userPrompt: 'user',
    fetchImpl: async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.headers as Record<string, string>)['anthropic-beta']).toContain(
        'prompt-caching',
      );
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }));
    },
  });

  expect(result.value.ok).toBe(true);
  expect(result.costUsd).toBe(0);
});

test('anthropic helper computes costUsd from Anthropic usage block', async () => {
  const result = await requestAnthropicJson<{ ok: boolean }>({
    apiKey: 'key',
    systemPrompt: 'system',
    repoContext: 'repo',
    userPrompt: 'user',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ),
  });

  expect(result.value.ok).toBe(true);
  expect(result.costUsd).toBeCloseTo(18, 4);
});

test('anthropic helper turns malformed JSON into actionable error', async () => {
  await expect(
    requestAnthropicJson({
      apiKey: 'key',
      systemPrompt: 'system',
      repoContext: 'repo',
      userPrompt: 'user',
      fetchImpl: async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'not-json' }] })),
    }),
  ).rejects.toThrow('malformed JSON');
});

test('anthropic helper surfaces pinned model deprecation with upgrade path', async () => {
  await expect(
    requestAnthropicJson({
      apiKey: 'key',
      systemPrompt: 'system',
      repoContext: 'repo',
      userPrompt: 'user',
      model: 'claude-old-pinned',
      fetchImpl: async () => new Response('model claude-old-pinned is deprecated', { status: 400 }),
    }),
  ).rejects.toThrow('CHANGELOG.md');
});

test('anthropic helper aborts before sending request when signal is canceled', async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(
    requestAnthropicJson({
      apiKey: 'key',
      systemPrompt: 'system',
      repoContext: 'repo',
      userPrompt: 'user',
      signal: controller.signal,
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    }),
  ).rejects.toThrow('aborted');
});

test('anthropic helper retries 429 three times with backoff', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await requestAnthropicJson<{ ok: boolean }>({
    apiKey: 'key',
    systemPrompt: 'system',
    repoContext: 'repo',
    userPrompt: 'user',
    sleepMs: async (ms) => {
      sleeps.push(ms);
    },
    fetchImpl: async () => {
      calls += 1;
      return calls < 4
        ? new Response('rate limited', { status: 429 })
        : new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }));
    },
  });

  expect(result.value.ok).toBe(true);
  expect(calls).toBe(4);
  expect(sleeps).toEqual([250, 500, 1000]);
});

test('anthropic helper retries 5xx once', async () => {
  let calls = 0;
  const result = await requestAnthropicJson<{ ok: boolean }>({
    apiKey: 'key',
    systemPrompt: 'system',
    repoContext: 'repo',
    userPrompt: 'user',
    sleepMs: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response('server error', { status: 500 })
        : new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }));
    },
  });

  expect(result.value.ok).toBe(true);
  expect(calls).toBe(2);
});
