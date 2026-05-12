# Launch Checklist

## Detector Launch

Headline:

> Show HN: I catch the placeholders your AI agent slipped past you

Demo asset:

- `docs/assets/demo.gif`

Preflight:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run build
bun run eval:snapshots
bun run verify:release
```

External readiness:

```bash
bun run verify:external
```

This command is expected to fail until live API credentials, Docker access, GitHub/release credentials, and launch-account readiness are in place.
Use `NPM_TRUSTED_PUBLISHING_READY=1` and `LAUNCH_ACCOUNTS_READY=1` only after those manual external gates are actually done.

Channels:

- Hacker News
- r/Python
- r/LocalLLaMA
- r/programming
- Dev Twitter/X

## CLI Launch

Headline:

> Show HN: dispatch.ai - Pattern 3 autonomous coding with a verifier you can trust

Required links:

- README quick start
- Comparison page: `docs/comparison.md`
- Completion audit: `docs/completion-audit.md`
- GitHub Action: `action.yml`
- Demo GIF: `docs/assets/demo.gif`

## Post-Launch Tracking

- Installs in first week
- GitHub stars in first week
- Detector false positives
- Detector false negatives
- Issues and PRs from external users
