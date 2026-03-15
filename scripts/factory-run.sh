#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/factory-run.sh [--task "..."] [--worktree-dir PATH] [--agent NAME] [--agent-cmd CMD] [--test-cmd CMD] [--cleanup] [--create-pr] [--ci-max-attempts N] [--help]

Phase-1 POC:
- create a git worktree per task
- write the task into the worktree
- run a coding agent CLI in the worktree (codex/claude/custom)
- run tests and report pass/fail
- optionally push + create PR, then poll CI checks and self-heal up to 3 attempts
- write run metrics to ops/metrics.json (task, duration, pass/fail, attempts) and post to #redos-eng when configured

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
create_pr="false"
ci_max_attempts=3
run_started_epoch="$(date +%s)"

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
    --create-pr)
      create_pr="true"
      shift
      ;;
    --ci-max-attempts)
      ci_max_attempts="${2:-}"
      shift 2
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

if ! [[ "$ci_max_attempts" =~ ^[0-9]+$ ]] || [[ "$ci_max_attempts" -lt 1 ]] || [[ "$ci_max_attempts" -gt 3 ]]; then
  echo "--ci-max-attempts must be an integer between 1 and 3" >&2
  exit 2
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
pr_url=""
ci_result="not_run"
ci_attempts=0
ci_last_error=""

if [[ -e "$worktree_path" ]]; then
  echo "Worktree path already exists: $worktree_path" >&2
  exit 1
fi

append_metrics_entry() {
  local metrics_path="$repo_root/ops/metrics.json"
  local end_iso
  local duration_sec
  local overall_result
  local attempts

  end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration_sec=$(( $(date +%s) - run_started_epoch ))
  overall_result="pass"
  attempts=1

  if [[ "$result" != "pass" ]]; then
    overall_result="fail"
  fi

  if [[ "$create_pr" == "true" ]]; then
    attempts="$ci_attempts"
    if [[ "$attempts" -lt 1 ]]; then
      attempts=1
    fi
    if [[ "$ci_result" != "passed" && "$ci_result" != "skipped" ]]; then
      overall_result="fail"
    fi
  fi

  mkdir -p "$(dirname "$metrics_path")"
  if [[ ! -f "$metrics_path" ]]; then
    printf '[]\n' >"$metrics_path"
  fi

  FACTORY_METRICS_TIMESTAMP="$end_iso" \
  FACTORY_METRICS_TASK="$task" \
  FACTORY_METRICS_BRANCH="$branch" \
  FACTORY_METRICS_DURATION="$duration_sec" \
  FACTORY_METRICS_RESULT="$overall_result" \
  FACTORY_METRICS_ATTEMPTS="$attempts" \
  FACTORY_METRICS_CREATE_PR="$create_pr" \
  FACTORY_METRICS_PR_URL="$pr_url" \
  FACTORY_METRICS_CI_RESULT="$ci_result" \
  FACTORY_METRICS_CI_LAST_ERROR="$ci_last_error" \
  python3 - "$metrics_path" <<'METRICS_PY'
import json
import os
import sys
from pathlib import Path

metrics_path = Path(sys.argv[1])
raw = metrics_path.read_text(encoding='utf-8') if metrics_path.exists() else '[]'
try:
    records = json.loads(raw)
    if not isinstance(records, list):
        records = []
except Exception:
    records = []

entry = {
    "timestamp": os.environ.get("FACTORY_METRICS_TIMESTAMP", ""),
    "task": os.environ.get("FACTORY_METRICS_TASK", ""),
    "branch": os.environ.get("FACTORY_METRICS_BRANCH", "main"),
    "durationSec": int(os.environ.get("FACTORY_METRICS_DURATION", "0") or 0),
    "result": os.environ.get("FACTORY_METRICS_RESULT", "fail"),
    "passFail": os.environ.get("FACTORY_METRICS_RESULT", "fail"),
    "attempts": int(os.environ.get("FACTORY_METRICS_ATTEMPTS", "1") or 1),
    "createPr": os.environ.get("FACTORY_METRICS_CREATE_PR", "false") == "true",
    "prUrl": os.environ.get("FACTORY_METRICS_PR_URL", ""),
    "ciResult": os.environ.get("FACTORY_METRICS_CI_RESULT", "not_run"),
    "ciLastError": os.environ.get("FACTORY_METRICS_CI_LAST_ERROR", ""),
}
records.append(entry)
records = records[-500:]
metrics_path.write_text(json.dumps(records, indent=2) + "\n", encoding='utf-8')
METRICS_PY

  echo "[factory-run] metrics appended to $metrics_path"
}

post_slack_update() {
  if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
    return 0
  fi

  local summary
  summary="ENG Factory Run - $(date '+%Y-%m-%d %H:%M %Z')
- Task: $task
- Result: $final_outcome
- Attempts: $final_attempts
- Duration: ${final_duration_sec}s
- PR: ${pr_url:-none}
- CI: $ci_result"

  local payload
  payload="$(printf '%s' "$summary" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}))')"

  curl -fsS -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL" >/dev/null || {
    echo "[factory-run] warning: failed to post Slack update" >&2
  }
}

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

# Phase 2: lint gate before tests
echo "[factory-run] running lint gate..."
lint_rc=0
lint_cmd="${LINT_CMD:-npm run lint}"
if ! (
  cd "$worktree_path"
  bash -lc "$lint_cmd"
); then
  lint_rc=$?
fi

if [[ "$lint_rc" -ne 0 ]]; then
  echo "[factory-run] lint gate FAILED (exit $lint_rc), attempting auto-fix..."
  if (
    cd "$worktree_path"
    bash -lc "$lint_cmd --fix"
  ); then
    echo "[factory-run] lint auto-fix applied, re-running lint..."
    if ! (
      cd "$worktree_path"
      bash -lc "$lint_cmd"
    ); then
      echo "[factory-run] lint still failing after auto-fix, failing task."
      test_rc=1
      result="fail"
      cat >"$status_file" <<STATUS
branch=$branch
worktree=$worktree_path
agent=$agent_name
agent_rc=$agent_rc
test_cmd=$test_cmd
lint_cmd=$lint_cmd
lint_rc=$lint_rc
result=$result
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUS
      append_metrics_entry
      post_slack_update
      exit 1
    fi
  else
    echo "[factory-run] lint auto-fix failed, failing task."
    test_rc=1
    result="fail"
    cat >"$status_file" <<STATUS
branch=$branch
worktree=$worktree_path
agent=$agent_name
agent_rc=$agent_rc
test_cmd=$test_cmd
lint_cmd=$lint_cmd
lint_rc=$lint_rc
result=$result
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUS
    append_metrics_entry
    post_slack_update
    exit 1
  fi
fi
echo "[factory-run] lint gate PASSED"

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

if [[ "$result" == "pass" && "$create_pr" == "true" ]]; then
  echo "[factory-run] creating PR and polling CI checks"
  pushd "$worktree_path" >/dev/null

  if ! git remote get-url origin >/dev/null 2>&1; then
    ci_result="skipped"
    ci_last_error="missing git origin remote"
    echo "[factory-run] skipping PR: $ci_last_error"
  else
    git add -A
    if ! git diff --cached --quiet; then
      git commit -m "feat: complete factory task $stamp" >/dev/null
    fi

    if git push -u origin "$branch" >/dev/null 2>&1; then
      pr_title="Factory task $stamp"
      pr_body="Automated change generated by scripts/factory-run.sh"
      if gh_out="$(gh pr create --title "$pr_title" --body "$pr_body" --base main --head "$branch" 2>/dev/null)"; then
        pr_url="$(printf '%s' "$gh_out" | tail -n 1)"
        ci_result="pending"

        while [[ "$ci_attempts" -lt "$ci_max_attempts" ]]; do
          ci_attempts=$((ci_attempts + 1))
          if checks_out="$(gh pr checks "$pr_url" 2>&1)"; then
            if printf '%s' "$checks_out" | grep -q 'fail'; then
              ci_last_error="ci checks reported failure"
              if [[ "$ci_attempts" -lt "$ci_max_attempts" ]]; then
                echo "[factory-run] CI failed (attempt $ci_attempts/$ci_max_attempts), retrying tests and pushing"
                if bash -lc "$test_cmd" >/dev/null 2>&1 && git push >/dev/null 2>&1; then
                  sleep 5
                  continue
                else
                  ci_last_error="self-fix attempt failed"
                fi
              fi
              ci_result="failed"
              break
            fi

            if printf '%s' "$checks_out" | grep -Eq '(pass|success)'; then
              ci_result="passed"
              break
            fi

            sleep 5
          else
            ci_last_error="gh pr checks failed"
            ci_result="failed"
            break
          fi
        done

        if [[ "$ci_result" == "pending" ]]; then
          ci_result="failed"
          ci_last_error="ci checks did not reach pass state"
        fi
      else
        ci_result="failed"
        ci_last_error="gh pr create failed"
      fi
    else
      ci_result="failed"
      ci_last_error="git push failed"
    fi
  fi

  popd >/dev/null
fi

cat >>"$status_file" <<STATUS
create_pr=$create_pr
pr_url=$pr_url
ci_attempts=$ci_attempts
ci_result=$ci_result
ci_last_error=$ci_last_error
STATUS

final_outcome="pass"
final_attempts=1
final_duration_sec=$(( $(date +%s) - run_started_epoch ))

if [[ "$result" != "pass" ]]; then
  final_outcome="fail"
fi

if [[ "$create_pr" == "true" ]]; then
  final_attempts="$ci_attempts"
  if [[ "$final_attempts" -lt 1 ]]; then
    final_attempts=1
  fi
  if [[ "$ci_result" != "passed" && "$ci_result" != "skipped" ]]; then
    final_outcome="fail"
  fi
fi

append_metrics_entry
post_slack_update

if [[ "$final_outcome" != "pass" ]]; then
  if [[ "$create_pr" == "true" && "$ci_result" != "passed" && "$ci_result" != "skipped" ]]; then
    echo "[factory-run] escalation: CI did not pass after $ci_attempts attempt(s)."
  fi
  exit 1
fi
