# Contributing

dispatch.ai is Apache-2.0 open-core software. The OSS line is the core orchestrator, local CLI, Python verifier, and detector eval harness.

## Local Setup

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run eval:snapshots
bun run build
```

## Detector Changes

Detector changes must keep the 60-fixture eval above launch thresholds:

- Recall on known-bad fixtures: at least 90%.
- Precision on known-good fixtures: at least 95%.

Add a fixture before changing detector behavior whenever a false positive or false negative is being fixed.

## Pull Requests

Keep PRs focused. Include the verifier output or test command output in the PR description when behavior changes.
