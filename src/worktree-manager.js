/**
 * Worktree Manager — create/manage isolated git worktrees per task
 * Phase 1: Simple worktree lifecycle (create, use, cleanup)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

class WorktreeManager {
  constructor(baseRepo, worktreeRoot = './worktrees') {
    this.baseRepo = baseRepo; // path to main repo
    this.worktreeRoot = worktreeRoot;
    this.worktrees = new Map(); // id → { id, taskId, path, branch, createdAt, status }
    this.loadWorktrees();
  }

  /**
   * Create a new worktree for a task
   * @param {string} taskId - task UUID
   * @param {string} branch - branch name (default: main)
   * @returns {Object} - { id, path, branch, createdAt }
   */
  create(taskId, branch = 'main') {
    const id = uuidv4();
    const worktreePath = path.join(this.worktreeRoot, id);

    // Ensure worktree root exists
    if (!fs.existsSync(this.worktreeRoot)) {
      fs.mkdirSync(this.worktreeRoot, { recursive: true });
    }

    try {
      // Create worktree from base repo
      execSync(`git -C ${this.baseRepo} worktree add ${worktreePath} ${branch}`, {
        stdio: 'pipe',
      });

      const record = {
        id,
        taskId,
        path: worktreePath,
        branch,
        createdAt: new Date().toISOString(),
        status: 'active',
      };

      this.worktrees.set(id, record);
      this.persistWorktrees();
      return record;
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error.message}`);
    }
  }

  /**
   * Get worktree by id
   */
  get(id) {
    return this.worktrees.get(id);
  }

  /**
   * Get worktree by taskId
   */
  getByTaskId(taskId) {
    for (const wt of this.worktrees.values()) {
      if (wt.taskId === taskId) return wt;
    }
    return null;
  }

  /**
   * Remove a worktree (cleanup)
   */
  remove(id) {
    const wt = this.worktrees.get(id);
    if (!wt) throw new Error(`Worktree ${id} not found`);

    try {
      execSync(`git -C ${this.baseRepo} worktree remove ${wt.path}`, {
        stdio: 'pipe',
      });
      wt.status = 'removed';
      this.persistWorktrees();
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error.message}`);
    }
  }

  /**
   * List all worktrees
   */
  list(filter = {}) {
    return Array.from(this.worktrees.values()).filter(wt => {
      if (filter.status && wt.status !== filter.status) return false;
      if (filter.taskId && wt.taskId !== filter.taskId) return false;
      return true;
    });
  }

  /**
   * Persist worktrees to disk
   */
  persistWorktrees() {
    const dir = path.dirname(this.worktreeRoot);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const metaPath = path.join(this.worktreeRoot, '.meta.jsonl');
    const lines = Array.from(this.worktrees.values()).map(wt => JSON.stringify(wt));
    fs.writeFileSync(metaPath, lines.join('\n') + '\n');
  }

  /**
   * Load worktrees from disk
   */
  loadWorktrees() {
    const metaPath = path.join(this.worktreeRoot, '.meta.jsonl');
    if (!fs.existsSync(metaPath)) return;
    const content = fs.readFileSync(metaPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    lines.forEach(line => {
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
