# dispatch.ai

Pattern 3 autonomous coding CLI with a verifier you can trust.

> **Status:** pre-launch scaffold (v0.0.0). Week-1 detector launch and v0.1 CLI launch coming. See `~/.gstack/projects/dispatch.ai/andrew-main-design-20260511-133414.md` for the design doc (v2-REV1 amendments at the bottom are the locked plan).

## Packages

| Package | Description |
|---|---|
| `@dispatch-ai/detector` | Placeholder + fake-import detector for AI-generated Python diffs. Ships standalone on npm. |
| `dispatch-ai` (binary `dispatch`) | The Pattern 3 orchestrator CLI: plan → step-execute → verify → replan. |
| `@dispatch-ai/shared` | Shared zod schemas (Plan, Step, StepResult, VerificationResult, ReplanInput, DispatchConfig). |
| `@dispatch-ai/eval` | Eval harness for the detector with committed JSON snapshots for determinism. |

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

Required secrets in the repo settings:
- `NPM_TOKEN` — npm automation token with publish rights to `dispatch-ai`, `@dispatch-ai/detector`, `@dispatch-ai/shared`.
- `HOMEBREW_TAP_PAT` — fine-grained GitHub PAT with `contents: write` on the `homebrew-dispatch-ai` repo.
