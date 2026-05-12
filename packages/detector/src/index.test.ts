import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicJudge, detect, detectWithJudge } from './index.ts';

const goodDiff = `diff --git a/app.py b/app.py
@@ -1,2 +1,5 @@
 def add(a, b):
-    return a + b
+    total = a + b
+    if total > 100:
+        return 100
+    return total
`;

test('passes a concrete Python implementation', () => {
  expect(detect(goodDiff).verdict).toBe('pass');
});

test('fails TODO placeholders with suspect line numbers', () => {
  const result = detect(`diff --git a/app.py b/app.py
@@ -1,2 +1,3 @@
 def fetch():
+    # TODO: add real database lookup
+    return None
`);

  expect(result.verdict).toBe('fail');
  expect(result.issues.map((issue) => issue.failureMode)).toEqual([1, 1]);
  expect(result.issues[0]?.line).toBe(2);
});

test('fails NotImplementedError and ellipsis bodies', () => {
  const result = detect(`diff --git a/app.py b/app.py
@@ -10,2 +10,4 @@
 def one():
+    raise NotImplementedError("later")
 def two():
+    ...
`);

  expect(result.verdict).toBe('fail');
  expect(result.issues).toHaveLength(2);
});

test('flags fabricated imports when dependency files exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-detector-'));
  writeFileSync(join(root, 'requirements.txt'), 'requests==2.32.0\n');

  try {
    const result = detect(
      `diff --git a/app.py b/app.py
@@ -1,1 +1,3 @@
+import requests
+import definitely_fake_sdk
+import json
`,
      { repoRoot: root },
    );

    expect(result.verdict).toBe('fail');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.description).toContain('definitely_fake_sdk');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not fabricate imports when no dependency files exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-detector-'));

  try {
    const result = detect(
      `diff --git a/app.py b/app.py
@@ -1,1 +1,2 @@
+import unknown_greenfield_package
`,
      { repoRoot: root },
    );

    expect(result.verdict).toBe('pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails empty diffs explicitly', () => {
  const result = detect('');
  expect(result.verdict).toBe('fail');
  expect(result.issues[0]?.description).toContain('Empty diff');
});

test('does not call judge after deterministic failure', async () => {
  let calls = 0;
  const result = await detectWithJudge(
    `diff --git a/app.py b/app.py
@@ -1,1 +1,2 @@
+raise NotImplementedError
`,
    'implement app',
    async () => {
      calls += 1;
      return { score: 100, verdict: 'pass', issues: [] };
    },
  );

  expect(result.verdict).toBe('fail');
  expect(calls).toBe(0);
});

test('anthropic judge uses timeout and prompt caching headers', async () => {
  const judge = createAnthropicJudge({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.headers as Record<string, string>)['anthropic-beta']).toContain(
        'prompt-caching',
      );
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"score":100,"verdict":"pass","issues":[]}' }],
        }),
        { status: 200 },
      );
    },
  });

  await expect(judge({ diff: goodDiff, stepIntent: 'cap add result' })).resolves.toEqual({
    score: 100,
    verdict: 'pass',
    issues: [],
  });
});
