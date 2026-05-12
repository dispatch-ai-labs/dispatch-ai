# Completion Audit

Date: 2026-05-12

Objective: complete the implementation and test tasks in the two project markdowns:

- `/home/andrew/.gstack/projects/dispatch.ai/andrew-main-design-20260511-133414.md`
- `/home/andrew/.gstack/projects/dispatch.ai/andrew-main-eng-review-test-plan-20260511-140000.md`

## Local Deliverables

| Requirement | Evidence | Status |
|---|---|---|
| Standalone detector CLI reads diff from stdin/file. | `packages/detector/src/bin.ts`, `node packages/detector/dist/node/bin.js --repo . -` in `bun run verify:release`. | Done |
| Apache 2.0 OSS license. | Root `LICENSE`, package `license` fields, and release verifier required-file check. | Done |
| Detector emits score, suspect lines, failure modes, exit `0/1/2`. | `packages/detector/src/index.ts`, `packages/detector/src/index.test.ts`, release verifier placeholder smoke expects exit `2`. | Done |
| Placeholder checks from rubric. | `detectPlaceholderLine` tests cover TODO, `NotImplementedError`, ellipsis, empty/mock returns, placeholder strings. | Done |
| Minimal fake-import resolver with no-deps fallback. | `detectFabricatedImports`, detector tests for dep-file present and absent. | Done |
| Claude judge hook with rubric, timeout, prompt caching. | `createAnthropicJudge`, detector tests assert timeout signal and prompt-caching header. | Done |
| Pattern 3 run loop: plan, execute, verify, replan. | `packages/cli/src/orchestrator.ts`, orchestrator tests cover happy path, warn, replan recovery, hard halt. | Done |
| Local sandboxed subprocess execution. | `runSandboxedSubprocessStep` clones the repo into a disposable temp working copy before running a subprocess; executor tests prove writes do not affect the source repo and cleanup happens. | Done |
| Live Anthropic planner/executor/replanner adapters. | `packages/cli/src/live.ts`, `packages/cli/src/live.test.ts`. | Implemented; live API not run here |
| Pinned Anthropic model deprecation diagnostic. | `requestAnthropicJson` reads non-OK Anthropic bodies and emits a `CHANGELOG.md` upgrade-path error; `packages/cli/src/index.test.ts` covers the edge case. | Done |
| Ctrl-C/interruption handling. | `packages/cli/src/bin.ts` creates an abort controller, `requestAnthropicJson` and `createAnthropicJudge` compose timeout/user abort signals, `runDispatch` halts with a takeover artifact, and `runSubprocessStep` kills aborted child processes; tests cover all local paths. | Done |
| Verified diff application. | `applyVerifiedDiff`, test applies a real unified diff in a temp git repo. | Done |
| Docker sandbox path. | `ensureDockerSandbox`, `applyVerifiedDiffInDocker`, `dockerApplyArgs` test. | Implemented; daemon unavailable here |
| SQLite state for runs/steps/verifications/replans. | `packages/cli/src/state.ts`, `packages/cli/src/state.test.ts`. | Done |
| Safety: `--gate-on-warn` default, `--auto` requires Docker or typed consent. | `packages/cli/src/index.ts`, CLI tests. | Done |
| Plan approval states approve/edit/reject. | `parseApprovalDecision`, orchestration approval tests. | Done |
| Replan cap and takeover artifact. | `runStepWithReplans`, `manual-takeover.json` test. | Done |
| `--max-cost-usd` halt with preserved state/takeover artifact. | `parseRunArgs` cost parsing, `runDispatch` budget accounting, orchestrator test writes takeover artifact after cost budget exceeded. | Done |
| `gh` missing/unauthed diagnostics and PR helper. | `checkGhCli`, `createPullRequest`, tests. | Done |
| Eval harness: 30 good + 30 bad, thresholds. | `packages/eval/src/fixtures.ts`, `bun run eval:snapshots`: recall `1.0`, precision `1.0`; `bun run verify:release` asserts snapshot counts and thresholds. | Done |
| Plan/replan snapshot fixtures. | `packages/eval/src/plan-fixtures.ts`, eval tests assert 10 plan + 5 replan fixtures; `bun run verify:release` asserts committed snapshot counts. | Done |
| GitHub Action wrapper comments detector result. | Root `action.yml`, `packages/detector-action/action.yml`, `packages/detector-action/comment.cjs`; tests cover pass/fail comment bodies and `bun run verify:release` asserts PR diff collection, detector invocation, formatter use, and comment creation strings exist. | Implemented; remote PR not run here |
| Node-compatible package bins. | Package `dist/node/bin.js` entrypoints, `npm exec --package ./packages/...` checks in `verify-release`; release verifier also validates compatibility package names/licenses/bin maps. | Done locally |
| Exact npm install surfaces: `npx dispatch`, `npx dispatch-detector`, `npm install -g dispatch-ai`. | Compatibility packages `packages/dispatch`, `packages/dispatch-detector`, `packages/dispatch-ai`; `bun run verify:release` checks local `npm exec --package ./packages/...` equivalents, package names/bin maps, and npm pack dry-runs. | Done locally; public name claiming still external |
| Bun-compiled binaries. | `packages/cli/dist/dispatch`, `packages/detector/dist/dispatch-detector`, build + release verifier. | Done |
| Homebrew/curl installer surfaces. | `.github/workflows/release.yml`, `install.sh`; release verifier checks installer/docs exist, README documents `curl -fsSL ... | sh`, smoke-tests `install.sh` with fake `uname`/`curl`, and asserts the release workflow includes release-tag verification, Bun target matrix, npm publishing, and Homebrew tap update. | Implemented; release artifact matrix not run here |
| README quick start and comparison. | `README.md`, `docs/comparison.md`. | Done |
| Docs site seed. | `docs/index.md`, `docs/launch.md`. | Done |
| CONTRIBUTING and CODE_OF_CONDUCT. | Root docs. | Done |
| Demo GIF. | `docs/assets/demo.gif`, verified 960x540, 30.0 seconds. | Done |
| Reserved private pro package boundary. | `packages/dispatch-pro/package.json`. | Done |

## Verification Commands

Latest passing local commands:

```bash
bun test
bun run typecheck
bun run lint
bun run build
bun run eval:snapshots
bun run verify:release
DISPATCH_FAKE_RUN=1 node packages/cli/dist/node/bin.js run "ci fixture" --auto --docker
```

## External Blockers

These items are in the markdowns but cannot be truthfully completed in this local session:

- Live Anthropic E2E and live judge snapshot regeneration: `ANTHROPIC_API_KEY` is unset.
- Docker sandbox live execution: Docker CLI exists, but daemon access returns permission denied on `/var/run/docker.sock`.
- Real GitHub PR creation and Action PR comment: `gh` is authenticated, but running this would create or mutate a remote PR.
- npm/Homebrew/curl full install matrix: requires published release artifacts and account/tap access.
- Public package-name claiming for exact shorthand commands like `npx dispatch run` and `npx dispatch-detector`: compatibility packages exist and verify locally; publishing/claiming names remains external.
- HN/Reddit/Twitter launch posts and 3x/week dogfooding: require external accounts and elapsed time.

The local implementation is ready for those external verification steps once credentials, release artifacts, Docker access, and launch-account access are available.
