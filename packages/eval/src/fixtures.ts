import type { Verdict } from '@dispatch-ai/shared';

export interface EvalFixture {
  id: string;
  label: 'good' | 'bad';
  diff: string;
  expectedVerdict: Verdict;
}

function good(id: number, body: string): EvalFixture {
  return {
    id: `good-${String(id).padStart(2, '0')}`,
    label: 'good',
    expectedVerdict: 'pass',
    diff: `diff --git a/app.py b/app.py
@@ -1,2 +1,6 @@
 def handler(value):
-    return value
${body}`,
  };
}

function bad(id: number, body: string): EvalFixture {
  return {
    id: `bad-${String(id).padStart(2, '0')}`,
    label: 'bad',
    expectedVerdict: 'fail',
    diff: `diff --git a/app.py b/app.py
@@ -1,2 +1,5 @@
 def handler(value):
-    return value
${body}`,
  };
}

export const fixtures: EvalFixture[] = [
  ...Array.from({ length: 30 }, (_, index) =>
    good(
      index + 1,
      `+    cleaned = str(value).strip()
+    if not cleaned:
+        raise ValueError("value is required")
+    return cleaned.upper()
`,
    ),
  ),
  bad(1, '+    # TODO: implement real lookup\n+    return None\n'),
  bad(2, '+    raise NotImplementedError("wire later")\n'),
  bad(3, '+    ...\n'),
  bad(4, '+    return {}\n'),
  bad(5, '+    return []\n'),
  bad(6, '+    return "mock response"\n'),
  bad(7, '+    return "placeholder payload"\n'),
  bad(8, '+    message = "TODO: add logic here"\n+    return message\n'),
  bad(9, '+    pass  # TODO\n'),
  bad(10, '+    pass  # implement\n'),
  bad(11, '+    # FIXME: fake branch\n+    return value\n'),
  bad(12, '+    # XXX: replace this\n+    return value\n'),
  bad(13, '+    return None\n'),
  bad(14, '+    return 0\n'),
  bad(15, '+    return ""\n'),
  bad(16, "+    return ''\n"),
  bad(17, '+    return "fake user"\n'),
  bad(18, '+    return "dummy token"\n'),
  bad(19, '+    note = "implement me"\n+    return note\n'),
  bad(20, '+    note = "your code here"\n+    return note\n'),
  bad(21, '+    note = "add logic here"\n+    return note\n'),
  bad(22, '+    raise NotImplementedError\n'),
  bad(23, '+    pass  # TODO: compute\n'),
  bad(24, '+    # TODO: cache invalidation\n+    return value\n'),
  bad(25, '+    return []  # fake list\n'),
  bad(26, '+    return {}  # fake dict\n'),
  bad(27, '+    result = "TODO"\n+    return result\n'),
  bad(28, '+    return "mocked"\n'),
  bad(29, '+    return "dummy"\n'),
  bad(30, '+    ...  # implement\n'),
];
