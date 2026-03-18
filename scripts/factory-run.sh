#!/bin/bash
# Factory Runner - Phase 1: Task Intake
# Accepts a task description, creates a git worktree, and runs a coding agent

set -e

# Configuration
BASE_REPO="/Users/redinside/Development/Codebase/projects/RedTeam/github/redteam-coding-factory"
WORKTREE_BASE="${BASE_REPO}/worktrees"
AGENT_MODEL="9router/free-unlimited"  # Default model

# Help text
usage() {
    echo "Usage: $0 <task_description>"
    echo "  Creates an isolated worktree and runs the coding agent on the task."
    exit 1
}

# Validate input
if [ $# -eq 0 ]; then
    echo "Error: No task description provided."
    usage
fi

TASK_DESC="$*"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
WORKTREE_NAME="task-${TIMESTAMP}"
WORKTREE_PATH="${WORKTREE_BASE}/${WORKTREE_NAME}"

echo "🚀 Starting task: ${TASK_DESC}"
echo "📁 Creating worktree: ${WORKTREE_NAME}"

# Ensure worktree base exists
mkdir -p "${WORKTREE_BASE}"

# Create worktree from main branch
git -C "${BASE_REPO}" worktree add -b "worktree-${WORKTREE_NAME}" "${WORKTREE_PATH}" main

# Copy initial files into worktree (excluding .git)
rsync -a --exclude='.git' "${BASE_REPO}/" "${WORKTREE_PATH}/"

echo "✅ Worktree created at: ${WORKTREE_PATH}"
echo "🤖 Running coding agent with model: ${AGENT_MODEL}"

# Run the coding agent via OpenClaw (to be implemented in step 2)
# For now, we'll simulate the agent by echoing a simple task completion
AGENT_LOG="${WORKTREE_PATH}/agent-run.log"
echo "AGENT START: $(date)" > "${AGENT_LOG}"
echo "Task: ${TASK_DESC}" >> "${AGENT_LOG}"
echo "Model: ${AGENT_MODEL}" >> "${AGENT_LOG}"

# Placeholder for actual agent integration (Step 2)
echo "This is a placeholder. Step 2 will wire OpenClaw exec tool to run an AI coding agent." >> "${AGENT_LOG}"
echo "AGENT END: $(date)" >> "${AGENT_LOG}"

echo "📋 Agent log written to: ${AGENT_LOG}"
echo "✅ Task intake complete. Worktree is ready for agent execution."
echo "Next steps: implement agent integration in scripts/factory-run.sh"

exit 0
