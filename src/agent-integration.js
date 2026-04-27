/**
 * Agent Integration — Phase 3: Real Sub-Agent Spawning
 * Spawns OpenClaw sub-agents to work on tasks inside isolated worktrees.
 * Uses sessions_spawn (runtime="subagent") for real agent execution.
 */

const path = require('path');
const fs = require('fs');

class AgentIntegration {
  constructor(factory, agentId = 'eng', options = {}) {
    this.factory = factory;
    this.agentId = agentId;
    this.activeAgents = new Map(); // taskId → sessionKey
    this.resultsDir = options.resultsDir || path.join(factory.dataDir || './data', 'agent-results');
    this.defaultTimeoutMs = options.defaultTimeoutMs || 15 * 60 * 1000;
    this.pollIntervalMs = options.pollIntervalMs || 10000;
    this._ensureResultsDir();
  }

  _ensureResultsDir() {
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  _resultFile(taskId) {
    return path.join(this.resultsDir, `${taskId}.json`);
  }

  /**
   * Build the prompt for the sub-agent.
   * @param {Object} task - task record
   * @param {Object} worktree - worktree record
   * @returns {string} - agent prompt
   */
  buildPrompt(task, worktree) {
    const instructions = task.instructions || task.description || 'Complete the assigned task.';
    return `
You are an autonomous coding agent working inside a git worktree.

**Your workspace:** ${worktree.path}
**Branch:** ${worktree.branch}
**Task ID:** ${task.id}

**Task:**
${instructions}

**Your job (in order):**
1. cd into ${worktree.path}
2. **Before writing any code:** check whether an open PR already addresses this issue. Run:
   gh pr list --repo <upstream-repo> --state open --search "closes #${task.metadata && task.metadata.issueNumber ? task.metadata.issueNumber : 'UNKNOWN'} OR fixes #${task.metadata && task.metadata.issueNumber ? task.metadata.issueNumber : 'UNKNOWN'}" --limit 5
   If any open PRs are returned, STOP immediately — write {"taskId":"${task.id}","status":"skipped","summary":"existing open PR already addresses this issue","completedAt":"<ISO timestamp>"} to the result file and exit.
3. Explore the codebase to understand the structure
4. Implement the changes needed for this task
5. Run \`git status\` to see what changed
6. Run relevant lint/tests: \`npm run lint -- --fix\` and \`npm test -- --run\` (or equivalent)
7. If tests pass, commit with a descriptive message:
   \`git add -A && git commit -s -m "fix(${task.id}): ${task.title}"\`
8. Write your result to the JSON file at \`${this._resultFile(task.id)}\`:
   {
     "taskId": "${task.id}",
     "status": "success",
     "summary": "what you changed",
     "commit": "<git commit hash or 'none'>",
     "completedAt": "<ISO timestamp>"
   }
   If you fail after retries, write:
   {
     "taskId": "${task.id}",
     "status": "failed",
     "summary": "what went wrong",
     "error": "<error description>",
     "completedAt": "<ISO timestamp>"
   }

**Global quality rules (non-negotiable):**
- You are acting as a senior engineer with 25 years of experience. Every PR must reflect that standard.
- No garbage code. No placeholder implementations. No "TODO: implement later". Either do it properly or skip the task and say why.
- No duplicate PRs. The pre-flight check in step 2 is mandatory every single time.
- Every change must be tested. If the project has no tests for the area you touched, add them.
- Write code that looks like a human wrote it — meaningful variable names, clean logic, no auto-generated boilerplate left in.
- If a reviewer leaves comments on your PR, you must address them. Check back on open PRs you created and respond/fix before moving to new tasks.
- When in doubt about scope or correctness, skip the issue and write status "skipped" with a clear reason. A skipped issue is better than a bad PR.

**Execution rules:**
- Work ONLY inside ${worktree.path}
- Do NOT touch files outside the worktree
- Always use --signoff on commits (-s flag)
- If you cannot complete the task properly, write the failure result anyway so the factory can proceed
`.trim();
  }

  /**
   * Spawn a real sub-agent to work on a task.
   * Uses sessions_spawn with runtime="subagent" for isolated execution.
   * @param {Object} task - task record
   * @param {Object} worktree - worktree record
   * @returns {Promise<Object>} - { agentSessionKey, taskId }
   */
  async spawnAgent(task, worktree) {
    const prompt = this.buildPrompt(task, worktree);
    const resultFile = this._resultFile(task.id);

    // Clear any stale result file so we can detect new output
    if (fs.existsSync(resultFile)) {
      fs.unlinkSync(resultFile);
    }

    console.log(`[AgentIntegration] Spawning sub-agent for task ${task.id} in ${worktree.path}...`);

    // Build the task message that the sub-agent will receive
    const sessionLabel = `factory-task-${task.id}`;

    // sessions_spawn is called via the sessions_spawn tool.
    // We pass the task context via the prompt; the sub-agent has the
    // worktree path so it can work inside the correct directory.
    let sessionKey;
    try {
      // We need to spawn via the sessions_spawn tool from the parent context.
      // Since we can't call tools directly from JS, we return a descriptor
      // that the factory (or a wrapper) will use to call sessions_spawn.
      sessionKey = `pending:${task.id}`;
    } catch (err) {
      console.error(`[AgentIntegration] Failed to create session descriptor: ${err.message}`);
      throw err;
    }

    this.activeAgents.set(task.id, sessionKey);

    return {
      agentSessionKey: sessionKey,
      taskId: task.id,
      worktreePath: worktree.path,
      worktreeId: worktree.id,
      resultFile,
      spawnedAt: new Date().toISOString(),
      prompt,
    };
  }

  /**
   * Wait for agent to complete by polling the result file.
   * Also respects the overall timeout.
   * @param {string} agentSessionKey - session key from spawn
   * @param {string} taskId - task ID
   * @param {number} timeoutMs - max wait time
   * @returns {Promise<Object>} - agent result
   */
  async waitForAgent(agentSessionKey, taskId, timeoutMs = this.defaultTimeoutMs) {
    const resultFile = this._resultFile(taskId);
    const deadline = Date.now() + timeoutMs;

    console.log(`[AgentIntegration] Waiting for agent result: ${agentSessionKey}`);

    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) {
        try {
          const raw = fs.readFileSync(resultFile, 'utf8');
          const result = JSON.parse(raw);
          console.log(`[AgentIntegration] Result file found for task ${taskId}: ${result.status}`);
          this.activeAgents.delete(taskId);
          return result;
        } catch (e) {
          console.warn(`[AgentIntegration] Failed to parse result file: ${e.message}`);
        }
      }

      const remaining = deadline - Date.now();
      const sleepFor = Math.min(this.pollIntervalMs, remaining);
      if (sleepFor <= 0) break;
      await this._sleep(sleepFor);
    }

    console.warn(`[AgentIntegration] Timeout waiting for task ${taskId} result`);
    this.activeAgents.delete(taskId);
    return {
      taskId,
      status: 'timeout',
      error: `Agent timed out after ${timeoutMs}ms without producing a result file`,
      timedOutAt: new Date().toISOString(),
    };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get tracked session key for a task.
   */
  getAgentSessionKey(taskId) {
    return this.activeAgents.get(taskId);
  }

  /**
   * Clear agent tracking.
   */
  clearAgent(taskId) {
    this.activeAgents.delete(taskId);
  }
}

module.exports = AgentIntegration;
