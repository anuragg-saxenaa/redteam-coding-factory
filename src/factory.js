/**
 * Coding Factory Orchestrator — Phase 1 POC
 * Coordinates task intake, worktree creation, and execution
 */

const TaskManager = require('./task-manager');
const WorktreeManager = require('./worktree-manager');
const path = require('path');

class CodingFactory {
  constructor(config = {}) {
    this.baseRepo = config.baseRepo || process.cwd();
    this.dataDir = config.dataDir || './data';
    this.worktreeRoot = config.worktreeRoot || './worktrees';

    this.taskManager = new TaskManager(path.join(this.dataDir, 'task-queue.jsonl'));
    this.worktreeManager = new WorktreeManager(this.baseRepo, this.worktreeRoot);
  }

  /**
   * Submit a new task to the factory
   * @param {Object} task - { title, description, repo, branch?, assignee? }
   * @returns {Object} - task record
   */
  submitTask(task) {
    const record = this.taskManager.intake(task);
    console.log(`[Factory] Task intake: ${record.id} — ${task.title}`);
    return record;
  }

  /**
   * Process next task in queue
   * Phase 1: create worktree, mark as in_progress
   * (actual code execution comes in Phase 2)
   */
  async processNext() {
    const task = this.taskManager.next();
    if (!task) {
      console.log('[Factory] No tasks in queue');
      return null;
    }

    console.log(`[Factory] Processing task: ${task.id} — ${task.title}`);

    try {
      // Create isolated worktree
      const wt = this.worktreeManager.create(task.id, task.branch || 'main');
      console.log(`[Factory] Created worktree: ${wt.id} at ${wt.path}`);

      // Mark task as in_progress
      this.taskManager.start(task.id, wt.id);
      console.log(`[Factory] Task ${task.id} now in_progress`);

      return {
        taskId: task.id,
        worktreeId: wt.id,
        worktreePath: wt.path,
      };
    } catch (error) {
      console.error(`[Factory] Error processing task ${task.id}:`, error.message);
      this.taskManager.fail(task.id, error.message);
      return null;
    }
  }

  /**
   * Complete a task
   */
  completeTask(taskId, result) {
    this.taskManager.complete(taskId, result);
    const task = this.taskManager.get(taskId);
    if (task && task.worktreeId) {
      this.worktreeManager.remove(task.worktreeId);
      console.log(`[Factory] Cleaned up worktree: ${task.worktreeId}`);
    }
    console.log(`[Factory] Task ${taskId} completed`);
  }

  /**
   * Fail a task
   */
  failTask(taskId, error) {
    this.taskManager.fail(taskId, error);
    const task = this.taskManager.get(taskId);
    if (task && task.worktreeId) {
      this.worktreeManager.remove(task.worktreeId);
      console.log(`[Factory] Cleaned up worktree: ${task.worktreeId}`);
    }
    console.log(`[Factory] Task ${taskId} failed: ${error}`);
  }

  /**
   * Get factory status
   */
  status() {
    const tasks = this.taskManager.list();
    const queued = tasks.filter(t => t.status === 'queued').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;

    return {
      queued,
      inProgress,
      completed,
      failed,
      total: tasks.length,
      worktrees: this.worktreeManager.list().length,
    };
  }
}

module.exports = CodingFactory;
