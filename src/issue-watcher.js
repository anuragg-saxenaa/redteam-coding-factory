/**
 * Issue Watcher — Phase 2: Autonomous GitHub Issue Polling Daemon
 *
 * Polls a GitHub repo for issues labelled "factory-ready", converts them
 * to factory tasks, runs them through the CodingFactory pipeline, and
 * reports results back on the issue thread.
 *
 * Lifecycle per issue:
 *   1. Poll → find new "factory-ready" issues
 *   2. Claim → add "factory-in-progress" label
 *   3. Create worktree → run agent → validate → push/PR
 *   4. Comment result on issue
 *   5. On success: close issue (or leave open for review)
 *   6. On failure: comment error, remove "factory-in-progress"
 *
 * Designed to run as a long-lived process (daemon) or as a single poll (one-shot).
 */

const GitHubIntake = require('./github-intake');
const CodingFactory = require('./factory');
const AgentRunner = require('./agent-runner');
const path = require('path');
const fs = require('fs');

class IssueWatcher {
  /**
   * @param {Object} config
   * @param {string} config.repo           - GitHub owner/repo (e.g. "anuragg-saxenaa/my-repo")
   * @param {string} config.repoPath       - Local clone path
   * @param {string} config.branch         - Target branch (default: "main")
   * @param {string} config.label          - Issue label filter (default: "factory-ready")
   * @param {number} config.pollIntervalMs - Polling interval in ms (default: 60000)
   * @param {number} config.maxConcurrent  - Max concurrent tasks (default: 1)
   * @param {string} config.agent          - Agent preset: 'codex'|'claude' (default: 'codex')
   * @param {number} config.agentTimeoutMs - Agent timeout (default: 5 min)
   * @param {boolean} config.enablePush    - Enable git push (default: false)
   * @param {boolean} config.createPR      - Create PRs (default: false)
   * @param {boolean} config.autoClose     - Close issue on success (default: false)
   * @param {string} config.dataDir        - Data directory for factory state
   * @param {Function} config.onTaskComplete - Callback (issue, result) => void
   * @param {Function} config.onTaskFail    - Callback (issue, error) => void
   * @param {Function} config.onPoll        - Callback (issueCount) => void
   */
  constructor(config = {}) {
    this.repo = config.repo;
    this.repoPath = config.repoPath;
    this.branch = config.branch || 'main';
    this.pollIntervalMs = config.pollIntervalMs || 60000;
    this.maxConcurrent = config.maxConcurrent || 1;
    this.enableAutoRemediation = config.enableAutoRemediation ?? false;
    this.maxRetryBudget = config.maxRetryBudget ?? 6;
    this.enablePush = config.enablePush || false;
    this.createPR = config.createPR || false;
    this.autoClose = config.autoClose || false;
    this.agentName = config.agent || 'codex';
    this.agentTimeoutMs = config.agentTimeoutMs || 5 * 60 * 1000;
    this.dataDir = config.dataDir || path.join(this.repoPath || '.', '.factory-data');
    this.maxTasksPerRun = Number.isFinite(config.maxTasksPerRun) && config.maxTasksPerRun > 0
      ? config.maxTasksPerRun
      : Infinity;
    this.maxPolls = Number.isFinite(config.maxPolls) && config.maxPolls > 0
      ? config.maxPolls
      : Infinity;
    this.stopReason = null;
    this.securityEscalationLogPath = config.securityEscalationLogPath
      || path.join(this.dataDir, 'security-escalations.jsonl');

    // Callbacks
    this.onTaskComplete = config.onTaskComplete || null;
    this.onTaskFail = config.onTaskFail || null;
    this.onPoll = config.onPoll || null;

    // State
    this._running = false;
    this._timer = null;
    this._activeTasks = 0;
    this._processedIssues = new Set(); // issue numbers processed this session
    this._stats = { polled: 0, started: 0, completed: 0, failed: 0, skipped: 0 };

    // Initialize GitHubIntake
    this.intake = new GitHubIntake({
      repo: this.repo,
      label: config.label || 'factory-ready',
      autoClaim: true,
      limit: config.maxConcurrent || 1,
    });

    // Initialize CodingFactory
    this.factory = new CodingFactory({
      baseRepo: this.repoPath,
      dataDir: this.dataDir,
      worktreeRoot: path.join(this.dataDir, 'worktrees'),
      enablePush: this.enablePush,
      createPR: this.createPR,
      maxRetries: config.maxRetries || 3,
      enableAutoRemediation: this.enableAutoRemediation,
      maxRetryBudget: this.maxRetryBudget,
      maxRemediationAttempts: config.maxRemediationAttempts || 1,
      onSecurityEscalation: (payload) => this._handleSecurityEscalation(payload),
    });

    // Keep agent wait timeout aligned with watcher-level timeout configuration.
    this.factory.agentIntegration.defaultTimeoutMs = this.agentTimeoutMs;
  }

  /**
   * Start the polling daemon
   */
  start() {
    if (this._running) {
      console.log('[IssueWatcher] Already running');
      return;
    }

    if (!this.repo) throw new Error('IssueWatcher: repo is required');
    if (!this.repoPath) throw new Error('IssueWatcher: repoPath is required');

    // Verify gh CLI is available and authenticated
    if (!this.intake.isAuthenticated()) {
      throw new Error('IssueWatcher: gh CLI is not authenticated. Run "gh auth login" first.');
    }

    this._running = true;
    console.log(`[IssueWatcher] Starting daemon — repo: ${this.repo}, poll: ${this.pollIntervalMs}ms, agent: ${this.agentName}`);
    console.log(`[IssueWatcher] Push: ${this.enablePush}, PR: ${this.createPR}, AutoClose: ${this.autoClose}`);
    console.log(`[IssueWatcher] Remediation: ${this.enableAutoRemediation}, RetryBudget: ${this.maxRetryBudget}`);

    // First poll immediately
    this._poll();

    // Then poll on interval
    this._timer = setInterval(() => this._poll(), this.pollIntervalMs);
  }

  /**
   * Stop the daemon gracefully
   */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[IssueWatcher] Stopped');
    console.log(`[IssueWatcher] Stats: ${JSON.stringify(this._stats)}`);
  }

  /**
   * Run a single poll cycle (useful for cron/one-shot mode)
   * @returns {Promise<Array>} - results
   */
  async pollOnce() {
    if (!this.repo) throw new Error('IssueWatcher: repo is required');
    if (!this.repoPath) throw new Error('IssueWatcher: repoPath is required');
    return this._poll();
  }

  /**
   * Internal: execute one poll cycle
   */
  async _poll() {
    if (this._shouldStopBeforePoll()) {
      return [];
    }

    if (this._activeTasks >= this.maxConcurrent) {
      console.log(`[IssueWatcher] Skipping poll — ${this._activeTasks} active tasks (max: ${this.maxConcurrent})`);
      return [];
    }

    this._stats.polled++;
    console.log(`[IssueWatcher] Polling for issues... (cycle #${this._stats.polled})`);

    let tasks;
    try {
      tasks = this.intake.poll(this.repoPath, this.branch);
    } catch (err) {
      console.error(`[IssueWatcher] Poll error: ${err.message}`);
      return [];
    }

    if (this.onPoll) {
      try { this.onPoll(tasks.length); } catch (_) {}
    }

    if (tasks.length === 0) {
      console.log('[IssueWatcher] No new issues found');
      return [];
    }

    console.log(`[IssueWatcher] Found ${tasks.length} new issue(s)`);

    const results = [];
    const availableSlots = Math.max(0, this.maxConcurrent - this._activeTasks);
    const workers = [];

    for (const task of tasks) {
      if (workers.length >= availableSlots) {
        break;
      }

      const issueNumber = task.metadata?.issueNumber;

      if (this._processedIssues.has(issueNumber)) {
        this._stats.skipped++;
        continue;
      }

      if (this._activeTasks >= this.maxConcurrent) {
        console.log(`[IssueWatcher] Concurrency limit reached, deferring remaining issues`);
        break;
      }

      this._processedIssues.add(issueNumber);
      this._activeTasks++;
      this._stats.started++;

      // Process asynchronously up to the configured concurrency cap.
      workers.push(
        this._processIssue(task, issueNumber)
          .then((result) => {
            results.push(result);
            return result;
          })
      );
    }

    await Promise.all(workers);

    return results;
  }

  _shouldStopBeforePoll() {
    const processed = this._stats.completed + this._stats.failed;

    if (processed >= this.maxTasksPerRun) {
      this.stopReason = this.stopReason || `task budget reached (${processed}/${this.maxTasksPerRun})`;
    } else if (this._stats.polled >= this.maxPolls) {
      this.stopReason = this.stopReason || `poll budget reached (${this._stats.polled}/${this.maxPolls})`;
    }

    if (!this.stopReason) {
      return false;
    }

    if (this._running) {
      console.log(`[IssueWatcher] Stop condition reached: ${this.stopReason}`);
      this.stop();
    }
    return true;
  }

  /**
   * Process a single issue through the factory pipeline
   */
  async _processIssue(task, issueNumber) {
    const startTime = Date.now();
    console.log(`[IssueWatcher] Processing issue #${issueNumber}: ${task.title}`);

    try {
      // Comment that we're starting work
      this.intake.commentOnIssue(
        issueNumber,
        `🤖 **Factory picked up this issue** (agent: \`${this.agentName}\`)\nStarting autonomous work...`
      );

      // Submit task to factory
      const record = this.factory.submitTask(task);

      // Process through the factory pipeline
      // The factory's processNext uses agent integration when useAgent=true
      const result = await this.factory.processNext(
        true,  // useAgent
        this.enablePush && this.createPR  // doPushPR
      );

      const durationMs = Date.now() - startTime;
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`;

      if (result && !result.failed) {
        // Success
        this._stats.completed++;
        console.log(`[IssueWatcher] ✓ Issue #${issueNumber} completed in ${durationStr}`);

        const remediationSummary = this._formatRemediationSummary(result.executionResult);
        const successMsg = [
          `✅ **Factory completed this task** (${durationStr})`,
          '',
          result.pushPRResult?.prUrl
            ? `PR: ${result.pushPRResult.prUrl}`
            : 'Changes committed locally (push/PR not enabled)',
          remediationSummary ? '' : null,
          remediationSummary || null,
          '',
          `Task ID: \`${result.taskId}\``,
        ].filter(Boolean).join('\n');

        this.intake.commentOnIssue(issueNumber, successMsg);

        if (this.autoClose) {
          this.intake.closeIssue(issueNumber, 'Auto-closed by factory after successful completion.');
        }

        if (this.onTaskComplete) {
          try { this.onTaskComplete(issueNumber, result); } catch (_) {}
        }

        return { issueNumber, success: true, result, durationMs };
      } else {
        // Failure
        this._stats.failed++;
        const errorMsg = result?.pushPRError
          || result?.validationResult?.errors?.join('; ')
          || result?.executionResult?.error
          || 'Unknown failure';

        console.log(`[IssueWatcher] ✗ Issue #${issueNumber} failed: ${errorMsg}`);

        const remediationSummary = this._formatRemediationSummary(result?.executionResult);
        const isRebaseConflict = /REBASE_CONFLICT/.test(errorMsg || '');
        const conflictHint = isRebaseConflict
          ? [
              '**Detected rebase conflict while syncing with base branch.**',
              'Autonomous merge was stopped. Please rebase manually or split conflicting changes before retry.',
            ].join('\n')
          : null;

        this.intake.commentOnIssue(
          issueNumber,
          [
            `❌ **Factory failed on this task** (${durationStr})`,
            '',
            `Error: ${errorMsg}`,
            conflictHint ? '' : null,
            conflictHint,
            remediationSummary ? '' : null,
            remediationSummary || null,
            '',
            `Task ID: \`${result?.taskId || 'N/A'}\``,
          ].filter(Boolean).join('\n')
        );

        // Remove in-progress label on failure so it can be retried
        this._removeInProgressLabel(issueNumber);

        if (this.onTaskFail) {
          try { this.onTaskFail(issueNumber, errorMsg); } catch (_) {}
        }

        return { issueNumber, success: false, error: errorMsg, durationMs };
      }
    } catch (err) {
      this._stats.failed++;
      const durationMs = Date.now() - startTime;
      console.error(`[IssueWatcher] ✗ Issue #${issueNumber} threw: ${err.message}`);

      this.intake.commentOnIssue(
        issueNumber,
        `❌ **Factory error** (${((durationMs) / 1000).toFixed(1)}s)\n\nError: ${err.message}`
      );

      this._removeInProgressLabel(issueNumber);

      if (this.onTaskFail) {
        try { this.onTaskFail(issueNumber, err.message); } catch (_) {}
      }

      return { issueNumber, success: false, error: err.message, durationMs };
    } finally {
      this._activeTasks--;
    }
  }

  /**
   * Remove the in-progress label (best-effort)
   */
  _removeInProgressLabel(issueNumber) {
    try {
      const { execSync } = require('child_process');
      execSync(
        `gh issue edit ${issueNumber} --repo ${this.repo} --remove-label "factory-in-progress"`,
        { stdio: 'pipe', timeout: 15000 }
      );
    } catch (_) {
      // best-effort
    }
  }

  _handleSecurityEscalation(payload = {}) {
    const escalation = {
      ...payload,
      ts: payload.ts || new Date().toISOString(),
      watcherRepo: this.repo,
    };

    try {
      fs.mkdirSync(path.dirname(this.securityEscalationLogPath), { recursive: true });
      fs.appendFileSync(this.securityEscalationLogPath, `${JSON.stringify(escalation)}\n`);
    } catch (err) {
      console.warn(`[IssueWatcher] Failed to persist security escalation log: ${err.message}`);
    }

    const issueNumber = payload.issueNumber;
    if (issueNumber) {
      const lines = [
        '🛡️ **Security escalation triggered (push blocked)**',
        '',
        `Reason: ${payload.reason || 'SECURITY_ESCALATION'}`,
        payload.summary ? `Details: ${payload.summary}` : null,
        '',
        'Action required: INFOSEC/RED manual review before push.',
      ].filter(Boolean);
      this.intake.commentOnIssue(issueNumber, lines.join('\n'));
    }
  }

  _formatRemediationSummary(executionResult) {
    const details = executionResult?.healingDetails;
    if (!details) return '';

    const remediations = Array.isArray(details.remediations) ? details.remediations.length : 0;
    const escalations = Array.isArray(details.escalations) ? details.escalations.length : 0;
    const budget = details.budget || null;

    const parts = [];
    if (budget && Number.isFinite(budget.used) && Number.isFinite(budget.max)) {
      parts.push(`retry budget ${budget.used}/${budget.max}`);
    }
    parts.push(`${remediations} remediation attempt(s)`);
    if (escalations > 0) {
      parts.push(`${escalations} escalation event(s)`);
    }

    return parts.length ? `Self-healing: ${parts.join(', ')}` : '';
  }

  /**
   * Get current stats
   */
  stats() {
    return {
      ...this._stats,
      active: this._activeTasks,
      running: this._running,
      processed: this._processedIssues.size,
      stopReason: this.stopReason,
    };
  }
}

module.exports = IssueWatcher;
