import { type Stats, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import {
  type AnthropicUsage,
  DEFAULT_MODEL,
  type DetectorIssue,
  VERSION,
  type Verdict,
  VerificationResultSchema,
  computeCostUsd,
} from '@dispatch-ai/shared';

export { VERSION };
export type { DetectorIssue, Verdict };

export interface DetectorResult {
  score: number;
  verdict: Verdict;
  issues: DetectorIssue[];
  costUsd?: number;
}

export interface DetectorOptions {
  repoRoot?: string;
}

export interface JudgeInput {
  diff: string;
  stepIntent: string;
}

export type JudgeVerifier = (input: JudgeInput) => Promise<DetectorResult>;
type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface AddedLine {
  line: number;
  text: string;
}

interface DependencyInfo {
  dependencyFilesPresent: boolean;
  packages: Set<string>;
}

const STDLIB_MODULES = new Set([
  '__future__',
  'abc',
  'argparse',
  'asyncio',
  'base64',
  'collections',
  'contextlib',
  'csv',
  'dataclasses',
  'datetime',
  'decimal',
  'enum',
  'functools',
  'hashlib',
  'http',
  'importlib',
  'inspect',
  'io',
  'itertools',
  'json',
  'logging',
  'math',
  'os',
  'pathlib',
  'queue',
  'random',
  're',
  'shutil',
  'signal',
  'sqlite3',
  'statistics',
  'string',
  'subprocess',
  'sys',
  'tempfile',
  'threading',
  'time',
  'tomllib',
  'traceback',
  'typing',
  'unittest',
  'urllib',
  'uuid',
  'venv',
  'warnings',
  'xml',
  'zipfile',
]);

const PLACEHOLDER_STRING_PATTERN =
  /(['"])(?:(?!\1).)*(TODO|FIXME|implement me|add logic here|your code here)(?:(?!\1).)*\1/i;
const MOCK_RETURN_PATTERN =
  /^\s*return\s+(None|\{\}|\[\]|0|''|""|["'](?:mock|placeholder|fake|dummy)[^"']*["'])\s*(?:#.*)?$/i;

export function detect(diff: string, options: DetectorOptions = {}): DetectorResult {
  const addedLines = extractAddedLines(diff);
  const issues: DetectorIssue[] = [];

  if (addedLines.length === 0) {
    issues.push({
      line: 0,
      failureMode: 1,
      description: 'Empty diff: no added lines to verify.',
    });
    return resultFromIssues(issues);
  }

  for (const added of addedLines) {
    const issue = detectPlaceholderLine(added);
    if (issue) {
      issues.push(issue);
    }
  }

  issues.push(...detectFabricatedImports(addedLines, options.repoRoot));

  return resultFromIssues(issues);
}

export async function detectWithJudge(
  diff: string,
  stepIntent: string,
  judge: JudgeVerifier,
  options: DetectorOptions = {},
): Promise<DetectorResult> {
  const deterministic = detect(diff, options);
  if (deterministic.verdict === 'fail') {
    return deterministic;
  }

  const judged = await judge({ diff, stepIntent });
  const parsed = VerificationResultSchema.parse(judged);
  return parsed.costUsd === undefined
    ? { score: parsed.score, verdict: parsed.verdict, issues: parsed.issues }
    : {
        score: parsed.score,
        verdict: parsed.verdict,
        issues: parsed.issues,
        costUsd: parsed.costUsd,
      };
}

export function createAnthropicJudge(config: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): JudgeVerifier {
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 60_000;
  const fetchImpl = config.fetchImpl ?? fetch;

  return async ({ diff, stepIntent }) => {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: composeSignals(AbortSignal.timeout(timeoutMs), config.signal),
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        system: [
          {
            type: 'text',
            text: JUDGE_RUBRIC,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `STEP_INTENT:\n${stepIntent}\n\nDIFF:\n${diff}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic judge failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as AnthropicMessageResponse;
    const text = body.content.find(isAnthropicTextPart)?.text;
    if (!text) {
      throw new Error('Anthropic judge returned no text content.');
    }

    const parsed = VerificationResultSchema.parse(JSON.parse(text));
    const judgeCostUsd = computeCostUsd(model, body.usage);
    return { ...parsed, costUsd: (parsed.costUsd ?? 0) + judgeCostUsd };
  };
}

function composeSignals(timeoutSignal: AbortSignal, userSignal: AbortSignal | undefined) {
  if (!userSignal) {
    return timeoutSignal;
  }
  if (userSignal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  if ('any' in AbortSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  timeoutSignal.addEventListener('abort', abort, { once: true });
  userSignal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function detectPlaceholderLine(added: AddedLine): DetectorIssue | null {
  const text = added.text;

  if (/^\s*pass\s*#\s*(implement|todo)\b/i.test(text)) {
    return issue(added, 1, 'Placeholder pass statement introduced.');
  }

  if (/\braise\s+NotImplementedError\b/.test(text)) {
    return issue(added, 1, 'NotImplementedError stub introduced.');
  }

  if (/#\s*(TODO|FIXME|XXX)\s*:/i.test(text)) {
    return issue(added, 1, 'TODO/FIXME/XXX marker introduced in claimed implementation.');
  }

  if (/^\s*\.\.\.\s*(?:#.*)?$/.test(text)) {
    return issue(added, 1, 'Ellipsis-only implementation introduced.');
  }

  if (MOCK_RETURN_PATTERN.test(text)) {
    return issue(added, 1, 'Placeholder or hardcoded mock return introduced.');
  }

  if (PLACEHOLDER_STRING_PATTERN.test(text)) {
    return issue(added, 1, 'Placeholder instruction string introduced.');
  }

  return null;
}

function detectFabricatedImports(
  addedLines: AddedLine[],
  repoRoot: string | undefined,
): DetectorIssue[] {
  const root = resolve(repoRoot ?? process.cwd());
  const deps = readDependencyInfo(root);
  if (!deps.dependencyFilesPresent) {
    return [];
  }

  const localModules = collectLocalPythonModules(root);
  const definedInDiff = collectDefinedSymbols(addedLines);
  const issues: DetectorIssue[] = [];

  for (const added of addedLines) {
    const imported = parseImportBase(added.text);
    if (!imported) {
      continue;
    }

    const normalized = normalizePackageName(imported);
    if (
      STDLIB_MODULES.has(imported) ||
      deps.packages.has(normalized) ||
      localModules.has(imported) ||
      definedInDiff.has(imported)
    ) {
      continue;
    }

    issues.push(
      issue(added, 2, `Imported module "${imported}" is not declared, local, or stdlib.`),
    );
  }

  return issues;
}

function extractAddedLines(diff: string): AddedLine[] {
  const lines = diff.split(/\r?\n/);
  const added: AddedLine[] = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of lines) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      newLine = Number(header[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }

    if (raw.startsWith(' ') || raw === '') {
      newLine += 1;
    }
  }

  return added.filter((line) => line.text.trim().length > 0);
}

function parseImportBase(text: string): string | null {
  const direct = /^\s*import\s+([A-Za-z_][\w.]*)/.exec(text);
  if (direct) {
    return direct[1]?.split('.')[0] ?? null;
  }

  const from = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/.exec(text);
  if (from) {
    return from[1]?.split('.')[0] ?? null;
  }

  if (/^\s*from\s+\./.test(text)) {
    return null;
  }

  return null;
}

function collectDefinedSymbols(addedLines: AddedLine[]): Set<string> {
  const symbols = new Set<string>();
  for (const added of addedLines) {
    const match = /^\s*(?:class|def)\s+([A-Za-z_]\w*)/.exec(added.text);
    if (match?.[1]) {
      symbols.add(match[1]);
    }
  }
  return symbols;
}

function readDependencyInfo(repoRoot: string): DependencyInfo {
  const packages = new Set<string>();
  let dependencyFilesPresent = false;

  const requirements = join(repoRoot, 'requirements.txt');
  if (existsSync(requirements)) {
    dependencyFilesPresent = true;
    for (const line of readFileSync(requirements, 'utf8').split(/\r?\n/)) {
      const dep = parseDependencyName(line);
      if (dep) {
        packages.add(dep);
      }
    }
  }

  const pyproject = join(repoRoot, 'pyproject.toml');
  if (existsSync(pyproject)) {
    dependencyFilesPresent = true;
    const content = readFileSync(pyproject, 'utf8');
    for (const match of content.matchAll(/["']([A-Za-z0-9_.-]+)(?:[<>=!~\[][^"']*)?["']/g)) {
      const dep = parseDependencyName(match[1] ?? '');
      if (dep) {
        packages.add(dep);
      }
    }
  }

  const setup = join(repoRoot, 'setup.py');
  if (existsSync(setup)) {
    dependencyFilesPresent = true;
    const content = readFileSync(setup, 'utf8');
    for (const match of content.matchAll(/["']([A-Za-z0-9_.-]+)(?:[<>=!~\[][^"']*)?["']/g)) {
      const dep = parseDependencyName(match[1] ?? '');
      if (dep) {
        packages.add(dep);
      }
    }
  }

  return { dependencyFilesPresent, packages };
}

function parseDependencyName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
    return null;
  }

  const match = /^([A-Za-z0-9_.-]+)/.exec(trimmed);
  return match ? normalizePackageName(match[1] ?? '') : null;
}

function collectLocalPythonModules(repoRoot: string): Set<string> {
  const modules = new Set<string>();
  walk(repoRoot, 0, modules);
  return modules;
}

function walk(dir: string, depth: number, modules: Set<string>): void {
  if (depth > 4) {
    return;
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'dist' || entry === '.venv') {
      continue;
    }

    const path = join(dir, entry);
    let stat: Stats;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (existsSync(join(path, '__init__.py'))) {
        modules.add(entry);
      }
      walk(path, depth + 1, modules);
      continue;
    }

    if (stat.isFile() && extname(entry) === '.py') {
      modules.add(basename(entry, '.py'));
    }
  }
}

function normalizePackageName(name: string): string {
  return name.toLowerCase().replaceAll('-', '_');
}

function issue(added: AddedLine, failureMode: DetectorIssue['failureMode'], description: string) {
  return {
    line: added.line,
    failureMode,
    description,
  };
}

function resultFromIssues(issues: DetectorIssue[]): DetectorResult {
  return {
    score: Math.max(0, 100 - issues.length * 25),
    verdict: issues.length > 0 ? 'fail' : 'pass',
    issues,
  };
}

interface AnthropicMessageResponse {
  content: Array<{ type: 'text'; text: string } | { type: string }>;
  usage?: AnthropicUsage;
}

function isAnthropicTextPart(part: AnthropicMessageResponse['content'][number]): part is {
  type: 'text';
  text: string;
} {
  return part.type === 'text' && 'text' in part;
}

export const JUDGE_RUBRIC = `You are reviewing a code diff produced by an AI coding agent. The agent claims to have implemented STEP_INTENT.

DIFF:
<diff content>

STEP_INTENT (what the agent was supposed to do):
<intent text>

CHECK FOR THESE FAILURE MODES IN ORDER. ANY ONE FAILURE = verdict "fail":

1. PLACEHOLDER STUBS: Does the diff contain any of:
   - \`pass  # implement\` or \`pass  # TODO\`
   - \`raise NotImplementedError\`
   - \`# TODO:\`, \`# FIXME:\`, \`# XXX:\` introducing the actual claimed functionality (not pre-existing in unchanged code)
   - Functions whose body is \`...\` (ellipsis only) when they are claimed implementations
   - Returns of literal \`None\`, empty dict, empty list, or hardcoded mock values from a function that was supposed to compute a real result
   - Strings containing "TODO", "FIXME", "implement me", "add logic here", "your code here"

2. FABRICATED APIS: Does the diff call functions, import modules, or reference attributes that are not:
   - Defined elsewhere in the diff or visible in the existing repo context
   - Members of declared dependencies (check pyproject.toml / requirements.txt / package.json)
   - Standard library APIs you can verify exist

3. CONTRADICTED INTENT: Does the diff implement something materially different from STEP_INTENT? (e.g., intent says "add database persistence", diff only adds an in-memory dict.)

4. SHALLOW IMPLEMENTATION: Does the diff trivially satisfy the intent in a way that no human reviewer would accept? (e.g., intent says "validate input", diff has \`if not input: pass\`.)

5. NEW UNREACHABLE CODE: Does the diff add code that is dead-on-arrival (functions never called, branches never reached given any input the test suite or callers can produce)?

VERDICT RULES:
- ANY of (1)-(3) triggered = "fail" (regardless of severity).
- (4) or (5) triggered = "warn" if (1)-(3) clean; "fail" if more than 2 instances.
- Otherwise = "pass".

Output JSON only. For each issue: line number, failure mode (1-5), and one-line description.`;
