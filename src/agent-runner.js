/**
 * Agent Runner — Phase 2: Real Coding Agent Execution
 *
 * Production-hardened:
 *   #2  Kills entire process GROUP on timeout (prevents orphan sub-processes)
 *   #14 Per-task log streaming: agent stdout is written to agent-logs/<taskId>.log
 */

'use strict';

const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

class AgentRunner {
  /**
   * @param {Object} config
   * @param {string}   config.agentBin        - path/name of the agent binary (e.g. 'claude')
   * @param {string[]} [config.agentArgs]     - extra CLI flags to pass
   * @param {number}   [config.timeoutMs]     - per-task timeout (default 10 min)
   * @param {string}   [config.logDir]        - directory for per-task log files
   * @param {Function} [config.onOutput]      - (chunk:string) => void  live output callback
   * @param {Function} [config.onError]       - (chunk:string) => void  stderr callback
   */
  constructor(config = {}) {
    this.agentBin   = config.agentBin  || process.env.AGENT_BIN  || 'claude';
    this.agentArgs  = config.agentArgs || [];
    this.timeoutMs  = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.onOutput   = config.onOutput  || null;
    this.onError    = config.onError   || null;

    // ── FIX #14: per-task log directory ───────────────────────────────────
    this._logDir = config.logDir || process.env.AGENT_LOG_DIR || path.join(process.cwd(), 'agent-logs');
    try { fs.mkdirSync(this._logDir, { recursive: true }); } catch (_) {}
  }

  /**
   * Execute an agent against the given worktree path.
   *
   * @param {Object} task
   * @param {string} worktreePath  - absolute path to the isolated worktree
   * @returns {Promise<{exitCode:number, output:string, error:string}>}
   */
  async run(task, worktreePath) {
    const prompt = this._buildPrompt(task);
    const args   = [...this.agentArgs, '--print', prompt];
    const bin    = this.agentBin;
    const cwd    = worktreePath;
    const env    = { ...process.env };

    // ── FIX #14: open a per-task log file ─────────────────────────────────
    const logFile   = path.join(this._logDir, `${task.id}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const ts        = new Date().toISOString();
    logStream.write(`\n=== Task ${task.id} started at ${ts} ===\n`);
    logStream.write(`Prompt: ${prompt.slice(0, 200)}\n\n`);

    return new Promise((resolve) => {
      let output = '';
      let errOut = '';
      let killed = false;

      // ── FIX #2: spawn with detached:true so we get a process group ───────
      const child = spawn(bin, args, {
        cwd,
        env,
        stdio : ['ignore', 'pipe', 'pipe'],
        detached: true,   // gives child its own process group
      });
      child.unref(); // don't let child keep event loop alive

      // ── FIX #2: helper to kill the entire process group ──────────────────
      const killGroup = (sig) => {
        try {
          process.kill(-child.pid, sig); // negative PID = kill process group
        } catch (e) {
          try { child.kill(sig); } catch (_) {} // fallback to direct kill
        }
      };

      // ── FIX #2: timeout handler ───────────────────────────────────────────
      const timer = setTimeout(() => {
        killed = true;
        console.warn(`[AgentRunner] Task ${task.id} timed out after ${this.timeoutMs}ms — killing process group`);
        logStream.write(`\n[TIMEOUT] Killed at ${new Date().toISOString()}\n`);
        killGroup('SIGTERM');
        // Give it 5 s to clean up, then SIGKILL
        setTimeout(() => killGroup('SIGKILL'), 5_000);
      }, this.timeoutMs);

      // ── FIX #14: stream stdout to log + caller callback ──────────────────
      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        output += str;
        logStream.write(str);  // write to per-task log
        if (this.onOutput) {
          try { this.onOutput(str); } catch (_) {}
        }
      });

      child.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        errOut += str;
        logStream.write('[STDERR] ' + str);
        if (this.onError) {
          try { this.onError(str); } catch (_) {}
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const exitCode = killed ? -1 : (code ?? -1);
        logStream.write(`\n=== Exited with code ${exitCode} at ${new Date().toISOString()} ===\n`);
        logStream.end();

        if (killed) {
          resolve({
            exitCode: -1,
            output,
            error: `[AgentRunner] Task timed out after ${this.timeoutMs}ms`,
          });
        } else {
          resolve({ exitCode, output, error: errOut });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        logStream.write(`\n[SPAWN ERROR] ${err.message}\n`);
        logStream.end();
        resolve({ exitCode: -1, output, error: err.message });
      });
    });
  }

  _buildPrompt(task) {
    return [
      `Task: ${task.title}`,
      ``,
      task.description || '(no description)',
      ``,
      `Repository: ${task.repo || '(current)'}`,
      `Branch: ${task.branch || 'main'}`,
    ].join('\n');
  }
}

// ESM default export — enables: import Factory from './agent-runner.js'
export default AgentRunner;
export { AgentRunner };