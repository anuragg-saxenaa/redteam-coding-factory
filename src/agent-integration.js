/**
 * Agent Integration — Phase 3 POC
 * Spawns sub-agents to work on tasks inside isolated worktrees
 */

const A2AClient = require('./a2a-client');
const AgentRunner = require('./agent-runner');

class AgentIntegration {
  constructor(factory, agentId = 'eng', options = {}) {
    this.factory = factory;
    this.agentId = agentId;
    this.activeAgents = new Map(); // taskId -> { agentSessionKey, runner, resultPromise }
    this.defaultTimeoutMs = options.defaultTimeoutMs || 5 * 60 * 1000;

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
   * Configure which agent CLI to use (called by factory before spawnAgent).
   * @param {string} agentName - 'codex' | 'claude' | 'custom'
   * @param {Object} [customOptions] - passed to AgentRunner for 'custom' preset
   */
  setAgent(agentName, customOptions = {}) {
    this._agentName = agentName;
    this._agentOptions = customOptions;
  }

  /**
   * Spawn a sub-agent to work on a task
   * @param {Object} task - task record
   * @param {Object} worktree - worktree record
   * @returns {Promise<Object>} - { agentSessionKey, taskId }
   */
  async spawnAgent(task, worktree) {
    const prompt = this.buildPrompt(task, worktree);
    const agentName = this._agentName || this.agentId || 'codex';

    console.log(`[AgentIntegration] Spawning agent "${agentName}" for task ${task.id} in ${worktree.path}`);

    // Attempt A2A dispatch first. On transport absence/failure, fall back to AgentRunner.
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

    const fallbackSessionKey = `agent:${agentName}:task-${task.id}`;
    const agentSessionKey =
      dispatch?.response?.sessionKey ||
      dispatch?.response?.agentSessionKey ||
      fallbackSessionKey;

    // Spin up AgentRunner and start it asynchronously
    let runner = null;
    let runPromise = null;
    try {
      runner = new AgentRunner({
        agent: agentName,
        timeoutMs: this.defaultTimeoutMs,
        ...this._agentOptions,
      });

      if (!runner.isAvailable()) {
        console.warn(`[AgentIntegration] Agent "${agentName}" binary not found on PATH — A2A-only mode`);
      } else {
        runPromise = runner.run(task, worktree.path);
      }
    } catch (err) {
      console.error(`[AgentIntegration] Failed to create AgentRunner: ${err.message}`);
    }

    this.activeAgents.set(task.id, {
      agentSessionKey,
      runner,
      resultPromise: runPromise,
      spawnedAt: new Date().toISOString(),
    });

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
   * @param {number} timeoutMs - max wait time (overrides defaultTimeoutMs)
   * @returns {Promise<Object>} - agent result
   */
  async waitForAgent(agentSessionKey, timeoutMs = this.defaultTimeoutMs) {
    // Find the active agent by session key
    let agentEntry = null;
    for (const entry of this.activeAgents.values()) {
      if (entry.agentSessionKey === agentSessionKey) {
        agentEntry = entry;
        break;
      }
    }

    if (!agentEntry || !agentEntry.resultPromise) {
      // A2A-only mode: nothing to wait on, return placeholder
      console.warn(`[AgentIntegration] No AgentRunner result for ${agentSessionKey} — A2A-only mode`);
      return {
        agentSessionKey,
        status: 'completed',
        output: 'A2A dispatch completed (no local agent runner)',
        completedAt: new Date().toISOString(),
      };
    }

    console.log(`[AgentIntegration] Waiting for agent ${agentSessionKey}...`);

    try {
      const result = await Promise.race([
        agentEntry.resultPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Agent timeout (${timeoutMs}ms)`)), timeoutMs)
        ),
      ]);

      const status = result.success ? 'completed' : 'failed';
      console.log(`[AgentIntegration] Agent ${agentSessionKey} finished: ${status} (exit=${result.exitCode})`);

      return {
        agentSessionKey,
        status,
        exitCode: result.exitCode,
        killed: result.killed,
        output: result.stdout,
        errors: result.stderr,
        durationMs: result.durationMs,
        completedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error(`[AgentIntegration] Agent ${agentSessionKey} error: ${err.message}`);
      return {
        agentSessionKey,
        status: 'error',
        error: err.message,
        timedOutAt: err.message.includes('timeout') ? new Date().toISOString() : undefined,
        completedAt: new Date().toISOString(),
      };
    }
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
