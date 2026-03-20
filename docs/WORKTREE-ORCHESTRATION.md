# Worktree Orchestration

This factory uses git worktrees to isolate each task execution.

## Lifecycle

- `create(taskId, branch, options)` allocates a per-task worktree and stores metadata in `.worktrees/.meta.jsonl`.
- `list(filter)` returns tracked worktrees by status and/or task id.
- `remove(worktreeId, { force })` removes a worktree and marks metadata as `removed` (use force for dirty/unmerged worktrees).
- `cleanupStale()` reconciles tracked active entries against git-authoritative registration.
- `pruneManaged({ olderThanMs })` prunes old `removed`/`stale` metadata entries.

## Metadata

Worktree metadata is persisted to JSONL to survive process restarts:

- `id`
- `taskId`
- `path`
- `branch`
- `baseBranch`
- `owner`
- `ticketId`
- `labels`
- `createdAt`
- `status` (`active` | `removed` | `stale`)
- `removedAt` (set for removed or stale entries)

## Stale Cleanup

Use `cleanupStale()` to reconcile metadata against the git-authoritative list:

- Parses `git worktree list --porcelain` output.
- Marks tracked `active` entries missing from git as `stale`.
- Prunes stale directories under the configured worktree root.

This keeps long-running automation resilient to manual cleanup or drift.

## Scheduled Maintenance

Run periodic reconciliation + metadata pruning:

```bash
node scripts/worktree-maintenance.js \
  --repo /path/to/repo \
  --worktree-root /path/to/repo/.worktrees \
  --prune-older-hours 168
```

Output is JSON so it can be scraped by cron/monitoring.
