import { access, chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const root = join(import.meta.dir, '..');

const requiredFiles = [
  'packages/shared/dist/node/index.js',
  'packages/detector/dist/node/index.js',
  'packages/detector/dist/node/bin.js',
  'packages/detector/dist/dispatch-detector',
  'packages/cli/dist/node/index.js',
  'packages/cli/dist/node/bin.js',
  'packages/cli/dist/dispatch',
  'LICENSE',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'install.sh',
  'action.yml',
  'packages/detector-action/action.yml',
  'packages/detector-action/comment.cjs',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'docs/index.md',
  'docs/comparison.md',
  'docs/launch.md',
  'docs/completion-audit.md',
  'docs/assets/demo.gif',
  'packages/eval/snapshots/detector-summary.json',
  'packages/eval/snapshots/plan-replan-summary.json',
];

for (const file of requiredFiles) {
  await access(join(root, file));
}

const license = await readText('LICENSE');
if (!license.includes('Apache License') || !license.includes('Version 2.0')) {
  throw new Error('LICENSE must contain Apache License 2.0 text.');
}

const readme = await readText('README.md');
if (!readme.includes('curl -fsSL') || !readme.includes('install.sh | sh')) {
  throw new Error('README must document the curl installer command.');
}

const detectorSummary = await readJson<{
  total: number;
  good: number;
  bad: number;
  minimumRecall: number;
  minimumPrecision: number;
}>('packages/eval/snapshots/detector-summary.json');
if (
  detectorSummary.total !== 60 ||
  detectorSummary.good !== 30 ||
  detectorSummary.bad !== 30 ||
  detectorSummary.minimumRecall !== 0.9 ||
  detectorSummary.minimumPrecision !== 0.95
) {
  throw new Error(`Detector snapshot summary drifted: ${JSON.stringify(detectorSummary)}`);
}

const planReplanSummary = await readJson<{ planFixtures: number; replanFixtures: number }>(
  'packages/eval/snapshots/plan-replan-summary.json',
);
if (planReplanSummary.planFixtures !== 10 || planReplanSummary.replanFixtures !== 5) {
  throw new Error(`Plan/replan snapshot summary drifted: ${JSON.stringify(planReplanSummary)}`);
}

await assertPackage('packages/dispatch/package.json', 'dispatch', {
  dispatch: './dist/node/bin.js',
});
await assertPackage('packages/dispatch-detector/package.json', 'dispatch-detector', {
  'dispatch-detector': './dist/node/bin.js',
});
await assertPackage('packages/dispatch-ai/package.json', 'dispatch-ai', {
  dispatch: './dist/node/dispatch.js',
  'dispatch-detector': './dist/node/dispatch-detector.js',
});

const ciWorkflow = await readText('.github/workflows/ci.yml');
for (const required of [
  'node-version: [20, 22]',
  'bun run lint',
  'bun run typecheck',
  'bun test',
  'bun run eval:snapshots',
  'bun run verify:release',
  'bun run eval:live',
  'DISPATCH_FAKE_RUN=1',
]) {
  if (!ciWorkflow.includes(required)) {
    throw new Error(`CI workflow is missing required surface: ${required}`);
  }
}

const releaseWorkflow = await readText('.github/workflows/release.yml');
for (const required of [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-darwin-x64',
  'bun-darwin-arm64',
  'bun-windows-x64',
  'bun run verify:release',
  'npm publish --access public --provenance',
  'homebrew-dispatch-ai',
]) {
  if (!releaseWorkflow.includes(required)) {
    throw new Error(`Release workflow is missing required surface: ${required}`);
  }
}

const action = await readText('action.yml');
for (const required of [
  'gh pr diff',
  'npx --yes @dispatch-ai/detector',
  'formatDetectorComment',
  'issues.createComment',
]) {
  if (!action.includes(required)) {
    throw new Error(`Root GitHub Action is missing required behavior: ${required}`);
  }
}

const packageAction = await readText('packages/detector-action/action.yml');
for (const required of ['formatDetectorComment', 'issues.createComment']) {
  if (!packageAction.includes(required)) {
    throw new Error(`Detector action package is missing required behavior: ${required}`);
  }
}

await verifyInstaller();

for (const binary of ['packages/detector/dist/dispatch-detector', 'packages/cli/dist/dispatch']) {
  const mode = (await stat(join(root, binary))).mode;
  if ((mode & 0o111) === 0) {
    throw new Error(`${binary} is not executable.`);
  }
}

const detectorVersion = await $`node packages/detector/dist/node/bin.js --version`.cwd(root).text();
const cliVersion = await $`node packages/cli/dist/node/bin.js --version`.cwd(root).text();
if (!detectorVersion.trim() || detectorVersion.trim() !== cliVersion.trim()) {
  throw new Error(`Version mismatch: detector=${detectorVersion} cli=${cliVersion}`);
}

const fakeRun =
  await $`env DISPATCH_FAKE_RUN=1 node packages/cli/dist/node/bin.js run "release smoke" --auto --docker`
    .cwd(root)
    .json();
if (fakeRun.status !== 'completed') {
  throw new Error(`Fake run did not complete: ${JSON.stringify(fakeRun)}`);
}

const badPatch = `diff --git a/app.py b/app.py
@@ -1,1 +1,2 @@
+# TODO: implement
+return None
`;
const detector = Bun.spawn(['node', 'packages/detector/dist/node/bin.js', '--repo', '.', '-'], {
  cwd: root,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
});
detector.stdin.write(badPatch);
detector.stdin.end();
const detectorExit = await detector.exited;
if (detectorExit !== 2) {
  throw new Error(`Detector smoke expected exit 2, got ${detectorExit}`);
}

const npmCliVersion = await $`npm exec --package ./packages/dispatch -- dispatch --version`
  .cwd(root)
  .text();
if (npmCliVersion.trim() !== cliVersion.trim()) {
  throw new Error(`npm exec dispatch version mismatch: ${npmCliVersion}`);
}

const npmDetectorVersion =
  await $`npm exec --package ./packages/dispatch-detector -- dispatch-detector --version`
    .cwd(root)
    .text();
if (npmDetectorVersion.trim() !== detectorVersion.trim()) {
  throw new Error(`npm exec dispatch-detector version mismatch: ${npmDetectorVersion}`);
}

const npmInstallCliVersion =
  await $`npm exec --package ./packages/dispatch-ai -- dispatch --version`.cwd(root).text();
if (npmInstallCliVersion.trim() !== cliVersion.trim()) {
  throw new Error(`dispatch-ai installer dispatch version mismatch: ${npmInstallCliVersion}`);
}

const npmInstallDetectorVersion =
  await $`npm exec --package ./packages/dispatch-ai -- dispatch-detector --version`
    .cwd(root)
    .text();
if (npmInstallDetectorVersion.trim() !== detectorVersion.trim()) {
  throw new Error(
    `dispatch-ai installer dispatch-detector version mismatch: ${npmInstallDetectorVersion}`,
  );
}

for (const pkg of [
  'packages/shared',
  'packages/detector',
  'packages/cli',
  'packages/dispatch',
  'packages/dispatch-detector',
  'packages/dispatch-ai',
]) {
  await $`npm pack --dry-run --json`.cwd(join(root, pkg)).quiet();
}

console.log('release verification passed');

async function readText(path: string): Promise<string> {
  return await readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

async function assertPackage(
  path: string,
  expectedName: string,
  expectedBin: Record<string, string>,
): Promise<void> {
  const pkg = await readJson<{ name?: string; license?: string; bin?: Record<string, string> }>(
    path,
  );
  if (pkg.name !== expectedName) {
    throw new Error(`${path} expected package name ${expectedName}, got ${pkg.name}`);
  }
  if (pkg.license !== 'Apache-2.0') {
    throw new Error(`${path} expected Apache-2.0 license, got ${pkg.license}`);
  }
  for (const [binName, binPath] of Object.entries(expectedBin)) {
    if (pkg.bin?.[binName] !== binPath) {
      throw new Error(`${path} expected bin ${binName}=${binPath}, got ${pkg.bin?.[binName]}`);
    }
  }
}

async function verifyInstaller(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'dispatch-install-'));
  const fakeBin = join(temp, 'bin');
  const installBin = join(temp, 'install-bin');
  await $`mkdir -p ${fakeBin} ${installBin}`;

  await writeFile(
    join(fakeBin, 'uname'),
    `#!/usr/bin/env sh
if [ "$1" = "-s" ]; then
  echo Linux
else
  echo x86_64
fi
`,
  );
  await writeFile(
    join(fakeBin, 'curl'),
    `#!/usr/bin/env sh
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
    break
  fi
  prev="$arg"
done
case "$*" in
  *"/releases/download/v0.0.1/dispatch-linux-x64"*) ;;
  *) echo "unexpected curl args: $*" >&2; exit 10 ;;
esac
printf '#!/usr/bin/env sh\\necho dispatch fake\\n' > "$out"
`,
  );
  await chmod(join(fakeBin, 'uname'), 0o755);
  await chmod(join(fakeBin, 'curl'), 0o755);

  const result = Bun.spawnSync(['sh', 'install.sh'], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      DISPATCH_BIN_DIR: installBin,
      DISPATCH_VERSION: 'v0.0.1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `install.sh smoke failed: ${result.stderr.toString() || result.stdout.toString()}`,
    );
  }
  const installed = join(installBin, 'dispatch');
  await access(installed);
  const mode = (await stat(installed)).mode;
  if ((mode & 0o111) === 0) {
    throw new Error('install.sh smoke produced a non-executable dispatch binary.');
  }
}
