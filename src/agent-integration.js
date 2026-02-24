/**
 * Agent Integration — Phase 3 POC
 * Spawns sub-agents to work on tasks inside isolated worktrees
 */

const path = require('path');

class AgentIntegration {
  constructor(factory, agentId = 'eng') {
    this.factory = factory;
    this.agentId = agentId;
    this.activeAgents = new Map(); // taskId → agentSessionKey
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

    // In a real implementation, this would call sessions_spawn
    // For now, we'll simulate it with a placeholder
    const agentSessionKey = `agent:${this.agentId}:task-${task.id}`;
    
    this.activeAgents.set(task.id, agentSessionKey);

    return {
      agentSessionKey,
      taskId: task.id,
      worktreePath: worktree.path,
      spawnedAt: new Date().toISOString()
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
  async waitForAgent(agentSessionKey, timeoutMs = 300000) {
    console.log(`[AgentIntegration] Waiting for agent ${agentSessionKey}...`);

    // In a real implementation, this would poll sessions_history
    // For now, we'll simulate a successful completion
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          agentSessionKey,
          status: 'completed',
          output: 'Agent completed task successfully',
          completedAt: new Date().toISOString()
        });
      }, 5000); // Simulate 5s agent work
    });
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
}

module.exports = AgentIntegration;
