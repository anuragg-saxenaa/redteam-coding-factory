/**
 * WorktreeManager — Phase 1: Git Worktree Lifecycle
 *
 * Production-hardened:
 *   #4  Git identity (user.name / user.email) is configured from environment
 *       variables inside every new worktree so commits are attributed to the
 *       correct author, not to whatever global git config happens to exist on
 *       the host machine.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ── FIX #4: read git identity from env vars, fall back to sensible defaults ─
const GIT_AUTHOR_NAME  = process.env.GIT_AUTHOR_NAME  || process.env.GITHUB_ACTOR      || 'RedTeam Coding Factory';
const GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || process.env.GITHUB_ACTOR_EMAIL || 'redteam-bot@openclaw.io';

const METADATA_FILE = 'worktree-meta.json';

class WorktreeManager {
  /**
   * @param {string} baseRepo    - absolute path to the bare/main git repo
   * @param {string} worktreeRoot- parent directory where worktrees are created
   */
  constructor(baseRepo, worktreeRoot) {
    this.baseRepo     = baseRepo     || process.cwd();
    this.worktreeRoot = worktreeRoot || path.join(process.cwd(), 'worktrees');
    this._worktrees   = new Map();   // id → worktreeRecord

    fs.mkdirSync(this.worktreeRoot, { recursive: true });
    this._loadMetadata();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Create an isolated git worktree for a task.
   * FIX #4: sets user.name / user.email inside the worktree.
   */
  create(taskId, branch = 'main', meta = {}) {
    const id           = uuidv4();
    const worktreeName = `task-${taskId}-${id.slice(0, 8)}`;
    const worktreePath = path.join(this.worktreeRoot, worktreeName);
    const newBranch    = `task/${taskId}/${id.slice(0, 8)}`;

    // Create the worktree on a new branch from origin/<branch>
    try {
      execFileSync('git', [
        '-C', this.baseRepo, 'worktree', 'add',
        '-b', newBranch, worktreePath, `origin/${branch}`,
      ], { stdio: 'pipe' });
    } catch (err) {
      // Fallback: branch without the origin/ prefix (e.g. local repos)
      execFileSync('git', [
        '-C', this.baseRepo, 'worktree', 'add',
        '-b', newBranch, worktreePath, branch,
      ], { stdio: 'pipe' });
    }

    // ── FIX #4: stamp git identity into the new worktree ─────────────────
    try {
      execFileSync('git', ['-C', worktreePath, 'config', 'user.email', GIT_AUTHOR_EMAIL], { stdio: 'pipe' });
      execFileSync('git', ['-C', worktreePath, 'config', 'user.name',  GIT_AUTHOR_NAME],  { stdio: 'pipe' });
    } catch (e) {
      console.warn(`[WorktreeManager] Could not set git identity in ${worktreePath}: ${e.message}`);
    }

    const record = {
      id,
      taskId,
      path      : worktreePath,
      branch    : newBranch,
      baseBranch: branch,
      createdAt : new Date().toISOString(),
      status    : 'active',
      ...meta,
    };

    this._worktrees.set(id, record);
    this._saveMetadata();
    return record;
  }

  getByTaskId(taskId) {
    return Array.from(this._worktrees.values()).find(w => w.taskId === taskId) || null;
  }

  get(id) {
    return this._worktrees.get(id) || null;
  }

  list() {
    return Array.from(this._worktrees.values());
  }

  remove(id, { force = false } = {}) {
    const record = this._worktrees.get(id);
    if (!record) return;

    try {
      execFileSync('git', ['-C', this.baseRepo, 'worktree', 'remove', ...(force ? ['--force'] : []), record.path], { stdio: 'pipe' });
    } catch (e) {
      if (!force) throw e;
      try { fs.rmdirSync(record.path, { recursive: true }); } catch (_) {}
    }

    // Also delete the branch
    try {
      execFileSync('git', ['-C', this.baseRepo, 'branch', '-D', record.branch], { stdio: 'pipe' });
    } catch (_) {}

    record.status   = 'removed';
    record.removedAt = new Date().toISOString();
    this._worktrees.set(id, record);
    this._saveMetadata();
  }

  /**
   * Mark worktrees whose processes are no longer alive as stale.
   * Returns { staleMarked, dirsPruned }.
   */
  cleanupStale() {
    let staleMarked = 0;
    let dirsPruned  = 0;

    for (const [id, record] of this._worktrees) {
      if (record.status === 'stale') {
        record.removedAt = record.removedAt || new Date().toISOString();
        try { fs.rmdirSync(record.path, { recursive: true }); dirsPruned++; } catch (_) {}
        continue;
      }
      // Mark active worktrees whose directory no longer exists as stale
      if (record.status === 'active' && !fs.existsSync(record.path)) {
        record.status    = 'stale';
        record.removedAt = new Date().toISOString();
        staleMarked++;
      }
    }

    this._saveMetadata();

    // Also ask git to prune its internal worktree references
    try {
      execFileSync('git', ['-C', this.baseRepo, 'worktree', 'prune'], { stdio: 'pipe' });
    } catch (_) {}

    return { staleMarked, dirsPruned };
  }

  /**
   * Prune managed worktrees older than olderThanMs.
   */
  pruneManaged({ olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
    const cutoff  = Date.now() - olderThanMs;
    let prunedRecords = 0;
    for (const [id, record] of this._worktrees) {
      const ts = record.removedAt
        ? new Date(record.removedAt).getTime()
        : new Date(record.createdAt).getTime();
      if (ts < cutoff) {
        this._worktrees.delete(id);
        prunedRecords++;
      }
    }
    this._saveMetadata();
    return { prunedRecords };
  }

  // ── Metadata persistence ───────────────────────────────────────────────

  _metaPath() {
    return path.join(this.worktreeRoot, METADATA_FILE);
  }

  _saveMetadata() {
    try {
      const data = JSON.stringify(Array.from(this._worktrees.entries()), null, 2);
      fs.writeFileSync(this._metaPath(), data, 'utf8');
    } catch (e) {
      console.warn(`[WorktreeManager] Could not save metadata: ${e.message}`);
    }
  }

  persistWorktrees() {
    this._saveMetadata();
  }

  _loadMetadata() {
    const mp = this._metaPath();
    if (!fs.existsSync(mp)) return;
    try {
      const entries = JSON.parse(fs.readFileSync(mp, 'utf8'));
      for (const [id, record] of entries) {
        this._worktrees.set(id, record);
      }
    } catch (e) {
      console.warn(`[WorktreeManager] Could not load metadata (starting fresh): ${e.message}`);
    }
  }
}

module.exports = WorktreeManager;
