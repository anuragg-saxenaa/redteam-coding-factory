/**
 * Task Manager — intake, queue, and dispatch coding tasks
 *
 * Production-hardened:
 *   #11 Atomic writes: all queue flushes go to a .tmp file then renamed,
 *       so a mid-write crash can never leave the queue corrupted.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TaskManager {
  constructor(queuePath = './data/task-queue.jsonl') {
    this.queuePath = queuePath;
    this.tasks     = new Map();
    this.queue     = [];
    this.loadQueue();
  }

  intake(task) {
    const id  = uuidv4();
    const now = new Date().toISOString();
    const record = {
      id,
      title      : task.title,
      description: task.description,
      repo       : task.repo,
      branch     : task.branch    || null,
      assignee   : task.assignee  || 'unassigned',
      owner      : task.owner     || null,
      ticketId   : task.ticketId  || null,
      labels     : task.labels    || [],
      metadata   : task.metadata  || {},
      status     : 'queued',
      createdAt  : now,
      startedAt  : null,
      completedAt: null,
      error      : null,
      worktreeId : null,
    };
    this.tasks.set(id, record);
    this.queue.push(id);
    this.persistQueue();
    return record;
  }

  next() {
    while (this.queue.length > 0) {
      const id   = this.queue[0];
      const task = this.tasks.get(id);
      if (task && task.status === 'queued') return task;
      this.queue.shift();
    }
    return null;
  }

  start(id, worktreeId) {
    const task = this._get(id);
    task.status    = 'in_progress';
    task.startedAt = new Date().toISOString();
    task.worktreeId= worktreeId;
    this.persistQueue();
  }

  complete(id, result) {
    const task = this._get(id);
    task.status     = 'completed';
    task.completedAt= new Date().toISOString();
    task.result     = result;
    this.persistQueue();
  }

  fail(id, error) {
    const task = this._get(id);
    task.status     = 'failed';
    task.completedAt= new Date().toISOString();
    task.error      = error;
    this.persistQueue();
  }

  /**
   * FIX #11: Atomic write — write to .tmp then rename so a crash mid-write
   * never corrupts the live queue file.  fs.renameSync is atomic on POSIX
   * (Linux/macOS) when both paths are on the same filesystem.
   */
  persistQueue() {
    const dir = path.dirname(this.queuePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const content  = Array.from(this.tasks.values()).map(t => JSON.stringify(t)).join('\n') + '\n';
    const tmpPath  = this.queuePath + '.tmp';

    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'w' });
    fs.renameSync(tmpPath, this.queuePath); // ← atomic swap
  }

  loadQueue() {
    // Also handle a leftover .tmp from a previous crash
    if (!fs.existsSync(this.queuePath)) {
      const tmpPath = this.queuePath + '.tmp';
      if (fs.existsSync(tmpPath)) {
        console.warn('[TaskManager] Recovering from .tmp queue file (previous crash)');
        try { fs.renameSync(tmpPath, this.queuePath); } catch (_) {}
      } else {
        return;
      }
    }

    const content = fs.readFileSync(this.queuePath, 'utf8');
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try {
        const task = JSON.parse(line);
        this.tasks.set(task.id, task);
        if (task.status === 'queued') this.queue.push(task.id);
      } catch (e) {
        console.error(`[TaskManager] Skipping corrupt queue line: ${line.slice(0, 80)}`, e.message);
      }
    }
  }

  get(id)  { return this.tasks.get(id); }
  _get(id) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task ${id} not found`);
    return t;
  }

  list(filter = {}) {
    return Array.from(this.tasks.values()).filter(t => {
      if (filter.status && t.status !== filter.status) return false;
      return true;
    });
  }
}

// ESM default export — enables: import Factory from './task-manager.js'
export default TaskManager;
export { TaskManager };