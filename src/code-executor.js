/**
 * Code Executor — Phase 2 POC
 * Executes code (lint, test, commit) inside isolated worktrees
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class CodeExecutor {
  constructor(worktreeManager) {
    this.worktreeManager = worktreeManager;
  }

  /**
   * Execute a task inside its worktree
   * @param {Object} task - task record with id, worktreeId, description
   * @returns {Object} - { success, output, errors, duration }
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
      duration: 0
    };

    try {
      // Step 1: Lint
      console.log(`[Executor] Task ${task.id}: Running linter...`);
      const lintResult = await this.runLint(wt.path);
      results.steps.push({ name: 'lint', ...lintResult });

      if (!lintResult.success) {
        results.errors.push(`Linting failed: ${lintResult.error}`);
        results.duration = Date.now() - startTime;
        return results;
      }

      // Step 2: Test
      console.log(`[Executor] Task ${task.id}: Running tests...`);
      const testResult = await this.runTests(wt.path);
      results.steps.push({ name: 'test', ...testResult });

      if (!testResult.success) {
        results.errors.push(`Tests failed: ${testResult.error}`);
        results.duration = Date.now() - startTime;
        return results;
      }

      // Step 3: Commit
      console.log(`[Executor] Task ${task.id}: Committing changes...`);
      const commitResult = await this.runCommit(wt.path, task);
      results.steps.push({ name: 'commit', ...commitResult });

      if (!commitResult.success) {
        results.errors.push(`Commit failed: ${commitResult.error}`);
        results.duration = Date.now() - startTime;
        return results;
      }

      results.success = true;
      results.duration = Date.now() - startTime;
      console.log(`[Executor] Task ${task.id}: SUCCESS (${results.duration}ms)`);
      return results;
    } catch (error) {
      results.errors.push(error.message);
      results.duration = Date.now() - startTime;
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
