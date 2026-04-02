/**
 * Issue Watcher — autonomous GitHub issue polling and task dispatch
 *
 * Production-hardened:
 *   #9  Circuit breaker: after consecutive GitHub API errors the watcher
 *       backs off exponentially (up to 1 h) before retrying, preventing
 *       rate-limit bans and API abuse.
 *   #10 File-based lock: only one instance can poll at a time.  A second
 *       process that starts while the lock is held skips the cycle cleanly,
 *       eliminating duplicate PRs from rolling deploys or multi-instance runs.
 *
 * Existing behaviour preserved:
 *   - Polls configured repos on a configurable interval (default 15 min)
 *   - Classifies issues as fixable/skip based on labels, title heuristics
 *   - Submits fixable issues to the factory as tasks
 *   - Runs periodic worktree maintenance
 *   - Emits structured logs for every significant event
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const http   = require('http');

// ---------------------------------------------------------------------------
// Tiny lock helper (no external deps)
// ---------------------------------------------------------------------------
class FileLock {
  constructor(lockPath) {
    this.lockPath = lockPath;
    this._held    = false;
  }

  /** Try to acquire the lock. Returns true if acquired, false if already held. */
  tryAcquire() {
    try {
      // O_EXCL + O_CREAT = atomic create-or-fail; fails if file exists
      const fd = fs.openSync(this.lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      this._held = true;
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        // Check if the owning process is still alive; if not, steal the lock
        try {
          const pid = parseInt(fs.readFileSync(this.lockPath, 'utf8').trim(), 10);
          if (pid && pid !== process.pid) {
            try { process.kill(pid, 0); return false; } // still alive
            catch (_) { /* dead process — steal */ }
          }
          // Stale lock — steal it
          fs.writeFileSync(this.lockPath, String(process.pid));
          this._held = true;
          return true;
        } catch (_) {
          return false;
        }
      }
      return false;
    }
  }

  release() {
    if (!this._held) return;
    try { fs.unlinkSync(this.lockPath); } catch (_) {}
    this._held = false;
  }
}

// ---------------------------------------------------------------------------
// Tiny fetch helper (no external deps beyond built-in https/http)
// ---------------------------------------------------------------------------
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const mod     = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      path    : parsed.pathname + (parsed.search || ''),
      method  : options.method || 'GET',
      headers : {
        'User-Agent'   : 'RedTeam-Factory/1.0',
        'Accept'       : 'application/vnd.github.v3+json',
        'Content-Type' : 'application/json',
        ...(options.headers || {}),
      },
      timeout : options.timeout || 15_000,
    };

    if (process.env.GITHUB_TOKEN) {
      reqOpts.headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const req = mod.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.on('error',   reject);

    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// IssueWatcher
// ---------------------------------------------------------------------------
const DEFAULT_POLL_INTERVAL_MS    = 15 * 60 * 1000;  // 15 min
const MAINTENANCE_INTERVAL_CYCLES = 4;                // every 4 poll cycles

class IssueWatcher {
  constructor(factory, config = {}) {
    this.factory         = factory;
    this.repo            = config.repo            || '';
    this.dataDir         = config.dataDir         || (factory.dataDir || './data');
    this.pollIntervalMs  = config.pollIntervalMs  || DEFAULT_POLL_INTERVAL_MS;
    this.skipLabels      = config.skipLabels      || ['wontfix', 'invalid', 'duplicate', 'factory/in-progress', 'factory/done'];
    this.fixLabels       = config.fixLabels       || ['good first issue', 'help wanted', 'bug', 'factory/fixable'];
    this.maxOpenTasks    = config.maxOpenTasks    || 5;
    this._isFixableOverride = config.isFixable    || null;
    this.onPollError     = config.onPollError     || null;
    this.onTaskSubmit    = config.onTaskSubmit    || null;

    this._timer          = null;
    this._running        = false;
    this._cycleCount     = 0;
    this._processedIssues= new Set();

    // ── FIX #9: circuit breaker state ─────────────────────────────────
    this._cbErrorCount   = 0;
    this._cbBackoffUntil = 0;
    this._cbMaxErrors    = 5;
    this._cbMaxBackoffMs = 60 * 60 * 1000;

    // ── FIX #10: file-based lock ────────────────────────────────────
    fs.mkdirSync(this.dataDir, { recursive: true });
    this._lock = new FileLock(path.join(this.dataDir, 'issue-watcher.lock'));
  }

  // ── Public API ───────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    console.log(`[IssueWatcher] Starting — repo=${this.repo} interval=${this.pollIntervalMs}ms`);
    this._scheduleNext(0);
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._lock.release();
    console.log('[IssueWatcher] Stopped');
  }

  getStats() {
    return {
      repo            : this.repo,
      running         : this._running,
      cycleCount      : this._cycleCount,
      processedIssues : this._processedIssues.size,
      cbErrorCount    : this._cbErrorCount,
      cbBackoffUntil  : this._cbBackoffUntil ? new Date(this._cbBackoffUntil).toISOString() : null,
      cbOpen          : Date.now() < this._cbBackoffUntil,
    };
  }

  // ── Scheduling ───────────────────────────────────────────────

  _scheduleNext(delayMs) {
    if (!this._running) return;
    this._timer = setTimeout(() => this._pollCycle(), delayMs);
  }

  async _pollCycle() {
    if (!this._running) return;
    this._cycleCount++;

    // ── FIX #9: circuit breaker check ───────────────────────────────
    if (Date.now() < this._cbBackoffUntil) {
      const waitSec = Math.round((this._cbBackoffUntil - Date.now()) / 1000);
      console.warn(`[IssueWatcher] Circuit OPEN — backing off for ${waitSec}s more`);
      this._scheduleNext(Math.min(this._cbBackoffUntil - Date.now(), this.pollIntervalMs));
      return;
    }

    // ── FIX #10: try to acquire the file-based lock ──────────────────
    if (!this._lock.tryAcquire()) {
      console.warn('[IssueWatcher] Lock held by another process — skipping cycle');
      this._scheduleNext(this.pollIntervalMs);
      return;
    }

    try {
      await this._doPoll();
      // Success — reset circuit breaker
      this._cbErrorCount   = 0;
      this._cbBackoffUntil = 0;
    } catch (err) {
      this._handlePollError(err);
    } finally {
      this._lock.release();
    }

    // Periodic maintenance (pruning stale worktrees, etc.)
    if (this._cycleCount % MAINTENANCE_INTERVAL_CYCLES === 0) {
      this._runMaintenance();
    }

    this._scheduleNext(this.pollIntervalMs);
  }

  // ── FIX #9: error handler with exponential backoff ─────────────────
  _handlePollError(err) {
    this._cbErrorCount++;
    const isApiError = err.status >= 400 || /rate.?limit|403|401|API/i.test(err.message || '');
    if (isApiError || this._cbErrorCount >= this._cbMaxErrors) {
      const backoffMs = Math.min(
        60_000 * Math.pow(2, this._cbErrorCount - 1),
        this._cbMaxBackoffMs
      );
      this._cbBackoffUntil = Date.now() + backoffMs;
      console.error(`[IssueWatcher] API error #${this._cbErrorCount} — circuit OPEN for ${Math.round(backoffMs / 1000)}s: ${err.message}`);
    } else {
      console.error(`[IssueWatcher] Poll error (${this._cbErrorCount}/${this._cbMaxErrors}): ${err.message}`);
    }
    if (this.onPollError) { try { this.onPollError(err); } catch (_) {} }
  }

  // ── Core poll logic ──────────────────────────────────────────────

  async _doPoll() {
    if (!this.repo) throw new Error('[IssueWatcher] No repo configured');

    const [owner, repoName] = this.repo.split('/');
    if (!owner || !repoName) throw new Error(`[IssueWatcher] Invalid repo format: ${this.repo} (expected owner/repo)`);

    const apiBase = `https://api.github.com/repos/${owner}/${repoName}`;
    console.log(`[IssueWatcher] Polling ${this.repo} (cycle ${this._cycleCount})…`);

    // Fetch open issues
    const res = await fetchJSON(`${apiBase}/issues?state=open&per_page=50&sort=created&direction=asc`);
    if (res.status !== 200) {
      const err = new Error(`GitHub API returned ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const issues = Array.isArray(res.body) ? res.body : [];
    console.log(`[IssueWatcher] Fetched ${issues.length} open issues from ${this.repo}`);

    // Check how many factory tasks are currently open
    const openTasks = this.factory.taskManager
      ? this.factory.taskManager.list().filter(t => t.status === 'queued' || t.status === 'in_progress').length
      : 0;

    let submitted = 0;
    for (const issue of issues) {
      if (!this._running) break;
      if (openTasks + submitted >= this.maxOpenTasks) {
        console.log(`[IssueWatcher] Open task cap (${this.maxOpenTasks}) reached — skipping remaining issues`);
        break;
      }

      const issueKey = `${this.repo}#${issue.number}`;
      if (this._processedIssues.has(issueKey)) continue;

      const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));

      // Skip if a skip label is present
      if (labels.some(l => this.skipLabels.includes(l.toLowerCase()))) {
        this._processedIssues.add(issueKey);
        continue;
      }

      // Check fixability
      const fixable = this._isFixableOverride
        ? this._isFixableOverride(issue, labels)
        : this._defaultIsFixable(issue, labels);

      if (!fixable) {
        this._processedIssues.add(issueKey);
        continue;
      }

      // Submit task
      const task = {
        title      : `Fix: ${issue.title}`,
        description: issue.body || '',
        repo       : this.repo,
        branch     : 'main',
        labels     : [...labels, 'factory/in-progress'],
        metadata   : { issueNumber: issue.number, issueUrl: issue.html_url, issueKey },
      };

      try {
        const submitted_task = this.factory.submitTask
          ? this.factory.submitTask(task)
          : this.factory.taskManager?.intake(task);
        this._processedIssues.add(issueKey);
        submitted++;
        console.log(`[IssueWatcher] Submitted task for issue #${issue.number}: ${issue.title}`);
        if (this.onTaskSubmit) { try { this.onTaskSubmit(submitted_task, issue); } catch (_) {} }

        // Label the issue so we don't pick it up again on next poll
        await this._labelIssue(owner, repoName, issue.number, 'factory/in-progress').catch(() => {});
      } catch (submitErr) {
        console.error(`[IssueWatcher] Failed to submit task for issue #${issue.number}: ${submitErr.message}`);
      }
    }

    if (submitted > 0) {
      console.log(`[IssueWatcher] Submitted ${submitted} tasks this cycle`);
    }
  }

  _defaultIsFixable(issue, labels) {
    // Skip pull requests (GitHub returns them in /issues)
    if (issue.pull_request) return false;
    // Fixable if any fix label is present
    if (labels.some(l => this.fixLabels.includes(l.toLowerCase()))) return true;
    // Fixable if title matches common bug/fix patterns
    return /\b(bug|fix|error|crash|broken|fail|issue|problem)\b/i.test(issue.title || '');
  }

  async _labelIssue(owner, repo, issueNumber, label) {
    await fetchJSON(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      { method: 'POST', body: { labels: [label] } }
    );
  }

  _runMaintenance() {
    try {
      if (this.factory.worktreeManager?.pruneManaged) {
        this.factory.worktreeManager.pruneManaged({ olderThanMs: 24 * 60 * 60 * 1000 });
        console.log('[IssueWatcher] Maintenance: pruned old worktrees');
      }
    } catch (e) {
      console.warn(`[IssueWatcher] Maintenance error (non-fatal): ${e.message}`);
    }
  }
}

module.exports = IssueWatcher;
