/**
 * Agent Integration — Phase 3 POC
 * Spawns sub-agents to work on tasks inside isolated worktrees
 */

const A2AClient = require('./a2a-client');

class AgentIntegration {
  constructor(factory, agentId = 'eng', options = {}) {
    this.factory = factory;
    this.agentId = agentId;
    this.activeAgents = new Map(); // taskId -> agentSessionKey
    this.defaultTimeoutMs = options.defaultTimeoutMs || 5 * 60 * 1000;
    this.simulatedWorkMs = options.simulatedWorkMs || 5000;

    this._transport = options.transport || this._defaultTransport.bind(this);
    this.a2aClient = new A2AClient({
      transport: this._transport,
      defaultTimeoutSeconds: options.a2aTimeoutSeconds || 45,
      maxAttempts: options.a2aMaxAttempts || 3,
      baseBackoffMs: options.a2aBackoffMs || 200,
      maxBackoffMs: options.a2aMaxBackoffMs || 2000,
      jitterMs: options.a2aJitterMs || 25,
      enableFallback: options.a2aEnableFallback ?? true,
      fallbackMethod: options.a2aFallbackMethod || 'sessions_spawn',
    });
  }

  /**
   * Spawn a sub-agent to work on a task
   * @param {Object} task - task record
   * @param {Object} worktree - worktree record
   * @returns {Promise<Object>} - { agentSessionKey, taskId }
   */
  async spawnAgent(task, worktree) {
    const prompt = this.buildPrompt(task, worktree);

    console.log(`[AgentIntegration] Spawning agent for task ${task.id}...`);

    // Attempt resilient A2A dispatch first. On transport absence/failure,
    // continue with local placeholder session key so the POC stays runnable.
    let dispatch = null;
    try {
      dispatch = await this.a2aClient.send({
        agentId: this.agentId,
        message: prompt,
        timeoutSeconds: Math.max(1, Math.ceil(this.defaultTimeoutMs / 1000)),
      });
    } catch (error) {
      console.warn(`[AgentIntegration] A2A dispatch failed: ${error.message}`);
    }

    const fallbackSessionKey = `agent:${this.agentId}:task-${task.id}`;
    const agentSessionKey =
      dispatch?.response?.sessionKey ||
      dispatch?.response?.agentSessionKey ||
      fallbackSessionKey;

    this.activeAgents.set(task.id, agentSessionKey);

    return {
      agentSessionKey,
      taskId: task.id,
      worktreePath: worktree.path,
      spawnedAt: new Date().toISOString(),
      dispatch: dispatch
        ? {
            method: dispatch.method,
            attempts: dispatch.attempts,
            usedFallback: dispatch.usedFallback,
          }
        : {
            method: 'local-fallback',
            attempts: 0,
            usedFallback: true,
          },
    };
  }

  /**
   * Build the prompt for the agent
   * @param {Object} task - task record
   * @param {Object} worktree - worktree record
   * @returns {string} - agent prompt
   */
  buildPrompt(task, worktree) {
    return `
You are an autonomous coding agent. Your task:

**Task ID:** ${task.id}
**Title:** ${task.title}
**Description:** ${task.description}

**Worktree Path:** ${worktree.path}
**Branch:** ${worktree.branch}

**Your job:**
1. Navigate to the worktree path
2. Understand the codebase and the task requirements
3. Make the necessary code changes
4. Run linting and tests to ensure quality
5. Commit your changes with a clear message
6. Report back with a summary of what you did

**Important:**
- Work ONLY inside the worktree path (${worktree.path})
- Do NOT modify files outside the worktree
- Run tests before committing
- If you encounter errors, fix them and retry
- Report your final status (success/failure) with details

Begin now.
    `.trim();
  }

  /**
   * Wait for agent to complete
   * @param {string} agentSessionKey - session key from spawn
   * @param {number} timeoutMs - max wait time
   * @returns {Promise<Object>} - agent result
   */
  async waitForAgent(agentSessionKey, timeoutMs = this.defaultTimeoutMs) {
    console.log(`[AgentIntegration] Waiting for agent ${agentSessionKey}...`);

    // In a real implementation, this would poll sessions_history
    // For now, we'll simulate completion while still honoring the timeout.
    return new Promise((resolve) => {
      let settled = false;

      const completeTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        resolve({
          agentSessionKey,
          status: 'completed',
          output: 'Agent completed task successfully',
          completedAt: new Date().toISOString()
        });
      }, this.simulatedWorkMs);

      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(completeTimer);
        resolve({
          agentSessionKey,
          status: 'timeout',
          error: `Agent wait exceeded timeout (${timeoutMs}ms)`,
          timedOutAt: new Date().toISOString()
        });
      }, timeoutMs);
    });
  }

  /**
   * Get A2A dispatch metrics for timeout-rate checks.
   */
  getA2AStats() {
    return this.a2aClient.getStats();
  }

  /**
   * Get agent result
   */
  getAgentResult(taskId) {
    return this.activeAgents.get(taskId);
  }

  /**
   * Clear agent tracking
   */
  clearAgent(taskId) {
    this.activeAgents.delete(taskId);
  }

  async _defaultTransport() {
    throw new Error('A2A transport not configured in this runtime');
  }
}

module.exports = AgentIntegration;
