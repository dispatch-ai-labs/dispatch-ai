import { type ProcessRunner, checkGhCli } from './index.ts';

export interface PullRequestOptions {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
}

export async function createPullRequest(
  runner: ProcessRunner,
  options: PullRequestOptions,
): Promise<string> {
  await checkGhCli(runner);

  const args = ['pr', 'create', '--title', options.title, '--body', options.body];
  if (options.base) {
    args.push('--base', options.base);
  }
  if (options.draft) {
    args.push('--draft');
  }

  const result = await runner.run('gh', args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to create GitHub pull request.');
  }

  return result.stdout.trim();
}
