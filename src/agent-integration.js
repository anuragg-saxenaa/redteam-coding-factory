/**
 * Agent Integration — Phase 3: A2A Protocol + AgentRunner fallback
 *
 * Production-hardened:
 *   #3  Returns status='skipped' (not 'completed') when no agent binary
 *       or A2A transport is available.  Callers can treat this as a
 *       hard failure instead of silently counting it as success.
 *   #8  clearAgent() is called in all exit paths of waitForAgent so the
 *       in-memory agent map never leaks entries.
 *   #14 Per-task log file: agent stdout is captured to agent-logs/<id>.log
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const AgentRunner = require('./agent-runner');

class AgentIntegration {
  /**
   * @param {Object} factory  - CodingFactory instance (used for config access)
   */
  constructor(factory) {
    this.factory      = factory;
    this._agents      = new Map();   // taskId → agentEntry
    this._agentRunner = null;
    this._a2aTransport= null;

    // ── FIX #14: log directory ───────────────────────────────────────────
    this._logDir = process.env.AGENT_LOG_DIR || path.join(process.cwd(), 'agent-logs');
    try { fs.mkdirSync(this._logDir, { recursive: true }); } catch (_) {}
  }

  // ── Agent registration ────────────────────────────────────────────────

  setAgent(agentConfig) {
    if (agentConfig.type === 'runner' || agentConfig.bin) {
      this._agentRunner = new AgentRunner({
        agentBin : agentConfig.bin   || process.env.AGENT_BIN || 'claude',
        agentArgs: agentConfig.args  || [],
        timeoutMs: agentConfig.timeout,
        logDir   : this._logDir,
      });
    }
    if (agentConfig.type === 'a2a' || agentConfig.transport) {
      this._a2aTransport = agentConfig.transport;
    }
  }

  clearAgent(taskId) {
    this._agents.delete(taskId);
  }

  // ── Spawn ─────────────────────────────────────────────────────────────

  async spawnAgent(task, worktree) {
    const agentSessionKey = `agent-${task.id}-${Date.now()}`;
    const agentEntry = {
      taskId        : task.id,
      worktreePath  : worktree.path,
      status        : 'pending',
      startedAt     : new Date().toISOString(),
      usedA2AOnly   : false,
    };
    this._agents.set(task.id, agentEntry);

    // Try A2A transport first
    if (this._a2aTransport) {
      try {
        await this._dispatchA2A(task, worktree, agentEntry);
        return { agentSessionKey, taskId: task.id };
      } catch (err) {
        console.warn(`[AgentIntegration] A2A dispatch failed: ${err.message} — falling back to runner`);
      }
    }

    // Fallback: AgentRunner (claude / codex CLI)
    if (this._agentRunner) {
      agentEntry.useRunner = true;
      this._runAgentAsync(task, worktree, agentEntry);
      return { agentSessionKey, taskId: task.id };
    }

    // ── FIX #3: no agent available — mark as skipped, not completed ───────
    agentEntry.status     = 'skipped';
    agentEntry.usedA2AOnly= true;
    agentEntry.output     = 'No agent binary available and A2A transport not configured. Task was NOT executed.';
    console.warn(`[AgentIntegration] No agent available for task ${task.id} — marking as skipped`);
    return { agentSessionKey, taskId: task.id };
  }

  // ── Wait for completion ───────────────────────────────────────────────

  /**
   * Poll until the agent entry reaches a terminal state.
   * FIX #8: clearAgent() is called before every return path to prevent leaks.
   */
  async waitForAgent(agentSessionKey, timeoutMs = 15 * 60 * 1000) {
    const taskId   = agentSessionKey.split('-')[1];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const entry = this._agents.get(taskId);

      if (!entry) {
        // Already cleared externally
        return { status: 'error', error: 'Agent entry not found', completedAt: new Date().toISOString() };
      }

      if (entry.status === 'skipped') {
        // ── FIX #3: propagate skipped upward — caller treats as failure ────
        this.clearAgent(taskId); // FIX #8
        return {
          status     : 'skipped',
          output     : entry.output || 'Task skipped — no agent available',
          completedAt: new Date().toISOString(),
        };
      }

      if (entry.status === 'completed') {
        this.clearAgent(taskId); // FIX #8
        return {
          status     : 'completed',
          output     : entry.output || '',
          exitCode   : entry.exitCode,
          completedAt: new Date().toISOString(),
        };
      }

      if (entry.status === 'error') {
        this.clearAgent(taskId); // FIX #8
        return {
          status     : 'error',
          error      : entry.error || 'Unknown agent error',
          completedAt: new Date().toISOString(),
        };
      }

      // Still running — wait 2 s and poll again
      await new Promise(r => setTimeout(r, 2_000));
    }

    // Timeout
    this.clearAgent(taskId); // FIX #8
    return {
      status     : 'error',
      error      : `Agent timed out after ${timeoutMs}ms`,
      completedAt: new Date().toISOString(),
    };
  }

  // ── Internal: run agent via AgentRunner ───────────────────────────────

  async _runAgentAsync(task, worktree, agentEntry) {
    // ── FIX #14: wire up live log stream ──────────────────────────────────
    const logFile   = path.join(this._logDir, `${task.id}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const onOutput = (chunk) => {
      logStream.write(chunk);
    };

    // Temporarily override runner's onOutput
    const savedOnOutput       = this._agentRunner.onOutput;
    this._agentRunner.onOutput= onOutput;

    try {
      const result = await this._agentRunner.run(task, worktree.path);
      agentEntry.status  = result.exitCode === 0 ? 'completed' : 'error';
      agentEntry.output  = result.output;
      agentEntry.exitCode= result.exitCode;
      if (result.exitCode !== 0) agentEntry.error = result.error;
    } catch (err) {
      agentEntry.status = 'error';
      agentEntry.error  = err.message;
    } finally {
      this._agentRunner.onOutput = savedOnOutput;
      logStream.end();
    }
  }

  // ── Internal: A2A dispatch ────────────────────────────────────────────

  async _dispatchA2A(task, worktree, agentEntry) {
    const transport = this._a2aTransport;
    const payload   = {
      taskId      : task.id,
      title       : task.title,
      description : task.description,
      repo        : task.repo,
      branch      : task.branch || 'main',
      worktreePath: worktree.path,
    };

    const response = await transport.send(payload);

    if (response?.sessionId) {
      agentEntry.sessionId = response.sessionId;
    }

    // Mark as pending; the transport is expected to call back via setAgentResult
    agentEntry.status = 'pending';
  }

  /**
   * Called by the A2A transport when a result arrives.
   */
  setAgentResult(taskId, result) {
    const entry = this._agents.get(taskId);
    if (!entry) return;
    entry.status  = result.success ? 'completed' : 'error';
    entry.output  = result.output  || '';
    entry.error   = result.error   || null;
    entry.exitCode= result.exitCode;
  }
}

// ESM default export — enables: import Factory from './agent-integration.js'
export default AgentIntegration;
export { AgentIntegration };