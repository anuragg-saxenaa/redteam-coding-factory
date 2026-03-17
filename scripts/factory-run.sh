#!/bin/bash
# factory-run.sh - Task intake script for autonomous coding factory
# Accepts a task description, creates a git worktree, runs a coding agent on it

set -euo pipefail

REPO_ROOT="/Users/redinside/Development/Codebase/projects/RedTeam/github/redteam-coding-factory"
WORKTREE_BASE="$REPO_ROOT/worktrees"
TASK_DESCRIPTION="${1:-}"
AGENT_TYPE="${2:-codex}"  # Default to codex, can be claude or codex

if [[ -z "$TASK_DESCRIPTION" ]]; then
  echo "Usage: $0 '<task description>' [agent-type]"
  echo "Agent types: codex, claude"
  exit 1
fi

# Create a safe directory name from task description
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SAFE_DESC=$(echo "$TASK_DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-' | cut -c1-50)
WORKTREE_NAME="task-$TIMESTAMP-$SAFE_DESC"
WORKTREE_PATH="$WORKTREE_BASE/$WORKTREE_NAME"

echo "🚀 Starting autonomous coding factory"
echo "📝 Task: $TASK_DESCRIPTION"
echo "🤖 Agent: $AGENT_TYPE"
echo "📁 Worktree: $WORKTREE_PATH"

# Ensure worktree base directory exists
mkdir -p "$WORKTREE_BASE"

# Create git worktree
if git -C "$REPO_ROOT" rev-parse --git-dir > /dev/null 2>&1; then
  echo "🔧 Creating git worktree..."
  git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" main
else
  echo "❌ Error: Not a git repository at $REPO_ROOT"
  exit 1
fi

# Change to worktree directory
cd "$WORKTREE_PATH"

# Configure git for this worktree (important for CI commits)
git config user.name "Autonomous Coding Factory"
git config user.email "factory@redteam.local"

# Create task file
echo "$TASK_DESCRIPTION" > TASK.md
echo "Task created at $(date)" >> TASK.md

# Run the coding agent
echo "⚡ Running $AGENT_TYPE agent on task..."
case "$AGENT_TYPE" in
  codex)
    # Simple demo - in reality this would invoke the codex CLI
    echo "# Autonomous Task Implementation" > solution.txt
    echo "Task: $TASK_DESCRIPTION" >> solution.txt
    echo "" >> solution.txt
    echo "This is a placeholder implementation." >> solution.txt
    echo "In a full implementation, this would:" >> solution.txt
    echo "1. Analyze the task requirements" >> solution.txt
    echo "2. Write appropriate code" >> solution.txt
    echo "3. Run tests and iterate" >> solution.txt
    echo "4. Prepare a PR" >> solution.txt
    ;;
  claude)
    # Placeholder for Claude Code integration
    echo "# Claude Code Task Implementation" > solution.txt
    echo "Task: $TASK_DESCRIPTION" >> solution.txt
    echo "" >> solution.txt
    echo "This is a placeholder implementation." >> solution.txt
    echo "In a full implementation, Claude Code would:" >> solution.txt
    echo "1. Analyze the task requirements" >> solution.txt
    echo "2. Write appropriate code" >> solution.txt
    echo "3. Run tests and iterate" >> solution.txt
    echo "4. Prepare a PR" >> solution.txt
    ;;
  *)
    echo "❌ Unknown agent type: $AGENT_TYPE"
    exit 1
    ;;
esac

# Run tests if they exist (placeholder)
if [[ -f "package.json" && -x "$(command -v npm)" ]]; then
  echo "🧪 Running npm test..."
  npm test || echo "⚠️ Tests failed or not configured"
elif [[ -f "requirements.txt" && -x "$(command -v pytest)" ]]; then
  echo "🧪 Running pytest..."
  pytest || echo "⚠️ Tests failed or not configured"
else
  echo "📝 No test suite detected, skipping test execution"
fi

# Commit results
echo "💾 Committing results..."
git add -A
git commit -m "feat: implement task - $TASK_DESCRIPTION" || echo "⚠️ Nothing to commit"

echo "✅ Task processing complete in worktree: $WORKTREE_PATH"
echo "📋 Next steps would be:"
echo "   1. Create PR with changes"
echo "   2. Monitor CI status"
echo "   3. Implement self-healing loop on failures"
echo "   4. Merge when approved and green"

# Output worktree path for potential use by other scripts
echo "$WORKTREE_PATH"