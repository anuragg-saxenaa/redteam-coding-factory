# Phase 4 — CI Reaction Loop

## Overview
Phase 4 adds a post-PR CI reaction loop to `scripts/factory-run.sh`.
After creating a PR, the runner monitors `gh pr checks` and attempts autonomous remediation on CI failures.

## Implementation

### CI Watch + Classification
- Polls `gh pr checks --json bucket` and classifies overall state:
  - `pass` when all checks pass/skipped
  - `fail` when any check fails
  - `pending` otherwise
- Uses bounded polling with 15s intervals.

### Autonomous CI Remediation
- On failure, captures failed check summaries (`name`, `description`, `link`)
- Re-runs coding agent with remediation context (`mode=ci-fix-N`)
- Auto-commits/pushes remediation changes
- Re-enters CI watch loop after push

### Safety Bounds
- Maximum remediation attempts configurable via `--ci-max-fix-attempts` (default `3`)
- `--no-watch-ci` disables loop explicitly
- On exhausted attempts, marks escalation with:
  - `escalation_required=true`
  - `escalation_reason=ci_failed_after_max_reaction_attempts`

## CLI Additions
- `--no-watch-ci`
- `--ci-max-fix-attempts N`

## Notes
- CI reaction runs only when PR creation succeeds (`--create-pr` path).
- Existing pre-PR local self-fix loop remains unchanged.
