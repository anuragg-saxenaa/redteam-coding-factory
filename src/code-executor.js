/**
 * Code Executor — Phase 2 POC + Self-Healing CI (TICKET-2026-02-24-01)
 * Executes code (lint, test, commit) inside isolated worktrees.
 * Each stage is wrapped with SelfHealingCI for automatic retry on transient failures.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { SelfHealingCI } = require('./self-healing-ci');

class CodeExecutor {
  constructor(worktreeManager, options = {}) {
    this.worktreeManager = worktreeManager;
    // SelfHealingCI instance — shared across stage runs within one execute() call
    this._healingOptions = {
      maxRetries:  options.maxRetries  ?? 3,
      baseDelayMs: options.baseDelayMs ?? 200,  // faster in tests; production: 500+
      maxDelayMs:  options.maxDelayMs  ?? 4000,
      onRetry: (attempt, classification, hint, stageName) => {
        console.log(`[Executor][SelfHeal] Stage "${stageName}" retry #${attempt} — ${classification}: ${hint}`);
      },
      onEscalate: (stageName, result) => {
        console.warn(`[Executor][SelfHeal] Stage "${stageName}" escalated after ${result.attempts} attempts — ${result.classification}`);
      },
    };
  }

  /**
   * Execute a task inside its worktree.
   * Each stage is wrapped with SelfHealingCI for automatic retry on transient failures.
   *
   * @param {Object} task - task record with id, worktreeId, description
   * @returns {Object} - { success, output, errors, duration, steps, healingReport }
   */
  async execute(task) {
    const wt = this.worktreeManager.get(task.worktreeId);
    if (!wt) throw new Error(`Worktree ${task.worktreeId} not found`);

    const startTime = Date.now();
    const results = {
      taskId: task.id,
      worktreeId: task.worktreeId,
      steps: [],
      success: false,
      errors: [],
      duration: 0,
      healingReport: {},
    };

    // Fresh SelfHealingCI instance per task execution
    const healer = new SelfHealingCI(this._healingOptions);

    try {
      // Stage 1: Lint (with self-healing)
      console.log(`[Executor] Task ${task.id}: Running linter...`);
      const lintResult = await healer.runStage('lint', () => this.runLint(wt.path));
      results.steps.push({ name: 'lint', success: lintResult.success, attempts: lintResult.attempts, error: lintResult.lastError });

      if (!lintResult.success) {
        results.errors.push(`Linting failed (${lintResult.classification}): ${lintResult.lastError}`);
        results.duration = Date.now() - startTime;
        results.healingReport = healer.summary();
        return results;
      }

      // Stage 2: Test (with self-healing)
      console.log(`[Executor] Task ${task.id}: Running tests...`);
      const testResult = await healer.runStage('test', () => this.runTests(wt.path));
      results.steps.push({ name: 'test', success: testResult.success, attempts: testResult.attempts, error: testResult.lastError });

      if (!testResult.success) {
        results.errors.push(`Tests failed (${testResult.classification}): ${testResult.lastError}`);
        results.duration = Date.now() - startTime;
        results.healingReport = healer.summary();
        return results;
      }

      // Stage 3: Commit (with self-healing)
      console.log(`[Executor] Task ${task.id}: Committing changes...`);
      const commitResult = await healer.runStage('commit', () => this.runCommit(wt.path, task));
      results.steps.push({ name: 'commit', success: commitResult.success, attempts: commitResult.attempts, error: commitResult.lastError });

      if (!commitResult.success) {
        results.errors.push(`Commit failed (${commitResult.classification}): ${commitResult.lastError}`);
        results.duration = Date.now() - startTime;
        results.healingReport = healer.summary();
        return results;
      }

      results.success = true;
      results.duration = Date.now() - startTime;
      results.healingReport = healer.summary();
      console.log(`[Executor] Task ${task.id}: SUCCESS (${results.duration}ms)`);
      return results;
    } catch (error) {
      results.errors.push(error.message);
      results.duration = Date.now() - startTime;
      results.healingReport = healer.summary();
      console.error(`[Executor] Task ${task.id}: ERROR`, error.message);
      return results;
    }
  }

  /**
   * Run linter (eslint or similar)
   */
  async runLint(worktreePath) {
    try {
      const output = execSync(`cd ${worktreePath} && npm run lint 2>&1`, {
        stdio: 'pipe',
        timeout: 30000
      }).toString();

      return {
        success: true,
        output: output.substring(0, 500) // truncate
      };
    } catch (error) {
      return {
        success: false,
        error: error.message.substring(0, 500)
      };
    }
  }

  /**
   * Run tests
   */
  async runTests(worktreePath) {
    try {
      const output = execSync(`cd ${worktreePath} && npm test -- --run 2>&1`, {
        stdio: 'pipe',
        timeout: 60000
      }).toString();

      return {
        success: true,
        output: output.substring(0, 500)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message.substring(0, 500)
      };
    }
  }

  /**
   * Commit changes
   */
  async runCommit(worktreePath, task) {
    try {
      // Check if there are changes
      const status = execSync(`cd ${worktreePath} && git status --porcelain`, {
        stdio: 'pipe'
      }).toString();

      if (!status.trim()) {
        return {
          success: true,
          output: 'No changes to commit'
        };
      }

      // Stage all changes
      execSync(`cd ${worktreePath} && git add -A`, { stdio: 'pipe' });

      // Commit
      const commitMsg = `${task.title}\n\n${task.description}`;
      execSync(`cd ${worktreePath} && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
        stdio: 'pipe'
      });

      return {
        success: true,
        output: 'Changes committed'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message.substring(0, 500)
      };
    }
  }
}

module.exports = CodeExecutor;
