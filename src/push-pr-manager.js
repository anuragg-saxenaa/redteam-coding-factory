/**
 * Push/PR Manager — Phase 5
 *
 * Production-hardened:
 *   #7  All git network operations (fetch, rebase, push) are now fully async
 *       using execFile wrapped in a Promise.  The Node.js event loop is never
 *       blocked during network I/O.  A per-operation timeout of 60 s prevents
 *       infinite hangs.
 */

'use strict';

const { execFile, execFileSync } = require('child_process');
const { promisify }              = require('util');
const path                       = require('path');
const CriticGate                 = require('./critic-gate');

const execFileAsync = promisify(execFile);

// Async wrapper with a configurable timeout (default 60 s)
async function runGitAsync(args, options = {}) {
  const timeout = options.timeout || 60_000;
  const cwd     = options.cwd;
  return execFileAsync('git', args, { timeout, cwd, encoding: 'utf8' });
}

class PushPRManager {
  constructor(worktreeManager, taskManager, config = {}) {
    this.worktreeManager     = worktreeManager;
    this.taskManager         = taskManager;
    this.criticGate          = new CriticGate(taskManager);

    this.enablePush              = config.enablePush              || false;
    this.gitHubCliPath           = config.gitHubCliPath           || 'gh';
    this.enableSecurityDiffScan  = config.enableSecurityDiffScan  ?? true;
    this.onSecurityEscalation    = config.onSecurityEscalation    || null;
    this.gitNetworkTimeoutMs     = config.gitNetworkTimeoutMs     || 60_000;

    // Legacy sync execSync shim (kept only for non-network local ops)
    this._execSync = config.execSync || execFileSync;
  }

  _formatExecError(error) {
    const out = [
      error?.message   || 'unknown error',
      error?.stderr    || '',
      error?.stdout    || '',
    ].filter(Boolean).join('\n').trim();
    return out;
  }

  _notifySecurityEscalation(payload) {
    if (!this.onSecurityEscalation) return;
    try { this.onSecurityEscalation(payload); } catch (_) {}
  }

  // ── Diff helpers (local — no network, execFileSync is fine) ───────────
  _collectDiffFiles(wtPath, baseBranch = 'main') {
    try {
      const mergeBase = execFileSync('git', ['-C', wtPath, 'merge-base', 'HEAD', `origin/${baseBranch}`], { stdio: 'pipe' }).toString().trim();
      const output    = execFileSync('git', ['-C', wtPath, 'diff', '--name-only', `${mergeBase}..HEAD`], { stdio: 'pipe' }).toString().trim();
      return output ? output.split('\n').map(l => l.trim()).filter(Boolean) : [];
    } catch (err) {
      throw new Error(`[PushPRManager] Security scan failed collecting diff: ${this._formatExecError(err)}`);
    }
  }

  _evaluateSecurityRisk(diffFiles = []) {
    const secretFilePattern  = /(^\/?)(\.env(\.|$)|\.npmrc$|\.pypirc$|id_rsa$|id_ed25519$|.*\.pem$|.*\.key$|.*\.p12$|.*\.pfx$)/i;
    const workflowPattern    = /(^\/?)(\.github\/workflows\/.*\.ya?ml$)/i;
    const ciScriptPattern    = /(^\/?)((scripts|ops)\/.+\.(sh|bash|ps1)$)/i;
    const risky = [];

    for (const file of diffFiles) {
      if (secretFilePattern.test(file))    risky.push({ file, reason: 'potential-secret-material' });
      else if (workflowPattern.test(file)) risky.push({ file, reason: 'ci-workflow-change' });
      else if (ciScriptPattern.test(file)) risky.push({ file, reason: 'ci-script-change' });
    }
    return { hasRisk: risky.length > 0, risky };
  }

  scanSecurityDiff(wtPath, baseBranch = 'main') {
    const files = this._collectDiffFiles(wtPath, baseBranch);
    return { files, ...this._evaluateSecurityRisk(files) };
  }

  // ── FIX #7: async rebase sync — no longer blocks the event loop ───────
  async syncWithBaseBranch(wtPath, baseBranch = 'main') {
    const currentBranch = execFileSync('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe' }).toString().trim();

    try {
      console.log(`[PushPRManager] Fetching origin/${baseBranch}…`);
      await runGitAsync(['-C', wtPath, 'fetch', 'origin', baseBranch], { timeout: this.gitNetworkTimeoutMs });

      console.log(`[PushPRManager] Rebasing ${currentBranch} onto origin/${baseBranch}…`);
      await runGitAsync(['-C', wtPath, 'rebase', `origin/${baseBranch}`], { timeout: this.gitNetworkTimeoutMs });

      return currentBranch;
    } catch (err) {
      const details    = this._formatExecError(err);
      const isConflict = /conflict|could not apply|resolve all conflicts/i.test(details);

      if (isConflict) {
        try { execFileSync('git', ['-C', wtPath, 'rebase', '--abort'], { stdio: 'pipe' }); } catch (_) {}
        throw new Error(`[PushPRManager] REBASE_CONFLICT: branch=${currentBranch} base=${baseBranch}; ${details}`);
      }
      throw new Error(`[PushPRManager] Rebase failed: ${details}`);
    }
  }

  /**
   * Create a push or PR for a task.
   * FIX #7: all network ops are now awaited (async) — never blocks the loop.
   */
  async createPushPR(task, options = {}) {
    const { forceMode = false, createPR = false } = options;

    const wt = this.worktreeManager.getByTaskId(task.id);
    if (!wt) throw new Error(`Worktree for task ${task.id} not found`);

    // Step 1: Critic Gate
    const evaluation = this.criticGate.evaluate(task, { forceMode });
    if (!evaluation.canPush) {
      if (forceMode) {
        this.criticGate.logForceOverride(task.id, evaluation.reason);
      } else {
        throw new Error(`[PushPRManager] Critic gate blocked push: ${evaluation.reason}`);
      }
    }

    if (!this.enablePush && !forceMode) {
      throw new Error('[PushPRManager] Push disabled by config. Set enablePush: true or FACTORY_ENABLE_PUSH=true.');
    }

    const baseBranch = task.branch || 'main';

    // Step 2: Async rebase sync (FIX #7)
    const currentBranch = await this.syncWithBaseBranch(wt.path, baseBranch);

    // Step 3: Security diff scan
    if (this.enableSecurityDiffScan) {
      const scan = this.scanSecurityDiff(wt.path, baseBranch);
      if (scan.hasRisk) {
        const details = scan.risky.map(e => `${e.file} (${e.reason})`).join(', ');
        this._notifySecurityEscalation({
          taskId: task.id, taskTitle: task.title,
          repo: task.repo, baseBranch, branch: currentBranch,
          files: scan.files, risky: scan.risky,
          summary: details, reason: 'SECURITY_ESCALATION',
          ts: new Date().toISOString(),
        });
        throw new Error(`[PushPRManager] SECURITY_ESCALATION: ${details}`);
      }
    }

    // Step 4: Async push (FIX #7)
    try {
      console.log(`[PushPRManager] Pushing ${currentBranch}…`);
      await runGitAsync(['-C', wt.path, 'push', 'origin', currentBranch], { timeout: this.gitNetworkTimeoutMs });
      console.log(`[PushPRManager] Push successful for task ${task.id}`);
    } catch (err) {
      throw new Error(`[PushPRManager] Git push failed: ${this._formatExecError(err)}`);
    }

    if (!createPR) {
      return { success: true, message: `Pushed ${currentBranch} for task ${task.id}.` };
    }

    // Step 5: Create PR via gh CLI (async)
    try {
      const prBody  = this.criticGate.generatePRBody(task, evaluation);
      const prTitle = `[${task.title}] — Task ${task.id}`;
      const { stdout } = await execFileAsync(
        this.gitHubCliPath,
        ['pr', 'create', '--title', prTitle, '--body', prBody, '--repo', task.repo],
        { timeout: this.gitNetworkTimeoutMs, encoding: 'utf8' }
      );
      const prUrlMatch = stdout.match(/https:\/\/github\.com\/.*\/pull\/\d+/);
      const prUrl      = prUrlMatch ? prUrlMatch[0] : 'N/A';
      console.log(`[PushPRManager] PR created: ${prUrl}`);
      return { success: true, message: `PR created for task ${task.id}.`, prUrl };
    } catch (err) {
      throw new Error(`[PushPRManager] PR creation failed: ${this._formatExecError(err)}`);
    }
  }
}

// ESM default export — enables: import Factory from './push-pr-manager.js'
export default PushPRManager;
export { PushPRManager };