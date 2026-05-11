# dispatch.ai

Pattern 3 autonomous coding CLI with a verifier you can trust.

> **Status:** pre-launch scaffold (v0.0.0). Week-1 detector launch and v0.1 CLI launch coming. v2-REV1 design notes track in `DESIGN.md` (added before week-1 work begins).

## Packages

| Package | Description |
|---|---|
| `@dispatch-ai-labs/detector` | Placeholder + fake-import detector for AI-generated Python diffs. Ships standalone on npm. Binary: `dispatch-detector`. |
| `@dispatch-ai-labs/cli` | The Pattern 3 orchestrator CLI: plan → step-execute → verify → replan. Binary: `dispatch`. |
| `@dispatch-ai-labs/shared` | Shared zod schemas (Plan, Step, StepResult, VerificationResult, ReplanInput, DispatchConfig). |
| `@dispatch-ai-labs/eval` | Eval harness for the detector with committed JSON snapshots for determinism. (private)|

## Open-core line

OSS, Apache 2.0:
- Core orchestrator (Pattern 3: plan → execute → verify → replan).
- Python verifier (placeholder detection + minimal import resolver + LLM judge).
- CLI, local sandbox, optional Docker sandbox.

Hosted SaaS / paid (later, never relicensed from OSS):
- Managed runs without local sandbox.
- Multi-language verifiers (TS, Go, Rust, Java).
- SSO, audit logs, RBAC, on-prem deploy.
- Support contract.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun test
```

## Release

```bash
git tag v0.x.y
git push --tags
```

The release workflow builds Bun-compiled binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64; publishes the three npm packages; updates the Homebrew formula in `homebrew-dispatch-ai`; attaches binaries to the GitHub Release.

Required secrets in `dispatch-ai-labs/dispatch-ai` settings:
- `NPM_TOKEN` — npm automation token with publish rights to `@dispatch-ai-labs/cli`, `@dispatch-ai-labs/detector`, `@dispatch-ai-labs/shared`. Recommended: granular access token scoped only to those packages.
- `HOMEBREW_TAP_PAT` — fine-grained GitHub PAT with `contents: write` on `dispatch-ai-labs/homebrew-dispatch-ai`.
