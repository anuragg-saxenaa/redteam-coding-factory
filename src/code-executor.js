/**
 * Code Executor — Phase 2 POC + Self-Healing CI
 * (TICKET-2026-02-24-01 + TICKET-2026-02-25-02)
 * Executes code (lint, test, commit) inside isolated worktrees.
 * Each stage is wrapped with guarded SelfHealingCI retries and scoped remediation.
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
      maxRetries: options.maxRetries ?? 3,
      maxRetryBudget: options.maxRetryBudget ?? 6,
      maxRemediationAttempts: options.maxRemediationAttempts ?? 1,
      enableAutoRemediation: options.enableAutoRemediation ?? false,
      remediationGenerator: options.remediationGenerator || null,
      remediationExecutor: options.remediationExecutor || null,
      baseDelayMs: options.baseDelayMs ?? 200,  // faster in tests; production: 500+
      maxDelayMs: options.maxDelayMs ?? 4000,
      onRetry: (attempt, classification, hint, stageName) => {
        console.log(`[Executor][SelfHeal] Stage "${stageName}" retry #${attempt} — ${classification}: ${hint}`);
      },
      onRemediation: (plan, remediationResult, stageName) => {
        const verdict = remediationResult?.success ? 'succeeded' : 'failed';
        console.log(`[Executor][SelfHeal] Remediation ${verdict} for "${stageName}" (${plan.classification}) scope=${plan.scope?.type || 'unknown'}`);
      },
      onEscalate: (stageName, result) => {
        console.warn(`[Executor][SelfHeal] Stage "${stageName}" escalated after ${result.attempts} attempts — ${result.classification} (${result.reason || 'unknown'})`);
      },
    };
  }

  _formatExecError(error) {
    const stdout = error && error.stdout ? error.stdout.toString() : '';
    const stderr = error && error.stderr ? error.stderr.toString() : '';
    const parts = [error && error.message ? error.message : '', stderr, stdout]
      .filter(Boolean)
      .join('\n')
      .trim();
    return parts.substring(0, 500);
  }

  _buildDefaultRemediationPlan(stageName, classification, result, attempt, context) {
    const scope = context.scope || { type: 'minimal', files: [], risk: 'high' };
    const commands = [];

    if (classification === 'LINT_ERROR') {
      commands.push('npm run lint -- --fix');
    } else if (classification === 'TYPE_ERROR') {
      commands.push('npm run typecheck');
    } else if (classification === 'TEST_FAILURE') {
      commands.push('npm test -- --run');
    } else if (classification === 'BUILD_ERROR') {
      commands.push('npm run build');
    } else if (classification === 'DEPENDENCY_ERROR') {
      commands.push('npm install --package-lock-only');
    }

    return {
      stageName,
      classification,
      attempt,
      hint: context.hint,
      scope,
      commands,
      error: result?.error || '',
      output: result?.output || '',
      generatedBy: 'code-executor-default',
    };
  }

  async _runRemediationPlan(worktreePath, plan) {
    if (!plan || !Array.isArray(plan.commands) || plan.commands.length === 0) {
      return {
        success: false,
        error: 'No remediation commands generated',
        output: '',
      };
    }

    try {
      const combinedOutput = [];
      for (const cmd of plan.commands) {
        const output = execSync(`cd ${worktreePath} && ${cmd} 2>&1`, {
          stdio: 'pipe',
          timeout: 120000,
        }).toString();
        combinedOutput.push(output.substring(0, 500));
      }

      return {
        success: true,
        output: combinedOutput.join('\n').substring(0, 1000),
      };
    } catch (error) {
      return {
        success: false,
        error: this._formatExecError(error),
      };
    }
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
      healingDetails: {},
    };

    const customGenerator = this._healingOptions.remediationGenerator;

    // Fresh SelfHealingCI instance per task execution
    const healer = new SelfHealingCI({
      ...this._healingOptions,
      remediationGenerator: (stageName, classification, result, attempt, context) => {
        if (typeof customGenerator === 'function') {
          return customGenerator(stageName, classification, result, attempt, context, task, wt.path);
        }
        return this._buildDefaultRemediationPlan(stageName, classification, result, attempt, context);
      },
      remediationExecutor: async (plan) => {
        if (typeof this._healingOptions.remediationExecutor === 'function') {
          return this._healingOptions.remediationExecutor(plan, task, wt.path);
        }
        return this._runRemediationPlan(wt.path, plan);
      },
    });

    try {
      // Stage 1: Lint (with self-healing)
      console.log(`[Executor] Task ${task.id}: Running linter...`);
      const lintResult = await healer.runStage('lint', () => this.runLint(wt.path));
      results.steps.push({ name: 'lint', success: lintResult.success, attempts: lintResult.attempts, error: lintResult.lastError });

      if (!lintResult.success) {
        results.errors.push(`Linting failed (${lintResult.classification}): ${lintResult.lastError}`);
        results.duration = Date.now() - startTime;
        results.healingReport = healer.summary();
        results.healingDetails = healer.report();
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
        results.healingDetails = healer.report();
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
        results.healingDetails = healer.report();
        return results;
      }

      results.success = true;
      results.duration = Date.now() - startTime;
      results.healingReport = healer.summary();
      results.healingDetails = healer.report();
      console.log(`[Executor] Task ${task.id}: SUCCESS (${results.duration}ms)`);
      return results;
    } catch (error) {
      results.errors.push(error.message);
      results.duration = Date.now() - startTime;
      results.healingReport = healer.summary();
      results.healingDetails = healer.report();
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
        error: this._formatExecError(error)
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
        error: this._formatExecError(error)
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
        error: this._formatExecError(error)
      };
    }
  }
}

module.exports = CodeExecutor;
