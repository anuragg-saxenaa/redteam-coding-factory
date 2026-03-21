# Factory Status Board

Phase 2 introduces a deterministic status board snapshot for autonomous runs.

## Purpose

Provide a single quick view of recent `factory-run.sh` outcomes by combining:

- `.worktrees/*.status` run status files
- `ops/metrics.json` aggregate metrics

This supports faster triage for CI/escalation patterns and gives a human-readable board for Slack updates or handoff notes.

## Usage

```bash
# Markdown summary (default)
node scripts/factory-status-board.js --repo /path/to/repo

# JSON summary for automation
node scripts/factory-status-board.js --repo /path/to/repo --format json

# Limit recent runs shown
node scripts/factory-status-board.js --repo /path/to/repo --limit 5
```

or via npm script:

```bash
npm run status-board -- --repo /path/to/repo
```

## Output

### Markdown mode

- Overall totals (runs/success/failed/escalated)
- Metrics record summary
- Recent run list (time, task, attempts, escalation, PR, Slack status)

### JSON mode

Structured payload with:

- `generatedAt`
- `totals`
- `metrics`
- `recent[]`

## Notes

- Status files are sorted by `created_at` descending.
- Malformed metrics JSON is treated as empty metrics for resilience.
- This script is read-only and safe to run in cron or CI diagnostics.
