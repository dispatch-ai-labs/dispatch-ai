#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { VERSION, createAnthropicJudge, detect, detectWithJudge } from './index.ts';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`dispatch-detector v${VERSION}

Usage:
  dispatch-detector [--repo <path>] [--judge --intent <text>] [diff.patch]
  git diff | dispatch-detector --repo .

Exit codes:
  0 pass
  1 warn
  2 fail`);
  process.exit(0);
}

const repoRoot = readFlag(args, '--repo') ?? process.cwd();
const stepIntent = readFlag(args, '--intent') ?? 'Verify this diff implements the claimed change.';
const useJudge = args.includes('--judge') || process.env.DISPATCH_DETECTOR_USE_JUDGE === '1';
const fileArg = args.find((arg) => !arg.startsWith('-') && !isFlagValue(args, arg));
const diff = fileArg && fileArg !== '-' ? await readFile(fileArg, 'utf8') : await readStdin();

const result =
  useJudge && process.env.ANTHROPIC_API_KEY
    ? await detectWithJudge(
        diff,
        stepIntent,
        createAnthropicJudge({ apiKey: process.env.ANTHROPIC_API_KEY }),
        { repoRoot },
      )
    : detect(diff, { repoRoot });

console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'fail' ? 2 : result.verdict === 'warn' ? 1 : 0);

function readFlag(values: string[], flag: string): string | undefined {
  const index = values.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return values[index + 1];
}

function isFlagValue(values: string[], candidate: string): boolean {
  const index = values.indexOf(candidate);
  return values[index - 1] === '--repo' || values[index - 1] === '--intent';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
