/**
 * Agent Runner — Phase 2: Real Coding Agent Execution
 *
 * Actually shells out to a coding agent CLI (codex or claude)
 * inside an isolated worktree directory.
 *
 * Supports:
 *  - codex CLI  (OpenAI Codex)
 *  - claude CLI  (Anthropic Claude Code)
 *  - custom command
 *
 * Each run:
 *  1. Builds a task prompt from the task record
 *  2. Spawns the agent CLI as a child process in the worktree
 *  3. Captures stdout/stderr with a timeout
 *  4. Detects success/failure from exit code + output
 *  5. Returns structured result
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENT_PRESETS = {
  codex: {
    bin: 'codex',
    buildArgs: (prompt, worktreePath) => [
      '--quiet',
      '--full-auto',
      '-m', 'o4-mini',
      prompt,
    ],
    cwd: (worktreePath) => worktreePath,
    env: {},
  },
  claude: {
    bin: 'claude',
    buildArgs: (prompt, worktreePath) => [
      '-p', prompt,
      '--allowedTools', 'Bash,Read,Write,Edit',
      '--output-format', 'text',
    ],
    cwd: (worktreePath) => worktreePath,
    env: {},
  },
};

class AgentRunner {
  /**
   * @param {Object} options
   * @param {string} options.agent       - Agent preset: 'codex' | 'claude' | 'custom'
   * @param {string} options.customBin   - Custom binary path (when agent='custom')
   * @param {Function} options.customArgs - (prompt, worktreePath) => string[] (when agent='custom')
   * @param {number} options.timeoutMs   - Max execution time (default: 5 min)
   * @param {number} options.maxOutputBytes - Truncate captured output (default: 100KB)
   * @param {Function} options.onOutput  - Optional live output callback (chunk) => void
   */
  constructor(options = {}) {
    this.agentName = options.agent || 'codex';
    this.timeoutMs = options.timeoutMs || 5 * 60 * 1000;
    this.maxOutputBytes = options.maxOutputBytes || 100 * 1024;
    this.onOutput = options.onOutput || null;

    if (this.agentName === 'custom') {
      if (!options.customBin) throw new Error('agent-runner: customBin required when agent=custom');
      this._preset = {
        bin: options.customBin,
        buildArgs: options.customArgs || ((prompt) => [prompt]),
        cwd: (wp) => wp,
        env: options.customEnv || {},
      };
    } else {
      this._preset = AGENT_PRESETS[this.agentName];
      if (!this._preset) throw new Error(`agent-runner: unknown agent preset "${this.agentName}"`);
    }
  }

  /**
   * Build the prompt for the coding agent
   * @param {Object} task - { id, title, description, repo, branch }
   * @param {string} worktreePath
   * @returns {string}
   */
  buildPrompt(task, worktreePath) {
    return [
      `Task: ${task.title}`,
      '',
      task.description || '(no additional description)',
      '',
      'Instructions:',
      `- You are working inside: ${worktreePath}`,
      '- Make the code changes needed to complete this task.',
      '- Run tests after making changes (npm test or the project test command).',
      '- Fix any test failures before finishing.',
      '- Stage and commit your changes with a descriptive commit message.',
      '- Do NOT push — the factory will handle push/PR.',
    ].join('\n');
  }

  /**
   * Run the coding agent on a task inside a worktree.
   *
   * @param {Object} task - task record
   * @param {string} worktreePath - absolute path to the worktree
   * @returns {Promise<Object>} - { success, exitCode, stdout, stderr, durationMs, agent, prompt }
   */
  run(task, worktreePath) {
    return new Promise((resolve) => {
      const prompt = this.buildPrompt(task, worktreePath);
      const args = this._preset.buildArgs(prompt, worktreePath);
      const cwd = this._preset.cwd(worktreePath);
      const bin = this._preset.bin;

      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      console.log(`[AgentRunner] Spawning ${bin} in ${cwd}`);
      console.log(`[AgentRunner] Args: ${JSON.stringify(args).substring(0, 200)}`);

      const child = spawn(bin, args, {
        cwd,
        env: { ...process.env, ...this._preset.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.timeoutMs,
      });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        if (stdout.length < this.maxOutputBytes) {
          stdout += text.substring(0, this.maxOutputBytes - stdout.length);
        }
        if (this.onOutput) this.onOutput(text);
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (stderr.length < this.maxOutputBytes) {
          stderr += text.substring(0, this.maxOutputBytes - stderr.length);
        }
      });

      // Enforce timeout
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
        }, 5000);
      }, this.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const success = code === 0 && !killed;

        console.log(`[AgentRunner] ${bin} exited code=${code} killed=${killed} duration=${durationMs}ms`);

        resolve({
          success,
          exitCode: code,
          killed,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs,
          agent: this.agentName,
          prompt,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        console.error(`[AgentRunner] spawn error: ${err.message}`);

        resolve({
          success: false,
          exitCode: -1,
          killed: false,
          stdout: '',
          stderr: err.message,
          durationMs,
          agent: this.agentName,
          prompt,
          spawnError: err.message,
        });
      });
    });
  }

  /**
   * Check if the agent binary is available on PATH
   * @returns {boolean}
   */
  isAvailable() {
    try {
      execSync(`which ${this._preset.bin}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = AgentRunner;
