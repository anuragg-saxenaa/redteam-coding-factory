/**
 * Push/PR Manager — Phase 5 POC
 * Handles creating git pushes and pull requests with safety rails
 */

const { execSync } = require('child_process');
const path = require('path');
const CriticGate = require('./critic-gate');

class PushPRManager {
  constructor(worktreeManager, taskManager, config = {}) {
    this.worktreeManager = worktreeManager;
    this.taskManager = taskManager;
    this.criticGate = new CriticGate(taskManager);
    this.enablePush = config.enablePush || false; // default to false
    this.gitHubCliPath = config.gitHubCliPath || 'gh'; // Path to gh CLI
  }

  /**
   * Create a push or PR for a task
   * @param {Object} task - task record
   * @param {Object} options - { forceMode: boolean, createPR: boolean }
   * @returns {Object} - { success, message, prUrl? }
   */
  createPushPR(task, options = {}) {
    const { forceMode = false, createPR = false } = options;

    const wt = this.worktreeManager.getByTaskId(task.id);
    if (!wt) throw new Error(`Worktree for task ${task.id} not found`);

    console.log(`[PushPRManager] Evaluating push/PR for task ${task.id}...`);

    // Step 1: Critic Gate evaluation
    const evaluation = this.criticGate.evaluate(task, { forceMode });

    if (!evaluation.canPush) {
      if (forceMode) {
        this.criticGate.logForceOverride(task.id, evaluation.reason);
      } else {
        throw new Error(`[PushPRManager] Cannot push/PR: ${evaluation.reason}`);
      }
    }

    if (!this.enablePush && !forceMode) {
      throw new Error(`[PushPRManager] Push/PR disabled by configuration. Set enablePush: true or use forceMode: true to override.`);
    }
    
    // Step 2: Push changes
    const currentBranch = execSync(`git -C ${wt.path} rev-parse --abbrev-ref HEAD`).toString().trim();
    try {
      console.log(`[PushPRManager] Pushing branch ${currentBranch} from ${wt.path}...`);
      execSync(`git -C ${wt.path} push origin ${currentBranch}`, { stdio: 'inherit' });
      console.log(`[PushPRManager] Push successful for task ${task.id}.`);
    } catch (error) {
      throw new Error(`[PushPRManager] Git push failed: ${error.message}`);
    }

    if (!createPR) {
      return { success: true, message: `Pushed changes for task ${task.id} to ${currentBranch}.` };
    }

    // Step 3: Create PR using GitHub CLI
    try {
      console.log(`[PushPRManager] Creating PR for task ${task.id}...`);
      const prBody = this.criticGate.generatePRBody(task, evaluation);
      const prTitle = `[${task.title}] - Task ${task.id}`;

      const ghCommand = `${this.gitHubCliPath} pr create --title "${prTitle}" --body "${prBody}" --repo ${task.repo}`;
      const prOutput = execSync(ghCommand, { stdio: 'pipe' }).toString().trim();
      
      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/.*\/pull\/\d+/);
      const prUrl = prUrlMatch ? prUrlMatch[0] : 'N/A';

      console.log(`[PushPRManager] PR created: ${prUrl}`);
      return { success: true, message: `PR created for task ${task.id}.`, prUrl };
    } catch (error) {
      throw new Error(`[PushPRManager] GitHub PR creation failed: ${error.message}`);
    }
  }
}

module.exports = PushPRManager;
