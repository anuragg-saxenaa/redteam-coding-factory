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
    this.execSync = config.execSync || execSync;
    this.enableSecurityDiffScan = config.enableSecurityDiffScan ?? true;
    this.onSecurityEscalation = config.onSecurityEscalation || null;
  }

  _run(command, options = {}) {
    return this.execSync(command, options);
  }

  _formatExecError(error) {
    const stdout = error && error.stdout ? error.stdout.toString() : '';
    const stderr = error && error.stderr ? error.stderr.toString() : '';
    const message = error && error.message ? error.message : 'unknown error';
    return [message, stderr, stdout].filter(Boolean).join('\n').trim();
  }

  _notifySecurityEscalation(payload) {
    if (!this.onSecurityEscalation) return;
    try {
      this.onSecurityEscalation(payload);
    } catch (_) {
      // best-effort callback
    }
  }

  _collectDiffFiles(wtPath, baseBranch = 'main') {
    try {
      const mergeBase = this._run(`git -C ${wtPath} merge-base HEAD origin/${baseBranch}`).toString().trim();
      const output = this._run(`git -C ${wtPath} diff --name-only ${mergeBase}..HEAD`).toString().trim();
      if (!output) return [];
      return output.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch (error) {
      throw new Error(`[PushPRManager] Security scan failed while collecting diff files: ${this._formatExecError(error)}`);
    }
  }

  _evaluateSecurityRisk(diffFiles = []) {
    const secretFilePattern = /(^|\/)(\.env(\.|$)|\.npmrc$|\.pypirc$|id_rsa$|id_ed25519$|.*\.pem$|.*\.key$|.*\.p12$|.*\.pfx$)/i;
    const workflowPattern = /(^|\/)\.github\/workflows\/.*\.ya?ml$/i;
    const ciScriptPattern = /(^|\/)(scripts|ops)\/.+\.(sh|bash|ps1)$/i;

    const risky = [];
    for (const file of diffFiles) {
      if (secretFilePattern.test(file)) {
        risky.push({ file, reason: 'potential-secret-material' });
      } else if (workflowPattern.test(file)) {
        risky.push({ file, reason: 'ci-workflow-change' });
      } else if (ciScriptPattern.test(file)) {
        risky.push({ file, reason: 'ci-script-change' });
      }
    }

    return {
      hasRisk: risky.length > 0,
      risky,
    };
  }

  scanSecurityDiff(wtPath, baseBranch = 'main') {
    const files = this._collectDiffFiles(wtPath, baseBranch);
    return {
      files,
      ...this._evaluateSecurityRisk(files),
    };
  }

  syncWithBaseBranch(wtPath, baseBranch = 'main') {
    const currentBranch = this._run(`git -C ${wtPath} rev-parse --abbrev-ref HEAD`).toString().trim();

    try {
      console.log(`[PushPRManager] Syncing ${currentBranch} with origin/${baseBranch}...`);
      this._run(`git -C ${wtPath} fetch origin ${baseBranch}`, { stdio: 'pipe' });
      this._run(`git -C ${wtPath} rebase origin/${baseBranch}`, { stdio: 'pipe' });
      return currentBranch;
    } catch (error) {
      const details = this._formatExecError(error);
      const isConflict = /conflict|could not apply|resolve all conflicts/i.test(details);

      if (isConflict) {
        try {
          this._run(`git -C ${wtPath} rebase --abort`, { stdio: 'pipe' });
        } catch (_) {
          // best effort
        }
        throw new Error(`[PushPRManager] REBASE_CONFLICT: branch=${currentBranch} base=${baseBranch}; ${details}`);
      }

      throw new Error(`[PushPRManager] Rebase failed: ${details}`);
    }
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
    
    const baseBranch = task.branch || 'main';

    // Step 2: Sync with base branch before pushing (conflict/rebase reaction)
    const currentBranch = this.syncWithBaseBranch(wt.path, baseBranch);

    // Step 3: Security diff scan + escalation before push
    if (this.enableSecurityDiffScan) {
      const securityScan = this.scanSecurityDiff(wt.path, baseBranch);
      if (securityScan.hasRisk) {
        const details = securityScan.risky
          .map((entry) => `${entry.file} (${entry.reason})`)
          .join(', ');

        this._notifySecurityEscalation({
          taskId: task.id,
          taskTitle: task.title,
          issueNumber: task.metadata?.issueNumber,
          issueUrl: task.metadata?.issueUrl,
          repo: task.repo,
          baseBranch,
          branch: currentBranch,
          files: securityScan.files,
          risky: securityScan.risky,
          summary: details,
          reason: 'SECURITY_ESCALATION',
          ts: new Date().toISOString(),
        });

        throw new Error(`[PushPRManager] SECURITY_ESCALATION: sensitive diff detected. ${details}. Escalate to INFOSEC/RED for manual review before push.`);
      }
    }

    // Step 4: Push changes
    try {
      console.log(`[PushPRManager] Pushing branch ${currentBranch} from ${wt.path}...`);
      this._run(`git -C ${wt.path} push origin ${currentBranch}`, { stdio: 'inherit' });
      console.log(`[PushPRManager] Push successful for task ${task.id}.`);
    } catch (error) {
      throw new Error(`[PushPRManager] Git push failed: ${this._formatExecError(error)}`);
    }

    if (!createPR) {
      return { success: true, message: `Pushed changes for task ${task.id} to ${currentBranch}.` };
    }

    // Step 4: Create PR using GitHub CLI
    try {
      console.log(`[PushPRManager] Creating PR for task ${task.id}...`);
      const prBody = this.criticGate.generatePRBody(task, evaluation);
      const prTitle = `[${task.title}] - Task ${task.id}`;

      const ghCommand = `${this.gitHubCliPath} pr create --title "${prTitle}" --body "${prBody}" --repo ${task.repo}`;
      const prOutput = this._run(ghCommand, { stdio: 'pipe' }).toString().trim();
      
      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/.*\/pull\/\d+/);
      const prUrl = prUrlMatch ? prUrlMatch[0] : 'N/A';

      console.log(`[PushPRManager] PR created: ${prUrl}`);
      return { success: true, message: `PR created for task ${task.id}.`, prUrl };
    } catch (error) {
      throw new Error(`[PushPRManager] GitHub PR creation failed: ${this._formatExecError(error)}`);
    }
  }
}

module.exports = PushPRManager;
