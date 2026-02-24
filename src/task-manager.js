/**
 * Task Manager — intake, queue, and dispatch coding tasks
 * Phase 1: Simple in-memory queue with file persistence
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TaskManager {
  constructor(queuePath = './data/task-queue.jsonl') {
    this.queuePath = queuePath;
    this.tasks = new Map(); // id → task
    this.queue = []; // [id, id, ...] in order
    this.loadQueue();
  }

  /**
   * Intake a new task
   * @param {Object} task - { title, description, repo, branch?, assignee? }
   * @returns {Object} - { id, status, createdAt, ... }
   */
  intake(task) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const record = {
      id,
      title: task.title,
      description: task.description,
      repo: task.repo,
      branch: task.branch || null,
      assignee: task.assignee || 'unassigned',
      status: 'queued', // queued → in_progress → completed → failed
      createdAt: now,
      startedAt: null,
      completedAt: null,
      error: null,
      worktreeId: null,
    };
    this.tasks.set(id, record);
    this.queue.push(id);
    this.persistQueue();
    return record;
  }

  /**
   * Get next task from queue
   * @returns {Object|null}
   */
  next() {
    while (this.queue.length > 0) {
      const id = this.queue[0];
      const task = this.tasks.get(id);
      if (task && task.status === 'queued') {
        return task;
      }
      this.queue.shift(); // skip non-queued
    }
    return null;
  }

  /**
   * Mark task as in_progress
   */
  start(id, worktreeId) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();
    task.worktreeId = worktreeId;
    this.persistQueue();
  }

  /**
   * Mark task as completed
   */
  complete(id, result) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    this.persistQueue();
  }

  /**
   * Mark task as failed
   */
  fail(id, error) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;
    this.persistQueue();
  }

  /**
   * Persist queue to disk (JSONL format)
   */
  persistQueue() {
    const dir = path.dirname(this.queuePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lines = Array.from(this.tasks.values()).map(t => JSON.stringify(t));
    fs.writeFileSync(this.queuePath, lines.join('\n') + '\n');
  }

  /**
   * Load queue from disk
   */
  loadQueue() {
    if (!fs.existsSync(this.queuePath)) return;
    const content = fs.readFileSync(this.queuePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);
    lines.forEach(line => {
      try {
        const task = JSON.parse(line);
        this.tasks.set(task.id, task);
        if (task.status === 'queued') this.queue.push(task.id);
      } catch (e) {
        console.error(`Failed to parse task line: ${line}`, e);
      }
    });
  }

  /**
   * Get task by id
   */
  get(id) {
    return this.tasks.get(id);
  }

  /**
   * List all tasks
   */
  list(filter = {}) {
    return Array.from(this.tasks.values()).filter(t => {
      if (filter.status && t.status !== filter.status) return false;
      return true;
    });
  }
}

module.exports = TaskManager;
