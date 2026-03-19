#!/usr/bin/env bash
# Factory Runner - Phase 1/2/3 POC
# Accepts a task description, creates an isolated git worktree,
# runs a coding agent (codex/claude/custom), runs lint/tests,
# and can push/create a PR when successful.

set -euo pipefail

BASE_REPO_DEFAULT="/Users/redinside/Development/Codebase/projects/RedTeam/github/redteam-coding-factory"
BASE_REPO="${BASE_REPO_DEFAULT}"
BASE_BRANCH="main"
WORKTREE_BASE=""
AGENT="auto"              # auto|codex|claude|none
AGENT_CMD=""              # custom command (run inside worktree)
SKIP_TESTS="false"
SELF_FIX_ON_FAILURE="true"
CREATE_PR="false"
PR_BASE_BRANCH=""

usage() {
  cat <<'EOF'
Usage:
  factory-run.sh [options] <task description>

Options:
  --repo <path>            Base repo path (default: redteam-coding-factory)
  --base-branch <branch>   Base branch to branch from (default: main)
  --worktree-base <path>   Worktree root (default: <repo>/.worktrees)
  --agent <name>           auto|codex|claude|none (default: auto)
  --agent-cmd <command>    Custom agent command to run in worktree
  --skip-tests             Skip lint/test stage
  --no-self-fix            Disable one retry/self-fix cycle on failure
  --create-pr              Push branch + create PR on success (requires gh auth)
  --pr-base <branch>       PR base branch (default: --base-branch)
  -h, --help               Show help

Examples:
  ./scripts/factory-run.sh "Add retry for API client"
  ./scripts/factory-run.sh --agent codex "Implement health endpoint"
  ./scripts/factory-run.sh --agent-cmd "codex exec --full-auto 'Refactor task queue'" "Refactor task queue"
  ./scripts/factory-run.sh --create-pr "Add metrics rollup"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      BASE_REPO="$2"
      shift 2
      ;;
    --base-branch)
      BASE_BRANCH="$2"
      shift 2
      ;;
    --worktree-base)
      WORKTREE_BASE="$2"
      shift 2
      ;;
    --agent)
      AGENT="$2"
      shift 2
      ;;
    --agent-cmd)
      AGENT_CMD="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS="true"
      shift
      ;;
    --no-self-fix)
      SELF_FIX_ON_FAILURE="false"
      shift
      ;;
    --create-pr)
      CREATE_PR="true"
      shift
      ;;
    --pr-base)
      PR_BASE_BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Error: unknown option $1" >&2
      usage
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  echo "Error: No task description provided." >&2
  usage
  exit 1
fi

TASK_DESC="$*"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SHORT_SHA="$(git -C "$BASE_REPO" rev-parse --short "$BASE_BRANCH")"
WORKTREE_NAME="factory-run-${TIMESTAMP}"
WORKTREE_BRANCH="worktree-${WORKTREE_NAME}"
WORKTREE_BASE="${WORKTREE_BASE:-${BASE_REPO}/.worktrees}"
WORKTREE_PATH="${WORKTREE_BASE}/${WORKTREE_NAME}"
STATUS_FILE="${WORKTREE_BASE}/${WORKTREE_NAME}.status"
AGENT_LOG="${WORKTREE_PATH}/agent-run.log"
PR_BASE_BRANCH="${PR_BASE_BRANCH:-$BASE_BRANCH}"

mkdir -p "$WORKTREE_BASE"

echo "🚀 Task: ${TASK_DESC}"
echo "📦 Repo: ${BASE_REPO}"
echo "🌿 Base branch: ${BASE_BRANCH} (${SHORT_SHA})"
echo "📁 Worktree: ${WORKTREE_PATH}"

git -C "$BASE_REPO" worktree add -b "$WORKTREE_BRANCH" "$WORKTREE_PATH" "$BASE_BRANCH"

# Ensure local git identity is set inside worktree for commits.
git -C "$WORKTREE_PATH" config user.email >/dev/null 2>&1 || git -C "$WORKTREE_PATH" config user.email "eng-factory@local"
git -C "$WORKTREE_PATH" config user.name >/dev/null 2>&1 || git -C "$WORKTREE_PATH" config user.name "ENG Factory"

{
  echo "AGENT START: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Task: ${TASK_DESC}"
  echo "Worktree: ${WORKTREE_PATH}"
  echo "Base branch: ${BASE_BRANCH}"
  echo "Worktree branch: ${WORKTREE_BRANCH}"
} > "$AGENT_LOG"

run_agent() {
  local mode="${1:-initial}"
  local extra_context="${2:-}"
  local prompt

  prompt="You are an autonomous coding agent. Work only in this repository worktree.
Task: ${TASK_DESC}

Requirements:
- Implement the requested change.
- Run lint/tests relevant to the project.
- Commit changes with a clear message.
- Do not push.
- Print a short summary of files changed and test results."

  if [[ "$mode" == "self-fix" ]]; then
    prompt="${prompt}

The previous run failed checks. This is a one-time self-fix attempt.
Fix the failing checks and update the existing branch commit(s).

Failure context:
${extra_context}"
  fi

  if [[ -n "$AGENT_CMD" ]]; then
    echo "🤖 Running custom agent command (${mode})"
    echo "Custom command (${mode}): $AGENT_CMD" >> "$AGENT_LOG"
    (
      cd "$WORKTREE_PATH"
      bash -lc "$AGENT_CMD"
    ) >> "$AGENT_LOG" 2>&1
    return
  fi

  local effective_agent="$AGENT"
  if [[ "$effective_agent" == "auto" ]]; then
    if command -v codex >/dev/null 2>&1; then
      effective_agent="codex"
    elif command -v claude >/dev/null 2>&1; then
      effective_agent="claude"
    else
      effective_agent="none"
    fi
  fi

  case "$effective_agent" in
    codex)
      echo "🤖 Running Codex agent (${mode})"
      (
        cd "$WORKTREE_PATH"
        codex exec --full-auto "$prompt"
      ) >> "$AGENT_LOG" 2>&1
      ;;
    claude)
      echo "🤖 Running Claude Code agent (${mode})"
      (
        cd "$WORKTREE_PATH"
        claude --permission-mode bypassPermissions --print "$prompt"
      ) >> "$AGENT_LOG" 2>&1
      ;;
    none)
      echo "⚠️ No coding agent selected or available; skipping agent run"
      echo "Agent skipped (none/unsupported)" >> "$AGENT_LOG"
      ;;
    *)
      echo "Error: unsupported --agent value '$effective_agent'" >&2
      return 2
      ;;
  esac
}

run_checks() {
  local lint_rc=0
  local test_rc=0

  if [[ "$SKIP_TESTS" == "true" ]]; then
    echo "⏭️  Skipping lint/tests (--skip-tests)"
    return 0
  fi

  if [[ -f "$WORKTREE_PATH/package.json" ]] && command -v node >/dev/null 2>&1; then
    if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.lint?0:1)' >/dev/null 2>&1; then
      echo "🧹 Running npm run lint --silent"
      (cd "$WORKTREE_PATH" && npm run lint --silent) >> "$AGENT_LOG" 2>&1 || lint_rc=$?
    fi

    if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.test?0:1)' >/dev/null 2>&1; then
      echo "🧪 Running npm test --silent"
      (cd "$WORKTREE_PATH" && npm test --silent) >> "$AGENT_LOG" 2>&1 || test_rc=$?
    fi
  fi

  if [[ -f "$WORKTREE_PATH/pyproject.toml" || -f "$WORKTREE_PATH/pytest.ini" || -d "$WORKTREE_PATH/tests" ]] && command -v pytest >/dev/null 2>&1; then
    echo "🧪 Running pytest -q"
    (cd "$WORKTREE_PATH" && pytest -q) >> "$AGENT_LOG" 2>&1 || test_rc=$?
  fi

  if [[ $lint_rc -ne 0 || $test_rc -ne 0 ]]; then
    return 1
  fi
  return 0
}

create_pr_if_enabled() {
  local pr_url=""
  local pr_status="skipped"

  if [[ "$CREATE_PR" != "true" ]]; then
    echo "PR create skipped (--create-pr not set)" >> "$AGENT_LOG"
    echo "skipped|"
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "PR create failed: gh CLI not found" >> "$AGENT_LOG"
    echo "failed|"
    return 0
  fi

  if ! git -C "$WORKTREE_PATH" rev-list --count "${BASE_BRANCH}..${WORKTREE_BRANCH}" >/dev/null 2>&1; then
    echo "PR create skipped: no commits on worktree branch" >> "$AGENT_LOG"
    echo "skipped|"
    return 0
  fi

  local commit_count
  commit_count="$(git -C "$WORKTREE_PATH" rev-list --count "${BASE_BRANCH}..${WORKTREE_BRANCH}" || echo 0)"
  if [[ "${commit_count}" == "0" ]]; then
    echo "PR create skipped: no new commits to publish" >> "$AGENT_LOG"
    echo "skipped|"
    return 0
  fi

  echo "📤 Pushing branch ${WORKTREE_BRANCH}"
  if ! git -C "$WORKTREE_PATH" push -u origin "$WORKTREE_BRANCH" >> "$AGENT_LOG" 2>&1; then
    echo "PR create failed: branch push failed" >> "$AGENT_LOG"
    echo "failed|"
    return 0
  fi

  local pr_title
  pr_title="feat(factory): ${TASK_DESC}"

  local pr_body
  pr_body=$(cat <<EOF
## Autonomous Factory Run

- Task: ${TASK_DESC}
- Base branch: ${PR_BASE_BRANCH}
- Worktree branch: ${WORKTREE_BRANCH}
- Run ID: ${WORKTREE_NAME}
- Agent log: \
  \
  \
  See artifact in local run output: ${AGENT_LOG}
EOF
)

  echo "🧷 Creating PR against ${PR_BASE_BRANCH}"
  pr_url="$(gh pr create --base "$PR_BASE_BRANCH" --head "$WORKTREE_BRANCH" --title "$pr_title" --body "$pr_body" 2>>"$AGENT_LOG" || true)"

  if [[ -n "$pr_url" ]]; then
    pr_status="created"
    echo "PR created: ${pr_url}" >> "$AGENT_LOG"
  else
    pr_status="failed"
    echo "PR create failed: gh returned no URL" >> "$AGENT_LOG"
  fi

  echo "${pr_status}|${pr_url}"
}

AGENT_EXIT=0
CHECK_EXIT=0
SELF_FIX_ATTEMPTED=0
SELF_FIX_EXIT=0
ESCALATION_REQUIRED="false"
ESCALATION_REASON=""
PR_STATUS="skipped"
PR_URL=""

if ! run_agent "initial"; then
  AGENT_EXIT=$?
fi

if ! run_checks; then
  CHECK_EXIT=$?
fi

# One self-fix cycle on failure (Phase 1 Step 3 requirement)
if [[ $CHECK_EXIT -ne 0 && "$SELF_FIX_ON_FAILURE" == "true" ]]; then
  SELF_FIX_ATTEMPTED=1
  echo "🔁 Initial checks failed; running one self-fix attempt"

  FAILURE_CONTEXT="$(tail -n 120 "$AGENT_LOG" | sed 's/[^[:print:]\t]//g')"
  {
    echo "SELF-FIX START: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Self-fix failure context (tail):"
    echo "$FAILURE_CONTEXT"
  } >> "$AGENT_LOG"

  if ! run_agent "self-fix" "$FAILURE_CONTEXT"; then
    SELF_FIX_EXIT=$?
  fi

  CHECK_EXIT=0
  if ! run_checks; then
    CHECK_EXIT=$?
  fi
fi

CHANGED_FILES="$(git -C "$WORKTREE_PATH" status --short | wc -l | tr -d ' ')"
RESULT="success"
if [[ $AGENT_EXIT -ne 0 || $CHECK_EXIT -ne 0 || $SELF_FIX_EXIT -ne 0 ]]; then
  RESULT="failed"
fi

if [[ "$RESULT" == "failed" ]]; then
  ESCALATION_REQUIRED="true"
  ESCALATION_REASON="agent_or_checks_failed_after_single_self_fix_attempt"
  echo "🚨 Escalation required: ${ESCALATION_REASON}"
  echo "ESCALATION REQUIRED: ${ESCALATION_REASON}" >> "$AGENT_LOG"
fi

if [[ "$RESULT" == "success" ]]; then
  IFS='|' read -r PR_STATUS PR_URL <<< "$(create_pr_if_enabled)"
fi

{
  echo "AGENT END: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Agent exit: $AGENT_EXIT"
  echo "Checks exit: $CHECK_EXIT"
  echo "Self-fix attempted: $SELF_FIX_ATTEMPTED"
  echo "Self-fix exit: $SELF_FIX_EXIT"
  echo "Escalation required: $ESCALATION_REQUIRED"
  echo "Escalation reason: $ESCALATION_REASON"
  echo "PR status: $PR_STATUS"
  echo "PR URL: $PR_URL"
  echo "Changed files: $CHANGED_FILES"
  echo "Result: $RESULT"
} >> "$AGENT_LOG"

cat > "$STATUS_FILE" <<EOF
run_id=${WORKTREE_NAME}
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
base_repo=${BASE_REPO}
base_branch=${BASE_BRANCH}
worktree_branch=${WORKTREE_BRANCH}
worktree_path=${WORKTREE_PATH}
task=${TASK_DESC}
agent=${AGENT}
agent_exit=${AGENT_EXIT}
checks_exit=${CHECK_EXIT}
self_fix_attempted=${SELF_FIX_ATTEMPTED}
self_fix_exit=${SELF_FIX_EXIT}
escalation_required=${ESCALATION_REQUIRED}
escalation_reason=${ESCALATION_REASON}
create_pr=${CREATE_PR}
pr_status=${PR_STATUS}
pr_url=${PR_URL}
changed_files=${CHANGED_FILES}
result=${RESULT}
log=${AGENT_LOG}
EOF

echo "📋 Agent log: ${AGENT_LOG}"
echo "🧾 Status file: ${STATUS_FILE}"
echo "✅ Done: ${RESULT}"

if [[ "$RESULT" == "failed" ]]; then
  exit 1
fi
