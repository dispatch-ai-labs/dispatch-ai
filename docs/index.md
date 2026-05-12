# dispatch.ai

dispatch.ai is a Pattern 3 autonomous coding CLI: plan, execute one step at a time, verify, and replan on failure.

The first launch artifact is the Python diff detector:

```bash
git diff | dispatch-detector --repo .
```

It returns JSON with a score, verdict, suspect lines, and CI-friendly exit codes.

## Safety Defaults

`--gate-on-warn` is the default. `--auto` refuses unless Docker is enabled or typed consent has been recorded.

## Open-Core Line

Always OSS:

- Core local orchestrator.
- Python verifier and eval harness.
- Local CLI and GitHub Action wrapper.

Paid later:

- Hosted managed runs.
- Multi-language verifiers.
- SSO, audit logs, RBAC, on-prem deploy, and support.
