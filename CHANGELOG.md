# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Notes
- Unscoped `dispatch` and `dispatch-ai` package names are squatted on npm by unrelated parties and will not be published from this repo. Users install via the scoped `@dispatch-ai/cli` and `@dispatch-ai/detector` packages, plus the unscoped `dispatch-detector` alias for short CI commands.

## [0.0.1] — 2026-05-12

### Added
- Week 0 scaffold: Bun workspaces monorepo, TypeScript strict config, biome lint/format, CI workflow, release workflow with cross-platform binary builds + npm publish + Homebrew formula update.
- Week 1 detector foundation: deterministic placeholder checks, minimal Python fake-import resolver, optional Claude judge hook, JSON CLI output with CI exit codes, 60-fixture eval harness, and composite GitHub Action wrapper.
- Shared zod schemas for plans, steps, verification results, replan inputs, and dispatch config.
- CLI safety helpers for `--auto` gating, typed consent, approval decisions, replan cap behavior, override handling, and `gh` diagnostics.
- Local Pattern 3 orchestration core with fake-adapter E2E support, SQLite run state, subprocess timeout handling, manual takeover artifacts, PR helper, Node-compatible package entrypoints, docs, installer script, and expanded CI matrix.
- Live Anthropic planner/executor/verifier/replanner adapter path, verified diff application after acceptance, Docker-mode `git apply` sandbox path, and reserved private `dispatch-pro` package boundary.
- `--max-cost-usd` budget halt path in the orchestrator with manual-takeover artifact on overrun.
- Ctrl-C abort handling threaded through the CLI, Anthropic helper, detector judge, run loop, and subprocess executor.
- `scripts/check-external-readiness.ts` runtime gate for ANTHROPIC_API_KEY, docker, gh auth, HOMEBREW_TAP_PAT, npm trusted-publishing readiness, launch accounts, and domain ownership.

### Published
- `@dispatch-ai/shared`, `@dispatch-ai/cli`, `@dispatch-ai/detector` on npm with provenance via OIDC trusted publishing.

## [0.0.0] — 2026-05-11

### Added
- Initial repository scaffold. No user-facing functionality yet. This release exists to prove the publish pipeline end-to-end before week-1 detector work begins.
- Pinned default model: `claude-sonnet-4-6` (in `@dispatch-ai/shared`).

[Unreleased]: https://github.com/dispatch-ai-labs/dispatch-ai/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/dispatch-ai-labs/dispatch-ai/releases/tag/v0.0.1
[0.0.0]: https://github.com/dispatch-ai-labs/dispatch-ai/releases/tag/v0.0.0
