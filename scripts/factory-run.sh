#!/usr/bin/env bash
# Factory Runner - Phase 1/2/3 POC
# Accepts a task description, creates an isolated git worktree,
# runs a coding agent (codex/claude/custom), runs lint/tests,
# and can push/create a PR when successful.

set -euo pipefail

RUN_START_EPOCH="$(date +%s)"

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
WATCH_CI="true"
CI_MAX_FIX_ATTEMPTS=3
RUN_TYPECHECK="auto"        # auto|true|false
RUN_SECURITY_SCAN="false"   # false by default to avoid blocking on advisory DB drift
NPM_AUDIT_LEVEL="high"
METRICS_FILE_RELATIVE="ops/metrics.json"
CLEANUP_WORKTREE="on-success"   # never|on-success|always

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
  --no-watch-ci            Disable CI reaction loop after PR creation
  --ci-max-fix-attempts N  Max CI remediation attempts (default: 3)
  --typecheck <mode>       auto|true|false (default: auto)
  --security-scan          Run npm audit gate (high+ severity by default)
  --npm-audit-level <lvl>  npm audit level: low|moderate|high|critical (default: high)
  --cleanup-worktree <m>   never|on-success|always (default: on-success)
  --keep-worktree          Alias for --cleanup-worktree never
  -h, --help               Show help

Examples:
  ./scripts/factory-run.sh "Add retry for API client"
  ./scripts/factory-run.sh --agent codex "Implement health endpoint"
  ./scripts/factory-run.sh --agent-cmd "codex exec --full-auto 'Refactor task queue'" "Refactor task queue"
  ./scripts/factory-run.sh --create-pr "Add metrics rollup"
  ./scripts/factory-run.sh --create-pr --ci-max-fix-attempts 2 "Fix flaky CI in parser"
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
    --no-watch-ci)
      WATCH_CI="false"
      shift
      ;;
    --ci-max-fix-attempts)
      CI_MAX_FIX_ATTEMPTS="$2"
      shift 2
      ;;
    --typecheck)
      RUN_TYPECHECK="$2"
      shift 2
      ;;
    --security-scan)
      RUN_SECURITY_SCAN="true"
      shift
      ;;
    --npm-audit-level)
      NPM_AUDIT_LEVEL="$2"
      shift 2
      ;;
    --cleanup-worktree)
      CLEANUP_WORKTREE="$2"
      shift 2
      ;;
    --keep-worktree)
      CLEANUP_WORKTREE="never"
      shift
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
AGENT_LOG="${WORKTREE_BASE}/${WORKTREE_NAME}.agent.log"
PR_BASE_BRANCH="${PR_BASE_BRANCH:-$BASE_BRANCH}"

if [[ "$CLEANUP_WORKTREE" != "never" && "$CLEANUP_WORKTREE" != "on-success" && "$CLEANUP_WORKTREE" != "always" ]]; then
  echo "Error: invalid --cleanup-worktree mode '$CLEANUP_WORKTREE' (expected never|on-success|always)" >&2
  exit 1
fi

if [[ "$RUN_TYPECHECK" != "auto" && "$RUN_TYPECHECK" != "true" && "$RUN_TYPECHECK" != "false" ]]; then
  echo "Error: invalid --typecheck mode '$RUN_TYPECHECK' (expected auto|true|false)" >&2
  exit 1
fi

if [[ "$NPM_AUDIT_LEVEL" != "low" && "$NPM_AUDIT_LEVEL" != "moderate" && "$NPM_AUDIT_LEVEL" != "high" && "$NPM_AUDIT_LEVEL" != "critical" ]]; then
  echo "Error: invalid --npm-audit-level '$NPM_AUDIT_LEVEL' (expected low|moderate|high|critical)" >&2
  exit 1
fi

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

  if [[ "$mode" != "initial" ]]; then
    prompt="${prompt}

The previous run failed validation and needs remediation.
Mode: ${mode}
Fix the failing checks (or CI failures described below) and update the existing branch commit(s).

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
  local typecheck_rc=0
  local test_rc=0
  local security_rc=0

  if [[ "$SKIP_TESTS" == "true" ]]; then
    echo "⏭️  Skipping lint/tests (--skip-tests)"
    return 0
  fi

  local has_node_project="false"
  if [[ -f "$WORKTREE_PATH/package.json" ]] && command -v node >/dev/null 2>&1; then
    has_node_project="true"

    if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.lint?0:1)' >/dev/null 2>&1; then
      echo "🧹 Running npm run lint --silent"
      (cd "$WORKTREE_PATH" && npm run lint --silent) >> "$AGENT_LOG" 2>&1 || lint_rc=$?
    fi

    local should_typecheck="false"
    case "$RUN_TYPECHECK" in
      true) should_typecheck="true" ;;
      false) should_typecheck="false" ;;
      auto)
        if node -e 'const p=require("./package.json"); process.exit((p.scripts&&((p.scripts.typecheck)||(p.scripts["type-check"])||(p.scripts.tsc)))?0:1)' >/dev/null 2>&1; then
          should_typecheck="true"
        elif [[ -f "$WORKTREE_PATH/tsconfig.json" ]]; then
          should_typecheck="true"
        fi
        ;;
    esac

    if [[ "$should_typecheck" == "true" ]]; then
      if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.typecheck?0:1)' >/dev/null 2>&1; then
        echo "🔎 Running npm run typecheck --silent"
        (cd "$WORKTREE_PATH" && npm run typecheck --silent) >> "$AGENT_LOG" 2>&1 || typecheck_rc=$?
      elif node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts["type-check"]?0:1)' >/dev/null 2>&1; then
        echo "🔎 Running npm run type-check --silent"
        (cd "$WORKTREE_PATH" && npm run type-check --silent) >> "$AGENT_LOG" 2>&1 || typecheck_rc=$?
      elif node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.tsc?0:1)' >/dev/null 2>&1; then
        echo "🔎 Running npm run tsc --silent"
        (cd "$WORKTREE_PATH" && npm run tsc --silent) >> "$AGENT_LOG" 2>&1 || typecheck_rc=$?
      elif command -v npx >/dev/null 2>&1 && [[ -f "$WORKTREE_PATH/tsconfig.json" ]]; then
        echo "🔎 Running npx tsc --noEmit"
        (cd "$WORKTREE_PATH" && npx --yes tsc --noEmit) >> "$AGENT_LOG" 2>&1 || typecheck_rc=$?
      fi
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

  if [[ "$RUN_SECURITY_SCAN" == "true" && "$has_node_project" == "true" && "$lint_rc" -eq 0 && "$typecheck_rc" -eq 0 && "$test_rc" -eq 0 ]]; then
    echo "🛡️  Running npm audit --audit-level=${NPM_AUDIT_LEVEL}"
    (cd "$WORKTREE_PATH" && npm audit --audit-level="$NPM_AUDIT_LEVEL") >> "$AGENT_LOG" 2>&1 || security_rc=$?
  fi

  if [[ $lint_rc -ne 0 || $typecheck_rc -ne 0 || $test_rc -ne 0 || $security_rc -ne 0 ]]; then
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

ci_checks_bucket() {
  local pr_ref="$1"
  gh pr checks "$pr_ref" --json bucket --jq 'if length==0 then "pending" elif any(.[]; .bucket=="fail") then "fail" elif all(.[]; .bucket=="pass" or .bucket=="skipping") then "pass" else "pending" end' 2>>"$AGENT_LOG" || echo "pending"
}

summarize_failed_checks() {
  local pr_ref="$1"
  gh pr checks "$pr_ref" --json name,bucket,description,link --jq '.[] | select(.bucket=="fail") | "- " + .name + (if .description then " — " + .description else "" end) + (if .link then " (" + .link + ")" else "" end)' 2>>"$AGENT_LOG" | head -n 12
}

run_ci_reaction_loop() {
  local pr_ref="$1"
  local fix_attempt=0

  if [[ "$WATCH_CI" != "true" ]]; then
    echo "CI watch disabled (--no-watch-ci)" >> "$AGENT_LOG"
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "CI watch skipped: gh CLI not found" >> "$AGENT_LOG"
    return 0
  fi

  echo "⏳ Watching CI for ${pr_ref}"
  echo "CI WATCH START: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$AGENT_LOG"

  while true; do
    local bucket
    bucket="$(ci_checks_bucket "$pr_ref")"
    echo "CI bucket: ${bucket}" >> "$AGENT_LOG"

    if [[ "$bucket" == "pass" ]]; then
      echo "✅ CI passed for ${pr_ref}"
      echo "CI WATCH END: pass" >> "$AGENT_LOG"
      return 0
    fi

    if [[ "$bucket" == "pending" || "$bucket" == "cancel" || "$bucket" == "skipping" ]]; then
      sleep 15
      continue
    fi

    if [[ "$bucket" == "fail" ]]; then
      if (( fix_attempt >= CI_MAX_FIX_ATTEMPTS )); then
        echo "CI remediation exhausted (${CI_MAX_FIX_ATTEMPTS} attempts)" >> "$AGENT_LOG"
        ESCALATION_REQUIRED="true"
        ESCALATION_REASON="ci_failed_after_max_reaction_attempts"
        return 1
      fi

      fix_attempt=$((fix_attempt + 1))
      CI_REMEDIATION_ATTEMPTS="$fix_attempt"
      local failure_summary
      failure_summary="$(summarize_failed_checks "$pr_ref")"
      echo "🔁 CI failed; remediation attempt ${fix_attempt}/${CI_MAX_FIX_ATTEMPTS}"
      {
        echo "CI REMEDIATION ATTEMPT: ${fix_attempt}"
        echo "CI failure summary:"
        echo "${failure_summary:-<no details>}"
      } >> "$AGENT_LOG"

      if ! run_agent "ci-fix-${fix_attempt}" "${failure_summary}"; then
        echo "CI remediation agent run failed on attempt ${fix_attempt}" >> "$AGENT_LOG"
      fi

      local dirty
      dirty="$(git -C "$WORKTREE_PATH" status --porcelain | wc -l | tr -d ' ')"
      if [[ "$dirty" != "0" ]]; then
        git -C "$WORKTREE_PATH" add -A >> "$AGENT_LOG" 2>&1 || true
        git -C "$WORKTREE_PATH" commit -m "fix(ci): remediate failing checks (attempt ${fix_attempt})" >> "$AGENT_LOG" 2>&1 || true
      fi

      if ! git -C "$WORKTREE_PATH" push >> "$AGENT_LOG" 2>&1; then
        echo "CI remediation push failed (attempt ${fix_attempt})" >> "$AGENT_LOG"
      fi

      sleep 10
      continue
    fi

    sleep 15
  done
}

cleanup_worktree_if_needed() {
  local result="$1"

  case "$CLEANUP_WORKTREE" in
    never)
      WORKTREE_CLEANUP="skipped"
      return 0
      ;;
    on-success)
      if [[ "$result" != "success" ]]; then
        WORKTREE_CLEANUP="skipped"
        return 0
      fi
      ;;
    always)
      ;;
  esac

  if git -C "$BASE_REPO" worktree remove --force "$WORKTREE_PATH" >> "$AGENT_LOG" 2>&1; then
    WORKTREE_CLEANUP="removed"
  else
    WORKTREE_CLEANUP="failed"
  fi
}

append_metrics() {
  local result="$1"
  local attempts="$2"
  local duration_sec
  duration_sec=$(( $(date +%s) - RUN_START_EPOCH ))

  local metrics_file="${BASE_REPO}/${METRICS_FILE_RELATIVE}"
  mkdir -p "$(dirname "$metrics_file")"

  local ts ci_result ci_last_error
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ci_result="not_run"
  ci_last_error=""

  if [[ "$PR_STATUS" == "created" && "$WATCH_CI" == "true" ]]; then
    if [[ "$result" == "success" ]]; then
      ci_result="pass"
    else
      ci_result="fail"
      ci_last_error="$ESCALATION_REASON"
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    METRICS_FILE="$metrics_file" \
    METRICS_TS="$ts" \
    METRICS_TASK="$TASK_DESC" \
    METRICS_BRANCH="$WORKTREE_BRANCH" \
    METRICS_DURATION="$duration_sec" \
    METRICS_RESULT="$result" \
    METRICS_ATTEMPTS="$attempts" \
    METRICS_CREATE_PR="$CREATE_PR" \
    METRICS_PR_URL="$PR_URL" \
    METRICS_CI_RESULT="$ci_result" \
    METRICS_CI_LAST_ERROR="$ci_last_error" \
    node <<'NODE'
const fs = require('fs');

const file = process.env.METRICS_FILE;
const entry = {
  timestamp: process.env.METRICS_TS,
  task: process.env.METRICS_TASK,
  branch: process.env.METRICS_BRANCH,
  durationSec: Number(process.env.METRICS_DURATION || '0'),
  result: process.env.METRICS_RESULT,
  passFail: process.env.METRICS_RESULT,
  attempts: Number(process.env.METRICS_ATTEMPTS || '1'),
  createPr: process.env.METRICS_CREATE_PR === 'true',
  prUrl: process.env.METRICS_PR_URL || '',
  ciResult: process.env.METRICS_CI_RESULT || 'not_run',
  ciLastError: process.env.METRICS_CI_LAST_ERROR || ''
};

let data = [];
if (fs.existsSync(file)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) data = parsed;
  } catch {
    data = [];
  }
}

data.push(entry);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
NODE
  else
    echo "metrics_write_skipped: node_not_found" >> "$AGENT_LOG"
  fi
}

AGENT_EXIT=0
CHECK_EXIT=0
SELF_FIX_ATTEMPTED=0
SELF_FIX_EXIT=0
ESCALATION_REQUIRED="false"
ESCALATION_REASON=""
PR_STATUS="skipped"
PR_URL=""
CI_REMEDIATION_ATTEMPTS=0
WORKTREE_CLEANUP="skipped"

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

TOTAL_ATTEMPTS=1
if [[ "$SELF_FIX_ATTEMPTED" -eq 1 ]]; then
  TOTAL_ATTEMPTS=$((TOTAL_ATTEMPTS + 1))
fi
if [[ "$CI_REMEDIATION_ATTEMPTS" -gt 0 ]]; then
  TOTAL_ATTEMPTS=$((TOTAL_ATTEMPTS + CI_REMEDIATION_ATTEMPTS))
fi

if [[ "$RESULT" == "failed" ]]; then
  ESCALATION_REQUIRED="true"
  ESCALATION_REASON="agent_or_checks_failed_after_single_self_fix_attempt"
  echo "🚨 Escalation required: ${ESCALATION_REASON}"
  echo "ESCALATION REQUIRED: ${ESCALATION_REASON}" >> "$AGENT_LOG"
fi

if [[ "$RESULT" == "success" ]]; then
  IFS='|' read -r PR_STATUS PR_URL <<< "$(create_pr_if_enabled)"

  if [[ "$PR_STATUS" == "created" && -n "$PR_URL" ]]; then
    if ! run_ci_reaction_loop "$PR_URL"; then
      RESULT="failed"
    fi
  fi
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

append_metrics "$RESULT" "$TOTAL_ATTEMPTS"

cleanup_worktree_if_needed "$RESULT"

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
attempts=${TOTAL_ATTEMPTS}
result=${RESULT}
cleanup_mode=${CLEANUP_WORKTREE}
cleanup_status=${WORKTREE_CLEANUP}
log=${AGENT_LOG}
EOF

echo "📋 Agent log: ${AGENT_LOG}"
echo "🧾 Status file: ${STATUS_FILE}"
echo "📈 Metrics file: ${BASE_REPO}/${METRICS_FILE_RELATIVE}"
echo "🧹 Worktree cleanup: ${WORKTREE_CLEANUP} (${CLEANUP_WORKTREE})"
echo "✅ Done: ${RESULT}"

if [[ "$RESULT" == "failed" ]]; then
  exit 1
fi
