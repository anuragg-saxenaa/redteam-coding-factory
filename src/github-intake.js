/**
 * GitHub Issues Intake — Phase 2
 *
 * Pulls open issues from a GitHub repository using the `gh` CLI
 * and converts them into factory task records.
 *
 * Supports:
 *  - Filtering by label (e.g. "factory-ready", "bug")
 *  - Filtering by assignee
 *  - Auto-claiming issues (adds "in-progress" label)
 *  - Deduplication against already-queued tasks
 */

const { execSync } = require('child_process');

class GitHubIntake {
  /**
   * @param {Object} options
   * @param {string} options.repo       - owner/repo (e.g. "anuragg-saxenaa/redteam-coding-factory")
   * @param {string} options.label      - Filter issues by label (default: "factory-ready")
   * @param {string} options.assignee   - Filter by assignee (optional)
   * @param {number} options.limit      - Max issues to fetch per poll (default: 5)
   * @param {string} options.claimLabel - Label to add when claiming (default: "factory-in-progress")
   * @param {boolean} options.autoClaim - Whether to add claimLabel on intake (default: true)
   * @param {string} options.ghPath     - Path to gh CLI (default: "gh")
   */
  constructor(options = {}) {
    this.repo = options.repo;
    this.label = options.label || 'factory-ready';
    this.assignee = options.assignee || '';
    this.limit = options.limit || 5;
    this.claimLabel = options.claimLabel || 'factory-in-progress';
    this.autoClaim = options.autoClaim !== false;
    this.ghPath = options.ghPath || 'gh';
    this._claimed = new Set(); // issue numbers already claimed this session
  }

  /**
   * Fetch open issues matching filters
   * @returns {Array<Object>} - raw GitHub issue objects
   */
  fetchIssues() {
    if (!this.repo) throw new Error('github-intake: repo is required');

    const filters = [
      `--repo ${this.repo}`,
      `--label "${this.label}"`,
      '--state open',
      `--limit ${this.limit}`,
      '--json number,title,body,labels,assignees,url',
    ];

    if (this.assignee) {
      filters.push(`--assignee "${this.assignee}"`);
    }

    const cmd = `${this.ghPath} issue list ${filters.join(' ')}`;
    console.log(`[GitHubIntake] Fetching issues: ${cmd}`);

    try {
      const raw = execSync(cmd, { stdio: 'pipe', timeout: 30000 }).toString();
      const issues = JSON.parse(raw);
      console.log(`[GitHubIntake] Found ${issues.length} issues`);
      return issues;
    } catch (err) {
      console.error(`[GitHubIntake] gh issue list failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Convert a GitHub issue to a factory task record
   * @param {Object} issue - GitHub issue object
   * @param {string} repoPath - Local path to the repo
   * @param {string} branch - Branch to work on (default: "main")
   * @returns {Object} - factory task
   */
  issueToTask(issue, repoPath, branch = 'main') {
    return {
      title: `GH-${issue.number}: ${issue.title}`,
      description: (issue.body || '').substring(0, 2000),
      repo: repoPath,
      branch,
      metadata: {
        source: 'github',
        issueNumber: issue.number,
        issueUrl: issue.url,
        labels: (issue.labels || []).map(l => l.name || l),
      },
    };
  }

  /**
   * Claim an issue by adding the in-progress label
   * @param {number} issueNumber
   */
  claimIssue(issueNumber) {
    if (this._claimed.has(issueNumber)) return;

    try {
      execSync(
        `${this.ghPath} issue edit ${issueNumber} --repo ${this.repo} --add-label "${this.claimLabel}"`,
        { stdio: 'pipe', timeout: 15000 }
      );
      this._claimed.add(issueNumber);
      console.log(`[GitHubIntake] Claimed issue #${issueNumber} (added label: ${this.claimLabel})`);
    } catch (err) {
      console.warn(`[GitHubIntake] Failed to claim issue #${issueNumber}: ${err.message}`);
    }
  }

  /**
   * Comment on an issue (e.g. to report status)
   * @param {number} issueNumber
   * @param {string} body
   */
  commentOnIssue(issueNumber, body) {
    try {
      execSync(
        `${this.ghPath} issue comment ${issueNumber} --repo ${this.repo} --body "${body.replace(/"/g, '\\"')}"`,
        { stdio: 'pipe', timeout: 15000 }
      );
      console.log(`[GitHubIntake] Commented on issue #${issueNumber}`);
    } catch (err) {
      console.warn(`[GitHubIntake] Failed to comment on issue #${issueNumber}: ${err.message}`);
    }
  }

  /**
   * Close an issue after successful completion
   * @param {number} issueNumber
   * @param {string} reason - optional closing comment
   */
  closeIssue(issueNumber, reason = '') {
    try {
      if (reason) {
        this.commentOnIssue(issueNumber, reason);
      }
      execSync(
        `${this.ghPath} issue close ${issueNumber} --repo ${this.repo}`,
        { stdio: 'pipe', timeout: 15000 }
      );
      console.log(`[GitHubIntake] Closed issue #${issueNumber}`);
    } catch (err) {
      console.warn(`[GitHubIntake] Failed to close issue #${issueNumber}: ${err.message}`);
    }
  }

  /**
   * Poll for new issues, convert to tasks, and optionally claim them.
   * Skips issues already claimed this session.
   *
   * @param {string} repoPath - Local repo path
   * @param {string} branch - Branch to target
   * @returns {Array<Object>} - factory task records (ready for factory.submitTask())
   */
  poll(repoPath, branch = 'main') {
    const issues = this.fetchIssues();
    const tasks = [];

    for (const issue of issues) {
      if (this._claimed.has(issue.number)) {
        console.log(`[GitHubIntake] Skipping already-claimed issue #${issue.number}`);
        continue;
      }

      // Skip issues that already have the in-progress label
      const labels = (issue.labels || []).map(l => l.name || l);
      if (labels.includes(this.claimLabel)) {
        console.log(`[GitHubIntake] Skipping issue #${issue.number} (already in-progress)`);
        continue;
      }

      const task = this.issueToTask(issue, repoPath, branch);
      tasks.push(task);

      if (this.autoClaim) {
        this.claimIssue(issue.number);
      }
    }

    console.log(`[GitHubIntake] Returning ${tasks.length} new tasks`);
    return tasks;
  }

  /**
   * Check if gh CLI is authenticated
   * @returns {boolean}
   */
  isAuthenticated() {
    try {
      execSync(`${this.ghPath} auth status`, { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

// ESM default export — enables: import Factory from './github-intake.js'
export default GitHubIntake;
export { GitHubIntake };