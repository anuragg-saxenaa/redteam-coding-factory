# Worktree Orchestration

This factory uses git worktrees to isolate each task execution.

## Lifecycle

- `create(taskId, branch)` allocates a per-task worktree and stores metadata in `.worktrees/.meta.jsonl`.
- `list(filter)` returns tracked worktrees by status and/or task id.
- `remove(worktreeId)` removes a worktree and marks metadata as `removed`.

## Metadata

Worktree metadata is persisted to JSONL to survive process restarts:

- `id`
- `taskId`
- `path`
- `branch`
- `createdAt`
- `status` (`active` | `removed` | `stale`)
- `removedAt` (set for removed or stale entries)

## Stale Cleanup

Use `cleanupStale()` to reconcile metadata against the git-authoritative list:

- Parses `git worktree list --porcelain` output.
- Marks tracked `active` entries missing from git as `stale`.
- Prunes stale directories under the configured worktree root.

This keeps long-running automation resilient to manual cleanup or drift.
