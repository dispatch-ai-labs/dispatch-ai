#!/usr/bin/env bun
import { VERSION, detect } from './index.ts';

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

// Read diff from stdin (typical) or from a file path argument (CI / GitHub Action).
let diff = '';
if (args[0] && args[0] !== '-') {
  diff = await Bun.file(args[0]).text();
} else {
  // Stdin
  for await (const chunk of Bun.stdin.stream()) {
    diff += new TextDecoder().decode(chunk);
  }
}

const result = detect(diff);
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === 'fail' ? 2 : result.verdict === 'warn' ? 1 : 0);
