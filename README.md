# RedTeam Coding Factory

An R&D repo for building an autonomous, self-healing “coding factory”:
- worktree-per-task isolation
- optional tmux runtime
- CI/review “reactions” loop
- metrics + dashboards

## Quick start

1) Install prerequisites:
- git
- gh (GitHub CLI)
- node >= 20
- (optional) tmux

2) Run a local session (stub for now):
```bash
bash scripts/factory-run.sh --help
```

## Architecture (high level)

```mermaid
flowchart LR
  A[Issue/Task] --> B[Planner/Orchestrator]
  B --> C[Workspace Adapter\n(git worktree)]
  C --> D[Runtime Adapter\n(process|tmux)]
  D --> E[Coding Agent\n(Claude Code/Codex/etc.)]
  E --> F[SCM Adapter\n(PR create/update)]
  F --> G[CI]
  G -->|ci_failed| H[Reaction: Fix CI]
  F -->|changes_requested| I[Reaction: Address Review]
  H --> F
  I --> F
  F -->|green + approved| J[Ready for merge]
```

## Repo layout
- `docs/` architecture, runbooks
- `scripts/` runner scripts (worktrees, tmux, PR loop)
- `ops/` task registry + metrics outputs
- `integrations/` GitHub/Slack adapters (thin wrappers)

## Status
This repo is bootstrapped with CI and a minimal runner skeleton. Next: implement Phase-1 POC.
