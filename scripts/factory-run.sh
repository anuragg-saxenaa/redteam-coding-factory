#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/factory-run.sh [--task "..."] [--worktree-dir PATH] [--agent NAME] [--agent-cmd CMD] [--test-cmd CMD] [--cleanup] [--help]

Phase-1 POC:
- create a git worktree per task
- write the task into the worktree
- run a coding agent CLI in the worktree (codex/claude/custom)
- run tests and report pass/fail

Defaults:
- task: hardcoded POC task
- agent: codex
- test command: npm test
USAGE
}

repo_root=""
worktree_dir=""
cleanup="false"
task=""
agent_name="codex"
agent_cmd=""
test_cmd="npm test"

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
    --agent)
      agent_name="${2:-}"
      shift 2
      ;;
    --agent-cmd)
      agent_cmd="${2:-}"
      shift 2
      ;;
    --test-cmd)
      test_cmd="${2:-}"
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
  task="POC task: run agent CLI in isolated worktree and execute tests."
fi

if [[ -z "$worktree_dir" ]]; then
  worktree_dir="$repo_root/.worktrees"
fi

if [[ -z "$agent_cmd" ]]; then
  case "$agent_name" in
    codex)
      agent_cmd='codex "Read TASK.md and implement the requested change in this worktree. Run tests and summarize outcomes in AGENT-REPORT.md."'
      ;;
    claude)
      agent_cmd='claude "Read TASK.md and implement the requested change in this worktree. Run tests and summarize outcomes in AGENT-REPORT.md."'
      ;;
    *)
      echo "Unknown --agent '$agent_name'. Use codex, claude, or provide --agent-cmd." >&2
      exit 2
      ;;
  esac
fi

mkdir -p "$worktree_dir"

stamp="$(date +%Y%m%d-%H%M%S)"
branch="poc/task-$stamp"
worktree_path="$worktree_dir/$branch"
status_file="$worktree_dir/factory-run-$stamp.status"

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

echo "[factory-run] running agent command ($agent_name): $agent_cmd"
agent_rc=0
if ! (
  cd "$worktree_path"
  bash -lc "$agent_cmd"
); then
  agent_rc=$?
fi

echo "[factory-run] running test command: $test_cmd"
test_rc=0
if ! (
  cd "$worktree_path"
  bash -lc "$test_cmd"
); then
  test_rc=$?
fi

result="pass"
if [[ "$agent_rc" -ne 0 || "$test_rc" -ne 0 ]]; then
  result="fail"
fi

cat >"$status_file" <<STATUS
branch=$branch
worktree=$worktree_path
agent=$agent_name
agent_rc=$agent_rc
test_cmd=$test_cmd
test_rc=$test_rc
result=$result
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUS

echo "[factory-run] status written to $status_file"

echo "[factory-run] git status for worktree:"
GIT_DIR="$worktree_path/.git" git -C "$worktree_path" status -sb

echo "[factory-run] done ($result)"

if [[ "$result" != "pass" ]]; then
  exit 1
fi
