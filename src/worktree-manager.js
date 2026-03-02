/**
 * Worktree Manager — create/manage isolated git worktrees per task
 * Phase 1 hardening: metadata persistence + git-backed stale cleanup.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class WorktreeManager {
  constructor(baseRepo, worktreeRoot = './worktrees') {
    this.baseRepo = baseRepo; // path to main repo
    this.worktreeRoot = worktreeRoot;
    this.metaPath = path.join(this.worktreeRoot, '.meta.jsonl');
    this.worktrees = new Map(); // id -> { id, taskId, path, branch, createdAt, status, removedAt? }
    this.loadWorktrees();
  }

  /**
   * Create a new worktree for a task.
   * @param {string} taskId - task UUID
   * @param {string} branch - branch name (default: main)
   * @returns {Object} - worktree record
   */
  create(taskId, branch = 'main') {
    const id = uuidv4();
    const worktreePath = path.join(this.worktreeRoot, id);
    this.ensureWorktreeRoot();

    let resolvedBranch = branch;
    try {
      execFileSync('git', ['-C', this.baseRepo, 'worktree', 'add', worktreePath, branch], {
        stdio: 'pipe',
      });
    } catch (error) {
      const stderr = (error && error.stderr ? error.stderr.toString() : '') || '';
      const alreadyCheckedOut =
        stderr.includes('is already checked out at') ||
        stderr.includes('is already used by worktree at');

      if (!alreadyCheckedOut) {
        throw new Error(`Failed to create worktree: ${error.message}`);
      }

      // If the base branch is already checked out elsewhere, create an isolated
      // task branch from it so the worktree can still be created safely.
      resolvedBranch = this.buildTaskBranch(branch, taskId);
      try {
        execFileSync(
          'git',
          ['-C', this.baseRepo, 'worktree', 'add', '-b', resolvedBranch, worktreePath, branch],
          { stdio: 'pipe' }
        );
      } catch (fallbackError) {
        throw new Error(`Failed to create worktree: ${fallbackError.message}`);
      }
    }

    // Configure git identity in worktree (required for commits in CI)
    try {
      execFileSync('git', ['-C', worktreePath, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' });
      execFileSync('git', ['-C', worktreePath, 'config', 'user.name', 'Test User'], { stdio: 'pipe' });
    } catch (configError) {
      // Non-fatal: log but continue
      console.warn(`Failed to configure git identity in worktree: ${configError.message}`);
    }

    const record = {
      id,
      taskId,
      path: worktreePath,
      branch: resolvedBranch,
      baseBranch: branch,
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    this.worktrees.set(id, record);
    this.persistWorktrees();
    return record;
  }


  buildTaskBranch(baseBranch, taskId) {
    const safeTaskId = String(taskId).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return `factory/${baseBranch}/${safeTaskId}`;
  }

  /**
   * Get worktree by id.
   */
  get(id) {
    return this.worktrees.get(id);
  }

  /**
   * Get active worktree by taskId.
   */
  getByTaskId(taskId) {
    for (const wt of this.worktrees.values()) {
      if (wt.taskId === taskId && wt.status === 'active') return wt;
    }
    return null;
  }

  /**
   * Remove a worktree (cleanup).
   */
  remove(id) {
    const wt = this.worktrees.get(id);
    if (!wt) throw new Error(`Worktree ${id} not found`);

    try {
      execFileSync('git', ['-C', this.baseRepo, 'worktree', 'remove', wt.path], {
        stdio: 'pipe',
      });
      wt.status = 'removed';
      wt.removedAt = new Date().toISOString();
      this.persistWorktrees();
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error.message}`);
    }
  }

  /**
   * List all tracked worktrees.
   */
  list(filter = {}) {
    return Array.from(this.worktrees.values()).filter((wt) => {
      if (filter.status && wt.status !== filter.status) return false;
      if (filter.taskId && wt.taskId !== filter.taskId) return false;
      return true;
    });
  }

  /**
   * Query git for authoritative worktree registration.
   * Returns absolute worktree paths that git currently knows about.
   */
  listFromGit() {
    const output = execFileSync('git', ['-C', this.baseRepo, 'worktree', 'list', '--porcelain'], {
      stdio: 'pipe',
    }).toString();

    const lines = output.split('\n');
    const paths = new Set();
    for (const line of lines) {
      if (!line.startsWith('worktree ')) continue;
      const worktreePath = line.slice('worktree '.length).trim();
      if (worktreePath) paths.add(path.resolve(worktreePath));
    }
    return paths;
  }

  /**
   * Reconcile tracked records against git worktree registration.
   * Marks missing active entries as stale and prunes stale directories.
   */
  cleanupStale() {
    const gitPaths = this.listFromGit();
    const repoMainPath = path.resolve(this.baseRepo);
    const rootPath = path.resolve(this.worktreeRoot);

    let staleMarked = 0;
    let dirsPruned = 0;

    for (const wt of this.worktrees.values()) {
      if (wt.status !== 'active') continue;
      const trackedPath = path.resolve(wt.path);
      if (gitPaths.has(trackedPath)) continue;

      wt.status = 'stale';
      wt.removedAt = new Date().toISOString();
      staleMarked += 1;

      const canPrune =
        trackedPath.startsWith(rootPath + path.sep) &&
        trackedPath !== repoMainPath &&
        fs.existsSync(trackedPath);
      if (canPrune) {
        fs.rmSync(trackedPath, { recursive: true, force: true });
        dirsPruned += 1;
      }
    }

    if (staleMarked > 0) {
      this.persistWorktrees();
    }

    return { staleMarked, dirsPruned };
  }

  ensureWorktreeRoot() {
    if (!fs.existsSync(this.worktreeRoot)) {
      fs.mkdirSync(this.worktreeRoot, { recursive: true });
    }
  }

  /**
   * Persist worktrees to disk.
   */
  persistWorktrees() {
    this.ensureWorktreeRoot();
    const lines = Array.from(this.worktrees.values()).map((wt) => JSON.stringify(wt));
    fs.writeFileSync(this.metaPath, lines.join('\n') + '\n');
  }

  /**
   * Load worktrees from disk.
   */
  loadWorktrees() {
    if (!fs.existsSync(this.metaPath)) return;
    const content = fs.readFileSync(this.metaPath, 'utf8').trim();
    if (!content) return;

    const lines = content.split('\n').filter((l) => l);
    lines.forEach((line) => {
      try {
        const wt = JSON.parse(line);
        this.worktrees.set(wt.id, wt);
      } catch (e) {
        console.error(`Failed to parse worktree line: ${line}`, e);
      }
    });
  }
}

module.exports = WorktreeManager;
