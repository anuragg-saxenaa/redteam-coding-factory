# Architecture

## Goal
Produce PRs autonomously with verifiable accountability:
- every task is a GitHub Issue
- every change is a PR linked to the issue
- CI failures and review comments route back into the same session (“reactions”)
- humans only get pinged for judgment calls

## Phase 1 (POC)
- 1 repo, 1 issue label: `factory-ready`
- 2 roles: Implementer + Fixer
- Closed loop: issue → PR → CI → fix → review → fix → ready

## Phase 2 (Scale)
- scheduler + concurrency caps
- conflict/rebase reactions
- budgets + stop conditions
- security diff scanning + escalation rules
- dashboard / status board
