/**
 * Critic Gate — Phase 5 POC
 * Deterministic validation layer before push/PR creation
 * Blocks push/PR unless green, or explicitly overridden with "force" mode
 */

// Repos owned by anuragg-saxenaa — force mode allowed for internal work
const INTERNAL_REPO_PREFIX = 'anuragg-saxenaa/';

class CriticGate {
  constructor(taskManager) {
    this.taskManager = taskManager;
    this.requiredChecks = ['lint', 'test']; // typecheck optional for now
  }

  /**
   * Returns true if the task targets an external (OSS) repo.
   * Force mode is never allowed for external repos.
   */
  _isExternalRepo(task) {
    const repo = task.metadata && task.metadata.repo ? task.metadata.repo : (task.repo || '');
    return repo && !repo.startsWith(INTERNAL_REPO_PREFIX);
  }

  /**
   * Evaluate if a task is ready for push/PR
   * @param {Object} task - task record with validationResult
   * @param {Object} options - { forceMode: boolean }
   * @returns {Object} - { canPush, reason, checks }
   */
  evaluate(task, options = {}) {
    const { forceMode = false } = options;
    const checks = {};
    let allPassed = true;

    console.log(`[CriticGate] Evaluating task ${task.id} (forceMode: ${forceMode})`);

    if (!task.validationResult) {
      return {
        canPush: false,
        reason: 'No validation result attached to task',
        checks: {}
      };
    }

    // Check each required validation
    for (const checkName of this.requiredChecks) {
      const step = task.validationResult.steps?.find(s => s.name === checkName);
      
      if (!step) {
        checks[checkName] = { status: 'missing', error: `${checkName} step not found` };
        allPassed = false;
      } else if (!step.success) {
        checks[checkName] = { status: 'failed', error: step.error };
        allPassed = false;
      } else {
        checks[checkName] = { status: 'passed' };
      }
    }

    // Determine if push is allowed
    let canPush = allPassed;
    let reason = allPassed ? 'All checks passed' : 'Some checks failed';

    if (!allPassed && forceMode) {
      // Force mode is never allowed for external/OSS repos
      if (this._isExternalRepo(task)) {
        canPush = false;
        reason = 'Force mode blocked: external/OSS repo requires all checks to pass';
        console.error(`[CriticGate] BLOCKED: Force mode rejected for external repo task ${task.id}`);
      } else {
        canPush = true;
        reason = 'Force mode enabled (override — internal repo only)';
        console.warn(`[CriticGate] FORCE MODE: Task ${task.id} approved despite failures (internal repo)`);
      }
    }

    return {
      canPush,
      reason,
      checks,
      forceMode,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * Log force mode override to task record
   */
  logForceOverride(taskId, reason) {
    const task = this.taskManager.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (!task.forceOverrides) task.forceOverrides = [];
    task.forceOverrides.push({
      reason,
      timestamp: new Date().toISOString()
    });

    this.taskManager.persistQueue();
    console.log(`[CriticGate] Logged force override for task ${taskId}: ${reason}`);
  }

  /**
   * Generate a professional PR body suitable for an external OSS contribution.
   * Reads like a human wrote it — no factory metadata, no debug noise.
   */
  generatePRBody(task, evaluation) {
    const issueNumber = task.metadata && task.metadata.issueNumber;
    const issueRef = issueNumber ? `\n\nFixes #${issueNumber}` : '';

    const description = (task.description || '').trim();
    const summary = description.length > 0 ? description : task.title;

    // Only include closes/fixes ref — no internal IDs, no validation dumps
    return `${summary}${issueRef}`;
  }
}

module.exports = CriticGate;
