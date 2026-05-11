import { VERSION } from '@dispatch-ai-labs/shared';

export { VERSION };

export type Verdict = 'pass' | 'warn' | 'fail';

export interface DetectorIssue {
  line: number;
  failureMode: 1 | 2 | 3 | 4 | 5;
  description: string;
}

export interface DetectorResult {
  score: number;
  verdict: Verdict;
  issues: DetectorIssue[];
}

// Week 1 implementation (D4):
//   1. Placeholder regex/AST (verbatim list from design doc verifier rubric)
//   2. Minimal import resolver: parse imports + parse pyproject.toml/requirements.txt/setup.py
//      + hardcoded stdlib name list + in-diff symbol table
//   3. LLM judge with the verbatim rubric from design doc, called only if (1)+(2) pass
//      (fail-fast to save tokens)
//
// Critical: if all three dep files are absent, treat unknown identifiers as
// "no info, defer to judge" — NOT "fabricated." False-positive recall on
// greenfield repos must stay near zero. See v2-REV1 critical fixes.
export function detect(_diff: string): DetectorResult {
  return { score: 100, verdict: 'pass', issues: [] };
}
