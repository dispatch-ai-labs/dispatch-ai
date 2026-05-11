#!/usr/bin/env bun
import { VERSION } from './index.ts';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

console.log(`dispatch v${VERSION}`);
console.log('Not yet implemented (Week 0 scaffold).');
console.log('Week 1 will ship the standalone detector first.');
console.log('Track progress: https://github.com/OWNER/dispatch-ai');
process.exit(0);
