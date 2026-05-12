interface Check {
  name: string;
  ready: boolean;
  detail: string;
}

const checks: Check[] = [
  checkEnv('ANTHROPIC_API_KEY', 'Required for live planner/executor/verifier/replanner E2E.'),
  checkCommand('docker', ['info'], 'Required for live Docker sandbox execution.'),
  checkCommand('gh', ['auth', 'status'], 'Required for live PR creation and PR-comment checks.'),
  checkEnv('HOMEBREW_TAP_PAT', 'Required for release workflow Homebrew tap update.'),
  checkEnv(
    'NPM_TRUSTED_PUBLISHING_READY',
    'Set to 1 after configuring npm trusted publishing/provenance for @dispatch-ai/* plus dispatch compatibility packages.',
  ),
  checkEnv(
    'LAUNCH_ACCOUNTS_READY',
    'Set to 1 after HN, Reddit, and Twitter/X posting access plus dogfooding cadence are ready.',
  ),
  checkEnv(
    'DISPATCH_DOMAIN_READY',
    'Set to 1 after domain ownership/DNS for dispatch.ai launch properties is confirmed.',
  ),
];

const ready = checks.every((check) => check.ready);
console.log(JSON.stringify({ ready, checks }, null, 2));
process.exit(ready ? 0 : 1);

function checkEnv(name: string, detail: string): Check {
  return {
    name,
    ready: Boolean(process.env[name]),
    detail: process.env[name] ? 'Present.' : detail,
  };
}

function checkCommand(command: string, args: string[], detail: string): Check {
  const result = Bun.spawnSync([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    name: `${command} ${args.join(' ')}`,
    ready: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? 'Command succeeded.'
        : `${detail} ${result.stderr.toString().trim() || result.stdout.toString().trim()}`,
  };
}
