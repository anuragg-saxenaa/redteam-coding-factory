#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/factory-run.sh [--task "..."] [--worktree-dir PATH] [--cleanup] [--help]

Phase-1 POC:
- create a git worktree per task
- write the task into the worktree
- run a simple placeholder "agent" action in the worktree

Defaults to a hardcoded task when --task is not provided.
EOF
}

repo_root=""
worktree_dir=""
cleanup="false"
task=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --task)
      task="${2:-}"
      shift 2
      ;;
    --worktree-dir)
      worktree_dir="${2:-}"
      shift 2
      ;;
    --cleanup)
      cleanup="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

repo_root="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
if [[ -z "$repo_root" ]]; then
  echo "Failed to resolve repo root." >&2
  exit 1
fi

if [[ -z "$task" ]]; then
  task="POC task: verify worktree isolation by creating a placeholder file."
fi

if [[ -z "$worktree_dir" ]]; then
  worktree_dir="$repo_root/.worktrees"
fi

mkdir -p "$worktree_dir"

stamp="$(date +%Y%m%d-%H%M%S)"
branch="poc/task-$stamp"
worktree_path="$worktree_dir/$branch"

if [[ -e "$worktree_path" ]]; then
  echo "Worktree path already exists: $worktree_path" >&2
  exit 1
fi

cleanup_worktree() {
  if [[ "$cleanup" == "true" && -d "$worktree_path" ]]; then
    git -C "$repo_root" worktree remove "$worktree_path" >/dev/null 2>&1 || true
  fi
}
trap cleanup_worktree EXIT

git -C "$repo_root" worktree add -b "$branch" "$worktree_path" >/dev/null

echo "$task" >"$worktree_path/TASK.md"

echo "[factory-run] task written to $worktree_path/TASK.md"

# Placeholder "agent" action for the POC.
printf '%s\n' "Worktree created at: $worktree_path" "Task: $task" >"$worktree_path/POC-AGENT-OUTPUT.txt"

echo "[factory-run] placeholder agent output written to $worktree_path/POC-AGENT-OUTPUT.txt"

echo "[factory-run] git status for worktree:"
GIT_DIR="$worktree_path/.git" git -C "$worktree_path" status -sb

echo "[factory-run] done"
